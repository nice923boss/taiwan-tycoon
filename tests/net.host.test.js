// Authoritative host room driven through in-memory connections and a fake clock.

import test from 'node:test';
import assert from 'node:assert/strict';
import { HOST_TIMING, createHostRoom } from '../js/net/host-room.js';
import { idFromSecret } from '../js/net/identity.js';
import { pair } from '../js/net/pair.js';
import { CHARACTERS, CHAT_KEEP, MAX_CONNS, PROTOCOL_VERSION, parseHostMsg, parseSnapshot } from '../js/net/protocol.js';
import { RULES } from '../js/engine/rules.js';

const HOST_ID = 'ffffffffffffffff';
const secretOf = (i) => i.toString(16).padStart(32, '0');
const tick = () => new Promise((resolve) => setImmediate(resolve));

async function flush() {
  for (let i = 0; i < 3; i += 1) await tick();
}

async function until(pred, what) {
  for (let i = 0; i < 2000; i += 1) {
    if (pred()) return;
    await tick();
  }
  assert.fail(`timed out waiting for ${what}`);
}

function makeHost() {
  const clock = { now: 1_000_000 };
  const host = createHostRoom({ selfId: HOST_ID, clock: () => clock.now, seedFn: () => 7 });
  return { host, clock };
}

// A client endpoint that records every host message and checks it against the schema.
async function connect(host, i, { name = `P${i}`, snap = null, v = PROTOCOL_VERSION } = {}) {
  const [hostSide, clientSide] = pair();
  host.attach(hostSide);
  const c = { i, msgs: [], bad: [], closed: false, id: await idFromSecret(secretOf(i)) };
  clientSide.onMessage((raw) => {
    const msg = parseHostMsg(raw);
    if (msg) c.msgs.push(msg);
    else c.bad.push(raw);
  });
  clientSide.onClose(() => {
    c.closed = true;
  });
  c.send = (msg) => clientSide.send(msg);
  c.close = () => clientSide.close();
  c.last = (t) => c.msgs.findLast((m) => m.t === t);
  c.errs = () => c.msgs.filter((m) => m.t === 'err').map((m) => m.key);
  c.room = () => c.last('state')?.room;
  c.game = () => c.last('state')?.game;
  clientSide.send({ t: 'hello', v, secret: secretOf(i), name, snap });
  await until(() => c.last('welcome') || c.closed, `welcome for client ${i}`);
  await flush();
  return c;
}

async function send(c, msg) {
  c.send(msg);
  await flush();
}

// Lobby with `n` seated clients after the recover window has passed.
async function seated(n) {
  const { host, clock } = makeHost();
  const clients = [];
  for (let i = 0; i < n; i += 1) clients.push(await connect(host, i));
  clock.now += HOST_TIMING.recoverMs;
  for (const [i, c] of clients.entries()) await send(c, { t: 'sit', char: CHARACTERS[i] });
  return { host, clock, clients };
}

async function started(n) {
  const ctx = await seated(n);
  await send(ctx.clients[0], { t: 'start' });
  const byId = (id) => ctx.clients.find((c) => c.id === id);
  ctx.current = () => byId(ctx.host.snapshot().game.players[ctx.host.snapshot().game.current].id);
  return ctx;
}

test('hello: welcome with the hashed id, chat backlog, state; spectators listed', async () => {
  const { host } = makeHost();
  const a = await connect(host, 1, { name: '  小  熊 ' });
  assert.equal(a.last('welcome').id, await idFromSecret(secretOf(1)));
  assert.deepEqual(a.msgs.map((m) => m.t).slice(0, 3), ['welcome', 'chat', 'state']);
  assert.deepEqual(a.last('chat'), { t: 'chat', lines: [], reset: true });
  const b = await connect(host, 2);
  assert.deepEqual(b.room().spectators.map((s) => s.name), ['小 熊', 'P2']);
  assert.deepEqual(a.room(), b.room());
  assert.equal(a.room().host, HOST_ID);
  assert.equal(a.room().stage, 'lobby');
  assert.equal(a.game(), null);
  b.close();
  await flush();
  assert.deepEqual(a.room().spectators.map((s) => s.name), ['小 熊']);
  assert.deepEqual([...a.bad, ...b.bad], []);
});

test('commands are refused during the recover window', async () => {
  const { host, clock } = makeHost();
  const a = await connect(host, 1);
  await send(a, { t: 'sit', char: 'bear' });
  assert.deepEqual(a.errs(), ['err.recovering']);
  clock.now += HOST_TIMING.recoverMs;
  await send(a, { t: 'sit', char: 'bear' });
  assert.deepEqual(a.errs(), ['err.recovering']);
  assert.equal(a.room().seats.length, 1);
});

