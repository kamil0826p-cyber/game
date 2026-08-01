ALTER TABLE "AnalyticsExperimentAssignment"
  DROP CONSTRAINT "AnalyticsExperimentAssignment_subject_check";

ALTER TABLE "AnalyticsExperimentAssignment"
  ADD CONSTRAINT "AnalyticsExperimentAssignment_subject_check"
  CHECK ("subjectType" IN ('ACCOUNT', 'CHARACTER', 'REALM', 'GROUP', 'GUILD'));
