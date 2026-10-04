// Two connected in-memory endpoints with the same shape as a network connection:
//   { send(msg), onMessage(fn), onClose(fn), close() }
// Used for the host tab's own seat (loopback) and by the fake transport in tests.
// Messages are structured-cloned and delivered asynchronously, in order.

function endpoint() {
  return { handlers: [], closers: [], open: true, closing: false, peer: null };
}

function wrap(self) {
  return {
    send(msg) {
      if (self.closing) return;
      const data = structuredClone(msg);
      const target = self.peer;
      queueMicrotask(() => {
        if (target.open) for (const fn of target.handlers) fn(data);
      });
    },
    onMessage(fn) {
      self.handlers.push(fn);
    },
    onClose(fn) {
      self.closers.push(fn);
    },
    // Like a flushed PeerJS close: messages already sent are delivered first,
    // nothing sent after close() goes through.
    close() {
      if (self.closing) return;
      const sides = [self, self.peer];
      for (const side of sides) side.closing = true;
      queueMicrotask(() => {
        for (const side of sides) {
          if (!side.open) continue;
          side.open = false;
          for (const fn of side.closers) fn();
        }
      });
    },
    get open() {
      return !self.closing;
    },
  };
}

export function pair() {
  const a = endpoint();
  const b = endpoint();
  a.peer = b;
  b.peer = a;
  return [wrap(a), wrap(b)];
}