test('lobby: characters, leader, rounds and start rules', async () => {
  const { host, clients } = await seated(6);
  const [a, b, c] = clients;
  assert.deepEqual(clients.flatMap((x) => x.errs()), []);
  assert.equal(a.room().seats.length, RULES.maxPlayers);
  assert.equal(CHARACTERS.length, RULES.maxPlayers, 'host-room sit() relies on this');
  assert.equal(a.room().leader, a.id);

  // Every character is taken, so a seventh person can only watch.
  const g = await connect(host, 7);
  await send(g, { t: 'sit', char: 'deer' });
  assert.equal(g.errs().at(-1), 'err.charTaken');
  await send(g, { t: 'stand' });
  assert.equal(g.errs().at(-1), 'err.notNow');
  assert.deepEqual(a.room().spectators.map((s) => s.id), [g.id]);

  // Standing frees a character; a seated player can switch to a free one.
  await send(clients[5], { t: 'stand' });
  await send(a, { t: 'sit', char: 'deer' });
  assert.equal(a.room().seats[0].char, 'deer');
  await send(g, { t: 'sit', char: 'bear' });
  assert.deepEqual(a.room().seats.map((s) => s.id), [...clients.slice(0, 5), g].map((x) => x.id));
  assert.deepEqual(a.room().spectators.map((s) => s.id), [clients[5].id]);

  // The leader is the first online seat; only the leader sets rounds and starts.
  await send(b, { t: 'rounds', n: 15 });
  assert.equal(b.errs().at(-1), 'err.notLeader');
  await send(b, { t: 'start' });
  assert.equal(b.errs().at(-1), 'err.notLeader');
  a.close();
  await flush();
  assert.equal(b.room().leader, b.id);
  await send(b, { t: 'rounds', n: 15 });
  await send(b, { t: 'start' });
  assert.equal(b.room().stage, 'game');
  assert.equal(b.game().maxRounds, 15);
  assert.equal(b.game().players.length, 6);
  await send(c, { t: 'stand' });
  assert.equal(c.errs().at(-1), 'err.notInLobby');
  assert.deepEqual([...clients, g].flatMap((x) => x.bad), []);
});

test('start needs two seats and the leader', async () => {
  const { clients } = await seated(1);
  await send(clients[0], { t: 'start' });
  assert.equal(clients[0].errs().at(-1), 'err.needPlayers');
  assert.deepEqual(clients[0].last('err').params, { n: RULES.minPlayers });
});

test('game actions: only the acting seat, spectators are not players', async () => {
  const { host, clients, current } = await started(3);
  const spectator = await connect(host, 9);
  const actor = current();
  const other = clients.find((c) => c !== actor);
  await send(other, { t: 'act', a: { type: 'ROLL' } });
  assert.equal(other.errs().at(-1), 'err.notNow');
  await send(spectator, { t: 'act', a: { type: 'ROLL' } });
  assert.equal(spectator.errs().at(-1), 'err.notAPlayer');
  const before = actor.game().logSeq;
  await send(actor, { t: 'act', a: { type: 'ROLL' } });
  assert.notEqual(actor.game().dice, null);
  assert.ok(actor.game().logSeq > before);
  assert.deepEqual(actor.game(), spectator.game());
  // The broadcast never carries the RNG state or the deck order.
  for (const key of ['rng', 'seed', 'decks']) assert.ok(!(key in spectator.game()), key);
  assert.deepEqual([...clients, spectator].flatMap((c) => c.bad), []);
});

test('chat: rate limit, keep the last lines, backlog on join', async () => {
  const { host, clock, clients } = await seated(2);
  const [a, b] = clients;
  for (let i = 0; i < 5; i += 1) await send(a, { t: 'chat', text: `hi ${i}` });
  assert.deepEqual(a.errs(), ['err.chatTooFast']);
  const lines = b.msgs.filter((m) => m.t === 'chat' && !m.reset).flatMap((m) => m.lines);
  assert.deepEqual(lines.map((l) => l.text), ['hi 0', 'hi 1', 'hi 2', 'hi 3']);
  assert.deepEqual(lines.map((l) => l.n), [1, 2, 3, 4]);
  assert.equal(lines[0].id, a.id);
  for (let i = 0; i < CHAT_KEEP; i += 1) {
    clock.now += HOST_TIMING.chatWindowMs;
    await send(b, { t: 'chat', text: `line ${i}` });
  }
  assert.deepEqual(b.errs(), []);
  const late = await connect(host, 5);
  const backlog = late.last('chat');
  assert.equal(backlog.reset, true);
  assert.equal(backlog.lines.length, CHAT_KEEP);
  assert.equal(backlog.lines.at(-1).text, `line ${CHAT_KEEP - 1}`);
  assert.deepEqual(host.snapshot().chat, backlog.lines);
});

