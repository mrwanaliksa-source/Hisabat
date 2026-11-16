-- =====================================================================
-- Hisabat — إدخال مشروع حفر الباطن من نصه (رصيد مرحل حتى 2026-09-13)
-- شغّله مرة واحدة بعد 014. لو اتشغّل قبل كده بيرفض (مفيش تكرار).
--
-- المشروع : مشروع حفر الباطن — العميل مهاد الدرعية (MDC)
-- العقد   : 1,590,579.50 قبل الضريبة — دفعة مقدمة 20% — استرداد 20% — محتجز 10%
--           باسم الشريك «كرم الإعمار» (هو اللي بيفوتر ويستلم)، ونسبته 5% من كل تحصيل بعد الضريبة
--           الضريبة على 70% (بعد الاسترداد والمحتجز) زي فواتير الشريك الفعلية
--
-- المقبوض عند الشريك 775,163.48:
--   دفعة مقدمة 50,000.00 (2026-08-25) + 315,830.00 (2026-08-26)
--   بيع حواجز (أخرى) 48,300.00 (2026-08-26) + 30,000.00 (2026-09-09)
--   مستخلصات سابقة (رصيد مرحل) 331,033.48 = 100,000 + 50,000 + 50,000 + 131,033.48
-- الشريك خصم: الضريبة 101,108.28 + نسبته 33,702.76 + الزكاة 4,634.13 وحوّل لنا 635,718.31
-- المصروفات 526,752.08، ورد ضريبة المشتريات 40,693.92 ← الكاش 149,660.15 + عهدة أدهم 7,000
-- =====================================================================

-- ── تسوية الرصيد الافتتاحي: مرة واحدة بس ثم تتقفل ─────────────────────
alter table public.projects add column if not exists opening_cash          numeric(18,2);
alter table public.projects add column if not exists opening_adjusted_at   timestamptz;
alter table public.projects add column if not exists opening_adjusted_by   uuid references auth.users(id);
alter table public.projects add column if not exists opening_adjust_amount numeric(18,2);
alter table public.projects add column if not exists opening_adjust_reason text;

-- p_actual = الكاش الفعلي من المشروع؛ الفرق عن الرصيد المرحل يتسجل تسوية على تكلفة المشروع
create or replace function public.adjust_opening_cash(p_project uuid, p_actual numeric, p_date date, p_reason text)
returns numeric language plpgsql security definer set search_path = public as $$
declare pr public.projects; v_diff numeric(18,2); v_bank uuid;
begin
  select * into pr from public.projects where id = p_project for update;
  if not found then raise exception 'Project not found'; end if;
  perform public.require_role(pr.company_id, array['admin']::public.app_role[]);
  if pr.opening_cash is null then raise exception 'المشروع ده مالوش رصيد مرحل / No opening balance on this project'; end if;
  if pr.opening_adjusted_at is not null then
    raise exception 'الرصيد الافتتاحي اتسوّى قبل كده واتقفل / Opening balance was already adjusted and is locked';
  end if;
  if coalesce(trim(p_reason),'') = '' then raise exception 'سبب التسوية مطلوب / Reason is required'; end if;
  if p_actual is null or p_actual < 0 then raise exception 'المبلغ غير صحيح / Invalid amount'; end if;
  v_diff := round(p_actual - pr.opening_cash, 2);
  v_bank := public.acct(pr.company_id, 'bank_main');
  if v_diff <> 0 then
    perform public.post_journal(pr.company_id, coalesce(p_date, current_date), 'opening_adjustment', p_project,
      'تسوية الرصيد الافتتاحي ' || pr.code || ' — ' || trim(p_reason),
      case when v_diff > 0 then jsonb_build_array(
        jsonb_build_object('account', v_bank::text, 'debit', v_diff, 'project', p_project),
        jsonb_build_object('account', 'direct_cost', 'credit', v_diff, 'project', p_project))
      else jsonb_build_array(
        jsonb_build_object('account', 'direct_cost', 'debit', -v_diff, 'project', p_project),
        jsonb_build_object('account', v_bank::text, 'credit', -v_diff, 'project', p_project)) end);
  end if;
  update public.projects set opening_adjusted_at = now(), opening_adjusted_by = auth.uid(),
         opening_adjust_amount = v_diff, opening_adjust_reason = trim(p_reason)
   where id = p_project;
  return v_diff;
