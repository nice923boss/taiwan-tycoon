// 3D dice that always land on the host's values.
// Each client simulates a throw with cannon-es off-screen, notes which face
// ends on top, then turns the visible mesh by a cube symmetry so the host's
// value is that top face, and replays the recorded trajectory. Trajectories
// differ between clients; the values shown never do.

import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// BoxGeometry material slots: +x, -x, +y, -y, +z, -z. Opposite faces sum to 7.
const SLOT_VALUES = [2, 5, 1, 6, 3, 4];
const SLOT_NORMALS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const STEP = 1 / 60;
export const MAX_SETTLE_STEPS = 150; // 2.5 s at 60 Hz (quality target Q2)
const MAX_TRIES = 12;
const FLAT_DOT = 0.995; // a die leaning on a wall or the other die is rejected
const IMPACT_MIN = 1.5;

const slotOf = (value) => SLOT_VALUES.indexOf(value);
const v3 = ([x, y, z]) => new THREE.Vector3(x, y, z);

// --- physics (no rendering) ---

// tray: { halfX, halfZ } in world units around the origin, floor at y = 0.
export function simulateThrow({ size, tray, rand = Math.random }) {
  for (let attempt = 1; attempt <= MAX_TRIES; attempt += 1) {
    const run = runOnce(size, tray, rand);
    if (run) return { ...run, attempts: attempt };
  }
  return null;
}

function runOnce(size, tray, rand) {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -40, 0), allowSleep: true });
  const floorMat = new CANNON.Material('floor');
  const wallMat = new CANNON.Material('wall');
  const diceMat = new CANNON.Material('dice');
  world.addContactMaterial(new CANNON.ContactMaterial(floorMat, diceMat, { friction: 0.25, restitution: 0.3 }));
  world.addContactMaterial(new CANNON.ContactMaterial(wallMat, diceMat, { friction: 0.1, restitution: 0.5 }));
  world.addContactMaterial(new CANNON.ContactMaterial(diceMat, diceMat, { friction: 0.15, restitution: 0.35 }));

  const plane = (material, pos, euler) => {
    const body = new CANNON.Body({ mass: 0, material, shape: new CANNON.Plane() });
    body.position.set(...pos);
    body.quaternion.setFromEuler(...euler);
    world.addBody(body);
  };
  plane(floorMat, [0, 0, 0], [-Math.PI / 2, 0, 0]);
  plane(wallMat, [-tray.halfX, 0, 0], [0, Math.PI / 2, 0]);
  plane(wallMat, [tray.halfX, 0, 0], [0, -Math.PI / 2, 0]);
  plane(wallMat, [0, 0, -tray.halfZ], [0, 0, 0]);
  plane(wallMat, [0, 0, tray.halfZ], [0, Math.PI, 0]);

  // Thrown from a random direction toward the middle of the tray.
  const ang = rand() * Math.PI * 2;
  const dir = { x: -Math.cos(ang), z: -Math.sin(ang) };
  const startR = Math.min(tray.halfX, tray.halfZ) * 0.65;
  const speed = 5 + rand() * 3;
  const impacts = [];
  let stepNow = 0;
  const dice = [0, 1].map((k) => {
    const body = new CANNON.Body({
      mass: 1,
      material: diceMat,
      shape: new CANNON.Box(new CANNON.Vec3(size / 2, size / 2, size / 2)),
      linearDamping: 0.1,
      angularDamping: 0.1,
      sleepSpeedLimit: 0.12,
      sleepTimeLimit: 0.15,
    });
    const spread = (k - 0.5) * size * 1.6;
    body.position.set(-dir.x * startR - dir.z * spread, 1.2 + rand() * 0.5, -dir.z * startR + dir.x * spread);
    body.quaternion.setFromEuler(rand() * 6.28, rand() * 6.28, rand() * 6.28);
    body.velocity.set(dir.x * speed, rand() * 2, dir.z * speed);
    body.angularVelocity.set((rand() - 0.5) * 40, (rand() - 0.5) * 40, (rand() - 0.5) * 40);
    body.addEventListener('collide', (e) => {
      const v = Math.abs(e.contact.getImpactVelocityAlongNormal());
      if (v > IMPACT_MIN) impacts.push({ step: stepNow, v });
    });
    world.addBody(body);
    return body;
  });

  const frames = [];
  for (stepNow = 0; stepNow < MAX_SETTLE_STEPS; stepNow += 1) {
    world.step(STEP);
    frames.push(dice.flatMap((b) => [b.position.x, b.position.y, b.position.z, b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w]));
    if (dice.every((b) => b.sleepState === CANNON.Body.SLEEPING)) {
      const tops = dice.map(topOfBody);
      if (tops.some((top) => top.dot < FLAT_DOT)) return null;
      return { frames, topSlots: tops.map((top) => top.slot), steps: stepNow + 1, impacts };
    }
  }
  return null;
}

function topOfBody(body) {
  let best = { slot: 0, dot: -2 };
  SLOT_NORMALS.forEach((n, slot) => {
    const w = body.quaternion.vmult(new CANNON.Vec3(...n));
    if (w.y > best.dot) best = { slot, dot: w.y };
  });
  return best;
}

