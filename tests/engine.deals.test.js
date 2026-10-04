// Buildings, mortgages, stock orders, trades, debt, bankruptcy and resignation.

import test from 'node:test';
import assert from 'node:assert/strict';
import { actorOf } from '../js/engine/game.js';
import {
  GROUPS, OWNABLE_IDS, SQUARES, mortgageValue, unmortgageCost,
} from '../js/engine/board.js';
import { DECKS } from '../js/engine/cards.js';
import { RULES, rentFor } from '../js/engine/rules.js';
import { buyCost, sellProceeds } from '../js/engine/stocks.js';
import { BANK, JAIL_CARD_ID } from '../js/engine/turn.js';
import {
  act, actErr, edit, landOn, lastLog, logKeys, newGame, own, withDice,
} from './helpers.js';

const atPhase = (g, phase) => edit(g, (c) => {
  c.phase = phase;
});

const setCash = (g, p, cash) => edit(g, (c) => {
  c.players[p].cash = cash;
});

const setPrice = (g, sym, price) => edit(g, (c) => {
  Object.assign(c.market.stocks[sym], { price, prevClose: price, hi: price, lo: price });
});

const houses = (g, ids) => ids.map((id) => g.props[id].houses);

// p0's turn (postRoll) owning the whole brown group and the light-blue group.
const builder = (n = 2) => own(atPhase(newGame(n), 'postRoll'), 0, [1, 3, 6, 8, 9]);

// ---------- buildings ----------

test('BUILD enforces turn, ownership, full group and even building', () => {
  const g = builder(3);
  assert.equal(actErr(g, { type: 'BUILD', p: 1, sq: 1 }).key, 'err.notNow');
  assert.equal(actErr(atPhase(g, 'buy'), { type: 'BUILD', p: 0, sq: 1 }).key, 'err.notNow');
  assert.equal(actErr(g, { type: 'BUILD', p: 0, sq: '1' }).key, 'err.badRequest');
  assert.equal(actErr(g, { type: 'BUILD', p: 0, sq: 2 }).key, 'err.badRequest');
  assert.equal(actErr(own(g, 0, [5]), { type: 'BUILD', p: 0, sq: 5 }).key, 'err.notBuildable');
  assert.equal(actErr(own(g, 1, [11]), { type: 'BUILD', p: 0, sq: 11 }).key, 'err.notYourProperty');
  assert.equal(actErr(own(g, 0, [11]), { type: 'BUILD', p: 0, sq: 11 }).key, 'err.needFullGroup');
  assert.equal(actErr(own(g, 0, [3], { mortgaged: true }), { type: 'BUILD', p: 0, sq: 1 }).key, 'err.groupMortgaged');
  assert.equal(actErr(setCash(g, 0, 49), { type: 'BUILD', p: 0, sq: 1 }).key, 'err.notEnoughCash');

  let b = act(g, { type: 'BUILD', p: 0, sq: 6 });
  assert.deepEqual(houses(b, [6, 8, 9]), [1, 0, 0]);
  assert.equal(b.players[0].cash, 1500 - GROUPS.lightblue.houseCost);
  assert.deepEqual(lastLog(b, 'log.build').params, { p: 0, sq: 6 });
  assert.deepEqual(actErr(b, { type: 'BUILD', p: 0, sq: 6 }), { key: 'err.buildEvenly', params: {} });
  b = act(b, { type: 'BUILD', p: 0, sq: 8 });
  b = act(b, { type: 'BUILD', p: 0, sq: 9 });
  b = act(b, { type: 'BUILD', p: 0, sq: 6 });
  assert.deepEqual(houses(b, [6, 8, 9]), [2, 1, 1]);
  assert.equal(b.players[0].cash, 1500 - 4 * 50);
  assert.equal(b.phase, 'postRoll');
  assert.ok(b.events.some((e) => e.kind === 'build' && e.square === 6));
  // Building is also allowed before rolling.
  assert.equal(act(atPhase(g, 'preRoll'), { type: 'BUILD', p: 0, sq: 1 }).props[1].houses, 1);
});

