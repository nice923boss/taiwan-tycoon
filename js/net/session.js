// The connection loop of one tab. Every tab first tries to claim the fixed room
// id: the tab that gets it runs the authoritative room (host-room.js) and joins
// its own room over a loopback pair; the others dial the room. When the host
// goes away (closed, crashed, or lost the id), the remaining tabs reconnect,
// the first one to claim the id becomes the new host, and the newest snapshot
// offered in the hellos is adopted.
//
// The UI sees one state object: { status, reason, room, game, chat, you, isHost, offset }
//   status: 'connecting' | 'online' | 'stopped'; reason: error key when stopped
//   offset: host clock minus local clock, for deadline countdowns

import { createHostRoom, HOST_TIMING } from './host-room.js';
import { idFromSecret } from './identity.js';
import { pair } from './pair.js';
import { CHAT_KEEP, PROTOCOL_VERSION, parseHostMsg, parseSnapshot } from './protocol.js';
import { randomSeed } from '../engine/rng.js';

export const SESSION_TIMING = {
  tickMs: 500, // host room timers
  beatMs: 2000, // heartbeat sent to the host
  silentMs: 10000, // no message from the host for this long -> reconnect
  retryMinMs: 1000, // backoff after a failed attempt: 1 s, 2 s, 4 s, then 5 s
  retryMaxMs: 5000,
  jitterMs: 400, // random delay so that tabs do not reconnect in lockstep
  host: HOST_TIMING,
};

// The host ends the connection for good: retrying would fail the same way.
const FATAL = new Set(['err.version', 'err.replaced', 'err.roomFull']);

export function createSession({
  transport,
  roomId,
  secret,
  name,
  storage = globalThis.sessionStorage,
  timing = SESSION_TIMING,
  clock = Date.now,
  seedFn = randomSeed,
  random = Math.random,
}) {
  const updateFns = [];
  const errorFns = [];
  const snapKey = `monopoly.snap:${roomId}`; // per room: ?room= changes the game, not the tab
  const saved = loadSnap();
  let state = {
    status: 'connecting',
    reason: null,
    room: saved?.room ?? null,
    game: saved?.game ?? null,
    chat: saved?.chat ?? [],
    you: null,
    isHost: false,
    offset: 0,
  };
  let link = null; // { conn, welcomed, lastMsg, timer } for the current connection
  let hosting = null; // { server, room, timer } while this tab is the host
  let retryTimer = null;
  let attempt = 0;
  let stopped = false;
  let myName = name;

  // ---------- state ----------

  function setState(fields) {
    state = { ...state, ...fields };
    for (const fn of updateFns) fn(state);
  }

  function loadSnap() {
    try {
      const raw = storage?.getItem(snapKey);
      return raw ? parseSnapshot(JSON.parse(raw)) : null;
    } catch {
      return null; // unreadable or from an older version: start without it
    }
  }

  function saveSnap() {
    if (!state.room) return;
    try {
      storage?.setItem(snapKey, JSON.stringify({ room: state.room, game: state.game, chat: state.chat }));
    } catch {
      // Storage full or blocked: the game goes on, only this tab's copy for a
      // host migration is missing (the other tabs still offer theirs).
    }
  }

  // ---------- connect loop ----------

  async function connect() {
    retryTimer = null;
    if (stopped) return;
    const claim = await transport.listen(roomId);
    if (stopped) {
      if (claim.ok) claim.server.close();
      return;
    }
    if (claim.ok) {
      host(claim.server);
      return;
    }
    if (claim.reason === 'taken') {
      const conn = await transport.dial(roomId);
      if (stopped) {
        conn?.close();
        return;
      }
      if (conn) {
        open(conn);
        return;
      }
    }
    retry(false);
  }

  // After losing a working connection retry at once (plus jitter); after a
  // failed attempt back off.
  function retry(quick) {
    if (stopped) return;
    const wait = quick ? 0 : Math.min(timing.retryMaxMs, timing.retryMinMs * 2 ** attempt);
    if (!quick) attempt += 1;
    retryTimer = setTimeout(connect, wait + random() * timing.jitterMs);
  }

  function host(server) {
    const room = createHostRoom({ selfId: state.you, snap: loadSnap(), clock, seedFn, timing: timing.host });
    hosting = { server, room, timer: setInterval(room.tick, timing.tickMs) };
    server.onConn(room.attach);
    server.onLost(() => {
      if (hosting?.server === server) end(link);
    });
    const [hostSide, mySide] = pair();
    room.attach(hostSide);
    open(mySide);
  }

  function stepDown() {
    clearInterval(hosting.timer);
    hosting.room.close();
    hosting.server.close();
    hosting = null;
  }

  function open(conn) {
    const current = { conn, welcomed: false, lastMsg: clock(), timer: null };
    link = current;
    conn.onMessage((raw) => {
      if (link !== current) return;
      const msg = parseHostMsg(raw);
      if (!msg) return;
      current.lastMsg = clock();
      HANDLERS[msg.t](msg, current);
    });
    conn.onClose(() => end(current));
    current.timer = setInterval(() => {
      if (clock() - current.lastMsg > timing.silentMs) end(current);
      else if (current.welcomed) conn.send({ t: 'beat' });
    }, timing.beatMs);
    conn.send({ t: 'hello', v: PROTOCOL_VERSION, secret, name: myName, snap: loadSnap() });
  }

  // The connection is over (closed, silent, or the host lost the room).
  function end(current) {
    if (!current || link !== current) return;
    link = null;
    clearInterval(current.timer);
    current.conn.close();
    if (hosting) stepDown();
    if (stopped) return;
    setState({ status: 'connecting', isHost: false });
    retry(true);
  }

  // ---------- host messages ----------

  const HANDLERS = {
    welcome(msg, current) {
      current.welcomed = true;
      attempt = 0;
      setState({ status: 'online', you: msg.id, isHost: hosting !== null });
    },
    state(msg) {
      setState({ room: msg.room, game: msg.game, offset: msg.now - clock() });
      saveSnap();
    },
    chat(msg) {
      setState({ chat: msg.reset ? msg.lines : [...state.chat, ...msg.lines].slice(-CHAT_KEEP) });
      saveSnap();
    },
    err(msg) {
      for (const fn of errorFns) fn(msg.key, msg.params);
    },
    bye(msg) {
      if (FATAL.has(msg.key)) stop(msg.key);
    },
    // Keeps the clock offset fresh without a redraw.
    beat(msg) {
      state = { ...state, offset: msg.now - clock() };
    },
  };

  // ---------- API ----------

  // Commands go out only once the host has accepted this tab.
  function send(cmd) {
    if (!link?.welcomed) return false;
    link.conn.send(cmd);
    return true;
  }

  function setName(next) {
    myName = next;
    send({ t: 'name', name: next });
  }

  function stop(reason = null) {
    if (stopped) return;
    stopped = true;
    clearTimeout(retryTimer);
    const current = link;
    link = null;
    if (current) {
      clearInterval(current.timer);
      current.conn.close();
    }
    if (hosting) stepDown();
    setState({ status: 'stopped', reason, isHost: false });
  }

  const ready = idFromSecret(secret).then((id) => {
    setState({ you: id });
    return connect();
  });

  return {
    onUpdate: (fn) => updateFns.push(fn),
    onError: (fn) => errorFns.push(fn),
    send,
    setName,
    stop: () => stop(),
    ready,
    get state() {
      return state;
    },
  };
}
