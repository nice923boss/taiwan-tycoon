// Action dock under the board: shows what the viewer can do right now, with a
// countdown. Unavailable actions stay visible with the reason as tooltip.

import { SQUARES } from '../engine/board.js';
import { minNextBid } from '../engine/auction.js';
import { RULES } from '../engine/rules.js';
import { money, t, tm } from '../i18n/i18n.js';
import { $, button, confirmDialog, fill, h, remainingMs } from './dom.js';
import { tradeSummary } from './trade.js';

// ctx: { session, openManage(), openTrade(), showMarket(), showResults() }
export function createActions(ctx) {
  const dock = $('#dock');
  let last = null;
  let focusKey = '';
  let timerText = null;
  let timerBar = null;

  const act = (type, extra = {}) => ctx.session.send({ t: 'act', a: { type, ...extra } });

  function manageBtn() {
    return button(t('ui.manage'), { iconName: 'hammer', onClick: ctx.openManage });
  }
  function tradeBtn(game, me) {
    const others = game.players.some((pl, i) => i !== me && !pl.bankrupt);
    return button(t('ui.trade'), { iconName: 'arrow-left-right', onClick: ctx.openTrade, reason: others ? null : t('ui.noTradePartner') });
  }

  function auctionRow(game, me) {
    const a = game.auction;
    const min = minNextBid(a);
    const cash = game.players[me].cash;
    const blocked = (v) => (a.bidder === me ? t('err.alreadyTopBid') : v > cash ? t('err.notEnoughCash') : null);
    const quick = [min, min + 40, min + 90].filter((v, i, arr) => arr.indexOf(v) === i).map((v) =>
      button(money(v), { kind: 'btn-sm', onClick: () => act('BID', { amount: v }), reason: blocked(v) }));
    const input = h('input', { type: 'number', min, step: RULES.bidStep, value: min, 'aria-label': t('ui.customBid') });
    const custom = button(t('ui.bid'), {
      kind: 'btn-primary',
      iconName: 'gavel',
      onClick: () => act('BID', { amount: Math.floor(Number(input.value) || 0) }),
      reason: blocked(min),
    });
    return [h('div', { class: 'dock-row' }, quick, input, custom, button(t('ui.passBid'), { onClick: () => act('PASS_BID') }))];
  }

  // Returns { title, msg, rows } for the current state.
  function content(state) {
    const { game, you } = state;
    const me = game.players.findIndex((pl) => pl.id === you);
    const cur = game.players[game.current];
    const mine = me >= 0 && me === game.current && !game.players[me].bankrupt;
    const nameOf = (p) => game.players[p]?.name ?? '?';

    if (game.phase === 'gameOver') {
      return { title: t('ui.gameOver'), msg: t('ui.winnerIs', { name: nameOf(game.winner) }), rows: [h('div', { class: 'dock-row' }, button(t('ui.showResults'), { kind: 'btn-primary', iconName: 'trophy', onClick: ctx.showResults }))] };
    }
    if (game.phase === 'debt') {
      const d = game.debt;
      const why = tm(d.why, game);
      if (d.p !== me) return { title: t('ui.waitingDebt', { name: nameOf(d.p) }), msg: why, rows: [] };
      const short = game.players[me].cash < d.amount;
      return {
        title: t('ui.youOwe', { amt: d.amount }),
        msg: `${why} ${short ? t('ui.raiseCash') : ''}`,
        rows: [h('div', { class: 'dock-row' },
          button(t('ui.payDebt'), { kind: 'btn-primary', iconName: 'hand-coins', onClick: () => act('PAY_DEBT'), reason: short ? t('err.notEnoughCash') : null }),
          manageBtn(),
          button(t('ui.sellStocks'), { iconName: 'chart-candlestick', onClick: ctx.showMarket }),
          button(t('ui.declareBankruptcy'), {
            kind: 'btn-danger',
            onClick: async () => {
              if (await confirmDialog(t('ui.bankruptConfirm'), { okLabel: t('ui.declareBankruptcy'), danger: true })) act('DECLARE_BANKRUPTCY');
            },
          }))],
      };
    }
    if (game.phase === 'trade') {
      const tr = game.trade;
      const summary = tradeSummary(game, tr);
      if (tr.to === me) {
        return { title: t('ui.tradeOffer', { name: nameOf(tr.from) }), msg: '', rows: [summary, h('div', { class: 'dock-row' },
          button(t('ui.accept'), { kind: 'btn-primary', iconName: 'check', onClick: () => act('ACCEPT_TRADE') }),
          button(t('ui.reject'), { iconName: 'x', onClick: () => act('REJECT_TRADE') }))] };
      }
      if (tr.from === me) {
        return { title: t('ui.tradeWaiting', { name: nameOf(tr.to) }), msg: '', rows: [summary, h('div', { class: 'dock-row' },
          button(t('ui.cancelTrade'), { iconName: 'x', onClick: () => act('CANCEL_TRADE') }))] };
      }
      return { title: t('ui.tradeBetween', { a: nameOf(tr.from), b: nameOf(tr.to) }), msg: '', rows: [summary] };
    }
    if (game.phase === 'auction') {
      const a = game.auction;
      const status = a.bidder === null ? t('ui.noBidYet') : t('ui.topBid', { name: nameOf(a.bidder), amt: a.bid });
      const title = t('ui.auctionFor', { sq: a.sq });
      if (me >= 0 && a.active.includes(me)) return { title, msg: status, rows: auctionRow(game, me) };
      return { title, msg: status, rows: [] };
    }
    if (!mine) {
      const msg = me < 0 ? t('ui.spectating') : '';
      return { title: t('ui.waitingFor', { name: cur.name }), msg, rows: [] };
    }
    const pl = game.players[me];
    if (game.phase === 'preRoll') {
      const row = pl.inJail
        ? [button(t('ui.rollForDoubles'), { kind: 'btn-primary', iconName: 'dice-5', onClick: () => act('ROLL') }),
          button(t('ui.payBail', { amt: RULES.jailFine }), { iconName: 'coins', onClick: () => act('PAY_BAIL'), reason: pl.cash < RULES.jailFine ? t('err.notEnoughCash') : null }),
          button(t('ui.useJailCard'), { iconName: 'ticket', onClick: () => act('USE_JAIL_CARD'), reason: pl.jailCards.length ? null : t('err.noJailCard') })]
        : [button(t('ui.roll'), { kind: 'btn-primary', iconName: 'dice-5', onClick: () => act('ROLL') })];
      return { title: pl.inJail ? t('ui.yourTurnJail', { n: pl.jailTurns + 1 }) : t('ui.yourTurn'), msg: '', rows: [h('div', { class: 'dock-row' }, row, manageBtn(), tradeBtn(game, me))] };
    }
    if (game.phase === 'buy') {
      const sq = SQUARES[game.pendingBuy];
      return {
        title: t('ui.buyPrompt', { sq: sq.id, amt: sq.price }),
        msg: t('ui.declineMeansAuction'),
        rows: [h('div', { class: 'dock-row' },
          button(t('ui.buy'), { kind: 'btn-primary', iconName: 'circle-dollar-sign', onClick: () => act('BUY'), reason: pl.cash < sq.price ? t('err.notEnoughCash') : null }),
          button(t('ui.decline'), { iconName: 'gavel', onClick: () => act('DECLINE') }),
          manageBtn())],
      };
    }
    if (game.phase === 'postRoll') {
      return { title: t('ui.yourTurn'), msg: '', rows: [h('div', { class: 'dock-row' },
        button(t('ui.endTurn'), { kind: 'btn-primary', iconName: 'skip-forward', onClick: () => act('END_TURN') }), manageBtn(), tradeBtn(game, me))] };
    }
    return { title: t('ui.moving'), msg: '', rows: [] };
  }

  function render(state) {
    last = state;
    const { game } = state;
    if (!game) return fill(dock);
    const { title, msg, rows } = content(state);
    timerText = h('span', { class: 'timer-text' });
    timerBar = h('div', { class: 'timer' }, h('i'));
    fill(dock,
      h('div', { class: 'dock-head' }, h('span', { class: 'dock-title' }, title), timerText),
      timerBar,
      msg ? h('div', { class: 'dock-msg' }, msg) : null,
      rows);
    tick(state);
    // Q9: when a decision becomes ours, focus its main button (never steal focus from typing).
    const key = `${game.phase}|${game.current}|${game.round}|${game.auction?.bid ?? ''}|${game.debt?.p ?? ''}`;
    const primary = dock.querySelector('.btn-primary:not([aria-disabled="true"])');
    const typing = document.activeElement?.matches?.('input, textarea, select');
    if (key !== focusKey && primary && !typing && !document.querySelector('dialog[open]')) primary.focus({ preventScroll: true });
    focusKey = key;
    return dock;
  }

  function tick(state) {
    const { game, offset } = state;
    if (!game || !timerText) return;
    const left = remainingMs(game.deadline, offset);
    timerBar.hidden = left === null;
    timerText.textContent = left === null ? '' : `${Math.ceil(left / 1000)}s`;
    if (left !== null) {
      const total = RULES.phaseMs[game.phase] ?? 40000;
      timerBar.firstChild.style.width = `${Math.max(0, Math.min(1, left / total)) * 100}%`;
      timerBar.classList.toggle('low', left < 10000);
    }
  }

  return { render, tick, relabel: () => last && render(last) };
}
