-- =====================================================================
-- Hisabat — expenses (posted directly) and custody (عهد) with two fixed approvers.
-- Run once, AFTER 008_roles.sql.
--
--  Expenses   : roles admin / reviewer / expense post immediately. Details are required,
--               a photo is optional. Paid from a bank/cash account, on credit, or from a custody.
--  Custody    : any employee requests → approver 1 → approver 2 (fixed per company).
--               Final approval disburses from a bank/cash account: the amount is an ASSET
--               on the employee (1400), not an expense.
--  Settlement : an expense employee opens the custody → adds invoices (each becomes an expense
--               paid from the custody) → optional cash returned → closes at zero balance.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Schema
-- ---------------------------------------------------------------------
alter table public.companies
  add column if not exists custody_approver_1 uuid references auth.users(id),
  add column if not exists custody_approver_2 uuid references auth.users(id);
alter table public.companies drop constraint if exists companies_approvers_chk;
alter table public.companies add constraint companies_approvers_chk
  check (custody_approver_1 is null or custody_approver_2 is null or custody_approver_1 <> custody_approver_2);

alter table public.purchase_documents
  add column if not exists details text,
  add column if not exists payment_source text check (payment_source in ('credit','account','custody')),
  add column if not exists custody_id uuid;

create table if not exists public.custody_requests (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id) on delete cascade,
  user_id          uuid not null references auth.users(id),
  project_id       uuid references public.projects(id),
  amount           numeric(18,2) not null check (amount > 0),
  purpose          text not null,
  status           text not null default 'pending_1'
                   check (status in ('pending_1','pending_2','open','rejected','settled')),
  approved1_by     uuid references auth.users(id),
  approved1_at     timestamptz,
  approved2_by     uuid references auth.users(id),
  approved2_at     timestamptz,
  rejected_by      uuid references auth.users(id),
  reject_reason    text,
  bank_account_id  uuid references public.accounts(id),
  disbursed_on     date,
  journal_entry_id uuid references public.journal_entries(id),
  settled_at       timestamptz,
  created_at       timestamptz not null default now()
);
create index if not exists custody_requests_company on public.custody_requests(company_id, status);

alter table public.purchase_documents drop constraint if exists purchase_documents_custody_fk;
alter table public.purchase_documents add constraint purchase_documents_custody_fk
  foreign key (custody_id) references public.custody_requests(id);

create table if not exists public.custody_settlements (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references public.companies(id) on delete cascade,
  custody_id           uuid not null references public.custody_requests(id),
  kind                 text not null check (kind in ('invoice','return')),
  purchase_document_id uuid references public.purchase_documents(id),
  amount               numeric(18,2) not null check (amount > 0),
  account_id           uuid references public.accounts(id),
  journal_entry_id     uuid references public.journal_entries(id),
  created_by           uuid references auth.users(id),
  created_at           timestamptz not null default now()
);
create index if not exists custody_settlements_custody on public.custody_settlements(custody_id);

-- custody account
insert into public.accounts(company_id, code, name_ar, name_en, type, system_key)
select c.id, '1400', 'العهد', 'Employee custody', 'asset', 'custody'
  from public.companies c
 where not exists (select 1 from public.accounts a where a.company_id = c.id and a.system_key = 'custody');

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

-- ---------------------------------------------------------------------
-- 2. Visibility: limited roles see only what they created
-- ---------------------------------------------------------------------
drop policy if exists purchase_documents_read on public.purchase_documents;
create policy purchase_documents_read on public.purchase_documents for select to authenticated
  using (public.is_member(company_id)
         and (public.my_role(company_id) in ('admin','reviewer') or created_by = auth.uid()));
drop policy if exists sales_documents_read on public.sales_documents;
create policy sales_documents_read on public.sales_documents for select to authenticated
  using (public.is_member(company_id)
         and (public.my_role(company_id) in ('admin','reviewer') or created_by = auth.uid()));

alter table public.custody_requests enable row level security;
alter table public.custody_settlements enable row level security;
drop policy if exists custody_requests_read on public.custody_requests;
create policy custody_requests_read on public.custody_requests for select to authenticated
  using (public.is_member(company_id) and (
    public.my_role(company_id) in ('admin','reviewer','expense') or user_id = auth.uid()
    or auth.uid() in (select custody_approver_1 from public.companies where id = company_id
                      union select custody_approver_2 from public.companies where id = company_id)));