test('chat during a game uses the seat name, so it matches the player list', async () => {
  const { host, clients } = await started(2);
  const [a, b] = clients;
  const watcher = await connect(host, 9, { name: 'Watcher' });
  await send(a, { t: 'name', name: 'Renamed' });
  await send(a, { t: 'chat', text: 'hi' });
  await send(watcher, { t: 'chat', text: 'go' });
  const lines = b.msgs.filter((m) => m.t === 'chat' && !m.reset).flatMap((m) => m.lines);
  assert.deepEqual(lines.map((l) => l.name), ['P0', 'Watcher']);
  assert.equal(b.game().players.find((pl) => pl.id === a.id).name, 'P0');
});

test('reconnect keeps the seat; a second tab with the same secret replaces the first', async () => {
  const { host, clock, clients } = await started(2);
  const [a, b] = clients;
  a.close();
  await flush();
  assert.equal(b.room().seats.find((s) => s.id === a.id).online, false);
  clock.now += 60_000; // seats are kept for the whole game
  const a2 = await connect(host, 0);
  assert.equal(b.room().seats.find((s) => s.id === a.id).online, true);
  assert.equal(a2.game().players.some((p) => p.id === a.id), true);
  const a3 = await connect(host, 0);
  await until(() => a2.closed, 'replaced tab to close');
  assert.equal(a2.last('bye').key, 'err.replaced');
  assert.equal(a3.room().seats.find((s) => s.id === a.id).online, true);
  assert.equal(a3.room().spectators.length, 0);
});

test('version mismatch and a full room are refused with bye', async () => {
  const { host } = makeHost();
  const old = await connect(host, 1, { v: PROTOCOL_VERSION + 1 });
  assert.equal(old.last('bye').key, 'err.version');
  assert.equal(old.closed, true);
  const many = [];
  for (let i = 0; i < MAX_CONNS; i += 1) many.push(await connect(host, 100 + i));
  assert.equal(many.at(-1).room().spectators.length, MAX_CONNS);
  const extra = await connect(host, 500);
  assert.equal(extra.last('bye').key, 'err.roomFull');
  assert.equal(extra.closed, true);
  // A member reconnecting from a new tab is still let in.
  const again = await connect(host, 100);
  assert.equal(again.last('welcome').id, many[0].id);
});

test('timers: heartbeat, silent drop, lobby seat release', async () => {
  const { host, clock, clients } = await seated(2);
  const [a, b] = clients;
  clock.now += HOST_TIMING.beatMs;
  host.tick();
  await flush();
  assert.equal(a.last('beat').now, clock.now);
  // b goes quiet; a keeps sending beats.
  clock.now += HOST_TIMING.silentMs / 2;
  await send(a, { t: 'beat' });
  clock.now += HOST_TIMING.silentMs / 2 + 1;
  host.tick();
  await flush();
  assert.equal(b.closed, true);
  assert.equal(a.closed, false);
  assert.equal(a.room().seats.find((s) => s.id === b.id).online, false);
  clock.now += HOST_TIMING.seatReleaseMs - 1;
  await send(a, { t: 'beat' });
  host.tick();
  await flush();
  assert.equal(a.room().seats.length, 2);
  clock.now += 1;
  host.tick();
  await flush();
  assert.deepEqual(a.room().seats.map((s) => s.id), [a.id]);
});

test('timeouts: a passed deadline takes the default action', async () => {
  const { host, clock, clients } = await started(2);
  const g0 = host.snapshot().game;
  assert.equal(g0.phase, 'preRoll');
  clock.now = g0.deadline - 1;
  for (const c of clients) await send(c, { t: 'beat' });
  host.tick();
  await flush();
  assert.equal(host.snapshot().game.dice, null);
  clock.now = g0.deadline;
  host.tick();
  await flush();
  assert.notEqual(host.snapshot().game.dice, null);
  assert.equal(host.snapshot().game.log.some((l) => l.key === 'log.timeout'), true);
});

// Advance the clock to `t`, keep the listed clients alive, run the host timers.
async function at(ctx, t, alive) {
  ctx.clock.now = t;
  for (const c of alive) c.send({ t: 'beat' });
  await flush();
  ctx.host.tick();
  await flush();
}

const seatOf = (c, id) => c.room().seats.find((s) => s.id === id);
const logOf = (ctx) => ctx.host.snapshot().game.log;

test('computer play: an offline actor is played by the computer, one move per step', async () => {
  const ctx = await started(2);
  const actor = ctx.current();
  const other = ctx.clients.find((c) => c !== actor);
  const t0 = ctx.clock.now;
  actor.close();
  await flush();
  await at(ctx, t0 + HOST_TIMING.offlineActMs - 1, [other]);
  assert.equal(seatOf(other, actor.id).bot, false);
  await at(ctx, t0 + HOST_TIMING.offlineActMs, [other]);
  assert.equal(seatOf(other, actor.id).bot, true);
  assert.equal(seatOf(other, actor.id).vacant, false);
  const p = ctx.host.snapshot().game.players.findIndex((pl) => pl.id === actor.id);
  assert.deepEqual(logOf(ctx).at(-1), { n: logOf(ctx).at(-1).n, key: 'log.botOn', params: { p } });
  assert.equal(other.game().dice, null, 'the first move waits one step');
  const t1 = ctx.clock.now;
  const due = t1 + HOST_TIMING.botStepMs - HOST_TIMING.tickSlackMs;
  await at(ctx, due - 1, [other]);
  assert.equal(other.game().dice, null);
  await at(ctx, due, [other]);
  assert.notEqual(other.game().dice, null);
  assert.equal(logOf(ctx).some((l) => l.key === 'log.timeout'), false);
  assert.deepEqual(ctx.clients.flatMap((c) => c.bad), []);
});

