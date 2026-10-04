// Wire protocol tests: every public state the engine produces must pass the
// Zod schema the clients use, corrupted states must be rejected, and the
// largest state broadcast must fit the Q8 size budget (40 KB).

import test from 'node:test';
import assert from 'node:assert/strict';
import { pack } from 'peerjs-js-binarypack';
import { actorOf, applyAction, createGame, sanitize } from '../js/engine/game.js';
import { OWNABLE_IDS } from '../js/engine/board.js';
import { RULES } from '../js/engine/rules.js';
import { STOCKS } from '../js/engine/stocks.js';
import {
  CHAT_KEEP, CHAT_MAX, GameSchema, MAX_CONNS, RoomSchema, cleanText,
  parseClientMsg, parseHostMsg, parseSnapshot,
} from '../js/net/protocol.js';
import { CHARS } from './helpers.js';

const SYMS = STOCKS.map((s) => s.sym);
const hexId = (i) => i.toString(16).padStart(16, '0');
const players = (n) => Array.from({ length: n }, (_, i) => ({ id: hexId(i + 1), name: `玩家${i + 1}`, char: CHARS[i] }));

function rng(seed) {
  let s = seed >>> 0;
  const next = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  return { next, int: (n) => Math.floor(next() * n), pick: (a) => a[Math.floor(next() * a.length)], chance: (p) => next() < p };
}

// A plain bot that reaches every phase (buy, auction, debt, trade, jail, stocks).
function botAction(g, R) {
  const p = R.pick(actorOf(g));
  const pl = g.players[p];
  const mine = OWNABLE_IDS.filter((id) => g.props[id].owner === p);
  if (R.chance(0.04)) return { type: 'BUY_STOCK', p, sym: R.pick(SYMS), n: 1 + R.int(30) };
  if (R.chance(0.02) && Object.keys(pl.stocks).length) return { type: 'SELL_STOCK', p, sym: Object.keys(pl.stocks)[0], n: 1 };
  switch (g.phase) {
    case 'preRoll':
      if (pl.inJail && R.chance(0.3)) return { type: 'PAY_BAIL', p };
      return { type: 'ROLL', p };
    case 'buy':
      return R.chance(0.6) ? { type: 'BUY', p } : { type: 'DECLINE', p };
    case 'auction': {
      const min = (g.auction.bid || 0) + RULES.bidStep;
      return g.auction.bidder !== p && min <= pl.cash && R.chance(0.5) ? { type: 'BID', p, amount: min } : { type: 'PASS_BID', p };
    }
    case 'postRoll': {
      const r = R.next();
      if (r < 0.2 && mine.length) return { type: 'BUILD', p, sq: R.pick(mine) };
      if (r < 0.25 && mine.length) return { type: 'MORTGAGE', p, sq: R.pick(mine) };
      if (r < 0.32) {
        const to = R.pick(g.players.map((_, i) => i).filter((i) => i !== p && !g.players[i].bankrupt));
        const theirs = OWNABLE_IDS.filter((id) => g.props[id].owner === to);
        return {
          type: 'PROPOSE_TRADE', p, to,
          give: { cash: R.int(Math.max(1, pl.cash >> 2)), props: mine.slice(0, R.int(2)), cards: 0 },
          get: { cash: 0, props: theirs.slice(0, R.int(2)), cards: 0 },
        };
      }
      return { type: 'END_TURN', p };
    }
    case 'debt': {
      if (pl.cash >= g.debt.amount) return { type: 'PAY_DEBT', p };
      const unmortgaged = mine.filter((id) => !g.props[id].mortgaged && g.props[id].houses === 0);
      if (unmortgaged.length && R.chance(0.7)) return { type: 'MORTGAGE', p, sq: R.pick(unmortgaged) };
      const built = mine.filter((id) => g.props[id].houses > 0);
      if (built.length) return { type: 'SELL_BUILDING', p, sq: built[0] };
      return { type: 'DECLARE_BANKRUPTCY', p };
    }
    case 'trade':
      return R.chance(0.5) ? { type: 'ACCEPT_TRADE', p: g.trade.to } : { type: 'REJECT_TRADE', p: g.trade.to };
    default:
      throw new Error(`no action for ${g.phase}`);
  }
}

