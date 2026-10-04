// Paints the 40-square board onto a 2D canvas. The 3D board uses the result
// as its top texture and the no-WebGL fallback draws it directly, so both
// views always match. Text goes through t(), so a language switch is a repaint.

import { SQUARES, GROUPS } from '../engine/board.js';
import { RULES } from '../engine/rules.js';
import { t, money } from '../i18n/i18n.js';

export const CORNER = 0.13; // corner square size as a fraction of the board side

const FONT = '"Noto Sans TC", "Microsoft JhengHei", "PingFang TC", "Heiti TC", system-ui, sans-serif';
const EMOJI = '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
const PAPER = '#f6efdd';
const INK = '#2b2622';
const LINE = '#5a4c40';
const CENTER_TOP = '#1f6f5c';
const CENTER_BOTTOM = '#14493d';

const ICON = {
  4: '💰', 5: '🚄', 12: '⚡', 15: '🚆', 25: '🚇', 28: '💧', 35: '✈️', 38: '💎',
  chance: '❓', fate: '🧧', jail: '🔒', parking: '🅿️', gotojail: '👮',
};

// Rectangle of square i in canvas pixels, plus the rotation that makes its
// text read from the board edge with "up" pointing at the board center.
export function squareRect(i, S) {
  const c = S * CORNER;
  const w = (S - 2 * c) / 9;
  const side = Math.floor(i / 10);
  const k = i % 10;
  if (k === 0) {
    const pos = [[S - c, S - c], [0, S - c], [0, 0], [S - c, 0]][side];
    return { x: pos[0], y: pos[1], w: c, h: c, rot: -Math.PI / 4 + side * (Math.PI / 2), corner: true };
  }
  switch (side) {
    case 0: return { x: S - c - k * w, y: S - c, w, h: c, rot: 0, corner: false };
    case 1: return { x: 0, y: S - c - k * w, w: c, h: w, rot: Math.PI / 2, corner: false };
    case 2: return { x: c + (k - 1) * w, y: 0, w, h: c, rot: Math.PI, corner: false };
    default: return { x: S - c, y: c + (k - 1) * w, w: c, h: w, rot: -Math.PI / 2, corner: false };
  }
}

export function squareCenter(i, S) {
  const r = squareRect(i, S);
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

// view (optional): { props: game.props, colors: player colors, buildings: true to draw houses and flags (2D view) }
export function paintBoard(ctx, S, view = {}) {
  ctx.save();
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, S, S);
  paintCenter(ctx, S, view.centerImage);
  for (let i = 0; i < SQUARES.length; i += 1) paintSquare(ctx, S, i, view);
  ctx.strokeStyle = LINE;
  ctx.lineWidth = S * 0.004;
  ctx.strokeRect(0, 0, S, S);
  ctx.restore();
}

function paintCenter(ctx, S, image) {
  const c = S * CORNER;
  const inner = S - 2 * c;
  const grad = ctx.createLinearGradient(0, c, 0, S - c);
  grad.addColorStop(0, CENTER_TOP);
  grad.addColorStop(1, CENTER_BOTTOM);
  ctx.fillStyle = grad;
  ctx.fillRect(c, c, inner, inner);
  if (image) {
    ctx.globalAlpha = 0.35;
    ctx.drawImage(image, c, c, inner, inner);
    ctx.globalAlpha = 1;
  }
  deckSlot(ctx, S / 2 - inner * 0.27, S / 2 - inner * 0.27, inner, 'chance', '#f2b632');
  deckSlot(ctx, S / 2 + inner * 0.27, S / 2 + inner * 0.27, inner, 'fate', '#e8453c');

  ctx.save();
  ctx.translate(S / 2, S / 2);
  ctx.rotate(-Math.PI / 4);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fff8e6';
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = S * 0.006;
  fitFont(ctx, t('ui.boardTitle'), inner * 0.8, S * 0.075, 900);
  ctx.fillText(t('ui.boardTitle'), 0, 0);
  ctx.restore();
}

function deckSlot(ctx, cx, cy, inner, deck, color) {
  const w = inner * 0.24;
  const h = inner * 0.16;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-Math.PI / 4);
  ctx.setLineDash([w * 0.06, w * 0.04]);
  ctx.lineWidth = w * 0.025;
  ctx.strokeStyle = color;
  roundRect(ctx, -w / 2, -h / 2, w, h, w * 0.08);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  fitFont(ctx, t(`deck.${deck}`), w * 0.8, h * 0.4, 800);
  ctx.fillText(t(`deck.${deck}`), 0, 0);
  ctx.restore();
}