// Cube rotation that moves the face showing `value` onto the slot that ends on top.
function offsetFor(value, topSlot) {
  return new THREE.Quaternion().setFromUnitVectors(v3(SLOT_NORMALS[slotOf(value)]), v3(SLOT_NORMALS[topSlot]));
}

// --- rendering ---

const PIPS = {
  1: [[0.5, 0.5]],
  2: [[0.25, 0.25], [0.75, 0.75]],
  3: [[0.25, 0.25], [0.5, 0.5], [0.75, 0.75]],
  4: [[0.27, 0.27], [0.73, 0.27], [0.27, 0.73], [0.73, 0.73]],
  5: [[0.25, 0.25], [0.75, 0.25], [0.5, 0.5], [0.25, 0.75], [0.75, 0.75]],
  6: [[0.27, 0.22], [0.27, 0.5], [0.27, 0.78], [0.73, 0.22], [0.73, 0.5], [0.73, 0.78]],
};

// Taiwanese dice: the one-pip and the four pips are red.
function faceTexture(value, px = 256) {
  const canvas = document.createElement('canvas');
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fbf7ee';
  ctx.fillRect(0, 0, px, px);
  const red = value === 1 || value === 4;
  const radius = value === 1 ? px * 0.17 : px * 0.085;
  for (const [x, y] of PIPS[value]) {
    const g = ctx.createRadialGradient(x * px - radius * 0.3, y * px - radius * 0.3, radius * 0.1, x * px, y * px, radius);
    g.addColorStop(0, red ? '#ff5a4e' : '#4a4a50');
    g.addColorStop(1, red ? '#b8141c' : '#121214');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x * px, y * px, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export function createDice({ size = 0.6, tray }) {
  const materials = SLOT_VALUES.map((v) => new THREE.MeshStandardMaterial({ map: faceTexture(v), roughness: 0.35, metalness: 0 }));
  const geometry = new RoundedBoxGeometry(size, size, size, 4, size * 0.14);
  const meshes = [0, 1].map((k) => {
    const mesh = new THREE.Mesh(geometry, materials);
    mesh.castShadow = true;
    mesh.position.set((k - 0.5) * size * 2, size / 2, 0);
    return mesh;
  });
  let anim = null;

  function applyFrame(frames, f, offsets) {
    const fr = frames[f];
    meshes.forEach((mesh, k) => {
      const o = k * 7;
      mesh.position.set(fr[o], fr[o + 1], fr[o + 2]);
      mesh.quaternion.set(fr[o + 3], fr[o + 4], fr[o + 5], fr[o + 6]).multiply(offsets[k]);
    });
  }

  // Resolves with { steps, attempts, fallback } once the dice rest on `values`.
  // reduced: skip the animation and show the final pose at once.
  function roll(values, { reduced = false, rand = Math.random, onImpact = null } = {}) {
    anim?.resolve(anim.info);
    anim = null;
    const sim = simulateThrow({ size, tray, rand });
    if (!sim) {
      // No flat landing in MAX_TRIES runs: lay the dice flat in the middle.
      const h = size / 2;
      const dx = size * 0.8;
      applyFrame([[-dx, h, 0, 0, 0, 0, 1, dx, h, 0, 0, 0, 0, 1]], 0, values.map((v) => offsetFor(v, 2)));
      return Promise.resolve({ steps: 0, attempts: MAX_TRIES, fallback: true });
    }
    const offsets = values.map((v, k) => offsetFor(v, sim.topSlots[k]));
    const info = { steps: sim.steps, attempts: sim.attempts, fallback: false };
    if (reduced) {
      applyFrame(sim.frames, sim.frames.length - 1, offsets);
      return Promise.resolve(info);
    }
    applyFrame(sim.frames, 0, offsets);
    return new Promise((resolve) => {
      anim = { sim, offsets, info, resolve, start: null, fired: 0, onImpact };
    });
  }

  // Call once per rendered frame.
  function update(now) {
    if (!anim) return;
    if (anim.start === null) anim.start = now;
    const last = anim.sim.frames.length - 1;
    const f = Math.min(last, Math.floor((now - anim.start) / 1000 / STEP));
    applyFrame(anim.sim.frames, f, anim.offsets);
    const { impacts } = anim.sim;
    while (anim.fired < impacts.length && impacts[anim.fired].step <= f) {
      anim.onImpact?.(impacts[anim.fired].v);
      anim.fired += 1;
    }
    if (f === last) {
      const { resolve, info } = anim;
      anim = null;
      resolve(info);
    }
  }

  // Values currently facing up, read from the meshes (used by tests).
  function topValues() {
    return meshes.map((mesh) => {
      let best = { slot: 0, y: -2 };
      SLOT_NORMALS.forEach((n, slot) => {
        const y = v3(n).applyQuaternion(mesh.quaternion).y;
        if (y > best.y) best = { slot, y };
      });
      return SLOT_VALUES[best.slot];
    });
  }

  return { meshes, roll, update, topValues, isRolling: () => anim !== null };
}