function makeRoom(game, { spectators = 0 } = {}) {
  const seats = game ? game.players.map((pl) => ({ id: pl.id, name: pl.name, char: pl.char, online: true })) : [];
  return {
    epoch: 3,
    rev: 120,
    stage: game ? 'game' : 'lobby',
    seats,
    spectators: Array.from({ length: spectators }, (_, i) => ({ id: hexId(100 + i), name: `觀眾${i}` })),
    leader: seats[0]?.id ?? null,
    host: seats[0]?.id ?? null,
    rounds: game?.maxRounds ?? 25,
  };
}

const chatLines = (count, chars = 20) => Array.from({ length: count }, (_, i) => ({ n: i + 1, id: hexId(1), name: '玩家1', text: '大'.repeat(chars), ts: 1e12 + i }));

// Plays games and yields every public state (sampled) plus the final one.
function* playStates({ games, seedBase }) {
  for (let k = 0; k < games; k += 1) {
    const seed = seedBase + k;
    const R = rng(seed * 31 + 7);
    const n = 2 + (k % 5);
    let now = 1_700_000_000_000;
    let g = createGame({ players: players(n), seed, now, maxRounds: RULES.roundOptions[k % 3] });
    if (k % 3 === 1) for (const pl of g.players) pl.cash = 200 + R.int(400);
    for (let step = 0; g.phase !== 'gameOver' && step < 20000; step += 1) {
      now += 500 + R.int(3000);
      const action = R.chance(0.01) ? { type: 'TIMEOUT', force: true } : botAction(g, R);
      const res = applyAction(g, action, { now });
      if (res.error) continue;
      g = res.game;
      if (step % 7 === 0) yield { g, seed, step };
    }
    assert.equal(g.phase, 'gameOver', `seed ${seed} did not finish`);
    yield { g, seed, step: 'end' };
  }
}

test('every public engine state passes GameSchema (real games, all phases)', () => {
  const phases = new Set();
  let count = 0;
  for (const { g, seed, step } of playStates({ games: 60, seedBase: 1 })) {
    const pub = sanitize(g);
    const res = GameSchema.safeParse(pub);
    assert.ok(res.success, `seed ${seed} step ${step} phase ${g.phase}: ${JSON.stringify(res.error?.issues?.slice(0, 3))}`);
    // The parse must not change the state (no transforms on game fields).
    assert.deepEqual(res.data, pub);
    phases.add(g.phase);
    count += 1;
  }
  for (const ph of ['preRoll', 'buy', 'auction', 'postRoll', 'debt', 'trade', 'gameOver']) {
    assert.ok(phases.has(ph), `phase ${ph} never sampled (${[...phases]})`);
  }
  assert.ok(count > 1000, `only ${count} states checked`);
});

const base = () => {
  let g = createGame({ players: players(4), seed: 9, now: 0, maxRounds: 25 });
  const R = rng(5);
  for (let i = 0; i < 400 && g.phase !== 'gameOver'; i += 1) {
    const res = applyAction(g, botAction(g, R), { now: i * 1000 });
    if (!res.error) g = res.game;
  }
  return structuredClone(sanitize(g));
};

test('GameSchema rejects corrupted or hostile states', () => {
  const ok = base();
  assert.ok(GameSchema.safeParse(ok).success);
  const cases = {
    'owner out of range': (g) => { g.props[OWNABLE_IDS[0]].owner = g.players.length; },
    'extra props key': (g) => { g.props['0'] = { owner: null, houses: 0, mortgaged: false }; },
    'missing props key': (g) => { delete g.props[OWNABLE_IDS[3]]; },
    'six houses': (g) => { g.props[OWNABLE_IDS[1]].houses = 6; },
    'negative cash': (g) => { g.players[0].cash = -1; },
    'fractional cash': (g) => { g.players[0].cash = 10.5; },
    'current out of range': (g) => { g.current = 5; },
    'bad player id': (g) => { g.players[1].id = 'id1'; },
    'duplicate player id': (g) => { g.players[1].id = g.players[0].id; },
    'unknown character': (g) => { g.players[0].char = 'dragon'; },
    'unknown stock': (g) => { g.players[0].stocks = { NOPE: { n: 1, cost: 1 } }; },
    'unknown phase': (g) => { g.phase = 'hack'; },
    'wrong version': (g) => { g.v = 2; },
    'dice out of range': (g) => { g.dice = [7, 1]; },
    'too many log lines': (g) => { g.log = Array.from({ length: 61 }, (_, i) => ({ n: i, key: 'log.x', params: {} })); },
    'huge log param': (g) => { g.log = [{ n: 1, key: 'log.x', params: { who: 'x'.repeat(65) } }]; },
    'object log param': (g) => { g.log = [{ n: 1, key: 'log.x', params: { who: { toString: 1 } } }]; },
    'one player': (g) => { g.players = g.players.slice(0, 1); },
    'string cash': (g) => { g.players[0].cash = '1500'; },
  };
  for (const [name, corrupt] of Object.entries(cases)) {
    const g = structuredClone(ok);
    corrupt(g);
    assert.equal(GameSchema.safeParse(g).success, false, `accepted: ${name}`);
  }
  // Unknown top-level keys (e.g. a leaked rng) are stripped, not trusted.
  const leaked = { ...ok, rng: 123, seed: 4, decks: { chance: [] } };
  const parsed = GameSchema.parse(leaked);
  for (const k of ['rng', 'seed', 'decks']) assert.ok(!(k in parsed), `kept ${k}`);
});

