-- =====================================================================
-- Hisabat — دفعات مقدمة للموردين (تحت الحساب). Run once, after 015.
--
--  • دفعة لمورد قبل الفاتورة ← أصل على المورد (1500)، مش مصروف
--  • لما الفاتورة تيجي: تتسجل مصروف وتتخصم من الدفعة (كلها أو جزء)
--    والباقي من الفاتورة يفضل آجل على المورد، والباقي من الدفعة يفضل للفاتورة الجاية
-- =====================================================================

insert into public.accounts(company_id, code, name_ar, name_en, type, system_key)
select c.id, '1500', 'دفعات مقدمة للموردين', 'Supplier advances', 'asset', 'supplier_advances'
  from public.companies c
 where not exists (select 1 from public.accounts a where a.company_id = c.id and a.system_key = 'supplier_advances');

create or replace function public.seed_accounts(p_company uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.accounts(company_id, code, name_ar, name_en, type, system_key, is_bank) values
   (p_company,'1010','البنك','Bank','asset','bank_main',true),
   (p_company,'1020','الصندوق','Cash','asset','cash_main',true),
   (p_company,'1150','أموال المشروعات لدى الشركاء','Project funds held by partners','asset','partner_held_cash',false),
   (p_company,'1200','العملاء','Accounts receivable','asset','receivables',false),
   (p_company,'1250','محتجزات لدى العملاء','Retention receivable','asset','retention_receivable',false),
   (p_company,'1300','ضريبة مدخلات','Input VAT','asset','vat_input',false),
   (p_company,'1400','العهد','Employee custody','asset','custody',false),
   (p_company,'1500','دفعات مقدمة للموردين','Supplier advances','asset','supplier_advances',false),
   (p_company,'2100','الموردون','Accounts payable','liability','payables',false),
   (p_company,'2150','مستحق الشركاء','Partner payable','liability','partner_payable',false),
   (p_company,'2200','دفعات مقدمة من العملاء','Customer advances','liability','customer_advances',false),
   (p_company,'2300','ضريبة مخرجات','Output VAT','liability','vat_output',false),
   (p_company,'2350','ضريبة على فواتير الشركاء','VAT on partner-issued invoices','liability','partner_vat',false),
   (p_company,'3000','الأرصدة الافتتاحية ورأس المال','Opening balances & equity','equity','equity',false),
   (p_company,'4000','إيرادات المشروعات','Project revenue','revenue','revenue',false),
   (p_company,'5000','تكاليف مباشرة للمشروعات','Direct project costs','expense','direct_cost',false),
   (p_company,'5100','تكلفة حصة الشريك','Partner share cost','expense','partner_share_cost',false),
   (p_company,'6000','مصروفات عمومية وإدارية','General & admin expenses','expense','general_expense',false);
end $$;

create table if not exists public.supplier_advances (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id) on delete cascade,
  supplier_id      uuid not null references public.parties(id),
  project_id       uuid references public.projects(id),
  pay_date         date not null,
  amount           numeric(18,2) not null check (amount > 0),
  bank_account_id  uuid not null references public.accounts(id),
  reference        text,
  notes            text,
  created_by       uuid references auth.users(id),
  created_at       timestamptz not null default now(),
  journal_entry_id uuid references public.journal_entries(id)
);
create index if not exists supplier_advances_company on public.supplier_advances(company_id, supplier_id);
alter table public.supplier_payments add column if not exists advance_id uuid references public.supplier_advances(id);

alter table public.supplier_advances enable row level security;
drop policy if exists supplier_advances_read on public.supplier_advances;
create policy supplier_advances_read on public.supplier_advances for select to authenticated
  using (public.is_member(company_id) and public.my_role(company_id) in ('admin','reviewer','expense'));
drop trigger if exists supplier_advances_audit on public.supplier_advances;
create trigger supplier_advances_audit after insert or update or delete on public.supplier_advances
  for each row execute function public.trg_audit();

