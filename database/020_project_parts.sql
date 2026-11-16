-- =====================================================================
-- Hisabat — مشروع من أكتر من جزء (زي حفر الباطن: جزء كرم + جزء الفاتح). Run once, after 019.
--
--  • كل جزء مشروع لوحده (شريكه ونسبته وأرباحه)، والأجزاء مربوطة تحت مشروع رئيسي
--  • حساب بنك ممكن يتربط بجزء: «فلوس الجزء ده»
--  • لو اتصرف من فلوس جزء على شغل جزء تاني ← سلفة بين الجزءين أوتوماتيك (حساب 1600)
--    وتتسوّى بتحويل بين البنكين
-- =====================================================================

alter table public.projects add column if not exists group_id uuid references public.projects(id);
alter table public.accounts add column if not exists project_id uuid references public.projects(id);

insert into public.accounts(company_id, code, name_ar, name_en, type, system_key)
select c.id, '1600', 'حساب جاري بين أجزاء المشروعات', 'Between project parts', 'asset', 'inter_part'
  from public.companies c
 where not exists (select 1 from public.accounts a where a.company_id = c.id and a.system_key = 'inter_part');

create or replace function public.seed_accounts(p_company uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.accounts(company_id, code, name_ar, name_en, type, system_key, is_bank) values
   (p_company,'1010','البنك','Bank','asset','bank_main',true),
   (p_company,'1020','الصندوق','Cash','asset','cash_main',true),
   (p_company,'1150','أموال المشروعات لدى الشركاء','Project funds held by partners','asset','partner_held_cash',false),
   (p_company,'1200','العملاء','Accounts receivable','asset','receivables',false),
   (p_company,'1250','محتجزات لدى العملاء','Retention receivable','asset','retention_receivable',false),
   (p_company,'1300','ضريبة مدخلات','Input VAT','asset','vat_input',false),
   (p_company,'1400','العهد','Employee custody','asset','custody',false),
   (p_company,'1500','دفعات مقدمة للموردين','Supplier advances','asset','supplier_advances',false),
   (p_company,'1600','حساب جاري بين أجزاء المشروعات','Between project parts','asset','inter_part',false),
   (p_company,'2100','الموردون','Accounts payable','liability','payables',false),
   (p_company,'2150','مستحق الشركاء','Partner payable','liability','partner_payable',false),
   (p_company,'2200','دفعات مقدمة من العملاء','Customer advances','liability','customer_advances',false),
   (p_company,'2300','ضريبة مخرجات','Output VAT','liability','vat_output',false),
   (p_company,'2350','ضريبة على فواتير الشركاء','VAT on partner-issued invoices','liability','partner_vat',false),
   (p_company,'3000','الأرصدة الافتتاحية ورأس المال','Opening balances & equity','equity','equity',false),
   (p_company,'4000','إيرادات المشروعات','Project revenue','revenue','revenue',false),
   (p_company,'5000','تكاليف مباشرة للمشروعات','Direct project costs','expense','direct_cost',false),
   (p_company,'5100','تكلفة حصة الشريك','Partner share cost','expense','partner_share_cost',false),
   (p_company,'6000','مصروفات عمومية وإدارية','General & admin expenses','expense','general_expense',false);
end $$;

-- the part whose money an account holds, when it belongs to the same project group as the works
create or replace function public.funding_of(p_account uuid, p_works uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce((
    select a.project_id
      from public.accounts a
      join public.projects fp on fp.id = a.project_id
      join public.projects wp on wp.id = p_works
     where a.id = p_account and a.project_id <> p_works
       and coalesce(fp.group_id, fp.id) = coalesce(wp.group_id, wp.id)), p_works)
$$;

-- loan between parts: the funding part is owed, the works part owes.
-- p_reclass: the bank/cash account whose line was tagged with the works part → move it to the funding part
create or replace function public.post_inter_part(p_company uuid, p_date date, p_source uuid, p_funding uuid, p_works uuid,
  p_amount numeric, p_reclass uuid, p_memo text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_lines jsonb; v_amt numeric(18,2) := round(p_amount, 2);
begin
  if p_funding is null or p_works is null or p_funding = p_works or v_amt <= 0 then return null; end if;
  v_lines := jsonb_build_array(
    jsonb_build_object('account','inter_part','debit',v_amt,'project',p_funding),
    jsonb_build_object('account','inter_part','credit',v_amt,'project',p_works));
  if p_reclass is not null then
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object('account',p_reclass::text,'debit',v_amt,'project',p_works),
      jsonb_build_object('account',p_reclass::text,'credit',v_amt,'project',p_funding));
  end if;
  return public.post_journal(p_company, p_date, 'inter_part', p_source, p_memo, v_lines);
end $$;
revoke execute on function public.post_inter_part(uuid,date,uuid,uuid,uuid,numeric,uuid,text) from public, anon, authenticated;
revoke execute on function public.funding_of(uuid,uuid) from public, anon;
grant execute on function public.funding_of(uuid,uuid) to authenticated;

-- money movements now record loans between parts
create or replace function public.pay_purchase_internal(p_doc uuid, p_date date, p_amount numeric,
  p_account uuid, p_custody uuid, p_reference text)
returns uuid language plpgsql security definer set search_path = public as $$
declare d public.purchase_documents; v uuid; v_entry uuid; v_amt numeric(18,2) := round(p_amount,2);
  v_left numeric; v_credit uuid; cu public.custody_requests;
begin
  select * into d from public.purchase_documents where id = p_doc and status = 'posted';
  if not found then raise exception 'Purchase document not found or not posted'; end if;
  select d.total_amount - coalesce(sum(amount),0) into v_left from public.supplier_payments where purchase_document_id = d.id;
  if v_amt <= 0 or v_amt > v_left then raise exception 'المبلغ أكبر من رصيد الفاتورة % / Exceeds invoice balance', v_left; end if;

  if p_custody is not null then
    select * into cu from public.custody_requests where id = p_custody and company_id = d.company_id for update;
    if not found or cu.status <> 'open' then raise exception 'العهدة غير مفتوحة / Custody is not open'; end if;
    if v_amt > public.custody_balance(p_custody) then
      raise exception 'الفاتورة % أكبر من رصيد العهدة % / Exceeds custody balance', v_amt, public.custody_balance(p_custody);
    end if;
    v_credit := public.acct(d.company_id, 'custody');
  else
    if not exists (select 1 from public.accounts where id = p_account and company_id = d.company_id and is_bank) then
      raise exception 'حساب بنك أو صندوق غير صالح / Invalid bank or cash account';
    end if;
    v_credit := p_account;
  end if;

  insert into public.supplier_payments(company_id, supplier_id, purchase_document_id, pay_date, amount, bank_account_id, reference, created_by)
  values (d.company_id, d.supplier_id, d.id, p_date, v_amt, v_credit, p_reference, auth.uid()) returning id into v;
  v_entry := public.post_journal(d.company_id, p_date, 'supplier_payment', v,
    case when p_custody is not null then 'سداد من العهدة ' else 'سداد مورد ' end || d.doc_number,
    jsonb_build_array(
      jsonb_build_object('account','payables','debit',v_amt,'project',d.project_id,'party',d.supplier_id),
      jsonb_build_object('account', v_credit::text,'credit',v_amt,'project',
        case when p_custody is not null then coalesce(cu.project_id, d.project_id) else d.project_id end)));
  update public.supplier_payments set journal_entry_id = v_entry where id = v;
  -- money of another part of the same project → loan between the parts
  if p_custody is not null then
    perform public.post_inter_part(d.company_id, p_date, v, cu.project_id, d.project_id, v_amt, null, 'سلفة بين الأجزاء — ' || d.doc_number);
  else
    perform public.post_inter_part(d.company_id, p_date, v, public.funding_of(p_account, d.project_id), d.project_id, v_amt, p_account,
      'سلفة بين الأجزاء — ' || d.doc_number);
  end if;

  if p_custody is not null then
    insert into public.custody_settlements(company_id, custody_id, kind, purchase_document_id, amount, journal_entry_id, created_by)
    values (d.company_id, p_custody, 'invoice', d.id, v_amt, v_entry, auth.uid());
    if public.custody_balance(p_custody) = 0 then
      update public.custody_requests set status = 'settled', settled_at = now() where id = p_custody;
    end if;
  end if;
  return v;
end $$;

create or replace function public.approve_custody(p_custody uuid, p_account uuid default null, p_date date default current_date)
returns text language plpgsql security definer set search_path = public as $$
declare cu public.custody_requests; c public.companies; v_entry uuid;
begin
  select * into cu from public.custody_requests where id = p_custody for update;
  if not found then raise exception 'Custody not found'; end if;
  select * into c from public.companies where id = cu.company_id;
  if cu.status = 'pending_1' then
    if auth.uid() is distinct from c.custody_approver_1 then
      raise exception 'الموافقة الأولى للمدير الأول فقط / Only approver 1 can give the first approval';
    end if;
    update public.custody_requests set status = 'pending_2', approved1_by = auth.uid(), approved1_at = now() where id = p_custody;
    return 'pending_2';
  elsif cu.status = 'pending_2' then
    if auth.uid() is distinct from c.custody_approver_2 then
      raise exception 'الموافقة الثانية للمدير الثاني فقط / Only approver 2 can give the final approval';
    end if;
    if not exists (select 1 from public.accounts where id = p_account and company_id = cu.company_id and is_bank) then
      raise exception 'اختر حساب البنك أو الصندوق الذي ستصرف منه العهدة / Choose the account to pay from';
    end if;
    v_entry := public.post_journal(cu.company_id, p_date, 'custody_disbursement', cu.id,
      'صرف عهدة: ' || cu.purpose,
      jsonb_build_array(
        jsonb_build_object('account','custody','debit',cu.amount,'project',cu.project_id),
        jsonb_build_object('account',p_account::text,'credit',cu.amount,'project',cu.project_id)));
    update public.custody_requests set status = 'open', approved2_by = auth.uid(), approved2_at = now(),
      bank_account_id = p_account, disbursed_on = p_date, journal_entry_id = v_entry where id = p_custody;
    perform public.post_inter_part(cu.company_id, p_date, cu.id, public.funding_of(p_account, cu.project_id), cu.project_id, cu.amount, p_account,
      'سلفة بين الأجزاء — عهدة: ' || cu.purpose);
    return 'open';
  end if;
  raise exception 'الطلب ليس بانتظار موافقة / Request is not awaiting approval';
end $$;

create or replace function public.pay_supplier_advance(p_company uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid; v_entry uuid; v_supp uuid; v_amt numeric(18,2); v_date date; v_acc uuid; v_proj uuid;
begin
  perform public.require_role(p_company, array['admin','reviewer','expense']::public.app_role[]);
  v_amt  := round(coalesce(nullif(p->>'amount','')::numeric, 0), 2);
  if v_amt <= 0 then raise exception 'المبلغ يجب أن يكون أكبر من صفر / Amount must be greater than zero'; end if;
  v_date := coalesce(nullif(p->>'pay_date','')::date, current_date);
  v_acc  := nullif(p->>'account_id','')::uuid;
  if not exists (select 1 from public.accounts where id = v_acc and company_id = p_company and is_bank) then
    raise exception 'حساب بنك أو صندوق غير صالح / Invalid bank or cash account';
  end if;
  v_proj := nullif(p->>'project_id','')::uuid;
  if v_proj is not null and not exists (select 1 from public.projects where id = v_proj and company_id = p_company) then
    raise exception 'Invalid project';
  end if;
  if coalesce(trim(p->>'notes'),'') = '' then raise exception 'البيان مطلوب / Details are required'; end if;
  v_supp := public.supplier_from(p_company, p);

  insert into public.supplier_advances(company_id, supplier_id, project_id, pay_date, amount, bank_account_id, reference, notes, created_by)
  values (p_company, v_supp, v_proj, v_date, v_amt, v_acc, nullif(trim(p->>'reference'),''), trim(p->>'notes'), auth.uid())
  returning id into v;
  v_entry := public.post_journal(p_company, v_date, 'supplier_advance', v,
    'دفعة مقدمة لمورد — ' || trim(p->>'notes'),
    jsonb_build_array(
      jsonb_build_object('account','supplier_advances','debit',v_amt,'project',v_proj,'party',v_supp),
      jsonb_build_object('account', v_acc::text,'credit',v_amt,'project',v_proj)));
  update public.supplier_advances set journal_entry_id = v_entry where id = v;
  perform public.post_inter_part(p_company, v_date, v, public.funding_of(v_acc, v_proj), v_proj, v_amt, v_acc, 'سلفة بين الأجزاء — دفعة لمورد');
  return v;
end $$;

create or replace function public.apply_supplier_advance(p_doc uuid, p_advance uuid, p_amount numeric, p_date date default current_date)
returns uuid language plpgsql security definer set search_path = public as $$
declare d public.purchase_documents; a public.supplier_advances; v uuid; v_entry uuid;
  v_amt numeric(18,2) := round(p_amount, 2); v_doc_left numeric; v_adv_left numeric;
begin
  select * into d from public.purchase_documents where id = p_doc and status = 'posted';
  if not found then raise exception 'الفاتورة غير موجودة أو غير مرحلة / Invoice not found or not posted'; end if;
  perform public.require_role(d.company_id, array['admin','reviewer','expense']::public.app_role[]);
  select * into a from public.supplier_advances where id = p_advance and company_id = d.company_id for update;
  if not found then raise exception 'الدفعة المقدمة غير موجودة / Advance not found'; end if;
  if a.supplier_id <> d.supplier_id then
    raise exception 'الدفعة المقدمة لمورد تاني غير مورد الفاتورة / The advance belongs to a different supplier';
  end if;
  select d.total_amount - coalesce(sum(amount),0) into v_doc_left from public.supplier_payments where purchase_document_id = d.id;
  v_adv_left := public.supplier_advance_balance(a.id);
  if v_amt <= 0 then raise exception 'المبلغ يجب أن يكون أكبر من صفر / Amount must be greater than zero'; end if;
  if v_amt > v_doc_left then raise exception 'المبلغ أكبر من المتبقي على الفاتورة % / Exceeds invoice balance', v_doc_left; end if;
  if v_amt > v_adv_left then raise exception 'المبلغ أكبر من المتبقي في الدفعة المقدمة % / Exceeds advance balance', v_adv_left; end if;

  insert into public.supplier_payments(company_id, supplier_id, purchase_document_id, pay_date, amount, bank_account_id,
    reference, advance_id, created_by)
  values (d.company_id, d.supplier_id, d.id, coalesce(p_date, current_date), v_amt,
    public.acct(d.company_id,'supplier_advances'), 'خصم من دفعة مقدمة', a.id, auth.uid())
  returning id into v;
  v_entry := public.post_journal(d.company_id, coalesce(p_date, current_date), 'supplier_payment', v,
    'خصم من دفعة مقدمة — فاتورة ' || d.doc_number,
    jsonb_build_array(
      jsonb_build_object('account','payables','debit',v_amt,'project',d.project_id,'party',d.supplier_id),
      jsonb_build_object('account','supplier_advances','credit',v_amt,'project',a.project_id,'party',a.supplier_id)));
  update public.supplier_payments set journal_entry_id = v_entry where id = v;
  perform public.post_inter_part(d.company_id, coalesce(p_date, current_date), v, a.project_id, d.project_id, v_amt, null,
    'سلفة بين الأجزاء — خصم دفعة مقدمة ' || d.doc_number);
  return v;
end $$;

-- link a project as a part of another (p_main null = unlink)
create or replace function public.set_project_group(p_project uuid, p_main uuid)
returns void language plpgsql security definer set search_path = public as $$
declare pr public.projects; mn public.projects;
begin
  select * into pr from public.projects where id = p_project for update;
  if not found then raise exception 'Project not found'; end if;
  perform public.require_role(pr.company_id, array['admin','reviewer']::public.app_role[]);
  if p_main is null then
    if exists (select 1 from public.journal_lines l join public.accounts a on a.id = l.account_id
                where l.project_id = p_project and a.system_key = 'inter_part') then
      raise exception 'الجزء ده عليه سلف مع جزء تاني — مينفعش يتفك / This part has loans with another part';
    end if;
    update public.projects set group_id = null where id = p_project;
    return;
  end if;
  select * into mn from public.projects where id = p_main and company_id = pr.company_id;
  if not found or mn.id = pr.id then raise exception 'المشروع الرئيسي غير صالح / Invalid main project'; end if;
  if mn.group_id is null then update public.projects set group_id = mn.id where id = mn.id; end if;
  update public.projects set group_id = coalesce(mn.group_id, mn.id) where id = p_project;
end $$;

-- add a bank / cash account (optionally holding one project part's money)
create or replace function public.add_bank_account(p_company uuid, p_name text, p_project uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid; v_code text;
begin
  perform public.require_role(p_company, array['admin']::public.app_role[]);
  if coalesce(trim(p_name),'') = '' then raise exception 'اسم الحساب مطلوب / Name is required'; end if;
  select (coalesce(max(code::int) filter (where code ~ '^10[0-9]{2}$'), 1020) + 10)::text into v_code
    from public.accounts where company_id = p_company;
  insert into public.accounts(company_id, code, name_ar, type, is_bank, project_id)
  values (p_company, v_code, trim(p_name), 'asset', true, p_project) returning id into v;
  return v;
end $$;

create or replace function public.set_account_project(p_account uuid, p_project uuid)
returns void language plpgsql security definer set search_path = public as $$
declare a public.accounts;
begin
  select * into a from public.accounts where id = p_account;
  if not found or not a.is_bank then raise exception 'Account not found'; end if;
  perform public.require_role(a.company_id, array['admin']::public.app_role[]);
  if p_project is not null and not exists (select 1 from public.projects where id = p_project and company_id = a.company_id) then
    raise exception 'Invalid project';
  end if;
  update public.accounts set project_id = p_project where id = p_account;
end $$;

-- settle a loan: the part that owes sends money to the part that is owed
create or replace function public.settle_inter_part(p_debtor uuid, p_creditor uuid, p_amount numeric,
  p_from_account uuid, p_to_account uuid, p_date date)
returns uuid language plpgsql security definer set search_path = public as $$
declare d public.projects; c public.projects; v_amt numeric(18,2) := round(p_amount, 2);
begin
  select * into d from public.projects where id = p_debtor;
  select * into c from public.projects where id = p_creditor;
  if d.id is null or c.id is null or d.company_id <> c.company_id or d.id = c.id
     or coalesce(d.group_id, d.id) <> coalesce(c.group_id, c.id) then
    raise exception 'الجزءين لازم يكونوا من نفس المشروع / Both parts must belong to the same project';
  end if;
  perform public.require_role(d.company_id, array['admin','reviewer']::public.app_role[]);
  if v_amt <= 0 then raise exception 'المبلغ يجب أن يكون أكبر من صفر / Amount must be greater than zero'; end if;
  if not exists (select 1 from public.accounts where id = p_from_account and company_id = d.company_id and is_bank)
     or not exists (select 1 from public.accounts where id = p_to_account and company_id = d.company_id and is_bank) then
    raise exception 'حساب بنك أو صندوق غير صالح / Invalid bank or cash account';
  end if;
  return public.post_journal(d.company_id, coalesce(p_date, current_date), 'inter_part_settlement', p_debtor,
    'تسوية سلفة: ' || d.code || ' ← ' || c.code,
    jsonb_build_array(
      jsonb_build_object('account', p_to_account::text, 'debit', v_amt, 'project', p_creditor),
      jsonb_build_object('account', p_from_account::text, 'credit', v_amt, 'project', p_debtor),
      jsonb_build_object('account','inter_part','debit', v_amt, 'project', p_debtor),
      jsonb_build_object('account','inter_part','credit', v_amt, 'project', p_creditor)));
end $$;

-- per part: + the other parts owe it, − it owes the other parts
create or replace view public.v_inter_part with (security_invoker = on) as
select l.project_id, a.company_id, sum(l.debit - l.credit) as balance
  from public.journal_lines l join public.accounts a on a.id = l.account_id
 where a.system_key = 'inter_part' and l.project_id is not null
 group by l.project_id, a.company_id;

revoke execute on function public.set_project_group(uuid,uuid) from public, anon;
revoke execute on function public.add_bank_account(uuid,text,uuid) from public, anon;
revoke execute on function public.set_account_project(uuid,uuid) from public, anon;
revoke execute on function public.settle_inter_part(uuid,uuid,numeric,uuid,uuid,date) from public, anon;
grant execute on function public.set_project_group(uuid,uuid), public.add_bank_account(uuid,text,uuid),
  public.set_account_project(uuid,uuid), public.settle_inter_part(uuid,uuid,numeric,uuid,uuid,date) to authenticated;

-- البنك الرئيسي = فلوس جزء كرم في حفر الباطن (تقدر تغيّرها من الإعدادات)
update public.accounts a set project_id = p.id
  from public.projects p
 where p.code = 'HAFR-01' and p.company_id = a.company_id and a.system_key = 'bank_main' and a.project_id is null;

notify pgrst, 'reload schema';
