-- =====================================================================
-- Hisabat — التزامات للموردين (نسب واتفاقات بمبلغ إجمالي بيتدفع على مراحل). Run once, after 023.
--  • الالتزام مش تكلفة: التكلفة = المصروفات اللي اتسجلت عليه بس، والمدفوع = اللي اتدفع فعلًا
--  • بيبان لكل التزام: الإجمالي، المدفوع، الباقي (في المصروفات وتقرير الموردين)
--  • ومعاه: نسبة مروان على PO الفاتح (37,674.90) وعلى PO كرم (15,905.80) مربوطين بالدفعات اللي اتدفعت
-- =====================================================================

create table if not exists public.supplier_commitments (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  supplier_id   uuid not null references public.parties(id),
  project_id    uuid references public.projects(id),
  title         text not null,
  total_amount  numeric(18,2) not null check (total_amount > 0),
  closed_at     timestamptz,
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now()
);
alter table public.purchase_documents add column if not exists commitment_id uuid references public.supplier_commitments(id);

alter table public.supplier_commitments enable row level security;
drop policy if exists supplier_commitments_read on public.supplier_commitments;
create policy supplier_commitments_read on public.supplier_commitments for select to authenticated
  using (public.is_member(company_id) and public.my_role(company_id) in ('admin','reviewer','expense'));
drop trigger if exists supplier_commitments_audit on public.supplier_commitments;
create trigger supplier_commitments_audit after insert or update or delete on public.supplier_commitments
  for each row execute function public.trg_audit();

create or replace view public.v_supplier_commitments with (security_invoker = on) as
select c.id, c.company_id, c.supplier_id, s.name_ar as supplier_name, c.project_id, c.title, c.total_amount, c.closed_at, c.created_at,
       coalesce((select sum(sp.amount) from public.supplier_payments sp join public.purchase_documents d on d.id = sp.purchase_document_id
                  where d.commitment_id = c.id), 0) as paid,
       c.total_amount - coalesce((select sum(sp.amount) from public.supplier_payments sp join public.purchase_documents d on d.id = sp.purchase_document_id
                  where d.commitment_id = c.id), 0) as remaining
  from public.supplier_commitments c join public.parties s on s.id = c.supplier_id;

-- p = { supplier_id | supplier_name, project_id, title, total_amount }
create or replace function public.add_commitment(p_company uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid; v_total numeric(18,2) := round(coalesce(nullif(p->>'total_amount','')::numeric, 0), 2);
begin
  perform public.require_role(p_company, array['admin','reviewer']::public.app_role[]);
  if coalesce(trim(p->>'title'),'') = '' then raise exception 'البيان مطلوب / Title is required'; end if;
  if v_total <= 0 then raise exception 'المبلغ يجب أن يكون أكبر من صفر / Amount must be greater than zero'; end if;
  if nullif(p->>'project_id','') is not null and not exists
     (select 1 from public.projects where id = (p->>'project_id')::uuid and company_id = p_company) then
    raise exception 'Invalid project';
  end if;
  insert into public.supplier_commitments(company_id, supplier_id, project_id, title, total_amount, created_by)
  values (p_company, public.supplier_from(p_company, p), nullif(p->>'project_id','')::uuid, trim(p->>'title'), v_total, auth.uid())
  returning id into v;
  return v;
end $$;

-- attach an expense to a commitment (same supplier); null = detach
create or replace function public.link_to_commitment(p_doc uuid, p_commitment uuid)
returns void language plpgsql security definer set search_path = public as $$
declare d public.purchase_documents; c public.supplier_commitments;
begin
  select * into d from public.purchase_documents where id = p_doc;
  if not found then raise exception 'Document not found'; end if;
  perform public.require_role(d.company_id, array['admin','reviewer','expense']::public.app_role[]);
  if p_commitment is not null then
    select * into c from public.supplier_commitments where id = p_commitment and company_id = d.company_id;
    if not found then raise exception 'الالتزام غير موجود / Commitment not found'; end if;
    if c.supplier_id <> d.supplier_id then
      raise exception 'الالتزام لمورد تاني غير مورد الفاتورة / The commitment belongs to another supplier';
    end if;
  end if;
  perform set_config('hisabat.posting','on',true);
  update public.purchase_documents set commitment_id = p_commitment where id = p_doc;
  perform set_config('hisabat.posting','off',true);
end $$;

create or replace function public.close_commitment(p_commitment uuid, p_close boolean)
returns void language plpgsql security definer set search_path = public as $$
declare c public.supplier_commitments;
begin
  select * into c from public.supplier_commitments where id = p_commitment;
  if not found then raise exception 'Commitment not found'; end if;
  perform public.require_role(c.company_id, array['admin','reviewer']::public.app_role[]);
  update public.supplier_commitments set closed_at = case when p_close then now() end where id = p_commitment;
end $$;

revoke execute on function public.add_commitment(uuid,jsonb) from public, anon;
revoke execute on function public.link_to_commitment(uuid,uuid) from public, anon;
revoke execute on function public.close_commitment(uuid,boolean) from public, anon;
grant execute on function public.add_commitment(uuid,jsonb), public.link_to_commitment(uuid,uuid), public.close_commitment(uuid,boolean) to authenticated;

-- ── نسبة مروان: التزامين، مربوطين بالدفعات اللي اتدفعت ──────────────────
do $$
declare v_co uuid; v_admin uuid; v_c uuid; d public.purchase_documents;
begin
  select id into v_co from public.companies where slug = 'trio' or name_ar = 'تريو' order by created_at limit 1;
  select m.user_id into v_admin from public.memberships m
   where m.company_id = v_co and m.role = 'admin' and m.is_active order by m.created_at limit 1;
  if v_co is null then return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  -- على الفاتح: 1.5% من 2,511,660
  select * into d from public.purchase_documents where company_id = v_co and doc_number in ('Cost-00024','COMM-HAFR-02') and status = 'posted' limit 1;
  if d.id is not null and d.commitment_id is null then
    v_c := public.add_commitment(v_co, jsonb_build_object('supplier_id', d.supplier_id, 'project_id', d.project_id,
      'title', 'نسبة مروان 1.5% من PO الفاتح (2,511,660)', 'total_amount', 37674.90));
    perform public.link_to_commitment(d.id, v_c);
  end if;
  -- على كرم: 1% من 1,590,579.50
  select * into d from public.purchase_documents where company_id = v_co and doc_number in ('OPEN-HAFR-10','COMM-HAFR-01') and status = 'posted' limit 1;
  if d.id is not null and d.commitment_id is null then
    v_c := public.add_commitment(v_co, jsonb_build_object('supplier_id', d.supplier_id, 'project_id', d.project_id,
      'title', 'نسبة مروان 1% من PO كرم (1,590,579.50)', 'total_amount', 15905.80));
    perform public.link_to_commitment(d.id, v_c);
  end if;
end $$;

notify pgrst, 'reload schema';

select supplier_name as "المورد", title as "الالتزام", total_amount as "الإجمالي", paid as "المدفوع", remaining as "الباقي"
  from public.v_supplier_commitments order by created_at;
