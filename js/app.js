// App coordinator: one session, the lobby and game screens, the board view,
// language and settings changes. Every state update flows through render().

import { assetSrc, loadImage } from '../assets/manifest.js';
import { getLang, onLangChange, setLang, t } from './i18n/i18n.js';
import { loadGuestName, loadSecret, roomIdFor } from './net/identity.js';
import { NAME_MAX } from './net/protocol.js';
import { createSession, SESSION_TIMING } from './net/session.js';
import { peerTransport } from './net/transport-peer.js';
import { createActions } from './ui/actions.js';
import { createBoard2d } from './ui/board2d.js';
import {
  $, button, confirmDialog, fill, h, icon, installTooltips, openDialog, remainingMs, toast, translateStatic,
} from './ui/dom.js';
import { createEvents } from './ui/events.js';
import { createFeed } from './ui/feed.js';
import { setMusic, setTempo, unlockAudio } from './ui/fx.js';
import { createHud } from './ui/hud.js';
import { createLobby } from './ui/lobby.js';
import { createManage } from './ui/manage.js';
import { createMarket } from './ui/market.js';
import { createResults } from './ui/results.js';
import {
  loadName, onSettingsChange, openSettings, reducedMotion, setSetting, settings,
} from './ui/settings.js';
import { createSquareInfo } from './ui/square-info.js';
import { createTour } from './ui/tour.js';
import { createTrade } from './ui/trade.js';

const SLOW_CONNECT_MS = 12000;
const TICK_MS = 250;
const TEMPO_ROUNDS = 5; // music speeds up for the last rounds

const params = new URLSearchParams(location.search);
const meIn = (state) => state.game?.players.findIndex((pl) => pl.id === state.you) ?? -1;

// three.js or WebGL can fail (old GPU, blocked CDN): the 2D board takes over.
async function makeView() {
  if (settings().view === '3d' && params.get('gl') !== '0') {
    try {
      const { createScene3d } = await import('./ui/scene3d.js');
      return createScene3d();
    } catch {
      toast(t('ui.webglFallback'), 'warn', 6000);
    }
  }
  return createBoard2d();
}

function setBackground(name) {
  loadImage(name).then(() => {
    const url = new URL(assetSrc(name), location.href).href;
    document.body.style.backgroundImage = `linear-gradient(rgba(10, 26, 22, 0.72), rgba(10, 26, 22, 0.9)), url("${url}")`;
    document.body.classList.add('has-bg');
  }, () => {});
}

// The header logo and tab icon are static markup pointing at the placeholder;
// switch them to the generated art once it loads, like every other asset.
function setLogo() {
  loadImage('char-bear').then(() => {
    const src = assetSrc('char-bear');
    $('.brand-logo').src = src;
    const tabIcon = document.querySelector('link[rel="icon"]');
    tabIcon.removeAttribute('type'); // the markup says image/svg+xml, which a PNG must not carry
    tabIcon.href = src;
  }, () => {});
}

