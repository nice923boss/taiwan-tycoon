// Core turn flow: setup, dice, movement, buying, auctions, rent, jail, rounds, game end.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTION_TYPES, STATE_VERSION, actorOf, applyAction, createGame, rehydrate, sanitize,
} from '../js/engine/game.js';
import { OWNABLE_IDS, STATION_RENT } from '../js/engine/board.js';
import { DECKS } from '../js/engine/cards.js';
import { RULES, netWorth, rentFor, rentPercent } from '../js/engine/rules.js';
import { STOCKS, dividendFor } from '../js/engine/stocks.js';
import { JAIL_CARD_ID } from '../js/engine/turn.js';
import {
  act, actErr, edit, landOn, lastLog, logKeys, makePlayers, newGame, own, rollDice, withDice,
} from './helpers.js';

// ---------- createGame ----------

test('createGame validates player count and maxRounds', () => {
  assert.throws(() => createGame({ players: makePlayers(1), seed: 1, now: 0 }), /2-6 players/);
  assert.throws(() => createGame({ players: makePlayers(7), seed: 1, now: 0 }), /2-6 players/);
  assert.throws(() => createGame({ players: null, seed: 1, now: 0 }), /2-6 players/);
  assert.throws(() => createGame({ players: makePlayers(2), seed: 1, now: 0, maxRounds: 20 }), /bad maxRounds/);
  for (const maxRounds of RULES.roundOptions) {
    assert.equal(createGame({ players: makePlayers(2), seed: 1, now: 0, maxRounds }).maxRounds, maxRounds);
  }
  assert.equal(createGame({ players: makePlayers(6), seed: 1, now: 0 }).maxRounds, RULES.defaultRounds);
});

test('createGame builds the initial state', () => {
  const g = newGame(4, { seed: 42, now: 1000, maxRounds: 25 });
  assert.equal(g.v, STATE_VERSION);
  assert.equal(g.phase, 'preRoll');
  assert.equal(g.round, 1);
  assert.equal(g.current, 0);
  assert.equal(g.deadline, 1000 + RULES.phaseMs.preRoll);
  assert.deepEqual(Object.keys(g.props).map(Number).sort((a, b) => a - b), OWNABLE_IDS);
  for (const id of OWNABLE_IDS) assert.deepEqual(g.props[id], { owner: null, houses: 0, mortgaged: false });
  g.players.forEach((pl, i) => {
    assert.equal(pl.cash, RULES.startCash);
    assert.equal(pl.pos, 0);
    assert.equal(pl.color, g.players[i].color);
    assert.deepEqual(pl.stocks, {});
    assert.deepEqual(pl.jailCards, []);
  });
  assert.equal(new Set(g.players.map((pl) => pl.color)).size, 4);
  for (const [deck, cards] of Object.entries(DECKS)) {
    assert.deepEqual([...g.decks[deck]].sort(), cards.map((c) => c.id).sort());
  }
  assert.deepEqual(g.log[0], { n: 1, key: 'log.start', params: { rounds: 25 } });
  assert.deepEqual(actorOf(g), [0]);
});

test('turn order is shuffled deterministically by seed', () => {
  const order = (seed) => newGame(6, { seed }).players.map((pl) => pl.id).join(',');
  for (let seed = 1; seed <= 20; seed += 1) {
    assert.equal(order(seed), order(seed));
    assert.deepEqual(order(seed).split(',').sort(), makePlayers(6).map((p) => p.id).sort());
  }
  const distinct = new Set(Array.from({ length: 20 }, (_, i) => order(i + 1)));
  assert.ok(distinct.size > 10, 'different seeds should give different orders');
  // Same seed gives the same dice too.
  const a = act(newGame(3, { seed: 9 }), { type: 'ROLL', p: 0 });
  const b = act(newGame(3, { seed: 9 }), { type: 'ROLL', p: 0 });
  assert.deepEqual(a, b);
});

// ---------- dice & movement ----------

test('ROLL moves the current player and logs the dice', () => {
  const g = rollDice(newGame(2), 1, 2, 500);
  assert.deepEqual(g.dice, [1, 2]);
  assert.equal(g.players[0].pos, 3);
  assert.equal(g.phase, 'buy');
  assert.equal(g.pendingBuy, 3);
  assert.deepEqual(lastLog(g, 'log.dice').params, { p: 0, d1: 1, d2: 2, sum: 3 });
  assert.deepEqual(lastLog(g, 'log.canBuy').params, { p: 0, sq: 3, amt: 60 });
  assert.ok(g.events.some((e) => e.kind === 'dice' && e.dice[0] === 1 && e.dice[1] === 2));
  assert.ok(g.events.some((e) => e.kind === 'move' && e.from === 0 && e.to === 3));
  assert.equal(g.deadline, 500 + RULES.phaseMs.buy);
});

