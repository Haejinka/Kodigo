import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldReportClientError } from '../../src/lib/client-error-policy.ts';

test('does not report errors from a Vite development build even on a remote hostname', () => {
  assert.equal(shouldReportClientError(true, 'kodigo-blue.vercel.app'), false);
});

test('does not report errors from localhost or loopback addresses in preview builds', () => {
  for (const hostname of ['localhost', 'dev.localhost', '127.0.0.1', '127.42.9.3', '::1', '[::1]']) {
    assert.equal(shouldReportClientError(false, hostname), false, hostname);
  }
});

test('reports errors from a production host', () => {
  assert.equal(shouldReportClientError(false, 'kodigo-blue.vercel.app'), true);
});

test('fails closed when no browser hostname is available', () => {
  assert.equal(shouldReportClientError(false, undefined), false);
  assert.equal(shouldReportClientError(false, null), false);
});
