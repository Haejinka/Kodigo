import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseEnhancementCase,
  validatePostgresTestTarget,
  validateSupabaseTestTarget,
} from '../enhancement-test-target.mjs';

const testProjectRef = 'testproject123456789012';

test('accepts an explicitly named Supabase test project whose URL matches its ref', () => {
  const target = validateSupabaseTestTarget({
    url: `https://${testProjectRef}.supabase.co`,
    projectRef: testProjectRef,
  });

  assert.equal(target.projectRef, testProjectRef);
});

test('rejects the deployed KodiGo project even when its URL and ref match', () => {
  assert.throws(() => validateSupabaseTestTarget({
    url: 'https://vlnucrbsgxnetdiejnwt.supabase.co',
    projectRef: 'vlnucrbsgxnetdiejnwt',
  }), /not an allowed test target/);
});

test('rejects a Supabase URL that does not match the declared test ref', () => {
  assert.throws(() => validateSupabaseTestTarget({
    url: 'https://anotherproject123456.supabase.co',
    projectRef: testProjectRef,
  }), /does not match/);
});

test('rejects credentials embedded in a Supabase API URL', () => {
  assert.throws(() => validateSupabaseTestTarget({
    url: `https://user:password@${testProjectRef}.supabase.co`,
    projectRef: testProjectRef,
  }), /must not contain credentials/);
});

test('accepts an isolated PostgreSQL pooler target with explicit project and database identity', () => {
  const target = validatePostgresTestTarget({
    url: `postgresql://postgres.${testProjectRef}:secret@aws-0-test.pooler.supabase.com:6543/postgres?sslmode=require`,
    projectRef: testProjectRef,
    databaseName: 'postgres',
    isolatedConfirmation: 'true',
  });

  assert.equal(target.host, 'aws-0-test.pooler.supabase.com');
  assert.equal(target.databaseName, 'postgres');
  assert.equal(target.password, 'secret');
});

test('requires the explicit isolated database acknowledgement', () => {
  assert.throws(() => validatePostgresTestTarget({
    url: `postgresql://postgres.${testProjectRef}:secret@aws-0-test.pooler.supabase.com:6543/postgres`,
    projectRef: testProjectRef,
    databaseName: 'postgres',
    isolatedConfirmation: 'false',
  }), /KODIGO_TEST_DATABASE_ISOLATED=true/);
});

test('requires the URL database name to match its separate declaration', () => {
  assert.throws(() => validatePostgresTestTarget({
    url: `postgresql://postgres.${testProjectRef}:secret@aws-0-test.pooler.supabase.com:6543/other`,
    projectRef: testProjectRef,
    databaseName: 'postgres',
    isolatedConfirmation: 'true',
  }), /does not match KODIGO_TEST_DATABASE_NAME/);
});

test('rejects malformed or path-like task selectors before a SQL file is selected', () => {
  assert.equal(parseEnhancementCase(['--case', 'T01']), 'T01');
  assert.throws(() => parseEnhancementCase(['--case', '../T01']), /allowlisted task ID/);
  assert.throws(() => parseEnhancementCase(['--case', 'T01', '--sql', 'anything']), /exactly one/);
});