test('doubles grant an extra roll; non-doubles end in postRoll', () => {
  let g = rollDice(newGame(2), 2, 2);
  assert.equal(g.players[0].pos, 4);
  assert.equal(g.phase, 'preRoll');
  assert.equal(g.extraRoll, true);
  assert.equal(g.doublesCount, 1);
  assert.ok(logKeys(g).includes('log.diceDouble'));
  assert.deepEqual(lastLog(g, 'log.extraRoll').params, { p: 0 });
  g = rollDice(g, 2, 3);
  assert.equal(g.players[0].pos, 9);
  assert.equal(g.phase, 'buy');
  assert.equal(g.extraRoll, false);
});

test('three doubles in a row send the player to jail without moving', () => {
  let g = own(newGame(2), 0, [12]);
  g = rollDice(g, 2, 2); // tax square 4
  g = rollDice(g, 4, 4); // own utility 12
  assert.equal(g.players[0].pos, 12);
  assert.equal(g.phase, 'preRoll');
  g = rollDice(g, 1, 1);
  assert.equal(g.players[0].pos, 10);
  assert.equal(g.players[0].inJail, true);
  assert.equal(g.phase, 'postRoll');
  assert.equal(g.extraRoll, false);
  assert.ok(logKeys(g).includes('log.speeding'));
  assert.ok(logKeys(g).includes('log.jailed'));
});

test('passing or landing on GO pays the salary', () => {
  let g = edit(newGame(2), (c) => {
    c.players[0].pos = 38;
  });
  g = rollDice(g, 1, 2);
  assert.equal(g.players[0].pos, 1);
  assert.equal(g.players[0].cash, 1500 + RULES.goSalary);
  assert.deepEqual(lastLog(g, 'log.passGo').params, { p: 0, amt: 200 });
  g = landOn(newGame(2), 0);
  assert.equal(g.players[0].cash, 1500 + RULES.goSalary);
  assert.equal(g.phase, 'postRoll');
});

// ---------- buying & auctions ----------

test('BUY pays the price and takes ownership', () => {
  const g = act(landOn(newGame(2), 39), { type: 'BUY', p: 0 });
  assert.equal(g.props[39].owner, 0);
  assert.equal(g.players[0].cash, 1100);
  assert.equal(g.pendingBuy, null);
  assert.equal(g.phase, 'postRoll');
  assert.deepEqual(lastLog(g, 'log.buy').params, { p: 0, sq: 39, amt: 400 });
  const poor = edit(landOn(newGame(2), 39), (c) => {
    c.players[0].cash = 399;
  });
  assert.equal(actErr(poor, { type: 'BUY', p: 0 }).key, 'err.notEnoughCash');
});

test('DECLINE starts an auction for every alive player', () => {
  const g = act(landOn(newGame(3), 6), { type: 'DECLINE', p: 0 }, 100);
  assert.equal(g.phase, 'auction');
  assert.equal(g.pendingBuy, null);
  assert.deepEqual(g.auction, { sq: 6, bid: 0, bidder: null, active: [0, 1, 2] });
  assert.deepEqual(actorOf(g), [0, 1, 2]);
  assert.equal(g.deadline, 100 + RULES.phaseMs.auction);
  assert.deepEqual(lastLog(g, 'log.auctionStart').params, { sq: 6 });
});

test('auction bidding, passing and resolution', () => {
  let g = act(landOn(newGame(3), 6), { type: 'DECLINE', p: 0 });
  assert.deepEqual(actErr(g, { type: 'BID', p: 1, amount: 5 }), { key: 'err.bidTooLow', params: { amt: 10 } });
  assert.equal(actErr(g, { type: 'BID', p: 1, amount: 10.5 }).key, 'err.bidTooLow');
  assert.equal(actErr(g, { type: 'BID', p: 1, amount: 1501 }).key, 'err.notEnoughCash');
  g = act(g, { type: 'BID', p: 1, amount: 10 }, 5000);
  assert.equal(g.deadline, 5000 + RULES.phaseMs.auction, 'a bid restarts the countdown');
  assert.deepEqual(actErr(g, { type: 'BID', p: 2, amount: 15 }), { key: 'err.bidTooLow', params: { amt: 20 } });
  g = act(g, { type: 'BID', p: 2, amount: 40 });
  assert.equal(actErr(g, { type: 'BID', p: 2, amount: 60 }).key, 'err.alreadyTopBid', 'the high bidder cannot outbid themselves');
  g = act(g, { type: 'PASS_BID', p: 0 });
  assert.equal(actErr(g, { type: 'BID', p: 0, amount: 100 }).key, 'err.notInAuction');
  assert.equal(actErr(g, { type: 'PASS_BID', p: 0 }).key, 'err.notInAuction');
  g = act(g, { type: 'PASS_BID', p: 1 });
  assert.equal(g.auction, null);
  assert.equal(g.props[6].owner, 2);
  assert.equal(g.players[2].cash, 1460);
  assert.equal(g.phase, 'postRoll');
  assert.equal(g.current, 0);
  assert.deepEqual(lastLog(g, 'log.auctionWon').params, { p: 2, sq: 6, amt: 40 });
});

