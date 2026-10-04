// Per-tab identity kept in sessionStorage.

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGuestName } from '../js/net/identity.js';

function memoryStorage() {
  const data = new Map();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)) };
}

test('a generated guest name is kept for the tab, so a reload shows the same name', () => {
  const storage = memoryStorage();
  let made = 0;
  const make = () => `Guest${(made += 1)}`;
  assert.equal(loadGuestName(make, storage), 'Guest1');
  assert.equal(loadGuestName(make, storage), 'Guest1');
  assert.equal(made, 1);
  // Another tab has its own storage and its own name.
  assert.equal(loadGuestName(make, memoryStorage()), 'Guest2');
});

test('blocked storage still returns a name', () => {
  const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  assert.equal(loadGuestName(() => 'Guest7', blocked), 'Guest7');
  assert.equal(loadGuestName(() => 'Guest8', undefined), 'Guest8');
});
