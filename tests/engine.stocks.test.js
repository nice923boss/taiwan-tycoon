// Stock market: price limits, candles, shocks, history length, news and dividends.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NEWS, PRICE_LIMIT, STOCKS, STOCK_BY_SYM, closeMarket, createMarket, dividendFor, round2, shockStock,
} from '../js/engine/stocks.js';
import { netWorth } from '../js/engine/rules.js';
import { act, edit, landOn, lastLog, newGame } from './helpers.js';

const SYMS = STOCKS.map((s) => s.sym);
const EPS = 0.01;

// Local generator for test choices, independent of the market's own rng.
const mulberry = (seed) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const checkCandle = (cd, label) => {
  assert.ok(cd.c >= cd.o * (1 - PRICE_LIMIT) - EPS && cd.c <= cd.o * (1 + PRICE_LIMIT) + EPS, `${label} close ${cd.c} outside limit of open ${cd.o}`);
  assert.ok(cd.h >= Math.max(cd.o, cd.c), `${label} high ${cd.h} below open/close`);
  assert.ok(cd.l <= Math.min(cd.o, cd.c), `${label} low ${cd.l} above open/close`);
  assert.ok(cd.c > 0 && cd.l > 0, `${label} non-positive price`);
  assert.equal(round2(cd.c), cd.c, `${label} close has more than 2 decimals`);
};

test('createMarket starts every stock at its base price with one candle', () => {
  const m = createMarket();
  assert.deepEqual(Object.keys(m.stocks), SYMS);
  for (const s of STOCKS) {
    assert.deepEqual(m.stocks[s.sym], {
      price: s.base, prevClose: s.base, hi: s.base, lo: s.base,
      history: [{ r: 0, o: s.base, h: s.base, l: s.base, c: s.base }],
    });
  }
  assert.deepEqual(m.news, []);
  assert.deepEqual(Object.keys(STOCK_BY_SYM), SYMS);
});

test('every close stays within ±10% of the previous close, with consistent candles', () => {
  let candles = 0;
  for (let seed = 1; seed <= 150; seed += 1) {
    const pick = mulberry(seed * 7919);
    const holder = { market: createMarket(), rng: seed };
    for (let round = 1; round <= 60; round += 1) {
      // Random card shocks during the round, including ones far past the limit.
      while (pick() < 0.3) {
        const sym = SYMS[Math.floor(pick() * SYMS.length)];
        shockStock(holder.market, sym, pick() * 0.8 - 0.4);
        const st = holder.market.stocks[sym];
        assert.ok(st.price >= st.prevClose * 0.9 - EPS && st.price <= st.prevClose * 1.1 + EPS, 'shock beyond the limit');
      }
      const news = closeMarket(holder, round);
      assert.ok(news === null || NEWS.includes(news));
      for (const sym of SYMS) {
        const st = holder.market.stocks[sym];
        const cd = st.history.at(-1);
        checkCandle(cd, `seed ${seed} round ${round} ${sym}`);
        candles += 1;
        assert.equal(cd.r, round);
        assert.equal(st.price, cd.c);
        assert.equal(st.prevClose, cd.c);
        assert.equal(st.hi, cd.c);
        assert.equal(st.lo, cd.c);
        assert.equal(st.history.length, Math.min(round + 1, 40));
        if (st.history.length > 1) assert.equal(cd.o, st.history.at(-2).c, 'open is the previous close');
      }
      assert.ok(holder.market.news.length <= 8);
    }
  }
  assert.equal(candles, 150 * 60 * SYMS.length);
});

test('a close at the limit is clamped exactly to ±10%', () => {
  // A huge shock pushes the price to the limit; the close cannot go further.
  for (let seed = 1; seed <= 50; seed += 1) {
    const holder = { market: createMarket(), rng: seed };
    for (const sym of SYMS) shockStock(holder.market, sym, 5);
    closeMarket(holder, 1);
    for (const s of STOCKS) {
      const cd = holder.market.stocks[s.sym].history[1];
      assert.equal(cd.h, round2(s.base * 1.1));
      assert.ok(cd.c <= round2(s.base * 1.1));
    }
  }
});

test('shocks move the price within the limit and widen the round high/low', () => {
  const m = createMarket();
  shockStock(m, 'CHIP', 0.05);
  assert.equal(m.stocks.CHIP.price, 126);
  assert.equal(m.stocks.CHIP.hi, 126);
  assert.equal(m.stocks.CHIP.lo, 120);
  shockStock(m, 'CHIP', 0.5);
  assert.equal(m.stocks.CHIP.price, 132, 'capped at +10% of the previous close');
  shockStock(m, 'CHIP', -0.5);
  assert.equal(m.stocks.CHIP.price, 108, 'capped at -10% of the previous close');
  assert.equal(m.stocks.CHIP.hi, 132);
  assert.equal(m.stocks.CHIP.lo, 108);
  assert.equal(m.stocks.SHIP.price, 60, 'other stocks are untouched');

  const holder = { market: m, rng: 3 };
  closeMarket(holder, 1);
  const cd = m.stocks.CHIP.history[1];
  assert.equal(cd.o, 120);
  assert.equal(cd.h, 132);
  assert.equal(cd.l, 108);
  checkCandle(cd, 'shocked');
});

