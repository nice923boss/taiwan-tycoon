// Random-bot fuzzing: plays many complete games and checks state invariants
// after every successful action. A game that does not finish within the step
// cap is reported as a deadlock.

import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTION_TYPES, actorOf, applyAction, createGame, sanitize } from '../js/engine/game.js';
import { GROUPS, OWNABLE_IDS, SQUARES, groupMembers, unmortgageCost } from '../js/engine/board.js';
import { RULES, ownsWholeGroup, groupHasBuildings } from '../js/engine/rules.js';
import { STOCKS } from '../js/engine/stocks.js';
import { minNextBid } from '../js/engine/auction.js';
import { JAIL_CARD_ID } from '../js/engine/turn.js';
import zhTW from '../js/i18n/zh-TW.js';
import en from '../js/i18n/en.js';
import { makePlayers } from './helpers.js';

const GAMES = 500;
const STEP_CAP = 20000;
const PHASES = new Set(['preRoll', 'buy', 'auction', 'postRoll', 'debt', 'trade', 'gameOver']);
const SYMS = STOCKS.map((s) => s.sym);
const placeholders = (tpl) => [...tpl.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);

// Bot randomness is independent of the engine RNG (mulberry32 on a local counter).
function botRng(seed) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (n) => Math.floor(next() * n);
  const pick = (arr) => arr[int(arr.length)];
  const chance = (p) => next() < p;
  return { next, int, pick, chance };
}

const alive = (g) => g.players.map((_, i) => i).filter((i) => !g.players[i].bankrupt);
const ownedBy = (g, p) => OWNABLE_IDS.filter((id) => g.props[id].owner === p);

function checkLogEntry(entry, where) {
  for (const [code, dict] of [['zh-TW', zhTW], ['en', en]]) {
    assert.ok(entry.key in dict, `${where}: log key ${entry.key} missing in ${code}`);
    for (const name of placeholders(dict[entry.key])) {
      assert.ok(name in entry.params, `${where}: ${entry.key} needs {${name}} (${code}) but params are ${JSON.stringify(entry.params)}`);
    }
  }
}

function checkInvariants(g, ctx) {
  const where = `${ctx.label} step ${ctx.step}`;
  assert.ok(PHASES.has(g.phase), `${where}: invalid phase ${g.phase}`);
  const n = g.players.length;
  g.players.forEach((pl, i) => {
    assert.ok(Number.isInteger(pl.cash), `${where}: non-integer cash ${pl.cash} for ${i}`);
    if (!pl.bankrupt && !(g.phase === 'debt' && g.debt.p === i)) {
      assert.ok(pl.cash >= 0, `${where}: player ${i} cash ${pl.cash}`);
    }
    if (pl.bankrupt) {
      assert.equal(ownedBy(g, i).length, 0, `${where}: bankrupt ${i} still owns props`);
      assert.deepEqual(pl.stocks, {}, `${where}: bankrupt ${i} still owns stocks`);
    }
    for (const [sym, h] of Object.entries(pl.stocks)) {
      assert.ok(SYMS.includes(sym) && Number.isInteger(h.n) && h.n > 0, `${where}: bad holding ${sym} ${JSON.stringify(h)}`);
    }
  });
  for (const id of OWNABLE_IDS) {
    const st = g.props[id];
    assert.ok(Number.isInteger(st.houses) && st.houses >= 0 && st.houses <= 5, `${where}: sq ${id} houses ${st.houses}`);
    if (st.mortgaged) assert.equal(st.houses, 0, `${where}: mortgaged sq ${id} has houses`);
    if (st.houses > 0) assert.equal(SQUARES[id].type, 'property', `${where}: building on non-property ${id}`);
    if (st.owner !== null) {
      assert.ok(Number.isInteger(st.owner) && st.owner >= 0 && st.owner < n, `${where}: sq ${id} bad owner ${st.owner}`);
      assert.ok(!g.players[st.owner].bankrupt, `${where}: sq ${id} owned by bankrupt ${st.owner}`);
    } else {
      assert.equal(st.houses, 0, `${where}: unowned sq ${id} has houses`);
      assert.equal(st.mortgaged, false, `${where}: unowned sq ${id} is mortgaged`);
    }
  }
  const actors = actorOf(g);
  if (g.phase === 'gameOver') {
    assert.ok(g.ranking && g.ranking.length === n, `${where}: ranking missing`);
    assert.equal(g.winner, g.ranking[0].p);
  } else {
    assert.ok(actors.length > 0, `${where}: nobody can act in ${g.phase}`);
    for (const a of actors) assert.ok(!g.players[a].bankrupt, `${where}: bankrupt actor ${a} in ${g.phase}`);
    assert.ok(!g.players[g.current].bankrupt || g.phase === 'auction', `${where}: bankrupt current player in ${g.phase}`);
  }
  if (g.phase === 'auction') assert.ok(g.auction, `${where}: auction phase without auction`);
  if (g.phase === 'trade') assert.ok(g.trade, `${where}: trade phase without trade`);
  if (g.phase === 'debt') assert.ok(g.debt, `${where}: debt phase without debt`);
  if (g.phase === 'buy') assert.notEqual(g.pendingBuy, null, `${where}: buy phase without pendingBuy`);
  // Get-out-of-jail cards are conserved: exactly one per deck, in the deck or in a hand.
  for (const [deck, id] of Object.entries(JAIL_CARD_ID)) {
    const inDeck = g.decks[deck].filter((c) => c === id).length;
    const held = g.players.reduce((s, pl) => s + pl.jailCards.filter((d) => d === deck).length, 0);
    assert.equal(inDeck + held, 1, `${where}: ${deck} jail cards = ${inDeck} + ${held}`);
  }
  // JSON.stringify serializes exactly the own enumerable keys, so checking the keys of
  // sanitize(g) every step is equivalent; the full JSON round trip runs periodically.
  const pub = sanitize(g);
  for (const k of ['rng', 'seed', 'decks']) assert.ok(!Object.keys(pub).includes(k), `${where}: sanitize leaked ${k}`);
  if (ctx.step % 50 === 0 || g.phase === 'gameOver') {
    const json = JSON.parse(JSON.stringify(pub));
    for (const k of ['rng', 'seed', 'decks']) assert.ok(!(k in json), `${where}: JSON leaked ${k}`);
    assert.deepEqual(json, pub, `${where}: public state is not JSON-safe`);
  }
  for (const entry of g.log) {
    if (entry.n > ctx.lastLogN) checkLogEntry(entry, where);
  }
  ctx.lastLogN = g.logSeq;
}