test('auction with no bids ends without a sale', () => {
  let g = act(landOn(newGame(2), 6), { type: 'DECLINE', p: 0 });
  g = act(g, { type: 'PASS_BID', p: 0 });
  g = act(g, { type: 'PASS_BID', p: 1 });
  assert.equal(g.props[6].owner, null);
  assert.equal(g.phase, 'postRoll');
  assert.deepEqual(lastLog(g, 'log.auctionNoSale').params, { sq: 6 });
});

test('auction after a doubles roll returns to preRoll for the extra roll', () => {
  let g = act(landOn(newGame(2), 6, 3, 3), { type: 'DECLINE', p: 0 });
  g = act(g, { type: 'BID', p: 1, amount: 10 });
  g = act(g, { type: 'PASS_BID', p: 0 });
  assert.equal(g.props[6].owner, 1);
  assert.equal(g.phase, 'preRoll');
  assert.equal(g.current, 0);
});

test('auction winner whose cash dropped sells stock to pay', () => {
  let g = act(landOn(newGame(2), 39), { type: 'DECLINE', p: 0 });
  g = act(g, { type: 'BID', p: 1, amount: 1000 });
  g = act(g, { type: 'BUY_STOCK', p: 1, sym: 'CHIP', n: 10 });
  assert.equal(g.players[1].cash, 300);
  g = act(g, { type: 'PASS_BID', p: 0 });
  assert.equal(g.props[39].owner, 1);
  assert.ok(g.players[1].cash >= 0);
  assert.ok(logKeys(g).includes('log.autoRaise'));
});

test('TIMEOUT in an auction sells to the high bidder', () => {
  let g = act(landOn(newGame(3), 6), { type: 'DECLINE', p: 0 }, 0);
  g = act(g, { type: 'BID', p: 2, amount: 30 }, 1000);
  assert.equal(actErr(g, { type: 'TIMEOUT' }, 1000 + RULES.phaseMs.auction - 1).key, 'err.notYet');
  g = act(g, { type: 'TIMEOUT' }, 1000 + RULES.phaseMs.auction);
  assert.equal(g.props[6].owner, 2);
  assert.equal(g.phase, 'postRoll');
});

// ---------- rent, tax ----------

test('rent: base, full group double, houses, mortgaged', () => {
  let g = landOn(own(newGame(2), 1, [3]), 3);
  assert.equal(g.players[1].cash, 1504);
  assert.equal(g.players[0].cash, 1496);
  assert.deepEqual(lastLog(g, 'log.payRent').params, { p: 0, q: 1, sq: 3, amt: 4 });
  g = landOn(own(newGame(2), 1, [1, 3]), 3);
  assert.equal(g.players[1].cash, 1508, 'full group doubles the base rent');
  g = landOn(own(own(newGame(2), 1, [1, 3]), 1, [3], { houses: 3 }), 3);
  assert.equal(g.players[1].cash, 1500 + 180);
  g = landOn(own(newGame(2), 1, [3], { mortgaged: true }), 3);
  assert.equal(g.players[1].cash, 1500);
  assert.deepEqual(lastLog(g, 'log.mortgagedNoRent').params, { p: 0, sq: 3 });
  g = landOn(own(newGame(2), 0, [3]), 3);
  assert.equal(g.players[0].cash, 1500, 'no rent on your own square');
  assert.equal(g.phase, 'postRoll');
});

test('rent: stations scale with the number owned', () => {
  const stations = [5, 15, 25, 35];
  for (let n = 1; n <= 4; n += 1) {
    const g = landOn(own(newGame(2), 1, stations.slice(0, n).reverse()), stations[n - 1]);
    assert.equal(g.players[1].cash, 1500 + STATION_RENT[n - 1]);
  }
});

test('rent: utilities pay 4x or 10x the dice', () => {
  let g = landOn(own(newGame(2), 1, [12]), 12, 2, 3);
  assert.equal(g.players[1].cash, 1500 + 4 * 5);
  g = landOn(own(newGame(2), 1, [12, 28]), 28, 2, 3);
  assert.equal(g.players[1].cash, 1500 + 10 * 5);
  assert.equal(rentFor(own(newGame(2), 1, [12]), 12, 7, { utilityMult: 10 }), 70);
  assert.equal(rentFor(newGame(2), 12, 7), 0);
});

