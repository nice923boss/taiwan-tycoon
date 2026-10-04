// The authoritative room, run only by the host tab. It owns the lobby (seats,
// spectators, chat) and the full game state (with RNG), applies every command,
// and broadcasts the public view. Transport-agnostic: it is given connections
// ({ send, onMessage, onClose, close }) and a clock, so tests drive it directly.
//
// Host migration: a new host starts from its own saved snapshot and adopts any
// newer snapshot (higher epoch, then rev) offered in a hello, until the first
// accepted state change. Commands are refused for `recoverMs` after claiming so
// that reconnecting peers can offer their snapshots first.

import { computerAction } from '../engine/bot.js';
import { actorOf, applyAction, createGame, rehydrate, sanitize } from '../engine/game.js';
import { randomSeed } from '../engine/rng.js';
import { RULES } from '../engine/rules.js';
import { log, setPhase } from '../engine/state.js';
import { idFromSecret } from './identity.js';
import { CHAT_KEEP, MAX_CONNS, PROTOCOL_VERSION, parseClientMsg } from './protocol.js';

export const HOST_TIMING = {
  beatMs: 2000, // heartbeat sent to every peer
  silentMs: 10000, // a connection with no message for this long is dropped
  seatReleaseMs: 30000, // offline seat: freed in the lobby, open to spectators in a game
  offlineActMs: 8000, // offline player in a game: the computer plays the seat
  botStepMs: 1500, // pause before each computer move
  tickSlackMs: 250, // ticks (~500 ms) run late by varying amounts: a move due this soon goes now
  recoverMs: 2000, // commands refused right after claiming the room
  chatWindowMs: 4000,
  chatPerWindow: 4,
};

const newer = (a, b) => a.epoch > b.epoch || (a.epoch === b.epoch && a.rev > b.rev);

