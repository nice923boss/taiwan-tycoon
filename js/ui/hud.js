// Top-bar chips and the player list with cash, net worth, holdings and turn timer.

import { assetSrc } from '../../assets/manifest.js';
import { GROUPS, SQUARES } from '../engine/board.js';
import { RULES, netWorth, rentPercent } from '../engine/rules.js';
import { STOCKS } from '../engine/stocks.js';
import { money, t } from '../i18n/i18n.js';
import { $, fill, h, remainingMs } from './dom.js';

export function createHud() {
  const open = new Set(); // player ids whose details are expanded
  const timers = []; // { el, text } for the current player's countdown
  let last = null;

  function chips(state) {
    const { game, room, isHost, status } = state;
    const round = $('#round-chip');
    round.hidden = !game;
    if (game) {
      const n = game.maxRounds ? Math.min(game.round, game.maxRounds) : game.round;
      const pct = rentPercent(n);
      fill(round, h('span', {}, game.maxRounds ? t('ui.roundOf', { n, max: game.maxRounds }) : t('ui.roundN', { n })),
        pct > 100 ? h('span', { class: 'rent-x' }, t('ui.rentX', { x: pct / 100 })) : null);
    }
    const host = $('#host-chip');
    const nameOf = (id) => room?.seats.find((s) => s.id === id)?.name ?? room?.spectators.find((s) => s.id === id)?.name ?? '?';
    host.hidden = !room;
    host.textContent = room?.handover ? t('ui.handoverPending', { name: nameOf(room.handover.by) })
      : isHost ? t('ui.youAreHost') : t('ui.hostIs', { name: nameOf(room?.host) });
    const net = $('#net-chip');
    net.hidden = status === 'online';
    net.textContent = t('ui.reconnecting');
  }

  function detail(game, p) {
    const pl = game.players[p];
    const props = Object.entries(game.props).filter(([, st]) => st.owner === p).map(([id, st]) => {
      const extra = st.mortgaged ? t('ui.mortgagedTag') : st.houses === 5 ? t('ui.hotel') : st.houses ? t('ui.housesN', { n: st.houses }) : '';
      return h('li', {}, t(`sq.${id}`), extra ? ` (${extra})` : '');
    });
    const stocks = STOCKS.filter((s) => pl.stocks[s.sym]?.n).map((s) => h('li', {}, t('ui.holding', { sym: s.sym, n: pl.stocks[s.sym].n })));
    return h('div', { class: 'pl-detail' },
      h('strong', {}, t('ui.properties')), props.length ? h('ul', {}, props) : h('p', { class: 'muted' }, t('ui.none')),
      h('strong', {}, t('ui.stocks')), stocks.length ? h('ul', {}, stocks) : h('p', { class: 'muted' }, t('ui.none')),
      pl.jailCards.length ? h('p', {}, t('ui.jailCardsN', { n: pl.jailCards.length })) : null);
  }

  function players(state) {
    const { game, room, you } = state;
    const list = $('#players');
    timers.length = 0;
    if (!game) return fill(list);
    const rows = game.players.map((pl, p) => {
      const seat = room?.seats.find((s) => s.id === pl.id);
      const online = seat?.online ?? false;
      const tags = [];
      if (pl.id === you) tags.push(h('span', { class: 'pl-tag' }, t('ui.you')));
      if (pl.bankrupt) tags.push(h('span', { class: 'pl-tag warn' }, t('ui.bankrupt')));
      else if (pl.inJail) tags.push(h('span', { class: 'pl-tag warn' }, t('ui.inJail')));
      if (seat?.cpu) tags.push(h('span', { class: 'pl-tag' }, t('ui.cpu')));
      else if (!online && !pl.bankrupt) tags.push(h('span', { class: 'pl-tag warn' }, t(seat?.bot ? 'ui.bot' : 'ui.offline')));
      const groups = [...new Set(SQUARES.filter((sq) => game.props[sq.id]?.owner === p && sq.group).map((sq) => sq.group))];
      const current = game.current === p && game.phase !== 'gameOver';
      const timer = current ? h('div', { class: 'timer pl-timer' }, h('i')) : null;
      if (timer) timers.push({ el: timer });
      const det = h('details', { class: `pl${current ? ' current' : ''}${pl.bankrupt ? ' bankrupt' : ''}`, open: open.has(pl.id) },
        h('summary', {},
          h('img', { class: 'pl-avatar', src: assetSrc(`char-${pl.char}`), alt: '', style: { borderColor: pl.color } }),
          h('span', { class: 'pl-name' }, pl.name, h('span', { class: 'pl-tags' }, tags)),
          h('span', { class: 'pl-cash num' }, money(pl.cash)),
          h('span', { class: 'pl-sub' },
            h('span', { class: 'num' }, t('ui.worth', { amt: netWorth(game, p) })),
            h('span', { class: 'pl-groups' }, groups.map((g) => h('i', { style: { background: GROUPS[g].color }, title: t(`group.${g}`) })))),
          timer),
        detail(game, p));
      det.addEventListener('toggle', () => (det.open ? open.add(pl.id) : open.delete(pl.id)));
      return det;
    });
    fill(list, rows);
    tick(state);
    return list;
  }

  function tick(state) {
    const { game, offset } = state;
    if (!game || !timers.length) return;
    const left = remainingMs(game.deadline, offset);
    const total = RULES.phaseMs[game.phase] ?? 40000;
    for (const { el } of timers) {
      const frac = left === null ? 1 : Math.max(0, Math.min(1, left / total));
      el.firstChild.style.width = `${frac * 100}%`;
      el.classList.toggle('low', left !== null && left < 10000);
    }
  }

  return {
    render(state) {
      last = state;
      chips(state);
      players(state);
    },
    tick,
    relabel: () => last && (chips(last), players(last)),
  };
}