test('rent rises 20% per round after round 20, in every game', () => {
  assert.deepEqual([1, 20, 21, 25, 30].map(rentPercent), [100, 100, 120, 200, 300]);
  const at = (round, g) => edit(g, (c) => {
    c.round = round;
  });
  let g = landOn(at(25, own(newGame(2, { maxRounds: 40 }), 1, [3])), 3);
  assert.equal(g.players[1].cash, 1500 + 8);
  assert.deepEqual(lastLog(g, 'log.payRent').params, { p: 0, q: 1, sq: 3, amt: 8 });
  g = landOn(at(21, own(newGame(2, { maxRounds: 40 }), 1, [5])), 5);
  assert.equal(g.players[1].cash, 1500 + Math.round((STATION_RENT[0] * 120) / 100));
  g = landOn(at(25, own(newGame(2, { maxRounds: 40 }), 1, [12])), 12, 2, 3);
  assert.equal(g.players[1].cash, 1500 + 2 * 4 * 5);
});

test('round close logs the rent rise once past round 20', () => {
  const close = (round) => {
    let g = edit(newGame(2, { maxRounds: 40 }), (c) => {
      c.round = round;
    });
    for (let p = 0; p < 2; p += 1) g = act(landOn(g, 0), { type: 'END_TURN', p });
    return g;
  };
  assert.equal(lastLog(close(19), 'log.rentRise'), undefined);
  const g = close(20);
  assert.equal(g.round, 21);
  assert.deepEqual(lastLog(g, 'log.rentRise').params, { round: 21, x: 1.2 });
});

test('tax squares pay the bank', () => {
  let g = landOn(newGame(2), 4);
  assert.equal(g.players[0].cash, 1300);
  assert.deepEqual(lastLog(g, 'log.payTax').params, { p: 0, sq: 4, amt: 200 });
  g = landOn(newGame(2), 38);
  assert.equal(g.players[0].cash, 1400);
  assert.equal(g.players[1].cash, 1500);
});

test('unaffordable rent opens a debt', () => {
  const g = landOn(edit(own(newGame(2), 1, [39], { houses: 0 }), (c) => {
    c.players[0].cash = 10;
  }), 39);
  assert.equal(g.phase, 'debt');
  assert.deepEqual(g.debt.creditors, [{ p: 1, amount: 50 }]);
  assert.deepEqual(g.debt.why, { key: 'why.rent', params: { sq: 39 } });
  assert.equal(g.players[0].cash, 10);
  assert.deepEqual(actorOf(g), [0]);
});

// ---------- jail ----------

const jailed = (g, p = 0, extra = {}) => edit(g, (c) => {
  Object.assign(c.players[p], { pos: 10, inJail: true, jailTurns: 0, ...extra });
});

test('landing on Go To Jail', () => {
  const g = landOn(newGame(2), 30);
  assert.equal(g.players[0].pos, 10);
  assert.equal(g.players[0].inJail, true);
  assert.equal(g.phase, 'postRoll');
});

test('PAY_BAIL frees the player before rolling', () => {
  let g = jailed(newGame(2));
  assert.equal(actErr(newGame(2), { type: 'PAY_BAIL', p: 0 }).key, 'err.notInJail');
  assert.equal(actErr(edit(g, (c) => { c.players[0].cash = 49; }), { type: 'PAY_BAIL', p: 0 }).key, 'err.notEnoughCash');
  g = act(g, { type: 'PAY_BAIL', p: 0 });
  assert.equal(g.players[0].inJail, false);
  assert.equal(g.players[0].cash, 1450);
  assert.equal(g.phase, 'preRoll');
  g = rollDice(g, 1, 2);
  assert.equal(g.players[0].pos, 13);
});

test('USE_JAIL_CARD returns the card to the bottom of its deck', () => {
  let g = jailed(edit(newGame(2), (c) => {
    c.players[0].jailCards = ['fate'];
    c.decks.fate = c.decks.fate.filter((id) => id !== JAIL_CARD_ID.fate);
  }));
  assert.equal(actErr(jailed(newGame(2)), { type: 'USE_JAIL_CARD', p: 0 }).key, 'err.noJailCard');
  assert.equal(actErr(newGame(2), { type: 'USE_JAIL_CARD', p: 0 }).key, 'err.notInJail');
  g = act(g, { type: 'USE_JAIL_CARD', p: 0 });
  assert.equal(g.players[0].inJail, false);
  assert.deepEqual(g.players[0].jailCards, []);
  assert.equal(g.decks.fate.at(-1), JAIL_CARD_ID.fate);
  assert.equal(g.decks.fate.length, DECKS.fate.length);
});

