-- Shared, session-local fixture setup. The runner wraps this file and each
-- task case in a single transaction that always rolls back.
CREATE TEMP TABLE enhancement_test_fixture (
  fixture_key text PRIMARY KEY,
  fixture_value text NOT NULL
) ON COMMIT PRESERVE ROWS;

INSERT INTO pg_temp.enhancement_test_fixture (fixture_key, fixture_value)
VALUES ('harness', 'rollback-only');
