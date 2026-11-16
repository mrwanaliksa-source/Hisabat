-- =====================================================================
-- Hisabat — self-check for projects in a PARTNER's name (after 006).
-- Replace PUT-YOUR-USER-ID, Run. Expected: a red message starting with ✅.
-- Nothing is saved.
-- =====================================================================
do $$
declare
  co uuid; cust uuid; supp uuid; prj uuid; bank uuid; partner uuid;
  adv uuid; c1 uuid; c2 uuid; pur uuid; r uuid; f jsonb; v numeric; d record;
begin
  perform set_config('request.jwt.claims', '{"sub":"PUT-YOUR-USER-ID","role":"authenticated"}', true);
  execute 'set local role authenticated';
  co := public.create_company('شركة فحص الشريك', 'Partner check Co');
  select id into bank from public.accounts where company_id = co and system_key = 'bank_main';
  insert into public.parties(company_id, kind, name_ar, vat_number) values (co,'supplier','مورد','300000000000003') returning id into supp;

  -- contract in the partner's name, partner takes 10% of profit at close
  prj := public.create_project(co, jsonb_build_object(
    'code','AF-01','name_ar','مشروع باسم الفاتح','customer_name','عميل','contract_value','500000',
    'advance_pct','0.2','retention_pct','0.1','contract_holder','partner',
    'has_partner',true,'partner_name','الفاتح العربية','share_pct','0.1','partner_vat_period','monthly'));
  select holder_partner_id, customer_id into partner, cust from public.projects where id = prj;
  if partner is null then raise exception 'FAIL: holder partner not set'; end if;
  if (select basis from public.partner_agreements where project_id = prj) <> 'profit_at_close' then
    raise exception 'FAIL: basis should default to profit_at_close';
  end if;

  -- 1) advance 100,000 + VAT, collected by the partner
  insert into public.sales_documents(company_id, project_id, customer_id, doc_type, issuer_ref, work_value)
  values (co, prj, cust, 'advance', 'AF-ADV', 100000) returning id into adv;
  perform public.submit_sales_document(adv); perform public.approve_sales_document(adv);
  r := public.record_receipt_with_allocations(co, cust, current_date, 115000, null, 'R1', null,
         jsonb_build_array(jsonb_build_object('doc', adv, 'amount', 115000)), partner);
  if exists (select 1 from public.partner_entitlements where project_id = prj) then
    raise exception 'FAIL: no share should be created on collection for profit-at-close';
  end if;

  -- 2) claim 100,000 → 82,000, collected by the partner
  insert into public.sales_documents(company_id, project_id, customer_id, doc_type, issuer_ref, work_value)
  values (co, prj, cust, 'progress_claim', 'AF-PC1', 100000) returning id into c1;
  perform public.submit_sales_document(c1); perform public.approve_sales_document(c1);
  r := public.record_receipt_with_allocations(co, cust, current_date, 82000, null, 'R2', null,
         jsonb_build_array(jsonb_build_object('doc', c1, 'amount', 82000)), partner);

  -- a receipt into the company's bank must be refused for this project
  begin
    r := public.record_receipt_with_allocations(co, cust, current_date, 1, bank, 'RX', null,
           jsonb_build_array(jsonb_build_object('doc', c1, 'amount', 1)), null);
    raise exception 'FAIL: bank receipt accepted on partner project';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;

  -- 3) partner transfers 150,000 to the company
  perform public.record_partner_transfer(co, prj, current_date, 150000, 'to_company', bank, 'T1');

  -- 4) supplier invoice in the partner's name: 10,000 + 1,500 VAT, paid by the company
  insert into public.purchase_documents(company_id, project_id, supplier_id, doc_number, issue_date, net_amount, vat_amount, total_amount)
  values (co, prj, supp, 'S-1', current_date, 10000, 1500, 11500) returning id into pur;
  perform public.submit_purchase_document(pur); perform public.approve_purchase_document(pur, 'full');
  perform public.record_supplier_payment(co, supp, current_date, 11500, bank, pur, 'P1');

  -- company VAT must not include the partner's VAT
  select coalesce(sum(net_vat),0) into v from public.v_vat_by_month where company_id = co;
  if v <> 0 then raise exception 'FAIL: partner VAT leaked into company VAT: %', v; end if;

  select * into d from public.v_partner_project_accounts where project_id = prj;
  if (d.collected_by_partner, d.transferred_to_company, d.held_by_partner, d.partner_vat_due)
     <> (197000::numeric, 150000::numeric, 47000::numeric, 25500::numeric) then
    raise exception 'FAIL partner account: collected % transferred % held % vat %',
      d.collected_by_partner, d.transferred_to_company, d.held_by_partner, d.partner_vat_due;
  end if;

  -- 5) close: revenue 100,000 − costs 10,000 = profit 90,000 → share 9,000 → settlement 12,500
  f := public.close_project(prj, current_date);
  if ((f->>'profit')::numeric, (f->>'share')::numeric, (f->>'settlement_to_company')::numeric)
     <> (90000::numeric, 9000::numeric, 12500::numeric) then
    raise exception 'FAIL close: %', f;
  end if;
  select net_due_to_company into v from public.v_partner_project_accounts where project_id = prj;
  if v <> 12500 then raise exception 'FAIL settlement after close: %', v; end if;
  select partner_share_cost into v from public.v_project_profitability where project_id = prj;
  if v <> 9000 then raise exception 'FAIL share in profitability: %', v; end if;

  -- closed project refuses new claims
  insert into public.sales_documents(company_id, project_id, customer_id, doc_type, work_value)
  values (co, prj, cust, 'progress_claim', 1000) returning id into c2;
  perform public.submit_sales_document(c2);
  begin
    perform public.approve_sales_document(c2);
    raise exception 'FAIL: claim approved on a closed project';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;

  -- 6) reopen reverses the share
  perform public.reopen_project(prj, current_date);
  select partner_share_cost into v from public.v_project_profitability where project_id = prj;
  if v <> 0 then raise exception 'FAIL reopen did not reverse share: %', v; end if;

  -- ledger balanced
  select sum(debit) - sum(credit) into v from public.journal_lines where company_id = co;
  if v <> 0 then raise exception 'FAIL ledger out of balance by %', v; end if;

  raise exception '✅ كل اختبارات مشروعات الشريك نجحت ولم يحفظ شيء / Partner-project checks passed — nothing was saved';
end $$;
