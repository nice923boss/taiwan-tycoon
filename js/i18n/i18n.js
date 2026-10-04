// Runtime language switching (zh-TW / en). Every visible string goes through t().
// Engine messages are { key, params }; params follow the convention in
// js/engine/state.js and are resolved here, so a language switch re-renders
// past log lines too.

import zhTW from './zh-TW.js';
import en from './en.js';

const DICTS = { 'zh-TW': zhTW, en };
const FALLBACK = 'zh-TW';
const STORE_KEY = 'monopoly.lang';

export const LANGS = [
  { code: 'zh-TW', label: '繁體中文' },
  { code: 'en', label: 'English' },
];

const listeners = new Set();
let lang = detectLang();

function detectLang() {
  try {
    const saved = globalThis.localStorage?.getItem(STORE_KEY);
    if (DICTS[saved]) return saved;
  } catch {
    // Storage can be blocked (private mode); fall through to the browser language.
  }
  const nav = globalThis.navigator?.language ?? '';
  return /^zh/i.test(nav) ? 'zh-TW' : 'en';
}

export const getLang = () => lang;

export function setLang(code) {
  if (!DICTS[code] || code === lang) return;
  lang = code;
  try {
    globalThis.localStorage?.setItem(STORE_KEY, code);
  } catch {
    // Not persisted; the choice still applies to this tab.
  }
  for (const fn of listeners) fn(lang);
}

export function onLangChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;

export const hasKey = (key, code = lang) => key in DICTS[code];

// ctx: the game state (or anything with `players`) used to resolve player indices.
export function t(key, params = {}, ctx = null) {
  const tpl = DICTS[lang][key] ?? DICTS[FALLBACK][key] ?? key;
  return tpl.replace(/\{(\w+)\}/g, (whole, name) => (name in params ? resolveParam(name, params[name], ctx) : whole));
}

// Render an engine message { key, params }.
export const tm = (msg, ctx = null) => t(msg.key, msg.params, ctx);

function resolveParam(name, value, ctx) {
  if (value === null || value === undefined) return '';
  switch (name) {
    case 'p':
    case 'q':
      return ctx?.players?.[value]?.name ?? '?';
    case 'sq':
      return t(`sq.${value}`);
    case 'amt':
    case 'amt2':
      return money(value);
    case 'card':
      return t(`card.${value}`);
    case 'news':
      return t(`news.${value}`);
    case 'sym':
      return t(`stock.${value}`);
    case 'deck':
      return t(`deck.${value}`);
    default:
      return String(value);
  }
}

// Test hook: list the keys of a dictionary.
export const dictKeys = (code) => Object.keys(DICTS[code]);