test('SnapshotSchema ties stage to game and validates the room and chat', () => {
  const g = base();
  assert.deepEqual(parseSnapshot({ room: makeRoom(g), game: g }).chat, [], 'chat defaults to empty');
  assert.ok(parseSnapshot({ room: makeRoom(null), game: null, chat: chatLines(CHAT_KEEP) }));
  assert.equal(parseSnapshot({ room: makeRoom(g), game: null }), null, 'game stage without game');
  assert.equal(parseSnapshot({ room: makeRoom(null), game: g }), null, 'lobby stage with game');
  assert.equal(parseSnapshot({ room: makeRoom(null), game: null, chat: chatLines(CHAT_KEEP + 1) }), null, 'chat over keep limit');
  assert.equal(RoomSchema.safeParse(makeRoom(g, { spectators: MAX_CONNS + 1 })).success, false, 'too many spectators');
  assert.equal(RoomSchema.safeParse({ ...makeRoom(g), rounds: 30 }).success, false, 'rounds option');
  assert.equal(RoomSchema.safeParse({ ...makeRoom(g), seats: [...makeRoom(g).seats, ...makeRoom(g).seats] }).success, false, '12 seats');
  // Seats from an older peer without the computer-play flags get them as false.
  assert.deepEqual(RoomSchema.parse(makeRoom(g)).seats.map((s) => [s.bot, s.vacant]), g.players.map(() => [false, false]));
});

test('client messages: valid ones parse, junk and forged fields are dropped', () => {
  const secret = 'a'.repeat(32);
  const hello = parseClientMsg({ t: 'hello', v: 1, secret, name: '  小\u0000熊\n  阿明  ' });
  assert.equal(hello.name, '小 熊 阿明');
  assert.equal(parseClientMsg({ t: 'hello', v: 1, secret: 'short', name: 'x' }), null);
  assert.equal(parseClientMsg({ t: 'hello', v: 1, secret, name: '   ' }), null, 'blank name');
  assert.equal(parseClientMsg({ t: 'hello', v: 1, secret, name: '名'.repeat(30) }).name.length, 16);
  assert.deepEqual(parseClientMsg({ t: 'sit', char: 'bear' }), { t: 'sit', char: 'bear' });
  assert.equal(parseClientMsg({ t: 'sit', char: 'dragon' }), null);
  assert.equal(parseClientMsg({ t: 'rounds', n: 20 }), null);
  assert.ok(parseClientMsg({ t: 'rounds', n: 40 }));

  // Actions: the acting seat `p` is stamped by the host, so a sent `p` is stripped.
  const act = parseClientMsg({ t: 'act', a: { type: 'ROLL', p: 3, evil: 1 } });
  assert.deepEqual(act, { t: 'act', a: { type: 'ROLL' } });
  assert.equal(parseClientMsg({ t: 'act', a: { type: 'TIMEOUT', force: true } }), null, 'clients cannot force timeouts');
  assert.equal(parseClientMsg({ t: 'act', a: { type: 'LIQUIDATE' } }), null, 'computer-only action');
  assert.deepEqual(parseClientMsg({ t: 'claim', char: 'deer' }), { t: 'claim', char: 'deer' });
  assert.equal(parseClientMsg({ t: 'claim', char: 'dragon' }), null);
  assert.equal(parseClientMsg({ t: 'act', a: { type: 'NOPE' } }), null);
  assert.equal(parseClientMsg({ t: 'act', a: { type: 'BUY_STOCK', sym: 'CHIP', n: 0.5 } }), null);
  assert.equal(parseClientMsg({ t: 'act', a: { type: 'BID', amount: -5 } }), null);
  const trade = { type: 'PROPOSE_TRADE', to: 1, give: { cash: 10, props: [1, 3], cards: 0 }, get: { cash: 0, props: [], cards: 1 } };
  assert.deepEqual(parseClientMsg({ t: 'act', a: trade }).a, trade);
  assert.equal(parseClientMsg({ t: 'act', a: { ...trade, give: { cash: -1, props: [], cards: 0 } } }), null);

  const chat = parseClientMsg({ t: 'chat', text: `  hi\u0007${'字'.repeat(300)}` });
  assert.equal([...chat.text].length, CHAT_MAX);
  assert.equal(parseClientMsg({ t: 'chat', text: '\u0000\u0001  ' }), null, 'empty after cleaning');
  assert.equal(parseClientMsg({ t: 'chat', text: 'x'.repeat(CHAT_MAX * 4 + 1) }), null, 'oversized raw text');
  for (const junk of [null, 1, 'x', [], {}, { t: 'nope' }, { t: 'sit' }]) assert.equal(parseClientMsg(junk), null);
});

