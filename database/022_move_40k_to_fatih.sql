-- =====================================================================
-- Hisabat — السحب النقدي الأخير 40,000 (من فلوس جزء كرم) اتصرف على شغل جزء الفاتح.
-- شغّله مرة واحدة بعد 021.
--
-- اللي بيتنقل لجزء الفاتح (HAFR-02) كتكلفة:
--   OPEN-HAFR-07  مصروفات سابقة            9,200
--   OPEN-HAFR-09  مصروفات متنوعة            13,000
--   دفعة أبو أحمد (بدون فاتورة)             5,000   (لو لسه ما اتخصمتش من فاتورة)
--   عهدة أدهم                               7,000   (وأي فواتير اتصفّت منها على حفر الباطن)
-- والـ 5,800 (OPEN-HAFR-10) بتفضل على جزء كرم: نسبة مروان 1% من PO كرم = 15,905.80
--   اتدفع منها 5,800 والمتبقي 10,105.80 مستحق (يبان في صفحة المصروف)
-- بنك كرم ما بيتغيرش (الفلوس طلعت منه فعلًا)، وبيتسجل: جزء الفاتح مديون لجزء كرم بالمبلغ.
-- =====================================================================
do $$
declare
  v_co uuid; v_admin uuid; p1 uuid; p2 uuid; v_holder2 uuid; v_n int; v_moved numeric(18,2) := 0; v_note text := '';
  r record; a public.supplier_advances; cu public.custody_requests; v_ret numeric(18,2);
  k_adv uuid; k_cus uuid; k_pay uuid; k_pvat uuid; sp public.supplier_payments; v_comm uuid; v_bank_before numeric; v_bank_after numeric;
