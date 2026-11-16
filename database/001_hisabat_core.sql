-- =====================================================================
-- Hisabat Portal — core database (Release 1)
-- Run once in Supabase → SQL Editor on a NEW, EMPTY project.
-- Money: numeric(18,2). Percentages: numeric(7,4) as fractions (0.10 = 10%).
-- Every posting runs inside SECURITY DEFINER functions; tables are
-- read-only to users except drafts, protected by Row Level Security.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 1. Types
-- ---------------------------------------------------------------------
create type public.app_role           as enum ('admin','reviewer','entry');
create type public.party_kind         as enum ('customer','supplier','partner','subcontractor');
create type public.doc_status         as enum ('draft','submitted','needs_info','rejected','posted');
create type public.sales_doc_type     as enum ('advance','progress_claim','retention_release','other');
create type public.retention_vat_mode as enum ('A','B');   -- A = VAT before retention (adopted), B = VAT after retention
create type public.vat_eligibility    as enum ('full','partial','none','pending');
create type public.account_type       as enum ('asset','liability','equity','revenue','expense');

-- ---------------------------------------------------------------------
-- 2. Identity & company
-- ---------------------------------------------------------------------
create table public.companies (
  id                        uuid primary key default gen_random_uuid(),
  name_ar                   text not null,
  name_en                   text,
  vat_number                text,
  cr_number                 text,
  base_currency             text not null default 'SAR',
  vat_rate                  numeric(5,4) not null default 0.15 check (vat_rate >= 0 and vat_rate < 1),
  total_tolerance           numeric(18,2) not null default 0.05 check (total_tolerance >= 0),
  require_separate_approver boolean not null default false,
  created_at                timestamptz not null default now()
);

create table public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  full_name  text,
  language   text not null default 'ar' check (language in ('ar','en')),
  created_at timestamptz not null default now()
);

create table public.memberships (
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       public.app_role not null,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (company_id, user_id)
);
create index on public.memberships(user_id);

-- ---------------------------------------------------------------------
-- 3. Chart of accounts
-- ---------------------------------------------------------------------
create table public.accounts (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  code       text not null,
  name_ar    text not null,
  name_en    text,
  type       public.account_type not null,
  system_key text,                       -- used by the posting engine
  is_bank    boolean not null default false,   -- bank / cash / custody accounts
  is_active  boolean not null default true,
  unique (company_id, code),
  unique (company_id, system_key)
);

-- ---------------------------------------------------------------------
-- 4. Parties & projects
-- ---------------------------------------------------------------------
create table public.parties (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  kind          public.party_kind not null,
  name_ar       text not null,
  name_en       text,
  vat_number    text,
  cr_number     text,
  is_government boolean not null default false,
  phone         text,
  email         text,
  created_at    timestamptz not null default now()
);
create unique index parties_vat_unique on public.parties(company_id, kind, vat_number) where vat_number is not null;

create table public.projects (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id) on delete cascade,
  code                text not null,
  name_ar             text not null,
  name_en             text,
  customer_id         uuid references public.parties(id),
  contract_value      numeric(18,2) not null default 0 check (contract_value >= 0),
  prices_include_vat  boolean not null default false,
  start_date          date,
  end_date            date,
  manager_name        text,
  status              text not null default 'active' check (status in ('active','on_hold','completed','closed')),
  budget              numeric(18,2),
  -- advance payment & retention terms (fixed at creation, editable before first posting)
  advance_pct         numeric(7,4) not null default 0 check (advance_pct between 0 and 1),
  advance_amount      numeric(18,2) not null default 0 check (advance_amount >= 0),
  recovery_pct        numeric(7,4) not null default 0 check (recovery_pct between 0 and 1),
  retention_pct       numeric(7,4) not null default 0 check (retention_pct between 0 and 1),
  retention_cap_pct   numeric(7,4) check (retention_cap_pct is null or retention_cap_pct between 0 and 1),
  retention_vat_mode  public.retention_vat_mode not null default 'A',
  retention_release_terms text,
  created_by          uuid references auth.users(id),
  created_at          timestamptz not null default now(),
  unique (company_id, code)
);

create table public.partner_agreements (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  project_id      uuid not null references public.projects(id) on delete cascade,
  partner_id      uuid not null references public.parties(id),
  share_pct       numeric(7,4) not null check (share_pct > 0 and share_pct <= 1),
  effective_from  date not null,
  effective_to    date,
  attachment_path text,
  notes           text,
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from)
);

create table public.bank_guarantees (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  project_id  uuid not null references public.projects(id) on delete cascade,
  kind        text not null check (kind in ('advance','performance','bid','other')),
  bank_name   text not null,
  amount      numeric(18,2) not null check (amount > 0),
  issue_date  date,
  expiry_date date not null,
  status      text not null default 'active' check (status in ('active','released','expired')),
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 5. Journal (double entry, immutable)
-- ---------------------------------------------------------------------
create table public.fiscal_periods (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  period_start date not null,
  period_end   date not null,
  is_locked    boolean not null default false,
  locked_by    uuid references auth.users(id),
  locked_at    timestamptz,
  unique (company_id, period_start),
  check (period_end >= period_start)
);

create table public.journal_entries (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  entry_date  date not null,
  source_type text not null,
  source_id   uuid,
  memo        text,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now()
);
create index on public.journal_entries(company_id, entry_date);
create index on public.journal_entries(source_type, source_id);

create table public.journal_lines (
  id         uuid primary key default gen_random_uuid(),
  entry_id   uuid not null references public.journal_entries(id) on delete restrict,
  company_id uuid not null references public.companies(id) on delete cascade,
  account_id uuid not null references public.accounts(id),
  project_id uuid references public.projects(id),
  party_id   uuid references public.parties(id),
  debit      numeric(18,2) not null default 0 check (debit  >= 0),
  credit     numeric(18,2) not null default 0 check (credit >= 0),
  check (debit = 0 or credit = 0),
  check (debit > 0 or credit > 0)
);
create index on public.journal_lines(entry_id);
create index on public.journal_lines(company_id, account_id);
create index on public.journal_lines(project_id);

-- ---------------------------------------------------------------------
-- 6. Sales side
-- ---------------------------------------------------------------------
create table public.sales_documents (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies(id) on delete cascade,
  project_id         uuid not null references public.projects(id),
  customer_id        uuid not null references public.parties(id),
  doc_type           public.sales_doc_type not null,
  status             public.doc_status not null default 'draft',
  issuer_ref         text,                 -- invoice number in the issuing (e-invoicing) system
  issue_date         date not null default current_date,
  supply_date        date,
  payment_order_date date,                 -- government contracts: VAT point
  -- input
  work_value         numeric(18,2) not null default 0 check (work_value >= 0),  -- net amount of works / advance / release
  discount           numeric(18,2) not null default 0 check (discount >= 0),    -- commercial discount (reduces VAT base)
  printed_total      numeric(18,2),                                            -- total as printed on the issued invoice
  -- computed (server side)
  advance_recovery   numeric(18,2) not null default 0,
  retention          numeric(18,2) not null default 0,
  vat_base           numeric(18,2) not null default 0,
  vat_rate           numeric(5,4)  not null default 0.15,
  vat_amount         numeric(18,2) not null default 0,
  invoice_total      numeric(18,2) not null default 0,
  collectible_total  numeric(18,2) not null default 0,   -- what the customer should pay for this document
  collectible_net    numeric(18,2) not null default 0,   -- the same, excluding VAT (partner-share base)
  vat_mode           public.retention_vat_mode,
  -- workflow
  notes              text,
  review_reason      text,
  attachment_path    text,
  created_by         uuid references auth.users(id) default auth.uid(),
  created_at         timestamptz not null default now(),
  submitted_at       timestamptz,
  approved_by        uuid references auth.users(id),
  posted_at          timestamptz,
  journal_entry_id   uuid references public.journal_entries(id)
);
create unique index sales_issuer_ref_unique on public.sales_documents(company_id, issuer_ref)
  where issuer_ref is not null and status <> 'rejected';
create index on public.sales_documents(project_id);

create table public.receipts (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id) on delete cascade,
  customer_id      uuid not null references public.parties(id),
  receipt_date     date not null,
  amount           numeric(18,2) not null check (amount > 0),
  bank_account_id  uuid not null references public.accounts(id),
  reference        text,
  notes            text,
  created_by       uuid references auth.users(id),
  created_at       timestamptz not null default now(),
  journal_entry_id uuid references public.journal_entries(id)
);

