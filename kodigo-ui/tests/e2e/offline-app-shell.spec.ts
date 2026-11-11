import { expect, test } from 'playwright/test';

test('previously loaded static app shell opens offline without caching API responses', async ({ page, context }) => {
  await page.goto('/login');
  await page.evaluate(async () => {
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
  await page.reload();
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