function paintSquare(ctx, S, i, view) {
  const r = squareRect(i, S);
  ctx.save();
  ctx.translate(r.x + r.w / 2, r.y + r.h / 2);
  ctx.strokeStyle = LINE;
  ctx.lineWidth = S * 0.0015;
  ctx.strokeRect(-r.w / 2, -r.h / 2, r.w, r.h);
  ctx.rotate(r.rot);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = INK;
  if (r.corner) paintCorner(ctx, S, i);
  else {
    // After rotation the cell is (along the edge) x (depth), whatever the side.
    const sideways = Math.abs(Math.sin(r.rot)) > 0.5;
    paintEdge(ctx, S, i, sideways ? r.h : r.w, sideways ? r.w : r.h, view);
  }
  ctx.restore();
}

function paintEdge(ctx, S, i, w, h, view) {
  const sq = SQUARES[i];
  const top = -h / 2;
  const pad = w * 0.06;
  let y = top + pad;
  if (sq.type === 'property') {
    const band = h * 0.2;
    ctx.fillStyle = GROUPS[sq.group].color;
    ctx.fillRect(-w / 2, top, w, band);
    ctx.strokeRect(-w / 2, top, w, band);
    if (view.buildings) paintBuildings(ctx, -w / 2, top, w, band, view.props?.[i]?.houses ?? 0);
    y = top + band + pad;
    ctx.fillStyle = INK;
  }
  const priceH = h * 0.14;
  const icon = ICON[i] ?? ICON[sq.type];
  const nameMaxH = (icon ? h * 0.3 : h * 0.55);
  drawLines(ctx, t(`sq.${i}`), 0, y, w - 2 * pad, nameMaxH, Math.round(w * 0.24), 3);
  if (icon) {
    ctx.font = `${Math.round(w * 0.38)}px ${EMOJI}`;
    ctx.textBaseline = 'middle';
    ctx.fillText(icon, 0, h * 0.08);
    ctx.textBaseline = 'top';
  }
  const label = priceLabel(sq);
  if (label) {
    ctx.fillStyle = INK;
    fitFont(ctx, label, w - 2 * pad, Math.round(w * 0.18), 600);
    ctx.textBaseline = 'bottom';
    ctx.fillText(label, 0, h / 2 - pad);
  }
  const st = view.props?.[i];
  if (st && st.owner !== null && st.owner !== undefined) {
    ctx.fillStyle = view.colors?.[st.owner] ?? INK;
    ctx.fillRect(-w / 2, h / 2 - priceH * 0.28, w, priceH * 0.28);
    if (view.buildings) paintFlag(ctx, w * 0.27, h / 2 - priceH * 0.28, w, ctx.fillStyle);
  }
  if (st?.mortgaged) {
    ctx.fillStyle = 'rgba(40,30,20,0.45)';
    ctx.fillRect(-w / 2, top, w, h);
  }
}

function priceLabel(sq) {
  if (sq.price) return money(sq.price);
  if (sq.type === 'tax') return t('ui.payAmt', { amt: sq.amount });
  return '';
}

