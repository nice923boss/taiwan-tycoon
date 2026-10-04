// Tabs (sessions) on the in-memory transport: host election, reconnects and
// host migration, with real timers scaled down to milliseconds.

import test from 'node:test';
import assert from 'node:assert/strict';
import { HOST_TIMING } from '../js/net/host-room.js';
import { parseSnapshot } from '../js/net/protocol.js';
import { createSession } from '../js/net/session.js';
import { createFakeNet } from '../js/net/transport-fake.js';

const ROOM = 'twmono-test';
const TIMING = {
  tickMs: 10,
  beatMs: 30,
  silentMs: 250,
  retryMinMs: 20,
  retryMaxMs: 80,
  jitterMs: 20,
  host: { ...HOST_TIMING, beatMs: 30, silentMs: 250, recoverMs: 60, seatReleaseMs: 60000, offlineActMs: 60000 },
};
const CHARS = ['bear', 'leopardcat', 'magpie'];
const secretOf = (i) => (0xa0 + i).toString(16).padStart(32, '0');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function memStorage() {
  const data = new Map();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)) };
}

async function until(pred, what, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (pred()) return;
    await sleep(5);
  }
  assert.fail(`timed out waiting for ${what}`);
}

// One browser tab: a session plus the errors it was sent.
function openTab(t, net, i, storage = memStorage()) {
  const s = createSession({ transport: net, roomId: ROOM, secret: secretOf(i), name: `P${i}`, storage, timing: TIMING });
  s.storage = storage;
  s.errors = [];
  s.onError((key) => s.errors.push(key));
  t.after(() => s.stop());
  return s;
}

const online = (tabs) => tabs.every((s) => s.state.status === 'online');
const hosts = (tabs) => tabs.filter((s) => s.state.isHost);
const seatOf = (s, view = s) => view.state.room.seats.find((seat) => seat.id === s.state.you);
// The game without the fields a new host resets (turn clock and deadline).
const core = (g) => ({ ...g, deadline: 0, turnStartedAt: 0 });

async function startedGame(t) {
  const net = createFakeNet();
  const a = openTab(t, net, 0);
  await a.ready;
  const tabs = [a, openTab(t, net, 1), openTab(t, net, 2)];
  await until(() => online(tabs), 'all tabs online');
  await sleep(TIMING.host.recoverMs + 20);
  tabs.forEach((s, i) => s.send({ t: 'sit', char: CHARS[i] }));
  await until(() => tabs.every((s) => s.state.room.seats.length === 3), 'three seats');
  a.send({ t: 'start' });
  await until(() => tabs.every((s) => s.state.game), 'game started everywhere');
  return { net, tabs };
}

// Waits until every live tab is online under one host that continues `epoch`.
async function migrated(tabs, epoch) {
  await until(
    () => online(tabs) && hosts(tabs).length === 1 && tabs.every((s) => s.state.room.epoch === epoch + 1),
    'one new host with every tab online',
  );
  return hosts(tabs)[0];
}

test('the first tab hosts, the others join, and commands reach every tab', async (t) => {
  const net = createFakeNet();
  const a = openTab(t, net, 0);
  assert.equal(a.send({ t: 'beat' }), false, 'nothing is sent before the welcome');
  await a.ready;
  const b = openTab(t, net, 1);
  const c = openTab(t, net, 2);
  const tabs = [a, b, c];
  await until(() => online(tabs) && tabs.every((s) => s.state.room?.spectators.length === 3), 'three spectators');
  assert.deepEqual(tabs.map((s) => s.state.isHost), [true, false, false]);
  assert.ok(tabs.every((s) => s.state.room.host === a.state.you));

  await sleep(TIMING.host.recoverMs + 20);
  tabs.forEach((s, i) => s.send({ t: 'sit', char: CHARS[i] }));
  await until(() => tabs.every((s) => s.state.room.seats.length === 3), 'three seats');
  b.send({ t: 'start' });
  await until(() => b.errors.includes('err.notLeader'), 'leader check');
  a.send({ t: 'start' });
  await until(() => tabs.every((s) => s.state.game), 'game started');

  const g = a.state.game;
  const current = tabs.find((s) => s.state.you === g.players[g.current].id);
  current.send({ t: 'act', a: { type: 'ROLL' } });
  await until(() => tabs.every((s) => s.state.game.logSeq > g.logSeq), 'roll seen by every tab');
  assert.ok(tabs.every((s) => s.state.game.dice !== null));

  b.send({ t: 'chat', text: 'hello' });
  await until(() => tabs.every((s) => s.state.chat.at(-1)?.text === 'hello'), 'chat line');

  // Every tab keeps a snapshot for a later host migration.
  for (const s of tabs) {
    const snap = parseSnapshot(JSON.parse(s.storage.getItem(`monopoly.snap:${ROOM}`)));
    assert.ok(snap, 'saved snapshot passes the schema');
    assert.equal(snap.game.logSeq, s.state.game.logSeq);
    assert.equal(snap.chat.at(-1).text, 'hello');
  }
});

