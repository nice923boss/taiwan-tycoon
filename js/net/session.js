// The connection loop of one tab. The room lives on one of two ids that
// alternate by host generation (idOf): every tab first tries to claim the id of
// the newest generation it knows; the tab that gets it runs the authoritative
// room (host-room.js) and joins its own room over a loopback pair, the others
// dial both ids. When the host goes away (closed, crashed, or lost the id), the
// remaining tabs reconnect, the first one to claim an id becomes the new host,
// and the newest snapshot offered in the hellos is adopted.
//
// Handover: a member asks to take over (takeover()); the host room moves to the
// next generation and the asker claims its id, the others follow. A host that
// does not answer at all (frozen tab) keeps its id until the signalling server
// lets go of it, so the asker claims the other id by force. A host that finds a
// host on the other id (it was replaced while frozen, or it is a newcomer that
// claimed an id the room had left) gives way to it.
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
  moveDelayMs: 1500, // after a move: the old host keeps its id this long so the message gets out
  followTries: 3, // after a move: dial this many times before trying to claim an id
  forceSlackMs: 3000, // a takeover with no answer from the host for handoverMs plus this: take the room by force
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
  // Even generations use the room id, odd ones a second id beside it.
  const idOf = (g) => (g % 2 === 0 ? roomId : `${roomId}-b`);
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
  let gen = saved?.room.gen ?? 0; // newest host generation this tab knows of
  let link = null; // { conn, welcomed, lastMsg, timer } for the current connection
  let hosting = null; // { server, room, gen, timer, probing } while this tab is the host
  let retryTimer = null;
  let forceTimer = null;
  let attempt = 0;
  let seq = 0; // each connect attempt takes a number; a newer attempt makes older ones give up
  let heir = false; // the room was handed to this tab: claim the new id without looking back
  let follow = 0; // after a move: dial-only attempts left
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

  function begin() {
    clearTimeout(retryTimer);
    retryTimer = null;
    seq += 1;
    return seq;
  }

  const current = (mine) => !stopped && mine === seq;

  async function connect() {
    const mine = begin();
    if (stopped) return;
    if (follow > 0) {
      follow -= 1;
      join(mine, await dialNewest(gen));
      return;
    }
    const g = gen;
    const probing = !heir;
    heir = false;
    const claim = await transport.listen(idOf(g));
    if (!current(mine)) {
      if (claim.ok) claim.server.close();
      return;
    }
    if (claim.ok) {
      host(claim.server, g, probing);
      return;
    }
    if (claim.reason === 'taken') join(mine, await dialNewest(g));
    else retry(false);
  }

  // Take the room by force: join whichever host answers, else claim the next
  // generation's id (the old host may still hold its own). Never claims while
  // a host can be reached, so a tab that only lost its own network cannot split the room.
  async function forceConnect() {
    const mine = begin();
    if (stopped) return;
    const g = gen;
    const conn = await dialNewest(g);
    if (!current(mine) || conn) {
      join(mine, conn);
      return;
    }
    const claim = await transport.listen(idOf(g + 1));
    if (!current(mine)) {
      if (claim.ok) claim.server.close();
      return;
    }
    if (claim.ok) {
      gen = Math.max(gen, g + 1);
      for (const fn of errorFns) fn('err.hostSilent');
      host(claim.server, g + 1, true);
      return;
    }
    if (claim.reason === 'taken') join(mine, await transport.dial(idOf(g + 1)));
    else retry(false);
  }

  // The end of a dial: use the connection, or try again later.
  function join(mine, conn) {
    if (!current(mine)) conn?.close();
    else if (conn) open(conn);
    else retry(false);
  }

  // Dial both ids at once (a host of either generation may be running): the
  // first connection wins; null when neither answers.
  function dialNewest(g) {
    return new Promise((resolve) => {
      let left = 2;
      let won = null;
      for (const id of [idOf(g), idOf(g + 1)]) {
        transport.dial(id).then((conn) => {
          left -= 1;
          if (conn && won) conn.close();
          else if (conn) resolve((won = conn));
          else if (left === 0 && !won) resolve(null);
        });
      }
    });
  }

  // After losing a working connection retry at once (plus jitter, and `delay`);
  // after a failed attempt back off.
  function retry(quick, delay = 0) {
    if (stopped) return;
    const wait = quick ? delay : Math.min(timing.retryMaxMs, timing.retryMinMs * 2 ** attempt);
    if (!quick) attempt += 1;
    retryTimer = setTimeout(connect, wait + random() * timing.jitterMs);
  }

  // probing: look for a host on the other id first (not for an heir: the old
  // host still holds that id for moveDelayMs).
  function host(server, g, probing) {
    follow = 0;
    const room = createHostRoom({ selfId: state.you, snap: loadSnap(), gen: g, onDrop: () => probe(), clock, seedFn, timing: timing.host });
    hosting = { server, room, gen: g, timer: setInterval(room.tick, timing.tickMs), probing: false };
    server.onConn(room.attach);
    server.onLost(() => {
      if (hosting?.server === server) end(link);
    });
    const [hostSide, mySide] = pair();
    room.attach(hostSide);
    open(mySide);
    if (probing) probe();
  }

  // A host on the other id runs the room (this tab claimed an id the room had
  // left, or was replaced while it hung): give way to it.
  async function probe() {
    const mine = hosting;
    if (!mine || mine.probing) return;
    mine.probing = true;
    const conn = await transport.dial(idOf(mine.gen + 1));
    mine.probing = false;
    if (!conn) return;
    conn.close();
    if (hosting === mine) mine.room.giveWay();
  }

  function stepDown() {
    clearInterval(hosting.timer);
    hosting.room.close();
    hosting.server.close();
    hosting = null;
  }

  function open(conn) {
    const mine = { conn, welcomed: false, lastMsg: clock(), timer: null };
    link = mine;
    conn.onMessage((raw) => {
      if (link !== mine) return;
      const msg = parseHostMsg(raw);
      if (!msg) return;
      mine.lastMsg = clock();
      HANDLERS[msg.t](msg, mine);
    });
    conn.onClose(() => end(mine));
    mine.timer = setInterval(() => {
      if (clock() - mine.lastMsg > timing.silentMs) end(mine);
      else if (mine.welcomed) conn.send({ t: 'beat' });
    }, timing.beatMs);
    conn.send({ t: 'hello', v: PROTOCOL_VERSION, secret, name: myName, snap: loadSnap() });
  }

  // The connection is over (closed, silent, moved, or the host lost the room);
  // reconnect after `delay`.
  function end(mine, delay = 0) {
    if (!mine || link !== mine) return;
    link = null;
    clearInterval(mine.timer);
    mine.conn.close();
    if (hosting) stepDown();
    if (stopped) return;
    setState({ status: 'connecting', isHost: false });
    retry(true, delay);
  }

  // ---------- host messages ----------

  const HANDLERS = {
    welcome(msg, mine) {
      mine.welcomed = true;
      attempt = 0;
      setState({ status: 'online', you: msg.id, isHost: hosting !== null });
    },
    state(msg) {
      gen = Math.max(gen, msg.room.gen);
      setState({ room: msg.room, game: msg.game, offset: msg.now - clock() });
      saveSnap();
    },
    chat(msg) {
      setState({ chat: msg.reset ? msg.lines : [...state.chat, ...msg.lines].slice(-CHAT_KEEP) });
      saveSnap();
    },
    err(msg) {
      if (msg.key === 'err.handoverDeclined') clearTimeout(forceTimer);
      for (const fn of errorFns) fn(msg.key, msg.params);
    },
    bye(msg) {
      if (FATAL.has(msg.key)) stop(msg.key);
    },
    // Keeps the clock offset fresh without a redraw.
    beat(msg) {
      state = { ...state, offset: msg.now - clock() };
    },
    // The room moves to generation msg.gen: the heir claims its id at once, the
    // others give it a moment, then dial. The old host waits before closing so
    // that the message is not cut off with its connections.
    move(msg, mine) {
      gen = Math.max(gen, msg.gen);
      heir = msg.heir !== null && msg.heir === state.you;
      follow = heir ? 0 : timing.followTries;
      attempt = 0;
      if (hosting) setTimeout(() => end(mine), timing.moveDelayMs);
      else end(mine, heir ? 0 : timing.moveDelayMs);
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

  // Ask to run the room. If the host neither declines nor hands over (it hangs,
  // so its messages stopped too), take the room by force.
  function takeover() {
    if (stopped || hosting) return;
    if (!send({ t: 'takeover' })) {
      if (state.room) forceConnect();
      return;
    }
    const g = gen;
    clearTimeout(forceTimer);
    forceTimer = setTimeout(() => {
      const quiet = !link || clock() - link.lastMsg > timing.host.beatMs * 2;
      if (!stopped && !hosting && gen === g && quiet) forceConnect();
    }, timing.host.handoverMs + timing.forceSlackMs);
  }

  function stop(reason = null) {
    if (stopped) return;
    stopped = true;
    clearTimeout(retryTimer);
    clearTimeout(forceTimer);
    const mine = link;
    link = null;
    if (mine) {
      clearInterval(mine.timer);
      mine.conn.close();
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
    takeover,
    // The host's answer to a takeover request: hand over now (true) or decline.
    answerHandover: (ok) => send({ t: 'handover', ok }),
    stop: () => stop(),
    ready,
    get state() {
      return state;
    },
  };
}
