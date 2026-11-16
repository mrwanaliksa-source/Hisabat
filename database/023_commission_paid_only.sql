-- =====================================================================
-- Hisabat — نسبة مروان: يتسجل اللي اندفع بس (مش النسبة كلها). شغّله مرة واحدة.
--   • على الفاتح: COMM-HAFR-02 (37,674.90 اتدفع منها 15,000) ← مصروف 15,000 مدفوع
--   • على كرم:   COMM-HAFR-01 (15,905.80 اتدفع منها 5,800) ← مصروف 5,800 مدفوع
--                (لو لسه اسمه OPEN-HAFR-10 بيتصحح بيانه بس)
-- الإجمالي والباقي مكتوبين في بيان كل مصروف. البنك وفلوس الشريك ما بيتغيروش.
-- =====================================================================
do $$
declare
  v_co uuid; v_admin uuid; d public.purchase_documents; sp public.supplier_payments; v_n int; v_new uuid;
  v_bank_before numeric; v_held_before numeric; v_bank_after numeric; v_held_after numeric; k_held uuid;
  v_done text := '';
  rec record;
begin
  select id into v_co from public.companies where slug = 'trio' or name_ar = 'تريو' order by created_at limit 1;
  select m.user_id into v_admin from public.memberships m
   where m.company_id = v_co and m.role = 'admin' and m.is_active order by m.created_at limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  k_held := public.acct(v_co, 'partner_held_cash');
  select coalesce(sum(l.debit - l.credit), 0) into v_bank_before from public.journal_lines l join public.accounts a on a.id = l.account_id where a.is_bank and a.company_id = v_co;
  select coalesce(sum(l.debit - l.credit), 0) into v_held_before from public.journal_lines l where l.account_id = k_held;

  for rec in select * from (values
      ('COMM-HAFR-02', 'Cost-00024', 'دفعة من نسبة مروان 1.5% من PO الفاتح — إجمالي النسبة 37,674.90، اتدفع 15,000، الباقي 22,674.90 (دفعها الفاتح)'),
      ('COMM-HAFR-01', 'OPEN-HAFR-10', 'دفعة من نسبة مروان 1% من PO كرم — إجمالي النسبة 15,905.80، اتدفع 5,800، الباقي 10,105.80 (من السحب النقدي 40,000)')
    ) as t(old_no, new_no, details) loop
    select * into d from public.purchase_documents where company_id = v_co and doc_number = rec.old_no and status = 'posted';
    if d.id is null then continue; end if;
    select count(*) into v_n from public.supplier_payments where purchase_document_id = d.id;
    if v_n <> 1 then raise exception 'المستند % عليه % سداد — المتوقع واحد. مفيش حاجة اتسجلت', rec.old_no, v_n; end if;
    select * into sp from public.supplier_payments where purchase_document_id = d.id;
    if exists (select 1 from public.journal_entries where source_id = sp.id and source_type = 'inter_part') then
      raise exception 'سداد % عليه سلفة بين الأجزاء — ابعتلي. مفيش حاجة اتسجلت', rec.old_no;
    end if;

    -- امسح المستند القديم وقيوده
    alter table public.journal_entries    disable trigger journal_entries_immutable;
    alter table public.journal_lines      disable trigger journal_lines_immutable;
    alter table public.purchase_documents disable trigger purchase_doc_guard;
    update public.supplier_payments set journal_entry_id = null where id = sp.id;
    update public.purchase_documents set journal_entry_id = null where id = d.id;
    delete from public.journal_lines   where entry_id in (d.journal_entry_id, sp.journal_entry_id);
    delete from public.journal_entries where id in (d.journal_entry_id, sp.journal_entry_id);
    delete from public.supplier_payments where id = sp.id;
    delete from public.purchase_documents where id = d.id;
    alter table public.journal_entries    enable trigger journal_entries_immutable;
    alter table public.journal_lines      enable trigger journal_lines_immutable;
    alter table public.purchase_documents enable trigger purchase_doc_guard;

    -- سجّل اللي اندفع بس، بنفس طريقة الدفع والتاريخ
    if sp.bank_account_id = k_held then
      v_new := public.post_expense_by_partner(v_co, jsonb_build_object('partner_project_id', d.project_id, 'project_id', d.project_id,
        'issue_date', sp.pay_date, 'supplier_id', d.supplier_id, 'doc_number', rec.new_no, 'net_amount', sp.amount, 'details', rec.details));
    else
      v_new := public.post_expense(v_co, jsonb_build_object('project_id', d.project_id, 'issue_date', sp.pay_date, 'payment', 'account',
        'account_id', sp.bank_account_id, 'supplier_id', d.supplier_id, 'doc_number', rec.new_no, 'net_amount', sp.amount, 'details', rec.details));
    end if;
    v_done := v_done || ' ' || rec.old_no || ' ← ' || sp.amount;
  end loop;

  -- لو نسبة كرم لسه OPEN-HAFR-10 (ما اتحولتش): صحح البيان بس
  alter table public.purchase_documents disable trigger purchase_doc_guard;
  update public.purchase_documents
     set details = 'دفعة من نسبة مروان 1% من PO كرم — إجمالي النسبة 15,905.80، اتدفع 5,800، الباقي 10,105.80 (من السحب النقدي 40,000)'
   where company_id = v_co and doc_number = 'OPEN-HAFR-10' and details not like 'دفعة من نسبة مروان%';
  alter table public.purchase_documents enable trigger purchase_doc_guard;

  select coalesce(sum(l.debit - l.credit), 0) into v_bank_after from public.journal_lines l join public.accounts a on a.id = l.account_id where a.is_bank and a.company_id = v_co;
  select coalesce(sum(l.debit - l.credit), 0) into v_held_after from public.journal_lines l where l.account_id = k_held;
  if v_bank_after <> v_bank_before or v_held_after <> v_held_before then
    raise exception 'البنك أو فلوس الشريك اتغيرت — اتلغى. مفيش حاجة اتسجلت';
  end if;
  if (select sum(debit) - sum(credit) from public.journal_lines) <> 0 then raise exception 'الميزان اتلخبط — اتلغى'; end if;
  raise notice 'تم:%', v_done;
end $$;

select d.doc_number as "المستند", p.code as "المشروع", d.total_amount as "المبلغ", b.balance as "متبقي", d.details as "البيان"
  from public.purchase_documents d join public.projects p on p.id = d.project_id
  join public.v_purchase_balances b on b.id = d.id
 where d.doc_number in ('Cost-00024', 'OPEN-HAFR-10', 'COMM-HAFR-01', 'COMM-HAFR-02') order by 2;