test('closing the host tab hands the same game to another tab, and the old host gets its seat back', async (t) => {
  const { net, tabs } = await startedGame(t);
  const [a, b, c] = tabs;
  const { epoch } = b.state.room;
  const game = b.state.game;

  a.stop();
  assert.equal(a.state.status, 'stopped');
  const next = await migrated([b, c], epoch);
  assert.notEqual(next, a);
  assert.deepEqual(core(next.state.game), core(game));
  assert.equal(seatOf(a, next).online, false);

  // Reload: same secret and storage.
  const a2 = openTab(t, net, 0, a.storage);
  await until(() => a2.state.status === 'online' && seatOf(a2, next)?.online, 'old host back in its seat');
  assert.equal(a2.state.isHost, false);
  assert.equal(a2.state.you, a.state.you);
  assert.deepEqual(core(a2.state.game), core(game));
});

test('a saved game stays with its room: the same tab in another room starts fresh', async (t) => {
  const { net, tabs } = await startedGame(t);
  const [a] = tabs;
  a.stop();
  const other = createSession({ transport: net, roomId: `${ROOM}-other`, secret: secretOf(0), name: 'P0', storage: a.storage, timing: TIMING });
  t.after(() => other.stop());
  assert.equal(other.state.game, null);
  await other.ready;
  await until(() => other.state.status === 'online', 'online in the other room');
  assert.equal(other.state.isHost, true);
  assert.equal(other.state.room.stage, 'lobby');
  assert.equal(other.state.game, null);
});

test('a crashed host is noticed through missing heartbeats', async (t) => {
  const { net, tabs } = await startedGame(t);
  const [a, b, c] = tabs;
  const { epoch } = b.state.room;
  const game = b.state.game;

  const started = Date.now();
  net.rooms.get(ROOM).crash();
  a.stop(); // the tab is gone; nothing it does reaches the others
  const next = await migrated([b, c], epoch);
  assert.ok(Date.now() - started >= TIMING.silentMs, 'detected by the silence timeout');
  assert.deepEqual(core(next.state.game), core(game));
});

test('a host that loses the room id steps down and everyone regroups', async (t) => {
  const { net, tabs } = await startedGame(t);
  const { epoch } = tabs[1].state.room;
  const game = tabs[1].state.game;

  net.rooms.get(ROOM).lose();
  const next = await migrated(tabs, epoch);
  assert.deepEqual(core(next.state.game), core(game));
  assert.ok(tabs.every((s) => seatOf(s, next).online));
});

test('opening the same identity in another tab stops the old tab', async (t) => {
  const { net, tabs } = await startedGame(t);
  const [a, b] = tabs;
  const b2 = openTab(t, net, 1);
  await until(() => b.state.status === 'stopped', 'old tab stopped');
  assert.equal(b.state.reason, 'err.replaced');
  await until(() => b2.state.status === 'online' && seatOf(b2, a).online, 'new tab holds the seat');
});

test('replacing the host tab stops it and the room moves on', async (t) => {
  const { net, tabs } = await startedGame(t);
  const [a, b, c] = tabs;
  const { epoch } = b.state.room;
  const game = b.state.game;

  const a2 = openTab(t, net, 0);
  await until(() => a.state.status === 'stopped', 'old host stopped');
  assert.equal(a.state.reason, 'err.replaced');
  const next = await migrated([a2, b, c], epoch);
  assert.deepEqual(core(next.state.game), core(game));
  assert.ok(seatOf(a2, next).online);
});