test('a hotel is houses === 5 and charges the top rent', () => {
  let g = own(builder(), 0, [1, 3], { houses: 4 });
  g = act(g, { type: 'BUILD', p: 0, sq: 3 });
  assert.equal(g.props[3].houses, 5);
  assert.deepEqual(lastLog(g, 'log.buildHotel').params, { p: 0, sq: 3 });
  assert.equal(actErr(g, { type: 'BUILD', p: 0, sq: 3 }).key, 'err.alreadyHotel');
  g = act(g, { type: 'BUILD', p: 0, sq: 1 });
  assert.equal(actErr(g, { type: 'BUILD', p: 0, sq: 1 }).key, 'err.alreadyHotel');
  assert.equal(rentFor(g, 3, 7), SQUARES[3].rent[5]);
  assert.equal(rentFor(g, 1, 7), SQUARES[1].rent[5]);
});

test('SELL_BUILDING sells evenly for half the house cost', () => {
  const g = own(builder(3), 0, [6, 8, 9], { houses: 5 });
  assert.equal(actErr(g, { type: 'SELL_BUILDING', p: 1, sq: 6 }).key, 'err.notNow');
  assert.equal(actErr(g, { type: 'SELL_BUILDING', p: 0, sq: 99 }).key, 'err.badRequest');
  assert.equal(actErr(g, { type: 'SELL_BUILDING', p: 0, sq: 1 }).key, 'err.noBuilding');
  assert.equal(actErr(g, { type: 'SELL_BUILDING', p: 0, sq: 5 }).key, 'err.notYourProperty');
  assert.equal(actErr(own(g, 1, [11, 13, 14], { houses: 1 }), { type: 'SELL_BUILDING', p: 0, sq: 11 }).key, 'err.notYourProperty');
  let s = act(g, { type: 'SELL_BUILDING', p: 0, sq: 9 });
  assert.deepEqual(houses(s, [6, 8, 9]), [5, 5, 4]);
  assert.equal(s.players[0].cash, 1525);
  assert.deepEqual(lastLog(s, 'log.sellBuilding').params, { p: 0, sq: 9, amt: 25 });
  assert.equal(actErr(s, { type: 'SELL_BUILDING', p: 0, sq: 9 }).key, 'err.sellEvenly');
  s = act(s, { type: 'SELL_BUILDING', p: 0, sq: 6 });
  s = act(s, { type: 'SELL_BUILDING', p: 0, sq: 8 });
  s = act(s, { type: 'SELL_BUILDING', p: 0, sq: 8 });
  assert.deepEqual(houses(s, [6, 8, 9]), [4, 3, 4]);
  // Selling is a way to raise cash, so it is allowed while deciding to buy.
  assert.equal(act(atPhase(g, 'buy'), { type: 'SELL_BUILDING', p: 0, sq: 6 }).props[6].houses, 4);
});

// ---------- mortgages ----------

test('unmortgage cost is mortgage value plus 10%, rounded up, without float error', () => {
  for (const id of OWNABLE_IDS) {
    assert.equal(mortgageValue(id), SQUARES[id].price / 2);
    assert.equal(unmortgageCost(id), Math.ceil((SQUARES[id].price * 11) / 20), `square ${id}`);
  }
  // Regression: Math.ceil(100 * 1.1) is 111 because 100 * 1.1 === 110.00000000000001.
  assert.deepEqual([1, 5, 6, 12, 16, 21, 39].map(unmortgageCost), [33, 110, 55, 83, 99, 121, 220]);
});

test('MORTGAGE and UNMORTGAGE move the right amounts', () => {
  const g = own(builder(), 0, [5]);
  assert.equal(actErr(g, { type: 'MORTGAGE', p: 1, sq: 5 }).key, 'err.notNow');
  assert.equal(actErr(g, { type: 'MORTGAGE', p: 0, sq: 0 }).key, 'err.badRequest');
  assert.equal(actErr(g, { type: 'MORTGAGE', p: 0, sq: 15 }).key, 'err.notYourProperty');
  let m = act(g, { type: 'MORTGAGE', p: 0, sq: 5 });
  assert.equal(m.props[5].mortgaged, true);
  assert.equal(m.players[0].cash, 1600);
  assert.deepEqual(lastLog(m, 'log.mortgage').params, { p: 0, sq: 5, amt: 100 });
  assert.equal(actErr(m, { type: 'MORTGAGE', p: 0, sq: 5 }).key, 'err.alreadyMortgaged');

  assert.equal(actErr(atPhase(m, 'buy'), { type: 'UNMORTGAGE', p: 0, sq: 5 }).key, 'err.notNow');
  assert.equal(actErr(m, { type: 'UNMORTGAGE', p: 0, sq: 1.5 }).key, 'err.badRequest');
  assert.equal(actErr(m, { type: 'UNMORTGAGE', p: 0, sq: 1 }).key, 'err.notMortgaged');
  assert.equal(actErr(m, { type: 'UNMORTGAGE', p: 0, sq: 15 }).key, 'err.notYourProperty');
  assert.equal(actErr(setCash(m, 0, 109), { type: 'UNMORTGAGE', p: 0, sq: 5 }).key, 'err.notEnoughCash');
  m = act(setCash(m, 0, 110), { type: 'UNMORTGAGE', p: 0, sq: 5 });
  assert.equal(m.props[5].mortgaged, false);
  assert.equal(m.players[0].cash, 0, 'exactly 110 is charged for a 200 station');
  assert.deepEqual(lastLog(m, 'log.unmortgage').params, { p: 0, sq: 5, amt: 110 });
  // Mortgaging is allowed while deciding to buy.
  assert.equal(act(atPhase(g, 'buy'), { type: 'MORTGAGE', p: 0, sq: 5 }).props[5].mortgaged, true);
});

