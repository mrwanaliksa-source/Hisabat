-- =====================================================================
-- Hisabat — create your company and make you its admin. Run ONCE.
-- 1) Replace PUT-YOUR-USER-ID with your id from Authentication → Users
-- 2) Replace the company details below, then Run.
-- =====================================================================
do $$
declare v uuid;
begin
  perform set_config('request.jwt.claims', '{"sub":"PUT-YOUR-USER-ID","role":"authenticated"}', true);
  v := public.create_company(
    'اسم الشركة بالعربي',        -- name_ar
    'Company name in English',   -- name_en
    null,                        -- VAT number (optional)
    null                         -- CR number (optional)
  );
  update public.profiles set full_name = 'Mrwan Ali', language = 'ar' where id = auth.uid();
  raise notice 'Company created: %', v;
end $$;

-- check: should return your company and role = admin
select c.name_ar, m.role
  from public.companies c join public.memberships m on m.company_id = c.id;