drop policy if exists custody_settlements_read on public.custody_settlements;
create policy custody_settlements_read on public.custody_settlements for select to authenticated
  using (public.is_member(company_id) and (
    public.my_role(company_id) in ('admin','reviewer','expense')
    or exists (select 1 from public.custody_requests c where c.id = custody_id and c.user_id = auth.uid())));

do $$ declare t text; begin
  foreach t in array array['custody_requests','custody_settlements'] loop
    execute format('drop trigger if exists %I on public.%I', t||'_audit', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.trg_audit()', t||'_audit', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 3. Purchase posting, shared by reviewer approval and direct expenses
-- ---------------------------------------------------------------------
create or replace function public.post_purchase_internal(p_doc uuid, p_eligibility public.vat_eligibility,
  p_eligible_vat numeric default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare d public.purchase_documents; c public.companies; pr public.projects;
  v_elig numeric(18,2); v_entry uuid; v_exp uuid; v_vat text := 'vat_input'; v_vat_party uuid;
begin
  select * into d from public.purchase_documents where id = p_doc for update;
  select * into c from public.companies where id = d.company_id;
  if d.project_id is not null then
    select * into pr from public.projects where id = d.project_id;
    if pr.status = 'closed' then raise exception 'المشروع مقفل؛ أعد فتحه أولًا / Project is closed'; end if;
    if pr.contract_holder = 'partner' then v_vat := 'partner_vat'; v_vat_party := pr.holder_partner_id; end if;
  end if;
  if abs(d.net_amount + d.vat_amount - d.total_amount) > c.total_tolerance then
    raise exception 'الصافي + الضريبة (%) لا يساوي الإجمالي (%) / Totals do not match',
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

create or replace function public.approve_purchase_document(p_doc uuid, p_eligibility public.vat_eligibility,
  p_eligible_vat numeric default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare d public.purchase_documents; c public.companies;
begin
  select * into d from public.purchase_documents where id = p_doc;
  if not found then raise exception 'Document not found'; end if;
  perform public.require_role(d.company_id, array['admin','reviewer']::public.app_role[]);
  select * into c from public.companies where id = d.company_id;
  if d.status <> 'submitted' then raise exception 'Document must be submitted first'; end if;
  if c.require_separate_approver and d.created_by = auth.uid() then raise exception 'Separate approver required'; end if;
  return public.post_purchase_internal(p_doc, p_eligibility, p_eligible_vat);
end $$;

-- custody balance = disbursed − invoices settled − cash returned
create or replace function public.custody_balance(p_custody uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select case when c.status in ('open','settled') then c.amount else 0 end
         - coalesce((select sum(s.amount) from public.custody_settlements s where s.custody_id = c.id), 0)
    from public.custody_requests c where c.id = p_custody
$$;

-- pays a posted purchase from a bank/cash account or from a custody
create or replace function public.pay_purchase_internal(p_doc uuid, p_date date, p_amount numeric,
  p_account uuid, p_custody uuid, p_reference text)
returns uuid language plpgsql security definer set search_path = public as $$
declare d public.purchase_documents; v uuid; v_entry uuid; v_amt numeric(18,2) := round(p_amount,2);
  v_left numeric; v_credit uuid; cu public.custody_requests;
begin
  select * into d from public.purchase_documents where id = p_doc and status = 'posted';
  if not found then raise exception 'Purchase document not found or not posted'; end if;
  select d.total_amount - coalesce(sum(amount),0) into v_left from public.supplier_payments where purchase_document_id = d.id;
  if v_amt <= 0 or v_amt > v_left then raise exception 'المبلغ أكبر من رصيد الفاتورة % / Exceeds invoice balance', v_left; end if;

  if p_custody is not null then
    select * into cu from public.custody_requests where id = p_custody and company_id = d.company_id for update;
    if not found or cu.status <> 'open' then raise exception 'العهدة غير مفتوحة / Custody is not open'; end if;
    if v_amt > public.custody_balance(p_custody) then
      raise exception 'الفاتورة % أكبر من رصيد العهدة % / Exceeds custody balance', v_amt, public.custody_balance(p_custody);
    end if;
    v_credit := public.acct(d.company_id, 'custody');
  else
    if not exists (select 1 from public.accounts where id = p_account and company_id = d.company_id and is_bank) then
      raise exception 'حساب بنك أو صندوق غير صالح / Invalid bank or cash account';
    end if;
    v_credit := p_account;
  end if;

  insert into public.supplier_payments(company_id, supplier_id, purchase_document_id, pay_date, amount, bank_account_id, reference, created_by)
  values (d.company_id, d.supplier_id, d.id, p_date, v_amt, v_credit, p_reference, auth.uid()) returning id into v;
  v_entry := public.post_journal(d.company_id, p_date, 'supplier_payment', v,
    case when p_custody is not null then 'سداد من العهدة ' else 'سداد مورد ' end || d.doc_number,
    jsonb_build_array(
      jsonb_build_object('account','payables','debit',v_amt,'project',d.project_id,'party',d.supplier_id),
      jsonb_build_object('account', v_credit::text,'credit',v_amt,'project',
        case when p_custody is not null then coalesce(cu.project_id, d.project_id) else d.project_id end)));
  update public.supplier_payments set journal_entry_id = v_entry where id = v;

  if p_custody is not null then
    insert into public.custody_settlements(company_id, custody_id, kind, purchase_document_id, amount, journal_entry_id, created_by)
    values (d.company_id, p_custody, 'invoice', d.id, v_amt, v_entry, auth.uid());
    if public.custody_balance(p_custody) = 0 then
      update public.custody_requests set status = 'settled', settled_at = now() where id = p_custody;
    end if;
  end if;
  return v;
end $$;

-- ---------------------------------------------------------------------
-- 4. Direct expense (no review)
--  p = { project_id, supplier_id | supplier_name, supplier_vat, doc_number, issue_date,
--        net_amount, vat_amount, total_amount, details, kind: direct|general,
--        payment: credit|account|custody, account_id, custody_id, attachment_path, file_hash }
-- ---------------------------------------------------------------------
create or replace function public.post_expense(p_company uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_supp uuid; v_vatno text; v_doc uuid; v_elig public.vat_eligibility; v_pay text; v_proj uuid;
  v_net numeric(18,2); v_vat numeric(18,2); v_total numeric(18,2); v_date date; v_num text; v_exp uuid;
  cu public.custody_requests;
begin
  perform public.require_role(p_company, array['admin','reviewer','expense']::public.app_role[]);
  if coalesce(trim(p->>'details'),'') = '' then
    raise exception 'تفاصيل المصروف مطلوبة / Expense details are required';
  end if;
  v_net   := coalesce(nullif(p->>'net_amount','')::numeric, 0);
  v_vat   := coalesce(nullif(p->>'vat_amount','')::numeric, 0);
  v_total := coalesce(nullif(p->>'total_amount','')::numeric, v_net + v_vat);
  if v_total <= 0 then raise exception 'المبلغ يجب أن يكون أكبر من صفر / Amount must be greater than zero'; end if;
  v_date  := coalesce(nullif(p->>'issue_date','')::date, current_date);
  v_pay   := coalesce(nullif(p->>'payment',''), 'account');
  v_proj  := nullif(p->>'project_id','')::uuid;
  if v_proj is not null and not exists (select 1 from public.projects where id = v_proj and company_id = p_company) then
    raise exception 'Invalid project';
  end if;

  -- custody: project defaults to the custody's project
  if v_pay = 'custody' then
    select * into cu from public.custody_requests where id = nullif(p->>'custody_id','')::uuid and company_id = p_company;
    if not found or cu.status <> 'open' then raise exception 'العهدة غير مفتوحة / Custody is not open'; end if;
    v_proj := coalesce(v_proj, cu.project_id);
  end if;

  -- supplier: existing, or found by VAT number / name, or created
  v_vatno := nullif(regexp_replace(coalesce(p->>'supplier_vat',''), '\D', '', 'g'), '');
  if nullif(p->>'supplier_id','') is not null then
    select id into v_supp from public.parties where id = (p->>'supplier_id')::uuid and company_id = p_company and kind = 'supplier';
  end if;
  if v_supp is null and v_vatno is not null then
    select id into v_supp from public.parties where company_id = p_company and kind = 'supplier' and vat_number = v_vatno;
  end if;
  if v_supp is null and coalesce(trim(p->>'supplier_name'),'') <> '' then
    select id into v_supp from public.parties where company_id = p_company and kind = 'supplier'
       and lower(name_ar) = lower(trim(p->>'supplier_name')) limit 1;
    if v_supp is null then
      insert into public.parties(company_id, kind, name_ar, vat_number)
      values (p_company, 'supplier', trim(p->>'supplier_name'), v_vatno) returning id into v_supp;
    end if;
  end if;
  if v_supp is null then raise exception 'اسم المورد مطلوب / Supplier name is required'; end if;
  if v_vatno is not null then
    update public.parties set vat_number = v_vatno where id = v_supp and vat_number is null;
  end if;

  -- input VAT is deductible only with a valid supplier VAT number (15 digits, starts and ends with 3)
  select vat_number into v_vatno from public.parties where id = v_supp;
  v_elig := case when v_vat > 0 and coalesce(v_vatno,'') ~ '^3[0-9]{13}3$' then 'full' else 'none' end;

  v_num := coalesce(nullif(trim(p->>'doc_number'),''), 'NA-' || to_char(v_date,'YYYYMMDD') || '-' || substr(gen_random_uuid()::text,1,6));
  v_exp := public.acct(p_company, case when coalesce(p->>'kind','direct') = 'general' or v_proj is null
                                       then 'general_expense' else 'direct_cost' end);
  begin
    insert into public.purchase_documents(company_id, project_id, supplier_id, doc_number, issue_date,
      net_amount, vat_amount, total_amount, expense_account_id, details, notes, payment_source, custody_id,
      attachment_path, file_hash, extraction_source, created_by)
    values (p_company, v_proj, v_supp, v_num, v_date, v_net, v_vat, v_total, v_exp,
      trim(p->>'details'), trim(p->>'details'), v_pay, case when v_pay = 'custody' then cu.id end,
      nullif(p->>'attachment_path',''), nullif(p->>'file_hash',''), 'manual', auth.uid())
    returning id into v_doc;
  exception when unique_violation then
    raise exception 'فاتورة المورد % مسجلة من قبل / This supplier invoice is already recorded', v_num;
  end;

  perform set_config('hisabat.posting','on',true);
  update public.purchase_documents set status = 'submitted', submitted_at = now() where id = v_doc;
  perform set_config('hisabat.posting','off',true);
  perform public.post_purchase_internal(v_doc, v_elig, null);

  if v_pay = 'account' then
    perform public.pay_purchase_internal(v_doc, v_date, v_total, nullif(p->>'account_id','')::uuid, null, null);
  elsif v_pay = 'custody' then
    perform public.pay_purchase_internal(v_doc, v_date, v_total, null, cu.id, null);
  end if;   -- 'credit': stays payable to the supplier
  return v_doc;
end $$;

-- pay a credit expense later
create or replace function public.pay_purchase(p_doc uuid, p_date date, p_amount numeric, p_account uuid, p_reference text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_company uuid;
begin
  select company_id into v_company from public.purchase_documents where id = p_doc;
  perform public.require_role(v_company, array['admin','reviewer']::public.app_role[]);
  return public.pay_purchase_internal(p_doc, p_date, p_amount, p_account, null, p_reference);
end $$;

-- ---------------------------------------------------------------------
-- 5. Custody workflow
-- ---------------------------------------------------------------------
create or replace function public.request_custody(p_company uuid, p_amount numeric, p_purpose text, p_project uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare c public.companies; v uuid;
begin
  if not public.is_member(p_company) then raise exception 'Permission denied'; end if;
  select * into c from public.companies where id = p_company;
  if c.custody_approver_1 is null or c.custody_approver_2 is null then
    raise exception 'لم يحدد الأدمن مديري اعتماد العهد بعد (الإعدادات) / Custody approvers are not set';
  end if;
  if coalesce(trim(p_purpose),'') = '' then raise exception 'الغرض من العهدة مطلوب / Purpose is required'; end if;
  if round(p_amount,2) <= 0 then raise exception 'المبلغ يجب أن يكون أكبر من صفر / Amount must be greater than zero'; end if;
  if p_project is not null and not exists (select 1 from public.projects where id = p_project and company_id = p_company) then
    raise exception 'Invalid project';
  end if;
  insert into public.custody_requests(company_id, user_id, project_id, amount, purpose)
  values (p_company, auth.uid(), p_project, round(p_amount,2), trim(p_purpose)) returning id into v;
  return v;
end $$;

-- approver 1 moves it to stage 2; approver 2 approves AND disburses from p_account
create or replace function public.approve_custody(p_custody uuid, p_account uuid default null, p_date date default current_date)
returns text language plpgsql security definer set search_path = public as $$
declare cu public.custody_requests; c public.companies; v_entry uuid;
begin
  select * into cu from public.custody_requests where id = p_custody for update;
  if not found then raise exception 'Custody not found'; end if;
  select * into c from public.companies where id = cu.company_id;
  if cu.status = 'pending_1' then
    if auth.uid() is distinct from c.custody_approver_1 then
      raise exception 'الموافقة الأولى للمدير الأول فقط / Only approver 1 can give the first approval';
    end if;
    update public.custody_requests set status = 'pending_2', approved1_by = auth.uid(), approved1_at = now() where id = p_custody;
    return 'pending_2';
  elsif cu.status = 'pending_2' then
    if auth.uid() is distinct from c.custody_approver_2 then
      raise exception 'الموافقة الثانية للمدير الثاني فقط / Only approver 2 can give the final approval';
    end if;
    if not exists (select 1 from public.accounts where id = p_account and company_id = cu.company_id and is_bank) then
      raise exception 'اختر حساب البنك أو الصندوق الذي ستصرف منه العهدة / Choose the account to pay from';
    end if;
    v_entry := public.post_journal(cu.company_id, p_date, 'custody_disbursement', cu.id,
      'صرف عهدة: ' || cu.purpose,
      jsonb_build_array(
        jsonb_build_object('account','custody','debit',cu.amount,'project',cu.project_id),
        jsonb_build_object('account',p_account::text,'credit',cu.amount,'project',cu.project_id)));
    update public.custody_requests set status = 'open', approved2_by = auth.uid(), approved2_at = now(),
      bank_account_id = p_account, disbursed_on = p_date, journal_entry_id = v_entry where id = p_custody;
    return 'open';
  end if;
  raise exception 'الطلب ليس بانتظار موافقة / Request is not awaiting approval';
end $$;

create or replace function public.reject_custody(p_custody uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare cu public.custody_requests; c public.companies;
begin
  select * into cu from public.custody_requests where id = p_custody for update;
  if not found then raise exception 'Custody not found'; end if;
  select * into c from public.companies where id = cu.company_id;
  if not ((cu.status = 'pending_1' and auth.uid() = c.custody_approver_1)
       or (cu.status = 'pending_2' and auth.uid() = c.custody_approver_2)) then
    raise exception 'لا تملك رفض هذا الطلب الآن / You cannot reject this request now';
  end if;
  if coalesce(trim(p_reason),'') = '' then raise exception 'السبب مطلوب / Reason is required'; end if;
  update public.custody_requests set status = 'rejected', rejected_by = auth.uid(), reject_reason = trim(p_reason)
   where id = p_custody;
end $$;

-- settlement by an expense employee: invoices (each a full expense payload) + optional cash returned
create or replace function public.settle_custody(p_custody uuid, p_invoices jsonb,
  p_return_amount numeric default 0, p_return_account uuid default null, p_date date default current_date)
returns numeric language plpgsql security definer set search_path = public as $$
declare cu public.custody_requests; inv jsonb; v_entry uuid; v_ret numeric(18,2) := round(coalesce(p_return_amount,0),2);
begin
  select * into cu from public.custody_requests where id = p_custody for update;
  if not found then raise exception 'Custody not found'; end if;
  perform public.require_role(cu.company_id, array['admin','reviewer','expense']::public.app_role[]);
  if cu.status <> 'open' then raise exception 'العهدة غير مفتوحة / Custody is not open'; end if;
  if jsonb_array_length(coalesce(p_invoices,'[]'::jsonb)) = 0 and v_ret = 0 then
    raise exception 'أضف فاتورة واحدة على الأقل أو مبلغًا مرتجعًا / Add at least one invoice or a returned amount';
  end if;

  for inv in select * from jsonb_array_elements(coalesce(p_invoices,'[]'::jsonb)) loop
    perform public.post_expense(cu.company_id,
      inv || jsonb_build_object('payment','custody','custody_id',cu.id,
                                'issue_date', coalesce(nullif(inv->>'issue_date',''), p_date::text)));
  end loop;

  if v_ret > 0 then
    if v_ret > public.custody_balance(p_custody) then
      raise exception 'المبلغ المرتجع % أكبر من رصيد العهدة % / Return exceeds custody balance', v_ret, public.custody_balance(p_custody);
    end if;
    if not exists (select 1 from public.accounts where id = p_return_account and company_id = cu.company_id and is_bank) then
      raise exception 'اختر الحساب الذي استلم المبلغ المرتجع / Choose the account that received the cash';
    end if;
    v_entry := public.post_journal(cu.company_id, p_date, 'custody_return', cu.id, 'رد نقدية عهدة: ' || cu.purpose,
      jsonb_build_array(
        jsonb_build_object('account',p_return_account::text,'debit',v_ret,'project',cu.project_id),
        jsonb_build_object('account','custody','credit',v_ret,'project',cu.project_id)));
    insert into public.custody_settlements(company_id, custody_id, kind, amount, account_id, journal_entry_id, created_by)
    values (cu.company_id, cu.id, 'return', v_ret, p_return_account, v_entry, auth.uid());
  end if;

  if public.custody_balance(p_custody) = 0 then
    update public.custody_requests set status = 'settled', settled_at = now() where id = p_custody and status = 'open';
  end if;
  return public.custody_balance(p_custody);
end $$;

-- ---------------------------------------------------------------------
-- 6. Views
-- ---------------------------------------------------------------------
create or replace view public.v_custody with (security_invoker = on) as
select c.id, c.company_id, c.user_id, coalesce(pf.full_name, '') as holder_name, c.project_id, c.amount, c.purpose,
       c.status, c.created_at, c.approved1_at, c.approved2_at, c.disbursed_on, c.reject_reason, c.settled_at,
       coalesce((select sum(s.amount) from public.custody_settlements s where s.custody_id = c.id and s.kind = 'invoice'), 0) as invoices,
       coalesce((select sum(s.amount) from public.custody_settlements s where s.custody_id = c.id and s.kind = 'return'), 0)  as returned,
       public.custody_balance(c.id) as balance
  from public.custody_requests c
  left join public.profiles pf on pf.id = c.user_id;

create or replace view public.v_purchase_balances with (security_invoker = on) as
select d.id, d.company_id, d.total_amount,
       coalesce((select sum(p.amount) from public.supplier_payments p where p.purchase_document_id = d.id), 0) as paid,
       d.total_amount - coalesce((select sum(p.amount) from public.supplier_payments p where p.purchase_document_id = d.id), 0) as balance
  from public.purchase_documents d;

-- ---------------------------------------------------------------------
-- 7. Permissions
-- ---------------------------------------------------------------------
revoke execute on function public.post_purchase_internal(uuid,public.vat_eligibility,numeric) from public, anon, authenticated;
revoke execute on function public.pay_purchase_internal(uuid,date,numeric,uuid,uuid,text) from public, anon, authenticated;
revoke execute on function public.post_expense(uuid,jsonb) from public, anon;
revoke execute on function public.pay_purchase(uuid,date,numeric,uuid,text) from public, anon;
revoke execute on function public.request_custody(uuid,numeric,text,uuid) from public, anon;
revoke execute on function public.approve_custody(uuid,uuid,date) from public, anon;
revoke execute on function public.reject_custody(uuid,text) from public, anon;
revoke execute on function public.settle_custody(uuid,jsonb,numeric,uuid,date) from public, anon;
revoke execute on function public.custody_balance(uuid) from public, anon;
grant execute on function
  public.post_expense(uuid,jsonb), public.pay_purchase(uuid,date,numeric,uuid,text),
  public.request_custody(uuid,numeric,text,uuid), public.approve_custody(uuid,uuid,date),
  public.reject_custody(uuid,text), public.settle_custody(uuid,jsonb,numeric,uuid,date),
  public.custody_balance(uuid)
to authenticated;

-- ---------------------------------------------------------------------
-- 8. User management for the admin
-- ---------------------------------------------------------------------
create or replace function public.set_member(p_company uuid, p_user uuid, p_role public.app_role, p_active boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.require_role(p_company, array['admin']::public.app_role[]);
  if p_user = auth.uid() then raise exception 'لا يمكنك تغيير دورك بنفسك / You cannot change your own role'; end if;
  update public.memberships set role = p_role, is_active = p_active where company_id = p_company and user_id = p_user;
  if not found then raise exception 'User is not a member'; end if;
end $$;
revoke execute on function public.set_member(uuid,uuid,public.app_role,boolean) from public, anon;
grant execute on function public.set_member(uuid,uuid,public.app_role,boolean) to authenticated;

-- refresh the API's view of the database
notify pgrst, 'reload schema';