end $$;
revoke execute on function public.adjust_opening_cash(uuid,numeric,date,text) from public, anon;
grant execute on function public.adjust_opening_cash(uuid,numeric,date,text) to authenticated;

create or replace function pg_temp.onb_doc(p_company uuid, p_project uuid, p_customer uuid, p_type public.sales_doc_type,
  p_date date, p_value numeric, p_total numeric, p_ref text, p_notes text, p_creator uuid, p_approver uuid)
returns uuid language plpgsql as $$
declare v uuid;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_creator, 'role', 'authenticated')::text, true);
  insert into public.sales_documents(company_id, project_id, customer_id, doc_type, issue_date, supply_date,
    work_value, printed_total, issuer_ref, notes, created_by)
  values (p_company, p_project, p_customer, p_type, p_date, p_date, p_value, p_total, p_ref, p_notes, p_creator)
  returning id into v;
  perform public.submit_sales_document(v);
  perform set_config('request.jwt.claims', json_build_object('sub', p_approver, 'role', 'authenticated')::text, true);
  perform public.approve_sales_document(v);
  perform set_config('request.jwt.claims', json_build_object('sub', p_creator, 'role', 'authenticated')::text, true);
  return v;
end $$;

do $$
declare
  v_company uuid; c public.companies; v_admin uuid; v_approver uuid; v_adham uuid; v_bank uuid;
  v_proj uuid; v_cust uuid; v_partner uuid; v_n int;
  d_adv1 uuid; d_adv2 uuid; d_bar1 uuid; d_bar2 uuid; d_claims uuid; v_cu uuid;
  v_d date := '2026-09-13';
  v_held numeric; v_bank_move numeric;
