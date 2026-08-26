/**
 * The HUD is plain DOM driven by ids. `Hud` throws at construction if an id it
 * expects is missing from index.html — but only once a browser runs it, which
 * is exactly when it's most annoying to find out. This test enforces the
 * contract at build time instead: every id read by hud.ts must exist in the
 * markup, and every id in the markup should be one the HUD actually uses.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');

const html = readFileSync(resolve(root, 'index.html'), 'utf8');
const hudSource = readFileSync(resolve(root, 'src/hud/hud.ts'), 'utf8');

function markupIds(source: string): Set<string> {
  return new Set([...source.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1] as string));
}

function requestedIds(source: string): Set<string> {
  return new Set([...source.matchAll(/\bel(?:<[^>]*>)?\('([^']+)'\)/g)].map((m) => m[1] as string));
}

test('every id the HUD asks for exists in index.html', () => {
  const available = markupIds(html);
  const missing = [...requestedIds(hudSource)].filter((id) => !available.has(id));
  assert.deepEqual(missing, [], `hud.ts reads ids absent from index.html: ${missing.join(', ')}`);
});

test('the HUD reads every id declared in the markup', () => {
  const requested = requestedIds(hudSource);
  // The canvas is owned by the render stage, not the HUD.
  const exempt = new Set(['stage']);
  const unused = [...markupIds(html)].filter((id) => !requested.has(id) && !exempt.has(id));
  assert.deepEqual(unused, [], `index.html declares unused ids: ${unused.join(', ')}`);
});

test('the HUD asks for a non-trivial number of ids', () => {
  // Guards against the regexes above silently matching nothing and the
  // comparisons passing on two empty sets.
  assert.ok(requestedIds(hudSource).size > 10);
  assert.ok(markupIds(html).size > 10);
});