test('rolling in jail: stay, doubles out without extra roll, forced bail on the third miss', () => {
  let g = rollDice(jailed(newGame(2)), 1, 2);
  assert.equal(g.players[0].pos, 10);
  assert.equal(g.players[0].jailTurns, 1);
  assert.equal(g.phase, 'postRoll');
  assert.deepEqual(lastLog(g, 'log.jailStay').params, { p: 0, n: 1 });

  g = rollDice(jailed(newGame(2)), 3, 3);
  assert.equal(g.players[0].inJail, false);
  assert.equal(g.players[0].pos, 16);
  assert.equal(g.extraRoll, false);
  assert.ok(logKeys(g).includes('log.jailDoubleOut'));
  assert.notEqual(g.phase, 'preRoll');

  g = rollDice(jailed(newGame(2), 0, { jailTurns: 2 }), 1, 2);
  assert.equal(g.players[0].inJail, false);
  assert.equal(g.players[0].pos, 13);
  assert.equal(g.players[0].cash, 1500 - RULES.jailFine);
  assert.deepEqual(lastLog(g, 'log.bailForced').params, { p: 0, amt: 50 });
  assert.equal(g.phase, 'buy');
});

test('forced bail without cash opens a debt that moves the player once paid', () => {
  let g = jailed(edit(newGame(2), (c) => {
    c.players[0].cash = 20;
    c.players[0].stocks = { BEAR: { n: 10, cost: 300 } };
  }), 0, { jailTurns: 2 });
  g = rollDice(g, 1, 2);
  assert.equal(g.phase, 'debt');
  assert.deepEqual(g.debt.then, { kind: 'jailMove', p: 0, steps: 3 });
  assert.equal(g.players[0].pos, 10);
  g = act(g, { type: 'SELL_STOCK', p: 0, sym: 'BEAR', n: 10 });
  assert.equal(g.debt, null);
  assert.equal(g.players[0].inJail, false);
  assert.equal(g.players[0].pos, 13);
  assert.equal(g.players[0].cash, 20 + 300 - 50);
  assert.equal(g.phase, 'buy');
});

// ---------- cards ----------

const withTopCard = (g, deck, id) => edit(g, (c) => {
  c.decks[deck] = [id, ...c.decks[deck].filter((x) => x !== id)];
});

test('cards: move to GO, nearest station (double rent), back three squares', () => {
  let g = landOn(withTopCard(newGame(2), 'chance', 'c01'), 7);
  assert.equal(g.players[0].pos, 0);
  assert.equal(g.players[0].cash, 1700);
  assert.equal(g.decks.chance.at(-1), 'c01', 'used card goes to the bottom');
  assert.deepEqual(lastLog(g, 'log.drawCard').params, { p: 0, deck: 'chance', card: 'c01' });

  g = landOn(withTopCard(own(newGame(2), 1, [15]), 'chance', 'c04'), 7);
  assert.equal(g.players[0].pos, 15);
  assert.equal(g.players[1].cash, 1500 + 2 * STATION_RENT[0]);

  g = landOn(withTopCard(own(newGame(2), 1, [12]), 'chance', 'c06'), 7, 3, 4);
  assert.equal(g.players[0].pos, 12);
  assert.equal(g.players[1].cash, 1500 + 10 * 7);

  g = landOn(withTopCard(newGame(2), 'chance', 'c09'), 7);
  assert.equal(g.players[0].pos, 4);
  assert.equal(g.players[0].cash, 1300, 'moved back onto income tax');
});

test('cards: jail-free card leaves the deck, go to jail, repairs', () => {
  let g = landOn(withTopCard(newGame(2), 'chance', 'c08'), 7);
  assert.deepEqual(g.players[0].jailCards, ['chance']);
  assert.ok(!g.decks.chance.includes('c08'));
  assert.equal(g.decks.chance.length, DECKS.chance.length - 1);

  g = landOn(withTopCard(newGame(2), 'fate', 'f06'), 2);
  assert.equal(g.players[0].inJail, true);
  assert.equal(g.players[0].pos, 10);

  g = own(own(newGame(2), 0, [1, 3], { houses: 2 }), 0, [39, 37], { houses: 5 });
  g = landOn(withTopCard(g, 'chance', 'c11'), 7);
  assert.deepEqual(lastLog(g, 'log.repairs').params, { p: 0, houses: 4, hotels: 2, amt: 4 * 25 + 2 * 100 });
  assert.equal(g.players[0].cash, 1500 - 300);
});

