-- =====================================================================
-- Hisabat — النقدية الفعلية لكل مشروع من البنك/الصندوق. Run once, after 016/017.
-- بتجمع كل حركات البنك والصندوق المتعلمة على المشروع (تحويلات، مصروفات،
-- دفعات بدون فواتير، عهد، تسويات) — فتطابق البنك بالظبط.
-- =====================================================================
create or replace view public.v_project_cash with (security_invoker = on) as
select l.project_id, a.company_id, sum(l.debit - l.credit) as bank_net
  from public.journal_lines l join public.accounts a on a.id = l.account_id
 where a.is_bank and l.project_id is not null
 group by l.project_id, a.company_id;

notify pgrst, 'reload schema';
