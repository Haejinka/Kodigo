import { chromium } from 'file:///C:/Users/verga/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import fs from 'node:fs';

const out = 'deliverables/live_kodigo_screens';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
await page.goto('http://localhost:5173/login', { waitUntil: 'networkidle' });
await page.screenshot({ path: `${out}/figure-03-login.png`, fullPage: true });
await page.locator('input[type="email"]').fill(process.env.KODIGO_SCREENSHOT_EMAIL);
await page.locator('input[type="password"]').fill(process.env.KODIGO_SCREENSHOT_PASSWORD);
await page.getByRole('button', { name: 'Sign in' }).click();
await page.waitForURL('**/dashboard', { timeout: 15000 });
for (const [filename, route] of [
  ['figure-04-dashboard.png', '/dashboard'],
  ['figure-05-pos.png', '/pos'],
  ['figure-06-inventory.png', '/inventory'],
  ['figure-07-suppliers.png', '/suppliers'],
  ['figure-08-settings-security.png', '/settings/security'],
]) {
  await page.goto(`http://localhost:5173${route}`, { waitUntil: 'networkidle' });
  await page.screenshot({ path: `${out}/${filename}`, fullPage: true });
}
await browser.close();
console.log(out);