test('card shocks inside the engine widen the candle of that round', () => {
  let g = edit(newGame(2), (c) => {
    c.decks.chance = ['c16', ...c.decks.chance.filter((id) => id !== 'c16')];
  });
  g = landOn(g, 7);
  assert.equal(g.market.stocks.CHIP.price, 132);
  g = act(g, { type: 'END_TURN', p: 0 });
  g = act(landOn(g, 0), { type: 'END_TURN', p: 1 });
  const cd = g.market.stocks.CHIP.history.at(-1);
  assert.equal(cd.r, 1);
  assert.equal(cd.h, 132);
  checkCandle(cd, 'engine');
});

test('history keeps only the last 40 candles', () => {
  const holder = { market: createMarket(), rng: 99 };
  for (let round = 1; round <= 45; round += 1) closeMarket(holder, round);
  for (const sym of SYMS) {
    const h = holder.market.stocks[sym].history;
    assert.equal(h.length, 40);
    assert.deepEqual(h.map((cd) => cd.r), Array.from({ length: 40 }, (_, i) => i + 6));
  }
});

test('closeMarket is deterministic for an rng state and records news', () => {
  const run = (seed) => {
    const holder = { market: createMarket(), rng: seed };
    const news = Array.from({ length: 30 }, (_, i) => closeMarket(holder, i + 1));
    return { holder, news };
  };
  assert.deepEqual(run(5), run(5));
  assert.notDeepEqual(run(5).holder.market, run(6).holder.market);
  const { holder, news } = run(5);
  const fired = news.map((n, i) => (n ? { round: i + 1, id: n.id } : null)).filter(Boolean);
  assert.ok(fired.length > 0, 'some news should fire in 30 rounds');
  assert.deepEqual(holder.market.news, fired.reverse().slice(0, 8));
});

test('dividendFor floors the exact dividend', () => {
  const m = createMarket();
  assert.equal(dividendFor(m, 'BEAR', 1000), Math.floor(1000 * 30 * 8 / 1000));
  assert.equal(dividendFor(m, 'CHIP', 1), 0);
  // Regression: 1000 * 64.6 * 0.005 is 322.99999999999994 in floating point.
  m.stocks.BOBA.price = 64.6;
  assert.equal(dividendFor(m, 'BOBA', 1000), 323);
  m.stocks.CHIP.price = 0.29;
  assert.equal(dividendFor(m, 'CHIP', 100000), 58);
  // Compare against exact integer math on a grid of prices and share counts.
  for (const s of STOCKS) {
    const mills = BigInt(Math.round(s.div * 1000));
    for (let cents = 1; cents <= 30000; cents += 7) {
      m.stocks[s.sym].price = round2(cents / 100);
      for (const n of [1, 3, 100, 999, 1000, 4321, 100000]) {
        const exact = Number((BigInt(n) * BigInt(cents) * mills) / 100000n);
        assert.equal(dividendFor(m, s.sym, n), exact, `${s.sym} ${cents / 100} x ${n}`);
      }
    }
  }
});

test('dividends are paid to alive holders at round close', () => {
  let g = edit(newGame(3), (c) => {
    c.players[1].stocks = { BEAR: { n: 1000, cost: 30000 }, BOBA: { n: 500, cost: 22500 } };
    c.players[2].stocks = { CHIP: { n: 1, cost: 120 } };
  });
  for (let p = 0; p < 2; p += 1) g = act(landOn(g, 0), { type: 'END_TURN', p });
  g = landOn(g, 0);
  const before = g.players.map((pl) => pl.cash);
  const lastN = g.log.at(-1).n;
  g = act(g, { type: 'END_TURN', p: 2 });
  const d1 = dividendFor(g.market, 'BEAR', 1000) + dividendFor(g.market, 'BOBA', 500);
  assert.ok(d1 > 0);
  assert.equal(g.players[1].cash, before[1] + d1);
  assert.equal(g.players[2].cash, before[2], 'a zero dividend pays nothing');
  assert.equal(g.players[0].cash, before[0]);
  assert.deepEqual(lastLog(g, 'log.dividend').params, { p: 1, amt: d1 });
  assert.equal(g.log.filter((l) => l.key === 'log.dividend' && l.n > lastN).length, 1);
  // The round's net worth snapshot already includes the dividend.
  assert.deepEqual(g.worthLog[0], { r: 1, w: [0, 1, 2].map((i) => netWorth(g, i)) });
});
