CREATE OR REPLACE FUNCTION "stamp_character_quest_content"()
RETURNS TRIGGER AS $$
DECLARE
  content_version TEXT;
  quest_key TEXT;
  quest_definition JSONB;
BEGIN
  IF NEW."status" NOT IN ('ACTIVE', 'COMPLETED')
     OR COALESCE(NEW."progress", '{}'::jsonb) ? '__contentSnapshot' THEN
    RETURN NEW;
  END IF;

  SELECT release."version", definition."key", jsonb_build_object(
    'key', definition."key",
    'name', definition."name",
    'description', definition."description",
    'minimumLevel', definition."minimumLevel",
    'steps', definition."steps",
    'rewards', definition."rewards"
  ) INTO content_version, quest_key, quest_definition
  FROM "QuestDefinition" AS definition
  LEFT JOIN LATERAL (
    SELECT "version" FROM "ContentRelease" WHERE "state" = 'ACTIVE' LIMIT 1
  ) AS release ON TRUE
  WHERE definition."id" = NEW."questDefinitionId";

  IF quest_key IS NULL THEN RETURN NEW; END IF;
  NEW."progress" := jsonb_set(
    COALESCE(NEW."progress", '{}'::jsonb),
    '{__contentSnapshot}',
    jsonb_build_object(
      'instanceType', 'QUEST',
      'contentVersion', COALESCE(content_version, 'unversioned'),
      'definitionKey', quest_key,
      'definition', quest_definition
    ),
    true
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