// ---------- bot ----------

function randomSide(g, p, R, ownerProps) {
  const pl = g.players[p];
  const props = ownerProps.filter(() => R.chance(0.3)).slice(0, 3);
  return {
    cash: R.chance(0.4) ? R.int(Math.max(1, Math.floor(pl.cash / 3))) : 0,
    props,
    cards: pl.jailCards.length > 0 && R.chance(0.3) ? 1 : 0,
  };
}

function tradeAction(g, p, R) {
  const others = alive(g).filter((i) => i !== p);
  if (others.length === 0) return null;
  const to = R.pick(others);
  return {
    type: 'PROPOSE_TRADE',
    p,
    to,
    give: randomSide(g, p, R, ownedBy(g, p)),
    get: randomSide(g, to, R, ownedBy(g, to)),
  };
}

// Asset actions any player may try (many are expected to be rejected).
function assetAction(g, p, R) {
  const pl = g.players[p];
  const mine = ownedBy(g, p);
  const r = R.int(9);
  if (r === 0) return { type: 'BUY_STOCK', p, sym: R.pick(SYMS), n: 1 + R.int(R.chance(0.2) ? 200 : 20) };
  if (r === 1) {
    const held = Object.keys(pl.stocks);
    if (held.length === 0) return { type: 'SELL_STOCK', p, sym: R.pick(SYMS), n: 1 };
    const sym = R.pick(held);
    return { type: 'SELL_STOCK', p, sym, n: 1 + R.int(pl.stocks[sym].n + 2) };
  }
  if (r === 2) return { type: 'MORTGAGE', p, sq: mine.length && R.chance(0.9) ? R.pick(mine) : R.pick(OWNABLE_IDS) };
  if (r === 3) {
    const mort = mine.filter((id) => g.props[id].mortgaged);
    return { type: 'UNMORTGAGE', p, sq: mort.length ? R.pick(mort) : R.pick(OWNABLE_IDS) };
  }
  if (r === 4 || r === 5) {
    const buildable = mine.filter((id) => SQUARES[id].type === 'property' && ownsWholeGroup(g, p, SQUARES[id].group));
    return { type: 'BUILD', p, sq: buildable.length ? R.pick(buildable) : R.pick(OWNABLE_IDS) };
  }
  if (r === 6) {
    const built = mine.filter((id) => g.props[id].houses > 0);
    return { type: 'SELL_BUILDING', p, sq: built.length ? R.pick(built) : R.pick(OWNABLE_IDS) };
  }
  if (r === 7) return tradeAction(g, p, R);
  // Junk / malformed requests.
  return R.pick([
    { type: 'ROLL', p },
    { type: 'END_TURN', p },
    { type: 'BID', p, amount: 5 },
    { type: 'BUY', p },
    { type: 'PAY_DEBT', p },
    { type: 'ACCEPT_TRADE', p },
    { type: 'CANCEL_TRADE', p },
    { type: 'BUILD', p, sq: 0 },
    { type: 'BUY_STOCK', p, sym: 'NOPE', n: 1 },
    { type: 'BUY_STOCK', p, sym: 'CHIP', n: 0.5 },
    { type: 'MORTGAGE', p, sq: '5' },
    { type: 'PROPOSE_TRADE', p, to: p, give: { cash: 1 }, get: {} },
    { type: 'PROPOSE_TRADE', p, to: (p + 1) % g.players.length, give: { cash: -5 }, get: {} },
    { type: 'NOPE', p },
    { type: 'ROLL', p: 99 },
    { type: 'ROLL' },
    null,
  ]);
}

