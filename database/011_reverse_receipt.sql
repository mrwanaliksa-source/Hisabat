-- =====================================================================
-- Hisabat — reverse (cancel) a wrong receipt. Run once, after 010.
-- Posted records are never deleted: every journal entry of the receipt
-- (the receipt, its allocations, any partner share) gets an equal and
-- opposite entry on the receipt's own date, and the receipt is marked
-- reversed with a reason. Admin or reviewer only.
-- =====================================================================

alter table public.receipts            add column if not exists reversed_at timestamptz,
                                       add column if not exists reversed_by uuid references auth.users(id),
                                       add column if not exists reverse_reason text;
alter table public.receipt_allocations add column if not exists reversed_at timestamptz;
alter table public.partner_entitlements add column if not exists reversed_at timestamptz;

-- allocations and partner shares stay immutable, except for being marked reversed by the function below
create or replace function public.trg_block_change() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and coalesce(current_setting('hisabat.posting', true), '') = 'on'
     and tg_table_name in ('receipt_allocations','partner_entitlements')
     and old.reversed_at is null and new.reversed_at is not null
     and (to_jsonb(new) - 'reversed_at') = (to_jsonb(old) - 'reversed_at') then
    return new;
  end if;
  raise exception 'السجلات المرحلة لا تعدل ولا تحذف؛ استخدم قيدًا عكسيًا / Posted records are immutable';
end $$;

-- posts the mirror image of a journal entry
create or replace function public.reverse_journal_entry(p_entry uuid, p_date date, p_memo text)
returns uuid language plpgsql security definer set search_path = public as $$
declare e public.journal_entries; v_lines jsonb;
begin
  select * into e from public.journal_entries where id = p_entry;
  if not found then return null; end if;
  select jsonb_agg(jsonb_build_object('account', account_id::text, 'debit', credit, 'credit', debit,
                                      'project', project_id, 'party', party_id))
    into v_lines from public.journal_lines where entry_id = p_entry;
  return public.post_journal(e.company_id, p_date, 'reversal', p_entry, p_memo, v_lines);
end $$;
revoke execute on function public.reverse_journal_entry(uuid,date,text) from public, anon, authenticated;