export function createHostRoom({ selfId, snap = null, clock = Date.now, seedFn = randomSeed, timing = HOST_TIMING }) {
  const members = new Map(); // id -> { id, name, conn, lastSeen, chatTimes }; conn is null while a seated member is away
  const offlineAt = new Map(); // seat id -> time the seat went offline
  const conns = new Set(); // every attached connection, identified or not
  const claimedAt = clock();
  let basis = { epoch: -1, rev: -1 }; // the snapshot this room continues from
  let adoptOpen = true;
  let room = { epoch: 0, rev: 0, stage: 'lobby', seats: [], spectators: [], leader: null, host: selfId, rounds: RULES.defaultRounds };
  let game = null;
  let chat = [];
  let chatSeq = 0;
  let lastBeat = claimedAt;
  let nextBotAt = claimedAt;
  let botKey = null; // the computer decision that nextBotAt is timing

  // ---------- helpers ----------

  const isSeated = (id) => room.seats.some((seat) => seat.id === id);
  const seatOf = (id) => room.seats.find((seat) => seat.id === id);
  const indexOf = (id) => game.players.findIndex((pl) => pl.id === id);
  const isOnline = (id) => members.get(id)?.conn != null;
  const reply = (conn, key, params = {}) => conn.send({ t: 'err', key, params });

  // Derived fields: spectators are connected members without a seat; the
  // leader (who sets rounds and starts) is the first seat that is online.
  function refresh() {
    const spectators = [...members.values()]
      .filter((m) => m.conn && !isSeated(m.id))
      .map((m) => ({ id: m.id, name: m.name }));
    room = { ...room, spectators, leader: room.seats.find((seat) => seat.online)?.id ?? null };
  }

  function setSeat(id, fields) {
    room = { ...room, seats: room.seats.map((seat) => (seat.id === id ? { ...seat, ...fields } : seat)) };
  }

  function broadcast(msg) {
    for (const m of members.values()) m.conn?.send(msg);
  }

  function broadcastState() {
    refresh();
    room = { ...room, rev: room.rev + 1 };
    broadcast({ t: 'state', now: clock(), room, game: game ? sanitize(game) : null });
  }

  // An accepted command or timeout: after this, offered snapshots are ignored.
  function changed() {
    adoptOpen = false;
    broadcastState();
  }

  // A game log line from the room itself (not from an action).
  function note(key, params) {
    game = structuredClone(game);
    log(game, key, params);
  }

  // ---------- snapshot adoption ----------

  function adopt(s) {
    if (s.game && !s.game.players.every((pl) => s.room.seats.some((seat) => seat.id === pl.id))) return;
    const now = clock();
    basis = { epoch: s.room.epoch, rev: s.room.rev };
    game = s.game ? rehydrate(s.game, seedFn()) : null;
    if (game && game.phase !== 'gameOver') {
      game.turnStartedAt = now;
      setPhase(game, game.phase, now);
    }
    room = {
      ...s.room,
      epoch: basis.epoch + 1,
      rev: 0,
      host: selfId,
      seats: s.room.seats.map((seat) => {
        const online = isOnline(seat.id);
        return { ...seat, online, bot: !online && seat.bot, vacant: !online && seat.vacant };
      }),
    };
    // Offline seats keep their computer / vacant status: date their absence to match.
    for (const seat of room.seats) {
      if (seat.online || offlineAt.has(seat.id)) continue;
      offlineAt.set(seat.id, now - (seat.vacant ? timing.seatReleaseMs : seat.bot ? timing.offlineActMs : 0));
    }
    chat = s.chat.slice(-CHAT_KEEP);
    chatSeq = chat.reduce((max, line) => Math.max(max, line.n), 0);
    refresh();
  }

  // ---------- connections ----------

  function attach(conn) {
    conns.add(conn);
    let memberId = null;
    let helloSeen = false;
    conn.onMessage(async (raw) => {
      const msg = parseClientMsg(raw);
      if (!msg) return;
      if (!memberId) {
        if (msg.t !== 'hello' || helloSeen) return;
        helloSeen = true;
        if (msg.v !== PROTOCOL_VERSION) {
          conn.send({ t: 'bye', key: 'err.version' });
          conn.close();
          return;
        }
        const id = await idFromSecret(msg.secret);
        if (!conns.has(conn)) return; // closed while hashing
        if (join(conn, id, msg)) memberId = id;
        return;
      }
      const m = members.get(memberId);
      if (!m || m.conn !== conn) return;
      m.lastSeen = clock();
      if (msg.t !== 'beat') command(m, msg);
    });
    conn.onClose(() => {
      conns.delete(conn);
      const m = memberId && members.get(memberId);
      if (m && m.conn === conn) leave(m);
    });
  }

  function join(conn, id, hello) {
    const prev = members.get(id);
    const connected = [...members.values()].filter((m) => m.conn).length;
    if (!prev?.conn && connected >= MAX_CONNS) {
      conn.send({ t: 'bye', key: 'err.roomFull' });
      conn.close();
      return false;
    }
    if (prev?.conn) {
      prev.conn.send({ t: 'bye', key: 'err.replaced' });
      prev.conn.close();
    }
    if (hello.snap && adoptOpen && newer(hello.snap.room, basis)) adopt(hello.snap);
    members.set(id, { id, name: hello.name, conn, lastSeen: clock(), chatTimes: prev?.chatTimes ?? [] });
    offlineAt.delete(id);
    // In a game the seat keeps the name the game was started with, and the computer stops.
    if (isSeated(id) && room.stage === 'lobby') setSeat(id, { online: true, name: hello.name });
    if (isSeated(id) && room.stage === 'game') {
      if (seatOf(id).bot) note('log.botOff', { p: indexOf(id) });
      setSeat(id, { online: true, bot: false, vacant: false });
    }
    conn.send({ t: 'welcome', id });
    conn.send({ t: 'chat', lines: chat, reset: true });
    broadcastState();
    return true;
  }

  function leave(m) {
    m.conn = null;
    if (isSeated(m.id)) {
      setSeat(m.id, { online: false });
      offlineAt.set(m.id, clock());
    } else {
      members.delete(m.id);
    }
    broadcastState();
  }

  // ---------- commands ----------

  function command(m, msg) {
    if (clock() - claimedAt < timing.recoverMs) return reply(m.conn, 'err.recovering');
    const err = COMMANDS[msg.t](m, msg, clock());
    if (err) reply(m.conn, err.key, err.params ?? {});
    return undefined;
  }

  const lobbyOnly = (fn) => (m, msg, now) => (room.stage === 'lobby' ? fn(m, msg, now) : { key: 'err.notInLobby' });
  const leaderOnly = (fn) => (m, msg, now) => (room.leader === m.id ? fn(m, msg, now) : { key: 'err.notLeader' });

  const COMMANDS = {
    // One character per seat and as many characters as seats, so a free
    // character always means a free seat.
    sit: lobbyOnly((m, msg) => {
      if (room.seats.some((seat) => seat.char === msg.char && seat.id !== m.id)) return { key: 'err.charTaken' };
      if (isSeated(m.id)) setSeat(m.id, { char: msg.char });
      else room = { ...room, seats: [...room.seats, { id: m.id, name: m.name, char: msg.char, online: true, bot: false, vacant: false }] };
      changed();
      return null;
    }),
    stand: lobbyOnly((m) => {
      if (!isSeated(m.id)) return { key: 'err.notNow' };
      room = { ...room, seats: room.seats.filter((seat) => seat.id !== m.id) };
      changed();
      return null;
    }),
    rounds: lobbyOnly(leaderOnly((m, msg) => {
      room = { ...room, rounds: msg.n };
      changed();
      return null;
    })),
    start: lobbyOnly(leaderOnly((m, msg, now) => {
      if (room.seats.length < RULES.minPlayers) return { key: 'err.needPlayers', params: { n: RULES.minPlayers } };
      const players = room.seats.map(({ id, name, char }) => ({ id, name, char }));
      game = createGame({ players, seed: seedFn(), now, maxRounds: room.rounds });
      room = { ...room, stage: 'game' };
      changed();
      return null;
    })),
    again: leaderOnly(() => {
      if (room.stage !== 'game' || game?.phase !== 'gameOver') return { key: 'err.notNow' };
      game = null;
      room = { ...room, stage: 'lobby', seats: room.seats.map((seat) => ({ ...seat, bot: false, vacant: false })) };
      changed();
      return null;
    }),
    act: (m, msg, now) => {
      if (room.stage !== 'game') return { key: 'err.notNow' };
      const p = game.players.findIndex((pl) => pl.id === m.id);
      if (p < 0) return { key: 'err.notAPlayer' };
      const res = applyAction(game, { ...msg.a, p }, { now });
      if (res.error) return res.error;
      game = res.game;
      changed();
      return null;
    },
    chat: (m, msg, now) => {
      const recent = m.chatTimes.filter((ts) => now - ts < timing.chatWindowMs);
      if (recent.length >= timing.chatPerWindow) return { key: 'err.chatTooFast' };
      m.chatTimes = [...recent, now];
      chatSeq += 1;
      // Seat names freeze when the game starts; use them so chat matches the player list.
      const name = room.seats.find((seat) => seat.id === m.id)?.name ?? m.name;
      const line = { n: chatSeq, id: m.id, name, text: msg.text, ts: now };
      chat = [...chat, line].slice(-CHAT_KEEP);
      adoptOpen = false;
      broadcast({ t: 'chat', lines: [line], reset: false });
      return null;
    },
    // A spectator takes over the seat of a player who has been away for seatReleaseMs.
    claim: (m, msg) => {
      if (room.stage !== 'game' || isSeated(m.id)) return { key: 'err.notNow' };
      const seat = room.seats.find((s) => s.char === msg.char);
      const p = seat ? indexOf(seat.id) : -1;
      if (!seat?.vacant || game.phase === 'gameOver' || game.players[p].bankrupt) return { key: 'err.seatNotVacant' };
      game = structuredClone(game);
      game.players[p] = { ...game.players[p], id: m.id, name: m.name };
      log(game, 'log.seatClaimed', { p, name: seat.name });
      setSeat(seat.id, { id: m.id, name: m.name, online: true, bot: false, vacant: false });
      offlineAt.delete(seat.id);
      members.delete(seat.id);
      changed();
      return null;
    },
    name: (m, msg) => {
      m.name = msg.name;
      if (isSeated(m.id) && room.stage === 'lobby') setSeat(m.id, { name: msg.name });
      changed();
      return null;
    },
    hello: () => ({ key: 'err.badRequest' }),
  };

  // ---------- timers (called every ~500 ms) ----------

  function tick() {
    const now = clock();
    if (now - lastBeat >= timing.beatMs) {
      lastBeat = now;
      broadcast({ t: 'beat', now });
    }
    for (const m of members.values()) {
      if (m.conn && now - m.lastSeen > timing.silentMs) m.conn.close();
    }
    if (room.stage === 'lobby') {
      const stale = room.seats.filter((seat) => !seat.online && now - offlineAt.get(seat.id) >= timing.seatReleaseMs);
      if (stale.length === 0) return;
      room = { ...room, seats: room.seats.filter((seat) => !stale.includes(seat)) };
      for (const seat of stale) {
        offlineAt.delete(seat.id);
        if (!isOnline(seat.id)) members.delete(seat.id);
      }
      changed();
      return;
    }
    if (game.phase === 'gameOver' || now - claimedAt < timing.recoverMs) return;
    if (updateAway(now)) broadcastState();
    // The computer pauses botStepMs before each new decision so people can
    // follow it; changes that leave its decision as it was (renames, stock
    // trades by others) do not restart the pause. Without the slack, a late
    // tick would push every following move to the fourth tick (2 s).
    const turn = botTurn();
    if ((turn?.key ?? null) !== botKey) {
      botKey = turn?.key ?? null;
      nextBotAt = now + timing.botStepMs;
    }
    if (turn && now + timing.tickSlackMs >= nextBotAt) {
      const res = applyAction(game, computerAction(game, turn.p), { now });
      if (!res.error) {
        game = res.game;
        botKey = botTurn()?.key ?? null;
        nextBotAt = now + timing.botStepMs;
        changed();
        return;
      }
    }
    if (game.deadline === null || now < game.deadline) return;
    const res = applyAction(game, { type: 'TIMEOUT' }, { now });
    if (res.error) return;
    game = res.game;
    changed();
  }

  // The seat the computer must act for now, with a key that changes on each
  // new decision (phase entries reset the deadline); null when there is none.
  function botTurn() {
    const p = actorOf(game).find((i) => seatOf(game.players[i].id)?.bot);
    return p === undefined ? null : { p, key: `${p}:${game.phase}:${game.deadline}` };
  }

  // Seats of players away from a running game: the computer plays them after
  // offlineActMs, and spectators may take them over after seatReleaseMs.
  // Returns whether any seat changed.
  function updateAway(now) {
    let flipped = false;
    for (const seat of room.seats) {
      const p = indexOf(seat.id);
      const away = !seat.online && p >= 0 && !game.players[p].bankrupt ? now - offlineAt.get(seat.id) : -1;
      const bot = away >= timing.offlineActMs;
      const vacant = away >= timing.seatReleaseMs;
      if (bot === seat.bot && vacant === seat.vacant) continue;
      if (bot && !seat.bot) note('log.botOn', { p });
      setSeat(seat.id, { bot, vacant });
      flipped = true;
    }
    return flipped;
  }

  // What the host tab saves to sessionStorage (same shape as a client's).
  function snapshot() {
    return { room, game: game ? sanitize(game) : null, chat };
  }

  function close() {
    for (const conn of conns) conn.close();
  }

  if (snap) adopt(snap);
  return { attach, tick, snapshot, close };
}
