import { expect, test } from 'playwright/test';

test('restocking preview renders a nonfiscal shopping list without posting a sale', async ({ page }) => {
  const receiptOrDrawerRequests: string[] = [];
  page.on('request', (request) => {
    if (/\/v1\/(receipts\/print|drawer\/pulse)/.test(request.url())) receiptOrDrawerRequests.push(request.url());
  });

  await page.goto('/restocking');
  if (await page.getByRole('heading', { name: 'Sign in to your account' }).count()) {
    test.skip(true, 'Provide an authenticated admin browser state to exercise restocking.');
  }

  const itemSelection = page.getByRole('checkbox', { name: /^Select / });
  if (await itemSelection.count() === 0) {
    test.skip(true, 'The test store needs an existing restocking item; no product data is created by this test.');
  }
  await itemSelection.first().check();
  await page.getByRole('button', { name: 'Preview / Print List' }).click();

  const dialog = page.getByRole('dialog', { name: 'Shopping-list preview' });
  await expect(dialog).toBeVisible();
  const preview = page.frameLocator('iframe[title="Nonfiscal shopping-list document preview"]');
  await expect(preview.getByText('SHOPPING LIST — NOT A SALES RECEIPT')).toBeVisible();
  await expect(preview.getByText('Invoice No.')).toHaveCount(0);
  await expect(preview.getByText('Payment Method')).toHaveCount(0);

  await dialog.getByLabel('Shopping-list paper profile').selectOption('80mm');
  await dialog.getByLabel('Show prices').uncheck();
  await expect(preview.getByText('Estimated cost')).toHaveCount(0);
  await expect(preview.getByText('TOTAL AMOUNT')).toHaveCount(0);

  await dialog.getByRole('button', { name: 'Refresh snapshot' }).click();
  await expect(preview.getByText('SHOPPING LIST — NOT A SALES RECEIPT')).toBeVisible();
  await dialog.getByRole('button', { name: 'Close preview' }).click();
  expect(receiptOrDrawerRequests).toEqual([]);
});