begin
  select id into v_co from public.companies where slug = 'trio' or name_ar = 'تريو' order by created_at limit 1;
  select m.user_id into v_admin from public.memberships m
   where m.company_id = v_co and m.role = 'admin' and m.is_active order by m.created_at limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  select id into p1 from public.projects where company_id = v_co and code = 'HAFR-01';
  select id, holder_partner_id into p2, v_holder2 from public.projects where company_id = v_co and group_id = p1 and id <> p1 order by created_at limit 1;
  if p1 is null or p2 is null then raise exception 'لازم جزء الفاتح يكون متسجل ومربوط بـ HAFR-01 (شغّل 021 الأول)'; end if;
  if exists (select 1 from public.journal_entries where company_id = v_co and source_type = 'inter_part' and memo like 'نقل السحب النقدي 40,000%') then
    raise exception 'الـ 40,000 اتنقلت قبل كده — مفيش حاجة اتسجلت';
  end if;
  k_adv := public.acct(v_co, 'supplier_advances'); k_cus := public.acct(v_co, 'custody');
  k_pay := public.acct(v_co, 'payables');          k_pvat := public.acct(v_co, 'partner_vat');

  select coalesce(sum(l.debit - l.credit), 0) into v_bank_before from public.journal_lines l join public.accounts x on x.id = l.account_id where x.is_bank;
  alter table public.journal_lines      disable trigger journal_lines_immutable;
  alter table public.purchase_documents disable trigger purchase_doc_guard;

  -- 1) المصروفات التلاتة
  select count(*) into v_n from public.purchase_documents
   where company_id = v_co and project_id = p1 and doc_number in ('OPEN-HAFR-07','OPEN-HAFR-09');
  if v_n <> 2 then raise exception 'لقيت % من 2 مصروفات (OPEN-HAFR-07/09) على HAFR-01 — مفيش حاجة اتسجلت', v_n; end if;
  for r in select * from public.purchase_documents
            where company_id = v_co and project_id = p1 and doc_number in ('OPEN-HAFR-07','OPEN-HAFR-09') loop
    update public.purchase_documents set project_id = p2 where id = r.id;
    update public.journal_lines set project_id = p2 where entry_id = r.journal_entry_id and project_id = p1;
    update public.journal_lines set project_id = p2
     where account_id = k_pay and project_id = p1
       and entry_id in (select journal_entry_id from public.supplier_payments where purchase_document_id = r.id);
    v_moved := v_moved + r.total_amount;
  end loop;

  -- 2) دفعة أبو أحمد
  select * into a from public.supplier_advances where company_id = v_co and reference = 'OPEN-HAFR-08';
  if a.id is not null and a.project_id = p1 then
    if exists (select 1 from public.supplier_payments where advance_id = a.id) then
      v_note := v_note || ' دفعة أبو أحمد اتخصمت من فاتورة قبل كده فما اتنقلتش.';
    else
      update public.supplier_advances set project_id = p2 where id = a.id;
      update public.journal_lines set project_id = p2 where entry_id = a.journal_entry_id and account_id = k_adv;
      v_moved := v_moved + a.amount;
    end if;
  end if;

  -- 3) عهدة أدهم + الفواتير اللي اتصفّت منها على حفر الباطن
  select * into cu from public.custody_requests
   where company_id = v_co and project_id = p1 and purpose like 'باقي السحب النقدي 40,000%' order by created_at limit 1;
  if cu.id is not null then
    update public.custody_requests set project_id = p2 where id = cu.id;
    update public.journal_lines set project_id = p2 where entry_id = cu.journal_entry_id and account_id = k_cus;
    for r in select * from public.purchase_documents where custody_id = cu.id and project_id = p1 loop
      update public.purchase_documents set project_id = p2 where id = r.id;
      update public.journal_lines set project_id = p2,
             party_id = case when account_id = k_pvat then v_holder2 else party_id end
       where entry_id = r.journal_entry_id and project_id = p1;
      update public.journal_lines set project_id = p2
       where project_id = p1 and entry_id in (select journal_entry_id from public.supplier_payments where purchase_document_id = r.id);
    end loop;
    -- مرتجع نقدي رجع لبنك كرم: بيقلل السلفة
    update public.journal_lines set project_id = p2
     where account_id = k_cus and project_id = p1
       and entry_id in (select journal_entry_id from public.custody_settlements where custody_id = cu.id and kind = 'return');
    select coalesce(sum(amount), 0) into v_ret from public.custody_settlements where custody_id = cu.id and kind = 'return';
    v_moved := v_moved + cu.amount - v_ret;
  else
    v_note := v_note || ' عهدة أدهم مش لاقيها على HAFR-01 فما اتنقلتش.';
  end if;

  -- 4) نسبة مروان على PO كرم: الـ 5,800 تتحول لمستند نسبة 1% كامل (15,905.80) اتدفع منه 5,800
  select * into r from public.purchase_documents where company_id = v_co and project_id = p1 and doc_number = 'OPEN-HAFR-10';
  if r.id is null then raise exception 'مش لاقي مصروف نسبة مروان OPEN-HAFR-10 على HAFR-01 — مفيش حاجة اتسجلت'; end if;
  select * into sp from public.supplier_payments where purchase_document_id = r.id;
  if (select count(*) from public.supplier_payments where purchase_document_id = r.id) <> 1 or r.total_amount <> 5800 then
    raise exception 'مصروف نسبة مروان مش زي المتوقع (5,800 بسداد واحد) — مفيش حاجة اتسجلت';
  end if;
  alter table public.journal_entries disable trigger journal_entries_immutable;
  update public.supplier_payments set journal_entry_id = null where id = sp.id;
  update public.purchase_documents set journal_entry_id = null where id = r.id;
  delete from public.journal_lines   where entry_id in (r.journal_entry_id, sp.journal_entry_id);
  delete from public.journal_entries where id in (r.journal_entry_id, sp.journal_entry_id);
  delete from public.supplier_payments where id = sp.id;
  delete from public.purchase_documents where id = r.id;
  alter table public.journal_entries enable trigger journal_entries_immutable;
  alter table public.journal_lines      enable trigger journal_lines_immutable;
  alter table public.purchase_documents enable trigger purchase_doc_guard;

  v_comm := public.post_expense(v_co, jsonb_build_object('project_id', p1, 'issue_date', r.issue_date, 'payment', 'credit',
    'supplier_id', r.supplier_id, 'doc_number', 'COMM-HAFR-01', 'net_amount', 15905.80,
    'details', 'نسبة مروان 1% من PO كرم (1,590,579.50 قبل الضريبة) — المدفوع والمتبقي في خانة السداد'));
  perform public.pay_purchase(v_comm, sp.pay_date, 5800.00, sp.bank_account_id, 'OPEN-HAFR-10 — من السحب النقدي 40,000');

  -- السلفة: جزء الفاتح مديون لجزء كرم
  perform public.post_inter_part(v_co, '2026-09-13', p1, p1, p2, v_moved, null,
    'نقل السحب النقدي 40,000 لجزء الفاتح — فلوس كرم اتصرفت على شغل الفاتح' || v_note);

  if (select sum(debit) - sum(credit) from public.journal_lines) <> 0 then raise exception 'الميزان اتلخبط — اتلغى'; end if;
  select coalesce(sum(l.debit - l.credit), 0) into v_bank_after from public.journal_lines l join public.accounts x on x.id = l.account_id where x.is_bank;
  if v_bank_after <> v_bank_before then raise exception 'رصيد البنوك اتغير — اتلغى'; end if;
  raise notice 'اتنقل % لجزء الفاتح.%', v_moved, v_note;
end $$;

select p.code as "الجزء",
  (select coalesce(sum(bank_net),0) from public.v_project_cash c where c.project_id = p.id) as "النقدية",
  (select coalesce(sum(balance),0)  from public.v_inter_part v where v.project_id = p.id)   as "بين الأجزاء (+ ليه / − عليه)",
  (select memo from public.journal_entries e where e.source_type = 'inter_part' and e.memo like 'نقل السحب النقدي 40,000%' limit 1) as "ملاحظة"
from public.projects p where p.code in ('HAFR-01','HAFR-02') order by p.code;