test('a group with buildings cannot be mortgaged', () => {
  const g = own(builder(), 0, [6], { houses: 1 });
  assert.equal(actErr(g, { type: 'MORTGAGE', p: 0, sq: 8 }).key, 'err.groupHasBuildings');
  assert.equal(actErr(g, { type: 'MORTGAGE', p: 0, sq: 6 }).key, 'err.groupHasBuildings');
  assert.equal(act(g, { type: 'MORTGAGE', p: 0, sq: 1 }).props[1].mortgaged, true);
  const sold = act(g, { type: 'SELL_BUILDING', p: 0, sq: 6 });
  assert.equal(act(sold, { type: 'MORTGAGE', p: 0, sq: 8 }).props[8].mortgaged, true);
});

// ---------- stocks ----------

test('buyCost rounds up and sellProceeds rounds down to whole dollars', () => {
  assert.equal(buyCost(33.33, 7), 234);
  assert.equal(sellProceeds(33.33, 7), 233);
  assert.equal(buyCost(1.1, 3), 4);
  assert.equal(sellProceeds(1.1, 3), 3);
  assert.equal(buyCost(64.6, 1000), 64600, 'no float drift on whole results');
  assert.equal(sellProceeds(64.6, 1000), 64600);
  assert.equal(sellProceeds(0.29, 100), 29);
  assert.equal(buyCost(0.01, 1), 1);
  assert.equal(sellProceeds(0.01, 1), 0);
});

test('BUY_STOCK and SELL_STOCK keep cash integral and track cost basis', () => {
  const g = setPrice(newGame(3), 'CHIP', 33.33);
  // Any alive player may trade stocks, not only the current one.
  let s = act(g, { type: 'BUY_STOCK', p: 2, sym: 'CHIP', n: 7 });
  assert.equal(s.players[2].cash, 1500 - 234);
  assert.deepEqual(s.players[2].stocks, { CHIP: { n: 7, cost: 234 } });
  assert.deepEqual(lastLog(s, 'log.stockBuy').params, { p: 2, sym: 'CHIP', n: 7, amt: 234 });
  s = act(s, { type: 'BUY_STOCK', p: 2, sym: 'CHIP', n: 3 });
  assert.deepEqual(s.players[2].stocks.CHIP, { n: 10, cost: 234 + 100 });
  s = act(s, { type: 'SELL_STOCK', p: 2, sym: 'CHIP', n: 4 });
  assert.equal(s.players[2].cash, 1500 - 334 + 133);
  assert.deepEqual(s.players[2].stocks.CHIP, { n: 6, cost: Math.round((334 * 6) / 10) });
  assert.deepEqual(lastLog(s, 'log.stockSell').params, { p: 2, sym: 'CHIP', n: 4, amt: 133 });
  s = act(s, { type: 'SELL_STOCK', p: 2, sym: 'CHIP', n: 6 });
  assert.deepEqual(s.players[2].stocks, {});
  assert.ok(Number.isInteger(s.players[2].cash));

  for (const bad of [
    { sym: 'NOPE', n: 1 }, { sym: 'CHIP', n: 0 }, { sym: 'CHIP', n: 1.5 }, { sym: 'CHIP', n: '2' },
    { sym: 'CHIP', n: RULES.maxShareOrder + 1 }, { n: 1 },
  ]) {
    assert.equal(actErr(g, { type: 'BUY_STOCK', p: 0, ...bad }).key, 'err.badRequest');
    assert.equal(actErr(g, { type: 'SELL_STOCK', p: 0, ...bad }).key, 'err.badRequest');
  }
  assert.equal(actErr(g, { type: 'BUY_STOCK', p: 0, sym: 'CHIP', n: 46 }).key, 'err.notEnoughCash');
  assert.equal(act(g, { type: 'BUY_STOCK', p: 0, sym: 'CHIP', n: 45 }).players[0].cash, 1500 - 1500);
  assert.equal(actErr(g, { type: 'SELL_STOCK', p: 0, sym: 'CHIP', n: 1 }).key, 'err.notEnoughShares');
  assert.equal(actErr(s, { type: 'SELL_STOCK', p: 2, sym: 'CHIP', n: 1 }).key, 'err.notEnoughShares');
});