export async function startApp() {
  setLogo();
  const guest = () => loadGuestName(() => t('ui.guestName', { n: Math.floor(100 + Math.random() * 900) }).slice(0, NAME_MAX));
  const session = createSession({
    transport: peerTransport, roomId: roomIdFor(location), secret: loadSecret(), name: loadName() || guest(),
  });

  let view = null;
  let viewJob = 0;
  let screen = null; // 'lobby' | 'game'
  let slowTimer = 0;
  let fastTempo = false;

  const manage = createManage({ session });
  const trade = createTrade({ session });
  const market = createMarket({ session });
  const feed = createFeed({ session });
  const hud = createHud();
  const lobby = createLobby({ session });
  const squareInfo = createSquareInfo();
  const results = createResults({ session });
  const tour = createTour();
  const actions = createActions({
    session,
    openManage: () => manage.open(),
    openTrade: () => trade.open(session.state),
    showMarket: () => { selectTab('market'); market.focusHolding(session.state); },
    showResults: () => results.open(session.state),
  });
  const events = createEvents({ getView: () => view, onGameOver: () => results.open(session.state) });

  // ---------- board view ----------

  async function mountView() {
    const job = ++viewJob;
    const next = await makeView();
    if (job !== viewJob) {
      next.dispose();
      return;
    }
    view?.dispose();
    view = next;
    view.mount($('#board'));
    view.onSquareClick((i, at) => squareInfo.show(i, at));
    $('#btn-view-reset').hidden = view.kind !== '3d';
    events.attach(view);
  }
  $('#btn-view-reset').addEventListener('click', () => view?.resetView());

  // ---------- tabs ----------

  const tabs = [...document.querySelectorAll('.tab')];
  function selectTab(name) {
    for (const tab of tabs) {
      const on = tab.dataset.tab === name;
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
      $(`#panel-${tab.dataset.tab}`).hidden = !on;
    }
    feed.shown(name);
  }
  for (const tab of tabs) tab.addEventListener('click', () => selectTab(tab.dataset.tab));
  $('.tabs').addEventListener('keydown', (e) => {
    const k = tabs.indexOf(document.activeElement);
    if (k < 0 || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    const next = tabs[(k + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    next.focus();
    selectTab(next.dataset.tab);
  });
  selectTab('market');

  // ---------- connection status ----------

  function connection(state) {
    const boot = $('#boot');
    const conn = $('#conn');
    if (state.status === 'stopped') {
      boot.hidden = true;
      conn.hidden = false;
      fill(conn, h('p', {}, t(state.reason ?? 'ui.disconnected')),
        h('button', { type: 'button', class: 'btn', onclick: () => location.reload() }, icon('refresh-cw'), t('ui.reload')));
      return;
    }
    conn.hidden = true;
    const waiting = state.status === 'connecting' && !state.room;
    boot.hidden = !waiting;
    if (!waiting) {
      clearTimeout(slowTimer);
      slowTimer = 0;
      return;
    }
    const card = h('div', { class: 'boot-card' }, h('div', { class: 'spinner', 'aria-hidden': 'true' }), h('p', {}, t('ui.connecting')));
    fill(boot, card);
    slowTimer ||= setTimeout(() => {
      if (!$('#boot').hidden) $('#boot .boot-card')?.append(h('p', { class: 'muted small' }, t('ui.connectSlow')));
    }, SLOW_CONNECT_MS);
  }

  // ---------- screens ----------

  function showScreen(next) {
    if (next === screen) return;
    screen = next;
    $('#lobby').hidden = next !== 'lobby';
    $('#game').hidden = next !== 'game';
    setBackground(next === 'game' ? 'bg-table' : 'bg-lobby');
    if (next === 'game' && !view) mountView();
    if (next === 'lobby') {
      squareInfo.close();
      setTimeout(() => tour.startOnce(), 600);
    }
  }

  // Spectators also get a button for each seat they may take over.
  let bannerKey = '';
  function spectateBanner(state) {
    const { game, room } = state;
    const banner = $('#spectate-banner');
    const me = meIn(state);
    banner.hidden = !game || (me >= 0 && !game.players[me].bankrupt);
    const open = me < 0 && game?.phase !== 'gameOver' ? room.seats.filter((seat) => seat.vacant) : [];
    // Rebuilt only when it changes, so a click is not lost to a re-render.
    const key = JSON.stringify([getLang(), me, open.map((seat) => [seat.char, seat.name])]);
    if (key === bannerKey) return;
    bannerKey = key;
    fill(banner, me >= 0 ? t('ui.spectatingBankrupt') : t('ui.spectating'), open.map((seat) => h('button', {
      type: 'button',
      class: 'btn btn-sm',
      onclick: async () => {
        const ok = await confirmDialog(t('ui.takeOverConfirm', { name: seat.name }), { okLabel: t('ui.takeOverOk') });
        if (ok && !session.send({ t: 'claim', char: seat.char })) toast(t('ui.reconnecting'), 'warn');
      },
    }, t('ui.takeOver', { name: seat.name }))));
  }

  // ---------- host handover ----------

  const nameOf = (room, id) => room.seats.find((s) => s.id === id)?.name ?? room.spectators.find((s) => s.id === id)?.name ?? '?';

  // Any member but the host may ask; with no host to ask (link lost) the session takes the room by force.
  $('#btn-takeover').addEventListener('click', async () => {
    const n = Math.round(SESSION_TIMING.host.handoverMs / 1000);
    const ok = await confirmDialog(t('ui.becomeHostConfirm', { n }), { okLabel: t('ui.becomeHostOk') });
    if (!ok || session.state.isHost) return;
    const online = session.state.status === 'online';
    session.takeover();
    if (online) toast(t('ui.becomeHostSent'), 'good');
  });

  // The host gets a countdown with "decline" and "hand over now". Closing the
  // dialog does not decline: the countdown runs on and it stays closed.
  let handover = null; // { dlg, until, by, text } while the dialog is open
  let dismissedUntil = 0;

  function closeHandover() {
    const open = handover;
    handover = null;
    open?.dlg.close();
  }

  function handoverDialog(state) {
    const req = state.isHost ? state.room?.handover : null;
    if (handover && handover.until !== req?.until) closeHandover();
    if (!req || handover || req.until === dismissedUntil) return;
    const answer = (ok) => {
      closeHandover();
      session.answerHandover(ok);
    };
    const text = h('p');
    const dlg = openDialog({
      title: t('ui.handoverTitle'),
      body: text,
      actions: [
        button(t('ui.handoverDecline'), { kind: 'btn-danger', onClick: () => answer(false) }),
        button(t('ui.handoverNow'), { kind: 'btn-primary', onClick: () => answer(true) }),
      ],
      onClose: () => {
        if (handover?.dlg !== dlg) return;
        handover = null;
        dismissedUntil = req.until;
      },
    });
    handover = { dlg, until: req.until, by: req.by, text };
    handoverTick(state);
  }

  function handoverTick(state) {
    if (!handover || !state.room) return;
    const n = Math.ceil(remainingMs(handover.until, state.offset) / 1000);
    handover.text.textContent = t('ui.handoverAsk', { name: nameOf(state.room, handover.by), n });
  }

  function render(state) {
    connection(state);
    $('#btn-takeover').hidden = !state.room || state.isHost || state.status === 'stopped';
    handoverDialog(state);
    if (!state.room) return;
    showScreen(state.game ? 'game' : 'lobby');
    events.render(state); // the only caller of view.update (keeps tokens pinned during moves)
    hud.render(state);
    if (state.game) {
      actions.render(state);
      market.render(state);
      spectateBanner(state);
      const g = state.game;
      const fast = g.phase !== 'gameOver' && g.round > g.maxRounds - TEMPO_ROUNDS;
      if (fast !== fastTempo) setTempo((fastTempo = fast));
    } else {
      lobby.render(state);
    }
    feed.render(state);
    manage.render(state);
    trade.render(state);
    squareInfo.render(state);
    results.render(state);
  }

  session.onUpdate(() => render(session.state));
  session.onError((key, p) => toast(t(key, p ?? {}, session.state.game), 'warn'));

  // ---------- top bar ----------

  const soundBtn = $('#btn-sound');
  function soundIcon() {
    soundBtn.querySelector('.icon')?.replaceWith(icon(settings().sound ? 'volume-2' : 'volume-x'));
    soundBtn.setAttribute('aria-pressed', String(settings().sound));
  }
  soundBtn.addEventListener('click', () => setSetting('sound', !settings().sound));
  $('#btn-lang').addEventListener('click', () => setLang(getLang() === 'zh-TW' ? 'en' : 'zh-TW'));
  $('#btn-tour').addEventListener('click', () => tour.start());
  $('#btn-settings').addEventListener('click', () => openSettings({
    session,
    canResign: () => {
      const { game } = session.state;
      const me = meIn(session.state);
      return Boolean(game) && game.phase !== 'gameOver' && me >= 0 && !game.players[me].bankrupt;
    },
    onResign: () => session.send({ t: 'act', a: { type: 'RESIGN' } }),
    startTour: () => tour.start(),
  }));

  // ---------- language, settings, motion ----------

  onLangChange((code) => {
    document.documentElement.lang = code === 'en' ? 'en' : 'zh-Hant';
    translateStatic();
    for (const part of [hud, lobby, actions, market, feed, events, squareInfo, results, tour]) part.relabel();
    view?.repaint();
    render(session.state);
  });

  const applyMotion = () => document.documentElement.classList.toggle('reduce-motion', reducedMotion());
  globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').addEventListener?.('change', applyMotion);
  onSettingsChange((key, value) => {
    if (key === 'view' && view) mountView();
    if (key === 'sound') soundIcon();
    if (key === 'music') setMusic(value);
    if (key === 'motion') applyMotion();
  });
  applyMotion();
  soundIcon();

  // ---------- page lifecycle ----------

  const unlock = () => unlockAudio();
  addEventListener('pointerdown', unlock, { once: true });
  addEventListener('keydown', unlock, { once: true });
  // Leaving hands the host role over at once instead of after the silence timeout.
  addEventListener('pagehide', () => session.stop());
  addEventListener('pageshow', (e) => { if (e.persisted) location.reload(); });
  setInterval(() => {
    hud.tick(session.state);
    actions.tick(session.state);
    handoverTick(session.state);
  }, TICK_MS);

  installTooltips();
  $('#topbar').hidden = false;
  render(session.state);
  await session.ready;
}