create table public.receipt_allocations (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id) on delete cascade,
  receipt_id        uuid not null references public.receipts(id),
  sales_document_id uuid not null references public.sales_documents(id),
  amount            numeric(18,2) not null check (amount > 0),
  created_by        uuid references auth.users(id),
  created_at        timestamptz not null default now()
);
create index on public.receipt_allocations(sales_document_id);
create index on public.receipt_allocations(receipt_id);

-- ---------------------------------------------------------------------
-- 7. Partner share
-- ---------------------------------------------------------------------
create table public.partner_entitlements (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id) on delete cascade,
  project_id        uuid not null references public.projects(id),
  partner_id        uuid not null references public.parties(id),
  agreement_id      uuid not null references public.partner_agreements(id),
  allocation_id     uuid not null unique references public.receipt_allocations(id),
  sales_document_id uuid not null references public.sales_documents(id),
  collected_amount  numeric(18,2) not null,
  net_ratio         numeric(12,10) not null,    -- collectible_net / collectible_total at the time
  net_collected     numeric(18,2) not null,
  share_pct         numeric(7,4) not null,
  amount            numeric(18,2) not null,
  journal_entry_id  uuid references public.journal_entries(id),
  created_at        timestamptz not null default now()
);

create table public.partner_settlements (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id) on delete cascade,
  partner_id       uuid not null references public.parties(id),
  project_id       uuid references public.projects(id),
  settle_date      date not null,
  amount           numeric(18,2) not null check (amount > 0),
  bank_account_id  uuid not null references public.accounts(id),
  reference        text,
  created_by       uuid references auth.users(id),
  created_at       timestamptz not null default now(),
  journal_entry_id uuid references public.journal_entries(id)
);

-- ---------------------------------------------------------------------
-- 8. Purchases & expenses
-- ---------------------------------------------------------------------
create table public.purchase_documents (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies(id) on delete cascade,
  project_id         uuid references public.projects(id),          -- null = general expense
  supplier_id        uuid not null references public.parties(id),
  doc_number         text not null,
  issue_date         date not null,
  net_amount         numeric(18,2) not null check (net_amount >= 0),
  vat_amount         numeric(18,2) not null default 0 check (vat_amount >= 0),
  total_amount       numeric(18,2) not null check (total_amount >= 0), -- as read from the document
  vat_eligibility    public.vat_eligibility not null default 'pending',
  eligible_vat       numeric(18,2) not null default 0 check (eligible_vat >= 0),
  expense_account_id uuid references public.accounts(id),
  status             public.doc_status not null default 'draft',
  extraction_source  text not null default 'manual' check (extraction_source in ('manual','ai','import')),
  attachment_path    text,
  file_hash          text,
  notes              text,
  review_reason      text,
  created_by         uuid references auth.users(id) default auth.uid(),
  created_at         timestamptz not null default now(),
  submitted_at       timestamptz,
  approved_by        uuid references auth.users(id),
  posted_at          timestamptz,
  journal_entry_id   uuid references public.journal_entries(id)
);
create unique index purchase_doc_unique on public.purchase_documents(company_id, supplier_id, doc_number)
  where status <> 'rejected';
create unique index purchase_hash_unique on public.purchase_documents(company_id, file_hash)
  where file_hash is not null and status <> 'rejected';

create table public.supplier_payments (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id) on delete cascade,
  supplier_id         uuid not null references public.parties(id),
  purchase_document_id uuid references public.purchase_documents(id),
  pay_date            date not null,
  amount              numeric(18,2) not null check (amount > 0),
  bank_account_id     uuid not null references public.accounts(id),
  reference           text,
  created_by          uuid references auth.users(id),
  created_at          timestamptz not null default now(),
  journal_entry_id    uuid references public.journal_entries(id)
);

-- ---------------------------------------------------------------------
-- 9. Audit log
-- ---------------------------------------------------------------------
create table public.audit_events (
  id         bigserial primary key,
  company_id uuid,
  table_name text not null,
  row_id     uuid,
  action     text not null,
  actor      uuid,
  old_data   jsonb,
  new_data   jsonb,
  at         timestamptz not null default now()
);
create index on public.audit_events(company_id, at desc);

-- =====================================================================
-- 10. Helper functions
-- =====================================================================
create or replace function public.my_role(p_company uuid)
returns public.app_role language sql stable security definer set search_path = public as $$
  select role from public.memberships
   where company_id = p_company and user_id = auth.uid() and is_active
$$;

create or replace function public.is_member(p_company uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.memberships
                  where company_id = p_company and user_id = auth.uid() and is_active)
$$;

create or replace function public.require_role(p_company uuid, p_roles public.app_role[])
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'غير مسجل الدخول / Not authenticated';
  end if;
  if public.my_role(p_company) is null or not (public.my_role(p_company) = any(p_roles)) then
    raise exception 'لا تملك الصلاحية لهذه العملية / Permission denied';
  end if;