test('cards: pay each player and collect from each player', () => {
  let g = landOn(withTopCard(newGame(3), 'chance', 'c14'), 7);
  assert.deepEqual(g.players.map((pl) => pl.cash), [1400, 1550, 1550]);

  g = edit(newGame(3), (c) => {
    c.players[2].cash = 4;
    c.props[13].owner = 2;
  });
  g = landOn(withTopCard(g, 'fate', 'f07'), 17);
  assert.equal(g.players[0].cash, 1520);
  assert.equal(g.players[1].cash, 1490);
  assert.equal(g.players[2].cash, 4 + 70 - 10, 'poor payer mortgages to pay');
  assert.equal(g.props[13].mortgaged, true);

  g = edit(newGame(3), (c) => {
    c.players[2].cash = 4;
  });
  g = landOn(withTopCard(g, 'fate', 'f07'), 17);
  assert.equal(g.players[2].bankrupt, true);
  assert.equal(g.players[0].cash, 1500 + 10 + 4);
  assert.deepEqual(g.bankruptOrder, [2]);
  assert.equal(g.phase, 'postRoll');

  g = edit(newGame(2), (c) => {
    c.players[1].cash = 0;
  });
  g = landOn(withTopCard(g, 'fate', 'f07'), 17);
  assert.equal(g.phase, 'gameOver');
  assert.equal(g.winner, 0);
});

test('cards: stock shock, stock gift, market shock, collect and pay', () => {
  let g = landOn(withTopCard(newGame(2), 'chance', 'c16'), 7);
  assert.equal(g.market.stocks.CHIP.price, 132);
  assert.equal(g.market.stocks.CHIP.hi, 132);
  g = landOn(withTopCard(newGame(2), 'chance', 'c17'), 7);
  assert.deepEqual(g.players[0].stocks, { BEAR: { n: 20, cost: 0 } });
  g = landOn(withTopCard(newGame(2), 'fate', 'f18'), 17);
  for (const s of STOCKS) assert.equal(g.market.stocks[s.sym].lo, Math.round(s.base * 92) / 100);
  g = landOn(withTopCard(newGame(2), 'fate', 'f02'), 17);
  assert.equal(g.players[0].cash, 1700);
  g = landOn(withTopCard(newGame(2), 'fate', 'f10'), 17);
  assert.equal(g.players[0].cash, 1400);
  g = landOn(withTopCard(edit(newGame(2), (c) => { c.players[0].cash = 10; }), 'fate', 'f10'), 17);
  assert.equal(g.phase, 'debt');
  assert.deepEqual(g.debt.why, { key: 'why.card' });
});

// ---------- turns, rounds, game end ----------

test('END_TURN advances to the next alive seat', () => {
  let g = landOn(newGame(3), 0);
  assert.equal(actErr(g, { type: 'END_TURN', p: 1 }).key, 'err.notNow');
  g = act(g, { type: 'END_TURN', p: 0 }, 7777);
  assert.equal(g.current, 1);
  assert.equal(g.phase, 'preRoll');
  assert.equal(g.dice, null);
  assert.equal(g.turnStartedAt, 7777);
  assert.equal(g.round, 1);
  assert.ok(g.events.some((e) => e.kind === 'turn' && e.p === 1));

  g = edit(landOn(newGame(3), 0), (c) => {
    c.players[1].bankrupt = true;
  });
  g = act(g, { type: 'END_TURN', p: 0 });
  assert.equal(g.current, 2, 'bankrupt seats are skipped');
});

test('round closes after the last alive seat: market, worthLog, candles', () => {
  let g = newGame(3, { maxRounds: 15 });
  for (let p = 0; p < 3; p += 1) {
    g = act(landOn(g, 0), { type: 'END_TURN', p });
  }
  assert.equal(g.round, 2);
  assert.equal(g.current, 0);
  assert.equal(g.worthLog.length, 1);
  assert.equal(g.worthLog[0].r, 1);
  assert.deepEqual(g.worthLog[0].w, [0, 1, 2].map((i) => netWorth(g, i)));
  for (const s of STOCKS) {
    const h = g.market.stocks[s.sym].history;
    assert.equal(h.length, 2);
    assert.equal(h[1].r, 1);
    assert.equal(h[1].o, s.base);
    assert.equal(h[1].c, g.market.stocks[s.sym].price);
  }
  assert.deepEqual(lastLog(g, 'log.roundClose').params, { round: 1 });
  assert.ok(g.events.some((e) => e.kind === 'close' && e.round === 1));

  // When the last seat is bankrupt, the round closes after the last alive one.
  g = edit(newGame(3), (c) => {
    c.players[2].bankrupt = true;
  });
  g = act(landOn(g, 0), { type: 'END_TURN', p: 0 });
  g = act(landOn(g, 0), { type: 'END_TURN', p: 1 });
  assert.equal(g.round, 2);
  assert.equal(g.worthLog[0].w[2], 0);
});

