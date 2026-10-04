// Computer play for seats whose player is away: a cautious strategy and the
// host-only LIQUIDATE action it uses to settle a debt.

import test from 'node:test';
import assert from 'node:assert/strict';
import { BOT_RESERVE, computerAction } from '../js/engine/bot.js';
import { SQUARES } from '../js/engine/board.js';
import { ACTION_TYPES, HOST_ONLY, actorOf, applyAction } from '../js/engine/game.js';
import { act, actErr, edit, landOn, lastLog, newGame, own } from './helpers.js';

const jailed = (g, extra = {}) => edit(g, (c) => {
  Object.assign(c.players[0], { pos: 10, inJail: true, jailTurns: 0, ...extra });
});

// Seat 0 owes 50 rent on square 39 with only 10 cash.
const inDebt = (g) => landOn(edit(own(g, 1, [39]), (c) => {
  c.players[0].cash = 10;
}), 39);

test('preRoll: roll, or use a jail card when jailed and holding one', () => {
  const g = newGame(2);
  assert.deepEqual(computerAction(g, 0), { type: 'ROLL', p: 0 });
  assert.deepEqual(computerAction(jailed(g), 0), { type: 'ROLL', p: 0 });
  assert.deepEqual(computerAction(jailed(g, { jailCards: ['chance'] }), 0), { type: 'USE_JAIL_CARD', p: 0 });
});

test('buy: only when the reserve is left afterwards', () => {
  const price = SQUARES[6].price;
  const at = (cash) => landOn(edit(newGame(2), (c) => { c.players[0].cash = cash; }), 6);
  assert.equal(at(price + BOT_RESERVE).phase, 'buy');
  assert.deepEqual(computerAction(at(price + BOT_RESERVE), 0), { type: 'BUY', p: 0 });
  assert.deepEqual(computerAction(at(price + BOT_RESERVE - 1), 0), { type: 'DECLINE', p: 0 });
});

test('auction: pass; postRoll: end the turn; trade: reject', () => {
  const auction = act(landOn(newGame(3), 1), { type: 'DECLINE', p: 0 });
  assert.equal(auction.phase, 'auction');
  for (const p of [0, 1, 2]) assert.deepEqual(computerAction(auction, p), { type: 'PASS_BID', p });

  const post = act(landOn(newGame(2), 1), { type: 'BUY', p: 0 });
  assert.equal(post.phase, 'postRoll');
  assert.deepEqual(computerAction(post, 0), { type: 'END_TURN', p: 0 });

  const trade = act(own(newGame(2), 0, [1]), { type: 'PROPOSE_TRADE', p: 0, to: 1, give: { props: [1] }, get: { cash: 10 } });
  assert.equal(trade.phase, 'trade');
  assert.deepEqual(computerAction(trade, 1), { type: 'REJECT_TRADE', p: 1 });
});

test('no move for a seat that is not acting or is bankrupt', () => {
  const g = newGame(2);
  assert.equal(computerAction(g, 1), null);
  assert.equal(computerAction(edit(g, (c) => { c.players[0].bankrupt = true; }), 0), null);
  assert.equal(computerAction(edit(g, (c) => { c.phase = 'gameOver'; }), 0), null);
});

test('debt: LIQUIDATE sells assets and pays, or declares bankruptcy', () => {
  // Owns station 5 (its mortgage value covers the 50 rent).
  const covered = inDebt(own(newGame(2), 0, [5]));
  assert.equal(covered.phase, 'debt');
  assert.deepEqual(computerAction(covered, 0), { type: 'LIQUIDATE', p: 0 });
  assert.equal(actErr(covered, { type: 'LIQUIDATE', p: 1 }).key, 'err.notNow');
  const paid = act(covered, { type: 'LIQUIDATE', p: 0 });
  assert.equal(paid.debt, null);
  assert.equal(paid.props[5].mortgaged, true);
  assert.ok(lastLog(paid, 'log.autoRaise'));
  assert.ok(lastLog(paid, 'log.debtPaid'));
  assert.equal(paid.players[0].bankrupt, false);

  const broke = act(inDebt(newGame(3)), { type: 'LIQUIDATE', p: 0 });
  assert.equal(broke.players[0].bankrupt, true);
  assert.equal(broke.debt, null);
});

test('LIQUIDATE and TIMEOUT are host-only actions', () => {
  assert.deepEqual([...HOST_ONLY].sort(), ['LIQUIDATE', 'TIMEOUT']);
  for (const type of HOST_ONLY) assert.ok(ACTION_TYPES.includes(type), type);
});

test('a game played only by the computer runs to gameOver without errors', () => {
  for (const seed of [1, 2, 3, 4]) {
    let g = newGame(4, { seed, maxRounds: 15 });
    let now = 0;
    let steps = 0;
    while (g.phase !== 'gameOver') {
      steps += 1;
      assert.ok(steps < 5000, `seed ${seed}: game did not finish`);
      const p = actorOf(g)[0];
      const action = computerAction(g, p);
      assert.ok(action, `seed ${seed}: no move in phase ${g.phase}`);
      now += 1500;
      const res = applyAction(g, action, { now });
      assert.equal(res.error, null, `seed ${seed}: ${JSON.stringify(action)} -> ${JSON.stringify(res.error)}`);
      g = res.game;
    }
    // Cautious play still buys some land.
    assert.ok(Object.values(g.props).some((st) => st.owner !== null), `seed ${seed}: nothing bought`);
  }
});
