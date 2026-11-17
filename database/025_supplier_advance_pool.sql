-- =====================================================================
-- Hisabat — دفعات المورد الواحد بدون فواتير = رصيد واحد. Run once, after 024.
-- الفاتورة بتتخصم من مجموع دفعات المورد، الأقدم الأول.
-- =====================================================================

-- deduct up to p_amount from all of the invoice supplier's open advances (oldest first)
create or replace function public.apply_supplier_advances(p_doc uuid, p_amount numeric, p_date date default current_date)
returns numeric language plpgsql security definer set search_path = public as $$
declare d public.purchase_documents; a record; v_left numeric(18,2) := round(p_amount, 2); v_take numeric(18,2);
  v_doc_left numeric; v_pool numeric; v_done numeric(18,2) := 0;
begin
  select * into d from public.purchase_documents where id = p_doc and status = 'posted';
  if not found then raise exception 'الفاتورة غير موجودة أو غير مرحلة / Invoice not found or not posted'; end if;
  perform public.require_role(d.company_id, array['admin','reviewer','expense']::public.app_role[]);
  select d.total_amount - coalesce(sum(amount),0) into v_doc_left from public.supplier_payments where purchase_document_id = d.id;
  select coalesce(sum(public.supplier_advance_balance(id)), 0) into v_pool
    from public.supplier_advances where company_id = d.company_id and supplier_id = d.supplier_id;
  if v_left <= 0 then raise exception 'المبلغ يجب أن يكون أكبر من صفر / Amount must be greater than zero'; end if;
  if v_left > v_doc_left then raise exception 'المبلغ أكبر من المتبقي على الفاتورة % / Exceeds invoice balance', v_doc_left; end if;
  if v_left > v_pool then raise exception 'المبلغ أكبر من رصيد دفعات المورد % / Exceeds the supplier''s advances', v_pool; end if;
  for a in select id, public.supplier_advance_balance(id) as bal from public.supplier_advances
            where company_id = d.company_id and supplier_id = d.supplier_id
            order by pay_date, created_at loop
    exit when v_left <= 0;
    continue when a.bal <= 0;
    v_take := least(v_left, a.bal);
    perform public.apply_supplier_advance(p_doc, a.id, v_take, p_date);
    v_left := v_left - v_take; v_done := v_done + v_take;
  end loop;
  return v_done;
end $$;

-- new expense paid from the supplier's advances; anything above them stays payable
-- p = post_expense fields + supplier_id (the advances' supplier)
create or replace function public.post_expense_from_advances(p_company uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_doc uuid; v_total numeric; v_pool numeric; v_supp uuid := nullif(p->>'supplier_id','')::uuid;
begin
  if v_supp is null then raise exception 'اختر المورد / Choose the supplier'; end if;
  v_doc := public.post_expense(p_company, (p - 'payment' - 'supplier_name' - 'advance_id') || jsonb_build_object('payment','credit'));
  select total_amount into v_total from public.purchase_documents where id = v_doc;
  select coalesce(sum(public.supplier_advance_balance(id)), 0) into v_pool
    from public.supplier_advances where company_id = p_company and supplier_id = v_supp;
  if least(v_total, v_pool) > 0 then
    perform public.apply_supplier_advances(v_doc, least(v_total, v_pool), coalesce(nullif(p->>'issue_date','')::date, current_date));
  end if;
  return v_doc;
end $$;

-- per supplier: open advances in one figure
create or replace view public.v_supplier_advance_pool with (security_invoker = on) as
select company_id, supplier_id, supplier_name, count(*) as payments, min(pay_date) as oldest, sum(balance) as balance
  from public.v_supplier_advances where balance > 0
 group by company_id, supplier_id, supplier_name;

revoke execute on function public.apply_supplier_advances(uuid,numeric,date) from public, anon;
revoke execute on function public.post_expense_from_advances(uuid,jsonb) from public, anon;
grant execute on function public.apply_supplier_advances(uuid,numeric,date), public.post_expense_from_advances(uuid,jsonb) to authenticated;

notify pgrst, 'reload schema';

select supplier_name as "المورد", payments as "عدد الدفعات", balance as "الرصيد بدون فواتير" from public.v_supplier_advance_pool order by oldest;
