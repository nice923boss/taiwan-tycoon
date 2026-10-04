// Shared mutation helpers used by the action handlers. They operate on a *draft*
// (a structuredClone made in applyAction), never on the caller's state object.
//
// The engine is language-neutral: log lines (and errors, see rules.js) are
// stored as { key, params } and rendered by the UI in the viewer's current language.
// Param naming convention (resolved by js/i18n/i18n.js):
//   p, q  -> player index      sq   -> square id      amt, amt2 -> money
//   card  -> card id           news -> news id       sym       -> stock symbol
//   deck  -> 'chance' | 'fate' anything else       -> shown as is

import { RULES } from './rules.js';

const LOG_KEEP = 60;
const EVENT_KEEP = 24;

export function log(g, key, params = {}) {
  g.logSeq += 1;
  g.log = [...g.log, { n: g.logSeq, key, params }].slice(-LOG_KEEP);
}

export function emit(g, event) {
  g.eventSeq += 1;
  g.events = [...g.events, { n: g.eventSeq, ...event }].slice(-EVENT_KEEP);
}

export function setPhase(g, phase, now) {
  g.phase = phase;
  const ms = RULES.phaseMs[phase];
  if (!ms) {
    g.deadline = null;
    return;
  }
  const deadline = now + ms;
  const turnCap = g.turnStartedAt + RULES.turnCapMs;
  // The turn cap only limits the current player's own decision phases.
  const capped = phase === 'preRoll' || phase === 'postRoll' ? Math.min(deadline, Math.max(turnCap, now + 5000)) : deadline;
  g.deadline = capped;
}