// ---------- trades ----------

const T = (to, give = {}, get = {}) => ({ type: 'PROPOSE_TRADE', p: 0, to, give, get });

// p0 (postRoll) owns 1, 3 and mortgaged 5; p1 owns 6 and mortgaged 15; p1 holds a jail card.
const trader = (n = 3) => {
  let g = own(own(atPhase(newGame(n), 'postRoll'), 0, [1, 3]), 0, [5], { mortgaged: true });
  g = own(own(g, 1, [6]), 1, [15], { mortgaged: true });
  return edit(g, (c) => {
    c.players[1].jailCards = ['chance'];
    c.decks.chance = c.decks.chance.filter((id) => id !== JAIL_CARD_ID.chance);
  });
};

test('PROPOSE_TRADE validation', () => {
  const g = trader();
  assert.equal(actErr(g, { ...T(0, { cash: 1 }), p: 1 }).key, 'err.notNow');
  assert.equal(actErr(atPhase(g, 'buy'), T(1, { cash: 1 })).key, 'err.notNow');
  for (const to of [0, 3, -1, '1', undefined]) {
    assert.equal(actErr(g, T(to, { cash: 1 })).key, 'err.badRequest', `to=${to}`);
  }
  assert.equal(actErr(edit(g, (c) => { c.players[2].bankrupt = true; }), T(2, { cash: 1 })).key, 'err.badRequest');
  for (const side of [null, 5, { cash: -1 }, { cash: 1.5 }, { cards: -1 }, { props: 'x' }, { props: [2] }, { props: [1, 1] }]) {
    assert.equal(actErr(g, T(1, side, {})).key, 'err.badRequest', JSON.stringify(side));
    assert.equal(actErr(g, T(1, {}, side)).key, 'err.badRequest', JSON.stringify(side));
  }
  assert.equal(actErr(g, T(1)).key, 'err.tradeEmpty');
  assert.deepEqual(actErr(g, T(1, { cash: 1501 })), { key: 'err.tradeCash', params: { p: 0 } });
  assert.deepEqual(actErr(g, T(1, {}, { cash: 1501 })), { key: 'err.tradeCash', params: { p: 1 } });
  assert.deepEqual(actErr(g, T(1, { cards: 1 })), { key: 'err.tradeCards', params: { p: 0 } });
  assert.deepEqual(actErr(g, T(1, {}, { cards: 2 })), { key: 'err.tradeCards', params: { p: 1 } });
  assert.deepEqual(actErr(g, T(1, { props: [6] })), { key: 'err.notOwnedBy', params: { sq: 6, p: 0 } });
  assert.deepEqual(actErr(g, T(1, {}, { props: [1] })), { key: 'err.notOwnedBy', params: { sq: 1, p: 1 } });
  assert.deepEqual(
    actErr(own(g, 0, [1], { houses: 1 }), T(1, { props: [3] })),
    { key: 'err.tradeHasBuildings', params: { sq: 3 } },
  );
  // The receiver of a mortgaged square must afford the 10% fee after the swap.
  assert.deepEqual(actErr(setCash(g, 1, 9), T(1, { props: [5] })), { key: 'err.tradeFee', params: { p: 1 } });
  assert.deepEqual(actErr(setCash(g, 0, 9), T(1, {}, { props: [15] })), { key: 'err.tradeFee', params: { p: 0 } });
  assert.equal(act(setCash(g, 1, 10), T(1, { props: [5] })).phase, 'trade');
  assert.equal(act(setCash(g, 0, 0), T(1, {}, { props: [15], cash: 10 })).phase, 'trade');
});

