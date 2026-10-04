// Bootstrap: static translation and icons first, then the app module graph.
// A failure here (CDN down, old browser) ends on a readable error screen.

import { getLang, t } from './i18n/i18n.js';
import { hydrateIcons, showFatal, translateStatic } from './ui/dom.js';

document.documentElement.lang = getLang() === 'en' ? 'en' : 'zh-Hant';
translateStatic();
hydrateIcons();

try {
  const { startApp } = await import('./app.js');
  await startApp();
} catch (err) {
  showFatal(t('ui.loadFailed'), String(err?.message ?? err));
}
