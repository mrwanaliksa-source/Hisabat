-- =====================================================================
-- Hisabat — projects contracted in a PARTNER's name. Run once after 005.
--
--  • The partner (e.g. الفاتح العربية) issues the client invoices and receives the money.
--  • The company (تريو) executes and pays the costs; there are no invoices between them.
--  • Client VAT and purchase VAT belong to the partner → booked to 2350, not the company's VAT.
--  • Money collected sits with the partner → 1150 "project funds held by partners", per project.
--  • Partner share can be % of collections (as before) or % of PROFIT AT CLOSE:
--      profit = invoiced works (revenue) − project costs, before the partner share.
--  • Closing the project books the share and shows the final settlement.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------
alter table public.companies add column if not exists vat_period text not null default 'quarterly'
  check (vat_period in ('monthly','quarterly'));
alter table public.parties add column if not exists vat_period text
  check (vat_period in ('monthly','quarterly'));

alter table public.projects
  add column if not exists contract_holder text not null default 'company' check (contract_holder in ('company','partner')),
  add column if not exists holder_partner_id uuid references public.parties(id),
  add column if not exists closed_at date,
  add column if not exists close_entry_id uuid references public.journal_entries(id),
  add column if not exists close_revenue numeric(18,2),
  add column if not exists close_costs numeric(18,2),
  add column if not exists close_profit numeric(18,2),
  add column if not exists close_share numeric(18,2);
alter table public.projects drop constraint if exists projects_holder_chk;
alter table public.projects add constraint projects_holder_chk
  check ((contract_holder = 'partner') = (holder_partner_id is not null));

alter table public.partner_agreements add column if not exists basis text not null default 'collections'
  check (basis in ('collections','profit_at_close'));

alter table public.receipts alter column bank_account_id drop not null;
alter table public.receipts add column if not exists held_by_partner uuid references public.parties(id);
alter table public.receipts drop constraint if exists receipts_dest_chk;
alter table public.receipts add constraint receipts_dest_chk check ((bank_account_id is null) <> (held_by_partner is null));

create table if not exists public.partner_transfers (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id) on delete cascade,
  project_id       uuid not null references public.projects(id),
  partner_id       uuid not null references public.parties(id),
  transfer_date    date not null,
  direction        text not null check (direction in ('to_company','to_partner','partner_paid_vat')),
  amount           numeric(18,2) not null check (amount > 0),
  bank_account_id  uuid references public.accounts(id),
  reference        text,
  created_by       uuid references auth.users(id),
  created_at       timestamptz not null default now(),
  journal_entry_id uuid references public.journal_entries(id),
  check ((direction = 'partner_paid_vat') = (bank_account_id is null))
);
alter table public.partner_transfers enable row level security;
drop policy if exists partner_transfers_read on public.partner_transfers;
create policy partner_transfers_read on public.partner_transfers for select to authenticated
  using (public.my_role(company_id) in ('admin','reviewer'));
drop trigger if exists partner_transfers_audit on public.partner_transfers;
create trigger partner_transfers_audit after insert or update or delete on public.partner_transfers
  for each row execute function public.trg_audit();
-- no write policies exist for users: rows are created only by record_partner_transfer
drop trigger if exists partner_transfers_immutable on public.partner_transfers;

-- ---------------------------------------------------------------------
-- 2. New system accounts (existing companies + future ones)
-- ---------------------------------------------------------------------
insert into public.accounts(company_id, code, name_ar, name_en, type, system_key)
select c.id, '1150', 'أموال المشروعات لدى الشركاء', 'Project funds held by partners', 'asset', 'partner_held_cash'
  from public.companies c
 where not exists (select 1 from public.accounts a where a.company_id = c.id and a.system_key = 'partner_held_cash');
