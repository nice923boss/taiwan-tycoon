// Computer play. computerAction runs a seat whose player is away. Cautious on
// purpose: it keeps the seat alive without making choices the player might
// regret (no bids, no stock trades, no deals). cpuAction is a "normal" computer
// opponent that bids, builds and trades shares (see below).

import { GROUPS, SQUARES, groupMembers, mortgageValue, unmortgageCost } from './board.js';
import { minNextBid } from './auction.js';
import { actorOf } from './game.js';
import { RULES, buildError, mortgageError, ownsWholeGroup, sellBuildingError } from './rules.js';
import { STOCKS, buyCost, holdingsValue, sellProceeds } from './stocks.js';

export const BOT_RESERVE = 300; // cash kept after buying a square

// cpuAction thresholds (cash in game money).
export const CPU_BUY_RESERVE = 200; // cash kept after buying a square or winning an auction
export const CPU_BID_OPEN = 0.5; // first bid of an auction: this share of the list price
export const CPU_BID_RAISE = 0.1; // later bids: raise by this share of the list price (fewer, faster rounds)
export const CPU_GROUP_RESERVE = 50; // ... when the square completes one of its colour groups
export const CPU_BAIL_RESERVE = 500; // pay the jail fine only when this much is left afterwards
export const CPU_BUILD_RESERVE = 250; // cash kept after building a house or hotel
export const CPU_UNMORTGAGE_RESERVE = 500; // cash kept after lifting a mortgage
export const CPU_STOCK_BUY_FLOOR = 1000; // cash kept after buying shares
export const CPU_STOCK_BUDGET = 200; // money spent on one share purchase
export const CPU_STOCK_MAX_KINDS = 2; // different stocks held at once
export const CPU_STOCK_CHEAP = 1; // buy only at or below this multiple of the base price
export const CPU_STOCK_SELL_CASH = 150; // sell shares when cash falls below this
export const CPU_STOCK_TAKE_PROFIT = 1.25; // sell a holding worth this multiple of its cost

// The action seat `p` takes now, or null when it has nothing to do.
export function computerAction(g, p) {
  const pl = g.players[p];
  if (!pl || pl.bankrupt || !actorOf(g).includes(p)) return null;
  switch (g.phase) {
    case 'preRoll':
      return { type: pl.inJail && pl.jailCards.length > 0 ? 'USE_JAIL_CARD' : 'ROLL', p };
    case 'buy':
      return { type: pl.cash - SQUARES[g.pendingBuy].price >= BOT_RESERVE ? 'BUY' : 'DECLINE', p };
    case 'auction':
      return { type: 'PASS_BID', p };
    case 'postRoll':
      return { type: 'END_TURN', p };
    case 'trade':
      return { type: 'REJECT_TRADE', p };
    case 'debt':
      return { type: 'LIQUIDATE', p };
    default:
      return null;
  }
}

// ---------- normal computer opponent ----------
// One action per call; called again on the updated state, so building several
// houses and then ending the turn takes several calls. Every step makes
// progress (cash rises, or a house, lifted mortgage or new holding is added and
// never undone in the same phase), so each phase ends. Only actions a client
// may send are returned (no LIQUIDATE). The top bidder of an auction returns
// null: the rules forbid outbidding yourself, and it keeps its bid.

const ownedBy = (g, p) => SQUARES.filter((s) => g.props[s.id]?.owner === p);

const inFullGroup = (g, p, s) => Boolean(s.group) && ownsWholeGroup(g, p, s.group);

// True when seat `p` owns every other square of this square's colour group.
function completesGroup(g, p, id) {
  const { group } = SQUARES[id];
  return Boolean(group) && groupMembers(group).every((m) => m === id || g.props[m].owner === p);
}

const reserveFor = (g, p, id) => (completesGroup(g, p, id) ? CPU_GROUP_RESERVE : CPU_BUY_RESERVE);

function preRollAction(g, p) {
  const pl = g.players[p];
  if (pl.inJail && pl.jailCards.length > 0) return { type: 'USE_JAIL_CARD', p };
  if (pl.inJail && pl.cash - RULES.jailFine >= CPU_BAIL_RESERVE) return { type: 'PAY_BAIL', p };
  return { type: 'ROLL', p };
}

function buyAction(g, p) {
  const id = g.pendingBuy;
  return { type: g.players[p].cash - SQUARES[id].price >= reserveFor(g, p, id) ? 'BUY' : 'DECLINE', p };
}

const roundBid = (x) => Math.ceil(x / RULES.bidStep) * RULES.bidStep;

// Open at half the list price, then raise by a tenth of it, never above the list price.
function auctionAction(g, p) {
  const a = g.auction;
  if (a.bidder === p) return null;
  const price = SQUARES[a.sq].price;
  const target = a.bidder === null ? roundBid(price * CPU_BID_OPEN) : a.bid + roundBid(price * CPU_BID_RAISE);
  const amount = Math.max(minNextBid(a), Math.min(price, target));
  const ok = amount <= price && g.players[p].cash - amount >= reserveFor(g, p, a.sq);
  return ok ? { type: 'BID', p, amount } : { type: 'PASS_BID', p };
}