test('computer moves stay three host ticks apart when a tick runs late', async () => {
  const ctx = await started(2);
  const actor = ctx.current();
  const other = ctx.clients.find((c) => c !== actor);
  const t0 = ctx.clock.now;
  actor.close();
  await flush();
  // Host ticks every 500 ms. The computer is switched on at tick 16 (8 s),
  // rolls at tick 19, which arrives 40 ms late; its next move is due at tick 22.
  const tickAt = (k) => at(ctx, t0 + k * 500 + (k === 19 ? 40 : 0), [other]);
  for (let k = 1; k <= 19; k += 1) await tickAt(k);
  assert.notEqual(ctx.host.snapshot().game.dice, null, 'the computer rolled at tick 19');
  const afterRoll = JSON.stringify(ctx.host.snapshot().game);
  for (let k = 20; k <= 21; k += 1) await tickAt(k);
  assert.equal(JSON.stringify(ctx.host.snapshot().game), afterRoll, 'no move before 1.5 s');
  await tickAt(22);
  assert.notEqual(JSON.stringify(ctx.host.snapshot().game), afterRoll, 'the next move comes at tick 22');
});

test('computer play is not held up by renames or stock trades from others', async () => {
  const ctx = await started(3);
  const actor = ctx.current();
  const others = ctx.clients.filter((c) => c !== actor);
  const watcher = await connect(ctx.host, 9);
  const { stocks } = ctx.host.snapshot().game.market;
  const sym = Object.keys(stocks).sort((x, y) => stocks[x].price - stocks[y].price)[0]; // 20 orders must stay affordable
  const t0 = ctx.clock.now;
  actor.close();
  await flush();
  // Every host tick (500 ms) someone renames and someone buys a share.
  for (let t = t0 + 500; t <= t0 + HOST_TIMING.offlineActMs + HOST_TIMING.botStepMs + 500; t += 500) {
    await send(watcher, { t: 'name', name: `W${t}` });
    await send(others[0], { t: 'act', a: { type: 'BUY_STOCK', sym, n: 1 } });
    await at(ctx, t, [...others, watcher]);
  }
  assert.deepEqual(others[0].errs(), []);
  assert.notEqual(ctx.host.snapshot().game.dice, null, 'the computer rolled');
  assert.equal(logOf(ctx).some((l) => l.key === 'log.timeout'), false);
});

test('migration keeps computer and vacant seats as they were', async () => {
  const ctx = await started(3);
  const [a, b, c] = ctx.clients;
  const t0 = ctx.clock.now;
  a.close();
  await flush();
  await at(ctx, t0 + HOST_TIMING.seatReleaseMs, [b, c]);
  const snap = ctx.host.snapshot();
  assert.equal(snap.room.seats.find((s) => s.id === a.id).vacant, true);

  // The old host is gone; b's tab becomes the host with the same snapshot.
  const clock = { now: ctx.clock.now + 1000 };
  const host = createHostRoom({ selfId: b.id, snap, clock: () => clock.now, seedFn: () => 7 });
  const next = { host, clock };
  const b2 = await connect(host, 1);
  const watcher = await connect(host, 9);
  await at(next, clock.now + HOST_TIMING.recoverMs, [b2, watcher]);
  assert.deepEqual({ bot: seatOf(b2, a.id).bot, vacant: seatOf(b2, a.id).vacant }, { bot: true, vacant: true });
  assert.equal(seatOf(b2, b.id).bot, false);
  await send(watcher, { t: 'claim', char: seatOf(b2, a.id).char });
  assert.deepEqual(watcher.errs(), []);
  assert.equal(host.snapshot().game.log.filter((l) => l.key === 'log.botOn').length, 1);
});

test('the player returns before anyone takes over: the seat is theirs again', async () => {
  const ctx = await started(2);
  const [a, b] = ctx.clients;
  const t0 = ctx.clock.now;
  a.close();
  await flush();
  await at(ctx, t0 + HOST_TIMING.seatReleaseMs, [b]);
  assert.equal(seatOf(b, a.id).vacant, true);
  const a2 = await connect(ctx.host, 0);
  assert.deepEqual({ ...seatOf(a2, a.id) }, { ...seatOf(a2, a.id), online: true, bot: false, vacant: false });
  const p = ctx.host.snapshot().game.players.findIndex((pl) => pl.id === a.id);
  assert.deepEqual(logOf(ctx).at(-1).key, 'log.botOff');
  assert.deepEqual(logOf(ctx).at(-1).params, { p });
});

