// PeerJS transport (WebRTC data channels, signalling through the public
// 0.peerjs.com server). Same interface as transport-fake.js:
//
//   listen(roomId) -> { ok: true, server } | { ok: false, reason: 'taken' | 'error' }
//   dial(roomId)   -> conn | null
//   server: { onConn(fn), onLost(fn), close() }
//   conn:   { send(msg), onMessage(fn), onClose(fn), close() }
//
// Behaviour taken from the peerjs 1.5.5 source (node_modules/peerjs/dist/bundler.mjs):
// - a fixed id that is already registered fails with error type 'unavailable-id';
// - after the signalling socket drops, the peer is 'disconnected' but its data
//   connections stay up; reconnect() registers the same id again, and fails with
//   'unavailable-id' if another tab took it in the meantime;
// - close({ flush: true }) sends a close marker after the queued data, and the
//   local 'close' event only fires once the other side has closed.

import { Peer } from 'peerjs';

// 'binary' (BinaryPack, chunked): 'json' silently drops messages over ~16 KB
// (dev-log/spikes/2026-10-04-peerjs-host-election.md).
const CONN_OPTS = { reliable: true, serialization: 'binary' };
const OPEN_TIMEOUT_MS = 10000; // signalling or data channel not open by then -> give up
const FLUSH_MS = 1000; // a flushed close that the other side never answers is forced
const RECONNECT_MS = 3000; // retry interval for the signalling socket of the host

function wrap(dc, onEnd = () => {}) {
  const closers = [];
  let ended = false;
  let closing = false;
  dc.on('close', () => {
    if (ended) return;
    ended = true;
    onEnd();
    for (const fn of closers) fn();
  });
  return {
    send(msg) {
      if (!closing && dc.open) dc.send(msg);
    },
    onMessage(fn) {
      dc.on('data', fn);
    },
    onClose(fn) {
      closers.push(fn);
    },
    close() {
      if (closing) return;
      closing = true;
      dc.close({ flush: true });
      setTimeout(() => dc.close(), FLUSH_MS);
    },
  };
}

// A promise with a timeout: `settle(done)` wires events to done(value); the
// first call wins, and the timeout resolves with `fallback`.
function race(settle, fallback) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), OPEN_TIMEOUT_MS);
    settle((value) => {
      clearTimeout(timer);
      resolve(value);
    });
  });
}

export const peerTransport = {
  async listen(roomId) {
    const peer = new Peer(roomId);
    const result = await race((done) => {
      peer.once('open', () => done('ok'));
      peer.once('error', (err) => done(err.type === 'unavailable-id' ? 'taken' : 'error'));
    }, 'error');
    if (result !== 'ok') {
      peer.destroy();
      return { ok: false, reason: result };
    }

    const connListeners = [];
    const lostListeners = [];
    let closed = false;
    const lose = () => {
      if (closed) return;
      closed = true;
      peer.destroy();
      for (const fn of lostListeners) fn();
    };

    peer.on('connection', (dc) => {
      const timer = setTimeout(() => dc.close(), OPEN_TIMEOUT_MS);
      dc.once('open', () => {
        clearTimeout(timer);
        if (closed) return dc.close();
        const conn = wrap(dc);
        for (const fn of connListeners) fn(conn);
        return undefined;
      });
    });
    // Keep the room id registered so that new tabs can still find this host.
    peer.on('disconnected', () => {
      setTimeout(() => {
        if (!closed && peer.disconnected && !peer.destroyed) peer.reconnect();
      }, RECONNECT_MS);
    });
    peer.on('error', (err) => {
      if (err.type === 'unavailable-id') lose(); // another tab owns the room now
    });
    peer.on('close', lose);

    return {
      ok: true,
      server: {
        onConn: (fn) => connListeners.push(fn),
        onLost: (fn) => lostListeners.push(fn),
        close() {
          closed = true;
          peer.destroy();
        },
      },
    };
  },

  async dial(roomId) {
    const peer = new Peer();
    const dc = await race((done) => {
      peer.once('error', () => done(null)); // 'peer-unavailable' when no tab holds the room id
      peer.once('open', () => {
        const conn = peer.connect(roomId, CONN_OPTS);
        conn.once('open', () => done(conn));
        conn.once('close', () => done(null));
      });
    }, null);
    if (!dc) {
      peer.destroy();
      return null;
    }
    // Each connection has its own short-lived peer; free its id when done.
    return wrap(dc, () => peer.destroy());
  },
};
