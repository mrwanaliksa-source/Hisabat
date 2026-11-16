-- =====================================================================
-- Hisabat — two new roles. Run ONCE, on its own, BEFORE 009.
--   expense : enters expenses that post immediately (no review); sees only their own
--   custody : can only request and settle their own custody (عهدة)
-- =====================================================================
alter type public.app_role add value if not exists 'expense';
alter type public.app_role add value if not exists 'custody';
