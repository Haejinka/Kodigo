import { spawn } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  parseEnhancementCase,
  validatePostgresTestTarget,
} from './enhancement-test-target.mjs';

const enabled = process.env.RUN_ENHANCEMENT_DB_TESTS === 'true';

if (!enabled) {
  console.log('[SKIP] Enhancement database tests are disabled. Set RUN_ENHANCEMENT_DB_TESTS=true to opt in.');
  process.exit(0);
}

function runPsql(target, sql) {
  return new Promise((resolve, reject) => {
    const child = spawn('psql', [
      '--no-psqlrc',
      '--no-password',
      '--quiet',
      '--tuples-only',
      '--no-align',
      '--set=ON_ERROR_STOP=1',
    ], {
      shell: false,
      env: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        WINDIR: process.env.WINDIR,
        PGHOST: target.host,
        PGPORT: target.port,
        PGUSER: target.username,
        PGPASSWORD: target.password,
        PGDATABASE: target.databaseName,
        PGSSLMODE: target.sslmode,
        PGAPPNAME: 'kodigo-enhancement-tests',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', () => {
      reject(new Error('Could not start psql. Install a PostgreSQL client on this test host.'));
    });
    child.once('close', (code) => {
      if (code !== 0) {
        const safeStderr = stderr.split(target.password).join('[redacted]').trim();
        reject(new Error(safeStderr || `psql exited with status ${code ?? 'unknown'}.`));
        return;
      }

      resolve(stdout.trim());
    });

    child.stdin.end(sql);
  });
}

async function main() {
  const testCase = parseEnhancementCase(process.argv.slice(2));
  const target = validatePostgresTestTarget({
    url: process.env.KODIGO_TEST_DATABASE_URL,
    projectRef: process.env.KODIGO_TEST_DATABASE_PROJECT_REF,
    databaseName: process.env.KODIGO_TEST_DATABASE_NAME,
    isolatedConfirmation: process.env.KODIGO_TEST_DATABASE_ISOLATED,
  });

  const fixtureDirectory = fileURLToPath(new URL('../../supabase/tests/enhancements/', import.meta.url));
  const [fixtureNames, fixtureSql] = await Promise.all([
    readdir(fixtureDirectory),
    readFile(path.join(fixtureDirectory, 'fixtures.sql'), 'utf8'),
  ]);
  const caseFiles = fixtureNames.filter((name) => name.startsWith(`${testCase}_`) && name.endsWith('.sql'));
  if (caseFiles.length !== 1) {
    throw new Error(`Expected exactly one SQL case file for ${testCase}.`);
  }

  const caseSql = await readFile(path.join(fixtureDirectory, caseFiles[0]), 'utf8');
  const allSql = `${fixtureSql}\n${caseSql}`;
  if (/^\s*\\/m.test(allSql)) {
    throw new Error('SQL cases may not use psql meta-commands.');
  }
  if (/^\s*(BEGIN|COMMIT|ROLLBACK)\s*;/im.test(allSql)) {
    throw new Error('SQL cases may not manage transactions; the runner supplies one rollback-only transaction.');
  }

  const databaseName = await runPsql(target, 'SELECT current_database();');
  if (databaseName !== target.databaseName) {
    throw new Error('Connected database identity did not match KODIGO_TEST_DATABASE_NAME.');
  }

  const output = await runPsql(target, `BEGIN;\n${allSql}\nROLLBACK;\n`);
  if (output) console.log(output);
  console.log(`[PASS] ${testCase} completed inside a rollback-only transaction on the declared isolated database.`);
}

main().catch((error) => {
  console.error(`[FAIL] ${error.message}`);
  process.exitCode = 1;
});
