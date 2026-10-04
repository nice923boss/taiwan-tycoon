// Guided tour (Driver.js). Steps follow the screen that is showing (lobby or
// game) and skip anything hidden; a language switch restarts the tour on the
// same step in the new language. Step texts come only from the dictionaries.

import { t } from '../i18n/i18n.js';
import { $ } from './dom.js';
import { lib } from './libs.js';

const SEEN_KEY = 'monopoly.tourSeen';

// [element, title key, text key]
const LOBBY_STEPS = [
  ['#char-grid', 'ui.tourCharsTitle', 'ui.tourChars'],
  ['#rounds-select', 'ui.tourRoundsTitle', 'ui.tourRounds'],
  ['#btn-start', 'ui.tourStartTitle', 'ui.tourStart'],
  ['#qr', 'ui.tourInviteTitle', 'ui.tourInvite'],
  ['#btn-lang', 'ui.tourLangTitle', 'ui.tourLang'],
  ['#btn-settings', 'ui.tourSettingsTitle', 'ui.tourSettings'],
];

const GAME_STEPS = [
  ['#board', 'ui.tourBoardTitle', 'ui.tourBoard'],
  ['#dock', 'ui.tourDockTitle', 'ui.tourDock'],
  ['#players', 'ui.tourPlayersTitle', 'ui.tourPlayers'],
  ['#tab-market', 'ui.tourMarketTitle', 'ui.tourMarket'],
  ['#tab-log', 'ui.tourLogTitle', 'ui.tourLog'],
  ['#tab-chat', 'ui.tourChatTitle', 'ui.tourChat'],
  ['#btn-settings', 'ui.tourSettingsTitle', 'ui.tourSettings'],
];

const visible = (el) => Boolean(el) && el.getClientRects().length > 0;

export function createTour() {
  let drv = null;

  function steps() {
    const list = $('#game').hidden ? LOBBY_STEPS : GAME_STEPS;
    return list.filter(([sel]) => visible($(sel))).map(([sel, title, text]) => ({
      element: sel,
      popover: { title: t(title), description: t(text) },
    }));
  }

  async function start(at = 0) {
    const make = await lib('driver');
    if (!make) return;
    drv?.destroy();
    const list = steps();
    if (!list.length) return;
    drv = make({
      steps: list,
      showProgress: true,
      progressText: t('ui.tourProgress').replace('{n}', '{{current}}').replace('{max}', '{{total}}'),
      nextBtnText: t('ui.tourNext'),
      prevBtnText: t('ui.tourPrev'),
      doneBtnText: t('ui.tourDone'),
      onDestroyed: () => { drv = null; },
    });
    drv.drive(Math.min(at, list.length - 1));
  }

  return {
    start,
    // First visit only; remembered per browser.
    startOnce() {
      try {
        if (localStorage.getItem(SEEN_KEY)) return;
        localStorage.setItem(SEEN_KEY, '1');
      } catch {
        return; // storage blocked: do not risk showing it on every load
      }
      start();
    },
    relabel() {
      if (drv?.isActive()) start(drv.getActiveIndex() ?? 0);
    },
  };
}
