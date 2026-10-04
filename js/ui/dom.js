// Small DOM helpers shared by the UI modules. Strings always go in through
// textContent, so player names and chat lines can never become markup.

import { t } from '../i18n/i18n.js';

export const $ = (sel, root = document) => root.querySelector(sel);

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
}

// h('button', { class: 'btn', onclick: fn, 'aria-label': 'x' }, 'text', child)
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'value') el.value = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  append(el, children);
  return el;
}

export function fill(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

// ---------- icons (Lucide, loaded per icon; a missing icon just stays empty) ----------

let createIcon = null;
const iconCache = new Map();

function loadIcon(name) {
  if (!iconCache.has(name)) {
    createIcon ??= import('lucide/createElement.mjs').then((m) => m.default);
    const svg = Promise.all([createIcon, import(`lucide/icons/${name}.mjs`)])
      .then(([create, mod]) => create(mod.default, { width: 18, height: 18, 'aria-hidden': 'true' }))
      .catch(() => null);
    iconCache.set(name, svg);
  }
  return iconCache.get(name);
}

export function icon(name, cls = 'icon') {
  const span = h('span', { class: cls, 'aria-hidden': 'true' });
  loadIcon(name).then((svg) => svg && span.replaceChildren(svg.cloneNode(true)));
  return span;
}

// <button data-icon="x"> gets the icon prepended once.
export function hydrateIcons(root = document) {
  for (const el of root.querySelectorAll('[data-icon]')) {
    const name = el.dataset.icon;
    delete el.dataset.icon;
    el.prepend(icon(name));
  }
}

// Static markup: data-i (text), data-i-label (aria-label + tooltip), data-i-ph (placeholder).
export function translateStatic(root = document) {
  if (root === document) document.title = t('ui.boardTitle');
  for (const el of root.querySelectorAll('[data-i]')) el.textContent = t(el.dataset.i);
  for (const el of root.querySelectorAll('[data-i-label]')) {
    const text = t(el.dataset.iLabel);
    el.setAttribute('aria-label', text);
    el.dataset.tip = text;
  }
  for (const el of root.querySelectorAll('[data-i-ph]')) el.placeholder = t(el.dataset.iPh);
}

// ---------- buttons ----------

// A button that stays focusable when unavailable: aria-disabled plus a reason
// shown as tooltip and, on click, as a toast. `reason` is a translated string.
export function button(label, { onClick, reason = null, kind = '', iconName = null, tip = null, id = null } = {}) {
  const el = h('button', { type: 'button', class: `btn ${kind}`.trim(), id }, iconName ? icon(iconName) : null, h('span', {}, label));
  if (reason) {
    el.setAttribute('aria-disabled', 'true');
    el.dataset.tip = reason;
    el.addEventListener('click', () => toast(reason, 'warn'));
  } else {
    if (tip) el.dataset.tip = tip;
    if (onClick) el.addEventListener('click', onClick);
  }
  return el;
}

// ---------- toasts ----------

export function toast(text, kind = 'info', ms = 3800) {
  const box = $('#toasts');
  if (!box) return;
  const el = h('div', { class: `toast toast-${kind}`, role: kind === 'error' ? 'alert' : 'status' }, text);
  box.append(el);
  while (box.children.length > 4) box.firstChild.remove();
  setTimeout(() => el.classList.add('toast-out'), ms);
  setTimeout(() => el.remove(), ms + 400);
}

// ---------- dialogs (native <dialog>: focus trap and Esc come for free) ----------

export function openDialog({ title, body, actions = [], wide = false, onClose = null }) {
  const titleEl = h('h2', { class: 'dialog-title' }, title);
  const bodyEl = h('div', { class: 'dialog-body' }, body);
  const actionsEl = h('div', { class: 'dialog-actions' }, actions);
  const closeBtn = h('button', { type: 'button', class: 'icon-btn dialog-x', 'aria-label': t('ui.close'), 'data-tip': t('ui.close') }, icon('x'));
  const dlg = h('dialog', { class: wide ? 'dialog dialog-wide' : 'dialog' }, h('div', { class: 'dialog-head' }, titleEl, closeBtn), bodyEl, actionsEl);
  const close = () => dlg.open && dlg.close();
  closeBtn.addEventListener('click', close);
  dlg.addEventListener('close', () => {
    dlg.remove();
    onClose?.();
  });
  document.body.append(dlg);
  dlg.showModal();
  return {
    el: dlg,
    close,
    setTitle: (text) => fill(titleEl, text),
    setBody: (...nodes) => fill(bodyEl, ...nodes),
    setActions: (...nodes) => fill(actionsEl, ...nodes),
  };
}

export function confirmDialog(text, { okLabel = t('ui.ok'), danger = false } = {}) {
  return new Promise((resolve) => {
    let answer = false;
    const d = openDialog({ title: t('ui.confirmTitle'), body: h('p', {}, text), onClose: () => resolve(answer) });
    d.setActions(
      button(t('ui.cancel'), { onClick: () => d.close() }),
      button(okLabel, { kind: danger ? 'btn-danger' : 'btn-primary', onClick: () => { answer = true; d.close(); } }),
    );
  });
}

// ---------- tooltips (Floating UI, one shared element, delegated on [data-tip]) ----------

export function installTooltips() {
  const tip = $('#tip');
  let floating = null;
  let target = null;
  const hide = () => {
    target = null;
    tip.hidden = true;
  };
  const show = async (el) => {
    target = el;
    tip.textContent = el.dataset.tip;
    tip.hidden = false;
    try {
      floating ??= await import('@floating-ui/dom');
    } catch {
      return hide(); // library unavailable: aria-label still names the control
    }
    if (target !== el) return undefined;
    const { computePosition, offset, flip, shift } = floating;
    const { x, y } = await computePosition(el, tip, { placement: 'top', middleware: [offset(8), flip(), shift({ padding: 8 })] });
    Object.assign(tip.style, { left: `${x}px`, top: `${y}px` });
    return undefined;
  };
  const over = (e) => {
    const el = e.target.closest?.('[data-tip]');
    if (el && el !== target) show(el);
    else if (!el && target) hide();
  };
  document.addEventListener('pointerover', over);
  document.addEventListener('focusin', over);
  document.addEventListener('focusout', hide);
  document.addEventListener('pointerdown', hide);
  document.addEventListener('keydown', (e) => e.key === 'Escape' && hide());
}

// ---------- fatal screen ----------

export function showFatal(message, detail = '') {
  const boot = $('#boot');
  boot.hidden = false;
  fill(boot, h('div', { class: 'boot-card' },
    h('p', {}, message),
    detail ? h('p', { class: 'muted small' }, detail) : null,
    h('button', { type: 'button', class: 'btn btn-primary', onclick: () => location.reload() }, t('ui.reload'))));
}

// Remaining time of a host deadline, in ms (offset = host clock - local clock).
export const remainingMs = (deadline, offset) => (deadline ? Math.max(0, deadline - (Date.now() + offset)) : null);