test('ACCEPT_TRADE swaps cash, squares and jail cards and charges the mortgage fee', () => {
  let g = act(trader(), T(1, { cash: 100, props: [1, 5] }, { props: [6, 15], cards: 1 }), 50);
  assert.equal(g.phase, 'trade');
  assert.deepEqual(g.trade, {
    from: 0, to: 1, give: { cash: 100, props: [1, 5], cards: 0 }, get: { cash: 0, props: [6, 15], cards: 1 }, back: 'postRoll',
  });
  assert.equal(g.deadline, 50 + RULES.phaseMs.trade);
  assert.deepEqual(actorOf(g), [1]);
  assert.deepEqual(lastLog(g, 'log.tradePropose').params, { p: 0, q: 1 });
  assert.equal(actErr(g, { type: 'ACCEPT_TRADE', p: 0 }).key, 'err.notNow');
  assert.equal(actErr(g, { type: 'ACCEPT_TRADE', p: 2 }).key, 'err.notNow');
  assert.equal(actErr(g, { type: 'END_TURN', p: 0 }).key, 'err.notNow');
  assert.equal(actErr(g, { type: 'PROPOSE_TRADE', p: 0, to: 2, give: { cash: 1 }, get: {} }).key, 'err.notNow');
  g = act(g, { type: 'ACCEPT_TRADE', p: 1 });
  assert.equal(g.phase, 'postRoll');
  assert.equal(g.trade, null);
  assert.equal(g.props[1].owner, 1);
  assert.equal(g.props[5].owner, 1);
  assert.equal(g.props[5].mortgaged, true, 'mortgage status moves with the square');
  assert.equal(g.props[6].owner, 0);
  assert.equal(g.props[15].owner, 0);
  assert.equal(g.players[0].cash, 1500 - 100 - 10);
  assert.equal(g.players[1].cash, 1500 + 100 - 10);
  assert.deepEqual(g.players[0].jailCards, ['chance']);
  assert.deepEqual(g.players[1].jailCards, []);
  assert.deepEqual(lastLog(g, 'log.tradeAccept').params, { p: 0, q: 1 });
  assert.ok(g.events.some((e) => e.kind === 'trade' && e.from === 0 && e.to === 1));
});

test('a trade is re-validated on accept', () => {
  let g = act(trader(), T(1, { cash: 1000 }, { props: [6] }));
  // The proposer spends the cash while the offer is open.
  g = act(g, { type: 'BUY_STOCK', p: 0, sym: 'BEAR', n: 20 });
  assert.deepEqual(actErr(g, { type: 'ACCEPT_TRADE', p: 1 }), { key: 'err.tradeCash', params: { p: 0 } });
  g = act(g, { type: 'SELL_STOCK', p: 0, sym: 'BEAR', n: 20 });
  assert.equal(act(g, { type: 'ACCEPT_TRADE', p: 1 }).props[6].owner, 0);
});

test('REJECT_TRADE, CANCEL_TRADE and trade TIMEOUT return to the previous phase', () => {
  const g = act(atPhase(trader(), 'preRoll'), T(1, { cash: 5 }), 0);
  assert.equal(g.trade.back, 'preRoll');
  assert.equal(actErr(g, { type: 'REJECT_TRADE', p: 0 }).key, 'err.notNow');
  assert.equal(actErr(g, { type: 'CANCEL_TRADE', p: 1 }).key, 'err.notNow');
  let r = act(g, { type: 'REJECT_TRADE', p: 1 });
  assert.equal(r.phase, 'preRoll');
  assert.equal(r.trade, null);
  assert.equal(r.players[0].cash, 1500);
  assert.deepEqual(lastLog(r, 'log.tradeReject').params, { p: 0, q: 1 });
  r = act(g, { type: 'CANCEL_TRADE', p: 0 });
  assert.equal(r.phase, 'preRoll');
  assert.deepEqual(lastLog(r, 'log.tradeCancel').params, { p: 0, q: 1 });
  assert.equal(actErr(g, { type: 'TIMEOUT' }, RULES.phaseMs.trade - 1).key, 'err.notYet');
  r = act(g, { type: 'TIMEOUT' }, RULES.phaseMs.trade);
  assert.equal(r.phase, 'preRoll');
  assert.deepEqual(lastLog(r, 'log.tradeExpired').params, { p: 0, q: 1 });
  assert.deepEqual(lastLog(r, 'log.timeout').params, { p: 1 });
  // After the trade the player can still roll.
  assert.equal(act(withDice(r, 1, 2), { type: 'ROLL', p: 0 }).players[0].pos, 3);
});

// ---------- debt ----------

