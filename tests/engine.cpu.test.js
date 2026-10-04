// Normal computer opponent (cpuAction): key decisions, and complete games where
// every seat (or some seats, next to the cautious bot) is played by it.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CPU_BAIL_RESERVE, CPU_BID_OPEN, CPU_BID_RAISE, CPU_BUILD_RESERVE, CPU_BUY_RESERVE, CPU_GROUP_RESERVE, CPU_STOCK_BUDGET,
  CPU_UNMORTGAGE_RESERVE, computerAction, cpuAction,
} from '../js/engine/bot.js';
import { SQUARES, unmortgageCost } from '../js/engine/board.js';
import { actorOf, applyAction, createGame } from '../js/engine/game.js';
import { RULES } from '../js/engine/rules.js';
import { act, edit, landOn, lastLog, makePlayers, newGame, own } from './helpers.js';

// Freezing the state makes any mutation by the strategy throw (ES modules are strict).
function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

// Ask the strategy for seat `p` and apply its action, which must be accepted.
const step = (g, p) => {
  const action = cpuAction(deepFreeze(structuredClone(g)), p);
  assert.ok(action, `no move for seat ${p} in ${g.phase}`);
  return { action, g: act(g, action) };
};

// Let seat `p` act until it returns `type` (applied too); returns the actions taken.
function until(g, p, type, cap = 200) {
  const actions = [];
  let cur = g;
  for (let i = 0; i < cap; i += 1) {
    const res = step(cur, p);
    actions.push(res.action);
    cur = res.g;
    if (res.action.type === type) return { actions, g: cur };
  }
  throw new Error(`seat ${p} never chose ${type}: ${JSON.stringify(actions.slice(-5))}`);
}

const withCash = (g, p, cash) => edit(g, (c) => { c.players[p].cash = cash; });

// Seat 0 in postRoll after buying square 1 (brown), with `cash` and squares `ids` (+ extra fields).
const postRoll = (cash, ids = [], extra = {}) => {
  const g = act(landOn(newGame(2), 1), { type: 'BUY', p: 0 });
  assert.equal(g.phase, 'postRoll');
  return withCash(own(g, 0, ids, extra), 0, cash);
};

const jailed = (g, extra = {}) => edit(g, (c) => {
  Object.assign(c.players[0], { pos: 10, inJail: true, jailTurns: 0, ...extra });
});

// Seat 0 owes 50 rent on square 39 with only 10 cash.
const inDebt = (g) => landOn(withCash(own(g, 1, [39]), 0, 10), 39);

test('preRoll: roll; in jail use a card, pay the fine when rich, else roll', () => {
  const g = newGame(2);
  assert.deepEqual(cpuAction(g, 0), { type: 'ROLL', p: 0 });
  assert.deepEqual(step(jailed(g, { jailCards: ['chance'] }), 0).action, { type: 'USE_JAIL_CARD', p: 0 });
  const rich = jailed(g, { cash: RULES.jailFine + CPU_BAIL_RESERVE });
  assert.deepEqual(step(rich, 0).action, { type: 'PAY_BAIL', p: 0 });
  const poor = jailed(g, { cash: RULES.jailFine + CPU_BAIL_RESERVE - 1 });
  assert.deepEqual(step(poor, 0).action, { type: 'ROLL', p: 0 });
  // After leaving jail it rolls.
  assert.deepEqual(cpuAction(step(rich, 0).g, 0), { type: 'ROLL', p: 0 });
});

test('buy: keeps the reserve, and dips lower to complete a colour group', () => {
  const price = SQUARES[6].price;
  const at = (cash, g = newGame(2)) => landOn(withCash(g, 0, cash), 6);
  assert.equal(at(price + CPU_BUY_RESERVE).phase, 'buy');
  assert.deepEqual(step(at(price + CPU_BUY_RESERVE), 0).action, { type: 'BUY', p: 0 });
  assert.deepEqual(step(at(price + CPU_BUY_RESERVE - 1), 0).action, { type: 'DECLINE', p: 0 });
  const twoOfThree = own(newGame(2), 0, [8, 9]);
  assert.deepEqual(step(at(price + CPU_GROUP_RESERVE, twoOfThree), 0).action, { type: 'BUY', p: 0 });
  assert.deepEqual(step(at(price + CPU_GROUP_RESERVE - 1, twoOfThree), 0).action, { type: 'DECLINE', p: 0 });
});

