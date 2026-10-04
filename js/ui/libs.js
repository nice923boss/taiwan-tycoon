// Optional libraries are loaded on first use. When one fails (CDN blocked,
// offline), the feature is skipped and the player sees one notice.

import { t } from '../i18n/i18n.js';
import { toast } from './dom.js';

const cache = new Map();
let warned = false;

const LOADERS = {
  confetti: () => import('canvas-confetti').then((m) => m.default),
  fireworks: () => import('fireworks-js').then((m) => m.Fireworks),
  zzfx: () => import('zzfx'),
  tone: () => import('tone'),
  charts: () => import('lightweight-charts'),
  gsap: async () => {
    const [{ gsap }, { SplitText }] = await Promise.all([import('gsap'), import('gsap/SplitText.js')]);
    gsap.registerPlugin(SplitText);
    return { gsap, SplitText };
  },
  qr: () => import('qr-code-styling').then((m) => m.default),
  driver: () => import('driver.js').then((m) => m.driver),
  toPng: () => import('html-to-image').then((m) => m.toPng),
  atropos: () => import('atropos').then((m) => m.default),
};

const CSS = {
  driver: 'https://cdn.jsdelivr.net/npm/driver.js@1.9.0/dist/driver.css',
  atropos: 'https://cdn.jsdelivr.net/npm/atropos@2.0.2/atropos.css',
};

function addCss(href) {
  if (document.querySelector(`link[href="${href}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.append(link);
}

// Resolves with the library, or null when it cannot be loaded.
export function lib(name) {
  if (!cache.has(name)) {
    if (CSS[name]) addCss(CSS[name]);
    const p = LOADERS[name]().catch(() => {
      cache.delete(name);
      if (!warned) {
        warned = true;
        toast(t('ui.featureUnavailable'), 'warn');
      }
      return null;
    });
    cache.set(name, p);
  }
  return cache.get(name);
}