end $$;

create or replace function public.acct(p_company uuid, p_key text)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare v uuid;
begin
  select id into v from public.accounts where company_id = p_company and system_key = p_key;
  if v is null then raise exception 'Missing system account %', p_key; end if;
  return v;
end $$;

create or replace function public.assert_period_open(p_company uuid, p_date date)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if exists (select 1 from public.fiscal_periods
              where company_id = p_company and is_locked
                and p_date between period_start and period_end) then
    raise exception 'الفترة المحاسبية مقفلة لهذا التاريخ % / Period is locked', p_date;
  end if;
end $$;

-- Posts a balanced journal entry. p_lines = [{"account": key-or-uuid, "debit": n, "credit": n, "project": uuid, "party": uuid}]
create or replace function public.post_journal(
  p_company uuid, p_date date, p_source_type text, p_source_id uuid, p_memo text, p_lines jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_entry uuid; l jsonb; v_acct uuid; v_dr numeric(18,2); v_cr numeric(18,2);
  t_dr numeric(18,2) := 0; t_cr numeric(18,2) := 0;
begin
  perform public.assert_period_open(p_company, p_date);
  insert into public.journal_entries(company_id, entry_date, source_type, source_id, memo, created_by)
  values (p_company, p_date, p_source_type, p_source_id, p_memo, auth.uid())
  returning id into v_entry;

  for l in select * from jsonb_array_elements(p_lines) loop
    v_dr := round(coalesce((l->>'debit')::numeric, 0), 2);
    v_cr := round(coalesce((l->>'credit')::numeric, 0), 2);
    continue when v_dr = 0 and v_cr = 0;
    if (l->>'account') ~ '^[0-9a-f-]{36}$' then v_acct := (l->>'account')::uuid;
    else v_acct := public.acct(p_company, l->>'account'); end if;
    insert into public.journal_lines(entry_id, company_id, account_id, project_id, party_id, debit, credit)
    values (v_entry, p_company, v_acct, nullif(l->>'project','')::uuid, nullif(l->>'party','')::uuid, v_dr, v_cr);
    t_dr := t_dr + v_dr; t_cr := t_cr + v_cr;
  end loop;

  if t_dr <> t_cr or t_dr = 0 then
    raise exception 'قيد غير متوازن مدين % دائن % / Unbalanced entry', t_dr, t_cr;
  end if;
  return v_entry;
end $$;

-- =====================================================================
-- 11. Integrity triggers
-- =====================================================================
-- journal is append-only
create or replace function public.trg_block_change() returns trigger language plpgsql as $$
begin
  raise exception 'السجلات المرحلة لا تعدل ولا تحذف؛ استخدم قيدًا عكسيًا / Posted records are immutable';
end $$;
create trigger journal_entries_immutable before update or delete on public.journal_entries
  for each row execute function public.trg_block_change();
create trigger journal_lines_immutable before update or delete on public.journal_lines
  for each row execute function public.trg_block_change();
create trigger receipt_alloc_immutable before update or delete on public.receipt_allocations
  for each row execute function public.trg_block_change();
create trigger partner_ent_immutable before update or delete on public.partner_entitlements
  for each row execute function public.trg_block_change();

-- documents: status changes only through workflow functions; posted = frozen
create or replace function public.trg_doc_guard() returns trigger language plpgsql as $$
declare v_fn boolean := coalesce(current_setting('hisabat.posting', true), '') = 'on';
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then raise exception 'يمكن حذف المسودات فقط / Only drafts can be deleted'; end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if new.status <> 'draft' and not v_fn then raise exception 'New documents start as draft'; end if;
    return new;
  end if;
  if old.status = 'posted' and not v_fn then
    raise exception 'مستند مرحل لا يعدل؛ استخدم إشعارًا أو قيدًا عكسيًا / Posted document is locked';
  end if;
  if new.status is distinct from old.status and not v_fn then
    raise exception 'تغيير الحالة يتم من خلال الإجراءات فقط / Use workflow actions to change status';
  end if;
  if old.status in ('submitted') and not v_fn then
    raise exception 'المستند قيد المراجعة / Document is under review';
  end if;
  return new;
end $$;
create trigger sales_doc_guard before insert or update or delete on public.sales_documents
  for each row execute function public.trg_doc_guard();
create trigger purchase_doc_guard before insert or update or delete on public.purchase_documents
  for each row execute function public.trg_doc_guard();

-- project terms frozen once anything is posted on the project
create or replace function public.trg_project_terms_guard() returns trigger language plpgsql as $$
begin
  if (new.advance_amount, new.recovery_pct, new.retention_pct, new.retention_cap_pct, new.retention_vat_mode)
     is distinct from
     (old.advance_amount, old.recovery_pct, old.retention_pct, old.retention_cap_pct, old.retention_vat_mode)
     and exists (select 1 from public.sales_documents where project_id = old.id and status = 'posted') then
    raise exception 'لا يمكن تعديل شروط الدفعة المقدمة والمحتجز بعد ترحيل مستندات على المشروع / Terms locked after posting';
  end if;
  return new;
end $$;
create trigger project_terms_guard before update on public.projects
  for each row execute function public.trg_project_terms_guard();

-- generic audit trail
create or replace function public.trg_audit() returns trigger language plpgsql security definer set search_path = public as $$
declare r jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
begin
  insert into public.audit_events(company_id, table_name, row_id, action, actor, old_data, new_data)
  values ((r->>'company_id')::uuid, tg_table_name, (r->>'id')::uuid, tg_op, auth.uid(),
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return null;
end $$;
do $$ declare t text; begin
  foreach t in array array['parties','projects','partner_agreements','sales_documents','purchase_documents',
                           'receipts','partner_settlements','supplier_payments','bank_guarantees','accounts','fiscal_periods']
  loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.trg_audit()', t||'_audit', t);
  end loop;
end $$;
-- memberships audit (no id column → use user_id)
create or replace function public.trg_audit_membership() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_events(company_id, table_name, row_id, action, actor, old_data, new_data)
  values (coalesce(new.company_id, old.company_id), 'memberships', coalesce(new.user_id, old.user_id), tg_op, auth.uid(),
          case when tg_op <> 'INSERT' then to_jsonb(old) end, case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return null;
end $$;
create trigger memberships_audit after insert or update or delete on public.memberships
  for each row execute function public.trg_audit_membership();

-- profile row for every new auth user
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id, full_name) values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email))
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- =====================================================================
-- 12. Company setup
-- =====================================================================
create or replace function public.seed_accounts(p_company uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.accounts(company_id, code, name_ar, name_en, type, system_key, is_bank) values
   (p_company,'1010','البنك','Bank','asset','bank_main',true),
   (p_company,'1020','الصندوق','Cash','asset','cash_main',true),
   (p_company,'1200','العملاء','Accounts receivable','asset','receivables',false),
   (p_company,'1250','محتجزات لدى العملاء','Retention receivable','asset','retention_receivable',false),
   (p_company,'1300','ضريبة مدخلات','Input VAT','asset','vat_input',false),
   (p_company,'2100','الموردون','Accounts payable','liability','payables',false),
   (p_company,'2150','مستحق الشركاء','Partner payable','liability','partner_payable',false),
   (p_company,'2200','دفعات مقدمة من العملاء','Customer advances','liability','customer_advances',false),
   (p_company,'2300','ضريبة مخرجات','Output VAT','liability','vat_output',false),
   (p_company,'3000','الأرصدة الافتتاحية ورأس المال','Opening balances & equity','equity','equity',false),
   (p_company,'4000','إيرادات المشروعات','Project revenue','revenue','revenue',false),
   (p_company,'5000','تكاليف مباشرة للمشروعات','Direct project costs','expense','direct_cost',false),
   (p_company,'5100','تكلفة حصة الشريك','Partner share cost','expense','partner_share_cost',false),
   (p_company,'6000','مصروفات عمومية وإدارية','General & admin expenses','expense','general_expense',false);
end $$;

create or replace function public.create_company(p_name_ar text, p_name_en text default null,
  p_vat_number text default null, p_cr_number text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  insert into public.companies(name_ar, name_en, vat_number, cr_number)
  values (p_name_ar, p_name_en, p_vat_number, p_cr_number) returning id into v;
  insert into public.memberships(company_id, user_id, role) values (v, auth.uid(), 'admin');
  perform public.seed_accounts(v);
  return v;
end $$;

create or replace function public.add_member(p_company uuid, p_email text, p_role public.app_role)
returns void language plpgsql security definer set search_path = public as $$
declare v_user uuid;
begin
  perform public.require_role(p_company, array['admin']::public.app_role[]);
  select id into v_user from auth.users where lower(email) = lower(p_email);
  if v_user is null then raise exception 'المستخدم غير موجود؛ أنشئه أولًا من Authentication / User not found'; end if;
  insert into public.memberships(company_id, user_id, role) values (p_company, v_user, p_role)
  on conflict (company_id, user_id) do update set role = excluded.role, is_active = true;
end $$;

-- =====================================================================
-- 13. Sales engine
-- =====================================================================
-- Calculates every amount of a sales document from project terms. Pure: no writes.
create or replace function public.calc_sales_document(p_doc uuid)
returns public.sales_documents language plpgsql stable security definer set search_path = public as $$
declare
  d public.sales_documents; p public.projects; c public.companies;
  v_adv_invoiced numeric; v_adv_recovered numeric; v_ret_held numeric; v_ret_released numeric; v_cap numeric;
begin
  select * into d from public.sales_documents where id = p_doc;
  if not found then raise exception 'Document not found'; end if;
  select * into p from public.projects where id = d.project_id;
  select * into c from public.companies where id = d.company_id;

  d.vat_rate := c.vat_rate;
  d.vat_mode := p.retention_vat_mode;
  d.advance_recovery := 0; d.retention := 0;

  if d.doc_type = 'progress_claim' then
    select coalesce(sum(work_value) filter (where doc_type='advance'),0),
           coalesce(sum(advance_recovery) filter (where doc_type='progress_claim'),0),
           coalesce(sum(retention) filter (where doc_type='progress_claim'),0)
      into v_adv_invoiced, v_adv_recovered, v_ret_held
      from public.sales_documents
     where project_id = d.project_id and status = 'posted' and id <> d.id;

    -- advance recovery: % of works, never more than what is still unrecovered
    d.advance_recovery := least(round(d.work_value * p.recovery_pct, 2),
                                greatest(v_adv_invoiced - v_adv_recovered, 0));
    -- retention: % of works, optional cap as % of contract value
    d.retention := round(d.work_value * p.retention_pct, 2);
    if p.retention_cap_pct is not null then
      v_cap := round(p.contract_value * p.retention_cap_pct, 2);
      d.retention := least(d.retention, greatest(v_cap - v_ret_held, 0));
    end if;

    if p.retention_vat_mode = 'A' then
      d.vat_base := d.work_value - d.discount - d.advance_recovery;
    else
      d.vat_base := d.work_value - d.discount - d.advance_recovery - d.retention;
    end if;
    if d.vat_base < 0 then raise exception 'الخصومات أكبر من قيمة الأعمال / Deductions exceed work value'; end if;
    d.vat_amount        := round(d.vat_base * c.vat_rate, 2);
    d.invoice_total     := d.vat_base + d.vat_amount;
    if p.retention_vat_mode = 'A' then
      d.collectible_total := d.invoice_total - d.retention;
      d.collectible_net   := d.vat_base - d.retention;
    else
      d.collectible_total := d.invoice_total;
      d.collectible_net   := d.vat_base;
    end if;

  elsif d.doc_type = 'retention_release' then
    select coalesce(sum(retention) filter (where doc_type='progress_claim'),0),
           coalesce(sum(work_value) filter (where doc_type='retention_release'),0)
      into v_ret_held, v_ret_released
      from public.sales_documents
     where project_id = d.project_id and status = 'posted' and id <> d.id;
    if d.work_value > v_ret_held - v_ret_released then
      raise exception 'مبلغ الإفراج % أكبر من المحتجز المتبقي % / Release exceeds outstanding retention',
        d.work_value, v_ret_held - v_ret_released;
    end if;
    d.vat_base   := case when p.retention_vat_mode = 'A' then 0 else d.work_value end;
    d.vat_amount := round(d.vat_base * c.vat_rate, 2);
    d.invoice_total     := case when p.retention_vat_mode = 'A' then d.work_value else d.vat_base + d.vat_amount end;
    d.collectible_total := d.invoice_total;
    d.collectible_net   := d.work_value;

  else -- advance / other: simple invoice
    d.vat_base          := d.work_value - d.discount;
    if d.vat_base < 0 then raise exception 'Discount exceeds value'; end if;
    d.vat_amount        := round(d.vat_base * c.vat_rate, 2);
    d.invoice_total     := d.vat_base + d.vat_amount;
    d.collectible_total := d.invoice_total;
    d.collectible_net   := d.vat_base;
  end if;
  return d;
end $$;

-- Preview for the UI before submitting (same maths as posting)
create or replace function public.preview_sales_document(p_doc uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare d public.sales_documents;
begin
  select * into d from public.sales_documents where id = p_doc;
  if not public.is_member(d.company_id) then raise exception 'Permission denied'; end if;
  d := public.calc_sales_document(p_doc);
  return jsonb_build_object('work_value', d.work_value, 'discount', d.discount,
    'advance_recovery', d.advance_recovery, 'retention', d.retention, 'vat_base', d.vat_base,
    'vat_amount', d.vat_amount, 'invoice_total', d.invoice_total,
    'collectible_total', d.collectible_total, 'collectible_net', d.collectible_net,
    'printed_total', d.printed_total,
    'total_matches', d.printed_total is null or abs(d.printed_total - d.invoice_total) <= (select total_tolerance from public.companies where id = d.company_id));
end $$;

create or replace function public.submit_sales_document(p_doc uuid)
returns void language plpgsql security definer set search_path = public as $$
declare d public.sales_documents;
begin
  select * into d from public.sales_documents where id = p_doc for update;
  perform public.require_role(d.company_id, array['admin','reviewer','entry']::public.app_role[]);
  if d.status not in ('draft','needs_info') then raise exception 'Only drafts can be submitted'; end if;
  perform set_config('hisabat.posting','on',true);
  update public.sales_documents set status='submitted', submitted_at=now(), review_reason=null where id = p_doc;
  perform set_config('hisabat.posting','off',true);
end $$;

-- action: 'needs_info' | 'reject' | 'reopen'
create or replace function public.review_document(p_table text, p_doc uuid, p_action text, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v_company uuid; v_status public.doc_status; v_new public.doc_status;
begin
  if p_table not in ('sales_documents','purchase_documents') then raise exception 'bad table'; end if;
  execute format('select company_id, status from public.%I where id=$1 for update', p_table)
    into v_company, v_status using p_doc;
  perform public.require_role(v_company, array['admin','reviewer']::public.app_role[]);
  if v_status <> 'submitted' then raise exception 'Document is not under review'; end if;
  v_new := case p_action when 'needs_info' then 'needs_info' when 'reject' then 'rejected' when 'reopen' then 'draft' end;
  if v_new is null then raise exception 'bad action'; end if;
  if p_action in ('needs_info','reject') and coalesce(trim(p_reason),'') = '' then
    raise exception 'السبب مطلوب / Reason is required';
  end if;
  perform set_config('hisabat.posting','on',true);
  execute format('update public.%I set status=$1, review_reason=$2 where id=$3', p_table) using v_new, p_reason, p_doc;
  perform set_config('hisabat.posting','off',true);
end $$;

create or replace function public.approve_sales_document(p_doc uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  d public.sales_documents; c public.companies; v_entry uuid; v_lines jsonb; v_date date;
begin
  select * into d from public.sales_documents where id = p_doc for update;
  if not found then raise exception 'Document not found'; end if;
  perform public.require_role(d.company_id, array['admin','reviewer']::public.app_role[]);
  select * into c from public.companies where id = d.company_id;
  if d.status <> 'submitted' then raise exception 'المستند ليس قيد المراجعة / Document must be submitted first'; end if;
  if c.require_separate_approver and d.created_by = auth.uid() then
    raise exception 'لا يمكنك اعتماد مستند أدخلته بنفسك / Separate approver required';
  end if;
  -- serialize postings per project so recovery/retention balances stay correct
  perform pg_advisory_xact_lock(hashtext(d.project_id::text));

  d := public.calc_sales_document(p_doc);
  if d.printed_total is not null and abs(d.printed_total - d.invoice_total) > c.total_tolerance then
    raise exception 'الإجمالي المطبوع % لا يطابق المحسوب % / Printed total mismatch', d.printed_total, d.invoice_total;
  end if;
  v_date := coalesce(d.supply_date, d.issue_date);

  if d.doc_type = 'advance' then
    v_lines := jsonb_build_array(
      jsonb_build_object('account','receivables','debit',d.collectible_total,'project',d.project_id,'party',d.customer_id),
      jsonb_build_object('account','customer_advances','credit',d.vat_base,'project',d.project_id,'party',d.customer_id),
      jsonb_build_object('account','vat_output','credit',d.vat_amount,'project',d.project_id));
  elsif d.doc_type = 'progress_claim' then
    v_lines := jsonb_build_array(
      jsonb_build_object('account','receivables','debit',d.collectible_total,'project',d.project_id,'party',d.customer_id),
      jsonb_build_object('account','customer_advances','debit',d.advance_recovery,'project',d.project_id,'party',d.customer_id),
      jsonb_build_object('account','retention_receivable','debit',d.retention,'project',d.project_id,'party',d.customer_id),
      jsonb_build_object('account','revenue','credit',d.work_value - d.discount,'project',d.project_id,'party',d.customer_id),
      jsonb_build_object('account','vat_output','credit',d.vat_amount,'project',d.project_id));
  elsif d.doc_type = 'retention_release' then
    v_lines := jsonb_build_array(
      jsonb_build_object('account','receivables','debit',d.collectible_total,'project',d.project_id,'party',d.customer_id),
      jsonb_build_object('account','retention_receivable','credit',d.work_value,'project',d.project_id,'party',d.customer_id),
      jsonb_build_object('account','vat_output','credit',d.vat_amount,'project',d.project_id));
  else
    v_lines := jsonb_build_array(
      jsonb_build_object('account','receivables','debit',d.collectible_total,'project',d.project_id,'party',d.customer_id),
      jsonb_build_object('account','revenue','credit',d.vat_base,'project',d.project_id,'party',d.customer_id),
      jsonb_build_object('account','vat_output','credit',d.vat_amount,'project',d.project_id));
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

-- =====================================================================
-- 14. Collections & partner share
-- =====================================================================
create or replace function public.record_receipt(p_company uuid, p_customer uuid, p_date date,
  p_amount numeric, p_bank_account uuid, p_reference text default null, p_notes text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid; v_entry uuid;
begin
  perform public.require_role(p_company, array['admin','reviewer']::public.app_role[]);
  if not exists (select 1 from public.accounts where id = p_bank_account and company_id = p_company and is_bank) then
    raise exception 'حساب بنك أو صندوق غير صالح / Invalid bank account';
  end if;
  if not exists (select 1 from public.parties where id = p_customer and company_id = p_company and kind = 'customer') then
    raise exception 'Invalid customer';
  end if;
  insert into public.receipts(company_id, customer_id, receipt_date, amount, bank_account_id, reference, notes, created_by)
  values (p_company, p_customer, p_date, round(p_amount,2), p_bank_account, p_reference, p_notes, auth.uid())
  returning id into v;
  v_entry := public.post_journal(p_company, p_date, 'receipt', v, 'تحصيل ' || coalesce(p_reference,''),
    jsonb_build_array(
      jsonb_build_object('account', p_bank_account::text, 'debit', round(p_amount,2)),
      jsonb_build_object('account', 'receivables', 'credit', round(p_amount,2), 'party', p_customer)));
  update public.receipts set journal_entry_id = v_entry where id = v;
  return v;
end $$;

create or replace function public.allocate_receipt(p_receipt uuid, p_doc uuid, p_amount numeric)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  r public.receipts; d public.sales_documents; ag public.partner_agreements;
  v_alloc uuid; v_amt numeric(18,2) := round(p_amount,2);
  v_receipt_left numeric; v_doc_left numeric; v_ratio numeric; v_net numeric(18,2);
  v_share numeric(18,2); v_prev_net numeric(18,2); v_ent uuid; v_entry uuid;
begin
  select * into r from public.receipts where id = p_receipt for update;
  if not found then raise exception 'Receipt not found'; end if;
  perform public.require_role(r.company_id, array['admin','reviewer']::public.app_role[]);
  select * into d from public.sales_documents where id = p_doc for update;
  if d.company_id <> r.company_id or d.customer_id <> r.customer_id then
    raise exception 'المستند لا يخص نفس العميل / Document belongs to another customer';
  end if;
  if d.status <> 'posted' then raise exception 'يخصص التحصيل لمستند معتمد فقط / Document not posted'; end if;

  select r.amount - coalesce(sum(amount),0) into v_receipt_left from public.receipt_allocations where receipt_id = r.id;
  select d.collectible_total - coalesce(sum(amount),0) into v_doc_left from public.receipt_allocations where sales_document_id = d.id;
  if v_amt <= 0 then raise exception 'Amount must be positive'; end if;
  if v_amt > v_receipt_left then raise exception 'المبلغ أكبر من المتبقي في التحصيل % / Exceeds unallocated receipt', v_receipt_left; end if;
  if v_amt > v_doc_left then raise exception 'المبلغ أكبر من رصيد المستند % / Exceeds document balance', v_doc_left; end if;

  insert into public.receipt_allocations(company_id, receipt_id, sales_document_id, amount, created_by)
  values (r.company_id, r.id, d.id, v_amt, auth.uid()) returning id into v_alloc;

  -- partner share: on actual cash, net of VAT, agreement valid on the receipt date
  select * into ag from public.partner_agreements
   where project_id = d.project_id and effective_from <= r.receipt_date
     and (effective_to is null or effective_to >= r.receipt_date)
   order by effective_from desc limit 1;

  if found and d.collectible_total > 0 then
    v_ratio := d.collectible_net / d.collectible_total;
    if v_amt = v_doc_left then
      -- last allocation closes the document: settle rounding so total share = net × pct exactly
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

create or replace function public.record_partner_settlement(p_company uuid, p_partner uuid, p_project uuid,
  p_date date, p_amount numeric, p_bank_account uuid, p_reference text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid; v_entry uuid; v_due numeric;
begin
  perform public.require_role(p_company, array['admin','reviewer']::public.app_role[]);
  select coalesce(sum(credit - debit),0) into v_due from public.journal_lines
   where company_id = p_company and account_id = public.acct(p_company,'partner_payable') and party_id = p_partner
     and (p_project is null or project_id = p_project);
  if round(p_amount,2) > v_due then raise exception 'المبلغ أكبر من مستحق الشريك % / Exceeds partner balance', v_due; end if;
  insert into public.partner_settlements(company_id, partner_id, project_id, settle_date, amount, bank_account_id, reference, created_by)
  values (p_company, p_partner, p_project, p_date, round(p_amount,2), p_bank_account, p_reference, auth.uid()) returning id into v;
  v_entry := public.post_journal(p_company, p_date, 'partner_settlement', v, 'سداد للشريك ' || coalesce(p_reference,''),
    jsonb_build_array(
      jsonb_build_object('account','partner_payable','debit',round(p_amount,2),'project',p_project,'party',p_partner),
      jsonb_build_object('account', p_bank_account::text,'credit',round(p_amount,2))));
  update public.partner_settlements set journal_entry_id = v_entry where id = v;
  return v;
end $$;

-- =====================================================================
-- 15. Purchases engine
-- =====================================================================
create or replace function public.submit_purchase_document(p_doc uuid)
returns void language plpgsql security definer set search_path = public as $$
declare d public.purchase_documents;
begin
  select * into d from public.purchase_documents where id = p_doc for update;
  perform public.require_role(d.company_id, array['admin','reviewer','entry']::public.app_role[]);
  if d.status not in ('draft','needs_info') then raise exception 'Only drafts can be submitted'; end if;
  perform set_config('hisabat.posting','on',true);
  update public.purchase_documents set status='submitted', submitted_at=now(), review_reason=null where id = p_doc;
  perform set_config('hisabat.posting','off',true);
end $$;

create or replace function public.approve_purchase_document(p_doc uuid, p_eligibility public.vat_eligibility,
  p_eligible_vat numeric default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare d public.purchase_documents; c public.companies; v_elig numeric(18,2); v_entry uuid; v_exp uuid;
begin
  select * into d from public.purchase_documents where id = p_doc for update;
  if not found then raise exception 'Document not found'; end if;
  perform public.require_role(d.company_id, array['admin','reviewer']::public.app_role[]);
  select * into c from public.companies where id = d.company_id;
  if d.status <> 'submitted' then raise exception 'Document must be submitted first'; end if;
  if c.require_separate_approver and d.created_by = auth.uid() then raise exception 'Separate approver required'; end if;
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
      jsonb_build_object('account','vat_input','debit', v_elig, 'project', d.project_id),
      jsonb_build_object('account','payables','credit', d.total_amount, 'project', d.project_id, 'party', d.supplier_id)));

  perform set_config('hisabat.posting','on',true);
  update public.purchase_documents set vat_eligibility = p_eligibility, eligible_vat = v_elig,
    status='posted', approved_by=auth.uid(), posted_at=now(), journal_entry_id=v_entry where id = p_doc;
  perform set_config('hisabat.posting','off',true);
  return v_entry;
end $$;

create or replace function public.record_supplier_payment(p_company uuid, p_supplier uuid, p_date date,
  p_amount numeric, p_bank_account uuid, p_purchase_doc uuid default null, p_reference text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid; v_entry uuid; v_left numeric;
begin
  perform public.require_role(p_company, array['admin','reviewer']::public.app_role[]);
  if not exists (select 1 from public.accounts where id = p_bank_account and company_id = p_company and is_bank) then
    raise exception 'Invalid bank account';
  end if;
  if p_purchase_doc is not null then
    select d.total_amount - coalesce((select sum(amount) from public.supplier_payments where purchase_document_id = d.id),0)
      into v_left from public.purchase_documents d
     where d.id = p_purchase_doc and d.supplier_id = p_supplier and d.status = 'posted';
    if v_left is null then raise exception 'Purchase document not found or not posted'; end if;
    if round(p_amount,2) > v_left then raise exception 'المبلغ أكبر من رصيد الفاتورة % / Exceeds invoice balance', v_left; end if;
  end if;
  insert into public.supplier_payments(company_id, supplier_id, purchase_document_id, pay_date, amount, bank_account_id, reference, created_by)
  values (p_company, p_supplier, p_purchase_doc, p_date, round(p_amount,2), p_bank_account, p_reference, auth.uid()) returning id into v;
  v_entry := public.post_journal(p_company, p_date, 'supplier_payment', v, 'سداد مورد ' || coalesce(p_reference,''),
    jsonb_build_array(
      jsonb_build_object('account','payables','debit',round(p_amount,2),'party',p_supplier),
      jsonb_build_object('account', p_bank_account::text,'credit',round(p_amount,2))));
  update public.supplier_payments set journal_entry_id = v_entry where id = v;
  return v;
end $$;

create or replace function public.set_period_lock(p_company uuid, p_start date, p_end date, p_locked boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.require_role(p_company, array['admin']::public.app_role[]);
  insert into public.fiscal_periods(company_id, period_start, period_end, is_locked, locked_by, locked_at)
  values (p_company, p_start, p_end, p_locked, auth.uid(), now())
  on conflict (company_id, period_start) do update
    set period_end = excluded.period_end, is_locked = excluded.is_locked, locked_by = auth.uid(), locked_at = now();
end $$;

-- =====================================================================
-- 16. Reporting views (respect RLS of the caller)
-- =====================================================================
create view public.v_sales_document_balances with (security_invoker = on) as
select d.id, d.company_id, d.project_id, d.customer_id, d.doc_type, d.issuer_ref, d.issue_date, d.status,
       d.collectible_total, coalesce(sum(a.amount),0) as collected,
       d.collectible_total - coalesce(sum(a.amount),0) as balance
  from public.sales_documents d left join public.receipt_allocations a on a.sales_document_id = d.id
 group by d.id;

create view public.v_receipt_balances with (security_invoker = on) as
select r.id, r.company_id, r.customer_id, r.receipt_date, r.amount, r.reference,
       coalesce(sum(a.amount),0) as allocated, r.amount - coalesce(sum(a.amount),0) as unallocated
  from public.receipts r left join public.receipt_allocations a on a.receipt_id = r.id
 group by r.id;

create view public.v_project_advance_retention with (security_invoker = on) as
select p.id as project_id, p.company_id, p.code, p.name_ar, p.contract_value, p.advance_amount,
  coalesce(sum(d.work_value)       filter (where d.doc_type='advance'),0)           as advance_invoiced,
  coalesce(sum(d.advance_recovery) filter (where d.doc_type='progress_claim'),0)    as advance_recovered,
  coalesce(sum(d.work_value)       filter (where d.doc_type='advance'),0)
    - coalesce(sum(d.advance_recovery) filter (where d.doc_type='progress_claim'),0) as advance_outstanding,
  coalesce(sum(d.retention)        filter (where d.doc_type='progress_claim'),0)    as retention_held,
  coalesce(sum(d.work_value)       filter (where d.doc_type='retention_release'),0) as retention_released,
  coalesce(sum(d.retention)        filter (where d.doc_type='progress_claim'),0)
    - coalesce(sum(d.work_value)   filter (where d.doc_type='retention_release'),0) as retention_outstanding,
  coalesce(sum(d.work_value)       filter (where d.doc_type='progress_claim'),0)    as works_certified
from public.projects p
left join public.sales_documents d on d.project_id = p.id and d.status = 'posted'
group by p.id;

create view public.v_partner_balances with (security_invoker = on) as
select e.company_id, e.partner_id, e.project_id,
       sum(e.net_collected) as net_collected, sum(e.amount) as entitled,
       coalesce((select sum(s.amount) from public.partner_settlements s
                  where s.partner_id = e.partner_id and s.project_id = e.project_id),0) as settled,
       sum(e.amount) - coalesce((select sum(s.amount) from public.partner_settlements s
                  where s.partner_id = e.partner_id and s.project_id = e.project_id),0) as outstanding
  from public.partner_entitlements e
 group by e.company_id, e.partner_id, e.project_id;

create view public.v_project_profitability with (security_invoker = on) as
select p.id as project_id, p.company_id, p.code, p.name_ar, p.budget,
  coalesce(sum(l.credit - l.debit) filter (where a.type='revenue'),0)                                   as revenue,
  coalesce(sum(l.debit - l.credit) filter (where a.type='expense' and a.system_key is distinct from 'partner_share_cost'),0) as direct_costs,
  coalesce(sum(l.debit - l.credit) filter (where a.system_key='partner_share_cost'),0)                   as partner_share_cost,
  coalesce(sum(l.credit - l.debit) filter (where a.type='revenue'),0)
    - coalesce(sum(l.debit - l.credit) filter (where a.type='expense'),0)                               as gross_profit
from public.projects p
left join public.journal_lines l on l.project_id = p.id
left join public.accounts a on a.id = l.account_id
group by p.id;

create view public.v_trial_balance with (security_invoker = on) as
select a.company_id, a.id as account_id, a.code, a.name_ar, a.name_en, a.type,
       coalesce(sum(l.debit),0) as debit, coalesce(sum(l.credit),0) as credit,
       coalesce(sum(l.debit - l.credit),0) as balance
  from public.accounts a left join public.journal_lines l on l.account_id = a.id
 group by a.id;

create view public.v_vat_by_month with (security_invoker = on) as
select e.company_id, date_trunc('month', e.entry_date)::date as month,
  coalesce(sum(l.credit - l.debit) filter (where a.system_key='vat_output'),0) as output_vat,
  coalesce(sum(l.debit - l.credit) filter (where a.system_key='vat_input'),0)  as input_vat,
  coalesce(sum(l.credit - l.debit) filter (where a.system_key='vat_output'),0)
   - coalesce(sum(l.debit - l.credit) filter (where a.system_key='vat_input'),0) as net_vat
  from public.journal_entries e
  join public.journal_lines l on l.entry_id = e.id
  join public.accounts a on a.id = l.account_id
 group by e.company_id, date_trunc('month', e.entry_date);

-- =====================================================================
-- 17. Row Level Security
-- =====================================================================
do $$ declare t text; begin
  foreach t in array array['companies','profiles','memberships','accounts','parties','projects','partner_agreements',
    'bank_guarantees','fiscal_periods','journal_entries','journal_lines','sales_documents','receipts',
    'receipt_allocations','partner_entitlements','partner_settlements','purchase_documents','supplier_payments','audit_events']
  loop execute format('alter table public.%I enable row level security', t); end loop;
end $$;

-- read access for members (company-scoped tables)
do $$ declare t text; begin
  foreach t in array array['accounts','parties','projects','partner_agreements','bank_guarantees','fiscal_periods',
    'journal_entries','journal_lines','sales_documents','receipts','receipt_allocations','partner_entitlements',
    'partner_settlements','purchase_documents','supplier_payments','memberships']
  loop execute format('create policy %I on public.%I for select to authenticated using (public.is_member(company_id))', t||'_read', t); end loop;
end $$;

create policy companies_read   on public.companies for select to authenticated using (public.is_member(id));
create policy companies_update on public.companies for update to authenticated
  using (public.my_role(id) = 'admin') with check (public.my_role(id) = 'admin');

create policy profiles_read on public.profiles for select to authenticated using (
  id = auth.uid() or exists (select 1 from public.memberships m1 join public.memberships m2 on m1.company_id = m2.company_id
                              where m1.user_id = auth.uid() and m2.user_id = profiles.id));
create policy profiles_update on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy audit_read on public.audit_events for select to authenticated using (public.my_role(company_id) = 'admin');

-- master data
create policy accounts_write on public.accounts for insert to authenticated with check (public.my_role(company_id) = 'admin');
create policy accounts_update on public.accounts for update to authenticated
  using (public.my_role(company_id) = 'admin' and system_key is null) with check (public.my_role(company_id) = 'admin');

create policy parties_insert on public.parties for insert to authenticated with check (public.is_member(company_id));
create policy parties_update on public.parties for update to authenticated
  using (public.my_role(company_id) in ('admin','reviewer')) with check (public.my_role(company_id) in ('admin','reviewer'));

create policy projects_insert on public.projects for insert to authenticated
  with check (public.my_role(company_id) in ('admin','reviewer'));
create policy projects_update on public.projects for update to authenticated
  using (public.my_role(company_id) in ('admin','reviewer')) with check (public.my_role(company_id) in ('admin','reviewer'));

create policy agreements_insert on public.partner_agreements for insert to authenticated
  with check (public.my_role(company_id) in ('admin','reviewer'));
create policy agreements_update on public.partner_agreements for update to authenticated
  using (public.my_role(company_id) = 'admin') with check (public.my_role(company_id) = 'admin');

create policy guarantees_insert on public.bank_guarantees for insert to authenticated
  with check (public.my_role(company_id) in ('admin','reviewer'));
create policy guarantees_update on public.bank_guarantees for update to authenticated
  using (public.my_role(company_id) in ('admin','reviewer')) with check (public.my_role(company_id) in ('admin','reviewer'));

-- documents: anyone in the company drafts; edits only on own drafts (reviewers/admins on any draft)
do $$ declare t text; begin
  foreach t in array array['sales_documents','purchase_documents'] loop
    execute format($f$create policy %I on public.%I for insert to authenticated
      with check (public.is_member(company_id) and created_by = auth.uid() and status = 'draft')$f$, t||'_insert', t);
    execute format($f$create policy %I on public.%I for update to authenticated
      using (public.is_member(company_id) and status in ('draft','needs_info')
             and (created_by = auth.uid() or public.my_role(company_id) in ('admin','reviewer')))
      with check (public.is_member(company_id))$f$, t||'_update', t);
    execute format($f$create policy %I on public.%I for delete to authenticated
      using (status = 'draft' and (created_by = auth.uid() or public.my_role(company_id) = 'admin'))$f$, t||'_delete', t);
  end loop;
end $$;
-- the entry role sees only the documents it created
drop policy sales_documents_read on public.sales_documents;
create policy sales_documents_read on public.sales_documents for select to authenticated
  using (public.is_member(company_id) and (public.my_role(company_id) <> 'entry' or created_by = auth.uid()));
drop policy purchase_documents_read on public.purchase_documents;
create policy purchase_documents_read on public.purchase_documents for select to authenticated
  using (public.is_member(company_id) and (public.my_role(company_id) <> 'entry' or created_by = auth.uid()));
-- the entry role cannot read the ledger, receipts or partner figures
do $$ declare t text; begin
  foreach t in array array['journal_entries','journal_lines','receipts','receipt_allocations','partner_entitlements','partner_settlements','supplier_payments'] loop
    execute format('drop policy %I on public.%I', t||'_read', t);
    execute format($f$create policy %I on public.%I for select to authenticated
      using (public.my_role(company_id) in ('admin','reviewer'))$f$, t||'_read', t);
  end loop;
end $$;

-- =====================================================================
-- 18. Function permissions
-- =====================================================================
revoke execute on all functions in schema public from public, anon;
-- internal helpers: not callable from the API
revoke execute on function public.post_journal(uuid,date,text,uuid,text,jsonb) from authenticated;
revoke execute on function public.seed_accounts(uuid) from authenticated;
revoke execute on function public.calc_sales_document(uuid) from authenticated;
revoke execute on function public.acct(uuid,text) from authenticated;
-- public API
grant execute on function
  public.my_role(uuid), public.is_member(uuid), public.create_company(text,text,text,text),
  public.add_member(uuid,text,public.app_role), public.preview_sales_document(uuid),
  public.submit_sales_document(uuid), public.review_document(text,uuid,text,text),
  public.approve_sales_document(uuid), public.record_receipt(uuid,uuid,date,numeric,uuid,text,text),
  public.allocate_receipt(uuid,uuid,numeric), public.record_partner_settlement(uuid,uuid,uuid,date,numeric,uuid,text),
  public.submit_purchase_document(uuid), public.approve_purchase_document(uuid,public.vat_eligibility,numeric),
  public.record_supplier_payment(uuid,uuid,date,numeric,uuid,uuid,text), public.set_period_lock(uuid,date,date,boolean)
to authenticated;

-- =====================================================================
-- 19. Private storage bucket for attachments (Supabase Storage)
-- =====================================================================
do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public) values ('attachments','attachments', false) on conflict (id) do nothing;
    -- path convention: <company_id>/<anything>
    execute $p$create policy attachments_read on storage.objects for select to authenticated
      using (bucket_id = 'attachments' and public.is_member(((storage.foldername(name))[1])::uuid))$p$;
    execute $p$create policy attachments_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'attachments' and public.is_member(((storage.foldername(name))[1])::uuid))$p$;
  end if;
end $$;