test('auction: opens at half the list price, raises by a tenth up to it, passes beyond it or when poor, waits as top bidder', () => {
  const auction = act(landOn(newGame(3), 1), { type: 'DECLINE', p: 0 });
  assert.equal(auction.phase, 'auction');
  const listPrice = SQUARES[1].price;
  const open = Math.ceil((listPrice * CPU_BID_OPEN) / RULES.bidStep) * RULES.bidStep;
  const raise = Math.ceil((listPrice * CPU_BID_RAISE) / RULES.bidStep) * RULES.bidStep;
  const first = step(auction, 1);
  assert.deepEqual(first.action, { type: 'BID', p: 1, amount: open });
  assert.equal(cpuAction(first.g, 1), null, 'never outbids itself');
  assert.deepEqual(cpuAction(first.g, 2), { type: 'BID', p: 2, amount: open + raise });
  const nearList = edit(auction, (c) => { c.auction = { ...c.auction, bid: listPrice - RULES.bidStep, bidder: 0 }; });
  assert.deepEqual(step(nearList, 1).action, { type: 'BID', p: 1, amount: listPrice }, 'capped at the list price');

  const atList = edit(auction, (c) => { c.auction = { ...c.auction, bid: listPrice, bidder: 0 }; });
  assert.deepEqual(step(atList, 1).action, { type: 'PASS_BID', p: 1 });
  const poor = withCash(auction, 1, CPU_BUY_RESERVE + open - 1);
  assert.deepEqual(step(poor, 1).action, { type: 'PASS_BID', p: 1 });
  // Owning the other brown square lowers the reserve.
  assert.deepEqual(step(own(poor, 1, [3]), 1).action, { type: 'BID', p: 1, amount: open });
});

test('auction between computer seats ends at the list price', () => {
  let g = act(landOn(newGame(3), 1), { type: 'DECLINE', p: 0 });
  for (let i = 0; g.phase === 'auction'; i += 1) {
    assert.ok(i < 100, 'auction did not end');
    const p = actorOf(g).find((s) => cpuAction(g, s));
    assert.notEqual(p, undefined, 'every active seat waits');
    g = step(g, p).g;
  }
  assert.equal(lastLog(g, 'log.auctionWon').params.amt, SQUARES[1].price);
});

test('postRoll: builds evenly on a full colour group down to the reserve, then ends the turn', () => {
  const cash = CPU_BUILD_RESERVE + 7 * 50; // seven light-blue houses
  const { actions, g } = until(postRoll(cash, [6, 8, 9]), 0, 'END_TURN');
  assert.equal(actions.filter((a) => a.type === 'BUILD').length, 7);
  const houses = [6, 8, 9].map((id) => g.props[id].houses);
  assert.equal(Math.max(...houses) - Math.min(...houses), 1);
  assert.equal(g.players[0].cash, CPU_BUILD_RESERVE);
  assert.equal(g.current, 1);

  assert.deepEqual(step(postRoll(5000, [6, 8]), 0).action, { type: 'BUY_STOCK', p: 0, sym: 'CHIP', n: 1 }, 'no full group: no building');
  assert.deepEqual(step(postRoll(CPU_BUILD_RESERVE + 49, [6, 8, 9]), 0).action, { type: 'END_TURN', p: 0 });
});

test('postRoll: lifts mortgages when cash is plentiful, full groups first', () => {
  const cost = unmortgageCost(6);
  const g = own(postRoll(CPU_UNMORTGAGE_RESERVE + cost, [5, 6, 8, 9], { mortgaged: true }), 0, [1], { mortgaged: true });
  assert.deepEqual(step(g, 0).action, { type: 'UNMORTGAGE', p: 0, sq: 6 }, 'full group before the cheaper lone square 1');
  assert.deepEqual(step(withCash(g, 0, CPU_UNMORTGAGE_RESERVE + cost - 1), 0).action, { type: 'UNMORTGAGE', p: 0, sq: 1 });
  assert.deepEqual(step(withCash(g, 0, CPU_UNMORTGAGE_RESERVE + unmortgageCost(1) - 1), 0).action, { type: 'END_TURN', p: 0 });
});