test('takeover: a spectator claims a vacant seat; the old player comes back as a spectator', async () => {
  const ctx = await started(3);
  const [a, b, c] = ctx.clients;
  const watcher = await connect(ctx.host, 9, { name: 'Watcher' });
  const t0 = ctx.clock.now;
  a.close();
  await flush();
  const char = seatOf(b, a.id).char;
  const alive = [b, c, watcher];

  // Not yet vacant, not a spectator, not an empty character.
  await at(ctx, t0 + HOST_TIMING.seatReleaseMs - 1, alive);
  assert.equal(seatOf(b, a.id).bot, true);
  await send(watcher, { t: 'claim', char });
  assert.equal(watcher.errs().at(-1), 'err.seatNotVacant');
  await at(ctx, t0 + HOST_TIMING.seatReleaseMs, alive);
  assert.equal(seatOf(b, a.id).vacant, true);
  await send(b, { t: 'claim', char });
  assert.equal(b.errs().at(-1), 'err.notNow');
  await send(watcher, { t: 'claim', char: seatOf(b, c.id).char });
  assert.equal(watcher.errs().at(-1), 'err.seatNotVacant');

  await send(watcher, { t: 'claim', char });
  const p = ctx.host.snapshot().game.players.findIndex((pl) => pl.id === watcher.id);
  assert.ok(p >= 0);
  assert.equal(watcher.game().players[p].name, 'Watcher');
  assert.equal(watcher.game().players.some((pl) => pl.id === a.id), false);
  assert.deepEqual(seatOf(watcher, watcher.id), { id: watcher.id, name: 'Watcher', char, online: true, bot: false, vacant: false, cpu: false });
  assert.deepEqual(watcher.room().spectators, []);
  assert.deepEqual(logOf(ctx).at(-1).key, 'log.seatClaimed');
  assert.deepEqual(logOf(ctx).at(-1).params, { p, name: 'P0' });

  // The new player acts for the seat; the old player only watches now.
  if (ctx.current() === watcher) {
    await send(watcher, { t: 'act', a: { type: 'ROLL' } });
    assert.notEqual(watcher.game().dice, null);
  }
  const a2 = await connect(ctx.host, 0);
  assert.equal(seatOf(a2, a.id), undefined);
  assert.deepEqual(a2.room().spectators.map((s) => s.id), [a.id]);
  await send(a2, { t: 'act', a: { type: 'ROLL' } });
  assert.equal(a2.errs().at(-1), 'err.notAPlayer');
  assert.deepEqual([...ctx.clients, watcher, a2].flatMap((x) => x.bad), []);
});

test('takeover is refused in the lobby and for a bankrupt seat', async () => {
  const lobby = await seated(2);
  const w = await connect(lobby.host, 9);
  await send(w, { t: 'claim', char: CHARACTERS[0] });
  assert.equal(w.errs().at(-1), 'err.notNow');

  const ctx = await started(3);
  const [a, b] = ctx.clients;
  const watcher = await connect(ctx.host, 9);
  await send(a, { t: 'act', a: { type: 'RESIGN' } });
  const t0 = ctx.clock.now;
  a.close();
  await flush();
  await at(ctx, t0 + HOST_TIMING.seatReleaseMs, ctx.clients.slice(1).concat(watcher));
  assert.deepEqual({ bot: seatOf(b, a.id).bot, vacant: seatOf(b, a.id).vacant }, { bot: false, vacant: false });
  await send(watcher, { t: 'claim', char: seatOf(b, a.id).char });
  assert.equal(watcher.errs().at(-1), 'err.seatNotVacant');
});

test('a game whose players all left is finished by the computer', async () => {
  const ctx = await started(2);
  const watcher = await connect(ctx.host, 9);
  for (const c of ctx.clients) c.close();
  await flush();
  let steps = 0;
  while (ctx.host.snapshot().game.phase !== 'gameOver') {
    steps += 1;
    assert.ok(steps < 4000, 'game did not finish');
    await at(ctx, ctx.clock.now + HOST_TIMING.botStepMs, [watcher]);
  }
  assert.equal(logOf(ctx).some((l) => l.key === 'log.timeout'), false);
  assert.equal(watcher.game().phase, 'gameOver');
  assert.deepEqual(watcher.bad, []);
});