// Sell a whole holding: the largest one when cash is low, else one that made a clear profit.
// Holdings bought this phase never qualify (prices only move on rolls and round closes).
function stockSale(g, p) {
  const pl = g.players[p];
  const value = (sym) => sellProceeds(g.market.stocks[sym].price, pl.stocks[sym].n);
  const syms = Object.keys(pl.stocks);
  const sym = pl.cash < CPU_STOCK_SELL_CASH
    ? [...syms].sort((a, b) => value(b) - value(a))[0]
    : syms.find((s) => value(s) >= pl.stocks[s].cost * CPU_STOCK_TAKE_PROFIT);
  return sym ? { type: 'SELL_STOCK', p, sym, n: pl.stocks[sym].n } : null;
}

// Lift a mortgage, squares of fully owned groups first (they can then be built on).
function unmortgageStep(g, p) {
  const cash = g.players[p].cash;
  const sq = ownedBy(g, p)
    .filter((s) => g.props[s.id].mortgaged && cash - unmortgageCost(s.id) >= CPU_UNMORTGAGE_RESERVE)
    .sort((a, b) => inFullGroup(g, p, b) - inFullGroup(g, p, a) || a.price - b.price)[0];
  return sq ? { type: 'UNMORTGAGE', p, sq: sq.id } : null;
}

// Build on the least developed square, pricier groups first; buildError keeps it even.
function buildStep(g, p) {
  const cash = g.players[p].cash;
  const sq = ownedBy(g, p)
    .filter((s) => !buildError(g, p, s.id) && cash - GROUPS[s.group].houseCost >= CPU_BUILD_RESERVE)
    .sort((a, b) => g.props[a.id].houses - g.props[b.id].houses || b.price - a.price)[0];
  return sq ? { type: 'BUILD', p, sq: sq.id } : null;
}

// Buy a few shares of the stock furthest below its base price, when cash is plentiful.
function stockPurchase(g, p) {
  const pl = g.players[p];
  if (Object.keys(pl.stocks).length >= CPU_STOCK_MAX_KINDS) return null;
  const ratio = (s) => g.market.stocks[s.sym].price / s.base;
  const pick = STOCKS
    .filter((s) => !pl.stocks[s.sym] && ratio(s) <= CPU_STOCK_CHEAP)
    .sort((a, b) => ratio(a) - ratio(b))[0];
  if (!pick) return null;
  const price = g.market.stocks[pick.sym].price;
  const n = Math.floor(CPU_STOCK_BUDGET / price);
  return n > 0 && pl.cash - buyCost(price, n) >= CPU_STOCK_BUY_FLOOR ? { type: 'BUY_STOCK', p, sym: pick.sym, n } : null;
}

// Selling only raises cash and the other steps keep cash above the sell
// trigger, so the steps cannot cycle; END_TURN when nothing is left to do.
function postRollAction(g, p) {
  return stockSale(g, p) ?? unmortgageStep(g, p) ?? buildStep(g, p) ?? stockPurchase(g, p) ?? { type: 'END_TURN', p };
}

// Cash the seat could reach by selling every share and building and mortgaging every square.
function raisable(g, p) {
  const pl = g.players[p];
  const land = ownedBy(g, p).reduce((sum, s) => {
    const st = g.props[s.id];
    const buildings = s.group ? (st.houses * GROUPS[s.group].houseCost) / 2 : 0;
    return sum + buildings + (st.mortgaged ? 0 : mortgageValue(s.id));
  }, 0);
  return pl.cash + holdingsValue(g.market, pl.stocks) + land;
}

// Debt: give up at once when everything sold would not cover it. Otherwise raise
// cash one step at a time (the engine pays the debt as soon as cash covers it):
// shares first, then mortgages (squares outside full groups first), then buildings.
function debtAction(g, p) {
  const pl = g.players[p];
  const { amount } = g.debt;
  if (pl.cash >= amount) return { type: 'PAY_DEBT', p };
  if (raisable(g, p) < amount) return { type: 'DECLARE_BANKRUPTCY', p };
  const sym = Object.keys(pl.stocks)[0];
  if (sym) {
    const n = Math.min(pl.stocks[sym].n, Math.ceil((amount - pl.cash) / g.market.stocks[sym].price) + 1);
    return { type: 'SELL_STOCK', p, sym, n };
  }
  const mine = ownedBy(g, p);
  const lot = mine
    .filter((s) => !mortgageError(g, p, s.id))
    .sort((a, b) => inFullGroup(g, p, a) - inFullGroup(g, p, b) || a.price - b.price)[0];
  if (lot) return { type: 'MORTGAGE', p, sq: lot.id };
  const built = mine
    .filter((s) => !sellBuildingError(g, p, s.id))
    .sort((a, b) => g.props[b.id].houses - g.props[a.id].houses)[0];
  return { type: 'SELL_BUILDING', p, sq: built.id };
}

// The action seat `p` takes now as a normal computer opponent, or null when it
// has nothing to do (not its decision, bankrupt, or already the top bidder).
export function cpuAction(g, p) {
  const pl = g.players[p];
  if (!pl || pl.bankrupt || !actorOf(g).includes(p)) return null;
  switch (g.phase) {
    case 'preRoll':
      return preRollAction(g, p);
    case 'buy':
      return buyAction(g, p);
    case 'auction':
      return auctionAction(g, p);
    case 'postRoll':
      return postRollAction(g, p);
    case 'trade':
      return { type: 'REJECT_TRADE', p };
    case 'debt':
      return debtAction(g, p);
    default:
      return null;
  }
}
