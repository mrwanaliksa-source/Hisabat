-- =====================================================================
-- Hisabat — make sure every login has a profile (name shown in the portal).
-- Safe to run any time, any number of times.
-- =====================================================================
insert into public.profiles (id, full_name)
select id, coalesce(raw_user_meta_data->>'full_name', raw_user_meta_data->>'display_name', email)
  from auth.users
on conflict (id) do nothing;

-- show users still named by e-mail, so you can rename them below if you like
select p.id, p.full_name, u.email
  from public.profiles p join auth.users u on u.id = p.id
 order by p.created_at;

-- example: rename yourself (edit the e-mail, then remove the two dashes and run this line)
-- update public.profiles set full_name = 'Mrwan Ali' where id = (select id from auth.users where email = 'YOUR-EMAIL');
