// Property management dialog: build, sell buildings, mortgage, unmortgage.
// Button availability comes from the engine's own validators, so the reason
// shown on an unavailable button is the same error the host would return.

import { GROUPS, SQUARES, mortgageValue, unmortgageCost } from '../engine/board.js';
import { buildError, mortgageError, sellBuildingError, unmortgageError } from '../engine/rules.js';
import { t, tm } from '../i18n/i18n.js';
import { button, h, openDialog } from './dom.js';

// Same phase gates as js/engine/deals.js.
const ownTurn = (g, p) => p === g.current && (g.phase === 'preRoll' || g.phase === 'postRoll');
const canRaise = (g, p) => (g.phase === 'debt' ? g.debt.p === p : p === g.current && ['preRoll', 'postRoll', 'buy'].includes(g.phase));

export const squareColor = (id) => (SQUARES[id].group ? GROUPS[SQUARES[id].group].color : '#9aa5a0');

// Re-rendering a dialog body replaces its buttons; put focus back on the same slot.
export function keepFocus(root, rerender) {
  const btns = () => [...root.querySelectorAll('.dialog-body button, .dialog-body input')];
  const idx = btns().indexOf(document.activeElement);
  rerender();
  if (idx >= 0) btns()[Math.min(idx, btns().length - 1)]?.focus({ preventScroll: true });
}

export function createManage({ session }) {
  let dlg = null;
  let last = null;
  const act = (type, sq) => session.send({ t: 'act', a: { type, sq } });

  function row(g, me, id) {
    const sq = SQUARES[id];
    const st = g.props[id];
    const reason = (allowed, err) => (!allowed ? t('err.notNow') : err ? tm(err, g) : null);
    const level = st.mortgaged ? t('ui.mortgagedTag') : st.houses === 5 ? t('ui.hotel') : st.houses ? t('ui.housesN', { n: st.houses }) : '';
    const actions = [];
    if (sq.type === 'property') {
      const cost = GROUPS[sq.group].houseCost;
      actions.push(button(t('ui.buildFor', { amt: cost }), {
        kind: 'btn-sm', iconName: 'hammer', onClick: () => act('BUILD', id), reason: reason(ownTurn(g, me), buildError(g, me, id)),
      }));
      if (st.houses > 0) {
        actions.push(button(t('ui.sellBuildingFor', { amt: cost / 2 }), {
          kind: 'btn-sm', onClick: () => act('SELL_BUILDING', id), reason: reason(canRaise(g, me), sellBuildingError(g, me, id)),
        }));
      }
    }
    if (st.mortgaged) {
      const cost = unmortgageCost(id);
      actions.push(button(t('ui.unmortgageFor', { amt: cost }), {
        kind: 'btn-sm', onClick: () => act('UNMORTGAGE', id), reason: reason(ownTurn(g, me), unmortgageError(g, me, id, cost)),
      }));
    } else {
      actions.push(button(t('ui.mortgageFor', { amt: mortgageValue(id) }), {
        kind: 'btn-sm', iconName: 'landmark', onClick: () => act('MORTGAGE', id), reason: reason(canRaise(g, me), mortgageError(g, me, id)),
      }));
    }
    return h('div', { class: 'prop-row' },
      h('span', { class: 'swatch', style: { background: squareColor(id) } }),
      h('span', {}, h('span', { class: 'prop-name' }, t(`sq.${id}`)), h('br'), h('span', { class: 'prop-meta' }, level || t('ui.priceTag', { amt: sq.price }))),
      h('span', { class: 'prop-actions' }, actions));
  }

  function body(state) {
    const { game: g, you } = state;
    const me = g.players.findIndex((pl) => pl.id === you);
    if (me < 0) return h('p', {}, t('err.notAPlayer'));
    const mine = SQUARES.filter((sq) => g.props[sq.id]?.owner === me).map((sq) => sq.id);
    return [
      h('p', { class: 'muted' }, t('ui.cashNow', { amt: g.players[me].cash })),
      mine.length ? h('div', { class: 'prop-list' }, mine.map((id) => row(g, me, id))) : h('p', {}, t('ui.noProperties')),
    ];
  }

  return {
    open() {
      if (!last?.game) return;
      dlg?.close();
      const d = openDialog({ title: t('ui.manageTitle'), body: body(last), wide: true, onClose: () => { if (dlg === d) dlg = null; } });
      dlg = d;
    },
    render(state) {
      last = state;
      if (!dlg) return;
      if (!state.game || state.game.phase === 'gameOver') dlg.close();
      else {
        dlg.setTitle(t('ui.manageTitle'));
        keepFocus(dlg.el, () => dlg.setBody(body(state)));
      }
    },
  };
}
