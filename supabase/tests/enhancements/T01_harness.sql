DO $test$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_temp.enhancement_test_fixture
    WHERE fixture_key = 'harness'
      AND fixture_value = 'rollback-only'
  ) THEN
    RAISE EXCEPTION 'Shared test fixture was not created in the current session';
  END IF;

  IF current_database() = 'template0' OR current_database() = 'template1' THEN
    RAISE EXCEPTION 'Template databases are not valid test targets';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_class relation
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'pg_temp'
      AND relation.relname = 'enhancement_test_fixture'
      AND relation.relpersistence = 't'
  ) THEN
    RAISE EXCEPTION 'Fixture must remain a temporary relation';
  END IF;
END
$test$;

SELECT 'T01 rollback-only fixture harness OK' AS result;
