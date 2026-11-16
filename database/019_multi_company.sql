-- =====================================================================
-- Hisabat — أكتر من شركة. Run once, after 018.
--  • كل شركة ليها «اختصار» (slug) لرابط الدخول المباشر: /login?c=trio
--  • الأدمن يضيف شركة جديدة من البورتال (بيبقى أدمن فيها، وحساباتها بتتعمل جاهزة)
--  • الأدمن يحدد لكل موظف: يدخل على أنهي شركة وبأي دور
-- =====================================================================

alter table public.companies add column if not exists slug text;
update public.companies c set slug = s.slug
  from (select id, case when row_number() over (partition by base order by created_at) = 1 then base
                        else base || '-' || row_number() over (partition by base order by created_at) end as slug
          from (select id, created_at,
                       coalesce(nullif(trim(both '-' from regexp_replace(lower(coalesce(name_en,'')), '[^a-z0-9]+', '-', 'g')), ''), 'company') as base
                  from public.companies) b) s
 where s.id = c.id and c.slug is null;
create unique index if not exists companies_slug_unique on public.companies(slug);

-- new company: only someone who is already an admin somewhere
create or replace function public.create_company_v2(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid; v_slug text := lower(trim(coalesce(p->>'slug','')));
begin
  if not exists (select 1 from public.memberships where user_id = auth.uid() and role = 'admin' and is_active) then
    raise exception 'إضافة شركة للأدمن بس / Only admins can add companies';
  end if;
  if coalesce(trim(p->>'name_ar'),'') = '' then raise exception 'اسم الشركة بالعربي مطلوب / Arabic name is required'; end if;
  if v_slug !~ '^[a-z0-9][a-z0-9-]{1,29}$' then
    raise exception 'الاختصار حروف إنجليزي صغيرة وأرقام وشرطة (2–30) / Short name: a-z, 0-9 and dashes';
  end if;
  if exists (select 1 from public.companies where slug = v_slug) then
    raise exception 'الاختصار % مستخدم / Short name already used', v_slug;
  end if;
  insert into public.companies(name_ar, name_en, vat_number, cr_number, slug)
  values (trim(p->>'name_ar'), nullif(trim(p->>'name_en'),''), nullif(trim(p->>'vat_number'),''), nullif(trim(p->>'cr_number'),''), v_slug)
  returning id into v;
  insert into public.memberships(company_id, user_id, role) values (v, auth.uid(), 'admin');
  perform public.seed_accounts(v);
  return v;
end $$;

-- who sees which company: p_role = admin | reviewer | entry | expense | custody | none
create or replace function public.set_access(p_company uuid, p_user uuid, p_role text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.require_role(p_company, array['admin']::public.app_role[]);
  if p_user = auth.uid() then raise exception 'لا يمكنك تغيير صلاحيتك بنفسك / You cannot change your own access'; end if;
  if not exists (select 1 from auth.users where id = p_user) then raise exception 'User not found'; end if;
  if p_role = 'none' then
    update public.memberships set is_active = false where company_id = p_company and user_id = p_user;
  elsif p_role in ('admin','reviewer','entry','expense','custody') then
    insert into public.memberships(company_id, user_id, role, is_active) values (p_company, p_user, p_role::public.app_role, true)
    on conflict (company_id, user_id) do update set role = excluded.role, is_active = true;
  else
    raise exception 'Invalid role';
  end if;
end $$;

revoke execute on function public.create_company_v2(jsonb) from public, anon;
revoke execute on function public.set_access(uuid,uuid,text) from public, anon;
grant execute on function public.create_company_v2(jsonb), public.set_access(uuid,uuid,text) to authenticated;

notify pgrst, 'reload schema';

-- اختصارات الشركات الحالية (عدّلها من الإعدادات لو حابب)
select name_ar as "الشركة", slug as "الاختصار" from public.companies order by created_at;
