-- =====================================================================
-- Hisabat — receipts with allocations in ONE transaction. Run once.
-- p_allocations = [{"doc": "<sales_document id>", "amount": 41000}, ...]
-- If any allocation fails, the receipt itself is not saved either.
-- =====================================================================
create or replace function public.record_receipt_with_allocations(
  p_company uuid, p_customer uuid, p_date date, p_amount numeric, p_bank_account uuid,
  p_reference text, p_notes text, p_allocations jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_receipt uuid; a jsonb;
begin
  v_receipt := public.record_receipt(p_company, p_customer, p_date, p_amount, p_bank_account, p_reference, p_notes);
  for a in select * from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb)) loop
    continue when coalesce(nullif(a->>'amount','')::numeric, 0) = 0;
    perform public.allocate_receipt(v_receipt, (a->>'doc')::uuid, (a->>'amount')::numeric);
  end loop;
  return v_receipt;
end $$;

-- allocate the unallocated part of an existing receipt
create or replace function public.allocate_receipt_many(p_receipt uuid, p_allocations jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare a jsonb;
begin
  for a in select * from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb)) loop
    continue when coalesce(nullif(a->>'amount','')::numeric, 0) = 0;
    perform public.allocate_receipt(p_receipt, (a->>'doc')::uuid, (a->>'amount')::numeric);
  end loop;
end $$;

revoke execute on function public.record_receipt_with_allocations(uuid,uuid,date,numeric,uuid,text,text,jsonb) from public, anon;
revoke execute on function public.allocate_receipt_many(uuid,jsonb) from public, anon;
grant execute on function public.record_receipt_with_allocations(uuid,uuid,date,numeric,uuid,text,text,jsonb) to authenticated;
grant execute on function public.allocate_receipt_many(uuid,jsonb) to authenticated;

-- refresh the API's view of the database
notify pgrst, 'reload schema';
