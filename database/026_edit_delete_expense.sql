-- =====================================================================
-- Hisabat — الأدمن يعدّل أو يحذف مصروف متسجل. Run once, after 025.
--  • الحذف بيشيل المصروف وكل اللي اترتب عليه: قيوده، سداده (بنك/عهدة/شريك/دفعة مقدمة)،
--    السلفة بين الأجزاء، استرجاع الضريبة — فالبنك والعهدة والدفعات بترجع زي ما كانت
--  • التعديل = حذف + تسجيل من جديد في خطوة واحدة (لو فشل التسجيل الجديد، الحذف بيتلغي)
--  • السبب بيتسجل في سجل التدقيق، والفترة المقفولة ما بتتعدلش
-- =====================================================================

create or replace function public.delete_purchase(p_doc uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare d public.purchase_documents; v_pays uuid[]; v_entries uuid[]; v_cus uuid[]; c uuid;
begin
  select * into d from public.purchase_documents where id = p_doc for update;
  if not found then raise exception 'المصروف غير موجود / Expense not found'; end if;
  perform public.require_role(d.company_id, array['admin']::public.app_role[]);
  if coalesce(trim(p_reason),'') = '' then raise exception 'سبب الحذف أو التعديل مطلوب / Reason is required'; end if;
  if exists (select 1 from public.fiscal_periods f where f.company_id = d.company_id and f.is_locked
              and d.issue_date between f.period_start and f.period_end) then
    raise exception 'الفترة دي مقفولة / This period is locked';
  end if;

  select coalesce(array_agg(id), '{}') into v_pays from public.supplier_payments where purchase_document_id = d.id;
  select coalesce(array_agg(distinct custody_id), '{}') into v_cus from public.custody_settlements where purchase_document_id = d.id;
  select coalesce(array_agg(distinct e.id), '{}') into v_entries from public.journal_entries e
   where e.id = d.journal_entry_id
      or e.id in (select journal_entry_id from public.supplier_payments where id = any(v_pays))
      or e.source_id = d.id or e.source_id = any(v_pays);
  -- an entry that also carries another document's lines can't be removed safely
  if exists (select 1 from public.journal_entries e where e.id = any(v_entries)
              and e.source_type not in ('purchase_document','supplier_payment','inter_part','vat_reclaimed_by_partner')) then
    raise exception 'المصروف مربوط بقيود تانية — ابعت للمطوّر / Linked to other entries';
  end if;

  insert into public.audit_events(company_id, table_name, row_id, action, actor, old_data, new_data)
  values (d.company_id, 'purchase_documents', d.id, 'ADMIN_DELETE', auth.uid(), to_jsonb(d), jsonb_build_object('reason', trim(p_reason)));

  alter table public.journal_entries    disable trigger journal_entries_immutable;
  alter table public.journal_lines      disable trigger journal_lines_immutable;
  alter table public.purchase_documents disable trigger purchase_doc_guard;
  delete from public.custody_settlements where purchase_document_id = d.id;
  delete from public.supplier_payments   where id = any(v_pays);
  delete from public.purchase_documents  where id = d.id;
  delete from public.journal_lines       where entry_id = any(v_entries);
  delete from public.journal_entries     where id = any(v_entries);
  alter table public.journal_entries    enable trigger journal_entries_immutable;
  alter table public.journal_lines      enable trigger journal_lines_immutable;
  alter table public.purchase_documents enable trigger purchase_doc_guard;

  -- a custody that was fully settled by this invoice is open again
  foreach c in array v_cus loop
    update public.custody_requests set status = 'open', settled_at = null
     where id = c and status = 'settled' and public.custody_balance(c) > 0;
  end loop;
end $$;

-- edit: p = the same fields the expense form sends, plus
--   mode: account | credit | custody | partner | advance  (+ account_id / custody_id / partner_project_id / supplier_id)
--   commitment_id (optional), reason
create or replace function public.replace_expense(p_doc uuid, p_company uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid; v_mode text := coalesce(nullif(p->>'mode',''), 'account');
begin
  perform public.delete_purchase(p_doc, coalesce(nullif(trim(p->>'reason'),''), 'تعديل المصروف'));
  if v_mode = 'partner' then
    v := public.post_expense_by_partner(p_company, p - 'mode' - 'reason' - 'commitment_id');
  elsif v_mode = 'advance' then
    v := public.post_expense_from_advances(p_company, p - 'mode' - 'reason' - 'commitment_id');
  else
    v := public.post_expense(p_company, (p - 'mode' - 'reason' - 'commitment_id') || jsonb_build_object('payment', v_mode));
  end if;
  if nullif(p->>'commitment_id','') is not null then
    perform public.link_to_commitment(v, (p->>'commitment_id')::uuid);
  end if;
  return v;
end $$;

revoke execute on function public.delete_purchase(uuid,text) from public, anon;
revoke execute on function public.replace_expense(uuid,uuid,jsonb) from public, anon;
grant execute on function public.delete_purchase(uuid,text), public.replace_expense(uuid,uuid,jsonb) to authenticated;

notify pgrst, 'reload schema';
