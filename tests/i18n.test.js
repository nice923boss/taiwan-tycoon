// Dictionaries and the t() renderer.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import zhTW from '../js/i18n/zh-TW.js';
import en from '../js/i18n/en.js';
import {
  LANGS, dictKeys, getLang, hasKey, money, onLangChange, setLang, t, tm,
} from '../js/i18n/i18n.js';
import { GROUPS, SQUARES } from '../js/engine/board.js';
import { DECKS } from '../js/engine/cards.js';
import { NEWS, STOCKS } from '../js/engine/stocks.js';
import { ASSET_NAMES } from '../assets/manifest.js';

const DICTS = { 'zh-TW': zhTW, en };
const placeholders = (s) => [...new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort();

const jsRoot = fileURLToPath(new URL('../js/', import.meta.url));
const sourceFiles = (dir) => readdirSync(jsRoot + dir).filter((f) => f.endsWith('.js')).map((f) => `${dir}/${f}`);
const rootFiles = readdirSync(jsRoot).filter((f) => f.endsWith('.js'));
const SOURCES = [...rootFiles, ...['engine', 'net', 'ui'].flatMap(sourceFiles)].map((file) => ({ file, text: readFileSync(jsRoot + file, 'utf8') }));
const HTML = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('zh-TW and en have identical key sets', () => {
  const zk = Object.keys(zhTW).sort();
  const ek = Object.keys(en).sort();
  assert.deepEqual(zk.filter((k) => !(k in en)), [], 'keys missing in en');
  assert.deepEqual(ek.filter((k) => !(k in zhTW)), [], 'keys missing in zh-TW');
  assert.deepEqual(zk, ek);
  assert.deepEqual(dictKeys('en').sort(), ek);
  assert.deepEqual(LANGS.map((l) => l.code), Object.keys(DICTS));
});

test('every value is a non-empty string with the same placeholders in both languages', () => {
  for (const key of Object.keys(zhTW)) {
    for (const [code, dict] of Object.entries(DICTS)) {
      assert.equal(typeof dict[key], 'string', `${code} ${key}`);
      assert.ok(dict[key].trim().length > 0, `${code} ${key} is empty`);
    }
    assert.deepEqual(placeholders(zhTW[key]), placeholders(en[key]), `placeholders differ for ${key}`);
  }
});

test('all required dictionary keys exist', () => {
  const required = [
    ...SQUARES.map((s) => `sq.${s.id}`),
    ...Object.values(DECKS).flat().map((c) => `card.${c.id}`),
    ...Object.keys(DECKS).map((d) => `deck.${d}`),
    ...NEWS.map((n) => `news.${n.id}`),
    ...STOCKS.flatMap((s) => [`stock.${s.sym}`, `sector.${s.sym}`]),
    ...Object.keys(GROUPS).map((g) => `group.${g}`),
    ...ASSET_NAMES.filter((n) => n.startsWith('char-')).map((n) => `char.${n.slice(5)}`),
  ];
  assert.equal(SQUARES.length, 40);
  assert.equal(required.filter((k) => k.startsWith('char.')).length, 6);
  for (const code of Object.keys(DICTS)) {
    assert.deepEqual(required.filter((k) => !hasKey(k, code)), [], `missing in ${code}`);
  }
});

test('every err, log, why and ui key used in the source exists in both dictionaries', () => {
  const used = new Set();
  for (const { text } of SOURCES) {
    for (const m of text.matchAll(/\bfail\('(\w+)'/g)) used.add(`err.${m[1]}`);
    for (const m of text.matchAll(/'((?:log|why|err|ui)\.\w+)'/g)) used.add(m[1]);
    for (const m of text.matchAll(/\bt\('([\w.]+)'/g)) used.add(m[1]);
  }
  // Static markup: data-i (text), data-i-label (aria-label), data-i-ph (placeholder).
  for (const m of HTML.matchAll(/data-i(?:-label|-ph)?="([\w.]+)"/g)) used.add(m[1]);
  assert.ok(used.size > 70, `only ${used.size} keys found; the scan is broken`);
  for (const k of ['err.notNow', 'err.badRequest', 'log.buy', 'log.buildHotel', 'log.tradeExpired', 'why.rent', 'ui.boardTitle']) {
    assert.ok(used.has(k), `scan missed ${k}`);
  }
  for (const code of Object.keys(DICTS)) {
    assert.deepEqual([...used].filter((k) => !hasKey(k, code)).sort(), [], `missing in ${code}`);
  }
  // Template-built keys use these prefixes; all of them must be covered by the required-keys test.
  const prefixes = new Set();
  for (const { text } of SOURCES) {
    for (const m of text.matchAll(/`(\w+)\.\$\{/g)) prefixes.add(m[1]);
  }
  for (const p of prefixes) assert.ok(['sq', 'card', 'news', 'stock', 'deck', 'err', 'char', 'group', 'sector'].includes(p), `unchecked key prefix ${p}`);
});

test('t() resolves params per language and setLang switches the output', () => {
  const ctx = { players: [{ name: 'Ann' }, { name: 'Bob' }] };
  setLang('en');
  assert.equal(getLang(), 'en');
  assert.equal(t('log.buy', { p: 0, sq: 39, amt: 1400 }, ctx), 'Ann bought Taipei 101 for $1,400');
  assert.equal(t('log.dice', { p: 1, d1: 3, d2: 4, sum: 7 }, ctx), 'Bob rolled 3 + 4 = 7');
  assert.equal(t('log.stockBuy', { p: 0, sym: 'CHIP', n: 5, amt: 600 }, ctx), `Ann bought 5 shares of ${en['stock.CHIP']} for $600`);
  assert.equal(t('log.drawCard', { p: 0, deck: 'chance', card: 'c01' }, ctx), `Ann drew Chance: ${en['card.c01']}`);
  assert.equal(t('log.news', { news: 'n01' }), `Market news: ${en['news.n01']}`);
  assert.equal(tm({ key: 'err.bidTooLow', params: { amt: 20 } }), 'Bid at least $20');
  const english = t('log.buy', { p: 0, sq: 39, amt: 1400 }, ctx);

  setLang('zh-TW');
  assert.equal(getLang(), 'zh-TW');
  assert.equal(t('log.buy', { p: 0, sq: 39, amt: 1400 }, ctx), `Ann 以 $1,400 買下 ${zhTW['sq.39']}`);
  assert.notEqual(t('log.buy', { p: 0, sq: 39, amt: 1400 }, ctx), english);
  assert.equal(tm({ key: 'err.bidTooLow', params: { amt: 20 } }), '出價至少要 $20');

  setLang('en');
  // Unknown players, null params and params missing from the call.
  assert.equal(t('log.buy', { p: 9, sq: 39, amt: 1 }, ctx), '? bought Taipei 101 for $1');
  assert.equal(t('log.buy', { p: 0, sq: 39, amt: 1 }), '? bought Taipei 101 for $1');
  assert.equal(t('log.bankruptBank', { p: 0, q: null }, ctx), 'Ann went bankrupt; properties return to the bank');
  assert.equal(t('log.dice', { p: null, d1: 1, d2: 2, sum: 3 }), ' rolled 1 + 2 = 3');
  assert.equal(t('log.dice', { p: 0 }, ctx), 'Ann rolled {d1} + {d2} = {sum}');
  assert.equal(t('ui.goCollect', { amt: 200 }), 'Collect $200');
  setLang('zh-TW');
});

test('an unknown key falls back to the key string', () => {
  for (const code of Object.keys(DICTS)) {
    setLang(code);
    assert.equal(t('no.such.key'), 'no.such.key');
    assert.equal(t('no.such.key', { p: 0 }), 'no.such.key');
    assert.equal(tm({ key: 'err.nope', params: {} }), 'err.nope');
    assert.equal(hasKey('no.such.key'), false);
  }
  setLang('zh-TW');
});

test('setLang ignores unknown or unchanged languages and notifies listeners', () => {
  setLang('zh-TW');
  const seen = [];
  const off = onLangChange((code) => seen.push(code));
  setLang('xx');
  setLang('zh-TW');
  assert.deepEqual(seen, []);
  assert.equal(getLang(), 'zh-TW');
  setLang('en');
  setLang('zh-TW');
  assert.deepEqual(seen, ['en', 'zh-TW']);
  off();
  setLang('en');
  assert.deepEqual(seen, ['en', 'zh-TW']);
  setLang('zh-TW');
});

test('money formats whole dollars with thousands separators', () => {
  assert.equal(money(0), '$0');
  assert.equal(money(1500), '$1,500');
  assert.equal(money(1234567), '$1,234,567');
  assert.equal(money(1499.6), '$1,500');
});

test('zh-TW values contain no em-dash', () => {
  const bad = Object.entries(zhTW).filter(([, v]) => v.includes('—')).map(([k]) => k);
  assert.deepEqual(bad, []);
});
