-- =====================================================================
-- Hisabat — تحويل دفعة أبو أحمد (5,000 إيجار معدات) من مصروف إلى دفعة مقدمة
-- شغّله مرة واحدة بعد 016. الكاش ما بيتغيرش؛ تكلفة المشروع بتقل 5,000
-- لحد ما فاتورة أبو أحمد تيجي وتتخصم من الدفعة.
-- =====================================================================
do $$
declare d public.purchase_documents; v_pay public.supplier_payments; v_n int; v_adv uuid; v_bank_before numeric; v_bank_after numeric;
  v_admin uuid; v_entries uuid[];
begin
  select * into d from public.purchase_documents where doc_number = 'OPEN-HAFR-08' and status = 'posted';
  if not found then raise exception 'مش لاقي مصروف أبو أحمد (OPEN-HAFR-08) — يمكن اتحوّل قبل كده'; end if;
  if d.total_amount <> 5000 then raise exception 'مبلغ المصروف % مش 5,000 — وقفت', d.total_amount; end if;
  select count(*) into v_n from public.supplier_payments where purchase_document_id = d.id;
  if v_n <> 1 then raise exception 'المصروف عليه % سداد — المتوقع واحد بس', v_n; end if;
  select * into v_pay from public.supplier_payments where purchase_document_id = d.id;
  if exists (select 1 from public.accounts where id = v_pay.bank_account_id and not is_bank) then
    raise exception 'السداد مش من بنك/صندوق — وقفت';
  end if;

  select m.user_id into v_admin from public.memberships m
   where m.company_id = d.company_id and m.role = 'admin' and m.is_active order by m.created_at limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  select coalesce(sum(debit - credit), 0) into v_bank_before from public.journal_lines where account_id = v_pay.bank_account_id;
  v_entries := array[d.journal_entry_id, v_pay.journal_entry_id];

  alter table public.journal_entries    disable trigger journal_entries_immutable;
  alter table public.journal_lines      disable trigger journal_lines_immutable;
  alter table public.purchase_documents disable trigger purchase_doc_guard;
  update public.supplier_payments set journal_entry_id = null where id = v_pay.id;
  update public.purchase_documents set journal_entry_id = null where id = d.id;
  delete from public.journal_lines   where entry_id = any(v_entries);
  delete from public.journal_entries where id = any(v_entries);
  delete from public.supplier_payments where id = v_pay.id;
  delete from public.purchase_documents where id = d.id;
  alter table public.journal_entries    enable trigger journal_entries_immutable;
  alter table public.journal_lines      enable trigger journal_lines_immutable;
  alter table public.purchase_documents enable trigger purchase_doc_guard;

  v_adv := public.pay_supplier_advance(d.company_id, jsonb_build_object(
    'supplier_id', d.supplier_id, 'project_id', d.project_id, 'pay_date', d.issue_date, 'amount', 5000,
    'account_id', v_pay.bank_account_id, 'reference', 'OPEN-HAFR-08',
    'notes', 'دفعة مقدمة إيجار معدات — أبو أحمد (من السحب النقدي 40,000)'));

  select coalesce(sum(debit - credit), 0) into v_bank_after from public.journal_lines where account_id = v_pay.bank_account_id;
  if v_bank_after <> v_bank_before then raise exception 'رصيد البنك اتغير — اتلغى التحويل'; end if;
end $$;

select s.name_ar as "المورد", a.pay_date as "التاريخ", a.amount as "الدفعة المقدمة", a.notes as "البيان"
  from public.supplier_advances a join public.parties s on s.id = a.supplier_id
 where a.reference = 'OPEN-HAFR-08';
