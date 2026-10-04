// Authoritative game reducer. Only the host runs it:
//   applyAction(state, action, { now }) -> { game, error }
// `state` is never mutated; a structuredClone draft is changed and returned.
// `action.p` is the acting seat index, stamped by the host (never trusted from clients).
// Errors are { key, params } rendered through js/i18n.

import { OWNABLE_IDS, SQUARES } from './board.js';
import { DECKS } from './cards.js';
import { shuffled } from './rng.js';
import { PLAYER_COLORS, RULES, fail } from './rules.js';
import { createMarket } from './stocks.js';
import { emit, log, setPhase } from './state.js';
import { bid, dropFromAuction, passBid, resolveAuction, startAuction } from './auction.js';
import {
  acceptTrade, build, buyStock, cancelTrade, closeTrade, mortgage, proposeTrade, rejectTrade,
  sellBuildingAction, sellStock, unmortgage,
} from './deals.js';
import {
  BANK, JAIL_CARD_ID, autoRaise, bankrupt, nextTurn, roll, settle, tryPayDebt,
} from './turn.js';

export const STATE_VERSION = 1;

// players: [{ id, name, char }] in seat order; turn order is shuffled by the seed.
export function createGame({ players, seed, now, maxRounds = RULES.defaultRounds }) {
  if (!Array.isArray(players) || players.length < RULES.minPlayers || players.length > RULES.maxPlayers) {
    throw new Error(`createGame: need ${RULES.minPlayers}-${RULES.maxPlayers} players`);
  }
  if (!RULES.roundOptions.includes(maxRounds)) throw new Error(`createGame: bad maxRounds ${maxRounds}`);
  const g = {
    v: STATE_VERSION,
    seed,
    rng: seed >>> 0,
    phase: 'preRoll',
    round: 1,
    maxRounds,
    current: 0,
    dice: null,
    doublesCount: 0,
    extraRoll: false,
    pendingBuy: null,
    auction: null,
    trade: null,
    debt: null,
    props: Object.fromEntries(OWNABLE_IDS.map((id) => [id, { owner: null, houses: 0, mortgaged: false }])),
    market: createMarket(),
    log: [],
    logSeq: 0,
    events: [],
    eventSeq: 0,
    deadline: null,
    startedAt: now,
    turnStartedAt: now,
    endedAt: null,
    bankruptOrder: [],
    worthLog: [],
    ranking: null,
    winner: null,
  };
  g.players = shuffled(g, players).map((pl, i) => ({
    id: pl.id,
    name: pl.name,
    char: pl.char,
    color: PLAYER_COLORS[i],
    cash: RULES.startCash,
    pos: 0,
    inJail: false,
    jailTurns: 0,
    jailCards: [],
    stocks: {},
    bankrupt: false,
  }));
  g.decks = {
    chance: shuffled(g, DECKS.chance.map((c) => c.id)),
    fate: shuffled(g, DECKS.fate.map((c) => c.id)),
  };
  if (maxRounds) log(g, 'log.start', { rounds: maxRounds });
  else log(g, 'log.startNoLimit', {});
  setPhase(g, 'preRoll', now);
  emit(g, { kind: 'turn', p: 0 });
  return g;
}

// ---------- guards ----------

const isCurrent = (g, a, phase) => a.p === g.current && g.phase === phase;

function requirePhase(phase, fn) {
  return (g, a, now) => (isCurrent(g, a, phase) ? fn(g, a, now) : fail('notNow'));
}

// ---------- turn actions ----------

function payBail(g, a) {
  const pl = g.players[a.p];
  if (!pl.inJail) return fail('notInJail');
  if (pl.cash < RULES.jailFine) return fail('notEnoughCash');
  pl.cash -= RULES.jailFine;
  pl.inJail = false;
  pl.jailTurns = 0;
  log(g, 'log.bailPaid', { p: a.p, amt: RULES.jailFine });
  return null;
}