test('a game played only by timeouts reaches gameOver, then the leader returns to the lobby', async () => {
  const { host, clock, clients } = await seated(2);
  await send(clients[0], { t: 'rounds', n: 15 });
  await send(clients[0], { t: 'start' });
  let steps = 0;
  while (host.snapshot().game.phase !== 'gameOver') {
    steps += 1;
    assert.ok(steps < 3000, 'game did not finish');
    clock.now = Math.max(clock.now + 1, host.snapshot().game.deadline ?? 0);
    for (const c of clients) c.send({ t: 'beat' });
    await flush();
    host.tick();
    await flush();
  }
  const g = clients[1].game();
  assert.equal(g.phase, 'gameOver');
  assert.ok(g.ranking.length === 2);
  await send(clients[1], { t: 'again' });
  assert.equal(clients[1].errs().at(-1), 'err.notLeader');
  await send(clients[0], { t: 'again' });
  assert.equal(clients[1].room().stage, 'lobby');
  assert.equal(clients[1].game(), null);
  assert.equal(clients[1].room().seats.length, 2);
  assert.deepEqual(clients.flatMap((c) => c.bad), []);
});

test('migration: a new host continues from the newest snapshot, then stops adopting', async () => {
  const a = await started(2);
  await send(a.current(), { t: 'act', a: { type: 'ROLL' } });
  const snapA = parseSnapshot(structuredClone(a.host.snapshot()));
  assert.ok(snapA, 'host snapshot passes the schema');
  a.host.close();

  // New host B starts from an older copy of the state it had saved as a client.
  assert.ok(snapA.room.rev >= 2);
  const stale = structuredClone(snapA);
  stale.room.rev -= 1;
  const clock = { now: 2_000_000 };
  const b = createHostRoom({ selfId: HOST_ID.replace('f', 'e'), snap: stale, clock: () => clock.now, seedFn: () => 99 });
  assert.equal(b.snapshot().room.epoch, snapA.room.epoch + 1);
  assert.equal(b.snapshot().room.host, HOST_ID.replace('f', 'e'));
  assert.ok(b.snapshot().room.seats.every((s) => !s.online));

  // A peer offers an older snapshot: ignored. Another offers a newer one: adopted.
  const older = structuredClone(snapA);
  older.room.rev = 0;
  older.game.players[0].cash = 1;
  const c0 = await connect(b, 0, { snap: older });
  assert.notEqual(b.snapshot().game.players[0].cash, 1);
  const newest = structuredClone(snapA);
  newest.game.players[0].cash = 4321;
  const c1 = await connect(b, 1, { snap: newest });
  const g = b.snapshot().game;
  assert.equal(g.players[0].cash, 4321);
  assert.equal(b.snapshot().room.epoch, snapA.room.epoch + 1);
  assert.equal(g.turnStartedAt, clock.now);
  assert.deepEqual({ ...g, deadline: 0, turnStartedAt: 0 }, { ...newest.game, deadline: 0, turnStartedAt: 0 });
  assert.deepEqual(c1.room().seats.map((s) => s.online), [true, true]);
  assert.deepEqual(c0.game(), c1.game());

  // After the first accepted change, offered snapshots are ignored.
  clock.now += HOST_TIMING.recoverMs;
  await send(c0, { t: 'chat', text: 'back' });
  c1.close();
  await flush();
  const late = structuredClone(newest);
  late.room.epoch += 3;
  late.game.players[0].cash = 7;
  await connect(b, 1, { snap: late });
  assert.equal(b.snapshot().game.players[0].cash, 4321);
  assert.equal(b.snapshot().chat.at(-1).text, 'back');
});

test('a snapshot whose players are not all seated is not adopted', async () => {
  const a = await started(2);
  const snap = parseSnapshot(structuredClone(a.host.snapshot()));
  snap.room.seats = snap.room.seats.slice(0, 1);
  const b = createHostRoom({ selfId: HOST_ID, snap, clock: () => 0, seedFn: () => 1 });
  assert.equal(b.snapshot().game, null);
  assert.equal(b.snapshot().room.stage, 'lobby');
});

test('computer players: the leader adds and removes them, in the lobby only', async () => {
  const { host, clients } = await seated(1);
  const [a] = clients;
  const b = await connect(host, 1);
  await send(b, { t: 'addCpu', char: CHARACTERS[1], name: 'CPU 1' });
  assert.equal(b.errs().at(-1), 'err.notLeader');
  await send(a, { t: 'addCpu', char: CHARACTERS[0], name: 'CPU 1' });
  assert.equal(a.errs().at(-1), 'err.charTaken');

  await send(a, { t: 'addCpu', char: CHARACTERS[1], name: 'CPU 1' });
  const cpu = a.room().seats[1];
  assert.match(cpu.id, /^[0-9a-f]{16}$/);
  assert.deepEqual(cpu, { id: cpu.id, name: 'CPU 1', char: CHARACTERS[1], online: false, bot: false, vacant: false, cpu: true });
  assert.equal(a.room().leader, a.id, 'a computer never leads');
  await send(a, { t: 'sit', char: CHARACTERS[1] });
  assert.equal(a.errs().at(-1), 'err.charTaken', 'a seated person does not take a computer seat');
  await send(a, { t: 'removeCpu', char: CHARACTERS[0] });
  assert.equal(a.errs().at(-1), 'err.notNow', 'a person is not removed');
  await send(a, { t: 'removeCpu', char: CHARACTERS[1] });
  assert.equal(a.room().seats.length, 1);

  // One person and one computer are enough to play.
  await send(a, { t: 'addCpu', char: CHARACTERS[2], name: 'CPU 1' });
  await send(a, { t: 'start' });
  assert.equal(a.game().players.length, 2);
  await send(a, { t: 'addCpu', char: CHARACTERS[3], name: 'CPU 2' });
  assert.equal(a.errs().at(-1), 'err.notInLobby');
  await send(a, { t: 'removeCpu', char: CHARACTERS[2] });
  assert.equal(a.errs().at(-1), 'err.notInLobby');
  assert.deepEqual([a, b].flatMap((x) => x.bad), []);
});

