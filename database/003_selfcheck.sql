-- =====================================================================
-- Hisabat — self-check. Runs the spec example end-to-end as YOUR user,
-- checks every number, then cancels itself so NOTHING is saved.
-- Replace PUT-YOUR-USER-ID with your id from Authentication → Users.
-- Expected result: an "error" that starts with ✅ — that means success.
-- Any message starting with FAIL means a real problem.
-- =====================================================================
do $$
declare
  co uuid; cust uuid; partner uuid; supp uuid; prj uuid; bank uuid;
  adv uuid; c1 uuid; c2 uuid; rel uuid; pur uuid; r uuid; d record; v numeric; i int;
begin
  perform set_config('request.jwt.claims', '{"sub":"PUT-YOUR-USER-ID","role":"authenticated"}', true);
  execute 'set local role authenticated';
  co := public.create_company('شركة تجريبية للفحص', 'Self-check Co');
  select id into bank from public.accounts where company_id = co and system_key = 'bank_main';

  insert into public.parties(company_id, kind, name_ar) values (co,'customer','عميل تجريبي') returning id into cust;
  insert into public.parties(company_id, kind, name_ar) values (co,'partner','شريك تجريبي') returning id into partner;
  insert into public.parties(company_id, kind, name_ar, vat_number) values (co,'supplier','مورد تجريبي','300000000000003') returning id into supp;

  -- contract 500,000 | advance 20% | recovery 20% | retention 10% | VAT mode A
  insert into public.projects(company_id, code, name_ar, customer_id, contract_value, advance_pct, advance_amount,
                              recovery_pct, retention_pct, retention_vat_mode)
  values (co,'P-001','مشروع الفحص',cust,500000,0.20,100000,0.20,0.10,'A') returning id into prj;
  insert into public.partner_agreements(company_id, project_id, partner_id, share_pct, effective_from)
  values (co, prj, partner, 0.10, '2026-01-01');

  -- 1) advance invoice 100,000 + VAT
  insert into public.sales_documents(company_id, project_id, customer_id, doc_type, issuer_ref, issue_date, work_value, printed_total)
  values (co, prj, cust, 'advance', 'INV-ADV-1', '2026-11-01', 100000, 115000) returning id into adv;
  perform public.submit_sales_document(adv);
  perform public.approve_sales_document(adv);
  select * into d from public.sales_documents where id = adv;
  if d.collectible_total <> 115000 or d.vat_amount <> 15000 then raise exception 'FAIL advance: %', d.collectible_total; end if;

  r := public.record_receipt(co, cust, '2026-11-02', 115000, bank, 'RCV-1');
  perform public.allocate_receipt(r, adv, 115000);
  select sum(amount) into v from public.partner_entitlements where sales_document_id = adv;
  if v <> 10000 then raise exception 'FAIL partner share on advance: %', v; end if;

  -- 2) progress claim: works 100,000
  insert into public.sales_documents(company_id, project_id, customer_id, doc_type, issuer_ref, issue_date, work_value, printed_total)
  values (co, prj, cust, 'progress_claim', 'INV-PC-1', '2026-11-10', 100000, 92000) returning id into c1;
  perform public.submit_sales_document(c1);
  perform public.approve_sales_document(c1);
  select * into d from public.sales_documents where id = c1;
  if (d.advance_recovery, d.retention, d.vat_base, d.vat_amount, d.collectible_total, d.collectible_net)
     <> (20000::numeric, 10000::numeric, 80000::numeric, 12000::numeric, 82000::numeric, 70000::numeric) then
    raise exception 'FAIL claim calc: rec % ret % base % vat % due % net %', d.advance_recovery, d.retention, d.vat_base, d.vat_amount, d.collectible_total, d.collectible_net;
  end if;

  -- collected in two halves
  r := public.record_receipt(co, cust, '2026-11-12', 41000, bank, 'RCV-2');
  perform public.allocate_receipt(r, c1, 41000);
  select sum(amount) into v from public.partner_entitlements where sales_document_id = c1;
  if v <> 3500 then raise exception 'FAIL half collection share: %', v; end if;
  r := public.record_receipt(co, cust, '2026-11-13', 41000, bank, 'RCV-3');
  perform public.allocate_receipt(r, c1, 41000);
  select sum(amount) into v from public.partner_entitlements where sales_document_id = c1;
  if v <> 7000 then raise exception 'FAIL full collection share: %', v; end if;

  -- over-collection must fail
  begin
    r := public.record_receipt(co, cust, '2026-11-13', 1, bank, 'RCV-X');
    perform public.allocate_receipt(r, c1, 1);
    raise exception 'FAIL: over-allocation accepted';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;

  -- 3) retention release 10,000 (mode A: no VAT)
  insert into public.sales_documents(company_id, project_id, customer_id, doc_type, issuer_ref, issue_date, work_value)
  values (co, prj, cust, 'retention_release', 'REL-1', '2026-11-13', 10000) returning id into rel;
  perform public.submit_sales_document(rel);
  perform public.approve_sales_document(rel);
  r := public.record_receipt(co, cust, '2026-11-13', 10000, bank, 'RCV-4');
  perform public.allocate_receipt(r, rel, 10000);
  select sum(amount) into v from public.partner_entitlements where sales_document_id = rel;
  if v <> 1000 then raise exception 'FAIL retention release share: %', v; end if;

  -- releasing more than held must fail
  begin
    insert into public.sales_documents(company_id, project_id, customer_id, doc_type, issuer_ref, issue_date, work_value)
    values (co, prj, cust, 'retention_release', 'REL-2', '2026-11-13', 1) returning id into rel;
    perform public.submit_sales_document(rel);
    perform public.approve_sales_document(rel);
    raise exception 'FAIL: over-release accepted';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;

  -- 4) recovery cap: five more claims of 100,000 → only 80,000 left to recover
  for i in 2..6 loop
    insert into public.sales_documents(company_id, project_id, customer_id, doc_type, issuer_ref, issue_date, work_value)
    values (co, prj, cust, 'progress_claim', 'INV-PC-'||i, '2026-11-13', 100000) returning id into c2;
    perform public.submit_sales_document(c2);
    perform public.approve_sales_document(c2);
  end loop;
  select advance_recovered, advance_outstanding into d from public.v_project_advance_retention where project_id = prj;
  if d.advance_recovered <> 100000 or d.advance_outstanding <> 0 then
    raise exception 'FAIL recovery cap: recovered % outstanding %', d.advance_recovered, d.advance_outstanding;
  end if;

  -- 5) supplier invoice 10,000 + 1,500 VAT, fully eligible
  insert into public.purchase_documents(company_id, project_id, supplier_id, doc_number, issue_date, net_amount, vat_amount, total_amount)
  values (co, prj, supp, 'S-100', '2026-11-05', 10000, 1500, 11500) returning id into pur;
  perform public.submit_purchase_document(pur);
  perform public.approve_purchase_document(pur, 'full');

  -- duplicate supplier invoice must fail
  begin
    insert into public.purchase_documents(company_id, project_id, supplier_id, doc_number, issue_date, net_amount, vat_amount, total_amount)
    values (co, prj, supp, 'S-100', '2026-11-05', 10000, 1500, 11500);
    raise exception 'FAIL: duplicate accepted';
  exception when unique_violation then null;
  end;

  -- posted documents are frozen
  begin
    update public.sales_documents set work_value = 1 where id = c1;
  exception when others then null;   -- blocked by trigger: fine
  end;
  select work_value into v from public.sales_documents where id = c1;
  if v <> 100000 then raise exception 'FAIL: posted document edited'; end if;

  -- ledger must balance
  select sum(debit) - sum(credit) into v from public.journal_lines where company_id = co;
  if v <> 0 then raise exception 'FAIL ledger out of balance by %', v; end if;

  -- profitability of the first claim set
  select partner_share_cost into v from public.v_project_profitability where project_id = prj;
  if v <> 18000 then raise exception 'FAIL partner cost in profitability: %', v; end if;

  -- stop here on purpose: everything above is rolled back
  raise exception '✅ كل الاختبارات نجحت ولم يحفظ شيء / All checks passed — nothing was saved';
end $$;
