// Asset management (build, sell buildings, mortgage), stock orders and
// player-to-player trades. Handlers return an error { key, params } or null.

import { GROUPS, OWNABLE_IDS, SQUARES, mortgageValue, unmortgageCost } from './board.js';
import {
  RULES, buildError, fail, mortgageError, sellBuildingError, tradableError, unmortgageError,
} from './rules.js';
import { STOCK_BY_SYM, buyCost } from './stocks.js';
import { emit, log, setPhase } from './state.js';
import { addShares, mortgageProp, sellBuilding, sellShares, tryPayDebt } from './turn.js';

const OWNABLE = new Set(OWNABLE_IDS);
const isSquare = (id) => Number.isInteger(id) && OWNABLE.has(id);
const isShareCount = (n) => Number.isInteger(n) && n > 0 && n <= RULES.maxShareOrder;

const ownTurn = (g, p) => p === g.current && (g.phase === 'preRoll' || g.phase === 'postRoll');

// Raising cash is allowed on your own turn (also while deciding to buy) and while in debt.
function canRaise(g, p) {
  if (g.phase === 'debt') return g.debt.p === p;
  return p === g.current && ['preRoll', 'postRoll', 'buy'].includes(g.phase);
}

const payDebtIfDebtor = (g, p, now) => {
  if (g.debt?.p === p) tryPayDebt(g, now);
};

// ---------- buildings & mortgages ----------

export function build(g, a) {
  if (!ownTurn(g, a.p)) return fail('notNow');
  if (!isSquare(a.sq)) return fail('badRequest');
  const err = buildError(g, a.p, a.sq);
  if (err) return err;
  g.players[a.p].cash -= GROUPS[SQUARES[a.sq].group].houseCost;
  g.props[a.sq].houses += 1;
  log(g, g.props[a.sq].houses === 5 ? 'log.buildHotel' : 'log.build', { p: a.p, sq: a.sq });
  emit(g, { kind: 'build', p: a.p, square: a.sq });
  return null;
}

export function sellBuildingAction(g, a, now) {
  if (!canRaise(g, a.p)) return fail('notNow');
  if (!isSquare(a.sq)) return fail('badRequest');
  const err = sellBuildingError(g, a.p, a.sq);
  if (err) return err;
  const refund = sellBuilding(g, a.p, a.sq);
  log(g, 'log.sellBuilding', { p: a.p, sq: a.sq, amt: refund });
  payDebtIfDebtor(g, a.p, now);
  return null;
}

export function mortgage(g, a, now) {
  if (!canRaise(g, a.p)) return fail('notNow');
  if (!isSquare(a.sq)) return fail('badRequest');
  const err = mortgageError(g, a.p, a.sq);
  if (err) return err;
  mortgageProp(g, a.p, a.sq);
  log(g, 'log.mortgage', { p: a.p, sq: a.sq, amt: mortgageValue(a.sq) });
  payDebtIfDebtor(g, a.p, now);
  return null;
}

export function unmortgage(g, a) {
  if (!ownTurn(g, a.p)) return fail('notNow');
  if (!isSquare(a.sq)) return fail('badRequest');
  const cost = unmortgageCost(a.sq);
  const err = unmortgageError(g, a.p, a.sq, cost);
  if (err) return err;
  g.players[a.p].cash -= cost;
  g.props[a.sq].mortgaged = false;
  log(g, 'log.unmortgage', { p: a.p, sq: a.sq, amt: cost });
  return null;
}

// ---------- stocks (any alive player, any time; a debtor may only sell) ----------

export function buyStock(g, a) {
  if (!STOCK_BY_SYM[a.sym] || !isShareCount(a.n)) return fail('badRequest');
  if (g.debt?.p === a.p) return fail('notNow');
  const pl = g.players[a.p];
  const cost = buyCost(g.market.stocks[a.sym].price, a.n);
  if (pl.cash < cost) return fail('notEnoughCash');
  pl.cash -= cost;
  addShares(pl, a.sym, a.n, cost);
  log(g, 'log.stockBuy', { p: a.p, sym: a.sym, n: a.n, amt: cost });
  return null;
}

export function sellStock(g, a, now) {
  if (!STOCK_BY_SYM[a.sym] || !isShareCount(a.n)) return fail('badRequest');
  const held = g.players[a.p].stocks[a.sym]?.n ?? 0;
  if (held < a.n) return fail('notEnoughShares');
  const proceeds = sellShares(g, a.p, a.sym, a.n);
  log(g, 'log.stockSell', { p: a.p, sym: a.sym, n: a.n, amt: proceeds });
  payDebtIfDebtor(g, a.p, now);
  return null;
}