test('a newcomer in the lobby takes a computer seat in its place', async () => {
  const { host, clients } = await seated(1);
  const [a] = clients;
  await send(a, { t: 'addCpu', char: CHARACTERS[1], name: 'CPU 1' });
  await send(a, { t: 'addCpu', char: CHARACTERS[2], name: 'CPU 2' });
  const b = await connect(host, 1);
  await send(b, { t: 'sit', char: CHARACTERS[1] });
  assert.deepEqual(a.room().seats.map((s) => [s.name, s.char, s.cpu]), [
    ['P0', CHARACTERS[0], false], ['P1', CHARACTERS[1], false], ['CPU 2', CHARACTERS[2], true],
  ]);
  assert.deepEqual(seatOf(a, b.id), { id: b.id, name: 'P1', char: CHARACTERS[1], online: true, bot: false, vacant: false, cpu: false });
  assert.deepEqual(a.room().spectators, []);
  await send(a, { t: 'removeCpu', char: CHARACTERS[1] });
  assert.equal(a.errs().at(-1), 'err.notNow', 'the seat is a person now');
  assert.deepEqual([a, b].flatMap((x) => x.bad), []);
});

test('a computer player is never released, plays its turns one step apart, and a spectator may take it over', async () => {
  const { host, clock, clients } = await seated(1);
  const ctx = { host, clock };
  const [a] = clients;
  await send(a, { t: 'addCpu', char: CHARACTERS[1], name: 'CPU 1' });
  const cpu = a.room().seats[1].id;
  await at(ctx, clock.now + HOST_TIMING.seatReleaseMs, [a]);
  assert.equal(a.room().seats.length, 2, 'the lobby keeps the computer seat');

  await send(a, { t: 'start' });
  const watcher = await connect(host, 9);
  const p = host.snapshot().game.players.findIndex((pl) => pl.id === cpu);
  // The person never acts: their turns end by timeouts.
  let steps = 0;
  while (host.snapshot().game.current !== p) {
    steps += 1;
    assert.ok(steps < 200, 'the computer never got a turn');
    await at(ctx, Math.max(clock.now + 1, host.snapshot().game.deadline ?? 0), [a, watcher]);
  }
  const before = JSON.stringify(host.snapshot().game);
  for (let i = 0; i < 2 && JSON.stringify(host.snapshot().game) === before; i += 1) {
    await at(ctx, clock.now + HOST_TIMING.botStepMs, [a, watcher]);
  }
  assert.notEqual(JSON.stringify(host.snapshot().game), before, 'the computer moved within two steps');
  assert.equal(logOf(ctx).some((l) => l.key === 'log.timeout' && l.params.p === p), false);
  assert.deepEqual({ bot: seatOf(a, cpu).bot, vacant: seatOf(a, cpu).vacant }, { bot: false, vacant: false });
  assert.equal(logOf(ctx).some((l) => l.key === 'log.botOn'), false);

  // The spectator plays on from where the computer stopped; the computer moves no more.
  await send(watcher, { t: 'claim', char: CHARACTERS[1] });
  assert.equal(host.snapshot().game.players[p].id, watcher.id);
  assert.deepEqual(seatOf(a, watcher.id), { id: watcher.id, name: 'P9', char: CHARACTERS[1], online: true, bot: false, vacant: false, cpu: false });
  assert.equal(seatOf(a, cpu), undefined);
  assert.deepEqual(logOf(ctx).at(-1), { ...logOf(ctx).at(-1), key: 'log.seatClaimed', params: { p, name: 'CPU 1' } });
  const claimed = JSON.stringify(host.snapshot().game);
  await at(ctx, clock.now + HOST_TIMING.botStepMs * 2, [a, watcher]);
  assert.equal(JSON.stringify(host.snapshot().game), claimed, 'the computer no longer plays the seat');
  assert.deepEqual([a, watcher].flatMap((x) => x.bad), []);
});