test('postRoll: buys a few cheap shares when rich, sells when cash is low or after a clear profit', () => {
  const cheapShip = (g) => edit(g, (c) => { c.market.stocks.SHIP.price = 50; });
  const buy = step(cheapShip(postRoll(2000)), 0).action;
  assert.deepEqual(buy, { type: 'BUY_STOCK', p: 0, sym: 'SHIP', n: Math.floor(CPU_STOCK_BUDGET / 50) });
  const holding = (stocks) => edit(postRoll(600), (c) => { c.players[0].stocks = stocks; });
  const twoKinds = edit(holding({ BEAR: { n: 1, cost: 30 }, BOBA: { n: 1, cost: 45 } }), (c) => { c.players[0].cash = 2000; });
  assert.deepEqual(step(twoKinds, 0).action, { type: 'END_TURN', p: 0 }, 'holds enough kinds already');

  const low = withCash(holding({ BEAR: { n: 10, cost: 300 }, CHIP: { n: 2, cost: 240 } }), 0, CPU_BUY_RESERVE - 100);
  assert.deepEqual(step(low, 0).action, { type: 'SELL_STOCK', p: 0, sym: 'BEAR', n: 10 });
  assert.deepEqual(step(holding({ BOBA: { n: 10, cost: 300 } }), 0).action, { type: 'SELL_STOCK', p: 0, sym: 'BOBA', n: 10 });
  assert.deepEqual(step(holding({ BOBA: { n: 10, cost: 400 } }), 0).action, { type: 'END_TURN', p: 0 });
});

test('postRoll: a rich seat with many groups and shares still ends its turn', () => {
  const g = edit(postRoll(6000, [3, 5, 6, 8, 9, 11, 13, 14, 16, 18, 19]), (c) => {
    for (const id of [8, 14, 19]) c.props[id].mortgaged = true;
    c.players[0].stocks = { BEAR: { n: 20, cost: 0 }, CHIP: { n: 5, cost: 700 } };
  });
  const { actions, g: after } = until(g, 0, 'END_TURN');
  const count = (type) => actions.filter((a) => a.type === type).length;
  assert.equal(count('UNMORTGAGE'), 3);
  assert.ok(count('BUILD') > 0);
  assert.equal(count('SELL_STOCK'), 1, 'only the gifted shares are a clear profit');
  assert.equal(after.phase, 'preRoll');
});

test('trade: always rejects', () => {
  const trade = act(own(newGame(2), 0, [1]), { type: 'PROPOSE_TRADE', p: 0, to: 1, give: { props: [1] }, get: { cash: 10 } });
  assert.deepEqual(step(trade, 1).action, { type: 'REJECT_TRADE', p: 1 });
});

test('debt: shares first, then squares outside full groups, then buildings; bankrupt when short', () => {
  const shares = edit(inDebt(newGame(2)), (c) => { c.players[0].stocks = { BEAR: { n: 10, cost: 300 } }; });
  assert.equal(shares.phase, 'debt');
  const sold = step(shares, 0);
  assert.deepEqual(sold.action, { type: 'SELL_STOCK', p: 0, sym: 'BEAR', n: Math.ceil(40 / 30) + 1 });
  assert.equal(sold.g.debt, null);
  assert.equal(sold.g.players[0].stocks.BEAR.n, 7, 'keeps the shares it did not need');

  assert.deepEqual(step(inDebt(own(newGame(2), 0, [1, 3, 5])), 0).action, { type: 'MORTGAGE', p: 0, sq: 5 });

  const built = inDebt(own(newGame(2), 0, [1, 3], { houses: 1 }));
  const { actions, g } = until(built, 0, 'SELL_BUILDING');
  assert.equal(actions.length, 1);
  assert.equal(g.phase, 'debt', 'one refund is not enough');
  const paid = step(g, 0);
  assert.equal(paid.action.type, 'SELL_BUILDING');
  assert.equal(paid.g.debt, null);
  assert.equal(paid.g.players[0].bankrupt, false);

  const broke = step(inDebt(own(newGame(3), 0, [5], { mortgaged: true })), 0);
  assert.deepEqual(broke.action, { type: 'DECLARE_BANKRUPTCY', p: 0 });
  assert.equal(broke.g.players[0].bankrupt, true);
});

