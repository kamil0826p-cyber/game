CREATE OR REPLACE FUNCTION "protect_analytics_experiment_version"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."rolloutBasisPoints" IS DISTINCT FROM OLD."rolloutBasisPoints"
     OR NEW."variants" IS DISTINCT FROM OLD."variants"
     OR NEW."salt" IS DISTINCT FROM OLD."salt" THEN
    RAISE EXCEPTION 'Analytics experiment % version % is immutable; create a new version instead.', OLD."key", OLD."version";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AnalyticsExperiment_immutable_version_trigger"
BEFORE UPDATE ON "AnalyticsExperiment"
FOR EACH ROW EXECUTE FUNCTION "protect_analytics_experiment_version"();
