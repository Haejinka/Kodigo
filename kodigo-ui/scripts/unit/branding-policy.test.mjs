import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveActiveBranding } from '../../src/lib/branding-policy.ts';

const jetch = {
  id: 'old-store-id',
  name: 'jetch',
  businessName: 'jetch',
  registeredName: undefined,
  logoPath: 'old-store-id/logo/logo.png',
};

test('uses app branding when an account has no assigned stores', () => {
  assert.deepEqual(resolveActiveBranding([], null), {
    id: 'kodigo',
    name: 'KodiGo',
    businessName: 'KodiGo',
  });
});

test('does not reuse a previous account store branding when no matching store exists', () => {
  assert.deepEqual(resolveActiveBranding([], 'old-store-id'), {
    id: 'kodigo',
    name: 'KodiGo',
    businessName: 'KodiGo',
  });
});

test('uses the selected store branding for the signed-in account', () => {
  assert.deepEqual(resolveActiveBranding([jetch], 'old-store-id'), jetch);
});

test('uses the first assigned store branding when the account is in all-stores mode', () => {
  assert.deepEqual(resolveActiveBranding([jetch], 'all'), jetch);
});
