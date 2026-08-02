-- The expedition feature that installed these guards is no longer present in the
-- current application/schema, but databases that previously ran its migration
-- retain the triggers. Active rows left in the expedition tables then prevent
-- every equipment or skill-build change with P0001/EXPEDITION_LOADOUT_LOCKED.
-- Remove only the orphaned guards; historical expedition data is preserved.

DROP TRIGGER IF EXISTS "InventoryItem_active_expedition_loadout_guard"
ON "InventoryItem";

DROP FUNCTION IF EXISTS "guard_active_expedition_equipment"();

DROP TRIGGER IF EXISTS "CharacterSkillBuildState_active_expedition_loadout_guard"
ON "CharacterSkillBuildState";

DROP FUNCTION IF EXISTS "guard_active_expedition_skill_build"();
