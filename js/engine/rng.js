// Seeded PRNG (mulberry32). The uint32 state lives on a plain object (`holder.rng`)
// so it is cloned together with the game state and the sequence stays deterministic.

export function nextFloat(holder) {
  holder.rng = (holder.rng + 0x6d2b79f5) >>> 0;
  let t = holder.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function nextInt(holder, n) {
  return Math.floor(nextFloat(holder) * n);
}

// Standard normal sample via Box-Muller.
export function gaussian(holder) {
  const u = Math.max(nextFloat(holder), 1e-12);
  const v = nextFloat(holder);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function shuffled(holder, items) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = nextInt(holder, i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function randomSeed() {
  return globalThis.crypto.getRandomValues(new Uint32Array(1))[0];
}
