-- The solution's default menu goes (APPS_AND_INSTANCES Part 2 step 3,
-- 2026-10-18). Each operation now sets up its own apps list and app menu
-- (step 2), and the step 2 script has built every operation's apps and menu
-- from its default menu, so nothing reads this table any more. Published
-- model versions keep their `default_menu` in their JSON, as history; an
-- import or rollback that carries one drops it.
DROP TABLE IF EXISTS "sdm_menus";
