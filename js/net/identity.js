// Per-tab identity and the room address.
//
// The secret lives in sessionStorage: a reload keeps the same seat, while a
// second tab joins as a different person. The public id is derived from the
// secret (SHA-256), so peers who see an id in the game state cannot claim it.

const SECRET_KEY = 'monopoly.secret';
const GUEST_KEY = 'monopoly.guest';
const ROOM_PREFIX = 'twmono-';

const toHex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

export function randomSecret() {
  return toHex(globalThis.crypto.getRandomValues(new Uint8Array(16)));
}

export function loadSecret(storage = globalThis.sessionStorage) {
  try {
    const saved = storage?.getItem(SECRET_KEY);
    if (/^[0-9a-f]{32}$/.test(saved ?? '')) return saved;
    const secret = randomSecret();
    storage?.setItem(SECRET_KEY, secret);
    return secret;
  } catch {
    // Storage blocked: this tab still works, but a reload joins as a new person.
    return randomSecret();
  }
}

// The generated guest name is kept the same way, so a reload keeps the name too.
export function loadGuestName(make, storage = globalThis.sessionStorage) {
  try {
    const saved = storage?.getItem(GUEST_KEY);
    if (saved) return saved;
    const name = make();
    storage?.setItem(GUEST_KEY, name);
    return name;
  } catch {
    return make();
  }
}

export async function idFromSecret(secret) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return toHex(new Uint8Array(digest)).slice(0, 16);
}

// FNV-1a 32-bit, used only to turn the page address into a short peer id.
function fnv1a(text) {
  let h = 0x811c9dc5;
  for (const ch of text) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

// One room per deployment: the fixed host peer id comes from the page address,
// so two sites running this code never share a room. `?room=name` picks a
// separate room (testing on localhost, or a private table).
export function roomIdFor(loc = globalThis.location) {
  const custom = new URLSearchParams(loc.search).get('room');
  // PeerJS ids: alphanumeric runs joined by single dashes.
  if (custom && custom.length <= 24 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(custom)) return `${ROOM_PREFIX}r-${custom}`;
  return `${ROOM_PREFIX}${fnv1a(`${loc.origin}${loc.pathname}`)}`;
}
