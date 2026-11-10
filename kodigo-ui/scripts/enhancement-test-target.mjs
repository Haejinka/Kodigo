const DENIED_PROJECT_REFS = new Set(['vlnucrbsgxnetdiejnwt']);
const PROJECT_REF_PATTERN = /^[a-z0-9][a-z0-9-]{2,62}$/;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

function requireValue(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} is required.`);
  }

  return value.trim();
}

function parseUrl(value, protocols, label) {
  let url;

  try {
    url = new URL(requireValue(value, label));
  } catch {
    throw new Error(`${label} must be a valid URL.`);
  }

  if (!protocols.includes(url.protocol)) {
    throw new Error(`${label} must use ${protocols.join(' or ')}.`);
  }

  return url;
}

function assertProjectRef(projectRef) {
  const value = requireValue(projectRef, 'KODIGO_TEST_SUPABASE_PROJECT_REF');
  if (!PROJECT_REF_PATTERN.test(value)) {
    throw new Error('KODIGO_TEST_SUPABASE_PROJECT_REF has an invalid format.');
  }
  if (DENIED_PROJECT_REFS.has(value)) {
    throw new Error('The deployed KodiGo project is not an allowed test target.');
  }

  return value;
}

export function validateSupabaseTestTarget({ url: urlValue, projectRef: projectRefValue }) {
  const projectRef = assertProjectRef(projectRefValue);
  const url = parseUrl(urlValue, ['https:', 'http:'], 'KODIGO_TEST_SUPABASE_URL');

  if (url.username || url.password) {
    throw new Error('KODIGO_TEST_SUPABASE_URL must not contain credentials.');
  }

  const isLoopback = LOOPBACK_HOSTS.has(url.hostname);
  if (projectRef === 'local') {
    if (!isLoopback) {
      throw new Error('The local test project ref may only target a loopback host.');
    }
  } else if (url.hostname !== `${projectRef}.supabase.co`) {
    throw new Error('KODIGO_TEST_SUPABASE_URL does not match KODIGO_TEST_SUPABASE_PROJECT_REF.');
  }

  if (url.hostname.includes('vlnucrbsgxnetdiejnwt')) {
    throw new Error('The deployed KodiGo project is not an allowed test target.');
  }

  return { url, projectRef };
}

export function validatePostgresTestTarget({
  url: urlValue,
  projectRef: projectRefValue,
  databaseName: databaseNameValue,
  isolatedConfirmation,
}) {
  const projectRef = assertProjectRef(projectRefValue);
  const databaseName = requireValue(databaseNameValue, 'KODIGO_TEST_DATABASE_NAME');
  if (!/^[a-zA-Z_][a-zA-Z0-9_$-]{0,62}$/.test(databaseName)) {
    throw new Error('KODIGO_TEST_DATABASE_NAME has an invalid format.');
  }
  if (isolatedConfirmation !== 'true') {
    throw new Error('Set KODIGO_TEST_DATABASE_ISOLATED=true only for a disposable isolated database.');
  }

  const url = parseUrl(urlValue, ['postgres:', 'postgresql:'], 'KODIGO_TEST_DATABASE_URL');
  const username = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  const encodedDatabaseName = decodeURIComponent(url.pathname.replace(/^\//, ''));

  if (!username || !password) {
    throw new Error('KODIGO_TEST_DATABASE_URL must include a database username and password.');
  }
  if (!encodedDatabaseName || encodedDatabaseName !== databaseName) {
    throw new Error('KODIGO_TEST_DATABASE_URL does not match KODIGO_TEST_DATABASE_NAME.');
  }

  const isLoopback = LOOPBACK_HOSTS.has(url.hostname);
  const refMatchesEndpoint = url.hostname.includes(projectRef) || username.includes(projectRef);
  if (projectRef === 'local') {
    if (!isLoopback) {
      throw new Error('The local test project ref may only target a loopback host.');
    }
  } else if (!refMatchesEndpoint) {
    throw new Error('KODIGO_TEST_DATABASE_URL does not identify KODIGO_TEST_DATABASE_PROJECT_REF.');
  }

  if (`${url.hostname} ${username}`.includes('vlnucrbsgxnetdiejnwt')) {
    throw new Error('The deployed KodiGo project is not an allowed test target.');
  }

  const sslmode = url.searchParams.get('sslmode') || (isLoopback ? 'disable' : 'require');
  if (!['disable', 'allow', 'prefer', 'require', 'verify-ca', 'verify-full'].includes(sslmode)) {
    throw new Error('KODIGO_TEST_DATABASE_URL has an unsupported sslmode.');
  }

  return {
    host: url.hostname,
    port: url.port || (url.protocol === 'postgresql:' ? '5432' : '5432'),
    username,
    password,
    databaseName,
    sslmode,
    projectRef,
  };
}

export function parseEnhancementCase(args) {
  if (args.length !== 2 || args[0] !== '--case' || !/^T\d{2}$/.test(args[1])) {
    throw new Error('Specify exactly one allowlisted task ID, for example: --case T01.');
  }

  return args[1];
}
