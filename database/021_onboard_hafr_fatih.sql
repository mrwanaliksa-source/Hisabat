-- =====================================================================
-- Hisabat — إدخال جزء الفاتح في مشروع حفر الباطن. شغّله مرة واحدة بعد 020.
--
-- PO الفاتح        : 2,511,660 قبل الضريبة — دفعة مقدمة 20% — استرداد 20% — محتجز 10%
--                    الضريبة على 80% (قبل خصم المحتجز) — العقد باسم الفاتح، ونسبته 10% من صافي ربح جزئه عند الإقفال
-- المقدم المحصّل   : 10% = 251,166 + ضريبة 37,674.90 = 288,840.90 — استلمه الفاتح ولسه معاه (ما حوّلش لنا)
-- الفاتح صرف بنفسه من الفلوس اللي معاه، واسترجع ضريبة المصاريف (18,430.57) في إقراره،
-- فسدّد للهيئة 37,674.90 − 18,430.57 = 19,244.33 بس:
--   على كباين كرم (HAFR-01): 191,301 بالضريبة ← تكلفة 172,870.43 من غير الضريبة، وسلفة على جزء كرم لجزء الفاتح 172,870.43
--   دفعة 15,000 من نسبة مروان 1.5% من PO الفاتح (إجمالي النسبة 37,674.90، الباقي 22,674.90) — تكلفة على جزء الفاتح
-- الباقي عند الفاتح من فلوس جزئه = 288,840.90 − 19,244.33 − 191,301 − 15,000 = 63,295.57
-- =====================================================================
-- ── عام: مصروف دفعه الشريك (صاحب العقد) من فلوس المشروع اللي معاه ──
create or replace function public.pay_purchase_by_partner(p_doc uuid, p_project uuid, p_amount numeric, p_date date, p_reference text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare d public.purchase_documents; pr public.projects; v uuid; v_entry uuid; v_amt numeric(18,2) := round(p_amount, 2); v_left numeric;
begin
  select * into d from public.purchase_documents where id = p_doc and status = 'posted';
  if not found then raise exception 'Purchase document not found or not posted'; end if;
  perform public.require_role(d.company_id, array['admin','reviewer','expense']::public.app_role[]);
  select * into pr from public.projects where id = p_project and company_id = d.company_id;
  if not found or pr.contract_holder <> 'partner' then raise exception 'المشروع ده مش باسم شريك / Project is not held by a partner'; end if;
  select d.total_amount - coalesce(sum(amount),0) into v_left from public.supplier_payments where purchase_document_id = d.id;
  if v_amt <= 0 or v_amt > v_left then raise exception 'المبلغ أكبر من رصيد الفاتورة % / Exceeds invoice balance', v_left; end if;
  insert into public.supplier_payments(company_id, supplier_id, purchase_document_id, pay_date, amount, bank_account_id, reference, created_by)
  values (d.company_id, d.supplier_id, d.id, coalesce(p_date, current_date), v_amt, public.acct(d.company_id, 'partner_held_cash'),
          coalesce(p_reference, 'دفعها الشريك'), auth.uid())
  returning id into v;
  v_entry := public.post_journal(d.company_id, coalesce(p_date, current_date), 'supplier_payment', v,
    'دفعها الشريك من فلوس ' || pr.code || ' — ' || d.doc_number,
    jsonb_build_array(
      jsonb_build_object('account','payables','debit',v_amt,'project',d.project_id,'party',d.supplier_id),
      jsonb_build_object('account','partner_held_cash','credit',v_amt,'project',p_project,'party',pr.holder_partner_id)));
  update public.supplier_payments set journal_entry_id = v_entry where id = v;
  perform public.post_inter_part(d.company_id, coalesce(p_date, current_date), v, p_project, d.project_id, v_amt, null,
    'سلفة بين الأجزاء — دفعها الشريك ' || d.doc_number);
  return v;
end $$;

-- الشريك استرجع ضريبة فاتورة مورد في إقراره ← الضريبة مش تكلفة، وبتتخصم من ضريبة الشريك على مشروعه
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
  update public.purchase_documents set vat_eligibility = 'full', eligible_vat = vat_amount where id = d.id;
  perform set_config('hisabat.posting','off',true);
  return v_entry;
end $$;

-- مصروف جديد مدفوع من الشريك في خطوة واحدة: p = حقول post_expense + partner_project_id
create or replace function public.post_expense_by_partner(p_company uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_doc uuid; v_total numeric;
begin
  v_doc := public.post_expense(p_company, (p - 'payment' - 'partner_project_id' - 'partner_reclaims_vat') || jsonb_build_object('payment','credit'));
  select total_amount into v_total from public.purchase_documents where id = v_doc;
  perform public.pay_purchase_by_partner(v_doc, (p->>'partner_project_id')::uuid, v_total,
    coalesce(nullif(p->>'issue_date','')::date, current_date), null);
  if coalesce((p->>'partner_reclaims_vat')::boolean, false)
     and (select vat_amount - eligible_vat from public.purchase_documents where id = v_doc) > 0 then
    perform public.reclaim_vat_by_partner(v_doc, (p->>'partner_project_id')::uuid);
  end if;
  return v_doc;
end $$;
revoke execute on function public.pay_purchase_by_partner(uuid,uuid,numeric,date,text) from public, anon;
revoke execute on function public.post_expense_by_partner(uuid,jsonb) from public, anon;
revoke execute on function public.reclaim_vat_by_partner(uuid,uuid) from public, anon;
grant execute on function public.pay_purchase_by_partner(uuid,uuid,numeric,date,text), public.post_expense_by_partner(uuid,jsonb),
  public.reclaim_vat_by_partner(uuid,uuid) to authenticated;
notify pgrst, 'reload schema';

do $$
declare
  v_adv_date date := '2026-09-30';     -- ← تاريخ استلام المقدم (عدّله لو مختلف)
  v_co uuid; v_admin uuid; v_h1 uuid; v_h2 uuid; v_partner uuid; v_cust uuid; v_bank uuid; v_bm uuid;
  v_doc uuid; v_cash numeric; v_ip numeric; v_cash1_before numeric; v_cash1_after numeric;
begin
  select id into v_co from public.companies where slug = 'trio' or name_ar = 'تريو' order by created_at limit 1;
  select m.user_id into v_admin from public.memberships m
   where m.company_id = v_co and m.role = 'admin' and m.is_active order by m.created_at limit 1;
  if v_co is null or v_admin is null then raise exception 'مش لاقي شركة تريو أو الأدمن'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  select id, customer_id into v_h1, v_cust from public.projects where company_id = v_co and code = 'HAFR-01';
  if v_h1 is null then raise exception 'مش لاقي مشروع HAFR-01'; end if;
  v_bm := public.acct(v_co, 'bank_main');
  select coalesce(sum(debit - credit), 0) into v_cash1_before from public.journal_lines l
    join public.accounts a on a.id = l.account_id where a.is_bank and l.project_id = v_h1;

  -- الشريك: الفاتح (الموجود، أو جديد)
  select id into v_partner from public.parties where company_id = v_co and kind = 'partner'
     and (name_ar ilike '%فاتح%' or name_ar ilike '%fatih%' or name_en ilike '%fatih%') order by created_at limit 1;

  -- جزء الفاتح: لو اتعمل من البورتال (مربوط بـ HAFR-01 أو كوده HAFR-02) ومفيش عليه حركات ← نكمّل عليه
  select id into v_h2 from public.projects where company_id = v_co and group_id = v_h1 and id <> v_h1 order by created_at limit 1;
  if v_h2 is null then select id into v_h2 from public.projects where company_id = v_co and code = 'HAFR-02'; end if;
  if v_h2 is not null then
    if exists (select 1 from public.journal_lines where project_id = v_h2) then
      raise exception 'جزء الفاتح عليه حركات قبل كده — الملف ده اتشغّل قبل كده؟ مفيش حاجة اتسجلت';
    end if;
    update public.projects set contract_value = 2511660, advance_pct = 0.20, advance_amount = 502332,
           recovery_pct = 0.20, retention_pct = 0.10, retention_vat_mode = 'A', customer_id = v_cust
     where id = v_h2;
    perform public.update_partner_terms(v_h2, jsonb_build_object(
      'partner_id', v_partner, 'partner_name', 'الفاتح العربية', 'share_pct', 0.10,
      'basis', 'profit_at_close', 'contract_holder', 'partner'));
  else
    v_h2 := public.create_project(v_co, jsonb_build_object(
      'code', 'HAFR-02', 'name_ar', 'حفر الباطن — جزء الفاتح', 'contract_value', 2511660,
      'advance_pct', 0.20, 'recovery_pct', 0.20, 'retention_pct', 0.10, 'start_date', v_adv_date,
      'customer_id', v_cust, 'has_partner', true, 'partner_id', v_partner, 'partner_name', 'الفاتح العربية',
      'share_pct', 0.10, 'basis', 'profit_at_close', 'partner_from', v_adv_date, 'contract_holder', 'partner',
      'partner_notes', '10% من صافي ربح جزء الفاتح عند الإقفال'));
  end if;
  select holder_partner_id into v_partner from public.projects where id = v_h2;
  perform public.set_project_group(v_h2, v_h1);

  -- البنك الرئيسي = فلوس جزء كرم
  update public.accounts set project_id = v_h1 where id = v_bm and project_id is null;

  -- ── المقدم 10%: فاتورة الفاتح ← استلمها الفاتح (ولسه معاه) ──
  insert into public.sales_documents(company_id, project_id, customer_id, doc_type, issue_date, supply_date,
    work_value, printed_total, notes, created_by)
  values (v_co, v_h2, v_cust, 'advance', v_adv_date, v_adv_date, 251166.00, 288840.90,
    'دفعة مقدمة 10% (من 20%) — PO الفاتح 2,511,660',
    case when (select require_separate_approver from public.companies where id = v_co) then null else v_admin end)
  returning id into v_doc;
  perform public.submit_sales_document(v_doc);
  perform public.approve_sales_document(v_doc);
  perform public.record_receipt_with_allocations(v_co, v_cust, v_adv_date, 288840.90, null, null,
    'دفعة مقدمة 10% — استلمها الفاتح', jsonb_build_array(jsonb_build_object('doc', v_doc, 'amount', 288840.90)), v_partner);

  -- ── الفاتح صرف بنفسه على كباين كرم (سلفة على HAFR-01 لجزء الفاتح أوتوماتيك) ──
  perform public.post_expense_by_partner(v_co, jsonb_build_object('partner_project_id', v_h2, 'partner_reclaims_vat', true, 'project_id', v_h1, 'issue_date', '2026-09-30', 
    'supplier_name', 'asphalt guys', 'doc_number', 'Cost-00022', 'net_amount', 70307.83, 'vat_amount', 10546.17, 'total_amount', 80854.00,
    'details', 'CAB-1(19) — asphalt material and labor work (دفعها الفاتح)'));
  perform public.post_expense_by_partner(v_co, jsonb_build_object('partner_project_id', v_h2, 'partner_reclaims_vat', true, 'project_id', v_h1, 'issue_date', '2026-09-30', 
    'supplier_name', 'أدهم', 'doc_number', 'Cost-00023', 'net_amount', 50000.00,
    'details', 'CAB-2(20) — لأدهم يخلّص المدفوعات المعلقة: 5,000 لعبد الواحد (مخالصة نهائية) و5,000 للعمال (دفعها الفاتح)'));
  perform public.post_expense_by_partner(v_co, jsonb_build_object('partner_project_id', v_h2, 'partner_reclaims_vat', true, 'project_id', v_h1, 'issue_date', '2026-09-30', 
    'supplier_name', 'yahflex', 'doc_number', 'Cost-00027', 'net_amount', 17391.30, 'vat_amount', 2608.70, 'total_amount', 20000.00,
    'details', 'CAB-2(20) — yahflex equipment rental (دفعها الفاتح)'));
  perform public.post_expense_by_partner(v_co, jsonb_build_object('partner_project_id', v_h2, 'partner_reclaims_vat', true, 'project_id', v_h1, 'issue_date', '2026-10-04', 
    'supplier_name', 'asphalt guys', 'doc_number', 'Cost-00030', 'net_amount', 15820.00, 'vat_amount', 2373.00, 'total_amount', 18193.00,
    'details', 'CAB-3(21) — asphalt (دفعها الفاتح)'));
  perform public.post_expense_by_partner(v_co, jsonb_build_object('partner_project_id', v_h2, 'partner_reclaims_vat', true, 'project_id', v_h1, 'issue_date', '2026-10-07', 
    'supplier_name', 'Machinery rental', 'doc_number', 'Cost-00031', 'net_amount', 19351.30, 'vat_amount', 2902.70, 'total_amount', 22254.00,
    'details', 'CAB-2(20) — machinery rental (دفعها الفاتح)'));

  -- الفاتح سدّد للهيئة صافي إقراره (ضريبة المقدم ناقص ضريبة المصاريف اللي استرجعها)
  perform public.record_partner_transfer(v_co, v_h2, v_adv_date, 19244.33, 'partner_paid_vat', null,
    'صافي إقرار الفاتح: ضريبة المقدم 37,674.90 − ضريبة المصاريف المسترجعة 18,430.57');

  -- ── نسبة مروان 1.5% من PO الفاتح: بيتسجل اللي اندفع بس (الفاتح دفع 15,000) ──
  perform public.post_expense_by_partner(v_co, jsonb_build_object('partner_project_id', v_h2, 'project_id', v_h2, 'issue_date', '2026-09-30',
    'supplier_name', 'مروان', 'doc_number', 'Cost-00024', 'net_amount', 15000.00,
    'details', 'دفعة من نسبة مروان 1.5% من PO الفاتح — إجمالي النسبة 37,674.90، اتدفع 15,000، الباقي 22,674.90 (دفعها الفاتح)'));

  -- ── مراجعة ──
  select coalesce(sum(l.debit - l.credit), 0) into v_cash from public.journal_lines l
    join public.accounts a on a.id = l.account_id where a.system_key = 'partner_held_cash' and l.project_id = v_h2;
  select coalesce(sum(debit - credit), 0) into v_ip from public.journal_lines l
    join public.accounts a on a.id = l.account_id where a.system_key = 'inter_part' and l.project_id = v_h2;
  select coalesce(sum(debit - credit), 0) into v_cash1_after from public.journal_lines l
    join public.accounts a on a.id = l.account_id where a.is_bank and l.project_id = v_h1;
  if v_cash <> 63295.57 or v_ip <> 172870.43 or exists (select 1 from public.journal_lines l join public.accounts a on a.id = l.account_id
       where a.system_key = 'partner_vat' and l.project_id = v_h2 having sum(l.credit - l.debit) <> 0) or v_cash1_after <> v_cash1_before then
    raise exception 'الأرقام مش مطابقة: الباقي عند الفاتح % (المفروض 63,295.57)، سلفة % (المفروض 172,870.43)، بنك كرم اتغير % → % — مفيش حاجة اتسجلت',
      v_cash, v_ip, v_cash1_before, v_cash1_after;
  end if;
end $$;

select p.code as "الجزء", p.name_ar as "المشروع",
  (select coalesce(sum(bank_net),0) from public.v_project_cash c where c.project_id = p.id)  as "النقدية عندنا",
  (select held_by_partner from public.v_partner_project_accounts x where x.project_id = p.id) as "فلوس المشروع عند الشريك",
  (select coalesce(sum(balance),0)  from public.v_inter_part v where v.project_id = p.id)    as "بين الأجزاء (+ ليه / − عليه)",
  (select net_due_to_company from public.v_partner_project_accounts x where x.project_id = p.id) as "صافي لنا عند الشريك (− = علينا له)"
from public.projects p where p.code in ('HAFR-01','HAFR-02') order by p.code;
