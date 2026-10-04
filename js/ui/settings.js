// Per-device preferences (localStorage) and the settings dialog.

import { LANGS, getLang, setLang, t } from '../i18n/i18n.js';
import { NAME_MAX } from '../net/protocol.js';
import { button, confirmDialog, h, openDialog } from './dom.js';

const KEY = 'monopoly.settings';
const NAME_KEY = 'monopoly.name';
const DEFAULTS = { sound: true, music: false, motion: 'auto', view: '3d' };

const listeners = new Set();
let current = { ...DEFAULTS, ...read(KEY) };

function read(key) {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null') ?? {};
  } catch {
    return {};
  }
}

export const settings = () => current;

export function setSetting(key, value) {
  if (current[key] === value) return;
  current = { ...current, [key]: value };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // Not persisted: still applies to this tab.
  }
  for (const fn of listeners) fn(key, value);
}

export function onSettingsChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const motionQuery = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');

export function reducedMotion() {
  if (current.motion === 'reduced') return true;
  if (current.motion === 'full') return false;
  return Boolean(motionQuery?.matches);
}

export function loadName() {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveName(name) {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // Name still goes to the room for this session.
  }
}

// A row of toggle buttons; `options` is [[value, label]].
function segmented(options, value, onPick) {
  const wrap = h('div', { class: 'seg', role: 'group' });
  for (const [v, label] of options) {
    wrap.append(h('button', {
      type: 'button', class: 'btn btn-sm', 'aria-pressed': String(v === value),
      onclick: () => {
        for (const b of wrap.children) b.setAttribute('aria-pressed', 'false');
        wrap.children[options.findIndex(([x]) => x === v)].setAttribute('aria-pressed', 'true');
        onPick(v);
      },
    }, label));
  }
  return wrap;
}

const row = (label, control) => h('div', { class: 'form-row' }, h('span', {}, label), control);
const onOff = () => [[true, t('ui.on')], [false, t('ui.off')]];

// ctx: { session, canResign(): boolean, onResign(), startTour() }
export function openSettings(ctx) {
  const { room, you } = ctx.session.state;
  const myName = [...(room?.seats ?? []), ...(room?.spectators ?? [])].find((m) => m.id === you)?.name;
  const nameInput = h('input', { maxlength: NAME_MAX, value: myName ?? loadName(), autocomplete: 'nickname' });
  const saveNameBtn = button(t('ui.save'), {
    kind: 'btn-sm',
    onClick: () => {
      const name = nameInput.value.trim();
      if (!name) return;
      saveName(name);
      ctx.session.setName(name);
    },
  });
  const body = h('div', {},
    row(t('ui.language'), segmented(LANGS.map((l) => [l.code, l.label]), getLang(), (code) => setLang(code))),
    row(t('ui.sound'), segmented(onOff(), current.sound, (v) => setSetting('sound', v))),
    row(t('ui.music'), segmented(onOff(), current.music, (v) => setSetting('music', v))),
    row(t('ui.motion'), segmented([['auto', t('ui.motionAuto')], ['full', t('ui.motionFull')], ['reduced', t('ui.motionReduced')]], current.motion, (v) => setSetting('motion', v))),
    row(t('ui.view'), segmented([['3d', t('ui.view3d')], ['2d', t('ui.view2d')]], current.view, (v) => setSetting('view', v))),
    row(t('ui.yourName'), h('span', { class: 'dock-row' }, nameInput, saveNameBtn)),
  );
  const d = openDialog({ title: t('ui.settings'), body });
  const actions = [button(t('ui.tour'), { iconName: 'book-open', onClick: () => { d.close(); ctx.startTour(); } })];
  if (ctx.canResign()) {
    actions.push(button(t('ui.resign'), {
      kind: 'btn-danger',
      iconName: 'flag',
      onClick: async () => {
        d.close();
        if (await confirmDialog(t('ui.resignConfirm'), { okLabel: t('ui.resign'), danger: true })) ctx.onResign();
      },
    }));
  }
  d.setActions(...actions);
  return d;
}
