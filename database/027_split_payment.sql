-- =====================================================================
-- Hisabat — فاتورة جزء منها من دفعات المورد والباقي من حتة تانية
--           + تقرير الضريبة: ضريبة المصاريف اللي استرجعها شريك تظهر عند الشريك ده. Run once, after 026.
-- p (post_expense_from_advances) يقبل كمان:
--   rest_mode: credit (افتراضي) | account | partner  + rest_account_id | rest_partner_project_id
-- =====================================================================
create or replace function public.post_expense_from_advances(p_company uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_doc uuid; v_total numeric; v_pool numeric; v_left numeric; v_date date;
  v_supp uuid := nullif(p->>'supplier_id','')::uuid; v_rest text := coalesce(nullif(p->>'rest_mode',''), 'credit');
begin
  if v_supp is null then raise exception 'اختر المورد / Choose the supplier'; end if;
  v_date := coalesce(nullif(p->>'issue_date','')::date, current_date);
  v_doc := public.post_expense(p_company, (p - 'payment' - 'supplier_name' - 'advance_id' - 'rest_mode' - 'rest_account_id' - 'rest_partner_project_id')
                                          || jsonb_build_object('payment','credit'));
  select total_amount into v_total from public.purchase_documents where id = v_doc;
  select coalesce(sum(public.supplier_advance_balance(id)), 0) into v_pool
    from public.supplier_advances where company_id = p_company and supplier_id = v_supp;
  if least(v_total, v_pool) > 0 then
    perform public.apply_supplier_advances(v_doc, least(v_total, v_pool), v_date);
  end if;
  select v_total - coalesce(sum(amount), 0) into v_left from public.supplier_payments where purchase_document_id = v_doc;
  if v_left > 0 and v_rest = 'account' then
    perform public.pay_purchase_internal(v_doc, v_date, v_left, nullif(p->>'rest_account_id','')::uuid, null, 'باقي الفاتورة بعد خصم الدفعات');
  elsif v_left > 0 and v_rest = 'partner' then
    perform public.pay_purchase_by_partner(v_doc, nullif(p->>'rest_partner_project_id','')::uuid, v_left, v_date, 'باقي الفاتورة بعد خصم الدفعات');
  end if;
  return v_doc;
end $$;

-- ضريبة مشتريات استرجعها شريك غير صاحب عقد المشروع (زي الفاتح على كباين كرم) ← تظهر في تقرير ضريبة الشريك ده
alter table public.purchase_documents add column if not exists vat_owner_partner uuid references public.parties(id);

create or replace function public.reclaim_vat_by_partner(p_doc uuid, p_project uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare d public.purchase_documents; pr public.projects; v_vat numeric(18,2); v_entry uuid;
begin
  select * into d from public.purchase_documents where id = p_doc and status = 'posted';
  if not found then raise exception 'Purchase document not found or not posted'; end if;
  perform public.require_role(d.company_id, array['admin','reviewer','expense']::public.app_role[]);
  select * into pr from public.projects where id = p_project and company_id = d.company_id;
  if not found or pr.contract_holder <> 'partner' then raise exception 'المشروع ده مش باسم شريك / Project is not held by a partner'; end if;
  v_vat := d.vat_amount - d.eligible_vat;
  if v_vat <= 0 then raise exception 'مفيش ضريبة على الفاتورة دي محسوبة تكلفة / No VAT left to reclaim'; end if;
  v_entry := public.post_journal(d.company_id, d.issue_date, 'vat_reclaimed_by_partner', d.id,
    'ضريبة استرجعها الشريك في إقراره — ' || d.doc_number,
    jsonb_build_array(
      jsonb_build_object('account','partner_vat','debit',v_vat,'project',p_project,'party',pr.holder_partner_id),
      jsonb_build_object('account', coalesce(d.expense_account_id, public.acct(d.company_id,'direct_cost'))::text,
                         'credit',v_vat,'project',d.project_id,'party',d.supplier_id)));
  -- the VAT benefit went to the partner's part, so the other part owes that much less
  perform public.post_inter_part(d.company_id, d.issue_date, d.id, d.project_id, p_project, v_vat, null,
    'ضريبة استرجعها الشريك — ' || d.doc_number);
  perform set_config('hisabat.posting','on',true);
  update public.purchase_documents set vat_eligibility = 'full', eligible_vat = vat_amount, vat_owner_partner = pr.holder_partner_id where id = d.id;
  perform set_config('hisabat.posting','off',true);
  return v_entry;
end $$;

-- اللي اتسجل قبل كده
alter table public.purchase_documents disable trigger purchase_doc_guard;
update public.purchase_documents d set vat_owner_partner = l.party_id
  from public.journal_entries e join public.journal_lines l on l.entry_id = e.id
  join public.accounts a on a.id = l.account_id and a.system_key = 'partner_vat'
 where e.source_type = 'vat_reclaimed_by_partner' and e.source_id = d.id and l.debit > 0 and d.vat_owner_partner is null;
alter table public.purchase_documents enable trigger purchase_doc_guard;

notify pgrst, 'reload schema';
