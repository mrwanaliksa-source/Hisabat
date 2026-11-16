-- =====================================================================
-- Hisabat — create a project with its customer, advance/retention terms
-- and optional partner in ONE transaction. Run once after 001.
-- Percentages are fractions: 0.20 = 20%.
-- =====================================================================
create or replace function public.create_project(p_company uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_cust uuid; v_partner uuid; v_prj uuid;
  v_contract numeric(18,2); v_adv numeric(7,4); v_rec numeric(7,4);
  v_ret numeric(7,4); v_cap numeric(7,4); v_share numeric(7,4); v_start date;
begin
  perform public.require_role(p_company, array['admin','reviewer']::public.app_role[]);

  if coalesce(trim(p->>'code'),'') = '' or coalesce(trim(p->>'name_ar'),'') = '' then
    raise exception 'كود المشروع واسمه مطلوبان / Project code and name are required';
  end if;
  v_contract := coalesce(nullif(p->>'contract_value','')::numeric, 0);
  v_adv      := coalesce(nullif(p->>'advance_pct','')::numeric, 0);
  v_rec      := coalesce(nullif(p->>'recovery_pct','')::numeric, v_adv);
  v_ret      := coalesce(nullif(p->>'retention_pct','')::numeric, 0);
  v_cap      := nullif(p->>'retention_cap_pct','')::numeric;
  v_start    := nullif(p->>'start_date','')::date;
  if v_contract < 0 then raise exception 'قيمة العقد غير صحيحة / Invalid contract value'; end if;
  if v_adv > 0 and v_rec = 0 then
    raise exception 'حدد نسبة استرداد الدفعة المقدمة / Recovery %% is required when there is an advance';
  end if;

  -- customer: existing or new
  if nullif(p->>'customer_id','') is not null then
    select id into v_cust from public.parties
     where id = (p->>'customer_id')::uuid and company_id = p_company and kind = 'customer';
    if v_cust is null then raise exception 'عميل غير صالح / Invalid customer'; end if;
  elsif coalesce(trim(p->>'customer_name'),'') <> '' then
    insert into public.parties(company_id, kind, name_ar, vat_number, is_government)
    values (p_company, 'customer', trim(p->>'customer_name'), nullif(trim(p->>'customer_vat'),''),
            coalesce((p->>'customer_is_government')::boolean, false))
    returning id into v_cust;
  else
    raise exception 'العميل مطلوب / Customer is required';
  end if;

  begin
    insert into public.projects(company_id, code, name_ar, name_en, customer_id, contract_value,
      prices_include_vat, start_date, end_date, manager_name, budget,
      advance_pct, advance_amount, recovery_pct, retention_pct, retention_cap_pct,
      retention_vat_mode, retention_release_terms, created_by)
    values (p_company, trim(p->>'code'), trim(p->>'name_ar'), nullif(trim(p->>'name_en'),''), v_cust, v_contract,
      false, v_start, nullif(p->>'end_date','')::date, nullif(trim(p->>'manager_name'),''),
      nullif(p->>'budget','')::numeric,
      v_adv, round(v_contract * v_adv, 2), v_rec, v_ret, v_cap,
      'A', nullif(trim(p->>'retention_release_terms'),''), auth.uid())
    returning id into v_prj;
  exception when unique_violation then
    raise exception 'كود المشروع مستخدم من قبل / Project code already exists';
  end;

  -- optional partner
  if coalesce((p->>'has_partner')::boolean, false) then
    v_share := nullif(p->>'share_pct','')::numeric;
    if v_share is null or v_share <= 0 or v_share > 1 then
      raise exception 'نسبة الشريك يجب أن تكون أكبر من صفر ولا تتجاوز 100%% / Partner share must be between 0 and 100%%';
    end if;
    if nullif(p->>'partner_id','') is not null then
      select id into v_partner from public.parties
       where id = (p->>'partner_id')::uuid and company_id = p_company and kind = 'partner';
      if v_partner is null then raise exception 'شريك غير صالح / Invalid partner'; end if;
    elsif coalesce(trim(p->>'partner_name'),'') <> '' then
      insert into public.parties(company_id, kind, name_ar, vat_number)
      values (p_company, 'partner', trim(p->>'partner_name'), nullif(trim(p->>'partner_vat'),''))
      returning id into v_partner;
    else
      raise exception 'اسم الشركة الشريكة مطلوب / Partner is required';
    end if;
    insert into public.partner_agreements(company_id, project_id, partner_id, share_pct, effective_from, notes, created_by)
    values (p_company, v_prj, v_partner, v_share,
            coalesce(nullif(p->>'partner_from','')::date, v_start, current_date),
            nullif(trim(p->>'partner_notes'),''), auth.uid());
  end if;

  return v_prj;
end $$;

revoke execute on function public.create_project(uuid, jsonb) from public, anon;
grant execute on function public.create_project(uuid, jsonb) to authenticated;

-- refresh the API's view of the database
notify pgrst, 'reload schema';