function useJailCard(g, a) {
  const pl = g.players[a.p];
  if (!pl.inJail) return fail('notInJail');
  if (pl.jailCards.length === 0) return fail('noJailCard');
  const deck = pl.jailCards[pl.jailCards.length - 1];
  pl.jailCards = pl.jailCards.slice(0, -1);
  g.decks[deck] = [...g.decks[deck], JAIL_CARD_ID[deck]];
  pl.inJail = false;
  pl.jailTurns = 0;
  log(g, 'log.jailCardUsed', { p: a.p });
  return null;
}

function buy(g, a) {
  const sq = SQUARES[g.pendingBuy];
  const pl = g.players[a.p];
  if (pl.cash < sq.price) return fail('notEnoughCash');
  pl.cash -= sq.price;
  g.props[sq.id].owner = a.p;
  g.pendingBuy = null;
  g.phase = 'moving';
  log(g, 'log.buy', { p: a.p, sq: sq.id, amt: sq.price });
  emit(g, { kind: 'buy', p: a.p, square: sq.id });
  return null;
}

function payDebt(g, a, now) {
  if (g.debt?.p !== a.p) return fail('notNow');
  return tryPayDebt(g, now) ? null : fail('notEnoughCash');
}

// Sell what is needed to pay the open debt, or go bankrupt when it is not enough.
// Used by the computer for an away player and by the debt timeout.
function liquidate(g, now) {
  const d = g.debt;
  if (autoRaise(g, d.p, d.amount)) {
    tryPayDebt(g, now);
  } else {
    g.debt = null;
    bankrupt(g, d.p, d.creditors, now);
    if (g.phase !== 'gameOver') g.phase = 'moving';
  }
}

function declareBankruptcy(g, a, now) {
  if (g.debt?.p !== a.p) return fail('notNow');
  const { creditors } = g.debt;
  g.debt = null;
  bankrupt(g, a.p, creditors, now);
  if (g.phase !== 'gameOver') g.phase = 'moving';
  return null;
}

// Leaving the game: everything returns to the bank (or to the creditors of an open debt).
function resign(g, a, now) {
  const p = a.p;
  if (g.trade && (g.trade.from === p || g.trade.to === p)) closeTrade(g, now, 'log.tradeCancel');
  let creditors = [{ p: BANK, amount: 0 }];
  if (g.debt?.p === p) {
    creditors = g.debt.creditors;
    g.debt = null;
  } else if (g.debt) {
    g.debt = { ...g.debt, creditors: g.debt.creditors.map((c) => (c.p === p ? { ...c, p: BANK } : c)) };
  }
  if (p === g.current) g.pendingBuy = null;
  log(g, 'log.resign', { p });
  bankrupt(g, p, creditors, now);
  if (g.phase === 'gameOver') return null;
  if (g.auction) dropFromAuction(g, p, now);
  if (p === g.current && g.phase !== 'auction') g.phase = 'moving';
  return null;
}

// The host fires TIMEOUT when the deadline passes (`force` skips that check).
// Each phase has a safe default.
function timeout(g, a, now) {
  if (!a.force && (g.deadline === null || now < g.deadline)) return fail('notYet');
  const actor = actorOf(g)[0];
  if (actor !== undefined && g.phase !== 'auction') log(g, 'log.timeout', { p: actor });
  switch (g.phase) {
    case 'preRoll':
      roll(g, g.current, now);
      return null;
    case 'buy':
      startAuction(g, g.pendingBuy, now);
      return null;
    case 'auction':
      resolveAuction(g, now);
      return null;
    case 'postRoll':
      nextTurn(g, now);
      return null;
    case 'debt':
      liquidate(g, now);
      return null;
    case 'trade':
      closeTrade(g, now, 'log.tradeExpired');
      return null;
    default:
      return fail('notYet');
  }
}