test('game ends after maxRounds with ranking and winner', () => {
  let g = edit(newGame(4, { maxRounds: 15 }), (c) => {
    c.round = 15;
    c.current = 3;
    c.phase = 'postRoll';
    c.players[1].cash = 3000;
    c.players[2].bankrupt = true;
    c.players[2].cash = 0;
    c.players[0].bankrupt = true;
    c.players[0].cash = 0;
    c.bankruptOrder = [2, 0];
    c.props[39].owner = 3;
  });
  g = act(g, { type: 'END_TURN', p: 3 }, 99);
  assert.equal(g.phase, 'gameOver');
  assert.equal(g.round, 16);
  assert.equal(g.deadline, null);
  assert.equal(g.endedAt, 99);
  assert.deepEqual(g.ranking.map((r) => r.p), [1, 3, 0, 2]);
  assert.equal(g.ranking[0].worth, netWorth(g, 1));
  assert.equal(g.winner, 1);
  assert.deepEqual(lastLog(g, 'log.gameOver').params, { p: 1, amt: g.ranking[0].worth });
  assert.deepEqual(actorOf(g), []);
  for (const type of ACTION_TYPES) assert.equal(actErr(g, { type, p: 1 }).key, 'err.gameOver');
});

test('maxRounds 0 has no round limit', () => {
  let g = newGame(2, { maxRounds: 0 });
  assert.deepEqual(g.log[0], { n: 1, key: 'log.startNoLimit', params: {} });
  g = edit(g, (c) => {
    c.round = 99;
  });
  for (let p = 0; p < 2; p += 1) g = act(landOn(g, 0), { type: 'END_TURN', p });
  assert.equal(g.round, 100);
  assert.equal(g.phase, 'preRoll');
  assert.deepEqual(lastLog(g, 'log.rentRise').params, { round: 100, x: 17 });
});

test('dividends are paid at round close', () => {
  let g = edit(newGame(2), (c) => {
    c.players[1].stocks = { BEAR: { n: 1000, cost: 30000 }, CHIP: { n: 50, cost: 6000 } };
  });
  g = landOn(act(landOn(g, 0), { type: 'END_TURN', p: 0 }), 0);
  const before = g.players[1].cash;
  g = act(g, { type: 'END_TURN', p: 1 });
  const expected = dividendFor(g.market, 'BEAR', 1000) + dividendFor(g.market, 'CHIP', 50);
  assert.ok(expected > 0);
  assert.equal(g.players[1].cash, before + expected);
  assert.deepEqual(lastLog(g, 'log.dividend').params, { p: 1, amt: expected });
});

// ---------- errors & purity ----------

test('wrong player, wrong phase and malformed actions are rejected', () => {
  const g = newGame(3);
  assert.equal(actErr(g, { type: 'ROLL', p: 1 }).key, 'err.notNow');
  assert.equal(actErr(g, { type: 'END_TURN', p: 0 }).key, 'err.notNow');
  assert.equal(actErr(g, { type: 'BUY', p: 0 }).key, 'err.notNow');
  assert.equal(actErr(g, { type: 'DECLINE', p: 0 }).key, 'err.notNow');
  assert.equal(actErr(g, { type: 'BID', p: 0, amount: 10 }).key, 'err.notNow');
  assert.equal(actErr(g, { type: 'PASS_BID', p: 0 }).key, 'err.notNow');
  assert.equal(actErr(g, { type: 'ACCEPT_TRADE', p: 1 }).key, 'err.notNow');
  assert.equal(actErr(g, { type: 'REJECT_TRADE', p: 1 }).key, 'err.notNow');
  assert.equal(actErr(g, { type: 'CANCEL_TRADE', p: 0 }).key, 'err.notNow');
  assert.equal(actErr(g, { type: 'PAY_DEBT', p: 0 }).key, 'err.notNow');
  assert.equal(actErr(g, { type: 'DECLARE_BANKRUPTCY', p: 0 }).key, 'err.notNow');
  assert.equal(actErr(g, { type: 'ROLL', p: 3 }).key, 'err.notAPlayer');
  assert.equal(actErr(g, { type: 'ROLL', p: '0' }).key, 'err.notAPlayer');
  assert.equal(actErr(g, { type: 'ROLL' }).key, 'err.notAPlayer');
  assert.equal(actErr(g, { type: 'HACK', p: 0 }).key, 'err.badRequest');
  assert.equal(actErr(g, null).key, 'err.badRequest');
  assert.equal(actErr(g, 'ROLL').key, 'err.badRequest');
  assert.equal(actErr(edit(g, (c) => { c.players[0].bankrupt = true; }), { type: 'ROLL', p: 0 }).key, 'err.bankrupt');
  assert.equal(actErr(g, { type: 'TIMEOUT' }, g.deadline - 1).key, 'err.notYet');
  assert.deepEqual(ACTION_TYPES.sort(), [
    'ACCEPT_TRADE', 'BID', 'BUILD', 'BUY', 'BUY_STOCK', 'CANCEL_TRADE', 'DECLARE_BANKRUPTCY', 'DECLINE',
    'END_TURN', 'LIQUIDATE', 'MORTGAGE', 'PASS_BID', 'PAY_BAIL', 'PAY_DEBT', 'PROPOSE_TRADE', 'REJECT_TRADE', 'RESIGN',
    'ROLL', 'SELL_BUILDING', 'SELL_STOCK', 'TIMEOUT', 'UNMORTGAGE', 'USE_JAIL_CARD',
  ]);
});