begin
  -- ── الشركة والمستخدمين ─────────────────────────────────────────────
  select count(*) into v_n from public.companies;
  if v_n = 1 then select id into v_company from public.companies;
  else select id into v_company from public.companies where name_ar = 'تريو' or name_en ilike 'trio' limit 1; end if;
  if v_company is null then raise exception 'مش لاقي شركة تريو'; end if;
  select * into c from public.companies where id = v_company;

  select m.user_id into v_admin from public.memberships m
   where m.company_id = v_company and m.role = 'admin' and m.is_active
   order by m.created_at limit 1;
  if v_admin is null then raise exception 'مش لاقي أدمن للشركة'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  v_approver := v_admin;
  if c.require_separate_approver then
    select m.user_id into v_approver from public.memberships m
     where m.company_id = v_company and m.role in ('admin','reviewer') and m.is_active and m.user_id <> v_admin
     order by m.role, m.created_at limit 1;
    if v_approver is null then raise exception 'الشركة محتاجة معتمد تاني غير الأدمن'; end if;
  end if;

  -- أدهم: اسم المستخدم a.elsaegh
  select u.id into v_adham from auth.users u join public.memberships m on m.user_id = u.id and m.company_id = v_company
   where lower(u.email) = 'a.elsaegh@hisabat.local';
  if v_adham is null then raise exception 'مش لاقي المستخدم a.elsaegh (أدهم) في الشركة'; end if;
  if c.custody_approver_1 is null or c.custody_approver_2 is null then
    raise exception 'حدّد مديري اعتماد العهد الأول (الإعدادات) قبل تشغيل الملف';
  end if;

  if exists (select 1 from public.projects where company_id = v_company and name_ar = 'مشروع حفر الباطن') then
    raise exception 'مشروع حفر الباطن متسجل قبل كده — الملف ده بيتشغل مرة واحدة بس';
  end if;
  v_bank := public.acct(v_company, 'bank_main');

  -- ── العميل والشريك (لو موجودين نستخدمهم) ───────────────────────────
  select id into v_cust from public.parties where company_id = v_company and kind = 'customer'
     and (name_ar ilike '%مهاد%' or name_ar ilike '%MDC%' or name_en ilike '%MDC%') order by created_at limit 1;
  select id into v_partner from public.parties where company_id = v_company and kind = 'partner'
     and name_ar ilike '%كرم%' order by created_at limit 1;

  -- ── المشروع ────────────────────────────────────────────────────────
  v_proj := public.create_project(v_company, jsonb_build_object(
    'code', 'HAFR-01', 'name_ar', 'مشروع حفر الباطن', 'contract_value', 1590579.50,
    'advance_pct', 0.20, 'recovery_pct', 0.20, 'retention_pct', 0.10,
    'start_date', '2026-08-25',
    'customer_id', v_cust, 'customer_name', 'مهاد الدرعية (MDC)',
    'has_partner', true, 'partner_id', v_partner, 'partner_name', 'كرم الإعمار',
    'share_pct', 0.05, 'basis', 'collections', 'partner_from', '2026-08-25',
    'contract_holder', 'partner',
    'partner_notes', 'نسبة 5% من كل تحصيل بعد خصم الضريبة'));
  select customer_id, holder_partner_id into v_cust, v_partner from public.projects where id = v_proj;
  -- فواتير الشريك: الضريبة على الأعمال بعد الاسترداد والمحتجز (70%)
  update public.projects set retention_vat_mode = 'B' where id = v_proj;

  -- ── المبيعات (اللي فوترها الشريك) ─────────────────────────────────
  d_adv1   := pg_temp.onb_doc(v_company, v_proj, v_cust, 'advance', '2026-08-25', 43478.26, 50000.00, null,
                'دفعة مقدمة من مهاد الدرعية', v_admin, v_approver);
  d_adv2   := pg_temp.onb_doc(v_company, v_proj, v_cust, 'advance', '2026-08-26', 274634.78, 315830.00, null,
                'دفعة مقدمة من مهاد الدرعية', v_admin, v_approver);
  d_bar1   := pg_temp.onb_doc(v_company, v_proj, v_cust, 'other', '2026-08-26', 42000.00, 48300.00, null,
                'بيع حواجز', v_admin, v_approver);
  d_bar2   := pg_temp.onb_doc(v_company, v_proj, v_cust, 'other', '2026-09-09', 26086.96, 30000.00, null,
                'بيع حواجز — لم تفوتر', v_admin, v_approver);
  -- أعمال 411,221.71 − استرداد 20% − محتجز 10% = 287,855.20 + ضريبة 43,178.28 = 331,033.48
  d_claims := pg_temp.onb_doc(v_company, v_proj, v_cust, 'progress_claim', v_d, 411221.71, 331033.48, 'OPEN-HAFR-CLAIMS',
                'مستخلصات سابقة — رصيد مرحل: 100,000 + 50,000 + 50,000 + 131,033.48', v_admin, v_approver);
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  -- ── التحصيل (استلمه الشريك) — حصة الشريك 5% بتتحسب تلقائي ─────────
  perform public.record_receipt_with_allocations(v_company, v_cust, '2026-08-25', 50000.00, null, null,
    'دفعة مقدمة', jsonb_build_array(jsonb_build_object('doc', d_adv1, 'amount', 50000.00)), v_partner);
  perform public.record_receipt_with_allocations(v_company, v_cust, '2026-08-26', 315830.00, null, null,
    'دفعة مقدمة', jsonb_build_array(jsonb_build_object('doc', d_adv2, 'amount', 315830.00)), v_partner);
  perform public.record_receipt_with_allocations(v_company, v_cust, '2026-08-26', 48300.00, null, null,
    'بيع حواجز', jsonb_build_array(jsonb_build_object('doc', d_bar1, 'amount', 48300.00)), v_partner);
  perform public.record_receipt_with_allocations(v_company, v_cust, '2026-09-09', 30000.00, null, null,
    'بيع حواجز', jsonb_build_array(jsonb_build_object('doc', d_bar2, 'amount', 30000.00)), v_partner);
  perform public.record_receipt_with_allocations(v_company, v_cust, v_d, 331033.48, null, 'OPEN-HAFR',
    'مستخلصات سابقة — رصيد مرحل', jsonb_build_array(jsonb_build_object('doc', d_claims, 'amount', 331033.48)), v_partner);

  -- ── حركات الشريك ──────────────────────────────────────────────────
  perform public.record_partner_transfer(v_company, v_proj, v_d, 101108.28, 'partner_paid_vat', null, 'أمانة الضريبة — رصيد مرحل');
  perform public.record_partner_transfer(v_company, v_proj, v_d, 33702.76, 'partner_kept_share', null, 'نسبة 5% — رصيد مرحل');
  perform public.record_partner_transfer(v_company, v_proj, v_d, 4634.13, 'partner_kept_zakat', null, 'زكاة — رصيد مرحل');
  perform public.record_partner_transfer(v_company, v_proj, v_d, 635718.31, 'to_company', v_bank, 'صافي التحويلات — رصيد مرحل');

  -- ── المصروفات (اتصرفت من التحويلات) ─────────────────────────────────
  perform public.post_expense(v_company, jsonb_build_object('project_id', v_proj, 'issue_date', v_d, 'payment', 'account', 'account_id', v_bank,
    'supplier_name', 'م. فتحي', 'doc_number', 'OPEN-HAFR-01', 'net_amount', 42000.00,
    'details', 'نقدًا 50,000 ناقص 8,000 اتصفوا (كاش بيد أحمد فتحي) — رصيد مرحل'));
  perform public.post_expense(v_company, jsonb_build_object('project_id', v_proj, 'issue_date', v_d, 'payment', 'account', 'account_id', v_bank,
    'supplier_name', 'م. طه', 'doc_number', 'OPEN-HAFR-02', 'net_amount', 142338.80,
    'details', 'مصاريف حفر الباطن — رصيد مرحل'));
  perform public.post_expense(v_company, jsonb_build_object('project_id', v_proj, 'issue_date', v_d, 'payment', 'account', 'account_id', v_bank,
    'supplier_name', 'م. فتحي', 'doc_number', 'OPEN-HAFR-03', 'net_amount', 199534.20,
    'details', 'تحويلات — رصيد مرحل'));
  perform public.post_expense(v_company, jsonb_build_object('project_id', v_proj, 'issue_date', v_d, 'payment', 'account', 'account_id', v_bank,
    'supplier_name', 'مصروفات سابقة', 'doc_number', 'OPEN-HAFR-04', 'net_amount', 4352.75,
    'details', 'فاتورة معدات — رصيد مرحل'));
  perform public.post_expense(v_company, jsonb_build_object('project_id', v_proj, 'issue_date', v_d, 'payment', 'account', 'account_id', v_bank,
    'supplier_name', 'مصروفات سابقة', 'doc_number', 'OPEN-HAFR-05', 'net_amount', 12937.00,
    'details', 'ترنشر — رصيد مرحل'));
  perform public.post_expense(v_company, jsonb_build_object('project_id', v_proj, 'issue_date', v_d, 'payment', 'account', 'account_id', v_bank,
    'supplier_name', 'مصروفات سابقة', 'doc_number', 'OPEN-HAFR-06', 'net_amount', 85589.33,
    'details', 'فاتورة أسفلت — رصيد مرحل'));
  -- السحب النقدي 40,000 = 9,200 + 5,000 + 13,000 + 5,800 + عهدة أدهم 7,000
  perform public.post_expense(v_company, jsonb_build_object('project_id', v_proj, 'issue_date', v_d, 'payment', 'account', 'account_id', v_bank,
    'supplier_name', 'مصروفات سابقة', 'doc_number', 'OPEN-HAFR-07', 'net_amount', 9200.00,
    'details', 'مصروفات سابقة من السحب النقدي 40,000'));
  perform public.post_expense(v_company, jsonb_build_object('project_id', v_proj, 'issue_date', v_d, 'payment', 'account', 'account_id', v_bank,
    'supplier_name', 'أبو أحمد', 'doc_number', 'OPEN-HAFR-08', 'net_amount', 5000.00,
    'details', 'دفعة مقدمة إيجار معدات — من السحب النقدي 40,000'));
  perform public.post_expense(v_company, jsonb_build_object('project_id', v_proj, 'issue_date', v_d, 'payment', 'account', 'account_id', v_bank,
    'supplier_name', 'مصروفات متنوعة', 'doc_number', 'OPEN-HAFR-09', 'net_amount', 13000.00,
    'details', 'مصروفات متنوعة — من السحب النقدي 40,000'));
  perform public.post_expense(v_company, jsonb_build_object('project_id', v_proj, 'issue_date', v_d, 'payment', 'account', 'account_id', v_bank,
    'supplier_name', 'مروان', 'doc_number', 'OPEN-HAFR-10', 'net_amount', 5800.00,
    'details', 'نسبة مروان 1.5% من المبيعات — من السحب النقدي 40,000'));

  -- ── رد ضريبة المشتريات (إقرار 2026-08) يقلل تكلفة المشروع ───────────
  perform public.post_journal(v_company, v_d, 'opening_adjustment', v_proj,
    'رد ضريبة المشتريات المسلم فواتيرها في إقرار 2026-08 — مشروع حفر الباطن',
    jsonb_build_array(
      jsonb_build_object('account', v_bank::text, 'debit', 40693.92, 'project', v_proj),
      jsonb_build_object('account', 'direct_cost', 'credit', 40693.92, 'project', v_proj)));

  -- ── عهدة أدهم 7,000 (طلب ← موافقة أولى ← موافقة تانية وصرف) ──────────
  perform set_config('request.jwt.claims', json_build_object('sub', v_adham, 'role', 'authenticated')::text, true);
  v_cu := public.request_custody(v_company, 7000.00, 'باقي السحب النقدي 40,000 — يصفيها أدهم', v_proj);
  perform set_config('request.jwt.claims', json_build_object('sub', c.custody_approver_1, 'role', 'authenticated')::text, true);
  perform public.approve_custody(v_cu, null, v_d);
  perform set_config('request.jwt.claims', json_build_object('sub', c.custody_approver_2, 'role', 'authenticated')::text, true);
  perform public.approve_custody(v_cu, v_bank, v_d);
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  -- ── مراجعة: لازم الشريك ما يبقاش معاه حاجة، وحركة البنك = 149,660.15 ─
  select coalesce(sum(l.debit - l.credit), 0) into v_held from public.journal_lines l
   where l.project_id = v_proj and l.account_id = public.acct(v_company, 'partner_held_cash');
  select coalesce(sum(l.debit - l.credit), 0) into v_bank_move from public.journal_lines l
   where l.project_id = v_proj and l.account_id = v_bank;
  if v_held <> 0 or v_bank_move <> 149660.15 then
    raise exception 'الأرقام مش مطابقة: عند الشريك % ، صافي البنك من المشروع % (المفروض 0 و 149,660.15) — مفيش حاجة اتسجلت', v_held, v_bank_move;
  end if;
  update public.projects set opening_cash = 149660.15 where id = v_proj;
end $$;

notify pgrst, 'reload schema';

-- ملخص المشروع بعد الإدخال
select p.code as "الكود", p.name_ar as "المشروع",
  (select sum(collectible_total) from public.sales_documents s where s.project_id = p.id and s.status = 'posted') as "المحصل",
  (select coalesce(sum(l.debit - l.credit),0) from public.journal_lines l
     where l.project_id = p.id and l.account_id = public.acct(p.company_id,'bank_main'))          as "صافي البنك من المشروع",
  (select outstanding from public.v_partner_balances b where b.project_id = p.id)               as "مستحق للشريك",
  (select coalesce(sum(debit - credit),0) from public.journal_lines l
     where l.project_id = p.id and l.account_id = public.acct(p.company_id,'custody'))            as "عهدة أدهم",
  (select advance_outstanding from public.v_project_advance_retention v where v.project_id = p.id)   as "الدفعة المقدمة المتبقية",
  (select retention_outstanding from public.v_project_advance_retention v where v.project_id = p.id) as "المحتجز المتبقي"
from public.projects p where p.name_ar = 'مشروع حفر الباطن';