// p0 has $10, two brown houses and station 5, and lands on p1's Taipei 101 (rent 50).
const indebted = (n = 2) => {
  let g = own(own(newGame(n), 0, [1, 3], { houses: 1 }), 0, [5]);
  g = own(setCash(g, 0, 10), 1, [39]);
  return landOn(g, 39);
};

test('debt: only raising cash is allowed, and the debt is paid once covered', () => {
  let g = indebted(3);
  assert.equal(g.phase, 'debt');
  assert.deepEqual(g.debt, {
    p: 0, creditors: [{ p: 1, amount: 50 }], amount: 50, why: { key: 'why.rent', params: { sq: 39 } }, then: null,
  });
  assert.deepEqual(lastLog(g, 'log.debtOpen').params, { p: 0, amt: 50 });
  assert.equal(actErr(g, { type: 'PAY_DEBT', p: 0 }).key, 'err.notEnoughCash');
  assert.equal(actErr(g, { type: 'PAY_DEBT', p: 1 }).key, 'err.notNow');
  assert.equal(actErr(g, { type: 'DECLARE_BANKRUPTCY', p: 1 }).key, 'err.notNow');
  assert.equal(actErr(g, { type: 'END_TURN', p: 0 }).key, 'err.notNow');
  assert.equal(actErr(g, { type: 'BUILD', p: 0, sq: 1 }).key, 'err.notNow');
  assert.equal(actErr(g, { type: 'UNMORTGAGE', p: 0, sq: 5 }).key, 'err.notNow');
  assert.equal(actErr(g, { type: 'BUY_STOCK', p: 0, sym: 'BEAR', n: 1 }).key, 'err.notNow');
  assert.equal(actErr(g, T(1, { cash: 1 })).key, 'err.notNow');
  assert.equal(actErr(g, { type: 'MORTGAGE', p: 0, sq: 1 }).key, 'err.groupHasBuildings');
  assert.equal(actErr(g, { type: 'SELL_BUILDING', p: 1, sq: 1 }).key, 'err.notNow');
  // Other players may still trade stocks.
  assert.equal(act(g, { type: 'BUY_STOCK', p: 2, sym: 'BEAR', n: 1 }).phase, 'debt');

  g = act(g, { type: 'SELL_BUILDING', p: 0, sq: 1 });
  assert.equal(g.phase, 'debt');
  assert.equal(g.players[0].cash, 35);
  g = act(g, { type: 'SELL_BUILDING', p: 0, sq: 3 });
  assert.equal(g.debt, null);
  assert.equal(g.phase, 'postRoll');
  assert.equal(g.players[0].cash, 60 - 50);
  assert.equal(g.players[1].cash, 1550);
  assert.deepEqual(lastLog(g, 'log.debtPaid').params, { p: 0, amt: 50 });
});

test('debt: mortgage and stock sales also pay automatically; PAY_DEBT pays when cash suffices', () => {
  let g = act(indebted(), { type: 'MORTGAGE', p: 0, sq: 5 });
  assert.equal(g.phase, 'postRoll');
  assert.equal(g.players[0].cash, 10 + 100 - 50);

  g = edit(indebted(), (c) => {
    c.players[0].stocks = { BEAR: { n: 2, cost: 60 } };
  });
  g = act(g, { type: 'SELL_STOCK', p: 0, sym: 'BEAR', n: 1 });
  assert.equal(g.phase, 'debt', 'still short after selling $30 of stock');
  assert.equal(g.players[0].cash, 40);
  g = act(g, { type: 'SELL_STOCK', p: 0, sym: 'BEAR', n: 1 });
  assert.equal(g.phase, 'postRoll');
  assert.equal(g.players[0].cash, 70 - 50);

  // Every raising action pays automatically, so PAY_DEBT is for a state where the
  // cash is already there (for example a debt restored from a host snapshot).
  g = act(setCash(indebted(), 0, 50), { type: 'PAY_DEBT', p: 0 });
  assert.equal(g.phase, 'postRoll');
  assert.equal(g.players[0].cash, 0);
  assert.equal(g.players[1].cash, 1550);
});

test('debt TIMEOUT raises cash automatically or declares bankruptcy', () => {
  let g = act(indebted(), { type: 'TIMEOUT', force: true });
  assert.equal(g.phase, 'postRoll');
  assert.equal(g.players[1].cash, 1550);
  assert.ok(logKeys(g).includes('log.autoRaise'));

  g = edit(indebted(3), (c) => {
    for (const id of [1, 3, 5]) Object.assign(c.props[id], { owner: null, houses: 0 });
  });
  g = act(g, { type: 'TIMEOUT', force: true });
  assert.equal(g.players[0].bankrupt, true);
  assert.equal(g.players[1].cash, 1510);
  assert.equal(g.current, 1);
  assert.equal(g.phase, 'preRoll');
});