create or replace function public.reverse_receipt(p_receipt uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.receipts; a record; v_memo text;
begin
  select * into r from public.receipts where id = p_receipt for update;
  if not found then raise exception 'Receipt not found'; end if;
  perform public.require_role(r.company_id, array['admin','reviewer']::public.app_role[]);
  if r.reversed_at is not null then raise exception 'التحصيل ملغي بالفعل / Already reversed'; end if;
  if coalesce(trim(p_reason),'') = '' then raise exception 'سبب الإلغاء مطلوب / Reason is required'; end if;
  -- a partner share already paid out from this receipt cannot silently disappear
  if exists (select 1 from public.projects pr join public.sales_documents d on d.project_id = pr.id
               join public.receipt_allocations ra on ra.sales_document_id = d.id
              where ra.receipt_id = r.id and pr.status = 'closed') then
    raise exception 'التحصيل مرتبط بمشروع مقفل؛ أعد فتح المشروع أولًا / Linked project is closed — reopen it first';
  end if;
  v_memo := 'إلغاء تحصيل: ' || trim(p_reason);

  perform set_config('hisabat.posting','on',true);
  for a in select * from public.receipt_allocations where receipt_id = r.id and reversed_at is null loop
    -- partner share on this allocation
    perform public.reverse_journal_entry(e.journal_entry_id, r.receipt_date, v_memo)
       from public.partner_entitlements e where e.allocation_id = a.id and e.reversed_at is null and e.journal_entry_id is not null;
    update public.partner_entitlements set reversed_at = now() where allocation_id = a.id and reversed_at is null;
    -- project tag of money held by a partner
    perform public.reverse_journal_entry(j.id, r.receipt_date, v_memo)
       from public.journal_entries j where j.source_type = 'receipt_allocation' and j.source_id = a.id;
    update public.receipt_allocations set reversed_at = now() where id = a.id;
  end loop;
  -- the receipt itself
  perform public.reverse_journal_entry(r.journal_entry_id, r.receipt_date, v_memo);
  perform set_config('hisabat.posting','off',true);

  update public.receipts set reversed_at = now(), reversed_by = auth.uid(), reverse_reason = trim(p_reason) where id = r.id;
end $$;
revoke execute on function public.reverse_receipt(uuid,text) from public, anon;
grant execute on function public.reverse_receipt(uuid,text) to authenticated;

-- allocation must ignore reversed allocations when checking balances
create or replace function public.allocate_receipt(p_receipt uuid, p_doc uuid, p_amount numeric)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  r public.receipts; d public.sales_documents; pr public.projects; ag public.partner_agreements;
  v_alloc uuid; v_amt numeric(18,2) := round(p_amount,2);
  v_receipt_left numeric; v_doc_left numeric; v_ratio numeric; v_net numeric(18,2);
  v_share numeric(18,2); v_prev_net numeric(18,2); v_entry uuid;
begin
  select * into r from public.receipts where id = p_receipt for update;
  if not found then raise exception 'Receipt not found'; end if;
  if r.reversed_at is not null then raise exception 'التحصيل ملغي / Receipt was reversed'; end if;
  perform public.require_role(r.company_id, array['admin','reviewer']::public.app_role[]);
  select * into d from public.sales_documents where id = p_doc for update;
  if d.company_id <> r.company_id or d.customer_id <> r.customer_id then
    raise exception 'المستند لا يخص نفس العميل / Document belongs to another customer';
  end if;
  if d.status <> 'posted' then raise exception 'يخصص التحصيل لمستند معتمد فقط / Document not posted'; end if;
  select * into pr from public.projects where id = d.project_id;
  if pr.contract_holder = 'partner' and r.held_by_partner is distinct from pr.holder_partner_id then
    raise exception 'مشروع % باسم الشريك؛ سجل التحصيل كمستلم لدى الشريك / Receipt must be held by the contract-holding partner', pr.code;
  end if;
  if pr.contract_holder = 'company' and r.held_by_partner is not null then
    raise exception 'مشروع % باسم الشركة؛ التحصيل يجب أن يكون في بنك الشركة / Receipt must go to the company bank', pr.code;
  end if;

  select r.amount - coalesce(sum(amount),0) into v_receipt_left from public.receipt_allocations where receipt_id = r.id and reversed_at is null;
  select d.collectible_total - coalesce(sum(amount),0) into v_doc_left from public.receipt_allocations where sales_document_id = d.id and reversed_at is null;
  if v_amt <= 0 then raise exception 'Amount must be positive'; end if;
  if v_amt > v_receipt_left then raise exception 'المبلغ أكبر من المتبقي في التحصيل % / Exceeds unallocated receipt', v_receipt_left; end if;
  if v_amt > v_doc_left then raise exception 'المبلغ أكبر من رصيد المستند % / Exceeds document balance', v_doc_left; end if;

  insert into public.receipt_allocations(company_id, receipt_id, sales_document_id, amount, created_by)
  values (r.company_id, r.id, d.id, v_amt, auth.uid()) returning id into v_alloc;

  -- money held by the partner: tag it to this project
  if r.held_by_partner is not null then
    perform public.post_journal(r.company_id, r.receipt_date, 'receipt_allocation', v_alloc,
      'تخصيص تحصيل لدى الشريك للمشروع ' || pr.code,
      jsonb_build_array(
        jsonb_build_object('account','partner_held_cash','debit',v_amt,'project',d.project_id,'party',r.held_by_partner),
        jsonb_build_object('account','partner_held_cash','credit',v_amt,'party',r.held_by_partner)));
  end if;

  -- share on collections only for agreements on that basis
  select * into ag from public.partner_agreements
   where project_id = d.project_id and effective_from <= r.receipt_date
     and (effective_to is null or effective_to >= r.receipt_date)
   order by effective_from desc limit 1;

  if found and ag.basis = 'collections' and d.collectible_total > 0 then
    v_ratio := d.collectible_net / d.collectible_total;
    if v_amt = v_doc_left then
      select coalesce(sum(net_collected),0) into v_prev_net from public.partner_entitlements where sales_document_id = d.id and reversed_at is null;
      v_net := d.collectible_net - v_prev_net;
    else
      v_net := round(v_amt * v_ratio, 2);
    end if;
    v_share := round(v_net * ag.share_pct, 2);
    if v_share > 0 then
      v_entry := public.post_journal(r.company_id, r.receipt_date, 'partner_entitlement', v_alloc,
        'حصة الشريك عن تحصيل ' || coalesce(r.reference,''),
        jsonb_build_array(
          jsonb_build_object('account','partner_share_cost','debit',v_share,'project',d.project_id,'party',ag.partner_id),
          jsonb_build_object('account','partner_payable','credit',v_share,'project',d.project_id,'party',ag.partner_id)));
      insert into public.partner_entitlements(company_id, project_id, partner_id, agreement_id, allocation_id,
        sales_document_id, collected_amount, net_ratio, net_collected, share_pct, amount, journal_entry_id)
      values (r.company_id, d.project_id, ag.partner_id, ag.id, v_alloc, d.id, v_amt, v_ratio, v_net,
              ag.share_pct, v_share, v_entry);
    end if;
  end if;
  return v_alloc;
end $$;

-- ---------------------------------------------------------------------
-- views: reversed allocations / shares / receipts no longer count
-- ---------------------------------------------------------------------
create or replace view public.v_sales_document_balances with (security_invoker = on) as
select d.id, d.company_id, d.project_id, d.customer_id, d.doc_type, d.issuer_ref, d.issue_date, d.status,
       d.collectible_total, coalesce(sum(a.amount),0) as collected,
       d.collectible_total - coalesce(sum(a.amount),0) as balance
  from public.sales_documents d
  left join public.receipt_allocations a on a.sales_document_id = d.id and a.reversed_at is null
 group by d.id;

create or replace view public.v_receipt_balances with (security_invoker = on) as
select r.id, r.company_id, r.customer_id, r.receipt_date, r.amount, r.reference,
       coalesce(sum(a.amount),0) as allocated,
       case when r.reversed_at is null then r.amount - coalesce(sum(a.amount),0) else 0 end as unallocated,
       r.reversed_at, r.reverse_reason
  from public.receipts r
  left join public.receipt_allocations a on a.receipt_id = r.id and a.reversed_at is null
 group by r.id;

create or replace view public.v_partner_balances with (security_invoker = on) as
select e.company_id, e.partner_id, e.project_id,
       sum(e.net_collected) as net_collected, sum(e.amount) as entitled,
       coalesce((select sum(s.amount) from public.partner_settlements s
                  where s.partner_id = e.partner_id and s.project_id = e.project_id),0) as settled,
       sum(e.amount) - coalesce((select sum(s.amount) from public.partner_settlements s
                  where s.partner_id = e.partner_id and s.project_id = e.project_id),0) as outstanding
  from public.partner_entitlements e
 where e.reversed_at is null
 group by e.company_id, e.partner_id, e.project_id;

create or replace view public.v_partner_project_accounts with (security_invoker = on) as
select p.id as project_id, p.company_id, p.code, p.name_ar, p.name_en, p.holder_partner_id as partner_id, p.status,
  coalesce((select sum(ra.amount) from public.receipt_allocations ra
              join public.sales_documents sd on sd.id = ra.sales_document_id
              join public.receipts r on r.id = ra.receipt_id
             where sd.project_id = p.id and r.held_by_partner is not null and ra.reversed_at is null), 0) as collected_by_partner,
  coalesce((select sum(case direction when 'to_company' then amount when 'to_partner' then -amount else 0 end)
              from public.partner_transfers t where t.project_id = p.id), 0)                            as transferred_to_company,
  coalesce((select sum(amount) from public.partner_transfers t
             where t.project_id = p.id and t.direction = 'partner_paid_vat'), 0)                        as vat_paid_by_partner,
  coalesce(sum(l.debit - l.credit) filter (where a.system_key = 'partner_held_cash'), 0)                 as held_by_partner,
  coalesce(sum(l.credit - l.debit) filter (where a.system_key = 'partner_vat'), 0)                       as partner_vat_due,
  coalesce(sum(l.debit - l.credit) filter (where a.system_key = 'partner_held_cash'), 0)
    - coalesce(sum(l.credit - l.debit) filter (where a.system_key = 'partner_vat'), 0)                   as net_due_to_company
from public.projects p
left join public.journal_lines l on l.project_id = p.id
left join public.accounts a on a.id = l.account_id
where p.contract_holder = 'partner'
group by p.id;

notify pgrst, 'reload schema';
