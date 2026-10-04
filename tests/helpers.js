// Shared test helpers (not a test file itself: it does not match *.test.js).

import assert from 'node:assert/strict';
import { applyAction, createGame } from '../js/engine/game.js';
import { nextInt } from '../js/engine/rng.js';

export const CHARS = ['bear', 'leopardcat', 'magpie', 'pangolin', 'macaque', 'deer'];

export const makePlayers = (n) => Array.from({ length: n }, (_, i) => ({ id: `id${i}`, name: `P${i}`, char: CHARS[i] }));

export const newGame = (n = 2, { seed = 1, now = 0, maxRounds = 15 } = {}) => createGame({ players: makePlayers(n), seed, now, maxRounds });

// Return a deep copy of `g` after applying `fn` to it (test-only state surgery).
export const edit = (g, fn) => {
  const c = structuredClone(g);
  fn(c);
  return c;
};

const diceCache = new Map();

// An rng state whose next two dice are d1 and d2.
export function rngForDice(d1, d2) {
  const k = `${d1},${d2}`;
  if (diceCache.has(k)) return diceCache.get(k);
  for (let r = 0; ; r += 1) {
    const h = { rng: r };
    if (1 + nextInt(h, 6) === d1 && 1 + nextInt(h, 6) === d2) {
      diceCache.set(k, r);
      return r;
    }
  }
}

export const withDice = (g, d1, d2) => edit(g, (c) => {
  c.rng = rngForDice(d1, d2);
});

// Apply an action that must succeed; also checks that the input was not mutated.
export function act(g, action, now = 0) {
  const before = structuredClone(g);
  const res = applyAction(g, action, { now });
  assert.equal(res.error, null, `unexpected error ${JSON.stringify(res.error)} for ${JSON.stringify(action)}`);
  assert.deepEqual(g, before, 'applyAction mutated its input');
  return res.game;
}

// Apply an action that must fail; returns the error and checks the input object is returned as is.
export function actErr(g, action, now = 0) {
  const res = applyAction(g, action, { now });
  assert.notEqual(res.error, null, `expected an error for ${JSON.stringify(action)}`);
  assert.equal(res.game, g, 'error result must return the identical input object');
  return res.error;
}

// Roll specific dice for the current player.
export const rollDice = (g, d1, d2, now = 0) => act(withDice(g, d1, d2), { type: 'ROLL', p: g.current }, now);

export const logKeys = (g) => g.log.map((l) => l.key);

export const lastLog = (g, key) => [...g.log].reverse().find((l) => l.key === key);

// Put the current player `d1 + d2` squares before `target` and roll those dice.
export const landOn = (g, target, d1 = 1, d2 = 2, now = 0) => {
  const start = edit(g, (c) => {
    c.players[c.current].pos = (target - d1 - d2 + 40) % 40;
  });
  return rollDice(start, d1, d2, now);
};

// Give squares `ids` to seat `p`, optionally with extra prop fields (houses, mortgaged).
export const own = (g, p, ids, extra = {}) => edit(g, (c) => {
  for (const id of ids) Object.assign(c.props[id], { owner: p, ...extra });
});