// A room run by client 0's tab: its own loopback connection is a member like the others.
async function hostedBy0() {
  const clock = { now: 1_000_000 };
  const host = createHostRoom({ selfId: await idFromSecret(secretOf(0)), clock: () => clock.now, seedFn: () => 7 });
  const clients = [];
  for (let i = 0; i < 3; i += 1) clients.push(await connect(host, i));
  clock.now += HOST_TIMING.recoverMs;
  return { host, clock, clients };
}

test('host handover: one request at a time, the host may decline, else the room moves on at the deadline', async () => {
  const ctx = await hostedBy0();
  const [h, b, c] = ctx.clients;
  await send(h, { t: 'takeover' });
  assert.equal(h.errs().at(-1), 'err.notNow', 'the host does not ask itself');
  await send(h, { t: 'handover', ok: true });
  assert.equal(h.errs().at(-1), 'err.notNow', 'nothing to answer yet');

  await send(b, { t: 'takeover' });
  assert.deepEqual(c.room().handover, { by: b.id, until: ctx.clock.now + HOST_TIMING.handoverMs });
  await send(c, { t: 'takeover' });
  assert.equal(c.errs().at(-1), 'err.notNow', 'one request at a time');
  await send(b, { t: 'handover', ok: true });
  assert.equal(b.errs().at(-1), 'err.notNow', 'only the host answers');
  await send(h, { t: 'handover', ok: false });
  assert.equal(b.errs().at(-1), 'err.handoverDeclined');
  assert.equal(c.errs().includes('err.handoverDeclined'), false);
  assert.equal(c.room().handover, null);

  // Asked again and not answered: at the deadline the room moves to the next generation.
  await send(b, { t: 'takeover' });
  const due = c.room().handover.until;
  await at(ctx, due - 1, [h, b, c]);
  assert.equal(c.last('move'), undefined);
  await at(ctx, due, [h, b, c]);
  for (const x of ctx.clients) assert.deepEqual(x.last('move'), { t: 'move', gen: 1, heir: b.id });
  assert.equal(c.room().gen, 1, 'the last state already carries the new generation');
  assert.equal(c.room().handover, null);

  // From then on the old room only redirects.
  const seen = c.msgs.length;
  await send(c, { t: 'chat', text: 'hi' });
  await at(ctx, due + HOST_TIMING.beatMs * 2, [h, b, c]);
  assert.equal(c.msgs.length, seen, 'no replies, states or beats after the move');
  const late = await connect(ctx.host, 5);
  assert.deepEqual(late.last('move'), { t: 'move', gen: 1, heir: b.id });
  assert.equal(late.closed, true);
  assert.deepEqual([...ctx.clients, late].flatMap((x) => x.bad), []);
});

test('host handover: the host may hand over at once; a request ends when the asker leaves', async () => {
  const ctx = await hostedBy0();
  const [h, b, c] = ctx.clients;
  await send(c, { t: 'takeover' });
  assert.equal(b.room().handover.by, c.id);
  c.close();
  await flush();
  assert.equal(b.room().handover, null);
  await send(b, { t: 'takeover' });
  await send(h, { t: 'handover', ok: true });
  assert.deepEqual(b.last('move'), { t: 'move', gen: 1, heir: b.id });
  assert.equal(h.last('move').heir, b.id);
});

test('giving way sends everyone to the next generation once, with no heir', async () => {
  const ctx = await hostedBy0();
  const states = ctx.clients[1].msgs.filter((m) => m.t === 'state').length;
  ctx.host.giveWay();
  ctx.host.giveWay();
  await flush();
  for (const x of ctx.clients) assert.deepEqual(x.msgs.filter((m) => m.t === 'move'), [{ t: 'move', gen: 1, heir: null }]);
  assert.equal(ctx.clients[1].msgs.filter((m) => m.t === 'state').length, states, 'no state that could outrank the other room');
});

test('every member lost, closed or gone silent, makes the host look for a newer room', async () => {
  const clock = { now: 1_000_000 };
  let drops = 0;
  const host = createHostRoom({ selfId: HOST_ID, clock: () => clock.now, seedFn: () => 7, onDrop: () => (drops += 1) });
  const [a, b, c] = [await connect(host, 0), await connect(host, 1), await connect(host, 2)];
  assert.equal(drops, 0);
  // A tab that hung sees its members' connections closed once it wakes up.
  a.close();
  await flush();
  assert.equal(drops, 1);
  clock.now += HOST_TIMING.silentMs / 2;
  await send(b, { t: 'beat' });
  clock.now += HOST_TIMING.silentMs / 2 + 1;
  host.tick();
  await flush();
  assert.equal(c.closed, true);
  assert.equal(drops, 2, 'or drops them for silence');
  host.giveWay();
  b.close();
  await flush();
  assert.equal(drops, 2, 'not once the room has moved');
});
