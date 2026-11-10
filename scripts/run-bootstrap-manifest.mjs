import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = resolve(repositoryRoot, 'supabase/bootstrap-manifest.json');
const expectedTarget = 'github-actions-ephemeral';

if (process.env.KODIGO_BOOTSTRAP_TARGET !== expectedTarget) {
  throw new Error(`Bootstrap replay is restricted to the ${expectedTarget} target.`);
}

let databaseUrl = process.env.KODIGO_BOOTSTRAP_DATABASE_URL;
if (!databaseUrl) {
  const projectDirectory = process.env.KODIGO_BOOTSTRAP_PROJECT_DIR;
  if (!projectDirectory) throw new Error('The isolated Supabase project directory is required.');
  const status = spawnSync('supabase', ['status', '--output', 'env'], {
    cwd: resolve(projectDirectory),
    encoding: 'utf8',
  });
  if (status.error || status.status !== 0) {
    throw new Error('Supabase CLI could not read the isolated local database connection.');
  }
  const databaseLine = status.stdout.split(/\r?\n/).find((line) => line.startsWith('DB_URL='));
  if (!databaseLine) throw new Error('Supabase CLI did not provide the isolated local database URL.');
  databaseUrl = databaseLine.slice('DB_URL='.length).trim();
  if ((databaseUrl.startsWith('"') && databaseUrl.endsWith('"'))
    || (databaseUrl.startsWith("'") && databaseUrl.endsWith("'"))) {
    databaseUrl = databaseUrl.slice(1, -1);
  }
}
const parsedDatabaseUrl = new URL(databaseUrl);
const localHosts = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
if (!['postgres:', 'postgresql:'].includes(parsedDatabaseUrl.protocol)
  || !localHosts.has(parsedDatabaseUrl.hostname)
  || parsedDatabaseUrl.port !== '54322'
  || parsedDatabaseUrl.pathname !== '/postgres'
  || parsedDatabaseUrl.username !== 'postgres') {
  throw new Error('Refusing bootstrap replay: the database must be the isolated local Supabase database on port 54322.');
}

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
  throw new Error('Bootstrap manifest has no ordered source files.');
}

const orderByPath = new Map();
for (const [index, entry] of manifest.files.entries()) {
  if (entry.order !== index || typeof entry.path !== 'string' || !/^[a-f0-9]{64}$/i.test(entry.sha256)) {
    throw new Error(`Invalid bootstrap manifest entry at index ${index}.`);
  }
  if (orderByPath.has(entry.path)) throw new Error(`Duplicate bootstrap manifest path: ${entry.path}`);
  orderByPath.set(entry.path, index);
  const filePath = resolve(repositoryRoot, entry.path);
  const relativePath = relative(repositoryRoot, filePath);
  if (relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    throw new Error(`Bootstrap manifest path escapes the repository: ${entry.path}`);
  }
  const source = await readFile(filePath);
  const actualHash = createHash('sha256').update(source).digest('hex');
  if (actualHash.toLowerCase() !== entry.sha256.toLowerCase()) {
    throw new Error(`Bootstrap source checksum mismatch: ${entry.path}`);
  }
}

for (const entry of manifest.files) {
  for (const dependency of entry.dependsOn ?? []) {
    const dependencyOrder = orderByPath.get(dependency);
    if (dependencyOrder === undefined || dependencyOrder >= entry.order) {
      throw new Error(`Bootstrap dependency must precede ${entry.path}: ${dependency}`);
    }
  }
}

for (const [index, entry] of manifest.files.entries()) {
  console.log(`Applying manifest file ${index + 1}/${manifest.files.length}: ${entry.path}`);
  const result = spawnSync('psql', [
    databaseUrl,
    '-X',
    '-v', 'ON_ERROR_STOP=1',
    '-q',
    '-f', resolve(repositoryRoot, entry.path),
  ], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Bootstrap stopped at ${entry.path} with psql exit code ${result.status}.`);
  }
}

const smokeQuery = `
  SELECT (
    to_regclass('public.profiles') IS NOT NULL
    AND to_regclass('public.sales') IS NOT NULL
    AND to_regclass('public.sale_items') IS NOT NULL
    AND to_regclass('public.inventory_stock_lots') IS NOT NULL
    AND to_regclass('public.sale_item_stock_allocations') IS NOT NULL
    AND to_regnamespace('private') IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM pg_proc AS proc
      JOIN pg_namespace AS namespace ON namespace.oid = proc.pronamespace
      WHERE namespace.nspname = 'public' AND proc.proname = 'process_pos_sale_v4'
    )
    AND EXISTS (
      SELECT 1 FROM pg_trigger AS trigger_record
      JOIN pg_class AS relation ON relation.oid = trigger_record.tgrelid
      JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public' AND relation.relname = 'sale_items'
        AND trigger_record.tgname = 'zzzz_allocate_sale_item_stock_lots_trigger'
        AND NOT trigger_record.tgisinternal
    )
  )::text;
`;
const smoke = spawnSync('psql', [
  databaseUrl,
  '-X',
  '-v', 'ON_ERROR_STOP=1',
  '-A',
  '-t',
  '-q',
  '-c', smokeQuery,
], { encoding: 'utf8' });
if (smoke.error) throw smoke.error;
if (smoke.status !== 0 || smoke.stdout.trim() !== 't') {
  throw new Error(`Bootstrapped database did not contain the required schema and stock-allocation trigger (psql exit ${smoke.status}).`);
}

console.log(`Verified ${manifest.files.length} checksummed source files and required stock/checkout objects on the isolated Supabase database.`);
