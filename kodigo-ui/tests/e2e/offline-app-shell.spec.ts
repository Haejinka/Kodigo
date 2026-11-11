import { expect, test } from 'playwright/test';

test('previously loaded static app shell opens offline without caching API responses', async ({ page, context }) => {
  const browserErrors: string[] = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  page.on('requestfailed', (request) => browserErrors.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText}`));

  await page.goto('/login');
  await expect(page.getByText('Sign in to your account')).toBeVisible();
  await page.evaluate(async () => {
    await navigator.serviceWorker.register('/service-worker.js', { scope: '/' });
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));

  const cacheReport = await page.evaluate(async () => {
    const names = await caches.keys();
    const urls = (await Promise.all(names
      .filter((name) => name.startsWith('kodigo-shell-'))
      .map(async (name) => (await caches.open(name)).keys())))
      .flat()
      .map((request) => new URL(request.url).pathname);
    return {
      shellCacheCount: names.filter((name) => name.startsWith('kodigo-shell-')).length,
      paths: [...new Set(urls)],
    };
  });

  expect(cacheReport.shellCacheCount).toBeGreaterThan(0);
  expect(cacheReport.paths).toContain('/index.html');
  expect(cacheReport.paths.some((pathname) => /^\/assets\/.+\.(js|css)$/.test(pathname))).toBe(true);

  const apiPath = '/rest/v1/kodigo-shell-cache-check?select=id';
  await page.evaluate(async (url) => {
    try {
      await fetch(url);
    } catch {
      // The route is intentionally not part of the app-shell cache allowlist.
    }
  }, apiPath);
  const apiWasCached = await page.evaluate(async (url) => Boolean(await caches.match(url)), apiPath);
  expect(apiWasCached).toBe(false);

  await context.setOffline(true);
  let reloadError: string | undefined;
  try {
    await page.reload();
  } catch (error) {
    reloadError = error instanceof Error ? error.message : String(error);
  }
  const offlineState = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration('/');
    const cacheNames = (await caches.keys()).filter((name) => name.startsWith('kodigo-shell-'));
    const cachedPaths = (await Promise.all(cacheNames.map(async (name) => (await caches.open(name)).keys())))
      .flat()
      .map((request) => new URL(request.url).pathname);
    return {
      controller: navigator.serviceWorker.controller?.scriptURL ?? null,
      workerState: registration?.active?.state ?? null,
      rootHtml: document.querySelector('#root')?.innerHTML ?? null,
      cachedPaths,
    };
  });
  if (!offlineState.rootHtml || !offlineState.rootHtml.trim()) {
    console.error('Offline app shell diagnostics', JSON.stringify({ reloadError, offlineState, browserErrors }));
  }
  await expect(page.locator('#root > *').first()).toBeVisible();
  await expect(page.getByText('Sign in to your account')).toBeVisible();
});

test('app shell update contract only advertises supported durable formats', async ({ page }) => {
  await page.goto('/');
  const worker = await page.evaluate(async () => {
    const response = await fetch('/service-worker.js', { cache: 'no-store' });
    return response.text();
  });

  expect(worker).toContain('SUPPORTED_DATABASE_VERSION = 3');
  expect(worker).toContain('new Set([1])');
  expect(worker).toContain('ACTIVATE_COMPATIBLE_UPDATE');
  expect(worker).toContain('UPDATE_BLOCKED_MULTIPLE_TABS');
});
