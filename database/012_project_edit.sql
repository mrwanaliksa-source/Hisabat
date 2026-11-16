-- =====================================================================
-- Hisabat — project terms can be edited until the FIRST progress claim.
-- Run once, after 011.
--
-- Recovery %, retention %, cap and advance amount only affect progress claims
-- and retention releases, so posting an advance invoice no longer locks them.
-- Who holds the contract (company/partner) still locks at the first posted
-- document of any kind, because it decides where that document's VAT went.
-- =====================================================================
create or replace function public.trg_project_terms_guard() returns trigger language plpgsql as $$
begin
  if (new.advance_amount, new.recovery_pct, new.retention_pct, new.retention_cap_pct, new.retention_vat_mode)
     is distinct from
     (old.advance_amount, old.recovery_pct, old.retention_pct, old.retention_cap_pct, old.retention_vat_mode)
     and exists (select 1 from public.sales_documents where project_id = old.id and status = 'posted'
                   and doc_type in ('progress_claim','retention_release')) then
    raise exception 'لا يمكن تعديل نسب الاسترداد والمحتجز بعد اعتماد أول مستخلص / Terms are locked after the first posted claim';
  end if;
  if (new.contract_holder, new.holder_partner_id) is distinct from (old.contract_holder, old.holder_partner_id)
     and exists (select 1 from public.sales_documents where project_id = old.id and status = 'posted') then
    raise exception 'لا يمكن تغيير صاحب العقد بعد ترحيل مستندات / Contract holder is locked after posting';
  end if;
  return new;
end $$;

-- edit a project's details and terms (admin / reviewer)
create or replace function public.update_project(p_project uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare pr public.projects; v_contract numeric(18,2); v_adv numeric(7,4); v_rec numeric(7,4); v_ret numeric(7,4); v_cap numeric(7,4);
begin
  select * into pr from public.projects where id = p_project for update;
  if not found then raise exception 'Project not found'; end if;
  perform public.require_role(pr.company_id, array['admin','reviewer']::public.app_role[]);
  if coalesce(trim(p->>'name_ar'),'') = '' then raise exception 'اسم المشروع مطلوب / Project name is required'; end if;

  v_contract := coalesce(nullif(p->>'contract_value','')::numeric, pr.contract_value);
  v_adv := coalesce(nullif(p->>'advance_pct','')::numeric, 0);
  v_rec := coalesce(nullif(p->>'recovery_pct','')::numeric, v_adv);
  v_ret := coalesce(nullif(p->>'retention_pct','')::numeric, 0);
  v_cap := nullif(p->>'retention_cap_pct','')::numeric;
  if v_contract < 0 or v_adv not between 0 and 1 or v_rec not between 0 and 1 or v_ret not between 0 and 1
     or (v_cap is not null and v_cap not between 0 and 1) then
    raise exception 'قيم غير صحيحة / Invalid values';
  end if;
  if v_adv > 0 and v_rec = 0 then
    raise exception 'حدد نسبة استرداد الدفعة المقدمة / Recovery %% is required when there is an advance';
  end if;

  update public.projects set
    name_ar = trim(p->>'name_ar'), name_en = nullif(trim(p->>'name_en'),''),
    contract_value = v_contract, start_date = nullif(p->>'start_date','')::date, end_date = nullif(p->>'end_date','')::date,
    manager_name = nullif(trim(p->>'manager_name'),''), budget = nullif(p->>'budget','')::numeric,
    status = coalesce(nullif(p->>'status',''), status),
    advance_pct = v_adv,
    -- keep the advance amount actually invoiced if there is one, otherwise contract × %
    advance_amount = case when exists (select 1 from public.sales_documents where project_id = p_project and status = 'posted'
                                         and doc_type in ('advance','progress_claim','retention_release'))
                          then advance_amount else round(v_contract * v_adv, 2) end,
    recovery_pct = v_rec, retention_pct = v_ret, retention_cap_pct = v_cap,
    retention_release_terms = nullif(trim(p->>'retention_release_terms'),'')
  where id = p_project;
end $$;
revoke execute on function public.update_project(uuid,jsonb) from public, anon;
grant execute on function public.update_project(uuid,jsonb) to authenticated;

notify pgrst, 'reload schema';