test('DECLARE_BANKRUPTCY to a player hands over everything', () => {
  let g = edit(indebted(3), (c) => {
    c.players[0].stocks = { CHIP: { n: 1, cost: 120 } };
    c.players[0].jailCards = ['fate'];
    c.decks.fate = c.decks.fate.filter((id) => id !== JAIL_CARD_ID.fate);
    c.props[5].mortgaged = true;
  });
  g = act(g, { type: 'DECLARE_BANKRUPTCY', p: 0 });
  const p0 = g.players[0];
  assert.equal(p0.bankrupt, true);
  assert.equal(p0.cash, 0);
  assert.deepEqual(p0.stocks, {});
  assert.deepEqual(p0.jailCards, []);
  // $10 cash + 2 houses at $25 + 1 CHIP share at $120.
  assert.equal(g.players[1].cash, 1500 + 10 + 50 + 120);
  assert.deepEqual(g.players[1].jailCards, ['fate']);
  assert.deepEqual([1, 3, 5].map((id) => g.props[id]), [
    { owner: 1, houses: 0, mortgaged: false },
    { owner: 1, houses: 0, mortgaged: false },
    { owner: 1, houses: 0, mortgaged: true },
  ]);
  assert.equal(g.debt, null);
  assert.deepEqual(g.bankruptOrder, [0]);
  assert.deepEqual(lastLog(g, 'log.bankruptTo').params, { p: 0, q: 1 });
  assert.equal(g.current, 1);
  assert.equal(g.phase, 'preRoll');
});

test('DECLARE_BANKRUPTCY to the bank returns squares and jail cards', () => {
  let g = edit(own(newGame(3), 0, [1, 3], { houses: 2 }), (c) => {
    c.players[0].cash = 10;
    c.players[0].jailCards = ['chance'];
    c.decks.chance = c.decks.chance.filter((id) => id !== JAIL_CARD_ID.chance);
    c.props[5] = { owner: 0, houses: 0, mortgaged: true };
  });
  g = landOn(g, 38);
  assert.deepEqual(g.debt.creditors, [{ p: BANK, amount: 100 }]);
  assert.deepEqual(g.debt.why, { key: 'why.tax', params: { sq: 38 } });
  g = act(g, { type: 'DECLARE_BANKRUPTCY', p: 0 });
  for (const id of [1, 3, 5]) assert.deepEqual(g.props[id], { owner: null, houses: 0, mortgaged: false });
  assert.equal(g.decks.chance.at(-1), JAIL_CARD_ID.chance);
  assert.equal(g.decks.chance.length, DECKS.chance.length);
  assert.equal(g.players[1].cash + g.players[2].cash, 3000);
  assert.deepEqual(lastLog(g, 'log.bankruptBank').params, { p: 0, q: null });
});

test('bankruptcy to several players splits the cash by the amounts owed', () => {
  let g = edit(newGame(3), (c) => {
    c.players[0].cash = 11;
    c.decks.chance = ['c14', ...c.decks.chance.filter((id) => id !== 'c14')];
  });
  g = landOn(g, 7);
  assert.deepEqual(g.debt.creditors, [{ p: 1, amount: 50 }, { p: 2, amount: 50 }]);
  g = act(g, { type: 'DECLARE_BANKRUPTCY', p: 0 });
  assert.deepEqual(g.players.map((pl) => pl.cash), [0, 1505, 1505]);
  assert.ok(logKeys(g).includes('log.bankruptBank'));
});

test('the last bankruptcy ends the game', () => {
  const g = act(indebted(2), { type: 'DECLARE_BANKRUPTCY', p: 0 });
  assert.equal(g.phase, 'gameOver');
  assert.equal(g.winner, 1);
  assert.deepEqual(g.ranking.map((r) => r.p), [1, 0]);
  assert.equal(g.deadline, null);
});

// ---------- resign ----------