// Debtor: raise cash in a sensible order, then pay or give up.
function debtAction(g, p, R) {
  const pl = g.players[p];
  if (pl.cash >= g.debt.amount && R.chance(0.9)) return { type: 'PAY_DEBT', p };
  if (R.chance(0.04)) return { type: 'DECLARE_BANKRUPTCY', p };
  const held = Object.keys(pl.stocks);
  if (held.length) {
    const sym = R.pick(held);
    return { type: 'SELL_STOCK', p, sym, n: pl.stocks[sym].n };
  }
  const mine = ownedBy(g, p);
  const built = mine.filter((id) => g.props[id].houses > 0);
  if (built.length) {
    const top = Math.max(...built.map((id) => g.props[id].houses));
    return { type: 'SELL_BUILDING', p, sq: R.pick(built.filter((id) => g.props[id].houses === top)) };
  }
  const mortgageable = mine.filter((id) => !g.props[id].mortgaged && !(SQUARES[id].group && groupHasBuildings(g, SQUARES[id].group)));
  if (mortgageable.length) return { type: 'MORTGAGE', p, sq: R.pick(mortgageable) };
  return R.chance(0.5) ? { type: 'DECLARE_BANKRUPTCY', p } : { type: 'PAY_DEBT', p };
}

function turnAction(g, R) {
  const actors = actorOf(g);
  const p = R.pick(actors);
  const pl = g.players[p];
  switch (g.phase) {
    case 'preRoll':
      if (pl.inJail) {
        if (pl.jailCards.length && R.chance(0.5)) return { type: 'USE_JAIL_CARD', p };
        if (R.chance(0.3)) return { type: 'PAY_BAIL', p };
      }
      if (R.chance(0.15)) return assetAction(g, p, R);
      return { type: 'ROLL', p };
    case 'buy': {
      const price = SQUARES[g.pendingBuy].price;
      if (pl.cash >= price && R.chance(0.75)) return { type: 'BUY', p };
      if (pl.cash < price && R.chance(0.2)) return assetAction(g, p, R);
      return R.chance(0.9) ? { type: 'DECLINE', p } : { type: 'BUY', p };
    }
    case 'auction': {
      const min = minNextBid(g.auction);
      const value = SQUARES[g.auction.sq].price;
      if (g.auction.bidder !== p && min <= pl.cash && min <= value * 1.2 && R.chance(0.6)) {
        const step = RULES.bidStep * R.int(4);
        return { type: 'BID', p, amount: Math.min(pl.cash, min + step) };
      }
      return { type: 'PASS_BID', p };
    }
    case 'postRoll': {
      if (R.chance(0.3)) {
        const buildable = ownedBy(g, p).filter((id) => SQUARES[id].type === 'property' && ownsWholeGroup(g, p, SQUARES[id].group));
        if (buildable.length) {
          const group = SQUARES[R.pick(buildable)].group;
          const ids = groupMembers(group);
          const low = Math.min(...ids.map((id) => g.props[id].houses));
          const sq = ids.find((id) => g.props[id].houses === low);
          if (pl.cash - GROUPS[group].houseCost > 60) return { type: 'BUILD', p, sq };
        }
      }
      if (R.chance(0.05)) {
        const mort = ownedBy(g, p).filter((id) => g.props[id].mortgaged && unmortgageCost(id) < pl.cash - 300);
        if (mort.length) return { type: 'UNMORTGAGE', p, sq: R.pick(mort) };
      }
      if (R.chance(0.06)) return tradeAction(g, p, R);
      if (R.chance(0.06)) return assetAction(g, p, R);
      return { type: 'END_TURN', p };
    }
    case 'debt':
      return debtAction(g, p, R);
    case 'trade': {
      const t = g.trade;
      if (R.chance(0.15)) return { type: 'CANCEL_TRADE', p: t.from };
      if (R.chance(0.05)) return { type: 'ACCEPT_TRADE', p: t.from };
      return R.chance(0.5) ? { type: 'ACCEPT_TRADE', p: t.to } : { type: 'REJECT_TRADE', p: t.to };
    }
    default:
      throw new Error(`no actor action for phase ${g.phase}`);
  }
}

