// In-memory transport with the same interface as transport-peer.js, for tests
// of host election, reconnects and host migration without a network.
//
//   listen(roomId) -> { ok: true, server } | { ok: false, reason: 'taken' }
//   dial(roomId)   -> conn | null
//   server: { onConn(fn), onLost(fn), close() }, plus crash() and lose() for tests

import { pair } from './pair.js';

export function createFakeNet() {
  const rooms = new Map();

  const net = {
    async listen(roomId) {
      await Promise.resolve();
      if (rooms.has(roomId)) return { ok: false, reason: 'taken' };
      const listeners = [];
      const lostListeners = [];
      const conns = new Set();
      const server = {
        onConn(fn) {
          listeners.push(fn);
        },
        onLost(fn) {
          lostListeners.push(fn);
        },
        accept(conn) {
          conns.add(conn);
          conn.onClose(() => conns.delete(conn));
          for (const fn of listeners) fn(conn);
        },
        // Clean shutdown (tab closed or reloaded): peers see their connections close.
        close() {
          if (rooms.get(roomId) === server) rooms.delete(roomId);
          for (const conn of conns) conn.close();
        },
        // Silent failure (crash, lost network): the room id is freed but peers
        // get no close event and must notice through missing heartbeats.
        crash() {
          if (rooms.get(roomId) === server) rooms.delete(roomId);
          server.dead = true;
        },
        // The host tab keeps running but loses the room (PeerJS: the id could
        // not be registered again): every connection closes and the host is told.
        lose() {
          server.close();
          for (const fn of lostListeners) fn();
        },
        dead: false,
      };
      rooms.set(roomId, server);
      return { ok: true, server };
    },

    async dial(roomId) {
      await Promise.resolve();
      const server = rooms.get(roomId);
      if (!server) return null;
      const [hostSide, clientSide] = pair();
      server.accept(hostSide);
      return mute(clientSide, server);
    },

    rooms,
  };
  return net;
}

// After a crash the connection stays "open" but nothing gets through, not even
// the close; only closing it locally fires the close handlers.
function mute(conn, server) {
  const closers = [];
  let closed = false;
  const fire = () => {
    if (closed) return;
    closed = true;
    for (const fn of closers) fn();
  };
  conn.onClose(() => {
    if (!server.dead) fire();
  });
  return {
    send: (msg) => (server.dead ? undefined : conn.send(msg)),
    onMessage: (fn) => conn.onMessage((msg) => (server.dead ? undefined : fn(msg))),
    onClose: (fn) => closers.push(fn),
    close: () => {
      conn.close();
      queueMicrotask(fire);
    },
  };
}
