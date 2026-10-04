// 3D board view (three.js + cannon-es dice). Same interface as board2d.js:
// mount, update, rollDice, moveToken, onSquareClick, resetView, repaint, dispose.
// Constructing the WebGL renderer throws when WebGL is unavailable; app.js
// then falls back to the 2D view.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { loadImage } from '../../assets/manifest.js';
import { SQUARES } from '../engine/board.js';
import { CORNER, paintBoard, squareCenter, squareRect } from './board-paint.js';
import { buildingModel, flagModel } from './buildings3d.js';
import { createDice } from './dice3d.js';

const BOARD = 10;
const TEX = 2048;
const CAM_HOME = new THREE.Vector3(0, 12.5, 9.5);
const TARGET_HOME = new THREE.Vector3(0, 0, 0.5);
const DEPTH = BOARD * CORNER;
const WIDTH = (BOARD - 2 * DEPTH) / 9;

const toWorld = (i) => {
  const c = squareCenter(i, TEX);
  return { x: (c.x / TEX) * BOARD - BOARD / 2, z: (c.y / TEX) * BOARD - BOARD / 2 };
};
// Unit vector from a square toward the board centre, and along the row.
const inward = (i) => [[0, -1], [1, 0], [0, 1], [-1, 0]][Math.floor(i / 10) % 4];

function squareAt(px, py) {
  for (let i = 0; i < SQUARES.length; i += 1) {
    const r = squareRect(i, TEX);
    if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) return i;
  }
  return null;
}

function standeeCanvas(color, img) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 320;
  const x = c.getContext('2d');
  x.fillStyle = color;
  x.beginPath();
  x.arc(128, 128, 122, 0, Math.PI * 2);
  x.fill();
  x.fillStyle = '#fffaf0';
  x.beginPath();
  x.arc(128, 128, 104, 0, Math.PI * 2);
  x.fill();
  if (img) {
    x.save();
    x.beginPath();
    x.arc(128, 128, 102, 0, Math.PI * 2);
    x.clip();
    x.drawImage(img, 26, 26, 204, 204);
    x.restore();
  }
  x.fillStyle = color;
  x.fillRect(116, 244, 24, 76);
  return c;
}

