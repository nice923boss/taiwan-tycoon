// 2D board view on a single canvas: used when WebGL or three.js is unavailable,
// with ?gl=0, or when the player picks 2D in settings. Same interface as scene3d.js.

import { loadImage } from '../../assets/manifest.js';
import { SQUARES } from '../engine/board.js';
import { $, fill, h } from './dom.js';
import { paintBoard, squareCenter, squareRect } from './board-paint.js';

const FACES = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
const wait = (ms) => new Promise((r) => { setTimeout(r, ms); });

export function createBoard2d() {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const layer = document.createElement('canvas'); // painted board, redrawn only when props change
  const avatars = new Map(); // char -> image
  const moving = new Map(); // player index -> { x, y, hop } in board pixels
  const pins = new Map(); // player index -> square shown instead of pl.pos (see pin())
  let S = 0;
  let game = null;
  let centerImage = null;
  let host = null;
  let clickFn = null;
  let resizeObs = null;
  let raf = 0;
  let propsSig = '';

  function paintLayer() {
    if (!S) return;
    layer.width = S;
    layer.height = S;
    paintBoard(layer.getContext('2d'), S, {
      props: game?.props, colors: game?.players.map((pl) => pl.color), buildings: true, centerImage,
    });
  }

  const shownPos = (p) => pins.get(p) ?? game.players[p].pos;

  function spot(p, pos) {
    const c = squareCenter(pos, S);
    const here = game.players.map((pl, i) => ({ pl, i })).filter(({ pl, i }) => !pl.bankrupt && shownPos(i) === pos).map(({ i }) => i);
    if (here.length < 2) return c;
    const a = (here.indexOf(p) / here.length) * Math.PI * 2;
    return { x: c.x + Math.cos(a) * S * 0.022, y: c.y + Math.sin(a) * S * 0.022 };
  }

  function drawToken(p, pl, x, y, lift) {
    const r = S * 0.021;
    const cy = y - lift;
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(x, y + r * 0.9, r * 0.9, r * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = pl.color;
    ctx.beginPath();
    ctx.arc(x, cy, r + S * 0.004, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, cy, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#fffaf0';
    ctx.fillRect(x - r, cy - r, r * 2, r * 2);
    const img = avatars.get(pl.char);
    if (img) ctx.drawImage(img, x - r, cy - r, r * 2, r * 2);
    ctx.restore();
    if (game.current === p && game.phase !== 'gameOver') {
      ctx.strokeStyle = '#f2b632';
      ctx.lineWidth = S * 0.005;
      ctx.beginPath();
      ctx.arc(x, cy, r + S * 0.01, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  function draw() {
    raf = 0;
    if (!S || !game) return;
    ctx.drawImage(layer, 0, 0);
    game.players.forEach((pl, p) => {
      if (pl.bankrupt) return;
      const m = moving.get(p);
      const s = m ?? spot(p, shownPos(p));
      drawToken(p, pl, s.x, s.y, m?.hop ?? 0);
    });
  }
  const schedule = () => { raf ||= requestAnimationFrame(draw); };

  function update(g) {
    game = g;
    for (const pl of g.players) {
      if (!avatars.has(pl.char)) {
        avatars.set(pl.char, null);
        loadImage(`char-${pl.char}`).then((img) => { avatars.set(pl.char, img); schedule(); }, () => {});
      }
    }
    const sig = JSON.stringify(g.props);
    if (sig !== propsSig) {
      propsSig = sig;
      paintLayer();
    }
    schedule();
  }

  // Same contract as scene3d.js: draw the token on `pos` until released.
  function pin(p, pos) {
    if (pos === null) pins.delete(p);
    else pins.set(p, pos);
    schedule();
  }

  function moveToken(p, from, steps, to, jump, reduced) {
    const animate = !reduced && !jump && steps && S && game;
    // Start where the token is drawn now, before the pin moves on to `to`.
    const a0 = animate ? spot(p, shownPos(p)) : null;
    if (pins.has(p)) pins.set(p, to);
    if (!animate) {
      moving.delete(p);
      schedule();
      return Promise.resolve();
    }
    moving.set(p, { ...a0, hop: 0 });
    const dir = Math.sign(steps);
    const n = Math.abs(steps);
    const dur = Math.min(200, 2400 / n);
    const path = [];
    for (let s = 1; s <= n; s += 1) path.push(squareCenter((((from + dir * s) % 40) + 40) % 40, S));
    path[path.length - 1] = spot(p, to);
    return new Promise((resolve) => {
      let k = 0;
      let a = a0;
      let start = performance.now();
      const step = (now) => {
        const f = Math.min(1, (now - start) / dur);
        const b = path[k];
        moving.set(p, { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, hop: Math.sin(Math.PI * f) * S * 0.02 });
        draw();
        if (f >= 1) {
          k += 1;
          a = b;
          start = now;
        }
        if (k < path.length) requestAnimationFrame(step);
        else {
          moving.delete(p);
          draw();
          resolve();
        }
      };
      requestAnimationFrame(step);
    });
  }

  async function rollDice(values, { reduced = false, onImpact = null } = {}) {
    const box = $('#dice2d');
    const dice = values.map(() => h('div', { class: 'die2d' }));
    fill(box, dice);
    box.hidden = false;
    if (!reduced) {
      dice.forEach((d) => d.classList.add('rolling'));
      for (let k = 0; k < 8; k += 1) {
        dice.forEach((d) => { d.textContent = FACES[Math.floor(Math.random() * 6)]; });
        await wait(80);
      }
      dice.forEach((d) => d.classList.remove('rolling'));
      onImpact?.();
    }
    dice.forEach((d, k) => {
      d.textContent = FACES[values[k] - 1];
      d.setAttribute('aria-label', String(values[k]));
    });
    setTimeout(() => { box.hidden = true; }, reduced ? 1200 : 1800);
  }

  function resize() {
    if (!host) return;
    const size = Math.max(200, Math.min(host.clientWidth, host.clientHeight) - 20);
    const next = Math.round(size * Math.min(devicePixelRatio || 1, 2));
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    if (next === S) return;
    S = next;
    canvas.width = S;
    canvas.height = S;
    paintLayer();
    schedule();
  }

  let down = null;
  canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
  canvas.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
    down = null;
    const r = canvas.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * S;
    const py = ((e.clientY - r.top) / r.height) * S;
    for (let i = 0; i < SQUARES.length; i += 1) {
      const q = squareRect(i, S);
      if (px >= q.x && px <= q.x + q.w && py >= q.y && py <= q.y + q.h) {
        clickFn?.(i, { x: e.clientX, y: e.clientY });
        return;
      }
    }
  });

  loadImage('board-center').then((img) => { centerImage = img; paintLayer(); schedule(); }, () => {});

  return {
    kind: '2d',
    mount(el) {
      host = el;
      el.classList.add('board-2d');
      el.append(canvas);
      resizeObs = new ResizeObserver(resize);
      resizeObs.observe(el);
      resize();
    },
    update,
    rollDice,
    moveToken,
    pin,
    onSquareClick: (fn) => { clickFn = fn; },
    resetView: () => {},
    repaint: () => { paintLayer(); schedule(); },
    dispose() {
      resizeObs?.disconnect();
      cancelAnimationFrame(raf);
      canvas.remove();
      host?.classList.remove('board-2d');
    },
  };
}
