// Trade offers: a compose dialog for the proposer and a summary block that the
// dock shows to everyone while an offer is open.

import { SQUARES, mortgageValue } from '../engine/board.js';
import { RULES, tradableError } from '../engine/rules.js';
import { money, t, tm } from '../i18n/i18n.js';
import { button, h, openDialog, toast } from './dom.js';
import { squareColor } from './manage.js';

function sideItems(game, side) {
  const items = [];
  if (side.cash) items.push(h('li', {}, money(side.cash)));
  for (const id of side.props) {
    items.push(h('li', {}, t(`sq.${id}`), game.props[id].mortgaged ? ` (${t('ui.mortgagedTag')})` : ''));
  }
  if (side.cards) items.push(h('li', {}, t('ui.jailCardsN', { n: side.cards })));
  return items.length ? h('ul', {}, items) : h('p', { class: 'muted' }, t('ui.nothing'));
}

export function tradeSummary(game, tr) {
  const from = game.players[tr.from].name;
  const to = game.players[tr.to].name;
  return h('div', { class: 'trade-summary' },
    h('strong', {}, t('ui.tradeGives', { name: from })), sideItems(game, tr.give),
    h('strong', {}, t('ui.tradeGives', { name: to })), sideItems(game, tr.get));
}

// Fee the receiver pays for mortgaged squares (same formula as js/engine/deals.js).
const feeFor = (game, props) => props
  .filter((id) => game.props[id].mortgaged)
  .reduce((sum, id) => sum + Math.ceil(mortgageValue(id) * RULES.mortgageTransferFee), 0);

export function createTrade({ session }) {
  let dlg = null;

  function column(game, p, title) {
    const pl = game.players[p];
    const cash = h('input', { type: 'number', min: 0, max: pl.cash, step: 10, value: 0, 'aria-label': t('ui.cashAmount') });
    const checks = SQUARES.filter((sq) => game.props[sq.id]?.owner === p).map((sq) => {
      const err = tradableError(game, p, sq.id);
      const box = h('input', { type: 'checkbox', value: sq.id, disabled: Boolean(err) });
      return h('label', { 'data-tip': err ? tm(err, game) : null },
        box, h('span', { class: 'swatch', style: { background: squareColor(sq.id), width: '8px', height: '18px', borderRadius: '3px' } }),
        t(`sq.${sq.id}`), game.props[sq.id].mortgaged ? ` (${t('ui.mortgagedTag')})` : '');
    });
    const cards = h('input', { type: 'number', min: 0, max: pl.jailCards.length, step: 1, value: 0, 'aria-label': t('ui.jailCards') });
    const col = h('div', { class: 'trade-col' },
      h('h3', {}, title),
      h('label', { class: 'form-row' }, h('span', {}, t('ui.cashUpTo', { amt: pl.cash })), cash),
      checks.length ? h('div', { class: 'check-list' }, checks) : h('p', { class: 'muted' }, t('ui.noProperties')),
      pl.jailCards.length ? h('label', { class: 'form-row' }, h('span', {}, t('ui.jailCards')), cards) : null);
    const read = () => ({
      cash: Math.max(0, Math.floor(Number(cash.value) || 0)),
      props: [...col.querySelectorAll('input[type=checkbox]:checked')].map((c) => Number(c.value)),
      cards: pl.jailCards.length ? Math.max(0, Math.floor(Number(cards.value) || 0)) : 0,
    });
    return { col, read };
  }

  function compose(game, me, to) {
    const pick = h('select', { 'aria-label': t('ui.tradeWith') },
      game.players.map((pl, i) => (i === me || pl.bankrupt ? null : h('option', { value: i, selected: i === to }, pl.name))));
    pick.addEventListener('change', () => dlg.setBody(compose(game, me, Number(pick.value))));
    const mine = column(game, me, t('ui.youGive'));
    const theirs = column(game, to, t('ui.youGet', { name: game.players[to].name }));
    const note = h('p', { class: 'muted small' }, t('ui.tradeFeeNote', { pct: RULES.mortgageTransferFee * 100 }));
    dlg.setActions(
      button(t('ui.cancel'), { onClick: () => dlg.close() }),
      button(t('ui.sendOffer'), {
        kind: 'btn-primary',
        iconName: 'send',
        onClick: () => {
          const give = mine.read();
          const get = theirs.read();
          const fee = feeFor(game, get.props);
          if (fee) toast(t('ui.tradeFeeYou', { amt: fee }), 'info');
          if (session.send({ t: 'act', a: { type: 'PROPOSE_TRADE', to, give, get } })) dlg.close();
        },
      }));
    return [h('label', { class: 'form-row' }, h('span', {}, t('ui.tradeWith')), pick), h('div', { class: 'trade-cols' }, mine.col, theirs.col), note];
  }

  return {
    open(state) {
      const { game, you } = state;
      const me = game?.players.findIndex((pl) => pl.id === you) ?? -1;
      const first = game?.players.findIndex((pl, i) => i !== me && !pl.bankrupt) ?? -1;
      if (me < 0 || first < 0) return;
      dlg?.close();
      const d = openDialog({ title: t('ui.tradeTitle'), body: [], wide: true, onClose: () => { if (dlg === d) dlg = null; } });
      dlg = d;
      d.setBody(compose(game, me, first));
    },
    // The offer was built from a snapshot; close it when the turn moves on.
    render(state) {
      const g = state.game;
      if (dlg && (!g || g.phase === 'gameOver' || g.players[g.current]?.id !== state.you)) dlg.close();
    },
  };
}