create or replace function public.supplier_advance_balance(p_advance uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select a.amount - coalesce((select sum(p.amount) from public.supplier_payments p where p.advance_id = a.id), 0)
    from public.supplier_advances a where a.id = p_advance
$$;

-- supplier: existing id, or by name (created if new)
create or replace function public.supplier_from(p_company uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid; v_vat text := nullif(regexp_replace(coalesce(p->>'supplier_vat',''), '\D', '', 'g'), '');
begin
  if nullif(p->>'supplier_id','') is not null then
    select id into v from public.parties where id = (p->>'supplier_id')::uuid and company_id = p_company and kind = 'supplier';
  end if;
  if v is null and v_vat is not null then
    select id into v from public.parties where company_id = p_company and kind = 'supplier' and vat_number = v_vat;
  end if;
  if v is null and coalesce(trim(p->>'supplier_name'),'') <> '' then
    select id into v from public.parties where company_id = p_company and kind = 'supplier'
       and lower(name_ar) = lower(trim(p->>'supplier_name')) limit 1;
    if v is null then
      insert into public.parties(company_id, kind, name_ar, vat_number)
      values (p_company, 'supplier', trim(p->>'supplier_name'), v_vat) returning id into v;
    end if;
  end if;
  if v is null then raise exception 'اسم المورد مطلوب / Supplier name is required'; end if;
  return v;
end $$;

-- 1) pay a supplier on account
create or replace function public.pay_supplier_advance(p_company uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid; v_entry uuid; v_supp uuid; v_amt numeric(18,2); v_date date; v_acc uuid; v_proj uuid;
begin
  perform public.require_role(p_company, array['admin','reviewer','expense']::public.app_role[]);
  v_amt  := round(coalesce(nullif(p->>'amount','')::numeric, 0), 2);
  if v_amt <= 0 then raise exception 'المبلغ يجب أن يكون أكبر من صفر / Amount must be greater than zero'; end if;
  v_date := coalesce(nullif(p->>'pay_date','')::date, current_date);
  v_acc  := nullif(p->>'account_id','')::uuid;
  if not exists (select 1 from public.accounts where id = v_acc and company_id = p_company and is_bank) then
    raise exception 'حساب بنك أو صندوق غير صالح / Invalid bank or cash account';
  end if;
  v_proj := nullif(p->>'project_id','')::uuid;
  if v_proj is not null and not exists (select 1 from public.projects where id = v_proj and company_id = p_company) then
    raise exception 'Invalid project';
  end if;
  if coalesce(trim(p->>'notes'),'') = '' then raise exception 'البيان مطلوب / Details are required'; end if;
  v_supp := public.supplier_from(p_company, p);

  insert into public.supplier_advances(company_id, supplier_id, project_id, pay_date, amount, bank_account_id, reference, notes, created_by)
  values (p_company, v_supp, v_proj, v_date, v_amt, v_acc, nullif(trim(p->>'reference'),''), trim(p->>'notes'), auth.uid())
  returning id into v;
  v_entry := public.post_journal(p_company, v_date, 'supplier_advance', v,
    'دفعة مقدمة لمورد — ' || trim(p->>'notes'),
    jsonb_build_array(
      jsonb_build_object('account','supplier_advances','debit',v_amt,'project',v_proj,'party',v_supp),
      jsonb_build_object('account', v_acc::text,'credit',v_amt,'project',v_proj)));
  update public.supplier_advances set journal_entry_id = v_entry where id = v;
  return v;
end $$;

-- 2) deduct an advance from a posted supplier invoice
create or replace function public.apply_supplier_advance(p_doc uuid, p_advance uuid, p_amount numeric, p_date date default current_date)
returns uuid language plpgsql security definer set search_path = public as $$
declare d public.purchase_documents; a public.supplier_advances; v uuid; v_entry uuid;
  v_amt numeric(18,2) := round(p_amount, 2); v_doc_left numeric; v_adv_left numeric;
begin
  select * into d from public.purchase_documents where id = p_doc and status = 'posted';
  if not found then raise exception 'الفاتورة غير موجودة أو غير مرحلة / Invoice not found or not posted'; end if;
  perform public.require_role(d.company_id, array['admin','reviewer','expense']::public.app_role[]);
  select * into a from public.supplier_advances where id = p_advance and company_id = d.company_id for update;
  if not found then raise exception 'الدفعة المقدمة غير موجودة / Advance not found'; end if;
  if a.supplier_id <> d.supplier_id then
    raise exception 'الدفعة المقدمة لمورد تاني غير مورد الفاتورة / The advance belongs to a different supplier';
  end if;
  select d.total_amount - coalesce(sum(amount),0) into v_doc_left from public.supplier_payments where purchase_document_id = d.id;
  v_adv_left := public.supplier_advance_balance(a.id);
  if v_amt <= 0 then raise exception 'المبلغ يجب أن يكون أكبر من صفر / Amount must be greater than zero'; end if;
  if v_amt > v_doc_left then raise exception 'المبلغ أكبر من المتبقي على الفاتورة % / Exceeds invoice balance', v_doc_left; end if;
  if v_amt > v_adv_left then raise exception 'المبلغ أكبر من المتبقي في الدفعة المقدمة % / Exceeds advance balance', v_adv_left; end if;

  insert into public.supplier_payments(company_id, supplier_id, purchase_document_id, pay_date, amount, bank_account_id,
    reference, advance_id, created_by)
  values (d.company_id, d.supplier_id, d.id, coalesce(p_date, current_date), v_amt,
    public.acct(d.company_id,'supplier_advances'), 'خصم من دفعة مقدمة', a.id, auth.uid())
  returning id into v;
  v_entry := public.post_journal(d.company_id, coalesce(p_date, current_date), 'supplier_payment', v,
    'خصم من دفعة مقدمة — فاتورة ' || d.doc_number,
    jsonb_build_array(
      jsonb_build_object('account','payables','debit',v_amt,'project',d.project_id,'party',d.supplier_id),
      jsonb_build_object('account','supplier_advances','credit',v_amt,'project',a.project_id,'party',a.supplier_id)));
  update public.supplier_payments set journal_entry_id = v_entry where id = v;
  return v;
end $$;

-- 3) new expense paid (fully or partly) from an advance — one step
--    p = post_expense fields + advance_id ; the rest of the invoice stays payable
create or replace function public.post_expense_from_advance(p_company uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare a public.supplier_advances; v_doc uuid; v_total numeric; v_use numeric;
begin
  select * into a from public.supplier_advances where id = nullif(p->>'advance_id','')::uuid and company_id = p_company;
  if not found then raise exception 'اختر الدفعة المقدمة / Choose the advance'; end if;
  -- the invoice is for the advance's supplier
  v_doc := public.post_expense(p_company, (p - 'payment' - 'supplier_name' - 'advance_id')
             || jsonb_build_object('payment','credit','supplier_id', a.supplier_id,
                                   'project_id', coalesce(nullif(p->>'project_id',''), a.project_id::text)));
  select total_amount into v_total from public.purchase_documents where id = v_doc;
  v_use := least(v_total, public.supplier_advance_balance(a.id));
  if v_use > 0 then
    perform public.apply_supplier_advance(v_doc, a.id, v_use, coalesce(nullif(p->>'issue_date','')::date, current_date));
  end if;
  return v_doc;
end $$;

create or replace view public.v_supplier_advances with (security_invoker = on) as
select a.id, a.company_id, a.supplier_id, s.name_ar as supplier_name, a.project_id, a.pay_date, a.amount,
       a.reference, a.notes, a.bank_account_id,
       coalesce((select sum(p.amount) from public.supplier_payments p where p.advance_id = a.id), 0)            as applied,
       a.amount - coalesce((select sum(p.amount) from public.supplier_payments p where p.advance_id = a.id), 0) as balance
  from public.supplier_advances a join public.parties s on s.id = a.supplier_id;

revoke execute on function public.supplier_advance_balance(uuid) from public, anon;
revoke execute on function public.supplier_from(uuid,jsonb) from public, anon, authenticated;
revoke execute on function public.pay_supplier_advance(uuid,jsonb) from public, anon;
revoke execute on function public.apply_supplier_advance(uuid,uuid,numeric,date) from public, anon;
revoke execute on function public.post_expense_from_advance(uuid,jsonb) from public, anon;
grant execute on function public.supplier_advance_balance(uuid), public.pay_supplier_advance(uuid,jsonb),
  public.apply_supplier_advance(uuid,uuid,numeric,date), public.post_expense_from_advance(uuid,jsonb) to authenticated;

notify pgrst, 'reload schema';
