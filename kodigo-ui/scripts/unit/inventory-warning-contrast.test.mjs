import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const css = await readFile(new URL('../../src/index.css', import.meta.url), 'utf8');
const productForm = await readFile(new URL('../../src/components/inventory/ProductForm.tsx', import.meta.url), 'utf8');

function getVariables(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const block = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1];
  assert.ok(block, `Missing theme selector ${selector}`);
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((match) => [match[1], match[2].trim()]));
}

const light = getVariables(':root');
const dark = getVariables('.dark');

function parseColor(value) {
  const hex = value.match(/^#([0-9a-f]{6})$/i)?.[1];
  if (hex) return [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
  const rgba = value.match(/^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/i);
  assert.ok(rgba, `Unsupported color token ${value}`);
  return { color: rgba.slice(1, 4).map(Number), alpha: Number(rgba[4]) };
}

function blend(foreground, background) {
  const parsed = parseColor(foreground);
  if (Array.isArray(parsed)) return parsed;
  const base = parseColor(background);
  assert.ok(Array.isArray(base));
  return parsed.color.map((channel, index) => Math.round(channel * parsed.alpha + base[index] * (1 - parsed.alpha)));
}

function luminance(color) {
  const channels = Array.isArray(color) ? color : parseColor(color);
  const linear = channels.map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrastRatio(foreground, background) {
  const foregroundLuminance = luminance(foreground);
  const backgroundLuminance = luminance(background);
  return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05)
    / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
}

test('safety-stock warning uses semantic warning tokens with WCAG AA text contrast in light and dark themes', () => {
  const alert = productForm.match(/<div role="status" className="([^"]+)"[^>]*><AlertTriangle[^>]*><\/AlertTriangle>|<div role="status" className="([^"]+)"[^>]*><AlertTriangle/);
  assert.ok(alert, 'Expected the safety-stock message to be an announced status alert');
  const classes = alert[1] || alert[2];
  assert.match(classes, /border-\[var\(--warning\)\]/);
  assert.match(classes, /bg-\[var\(--warning-soft\)\]/);
  assert.match(classes, /text-\[var\(--warning-foreground\)\]/);

  const lightBackground = light['warning-soft'];
  const lightText = light['warning-foreground'];
  assert.ok(contrastRatio(lightText, lightBackground) >= 4.5, 'Light warning text must meet WCAG AA');
  assert.ok(contrastRatio(light.warning, lightBackground) >= 3, 'Light warning border must remain distinguishable');

  const darkText = dark['warning-foreground'];
  for (const surface of [dark.card, dark.muted]) {
    const darkBackground = blend(dark['warning-soft'], surface);
    assert.ok(contrastRatio(darkText, darkBackground) >= 4.5, `Dark warning text must meet WCAG AA on ${surface}`);
    assert.ok(contrastRatio(dark.warning, darkBackground) >= 3, `Dark warning border must remain distinguishable on ${surface}`);
  }
});

test('semantic success, error, and information colors remain readable on their themed surfaces', () => {
  assert.ok(contrastRatio(light['success-foreground'], light['success-soft']) >= 4.5);
  assert.ok(contrastRatio(light.destructive, light['destructive-soft']) >= 4.5);
  assert.ok(contrastRatio(light.foreground, light['primary-soft']) >= 4.5);

  for (const surface of [dark.card, dark.muted]) {
    assert.ok(contrastRatio(dark['success-foreground'], blend(dark['success-soft'], surface)) >= 4.5);
    assert.ok(contrastRatio(dark.destructive, blend(dark['destructive-soft'], surface)) >= 4.5);
    assert.ok(contrastRatio(dark.foreground, blend(dark['primary-soft'], surface)) >= 4.5);
  }
});
