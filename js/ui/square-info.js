// Square details shown when a board square is clicked: owner, price, the rent
// table (at this round's rent level) with the level that applies now
// highlighted, and building costs.

import { GROUPS, SQUARES, STATION_RENT, UTILITY_MULT, mortgageValue } from '../engine/board.js';
import { RULES, ownsWholeGroup, rentPercent } from '../engine/rules.js';
import { money, t } from '../i18n/i18n.js';
import { fill, h } from './dom.js';
import { squareColor } from './manage.js';

const countOwned = (g, owner, type) => SQUARES.filter((s) => s.type === type && g.props[s.id].owner === owner).length;

export function createSquareInfo() {
  const pop = h('div', { class: 'sq-pop', role: 'dialog', hidden: true });
  document.body.append(pop);
  let floating = null;
  let at = null; // { i, x, y } of the open pop-up
  let game = null;

  const row = (label, value, on = false) => h('tr', { class: on ? 'on' : null }, h('td', {}, label), h('td', {}, value));

  function table(sq, st) {
    const owner = st?.owner ?? null;
    const live = owner !== null && !st.mortgaged;
    const pct = rentPercent(game.round);
    const rent = (n) => money(Math.round((n * pct) / 100));
    const rise = pct > 100 ? [row(t('ui.rentRate'), `×${pct / 100}`, true)] : [];
    if (sq.type === 'property') {
      const full = live && ownsWholeGroup(game, owner, sq.group);
      return [
        ...rise,
        row(t('ui.rentBase'), rent(sq.rent[0]), live && !st.houses && !full),
        row(t('ui.rentGroup'), rent(sq.rent[0] * 2), live && !st.houses && full),
        ...[1, 2, 3, 4].map((k) => row(t('ui.housesN', { n: k }), rent(sq.rent[k]), live && st.houses === k)),
        row(t('ui.hotel'), rent(sq.rent[5]), live && st.houses === 5),
        row(t('ui.houseCost'), money(GROUPS[sq.group].houseCost)),
        row(t('ui.mortgageValue'), money(mortgageValue(sq.id))),
      ];
    }
    if (sq.type === 'station') {
      const n = live ? countOwned(game, owner, 'station') : 0;
      return [...rise, ...STATION_RENT.map((r, k) => row(t('ui.stationsOwned', { n: k + 1 }), rent(r), n === k + 1)),
        row(t('ui.mortgageValue'), money(mortgageValue(sq.id)))];
    }
    if (sq.type === 'utility') {
      const n = live ? countOwned(game, owner, 'utility') : 0;
      return [...rise, ...UTILITY_MULT.map((m, k) => row(t('ui.utilitiesOwned', { n: k + 1 }), t('ui.diceTimes', { n: m }), n === k + 1)),
        row(t('ui.mortgageValue'), money(mortgageValue(sq.id)))];
    }
    return [];
  }

  function note(sq) {
    switch (sq.type) {
      case 'go': return t('ui.infoGo', { amt: RULES.goSalary });
      case 'tax': return t('ui.infoTax', { amt: sq.amount });
      case 'chance':
      case 'fate': return t('ui.infoDeck', { deck: sq.type });
      case 'jail': return t('ui.infoJail', { amt: RULES.jailFine });
      case 'gotojail': return t('ui.infoGoToJail');
      case 'parking': return t('ui.infoParking');
      default: return '';
    }
  }

  function body(i) {
    const sq = SQUARES[i];
    const st = game?.props[i];
    const lines = [];
    if (sq.group) lines.push(h('p', { class: 'muted small' }, t(`group.${sq.group}`)));
    if (sq.price) {
      const owner = st?.owner ?? null;
      lines.push(h('p', {}, owner === null
        ? t('ui.forSale', { amt: sq.price })
        : t('ui.ownedBy', { name: game.players[owner].name }),
      st?.mortgaged ? ` (${t('ui.mortgagedTag')})` : ''));
    }
    const text = note(sq);
    if (text) lines.push(h('p', {}, text));
    const rows = table(sq, st);
    return [
      h('div', { class: 'sq-pop-band', style: { background: squareColor(i) } }),
      h('div', { class: 'sq-pop-body' }, h('h3', {}, t(`sq.${i}`)), lines, rows.length ? h('table', {}, h('tbody', {}, rows)) : null),
    ];
  }

  async function place(x, y) {
    try {
      floating ??= await import('@floating-ui/dom');
    } catch {
      floating = false;
    }
    if (!at) return;
    if (!floating) {
      // Library unavailable: keep the pop-up inside the viewport by hand.
      Object.assign(pop.style, {
        left: `${Math.min(x + 12, innerWidth - pop.offsetWidth - 8)}px`,
        top: `${Math.min(y + 12, innerHeight - pop.offsetHeight - 8)}px`,
      });
      return;
    }
    const { computePosition, offset, flip, shift } = floating;
    const anchor = { getBoundingClientRect: () => ({ x, y, left: x, top: y, right: x, bottom: y, width: 0, height: 0 }) };
    const pos = await computePosition(anchor, pop, { placement: 'right-start', middleware: [offset(12), flip(), shift({ padding: 8 })] });
    Object.assign(pop.style, { left: `${pos.x}px`, top: `${pos.y}px` });
  }

  function close() {
    at = null;
    pop.hidden = true;
  }

  document.addEventListener('pointerdown', (e) => { if (at && !pop.contains(e.target)) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && at) close(); });

  return {
    // Board views call this with the square index and the click point.
    show(i, { x, y }) {
      at = { i, x, y };
      pop.setAttribute('aria-label', t(`sq.${i}`));
      fill(pop, body(i));
      pop.hidden = false;
      place(x, y);
    },
    render(state) {
      game = state.game;
      if (at) fill(pop, body(at.i));
    },
    close,
    relabel() {
      if (at) {
        pop.setAttribute('aria-label', t(`sq.${at.i}`));
        fill(pop, body(at.i));
      }
    },
  };
}
