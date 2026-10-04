// Game log and chat panels. Log lines are { key, params } and re-render in the
// current language; chat text is shown exactly as typed (never translated).

import { CHAT_MAX } from '../net/protocol.js';
import { t, tm } from '../i18n/i18n.js';
import { $, fill, h } from './dom.js';

export function createFeed({ session }) {
  const logPanel = $('#panel-log');
  const chatPanel = $('#panel-chat');
  const badge = $('#chat-badge');
  const logList = h('ol', { class: 'log-list', reversed: true });
  const chatList = h('ul', { class: 'chat-list', 'aria-live': 'polite' });
  const input = h('input', { type: 'text', maxlength: CHAT_MAX, autocomplete: 'off' });
  const sendBtn = h('button', { type: 'submit', class: 'btn btn-primary btn-sm' });
  const form = h('form', { class: 'chat-form' }, input, sendBtn);
  fill(logPanel, logList);
  fill(chatPanel, h('div', { class: 'chat' }, chatList, form));

  let last = null;
  let seenChat = 0; // highest chat line number the viewer has seen
  let logSig = '';
  let chatSig = '';

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    if (session.send({ t: 'chat', text })) input.value = '';
  });

  function labels() {
    input.placeholder = t('ui.chatPlaceholder');
    input.setAttribute('aria-label', t('ui.chatPlaceholder'));
    fill(sendBtn, t('ui.send'));
    logList.setAttribute('aria-label', t('ui.tabLog'));
  }

  function renderLog(game) {
    const sig = `${game?.logSeq ?? 0}`;
    if (sig === logSig) return;
    logSig = sig;
    const lines = game ? [...game.log].reverse() : [];
    fill(logList, lines.map((line) => h('li', {}, tm(line, game))));
  }

  function colorOf(state, id) {
    return state.game?.players.find((pl) => pl.id === id)?.color ?? null;
  }

  function renderChat(state) {
    const lines = state.chat;
    const sig = `${lines.at(-1)?.n ?? 0}|${lines.length}`;
    if (sig !== chatSig) {
      chatSig = sig;
      const nearBottom = chatList.scrollHeight - chatList.scrollTop - chatList.clientHeight < 40;
      fill(chatList, lines.map((line) => h('li', {},
        h('span', { class: 'chat-who', style: { color: colorOf(state, line.id) } }, line.name),
        h('span', {}, line.text))));
      if (nearBottom) chatList.scrollTop = chatList.scrollHeight;
    }
    const newest = lines.at(-1)?.n ?? 0;
    if (!chatPanel.hidden) seenChat = newest;
    const unread = lines.filter((line) => line.n > seenChat && line.id !== state.you).length;
    badge.hidden = unread === 0;
    badge.textContent = unread > 9 ? '9+' : String(unread);
  }

  labels();

  return {
    render(state) {
      last = state;
      renderLog(state.game);
      renderChat(state);
    },
    // Called by the tab switcher so the unread badge clears when chat is opened.
    shown(tab) {
      if (tab === 'chat' && last) {
        chatList.scrollTop = chatList.scrollHeight;
        renderChat(last);
      }
    },
    relabel() {
      labels();
      logSig = '';
      if (last) renderLog(last.game);
    },
  };
}