test('no move for a seat that is not acting or is bankrupt', () => {
  const g = newGame(2);
  assert.equal(cpuAction(g, 1), null);
  assert.equal(cpuAction(g, 7), null);
  assert.equal(cpuAction(edit(g, (c) => { c.players[0].bankrupt = true; }), 0), null);
  assert.equal(cpuAction(edit(g, (c) => { c.phase = 'gameOver'; }), 0), null);
});

// ---------- complete games ----------

const STEP_CAP = 20000;
const PHASE_VISIT_CAP = 100; // actions within one phase visit (a phase must end)

// Each acting seat asks its strategy; the first move is applied. TIMEOUT (forced)
// only when no acting seat has a move.
function playOut({ seed, n, strategyOf }) {
  let g = createGame({ players: makePlayers(n), seed, now: 0, maxRounds: RULES.roundOptions[0] });
  const label = `seed ${seed} (${n}p)`;
  const stats = { steps: 0, timeouts: 0, builds: 0, bids: 0, maxVisit: 0 };
  let visit = { key: '', n: 0 };
  let now = 0;
  while (g.phase !== 'gameOver') {
    stats.steps += 1;
    assert.ok(stats.steps <= STEP_CAP, `${label}: no gameOver after ${STEP_CAP} actions`);
    deepFreeze(g);
    const moves = actorOf(g).map((p) => strategyOf(p)(g, p));
    const action = moves.find(Boolean) ?? { type: 'TIMEOUT', force: true };
    if (action.type === 'TIMEOUT') stats.timeouts += 1;
    if (action.type === 'BUILD') stats.builds += 1;
    if (action.type === 'BID') stats.bids += 1;
    const key = `${g.phase}:${g.current}:${g.turnStartedAt}:${g.auction?.sq}`;
    visit = { key, n: key === visit.key ? visit.n + 1 : 1 };
    stats.maxVisit = Math.max(stats.maxVisit, visit.n);
    assert.ok(visit.n <= PHASE_VISIT_CAP, `${label}: ${visit.n} actions in one ${g.phase} visit`);
    now += 1500;
    const res = applyAction(g, action, { now });
    assert.equal(res.error, null, `${label}: ${JSON.stringify(action)} -> ${JSON.stringify(res.error)}`);
    g = res.game;
  }
  assert.equal(g.ranking.length, n, `${label}: no ranking`);
  return { g, stats };
}

function summarize(t, results) {
  const sum = (k) => results.reduce((s, r) => s + r.stats[k], 0);
  const withBuilds = results.filter((r) => r.stats.builds > 0).length;
  t.diagnostic(`${results.length} games, ${withBuilds} with houses, ${sum('builds')} houses, ${sum('bids')} bids, `
    + `avg ${Math.round(sum('steps') / results.length)} steps, longest phase visit ${Math.max(...results.map((r) => r.stats.maxVisit))}`);
  return withBuilds;
}

test('complete games with every seat played by cpuAction', (t) => {
  const results = [];
  for (let seed = 1; seed <= 25; seed += 1) {
    const n = 2 + (seed % 5);
    results.push(playOut({ seed, n, strategyOf: () => cpuAction }));
  }
  for (const r of results) assert.equal(r.stats.timeouts, 0, 'a computer seat had no move');
  assert.ok(summarize(t, results) > 0, 'no game had any house built');
  // A game where every seat buys what it lands on has no auction at all.
  assert.ok(results.filter((r) => r.stats.bids > 0).length > results.length / 2, 'computer seats rarely bid');
});

test('complete games mixing cpuAction and the cautious computerAction', (t) => {
  const results = [];
  let cpuWins = 0;
  for (let seed = 1; seed <= 15; seed += 1) {
    const n = 2 + (seed % 5);
    const res = playOut({ seed, n, strategyOf: (p) => (p % 2 === 0 ? cpuAction : computerAction) });
    if (res.g.winner % 2 === 0) cpuWins += 1;
    results.push(res);
  }
  for (const r of results) assert.equal(r.stats.timeouts, 0, 'a seat had no move');
  summarize(t, results);
  t.diagnostic(`cpuAction seats won ${cpuWins} of ${results.length}`);
});