const inAuction = (fn) => (g, a, now) => (g.phase === 'auction' ? fn(g, a, now) : fail('notNow'));
const inTrade = (fn) => (g, a, now) => (g.phase === 'trade' ? fn(g, a, now) : fail('notNow'));

const HANDLERS = {
  ROLL: requirePhase('preRoll', (g, a, now) => {
    roll(g, a.p, now);
    return null;
  }),
  PAY_BAIL: requirePhase('preRoll', payBail),
  USE_JAIL_CARD: requirePhase('preRoll', useJailCard),
  BUY: requirePhase('buy', buy),
  DECLINE: requirePhase('buy', (g, a, now) => {
    startAuction(g, g.pendingBuy, now);
    return null;
  }),
  BID: inAuction((g, a, now) => bid(g, a.p, a.amount, now)),
  PASS_BID: inAuction((g, a, now) => passBid(g, a.p, now)),
  END_TURN: requirePhase('postRoll', (g, a, now) => {
    nextTurn(g, now);
    return null;
  }),
  BUILD: build,
  SELL_BUILDING: sellBuildingAction,
  MORTGAGE: mortgage,
  UNMORTGAGE: unmortgage,
  BUY_STOCK: buyStock,
  SELL_STOCK: sellStock,
  PAY_DEBT: payDebt,
  DECLARE_BANKRUPTCY: declareBankruptcy,
  LIQUIDATE: (g, a, now) => {
    if (g.debt?.p !== a.p) return fail('notNow');
    liquidate(g, now);
    return null;
  },
  PROPOSE_TRADE: proposeTrade,
  ACCEPT_TRADE: inTrade(acceptTrade),
  REJECT_TRADE: inTrade(rejectTrade),
  CANCEL_TRADE: inTrade(cancelTrade),
  RESIGN: resign,
};

export const ACTION_TYPES = [...Object.keys(HANDLERS), 'TIMEOUT'];
// Sent by the host itself, never accepted from a client.
export const HOST_ONLY = ['TIMEOUT', 'LIQUIDATE'];

export function applyAction(game, action, { now }) {
  if (!action || typeof action !== 'object') return { game, error: fail('badRequest') };
  if (game.phase === 'gameOver') return { game, error: fail('gameOver') };
  const isTimeout = action.type === 'TIMEOUT';
  const handler = isTimeout ? timeout : HANDLERS[action.type];
  if (!handler) return { game, error: fail('badRequest') };
  if (!isTimeout) {
    const pl = Number.isInteger(action.p) ? game.players[action.p] : undefined;
    if (!pl) return { game, error: fail('notAPlayer') };
    if (pl.bankrupt) return { game, error: fail('bankrupt') };
  }
  const g = structuredClone(game);
  const error = handler(g, action, now);
  if (error) return { game, error };
  settle(g, now);
  return { game: g, error: null };
}

// Seats that must act now (used by the host for timeouts and disconnects).
export function actorOf(g) {
  switch (g.phase) {
    case 'preRoll':
    case 'buy':
    case 'postRoll':
      return [g.current];
    case 'debt':
      return [g.debt.p];
    case 'trade':
      return [g.trade.to];
    case 'auction':
      return [...g.auction.active];
    default:
      return [];
  }
}

// Public view broadcast to every peer: hides the RNG state and the deck order.
export function sanitize(g) {
  const { rng: _rng, seed: _seed, decks: _decks, ...pub } = g;
  return pub;
}

// Rebuild private fields from a public snapshot (host migration). A new seed
// means future dice and card order differ from what the old host would have used.
export function rehydrate(pub, seed) {
  const g = structuredClone(pub);
  g.seed = seed;
  g.rng = seed >>> 0;
  const held = (deck) => g.players.some((pl) => pl.jailCards.includes(deck));
  g.decks = Object.fromEntries(Object.entries(DECKS).map(([deck, cards]) => [
    deck,
    shuffled(g, cards.map((c) => c.id).filter((id) => !(id === JAIL_CARD_ID[deck] && held(deck)))),
  ]));
  return g;
}