test('RESIGN on your own turn returns everything to the bank and passes the turn', () => {
  let g = own(newGame(3), 0, [1, 3], { houses: 1 });
  g = act(g, { type: 'RESIGN', p: 0 });
  assert.equal(g.players[0].bankrupt, true);
  assert.deepEqual(g.props[1], { owner: null, houses: 0, mortgaged: false });
  assert.equal(g.current, 1);
  assert.equal(g.phase, 'preRoll');
  assert.deepEqual(logKeys(g).slice(-2), ['log.resign', 'log.bankruptBank']);
  assert.equal(actErr(g, { type: 'ROLL', p: 0 }).key, 'err.bankrupt');
  assert.equal(actErr(g, { type: 'RESIGN', p: 0 }).key, 'err.bankrupt');

  // While deciding to buy: the pending square is dropped and no auction runs.
  g = act(landOn(newGame(3), 39), { type: 'RESIGN', p: 0 });
  assert.equal(g.pendingBuy, null);
  assert.equal(g.props[39].owner, null);
  assert.equal(g.current, 1);
  assert.equal(g.phase, 'preRoll');
});

test('RESIGN by another player keeps the current turn', () => {
  const g = act(newGame(3), { type: 'RESIGN', p: 2 });
  assert.equal(g.players[2].bankrupt, true);
  assert.equal(g.current, 0);
  assert.equal(g.phase, 'preRoll');
  const two = act(newGame(2), { type: 'RESIGN', p: 1 });
  assert.equal(two.phase, 'gameOver');
  assert.equal(two.winner, 0);
});

test('RESIGN during an auction', () => {
  let g = act(landOn(newGame(4), 39), { type: 'DECLINE', p: 0 });
  g = act(g, { type: 'BID', p: 2, amount: 100 });
  // The high bidder leaves: the bid is reset.
  let r = act(g, { type: 'RESIGN', p: 2 });
  assert.deepEqual(r.auction, { sq: 39, bid: 0, bidder: null, active: [0, 1, 3] });
  assert.equal(r.phase, 'auction');
  assert.equal(act(r, { type: 'BID', p: 1, amount: 10 }).auction.bidder, 1);
  // Another bidder leaves: the high bid stands.
  r = act(g, { type: 'RESIGN', p: 3 });
  assert.deepEqual(r.auction, { sq: 39, bid: 100, bidder: 2, active: [0, 1, 2] });
  // The current player leaves: the auction finishes, then the turn passes.
  r = act(g, { type: 'RESIGN', p: 0 });
  assert.equal(r.phase, 'auction');
  assert.deepEqual(r.auction.active, [1, 2, 3]);
  r = act(r, { type: 'PASS_BID', p: 1 });
  r = act(r, { type: 'PASS_BID', p: 3 });
  assert.equal(r.props[39].owner, 2);
  assert.equal(r.current, 1);
  assert.equal(r.phase, 'preRoll');
  // Everyone but the high bidder leaves: the high bidder wins.
  r = act(act(act(g, { type: 'RESIGN', p: 1 }), { type: 'RESIGN', p: 3 }), { type: 'PASS_BID', p: 0 });
  assert.equal(r.props[39].owner, 2);
  assert.equal(r.phase, 'postRoll');
});

test('RESIGN during a trade closes the trade', () => {
  const g = act(trader(3), T(1, { cash: 100 }, { props: [6] }));
  let r = act(g, { type: 'RESIGN', p: 1 });
  assert.equal(r.trade, null);
  assert.equal(r.phase, 'postRoll');
  assert.equal(r.current, 0);
  assert.equal(r.props[6].owner, null);
  assert.ok(logKeys(r).includes('log.tradeCancel'));
  r = act(g, { type: 'RESIGN', p: 0 });
  assert.equal(r.trade, null);
  assert.equal(r.current, 1);
  assert.equal(r.phase, 'preRoll');
  // A third player leaving does not touch the trade.
  r = act(g, { type: 'RESIGN', p: 2 });
  assert.equal(r.phase, 'trade');
  assert.deepEqual(r.trade, g.trade);
});

test('RESIGN while in debt pays the creditors; a resigning creditor is replaced by the bank', () => {
  let g = act(indebted(3), { type: 'RESIGN', p: 0 });
  assert.equal(g.players[0].bankrupt, true);
  assert.equal(g.props[1].owner, 1, 'the single creditor receives the assets');
  assert.equal(g.debt, null);
  assert.equal(g.current, 1);

  g = act(indebted(3), { type: 'RESIGN', p: 1 });
  assert.deepEqual(g.debt.creditors, [{ p: BANK, amount: 50 }]);
  assert.equal(g.phase, 'debt');
  assert.equal(g.props[39].owner, null);
  g = act(g, { type: 'MORTGAGE', p: 0, sq: 5 });
  assert.equal(g.phase, 'postRoll');
  assert.equal(g.players[0].cash, 10 + 100 - 50);
});