export function createScene3d() {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  const controls = new OrbitControls(camera, renderer.domElement);
  Object.assign(controls, { enableDamping: true, enablePan: false, minDistance: 7, maxDistance: 24, maxPolarAngle: 1.25 });

  scene.add(new THREE.HemisphereLight(0xfff4e0, 0x3a3a3a, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(4, 10, 6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 1, far: 30 });
  scene.add(sun);

  const boardCanvas = document.createElement('canvas');
  boardCanvas.width = TEX;
  boardCanvas.height = TEX;
  const boardTex = new THREE.CanvasTexture(boardCanvas);
  boardTex.colorSpace = THREE.SRGBColorSpace;
  boardTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const base = new THREE.Mesh(new THREE.BoxGeometry(BOARD + 0.3, 0.35, BOARD + 0.3), new THREE.MeshStandardMaterial({ color: '#6b4a2f', roughness: 0.8 }));
  base.position.y = -0.176;
  base.receiveShadow = true;
  const top = new THREE.Mesh(new THREE.PlaneGeometry(BOARD, BOARD), new THREE.MeshStandardMaterial({ map: boardTex, roughness: 0.9 }));
  top.rotation.x = -Math.PI / 2;
  top.receiveShadow = true;
  scene.add(base, top);

  const inner = BOARD / 2 - DEPTH - 0.25;
  const dice = createDice({ size: 0.6, tray: { halfX: inner, halfZ: inner } });
  dice.meshes.forEach((m) => scene.add(m));

  const houses = new THREE.Group();
  const flags = new THREE.Group();
  scene.add(houses, flags);

  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.035, 8, 32), new THREE.MeshStandardMaterial({ color: '#f2b632', emissive: '#7a5200' }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02;
  scene.add(ring);

  const tokens = new Map(); // player index -> { group, busy }
  const pins = new Map(); // player index -> square shown instead of pl.pos (see pin())
  const anims = new Set();
  let game = null;
  let centerImage = null;
  let propsSig = '';
  let host = null;
  let clickFn = null;
  let resizeObs = null;

  function repaint() {
    paintBoard(boardCanvas.getContext('2d'), TEX, {
      props: game?.props, colors: game?.players.map((pl) => pl.color), centerImage,
    });
    boardTex.needsUpdate = true;
  }
  loadImage('board-center').then((img) => { centerImage = img; repaint(); }, () => {});

  // One building per developed square on its color band, and a flag in the
  // owner's color on the outer corner of every owned square.
  function rebuildHouses() {
    houses.clear();
    flags.clear();
    for (const [id, st] of Object.entries(game?.props ?? {})) {
      if (st.owner === null) continue;
      const i = Number(id);
      const c = toWorld(i);
      const [ix, iz] = inward(i);
      if (st.houses) {
        const m = buildingModel(st.houses);
        m.position.set(c.x + ix * DEPTH * 0.38, 0, c.z + iz * DEPTH * 0.38);
        m.rotation.y = -Math.floor(i / 10) * (Math.PI / 2);
        houses.add(m);
      }
      const f = flagModel(game.players[st.owner].color, st.mortgaged);
      f.position.set(c.x - ix * DEPTH * 0.3 - iz * WIDTH * 0.3, 0, c.z - iz * DEPTH * 0.3 + ix * WIDTH * 0.3);
      flags.add(f);
    }
  }

  function makeToken(p, pl) {
    const canvas = standeeCanvas(pl.color, null);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const card = new THREE.Mesh(new THREE.PlaneGeometry(0.64, 0.8), new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide }));
    card.position.y = 0.46;
    card.castShadow = true;
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.07, 24), new THREE.MeshStandardMaterial({ color: pl.color }));
    foot.position.y = 0.035;
    foot.castShadow = true;
    const group = new THREE.Group();
    group.add(card, foot);
    scene.add(group);
    loadImage(`char-${pl.char}`).then((img) => {
      tex.image = standeeCanvas(pl.color, img);
      tex.needsUpdate = true;
    }, () => {});
    const tok = { group, busy: false };
    tokens.set(p, tok);
    return tok;
  }

  const shownPos = (p) => pins.get(p) ?? game.players[p].pos;

  // Players sharing a square stand in a small circle around its centre.
  function spot(p, pos) {
    const here = game.players.map((pl, i) => ({ pl, i })).filter(({ pl, i }) => !pl.bankrupt && shownPos(i) === pos).map(({ i }) => i);
    const c = toWorld(pos);
    if (here.length < 2) return c;
    const a = (here.indexOf(p) / here.length) * Math.PI * 2;
    return { x: c.x + Math.cos(a) * 0.24, z: c.z + Math.sin(a) * 0.24 };
  }

  function layout() {
    if (!game) return;
    game.players.forEach((pl, p) => {
      const tok = tokens.get(p) ?? makeToken(p, pl);
      tok.group.visible = !pl.bankrupt;
      if (!tok.busy) {
        const s = spot(p, shownPos(p));
        tok.group.position.set(s.x, 0, s.z);
      }
    });
  }

  function update(g) {
    game = g;
    const sig = JSON.stringify(g.props);
    if (sig !== propsSig) {
      propsSig = sig;
      repaint();
      rebuildHouses();
    }
    layout();
  }

  // Keeps a token drawn on `pos` (null releases it) while the state already holds
  // a later position, so it does not flash at its destination before moving.
  function pin(p, pos) {
    if (pos === null) pins.delete(p);
    else pins.set(p, pos);
    layout();
  }

  // Hops square by square; long jumps are compressed to about 2.4 s.
  // A pinned token stays pinned, on `to`, when the move ends.
  function moveToken(p, from, steps, to, jump, reduced) {
    const tok = tokens.get(p);
    if (pins.has(p)) pins.set(p, to);
    if (!tok || reduced || jump || !steps) {
      if (tok) tok.busy = false;
      layout();
      return Promise.resolve();
    }
    tok.busy = true;
    const dir = Math.sign(steps);
    const n = Math.abs(steps);
    const dur = Math.min(200, 2400 / n);
    const path = [];
    for (let s = 1; s <= n; s += 1) path.push(toWorld((((from + dir * s) % 40) + 40) % 40));
    path[path.length - 1] = spot(p, to);
    return new Promise((resolve) => {
      let k = 0;
      let start = performance.now();
      let a = { x: tok.group.position.x, z: tok.group.position.z };
      const anim = (now) => {
        const f = Math.min(1, (now - start) / dur);
        const b = path[k];
        tok.group.position.set(a.x + (b.x - a.x) * f, Math.sin(Math.PI * f) * 0.45, a.z + (b.z - a.z) * f);
        if (f < 1) return;
        k += 1;
        a = b;
        start = now;
        if (k >= path.length) {
          anims.delete(anim);
          tok.busy = false;
          layout();
          resolve();
        }
      };
      anims.add(anim);
    });
  }

  function rollDice(values, { reduced = false, onImpact = null } = {}) {
    return dice.roll(values, { reduced, onImpact });
  }

  function resetView() {
    const aspect = camera.aspect || 1;
    camera.position.copy(CAM_HOME).multiplyScalar(Math.max(1, 1.15 / aspect));
    controls.target.copy(TARGET_HOME);
    controls.update();
  }

  function resize() {
    if (!host) return;
    const w = host.clientWidth || 1;
    const h = host.clientHeight || 1;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  const raycaster = new THREE.Raycaster();
  let down = null;
  function onDown(e) { down = { x: e.clientX, y: e.clientY }; }
  function onUp(e) {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
    down = null;
    const r = renderer.domElement.getBoundingClientRect();
    raycaster.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
    const hit = raycaster.intersectObject(top)[0];
    if (!hit?.uv) return;
    const i = squareAt(hit.uv.x * TEX, (1 - hit.uv.y) * TEX);
    if (i !== null) clickFn?.(i, { x: e.clientX, y: e.clientY });
  }

  function frame(now) {
    for (const anim of [...anims]) anim(now);
    dice.update(now);
    controls.update();
    for (const group of [...[...tokens.values()].map((tok) => tok.group), ...flags.children]) {
      group.rotation.y = Math.atan2(camera.position.x - group.position.x, camera.position.z - group.position.z);
    }
    const cur = game && tokens.get(game.current);
    ring.visible = Boolean(cur?.group.visible) && game.phase !== 'gameOver';
    if (ring.visible) ring.position.set(cur.group.position.x, 0.02 + cur.group.position.y, cur.group.position.z);
    renderer.render(scene, camera);
  }

  function mount(el) {
    host = el;
    el.classList.remove('board-2d');
    el.append(renderer.domElement);
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointerup', onUp);
    resizeObs = new ResizeObserver(() => { resize(); });
    resizeObs.observe(el);
    resize();
    resetView();
    repaint();
    renderer.setAnimationLoop(frame);
  }

  function dispose() {
    renderer.setAnimationLoop(null);
    resizeObs?.disconnect();
    renderer.domElement.remove();
    renderer.dispose();
    anims.clear();
  }

  return {
    kind: '3d', mount, update, rollDice, moveToken, pin, resetView, repaint, dispose,
    onSquareClick: (fn) => { clickFn = fn; },
  };
}
