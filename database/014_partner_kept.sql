-- =====================================================================
-- Hisabat — money the contract-holding partner keeps for itself. Run once, after 013.
--
--  New movements with a partner (projects in the partner's name):
--    partner_kept_share : the partner deducted its % from the money it holds
--                         (settles what we owe it — appears as "settled" in partner balances)
--    partner_kept_zakat : the partner deducted zakat from the money it holds (a project cost)
--  Neither touches our bank / cash.
-- =====================================================================

alter table public.partner_transfers drop constraint if exists partner_transfers_direction_check;
alter table public.partner_transfers drop constraint if exists partner_transfers_check;
alter table public.partner_transfers add constraint partner_transfers_direction_check
  check (direction in ('to_company','to_partner','partner_paid_vat','partner_kept_share','partner_kept_zakat'));
alter table public.partner_transfers add constraint partner_transfers_check
  check ((direction in ('to_company','to_partner')) = (bank_account_id is not null));

create or replace function public.record_partner_transfer(p_company uuid, p_project uuid, p_date date,
  p_amount numeric, p_direction text, p_bank_account uuid default null, p_reference text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare pr public.projects; v uuid; v_entry uuid; v_amt numeric(18,2) := round(p_amount,2); v_lines jsonb;
  v_owed numeric(18,2); v_cash boolean := p_direction in ('to_company','to_partner');
begin
  perform public.require_role(p_company, array['admin','reviewer']::public.app_role[]);
  select * into pr from public.projects where id = p_project and company_id = p_company;
  if not found or pr.contract_holder <> 'partner' then
    raise exception 'المشروع ليس باسم شريك / Project is not held by a partner';
  end if;
  if v_amt <= 0 then raise exception 'Amount must be positive'; end if;
  if p_direction not in ('to_company','to_partner','partner_paid_vat','partner_kept_share','partner_kept_zakat') then
    raise exception 'Invalid direction';
  end if;
  if v_cash and not exists
     (select 1 from public.accounts where id = p_bank_account and company_id = p_company and is_bank) then
    raise exception 'حساب بنك أو صندوق غير صالح / Invalid bank account';
  end if;
  if p_direction = 'partner_kept_share' then
    select coalesce(sum(l.credit - l.debit), 0) into v_owed
      from public.journal_lines l
     where l.account_id = public.acct(p_company, 'partner_payable')
       and l.project_id = p_project and l.party_id = pr.holder_partner_id;
    if v_amt > v_owed then
      raise exception 'المبلغ أكبر من المستحق للشريك % / Exceeds what is owed to the partner (%)', v_owed, v_owed;
    end if;
  end if;

  insert into public.partner_transfers(company_id, project_id, partner_id, transfer_date, direction, amount,
    bank_account_id, reference, created_by)
  values (p_company, p_project, pr.holder_partner_id, p_date, p_direction, v_amt,
    case when v_cash then p_bank_account end, p_reference, auth.uid())
  returning id into v;

  v_lines := case p_direction
    when 'to_company' then jsonb_build_array(
      jsonb_build_object('account', p_bank_account::text, 'debit', v_amt, 'project', p_project),
      jsonb_build_object('account','partner_held_cash','credit', v_amt, 'project', p_project, 'party', pr.holder_partner_id))
    when 'to_partner' then jsonb_build_array(
      jsonb_build_object('account','partner_held_cash','debit', v_amt, 'project', p_project, 'party', pr.holder_partner_id),
      jsonb_build_object('account', p_bank_account::text, 'credit', v_amt, 'project', p_project))
    when 'partner_paid_vat' then jsonb_build_array(
      jsonb_build_object('account','partner_vat','debit', v_amt, 'project', p_project, 'party', pr.holder_partner_id),
      jsonb_build_object('account','partner_held_cash','credit', v_amt, 'project', p_project, 'party', pr.holder_partner_id))
    when 'partner_kept_share' then jsonb_build_array(
      jsonb_build_object('account','partner_payable','debit', v_amt, 'project', p_project, 'party', pr.holder_partner_id),
      jsonb_build_object('account','partner_held_cash','credit', v_amt, 'project', p_project, 'party', pr.holder_partner_id))
    when 'partner_kept_zakat' then jsonb_build_array(
      jsonb_build_object('account','direct_cost','debit', v_amt, 'project', p_project, 'party', pr.holder_partner_id),
      jsonb_build_object('account','partner_held_cash','credit', v_amt, 'project', p_project, 'party', pr.holder_partner_id))
    end;
  v_entry := public.post_journal(p_company, p_date, 'partner_transfer', v,
    case p_direction when 'to_company' then 'تحويل من الشريك ' when 'to_partner' then 'تحويل للشريك '
                     when 'partner_paid_vat' then 'ضريبة سددها الشريك '
                     when 'partner_kept_share' then 'نسبة خصمها الشريك '
                     else 'زكاة خصمها الشريك ' end || pr.code
    || coalesce(' — ' || nullif(trim(p_reference),''), ''), v_lines);
  perform set_config('hisabat.posting','on',true);
  update public.partner_transfers set journal_entry_id = v_entry where id = v;
  perform set_config('hisabat.posting','off',true);
  return v;
end $$;

revoke execute on function public.record_partner_transfer(uuid,uuid,date,numeric,text,uuid,text) from public, anon;
grant execute on function public.record_partner_transfer(uuid,uuid,date,numeric,text,uuid,text) to authenticated;

-- partner balances: a share the partner kept counts as settled
create or replace view public.v_partner_balances with (security_invoker = on) as
with paid as (
  select partner_id, project_id, amount from public.partner_settlements
  union all
  select partner_id, project_id, amount from public.partner_transfers where direction = 'partner_kept_share'
)
select e.company_id, e.partner_id, e.project_id,
       sum(e.net_collected) as net_collected, sum(e.amount) as entitled,
       coalesce((select sum(s.amount) from paid s where s.partner_id = e.partner_id and s.project_id = e.project_id),0) as settled,
       sum(e.amount) - coalesce((select sum(s.amount) from paid s
                  where s.partner_id = e.partner_id and s.project_id = e.project_id),0) as outstanding
  from public.partner_entitlements e
 where e.reversed_at is null
 group by e.company_id, e.partner_id, e.project_id;

-- the partner account: VAT paid and share/zakat kept are shown separately
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
    - coalesce(sum(l.credit - l.debit) filter (where a.system_key = 'partner_vat'), 0)                   as net_due_to_company,
  coalesce((select sum(amount) from public.partner_transfers t
             where t.project_id = p.id and t.direction = 'partner_kept_share'), 0)                      as share_kept_by_partner,
  coalesce((select sum(amount) from public.partner_transfers t
             where t.project_id = p.id and t.direction = 'partner_kept_zakat'), 0)                      as zakat_kept_by_partner
from public.projects p
left join public.journal_lines l on l.project_id = p.id
left join public.accounts a on a.id = l.account_id
where p.contract_holder = 'partner'
group by p.id;

notify pgrst, 'reload schema';