insert into public.accounts(company_id, code, name_ar, name_en, type, system_key)
select c.id, '2350', 'ضريبة على فواتير الشركاء', 'VAT on partner-issued invoices', 'liability', 'partner_vat'
  from public.companies c
 where not exists (select 1 from public.accounts a where a.company_id = c.id and a.system_key = 'partner_vat');

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

-- contract holder is part of the frozen terms once documents are posted
create or replace function public.trg_project_terms_guard() returns trigger language plpgsql as $$
begin
  if (new.advance_amount, new.recovery_pct, new.retention_pct, new.retention_cap_pct, new.retention_vat_mode,
      new.contract_holder, new.holder_partner_id)
     is distinct from
     (old.advance_amount, old.recovery_pct, old.retention_pct, old.retention_cap_pct, old.retention_vat_mode,
      old.contract_holder, old.holder_partner_id)
     and exists (select 1 from public.sales_documents where project_id = old.id and status = 'posted') then
    raise exception 'لا يمكن تعديل شروط المشروع بعد ترحيل مستندات عليه / Terms locked after posting';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 3. Project creation (adds contract holder, share basis, partner VAT period)
-- ---------------------------------------------------------------------
create or replace function public.create_project(p_company uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_cust uuid; v_partner uuid; v_prj uuid; v_holder text;
  v_contract numeric(18,2); v_adv numeric(7,4); v_rec numeric(7,4);
  v_ret numeric(7,4); v_cap numeric(7,4); v_share numeric(7,4); v_start date; v_basis text;
begin
  perform public.require_role(p_company, array['admin','reviewer']::public.app_role[]);

  if coalesce(trim(p->>'code'),'') = '' or coalesce(trim(p->>'name_ar'),'') = '' then
    raise exception 'كود المشروع واسمه مطلوبان / Project code and name are required';
  end if;
  v_holder   := coalesce(nullif(p->>'contract_holder',''), 'company');
  if v_holder not in ('company','partner') then raise exception 'Invalid contract holder'; end if;
  v_contract := coalesce(nullif(p->>'contract_value','')::numeric, 0);
  v_adv      := coalesce(nullif(p->>'advance_pct','')::numeric, 0);
  v_rec      := coalesce(nullif(p->>'recovery_pct','')::numeric, v_adv);
  v_ret      := coalesce(nullif(p->>'retention_pct','')::numeric, 0);
  v_cap      := nullif(p->>'retention_cap_pct','')::numeric;
  v_start    := nullif(p->>'start_date','')::date;
  v_basis    := coalesce(nullif(p->>'basis',''), case when v_holder = 'partner' then 'profit_at_close' else 'collections' end);
  if v_basis not in ('collections','profit_at_close') then raise exception 'Invalid share basis'; end if;
  if v_contract < 0 then raise exception 'قيمة العقد غير صحيحة / Invalid contract value'; end if;
  if v_adv > 0 and v_rec = 0 then
    raise exception 'حدد نسبة استرداد الدفعة المقدمة / Recovery %% is required when there is an advance';
  end if;
  if v_holder = 'partner' and not coalesce((p->>'has_partner')::boolean, false) then
    raise exception 'العقد باسم الشريك يتطلب تحديد الشريك ونسبته / A partner is required when the contract is in the partner''s name';
  end if;

  if nullif(p->>'customer_id','') is not null then
    select id into v_cust from public.parties
     where id = (p->>'customer_id')::uuid and company_id = p_company and kind = 'customer';
    if v_cust is null then raise exception 'عميل غير صالح / Invalid customer'; end if;
  elsif coalesce(trim(p->>'customer_name'),'') <> '' then
    insert into public.parties(company_id, kind, name_ar, vat_number, is_government)
    values (p_company, 'customer', trim(p->>'customer_name'), nullif(trim(p->>'customer_vat'),''),
            coalesce((p->>'customer_is_government')::boolean, false))
    returning id into v_cust;
  else
    raise exception 'العميل مطلوب / Customer is required';
  end if;

  begin
    insert into public.projects(company_id, code, name_ar, name_en, customer_id, contract_value,
      prices_include_vat, start_date, end_date, manager_name, budget,
      advance_pct, advance_amount, recovery_pct, retention_pct, retention_cap_pct,
      retention_vat_mode, retention_release_terms, created_by)
    values (p_company, trim(p->>'code'), trim(p->>'name_ar'), nullif(trim(p->>'name_en'),''), v_cust, v_contract,
      false, v_start, nullif(p->>'end_date','')::date, nullif(trim(p->>'manager_name'),''),
      nullif(p->>'budget','')::numeric,
      v_adv, round(v_contract * v_adv, 2), v_rec, v_ret, v_cap,
      'A', nullif(trim(p->>'retention_release_terms'),''), auth.uid())
    returning id into v_prj;
  exception when unique_violation then
    raise exception 'كود المشروع مستخدم من قبل / Project code already exists';
  end;

  if coalesce((p->>'has_partner')::boolean, false) then
    v_share := nullif(p->>'share_pct','')::numeric;
    if v_share is null or v_share <= 0 or v_share > 1 then
      raise exception 'نسبة الشريك يجب أن تكون أكبر من صفر ولا تتجاوز 100%% / Partner share must be between 0 and 100%%';
    end if;
    if nullif(p->>'partner_id','') is not null then
      select id into v_partner from public.parties
       where id = (p->>'partner_id')::uuid and company_id = p_company and kind = 'partner';
      if v_partner is null then raise exception 'شريك غير صالح / Invalid partner'; end if;
    elsif coalesce(trim(p->>'partner_name'),'') <> '' then
      insert into public.parties(company_id, kind, name_ar, vat_number)
      values (p_company, 'partner', trim(p->>'partner_name'), nullif(trim(p->>'partner_vat'),''))
      returning id into v_partner;
    else
      raise exception 'اسم الشركة الشريكة مطلوب / Partner is required';
    end if;
    if nullif(p->>'partner_vat_period','') is not null then
      update public.parties set vat_period = p->>'partner_vat_period' where id = v_partner;
    end if;
    insert into public.partner_agreements(company_id, project_id, partner_id, share_pct, basis, effective_from, notes, created_by)
    values (p_company, v_prj, v_partner, v_share, v_basis,
            coalesce(nullif(p->>'partner_from','')::date, v_start, current_date),
            nullif(trim(p->>'partner_notes'),''), auth.uid());
    if v_holder = 'partner' then
      update public.projects set contract_holder = 'partner', holder_partner_id = v_partner where id = v_prj;
    end if;
  end if;

  return v_prj;
end $$;

-- ---------------------------------------------------------------------
-- 4. Sales approval: client VAT goes to the partner when the contract is theirs
-- ---------------------------------------------------------------------
create or replace function public.approve_sales_document(p_doc uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  d public.sales_documents; c public.companies; pr public.projects; v_entry uuid; v_lines jsonb; v_date date;
  v_vat text; v_vat_party uuid;
begin
  select * into d from public.sales_documents where id = p_doc for update;
  if not found then raise exception 'Document not found'; end if;
  perform public.require_role(d.company_id, array['admin','reviewer']::public.app_role[]);
  select * into c from public.companies where id = d.company_id;
  select * into pr from public.projects where id = d.project_id;
  if d.status <> 'submitted' then raise exception 'المستند ليس قيد المراجعة / Document must be submitted first'; end if;
  if c.require_separate_approver and d.created_by = auth.uid() then
    raise exception 'لا يمكنك اعتماد مستند أدخلته بنفسك / Separate approver required';
  end if;
  if pr.status = 'closed' and d.doc_type <> 'retention_release' then
    raise exception 'المشروع مقفل؛ أعد فتحه أولًا / Project is closed';
  end if;
  perform pg_advisory_xact_lock(hashtext(d.project_id::text));

  d := public.calc_sales_document(p_doc);
  if d.printed_total is not null and abs(d.printed_total - d.invoice_total) > c.total_tolerance then
    raise exception 'الإجمالي المطبوع % لا يطابق المحسوب % / Printed total mismatch', d.printed_total, d.invoice_total;
  end if;
  v_date := coalesce(d.supply_date, d.issue_date);
  if pr.contract_holder = 'partner' then v_vat := 'partner_vat'; v_vat_party := pr.holder_partner_id;
  else v_vat := 'vat_output'; v_vat_party := null; end if;

  if d.doc_type = 'advance' then
    v_lines := jsonb_build_array(
      jsonb_build_object('account','receivables','debit',d.collectible_total,'project',d.project_id,'party',d.customer_id),
      jsonb_build_object('account','customer_advances','credit',d.vat_base,'project',d.project_id,'party',d.customer_id),
      jsonb_build_object('account',v_vat,'credit',d.vat_amount,'project',d.project_id,'party',v_vat_party));
  elsif d.doc_type = 'progress_claim' then
    v_lines := jsonb_build_array(
      jsonb_build_object('account','receivables','debit',d.collectible_total,'project',d.project_id,'party',d.customer_id),
      jsonb_build_object('account','customer_advances','debit',d.advance_recovery,'project',d.project_id,'party',d.customer_id),
      jsonb_build_object('account','retention_receivable','debit',d.retention,'project',d.project_id,'party',d.customer_id),
      jsonb_build_object('account','revenue','credit',d.work_value - d.discount,'project',d.project_id,'party',d.customer_id),
      jsonb_build_object('account',v_vat,'credit',d.vat_amount,'project',d.project_id,'party',v_vat_party));
  elsif d.doc_type = 'retention_release' then
    v_lines := jsonb_build_array(
      jsonb_build_object('account','receivables','debit',d.collectible_total,'project',d.project_id,'party',d.customer_id),
      jsonb_build_object('account','retention_receivable','credit',d.work_value,'project',d.project_id,'party',d.customer_id),
      jsonb_build_object('account',v_vat,'credit',d.vat_amount,'project',d.project_id,'party',v_vat_party));
  else
    v_lines := jsonb_build_array(
      jsonb_build_object('account','receivables','debit',d.collectible_total,'project',d.project_id,'party',d.customer_id),
      jsonb_build_object('account','revenue','credit',d.vat_base,'project',d.project_id,'party',d.customer_id),
      jsonb_build_object('account',v_vat,'credit',d.vat_amount,'project',d.project_id,'party',v_vat_party));
  end if;

  v_entry := public.post_journal(d.company_id, v_date, 'sales_document', d.id,
               'مستند مبيعات ' || coalesce(d.issuer_ref, d.id::text), v_lines);

  perform set_config('hisabat.posting','on',true);
  update public.sales_documents set
    advance_recovery = d.advance_recovery, retention = d.retention, vat_base = d.vat_base, vat_rate = d.vat_rate,
    vat_amount = d.vat_amount, invoice_total = d.invoice_total, collectible_total = d.collectible_total,
    collectible_net = d.collectible_net, vat_mode = d.vat_mode,
    status = 'posted', approved_by = auth.uid(), posted_at = now(), journal_entry_id = v_entry
  where id = p_doc;
  perform set_config('hisabat.posting','off',true);
  return v_entry;
end $$;

-- ---------------------------------------------------------------------
-- 5. Receipts: money can land in the company's bank OR stay with the partner
-- ---------------------------------------------------------------------
drop function if exists public.record_receipt_with_allocations(uuid,uuid,date,numeric,uuid,text,text,jsonb);
drop function if exists public.record_receipt(uuid,uuid,date,numeric,uuid,text,text);

create or replace function public.record_receipt(p_company uuid, p_customer uuid, p_date date,
  p_amount numeric, p_bank_account uuid, p_reference text default null, p_notes text default null,
  p_held_by uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid; v_entry uuid; v_debit jsonb;
begin
  perform public.require_role(p_company, array['admin','reviewer']::public.app_role[]);
  if (p_bank_account is null) = (p_held_by is null) then
    raise exception 'حدد البنك أو الشريك المستلم / Choose a bank account or the receiving partner';
  end if;
  if p_bank_account is not null and not exists
     (select 1 from public.accounts where id = p_bank_account and company_id = p_company and is_bank) then
    raise exception 'حساب بنك أو صندوق غير صالح / Invalid bank account';
  end if;
  if p_held_by is not null and not exists
     (select 1 from public.projects where company_id = p_company and holder_partner_id = p_held_by) then
    raise exception 'هذا الطرف ليس صاحب عقد لأي مشروع / This partner holds no project contract';
  end if;
  if not exists (select 1 from public.parties where id = p_customer and company_id = p_company and kind = 'customer') then
    raise exception 'Invalid customer';
  end if;
  insert into public.receipts(company_id, customer_id, receipt_date, amount, bank_account_id, held_by_partner, reference, notes, created_by)
  values (p_company, p_customer, p_date, round(p_amount,2), p_bank_account, p_held_by, p_reference, p_notes, auth.uid())
  returning id into v;
  v_debit := case when p_held_by is not null
    then jsonb_build_object('account','partner_held_cash','debit',round(p_amount,2),'party',p_held_by)
    else jsonb_build_object('account', p_bank_account::text, 'debit', round(p_amount,2)) end;
  v_entry := public.post_journal(p_company, p_date, 'receipt', v,
    case when p_held_by is not null then 'تحصيل لدى الشريك ' else 'تحصيل ' end || coalesce(p_reference,''),
    jsonb_build_array(v_debit,
      jsonb_build_object('account', 'receivables', 'credit', round(p_amount,2), 'party', p_customer)));
  update public.receipts set journal_entry_id = v_entry where id = v;
  return v;
end $$;

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

  select r.amount - coalesce(sum(amount),0) into v_receipt_left from public.receipt_allocations where receipt_id = r.id;
  select d.collectible_total - coalesce(sum(amount),0) into v_doc_left from public.receipt_allocations where sales_document_id = d.id;
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
      select coalesce(sum(net_collected),0) into v_prev_net from public.partner_entitlements where sales_document_id = d.id;
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

create or replace function public.record_receipt_with_allocations(
  p_company uuid, p_customer uuid, p_date date, p_amount numeric, p_bank_account uuid,
  p_reference text, p_notes text, p_allocations jsonb, p_held_by uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_receipt uuid; a jsonb;
begin
  v_receipt := public.record_receipt(p_company, p_customer, p_date, p_amount, p_bank_account, p_reference, p_notes, p_held_by);
  for a in select * from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb)) loop
    continue when coalesce(nullif(a->>'amount','')::numeric, 0) = 0;
    perform public.allocate_receipt(v_receipt, (a->>'doc')::uuid, (a->>'amount')::numeric);
  end loop;
  return v_receipt;
end $$;

-- ---------------------------------------------------------------------
-- 6. Purchases: VAT on invoices in the partner's name belongs to the partner
-- ---------------------------------------------------------------------
create or replace function public.approve_purchase_document(p_doc uuid, p_eligibility public.vat_eligibility,
  p_eligible_vat numeric default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare d public.purchase_documents; c public.companies; pr public.projects;
  v_elig numeric(18,2); v_entry uuid; v_exp uuid; v_vat text := 'vat_input'; v_vat_party uuid;
begin
  select * into d from public.purchase_documents where id = p_doc for update;
  if not found then raise exception 'Document not found'; end if;
  perform public.require_role(d.company_id, array['admin','reviewer']::public.app_role[]);
  select * into c from public.companies where id = d.company_id;
  if d.status <> 'submitted' then raise exception 'Document must be submitted first'; end if;
  if c.require_separate_approver and d.created_by = auth.uid() then raise exception 'Separate approver required'; end if;
  if d.project_id is not null then
    select * into pr from public.projects where id = d.project_id;
    if pr.status = 'closed' then raise exception 'المشروع مقفل؛ أعد فتحه أولًا / Project is closed'; end if;
    if pr.contract_holder = 'partner' then v_vat := 'partner_vat'; v_vat_party := pr.holder_partner_id; end if;
  end if;
  if abs(d.net_amount + d.vat_amount - d.total_amount) > c.total_tolerance then
    raise exception 'الصافي + الضريبة (%) لا يساوي الإجمالي المقروء (%) / Totals do not match',
      d.net_amount + d.vat_amount, d.total_amount;
  end if;
  if p_eligibility = 'pending' then
    raise exception 'حدد أهلية ضريبة المدخلات قبل الاعتماد / Decide input VAT eligibility first';
  end if;
  v_elig := case p_eligibility when 'full' then d.vat_amount when 'none' then 0
                               else round(coalesce(p_eligible_vat,-1),2) end;
  if v_elig < 0 or v_elig > d.vat_amount then raise exception 'Invalid eligible VAT amount'; end if;

  v_exp := coalesce(d.expense_account_id,
                    public.acct(d.company_id, case when d.project_id is null then 'general_expense' else 'direct_cost' end));
  v_entry := public.post_journal(d.company_id, d.issue_date, 'purchase_document', d.id,
    'فاتورة مورد ' || d.doc_number,
    jsonb_build_array(
      jsonb_build_object('account', v_exp::text, 'debit', d.total_amount - v_elig, 'project', d.project_id, 'party', d.supplier_id),
      jsonb_build_object('account', v_vat, 'debit', v_elig, 'project', d.project_id, 'party', v_vat_party),
      jsonb_build_object('account','payables','credit', d.total_amount, 'project', d.project_id, 'party', d.supplier_id)));

  perform set_config('hisabat.posting','on',true);
  update public.purchase_documents set vat_eligibility = p_eligibility, eligible_vat = v_elig,
    status='posted', approved_by=auth.uid(), posted_at=now(), journal_entry_id=v_entry where id = p_doc;
  perform set_config('hisabat.posting','off',true);
  return v_entry;
end $$;

-- ---------------------------------------------------------------------
-- 7. Money movements with the contract-holding partner
--    to_company       : partner transfers project money to the company
--    to_partner       : company sends money back to the partner
--    partner_paid_vat : partner paid this project's VAT to ZATCA from the money it holds
-- ---------------------------------------------------------------------
create or replace function public.record_partner_transfer(p_company uuid, p_project uuid, p_date date,
  p_amount numeric, p_direction text, p_bank_account uuid default null, p_reference text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare pr public.projects; v uuid; v_entry uuid; v_amt numeric(18,2) := round(p_amount,2); v_lines jsonb;
begin
  perform public.require_role(p_company, array['admin','reviewer']::public.app_role[]);
  select * into pr from public.projects where id = p_project and company_id = p_company;
  if not found or pr.contract_holder <> 'partner' then
    raise exception 'المشروع ليس باسم شريك / Project is not held by a partner';
  end if;
  if v_amt <= 0 then raise exception 'Amount must be positive'; end if;
  if p_direction in ('to_company','to_partner') and not exists
     (select 1 from public.accounts where id = p_bank_account and company_id = p_company and is_bank) then
    raise exception 'حساب بنك أو صندوق غير صالح / Invalid bank account';
  end if;

  insert into public.partner_transfers(company_id, project_id, partner_id, transfer_date, direction, amount,
    bank_account_id, reference, created_by)
  values (p_company, p_project, pr.holder_partner_id, p_date, p_direction, v_amt,
    case when p_direction = 'partner_paid_vat' then null else p_bank_account end, p_reference, auth.uid())
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
    end;
  if v_lines is null then raise exception 'Invalid direction'; end if;
  v_entry := public.post_journal(p_company, p_date, 'partner_transfer', v,
    case p_direction when 'to_company' then 'تحويل من الشريك ' when 'to_partner' then 'تحويل للشريك '
                     else 'ضريبة سددها الشريك ' end || pr.code, v_lines);
  update public.partner_transfers set journal_entry_id = v_entry where id = v;
  return v;
end $$;

-- ---------------------------------------------------------------------
-- 8. Closing a project: profit share at close
-- ---------------------------------------------------------------------
create or replace function public.project_close_figures(p_project uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare pr public.projects; ag public.partner_agreements;
  v_rev numeric(18,2); v_cost numeric(18,2); v_profit numeric(18,2); v_share numeric(18,2);
  v_held numeric(18,2); v_vat numeric(18,2); v_pending int;
begin
  select * into pr from public.projects where id = p_project;
  if not found or not public.is_member(pr.company_id) then raise exception 'Permission denied'; end if;
  select * into ag from public.partner_agreements where project_id = p_project and effective_to is null
   order by effective_from desc limit 1;

  select coalesce(sum(l.credit - l.debit) filter (where a.type = 'revenue'), 0),
         coalesce(sum(l.debit - l.credit) filter (where a.type = 'expense' and a.system_key is distinct from 'partner_share_cost'), 0),
         coalesce(sum(l.debit - l.credit) filter (where a.system_key = 'partner_held_cash'), 0),
         coalesce(sum(l.credit - l.debit) filter (where a.system_key = 'partner_vat'), 0)
    into v_rev, v_cost, v_held, v_vat
    from public.journal_lines l join public.accounts a on a.id = l.account_id
   where l.project_id = p_project
     and (pr.close_entry_id is null or l.entry_id <> pr.close_entry_id);   -- figures before the close entry
  v_profit := v_rev - v_cost;
  v_share  := case when ag.id is not null and ag.basis = 'profit_at_close'
                   then round(greatest(v_profit, 0) * ag.share_pct, 2) else 0 end;
  select count(*) into v_pending from public.sales_documents
   where project_id = p_project and status in ('submitted','draft','needs_info');

  return jsonb_build_object(
    'revenue', v_rev, 'costs', v_cost, 'profit', v_profit,
    'basis', ag.basis, 'share_pct', ag.share_pct, 'share', v_share, 'partner_id', ag.partner_id,
    'held_by_partner', v_held, 'partner_vat', v_vat,
    'settlement_to_company', case when pr.contract_holder = 'partner' then v_held - v_vat - v_share else null end,
    'pending_documents', v_pending, 'closed', pr.status = 'closed', 'closed_at', pr.closed_at);
end $$;

create or replace function public.close_project(p_project uuid, p_date date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare pr public.projects; f jsonb; v_entry uuid; v_share numeric(18,2); v_partner uuid;
begin
  select * into pr from public.projects where id = p_project for update;
  if not found then raise exception 'Project not found'; end if;
  perform public.require_role(pr.company_id, array['admin','reviewer']::public.app_role[]);
  if pr.status = 'closed' then raise exception 'المشروع مقفل بالفعل / Project already closed'; end if;
  perform pg_advisory_xact_lock(hashtext(p_project::text));
  f := public.project_close_figures(p_project);
  if (f->>'pending_documents')::int > 0 then
    raise exception 'يوجد % مستند مبيعات غير معتمد على المشروع؛ اعتمده أو احذفه أولًا / Unposted sales documents exist',
      f->>'pending_documents';
  end if;

  v_share := (f->>'share')::numeric;
  v_partner := nullif(f->>'partner_id','')::uuid;
  if v_share > 0 then
    -- partner keeps its share out of the project money it holds; otherwise it becomes payable
    v_entry := public.post_journal(pr.company_id, p_date, 'project_close', p_project,
      'إقفال المشروع وحصة الشريك من الربح ' || pr.code,
      jsonb_build_array(
        jsonb_build_object('account','partner_share_cost','debit',v_share,'project',p_project,'party',v_partner),
        jsonb_build_object('account', case when pr.contract_holder = 'partner' then 'partner_held_cash' else 'partner_payable' end,
                           'credit',v_share,'project',p_project,'party',v_partner)));
  end if;

  update public.projects set status = 'closed', closed_at = p_date, close_entry_id = v_entry,
    close_revenue = (f->>'revenue')::numeric, close_costs = (f->>'costs')::numeric,
    close_profit = (f->>'profit')::numeric, close_share = v_share
  where id = p_project;
  return f;
end $$;

create or replace function public.reopen_project(p_project uuid, p_date date)
returns void language plpgsql security definer set search_path = public as $$
declare pr public.projects; v_lines jsonb;
begin
  select * into pr from public.projects where id = p_project for update;
  if not found then raise exception 'Project not found'; end if;
  perform public.require_role(pr.company_id, array['admin']::public.app_role[]);
  if pr.status <> 'closed' then raise exception 'المشروع غير مقفل / Project is not closed'; end if;
  if pr.close_entry_id is not null then
    select jsonb_agg(jsonb_build_object('account', account_id::text, 'debit', credit, 'credit', debit,
                                        'project', project_id, 'party', party_id))
      into v_lines from public.journal_lines where entry_id = pr.close_entry_id;
    perform public.post_journal(pr.company_id, p_date, 'project_reopen', p_project,
      'إعادة فتح المشروع وعكس حصة الإقفال ' || pr.code, v_lines);
  end if;
  update public.projects set status = 'active', closed_at = null, close_entry_id = null,
    close_revenue = null, close_costs = null, close_profit = null, close_share = null
  where id = p_project;
end $$;

-- ---------------------------------------------------------------------
-- 9. Partner current account per project
-- ---------------------------------------------------------------------
create or replace view public.v_partner_project_accounts with (security_invoker = on) as
select p.id as project_id, p.company_id, p.code, p.name_ar, p.name_en, p.holder_partner_id as partner_id, p.status,
  coalesce((select sum(ra.amount) from public.receipt_allocations ra
              join public.sales_documents sd on sd.id = ra.sales_document_id
              join public.receipts r on r.id = ra.receipt_id
             where sd.project_id = p.id and r.held_by_partner is not null), 0)                         as collected_by_partner,
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

-- company VAT by month must exclude partner-issued invoices (2350 is not the company's VAT)
-- (v_vat_by_month already filters on vat_output / vat_input only — nothing to change)

-- ---------------------------------------------------------------------
-- 10. Permissions
-- ---------------------------------------------------------------------
revoke execute on function public.record_receipt(uuid,uuid,date,numeric,uuid,text,text,uuid) from public, anon;
revoke execute on function public.record_receipt_with_allocations(uuid,uuid,date,numeric,uuid,text,text,jsonb,uuid) from public, anon;
revoke execute on function public.record_partner_transfer(uuid,uuid,date,numeric,text,uuid,text) from public, anon;
revoke execute on function public.project_close_figures(uuid) from public, anon;
revoke execute on function public.close_project(uuid,date) from public, anon;
revoke execute on function public.reopen_project(uuid,date) from public, anon;
grant execute on function
  public.record_receipt(uuid,uuid,date,numeric,uuid,text,text,uuid),
  public.record_receipt_with_allocations(uuid,uuid,date,numeric,uuid,text,text,jsonb,uuid),
  public.record_partner_transfer(uuid,uuid,date,numeric,text,uuid,text),
  public.project_close_figures(uuid), public.close_project(uuid,date), public.reopen_project(uuid,date)
to authenticated;

-- refresh the API's view of the database
notify pgrst, 'reload schema';