// Houses are small pentagons (walls plus a gable); a hotel is a stepped tower.
function paintBuildings(ctx, x, y, w, h, houses) {
  if (houses === 0) return;
  ctx.save();
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = w * 0.015;
  if (houses === 5) {
    const cx = x + w / 2;
    ctx.fillStyle = '#d93a32';
    ctx.beginPath();
    ctx.moveTo(cx - w * 0.3, y + h * 0.9);
    ctx.lineTo(cx - w * 0.3, y + h * 0.62);
    ctx.lineTo(cx - w * 0.14, y + h * 0.62);
    ctx.lineTo(cx - w * 0.14, y + h * 0.22);
    ctx.lineTo(cx, y + h * 0.06);
    ctx.lineTo(cx + w * 0.14, y + h * 0.22);
    ctx.lineTo(cx + w * 0.14, y + h * 0.62);
    ctx.lineTo(cx + w * 0.3, y + h * 0.62);
    ctx.lineTo(cx + w * 0.3, y + h * 0.9);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else {
    ctx.fillStyle = '#2f9e57';
    const s = w * 0.17;
    const gap = (w - houses * s) / (houses + 1);
    for (let k = 0; k < houses; k += 1) {
      const hx = x + gap + k * (s + gap);
      const hy = y + (h - s * 1.3) / 2;
      ctx.beginPath();
      ctx.moveTo(hx, hy + s * 1.3);
      ctx.lineTo(hx, hy + s * 0.5);
      ctx.lineTo(hx + s / 2, hy);
      ctx.lineTo(hx + s, hy + s * 0.5);
      ctx.lineTo(hx + s, hy + s * 1.3);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }
  ctx.restore();
}

// Small flag in the owner's color standing on the owner strip at (x, base).
function paintFlag(ctx, x, base, w, color) {
  const pole = w * 0.36;
  ctx.save();
  ctx.fillStyle = INK;
  ctx.fillRect(x - w * 0.012, base - pole, w * 0.024, pole);
  ctx.fillStyle = color;
  ctx.strokeStyle = INK;
  ctx.lineWidth = w * 0.012;
  ctx.beginPath();
  ctx.moveTo(x, base - pole);
  ctx.lineTo(x + w * 0.2, base - pole + w * 0.07);
  ctx.lineTo(x, base - pole + w * 0.14);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function paintCorner(ctx, S, i) {
  const c = S * CORNER;
  const sq = SQUARES[i];
  ctx.textBaseline = 'middle';
  if (sq.type === 'go') {
    ctx.fillStyle = '#d93a32';
    fitFont(ctx, t('sq.0'), c * 0.9, c * 0.3, 900);
    ctx.fillText(t('sq.0'), 0, -c * 0.12);
    ctx.fillStyle = INK;
    fitFont(ctx, t('ui.goCollect', { amt: RULES.goSalary }), c * 0.95, c * 0.12, 700);
    ctx.fillText(t('ui.goCollect', { amt: RULES.goSalary }), 0, c * 0.13);
    paintArrow(ctx, c);
    return;
  }
  ctx.font = `${Math.round(c * 0.3)}px ${EMOJI}`;
  ctx.fillText(ICON[sq.type], 0, -c * 0.1);
  ctx.fillStyle = INK;
  fitFont(ctx, t(`sq.${i}`), c * 0.95, c * 0.15, 800);
  ctx.fillText(t(`sq.${i}`), 0, c * 0.2);
}

function paintArrow(ctx, c) {
  ctx.save();
  ctx.fillStyle = '#d93a32';
  ctx.translate(0, c * 0.3);
  ctx.beginPath();
  ctx.moveTo(c * 0.32, 0);
  ctx.lineTo(c * 0.18, -c * 0.07);
  ctx.lineTo(c * 0.18, -c * 0.03);
  ctx.lineTo(-c * 0.3, -c * 0.03);
  ctx.lineTo(-c * 0.3, c * 0.03);
  ctx.lineTo(c * 0.18, c * 0.03);
  ctx.lineTo(c * 0.18, c * 0.07);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// --- text helpers ---

const isSpaced = (text) => /\s/.test(text.trim());

// Shrinks the font until a single line fits maxW (never above maxSize).
function fitFont(ctx, text, maxW, maxSize, weight) {
  let size = Math.round(maxSize);
  ctx.font = `${weight} ${size}px ${FONT}`;
  while (size > 8 && ctx.measureText(text).width > maxW) {
    size -= 1;
    ctx.font = `${weight} ${size}px ${FONT}`;
  }
  return size;
}

// Draws text wrapped into at most maxLines lines inside maxW x maxH, top-aligned at y.
// Prefers the largest font; CJK names are split evenly by character, others by word.
function drawLines(ctx, text, x, y, maxW, maxH, maxSize, maxLines) {
  for (let size = maxSize; size >= 8; size -= 1) {
    ctx.font = `700 ${size}px ${FONT}`;
    for (let n = 1; n <= maxLines; n += 1) {
      const lines = splitLines(ctx, text, n, maxW);
      if (!lines) continue;
      const lineH = size * 1.12;
      if (lines.length * lineH > maxH) continue;
      if (lines.some((l) => ctx.measureText(l).width > maxW)) continue;
      lines.forEach((l, k) => ctx.fillText(l, x, y + k * lineH));
      return;
    }
  }
}

function splitLines(ctx, text, n, maxW) {
  if (n === 1) return [text];
  if (isSpaced(text)) {
    const words = text.trim().split(/\s+/);
    const lines = [];
    let cur = '';
    for (const word of words) {
      const next = cur ? `${cur} ${word}` : word;
      if (cur && ctx.measureText(next).width > maxW) {
        lines.push(cur);
        cur = word;
      } else cur = next;
    }
    lines.push(cur);
    return lines.length <= n ? lines : null;
  }
  // Runs of Latin letters and digits stay together ("台北101" -> "台北" / "101").
  const tokens = text.match(/[A-Za-z0-9]+|./gu);
  if (tokens.length < n) return null;
  const per = Math.ceil([...text].length / n);
  const lines = [];
  let cur = '';
  for (const tok of tokens) {
    if (cur && [...cur].length + [...tok].length > per) {
      lines.push(cur);
      cur = tok;
    } else cur += tok;
  }
  lines.push(cur);
  return lines.length <= n ? lines : null;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