test('applyAction never mutates its input', () => {
  const states = [];
  let g = newGame(3);
  states.push(g);
  g = act(landOn(g, 6), { type: 'DECLINE', p: 0 });
  states.push(g);
  g = act(g, { type: 'BID', p: 1, amount: 50 });
  states.push(g);
  for (const s of states) {
    const snapshot = structuredClone(s);
    for (const action of [
      { type: 'ROLL', p: 0 }, { type: 'BID', p: 2, amount: 60 }, { type: 'PASS_BID', p: 1 },
      { type: 'RESIGN', p: 1 }, { type: 'TIMEOUT', force: true }, { type: 'BUY_STOCK', p: 2, sym: 'CHIP', n: 1 },
    ]) {
      const res = applyAction(s, action, { now: 1 });
      assert.deepEqual(s, snapshot, `mutated by ${action.type}`);
      if (res.error) assert.equal(res.game, s);
      else assert.notEqual(res.game, s);
    }
  }
});

test('TIMEOUT applies the safe default of each phase', () => {
  // preRoll -> roll
  let g = act(withDice(newGame(2), 1, 2), { type: 'TIMEOUT' }, RULES.phaseMs.preRoll);
  assert.equal(g.players[0].pos, 3);
  assert.deepEqual(lastLog(g, 'log.timeout').params, { p: 0 });
  // buy -> auction
  g = act(g, { type: 'TIMEOUT', force: true });
  assert.equal(g.phase, 'auction');
  // auction -> resolve (no bids)
  g = act(g, { type: 'TIMEOUT', force: true });
  assert.equal(g.phase, 'postRoll');
  // postRoll -> next turn
  g = act(g, { type: 'TIMEOUT', force: true });
  assert.equal(g.current, 1);
  assert.equal(g.phase, 'preRoll');
});

test('turn cap limits preRoll/postRoll deadlines', () => {
  let g = newGame(2, { now: 0 });
  g = act(g, { type: 'BUY_STOCK', p: 1, sym: 'CHIP', n: 1 }, 170000);
  g = act(landOn(g, 0, 1, 2, 170000), { type: 'BUY_STOCK', p: 0, sym: 'CHIP', n: 1 }, 170000);
  assert.equal(g.phase, 'postRoll');
  assert.equal(g.deadline, RULES.turnCapMs);
  g = landOn(edit(newGame(2), (c) => { c.turnStartedAt = -1000000; }), 0, 1, 2, 10);
  assert.equal(g.deadline, 10 + 5000);
});

// ---------- sanitize / rehydrate ----------

test('sanitize hides rng, seed and decks; rehydrate rebuilds them', () => {
  let g = landOn(withTopCard(newGame(3, { seed: 77 }), 'chance', 'c08'), 7);
  const pub = sanitize(g);
  assert.deepEqual(Object.keys(JSON.parse(JSON.stringify(pub))).filter((k) => ['rng', 'seed', 'decks'].includes(k)), []);
  assert.equal(pub.players, g.players);
  const back = rehydrate(pub, 1234);
  assert.equal(back.seed, 1234);
  assert.deepEqual(rehydrate(pub, 1234), back, 'rehydrate is deterministic for a seed');
  assert.notDeepEqual(rehydrate(pub, 1235).decks, back.decks);
  assert.ok(!back.decks.chance.includes('c08'), 'held jail card is not put back');
  assert.equal(back.decks.chance.length, DECKS.chance.length - 1);
  assert.equal(back.decks.fate.length, DECKS.fate.length);
  assert.notEqual(back, pub);
  g = act(back, { type: 'END_TURN', p: 0 });
  assert.equal(g.current, 1);
});