test('host messages parse, and cleanText keeps emoji whole', () => {
  const g = base();
  assert.ok(parseHostMsg({ t: 'state', now: 1, room: makeRoom(g), game: g }));
  assert.ok(parseHostMsg({ t: 'err', key: 'err.seatFull', params: {} }));
  assert.ok(parseHostMsg({ t: 'chat', lines: chatLines(3), reset: false }));
  assert.equal(parseHostMsg({ t: 'chat', lines: chatLines(CHAT_KEEP + 1), reset: true }), null);
  assert.ok(parseHostMsg({ t: 'welcome', id: hexId(7) }));
  assert.equal(parseHostMsg({ t: 'welcome', id: 'nothex' }), null);
  assert.equal(parseHostMsg({ t: 'state', now: 1, room: makeRoom(g), game: { ...g, phase: 'x' } }), null);
  assert.equal(cleanText('🐻🐆🐦', 2), '🐻🐆');
});

// Q8: the biggest state broadcast (6 players, late game, max spectators) must
// stay within 40 KB on the wire. The one-time migration hello (snapshot plus a
// full chat backlog) is measured too, without a budget: it is sent once.
test('Q8: largest state broadcast fits in 40 KB (JSON and BinaryPack)', () => {
  let biggest = null;
  let biggestSize = 0;
  for (const { g } of playStates({ games: 15, seedBase: 1000 })) {
    if (g.players.length !== 6) continue;
    const size = JSON.stringify(sanitize(g)).length;
    if (size > biggestSize) {
      biggestSize = size;
      biggest = sanitize(g);
    }
  }
  const room = makeRoom(biggest, { spectators: MAX_CONNS });
  const msg = { t: 'state', now: Date.now(), room, game: biggest };
  assert.ok(parseHostMsg(msg), 'worst-case message must still be valid');
  const jsonBytes = Buffer.byteLength(JSON.stringify(msg));
  const packBytes = pack(msg).byteLength;
  const hello = { t: 'hello', v: 1, secret: 'b'.repeat(32), name: '玩家1', snap: { room, game: biggest, chat: chatLines(CHAT_KEEP, CHAT_MAX) } };
  assert.ok(parseClientMsg(hello), 'worst-case hello must still be valid');
  const helloBytes = pack(hello).byteLength;
  console.log(`Q8 worst case: game ${biggestSize} chars; state JSON ${jsonBytes} B, BinaryPack ${packBytes} B; migration hello BinaryPack ${helloBytes} B`);
  assert.ok(jsonBytes <= 40 * 1024, `JSON ${jsonBytes} B`);
  assert.ok(packBytes <= 40 * 1024, `BinaryPack ${packBytes} B`);
});
