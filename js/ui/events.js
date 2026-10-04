// Plays engine events (dice, moves, cards, market close, game over) one after
// another as animation and sound. It also owns the board view update: tokens with
// a queued move are pinned to their start square before the view sees the new
// state, so they never flash at the destination before the move animation.

import { assetSrc, loadImage } from '../../assets/manifest.js';
import { STOCKS } from '../engine/stocks.js';
import { t } from '../i18n/i18n.js';
import { $, fill, h, toast } from './dom.js';
import { confettiBurst, fireworksShow, sfx } from './fx.js';
import { reducedMotion } from './settings.js';

const wait = (ms) => new Promise((r) => { setTimeout(r, ms); });
// A stalled animation (background tab, view swapped mid-move) must not block the queue.
const within = (promise, ms) => Promise.race([promise, wait(ms)]);
const BACKLOG = 6; // with more events queued than this, skip animations to catch up
const CARD_MS = 3200;
const TICKER_MS = 18500;
const UP = '#e8453c';
const DOWN = '#2fae5a';

// ctx: { getView(), onGameOver() }
export function createEvents({ getView, onGameOver }) {
  const cardPop = $('#card-pop');
  const ticker = $('#ticker');
  cardPop.setAttribute('role', 'status');
  for (const deck of ['chance', 'fate']) loadImage(`card-${deck}`).catch(() => {}); // placeholder stays on failure

  const queue = [];
  const pins = new Map(); // player index -> square the token is held on
  let seen = 0;
  let gameKey = null;
  let game = null;
  let running = false;
  let shownCard = null; // event on the card pop-up, kept for language changes
  let shownClose = null; // event on the ticker
  let cardTimer = 0;
  let tickerTimer = 0;

  const quick = () => reducedMotion() || document.hidden || queue.length > BACKLOG;
  // Reduced motion (Q5): no animation, and queue pauses capped at 300 ms.
  const pause = (ms) => wait(quick() ? Math.min(ms, 300) : ms);

  function setPin(p, pos) {
    if (pos === null) pins.delete(p);
    else pins.set(p, pos);
    getView()?.pin(p, pos);
  }

  function cardBody(e) {
    return [
      h('img', { src: assetSrc(`card-${e.deck}`), alt: '' }),
      h('div', { class: 'card-pop-deck' }, t('ui.cardDrawn', { p: e.p, deck: e.deck }, game)),
      h('div', { class: 'card-pop-text' }, t(`card.${e.card}`)),
    ];
  }
  function hideCard() {
    shownCard = null;
    cardPop.hidden = true;
  }
  function showCard(e) {
    shownCard = e;
    cardPop.className = `card-pop deck-${e.deck}`;
    fill(cardPop, cardBody(e));
    cardPop.hidden = false;
    clearTimeout(cardTimer);
    cardTimer = setTimeout(hideCard, CARD_MS);
  }

  // Closing prices of the round, coloured by the Taiwan convention (up red, down green).
  function closeItems(e) {
    const items = [h('strong', { class: 'ticker-item' }, t('ui.marketClosed', { round: e.round }))];
    if (e.news) items.push(h('span', { class: 'ticker-item' }, t(`news.${e.news}`)));
    for (const { sym } of STOCKS) {
      const c = game?.market.stocks[sym].history.find((x) => x.r === e.round);
      if (!c) continue;
      const chg = c.o ? (c.c - c.o) / c.o : 0;
      const arrow = chg > 0 ? '▲' : chg < 0 ? '▼' : '';
      items.push(h('span', { class: 'ticker-item', style: { color: chg > 0 ? UP : chg < 0 ? DOWN : 'inherit' } },
        `${t(`stock.${sym}`)} ${c.c.toFixed(2)} ${arrow}${Math.abs(chg * 100).toFixed(2)}%`));
    }
    return items;
  }
  function hideTicker() {
    shownClose = null;
    ticker.hidden = true;
  }
  function showClose(e) {
    shownClose = e;
    const still = reducedMotion();
    fill(ticker, h('div', { class: `ticker-track${still ? ' ticker-static' : ''}` }, closeItems(e)));
    ticker.hidden = false;
    clearTimeout(tickerTimer);
    tickerTimer = setTimeout(hideTicker, still ? 8000 : TICKER_MS);
  }

  async function play(e) {
    const view = getView();
    const fast = quick();
    switch (e.kind) {
      case 'dice':
        await within(view?.rollDice(e.dice, { reduced: fast, onImpact: () => sfx('dice') }), 4000);
        if (fast) sfx('dice');
        await pause(350);
        break;
      case 'move': {
        if (pins.has(e.p)) pins.set(e.p, e.to); // the view moves its own pin the same way
        await within(view?.moveToken(e.p, e.from, e.steps, e.to, Boolean(e.jump), fast), 3500);
        if (e.jump) sfx('error');
        else if (e.steps > 0 && e.from + e.steps >= 40) sfx('coin'); // passed Go
        break;
      }
      case 'card':
        sfx('card');
        showCard(e);
        await pause(1400);
        break;
      case 'close':
        showClose(e);
        await pause(600);
        break;
      case 'buy':
        sfx('coin');
        break;
      case 'build':
        sfx('build');
        break;
      case 'rent':
        sfx('pay');
        break;
      case 'trade':
        sfx('card');
        break;
      case 'turn':
        sfx('turn');
        await pause(200);
        break;
      case 'bankrupt':
        sfx('error');
        toast(t('ui.bankruptNotice', { p: e.p }, game), 'warn');
        break;
      case 'gameover':
        sfx('win');
        confettiBurst('envelope');
        fireworksShow();
        onGameOver();
        break;
      default:
        break;
    }
  }

  async function pump() {
    if (running) return;
    running = true;
    try {
      while (queue.length) await play(queue.shift());
    } finally {
      running = false;
      for (const p of [...pins.keys()]) setPin(p, null);
    }
  }

  function reset() {
    queue.length = 0;
    for (const p of [...pins.keys()]) setPin(p, null);
    clearTimeout(cardTimer);
    clearTimeout(tickerTimer);
    hideCard();
    hideTicker();
  }

  return {
    render(state) {
      const g = state.game;
      if (!g) {
        if (gameKey !== null) reset();
        gameKey = null;
        game = null;
        return;
      }
      const key = `${g.seed}|${g.startedAt}`;
      if (key !== gameKey) {
        // First state seen (joined mid-game, reload) or a new game: show it as is.
        gameKey = key;
        reset();
        seen = g.eventSeq;
      }
      const fresh = g.events.filter((e) => e.n > seen);
      seen = g.eventSeq;
      for (const e of fresh) if (e.kind === 'move' && !pins.has(e.p)) setPin(e.p, e.from);
      game = g;
      getView()?.update(g);
      queue.push(...fresh);
      pump();
    },
    // A new board view (2D/3D switch) gets the current pins and state.
    attach(view) {
      for (const [p, pos] of pins) view.pin(p, pos);
      if (game) view.update(game);
    },
    relabel() {
      if (shownCard) fill(cardPop, cardBody(shownCard));
      if (shownClose) fill(ticker.firstChild ?? ticker, closeItems(shownClose));
    },
  };
}
