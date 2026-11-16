-- =====================================================================
-- Hisabat — edit a project's partner terms. Run once, after 012.
--
--  • contract holder (company / partner): only before any posted document
--  • share %: always; if shares were already calculated on the current
--    agreement, a NEW agreement version starts on p_effective_from and the
--    old one ends the day before (history keeps its own %)
--  • basis (collections / profit at close): only before the first share
--  • add a partner to a project that has none
--  • closed projects: reopen first
-- p = { partner_id | partner_name, share_pct (fraction), basis, contract_holder,
--       effective_from, partner_vat_period }
-- =====================================================================
create or replace function public.update_partner_terms(p_project uuid, p jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare
  pr public.projects; ag public.partner_agreements; v_partner uuid; v_share numeric(7,4); v_basis text;
  v_holder text; v_from date; v_used boolean; v_result text := 'updated';
begin
  select * into pr from public.projects where id = p_project for update;
  if not found then raise exception 'Project not found'; end if;
  perform public.require_role(pr.company_id, array['admin','reviewer']::public.app_role[]);
  if pr.status = 'closed' then raise exception 'المشروع مقفل؛ أعد فتحه أولًا / Project is closed — reopen it first'; end if;

  v_share  := nullif(p->>'share_pct','')::numeric;
  v_basis  := coalesce(nullif(p->>'basis',''), 'collections');
  v_holder := coalesce(nullif(p->>'contract_holder',''), pr.contract_holder);
  v_from   := coalesce(nullif(p->>'effective_from','')::date, current_date);
  if v_share is null or v_share <= 0 or v_share > 1 then
    raise exception 'نسبة الشريك يجب أن تكون أكبر من صفر ولا تتجاوز 100%% / Partner share must be between 0 and 100%%';
  end if;
  if v_basis not in ('collections','profit_at_close') or v_holder not in ('company','partner') then raise exception 'Invalid values'; end if;

  select * into ag from public.partner_agreements where project_id = p_project and effective_to is null
   order by effective_from desc limit 1;

  if ag.id is null then
    -- adding a partner to a project without one
    if nullif(p->>'partner_id','') is not null then
      select id into v_partner from public.parties where id = (p->>'partner_id')::uuid and company_id = pr.company_id and kind = 'partner';
    elsif coalesce(trim(p->>'partner_name'),'') <> '' then
      insert into public.parties(company_id, kind, name_ar) values (pr.company_id, 'partner', trim(p->>'partner_name')) returning id into v_partner;
    end if;
    if v_partner is null then raise exception 'اسم الشركة الشريكة مطلوب / Partner is required'; end if;
    insert into public.partner_agreements(company_id, project_id, partner_id, share_pct, basis, effective_from, created_by)
    values (pr.company_id, p_project, v_partner, v_share, v_basis, coalesce(pr.start_date, v_from), auth.uid());
    v_result := 'added';
  else
    v_partner := ag.partner_id;
    v_used := exists (select 1 from public.partner_entitlements where agreement_id = ag.id and reversed_at is null);
    if v_used and v_basis <> ag.basis then
      raise exception 'لا يمكن تغيير أساس الحسبة بعد احتساب حصص على التحصيل / Basis cannot change after shares were calculated';
    end if;
    if v_share <> ag.share_pct or v_basis <> ag.basis then
      if v_used then
        if v_from <= ag.effective_from then raise exception 'تاريخ السريان يجب أن يكون بعد % / Effective date must be after %', ag.effective_from, ag.effective_from; end if;
        update public.partner_agreements set effective_to = v_from - 1 where id = ag.id;
        insert into public.partner_agreements(company_id, project_id, partner_id, share_pct, basis, effective_from, notes, created_by)
        values (pr.company_id, p_project, v_partner, v_share, v_basis, v_from,
                'تعديل النسبة من ' || round(ag.share_pct * 100, 2) || '%', auth.uid());
        v_result := 'new_version';
      else
        update public.partner_agreements set share_pct = v_share, basis = v_basis where id = ag.id;
      end if;
    end if;
  end if;

  if nullif(p->>'partner_vat_period','') is not null then
    update public.parties set vat_period = p->>'partner_vat_period' where id = v_partner;
  end if;

  -- contract holder (the projects trigger refuses this after any posted document)
  if v_holder <> pr.contract_holder or (v_holder = 'partner' and pr.holder_partner_id is distinct from v_partner) then
    update public.projects set contract_holder = v_holder,
           holder_partner_id = case when v_holder = 'partner' then v_partner end
     where id = p_project;
  end if;
  return v_result;
end $$;

revoke execute on function public.update_partner_terms(uuid,jsonb) from public, anon;
grant execute on function public.update_partner_terms(uuid,jsonb) to authenticated;

notify pgrst, 'reload schema';
