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

/**
 * Every module that reaches into the markup by id. Add to this list when a new
 * one appears, or the "unused id" check below will fail and tell you to.
 */
const CONSUMERS = ['src/hud/hud.ts', 'src/app/router.ts', 'src/app/lobby.ts'] as const;

const consumerSource = CONSUMERS.map((path) => readFileSync(resolve(root, path), 'utf8')).join(
  '\n',
);

function markupIds(source: string): Set<string> {
  return new Set([...source.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1] as string));
}

function requestedIds(source: string): Set<string> {
  return new Set([...source.matchAll(/\bel(?:<[^>]*>)?\('([^']+)'\)/g)].map((m) => m[1] as string));
}

test('every id the UI asks for exists in index.html', () => {
  const available = markupIds(html);
  const missing = [...requestedIds(consumerSource)].filter((id) => !available.has(id));
  assert.deepEqual(missing, [], `code reads ids absent from index.html: ${missing.join(', ')}`);
});

test('the UI reads every id declared in the markup', () => {
  const requested = requestedIds(consumerSource);
  // The canvas is owned by the render stage, not by any id consumer.
  const exempt = new Set(['stage']);
  const unused = [...markupIds(html)].filter((id) => !requested.has(id) && !exempt.has(id));
  assert.deepEqual(unused, [], `index.html declares unused ids: ${unused.join(', ')}`);
});

test('the contract checks a non-trivial number of ids', () => {
  // Guards against the regexes above silently matching nothing and the
  // comparisons passing on two empty sets.
  assert.ok(requestedIds(consumerSource).size > 10);
  assert.ok(markupIds(html).size > 10);
});