function chooseAction(g, R, ctx) {
  const roll = R.next();
  if (roll < 0.01) return { type: 'TIMEOUT', force: true };
  if (roll < 0.02) {
    ctx.now += 60000;
    return { type: 'TIMEOUT' };
  }
  if (roll < 0.0215 && ctx.resigns < 2) {
    ctx.resigns += 1;
    return { type: 'RESIGN', p: R.pick(alive(g)) };
  }
  if (roll < 0.1) return assetAction(g, R.pick(alive(g)), R);
  return turnAction(g, R);
}

// Start variants (test-only state surgery right after createGame) so that debts,
// buildings and bankruptcies happen far more often than in a plain start.
const VARIANTS = ['standard', 'poor', 'dealt'];

function prepare(g, variant, R) {
  if (variant === 'poor') {
    for (const pl of g.players) pl.cash = 150 + R.int(500);
  }
  if (variant === 'dealt') {
    for (const id of OWNABLE_IDS) {
      if (R.chance(0.6)) g.props[id].owner = R.int(g.players.length);
    }
    // Hand out some complete color groups, already developed evenly.
    for (const group of Object.keys(GROUPS)) {
      if (!R.chance(0.5)) continue;
      const owner = R.int(g.players.length);
      const level = R.int(5);
      for (const id of groupMembers(group)) Object.assign(g.props[id], { owner, houses: level });
    }
    for (const pl of g.players) pl.cash = 400 + R.int(1100);
  }
  return g;
}

function playGame(seed) {
  const R = botRng(seed * 7919 + 13);
  const nPlayers = 2 + (seed % 5);
  const maxRounds = RULES.roundOptions[Math.floor(seed / 5) % RULES.roundOptions.length];
  const variant = VARIANTS[Math.floor(seed / 15) % VARIANTS.length];
  const ctx = { label: `seed ${seed} (${nPlayers}p/${maxRounds}r/${variant})`, step: 0, now: 1_000_000, lastLogN: 0, resigns: 0 };
  let g = prepare(createGame({ players: makePlayers(nPlayers), seed, now: ctx.now, maxRounds }), variant, R);
  checkInvariants(g, ctx);
  const stats = { ok: 0, err: 0 };
  while (g.phase !== 'gameOver') {
    ctx.step += 1;
    assert.ok(ctx.step <= STEP_CAP, `${ctx.label}: no gameOver after ${STEP_CAP} actions (deadlock?) phase=${g.phase} round=${g.round}`);
    ctx.now += 1 + R.int(3000);
    const action = chooseAction(g, R, ctx);
    if (action === null) continue;
    const res = applyAction(g, action, { now: ctx.now });
    if (res.error) {
      assert.equal(res.game, g, `${ctx.label}: error result is not the input object`);
      assert.match(res.error.key, /^err\.\w+$/);
      assert.ok(res.error.key in zhTW && res.error.key in en, `${ctx.label}: unknown error key ${res.error.key}`);
      stats.err += 1;
      continue;
    }
    assert.notEqual(res.game, g, `${ctx.label}: success must return a new object`);
    g = res.game;
    stats.ok += 1;
    checkInvariants(g, ctx);
  }
  // Actions after the end are rejected without touching the state.
  for (const type of ACTION_TYPES) {
    const res = applyAction(g, { type, p: g.winner }, { now: ctx.now });
    assert.equal(res.error.key, 'err.gameOver');
    assert.equal(res.game, g);
  }
  return { g, stats, steps: ctx.step };
}

test(`fuzz: ${GAMES} random games reach gameOver with all invariants holding`, () => {
  const endings = { rounds: 0, lastStanding: 0 };
  let totalOk = 0;
  for (let seed = 1; seed <= GAMES; seed += 1) {
    const { g, stats } = playGame(seed);
    totalOk += stats.ok;
    if (alive(g).length === 1) endings.lastStanding += 1;
    else {
      endings.rounds += 1;
      assert.equal(g.round, g.maxRounds + 1, `seed ${seed}: game ended early with ${alive(g).length} players alive`);
      assert.equal(g.worthLog.length, g.maxRounds);
    }
  }
  // Both ways of ending must actually be exercised.
  assert.ok(endings.rounds > 0 && endings.lastStanding > 0, JSON.stringify(endings));
  assert.ok(totalOk > GAMES * 50, `too few successful actions: ${totalOk}`);
});