// ---------- trades ----------
// Offer shape: { to, give: { cash, props, cards }, get: { cash, props, cards } }.
// `give` goes from the proposer to `to`; `get` comes back. `cards` counts
// get-out-of-jail cards. Mortgaged squares cost the receiver a 10% fee.

function normalizeSide(side) {
  if (!side || typeof side !== 'object') return null;
  const { cash = 0, props = [], cards = 0 } = side;
  if (!Number.isInteger(cash) || cash < 0 || !Number.isInteger(cards) || cards < 0) return null;
  if (!Array.isArray(props) || !props.every(isSquare) || new Set(props).size !== props.length) return null;
  return { cash, props: [...props], cards };
}

function sideError(g, p, side) {
  if (side.cash > g.players[p].cash) return fail('tradeCash', { p });
  if (side.cards > g.players[p].jailCards.length) return fail('tradeCards', { p });
  for (const id of side.props) {
    const err = tradableError(g, p, id);
    if (err) return err;
  }
  return null;
}

const mortgageFee = (g, props) => props
  .filter((id) => g.props[id].mortgaged)
  .reduce((sum, id) => sum + Math.ceil(mortgageValue(id) * RULES.mortgageTransferFee), 0);

function tradeError(g, t) {
  const errFrom = sideError(g, t.from, t.give);
  if (errFrom) return errFrom;
  const errTo = sideError(g, t.to, t.get);
  if (errTo) return errTo;
  const fromAfter = g.players[t.from].cash - t.give.cash + t.get.cash - mortgageFee(g, t.get.props);
  const toAfter = g.players[t.to].cash - t.get.cash + t.give.cash - mortgageFee(g, t.give.props);
  if (fromAfter < 0) return fail('tradeFee', { p: t.from });
  if (toAfter < 0) return fail('tradeFee', { p: t.to });
  return null;
}

export function proposeTrade(g, a, now) {
  if (!ownTurn(g, a.p)) return fail('notNow');
  const to = a.to;
  if (!Number.isInteger(to) || to === a.p || !g.players[to] || g.players[to].bankrupt) return fail('badRequest');
  const give = normalizeSide(a.give);
  const get = normalizeSide(a.get);
  if (!give || !get) return fail('badRequest');
  const empty = (s) => s.cash === 0 && s.cards === 0 && s.props.length === 0;
  if (empty(give) && empty(get)) return fail('tradeEmpty');
  const trade = { from: a.p, to, give, get, back: g.phase };
  const err = tradeError(g, trade);
  if (err) return err;
  g.trade = trade;
  log(g, 'log.tradePropose', { p: a.p, q: to });
  setPhase(g, 'trade', now);
  return null;
}

function moveSide(g, from, to, side) {
  g.players[from].cash -= side.cash;
  g.players[to].cash += side.cash;
  g.players[to].cash -= mortgageFee(g, side.props);
  for (const id of side.props) g.props[id].owner = to;
  const cards = g.players[from].jailCards;
  const moved = cards.slice(cards.length - side.cards);
  g.players[from].jailCards = cards.slice(0, cards.length - side.cards);
  g.players[to].jailCards = [...g.players[to].jailCards, ...moved];
}

export function closeTrade(g, now, logKey) {
  const t = g.trade;
  g.trade = null;
  log(g, logKey, { p: t.from, q: t.to });
  setPhase(g, t.back, now);
}

export function acceptTrade(g, a, now) {
  const t = g.trade;
  if (a.p !== t.to) return fail('notNow');
  const err = tradeError(g, t);
  if (err) return err;
  moveSide(g, t.from, t.to, t.give);
  moveSide(g, t.to, t.from, t.get);
  emit(g, { kind: 'trade', from: t.from, to: t.to });
  closeTrade(g, now, 'log.tradeAccept');
  return null;
}

export function rejectTrade(g, a, now) {
  if (a.p !== g.trade.to) return fail('notNow');
  closeTrade(g, now, 'log.tradeReject');
  return null;
}

export function cancelTrade(g, a, now) {
  if (a.p !== g.trade.from) return fail('notNow');
  closeTrade(g, now, 'log.tradeCancel');
  return null;
}
