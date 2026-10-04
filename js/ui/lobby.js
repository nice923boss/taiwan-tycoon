// Lobby: name, character seats (Atropos cards), room settings, invite QR, spectators.

import { assetSrc, loadImage } from '../../assets/manifest.js';
import { RULES, PLAYER_COLORS } from '../engine/rules.js';
import { t } from '../i18n/i18n.js';
import { CHARACTERS } from '../net/protocol.js';
import { $, fill, h, toast } from './dom.js';
import { lib } from './libs.js';
import { loadName, reducedMotion, saveName } from './settings.js';

export function createLobby({ session }) {
  const cards = new Map(); // char -> { root, face, owner }
  let qrDone = false;
  let last = null;

  const grid = $('#char-grid');
  for (const [i, char] of CHARACTERS.entries()) {
    const img = h('img', { src: assetSrc(`char-${char}`), alt: '', 'data-atropos-offset': '6' });
    loadImage(`char-${char}`).then(() => { img.src = assetSrc(`char-${char}`); }, () => {});
    const name = h('span', { class: 'char-name', 'data-atropos-offset': '3' });
    const owner = h('span', { class: 'char-owner' });
    const face = h('button', { type: 'button', class: 'char-face', onclick: () => pick(char) },
      h('span', { class: 'char-dot', style: { background: PLAYER_COLORS[i] } }), img, name, owner);
    const root = h('div', { class: 'char-card atropos' },
      h('div', { class: 'atropos-scale' }, h('div', { class: 'atropos-rotate' }, h('div', { class: 'atropos-inner' }, face))));
    grid.append(root);
    cards.set(char, { root, face, name, owner });
  }
  if (!reducedMotion()) {
    lib('atropos').then((Atropos) => {
      if (Atropos) for (const { root } of cards.values()) Atropos({ el: root, activeOffset: 30, shadowScale: 1.04 });
    });
  }

  function pick(char) {
    const { room, you } = session.state;
    if (!room) return;
    const seat = room.seats.find((s) => s.char === char);
    if (!seat) session.send({ t: 'sit', char });
    else if (seat.id === you) session.send({ t: 'stand' });
    else if (seat.cpu && room.leader === you) session.send({ t: 'removeCpu', char });
  }

  // A computer player takes the first free character, named CPU 1, CPU 2, ... (in the leader's language).
  const addCpuBtn = $('#btn-add-cpu');
  addCpuBtn.addEventListener('click', () => {
    if (addCpuBtn.getAttribute('aria-disabled') === 'true') {
      toast(addCpuBtn.dataset.tip, 'warn');
      return;
    }
    const { room } = session.state;
    const char = CHARACTERS.find((c) => !room.seats.some((s) => s.char === c));
    const names = new Set(room.seats.map((s) => s.name));
    let n = 1;
    while (names.has(t('ui.cpuName', { n }))) n += 1;
    session.send({ t: 'addCpu', char, name: t('ui.cpuName', { n }) });
  });

  const nameInput = $('#name-input');
  nameInput.value = loadName();
  $('#name-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = nameInput.value.trim();
    if (!name) return;
    saveName(name);
    session.setName(name);
    toast(t('ui.nameSaved'), 'good');
  });

  const roundsSelect = $('#rounds-select');
  roundsSelect.addEventListener('change', () => session.send({ t: 'rounds', n: Number(roundsSelect.value) }));

  const startBtn = $('#btn-start');
  startBtn.addEventListener('click', () => {
    if (startBtn.getAttribute('aria-disabled') === 'true') toast(startBtn.dataset.tip, 'warn');
    else session.send({ t: 'start' });
  });

  $('#btn-copy-link').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      toast(t('ui.copied'), 'good');
    } catch {
      toast(location.href, 'info', 8000);
    }
  });

  async function drawQr() {
    if (qrDone) return;
    qrDone = true;
    const QRCodeStyling = await lib('qr');
    if (!QRCodeStyling) return;
    new QRCodeStyling({
      width: 180, height: 180, data: location.href, margin: 4,
      dotsOptions: { color: '#14493d', type: 'rounded' },
      cornersSquareOptions: { type: 'extra-rounded', color: '#e8453c' },
      backgroundOptions: { color: '#ffffff' },
    }).append($('#qr'));
  }

  function nameOf(room, id) {
    return room.seats.find((s) => s.id === id)?.name ?? room.spectators.find((s) => s.id === id)?.name ?? '?';
  }

  function render(state) {
    last = state;
    const { room, you } = state;
    if (!room) return;
    drawQr();
    const mySeat = room.seats.find((s) => s.id === you);
    const isLeader = room.leader === you;
    // Show the current name (a generated guest name too) until the user types one.
    const current = mySeat?.name ?? room.spectators.find((s) => s.id === you)?.name;
    if (current && !nameInput.value && document.activeElement !== nameInput) nameInput.value = current;

    for (const [char, card] of cards) {
      const seat = room.seats.find((s) => s.char === char);
      card.name.textContent = t(`char.${char}`);
      card.owner.textContent = seat ? seat.name : t('ui.seatFree');
      card.root.classList.toggle('taken', Boolean(seat) && seat.id !== you);
      card.root.classList.toggle('mine', seat?.id === you);
      card.root.classList.toggle('offline', Boolean(seat) && !seat.online && !seat.cpu);
      card.root.classList.toggle('removable', Boolean(seat?.cpu) && isLeader);
      const label = !seat ? t('ui.sitAs', { char: t(`char.${char}`) }) : seat.id === you ? t('ui.standUp')
        : seat.cpu && isLeader ? t('ui.removeCpu', { name: seat.name }) : t('ui.seatTaken', { name: seat.name });
      card.face.setAttribute('aria-label', label);
      card.face.dataset.tip = label;
    }

    const full = room.seats.length >= RULES.maxPlayers;
    $('#lobby-note').textContent = mySeat ? t('ui.waitStart') : full ? t('ui.seatsFull') : t('ui.pickChar');

    fill(roundsSelect, ...RULES.roundOptions.map((n) => h('option', { value: n, selected: n === room.rounds }, t('ui.roundsN', { n }))));
    roundsSelect.disabled = !isLeader;

    const leaderName = room.leader ? nameOf(room, room.leader) : '?';
    const reason = !isLeader ? t('ui.onlyLeader', { name: leaderName })
      : room.seats.length < RULES.minPlayers ? t('err.needPlayers', { n: RULES.minPlayers }) : null;
    const cpuReason = !isLeader ? t('ui.onlyLeader', { name: leaderName }) : full ? t('ui.noFreeSeat') : null;
    addCpuBtn.setAttribute('aria-disabled', String(Boolean(cpuReason)));
    if (cpuReason) addCpuBtn.dataset.tip = cpuReason;
    else delete addCpuBtn.dataset.tip;

    startBtn.setAttribute('aria-disabled', String(Boolean(reason)));
    if (reason) startBtn.dataset.tip = reason;
    else delete startBtn.dataset.tip;
    $('#start-note').textContent = reason ?? t('ui.readyToStart', { n: room.seats.length });

    fill($('#spectator-list'), room.spectators.length
      ? room.spectators.map((s) => h('li', {}, s.id === you ? t('ui.youMark', { name: s.name }) : s.name))
      : h('li', { class: 'muted' }, t('ui.none')));
  }

  return { render, relabel: () => last && render(last) };
}
