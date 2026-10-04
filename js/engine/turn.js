// Turn flow: dice, movement, landing resolution, cards, jail, debts, bankruptcy,
// round close and game end. All functions mutate a draft state `g`.
//
// Control-flow convention: while a roll/card is being resolved the phase is the
// transient value 'moving'. A step that needs a decision switches to 'buy',
// 'auction' or 'debt'. applyAction calls settle() afterwards, which turns a
// leftover 'moving' into preRoll (doubles) or postRoll.

import { BOARD_SIZE, GROUPS, JAIL_POS, SQUARES, mortgageValue } from './board.js';
import { CARD_BY_ID } from './cards.js';
import { nextInt } from './rng.js';
import { RULES, alivePlayers, buildingsOf, mortgageError, netWorth, rentFor, sellBuildingError } from './rules.js';
import { STOCKS, closeMarket, dividendFor, sellProceeds, shockStock } from './stocks.js';
import { emit, log, setPhase } from './state.js';

export const BANK = -1;
export const JAIL_CARD_ID = { chance: 'c08', fate: 'f05' };
const MAX_CARD_DEPTH = 3;

// ---------- money ----------

function transfer(g, payer, creditors) {
  for (const c of creditors) {
    g.players[payer].cash -= c.amount;
    if (c.p !== BANK) g.players[c.p].cash += c.amount;
  }
}

const totalOf = (creditors) => creditors.reduce((s, c) => s + c.amount, 0);

// Charge the current player. Pays immediately when possible, otherwise opens a
// debt. `why` is a { key, params } reason shown in the debt dialog.
export function charge(g, payer, creditors, why, now, then = null) {
  const amount = totalOf(creditors);
  if (amount <= 0) {
    if (then) runThen(g, then, now);
    return;
  }
  if (g.players[payer].cash >= amount) {
    transfer(g, payer, creditors);
    if (then) runThen(g, then, now);
    return;
  }
  g.debt = { p: payer, creditors, amount, why, then };
  log(g, 'log.debtOpen', { p: payer, amt: amount });
  setPhase(g, 'debt', now);
}

export function tryPayDebt(g, now) {
  const d = g.debt;
  if (!d || g.players[d.p].cash < d.amount) return false;
  transfer(g, d.p, d.creditors);
  log(g, 'log.debtPaid', { p: d.p, amt: d.amount });
  g.debt = null;
  g.phase = 'moving';
  if (d.then) runThen(g, d.then, now);
  return true;
}

function runThen(g, then, now) {
  if (then.kind === 'jailMove') {
    const pl = g.players[then.p];
    pl.inJail = false;
    pl.jailTurns = 0;
    log(g, 'log.bailForced', { p: then.p, amt: RULES.jailFine });
    moveBy(g, then.p, then.steps);
    resolveLanding(g, then.p, now);
  }
}

// Sell assets automatically until `amount` cash is available. Order: stocks,
// mortgage undeveloped lots, sell buildings, mortgage the rest.
export function autoRaise(g, p, amount) {
  const pl = g.players[p];
  const enough = () => pl.cash >= amount;
  const syms = Object.keys(pl.stocks).sort(
    (a, b) => g.market.stocks[b].price * pl.stocks[b].n - g.market.stocks[a].price * pl.stocks[a].n,
  );
  for (const sym of syms) {
    if (enough()) break;
    const price = g.market.stocks[sym].price;
    const n = Math.min(pl.stocks[sym].n, Math.ceil((amount - pl.cash) / price) + 1);
    sellShares(g, p, sym, n);
  }
  const owned = () => SQUARES.filter((s) => g.props[s.id]?.owner === p).sort((a, b) => a.price - b.price);
  for (const s of owned()) {
    if (enough()) break;
    if (!mortgageError(g, p, s.id)) mortgageProp(g, p, s.id);
  }
  for (let guard = 0; guard < 200 && !enough(); guard += 1) {
    const target = owned()
      .filter((s) => !sellBuildingError(g, p, s.id))
      .sort((a, b) => g.props[b.id].houses - g.props[a.id].houses)[0];
    if (!target) break;
    sellBuilding(g, p, target.id);
  }
  for (const s of owned()) {
    if (enough()) break;
    if (!mortgageError(g, p, s.id)) mortgageProp(g, p, s.id);
  }
  log(g, 'log.autoRaise', { p });
  return enough();
}

export function sellShares(g, p, sym, n) {
  const pl = g.players[p];
  const h = pl.stocks[sym];
  const proceeds = sellProceeds(g.market.stocks[sym].price, n);
  pl.cash += proceeds;
  const remaining = h.n - n;
  if (remaining <= 0) {
    const { [sym]: _sold, ...rest } = pl.stocks;
    pl.stocks = rest;
  } else {
    pl.stocks = { ...pl.stocks, [sym]: { n: remaining, cost: Math.round((h.cost * remaining) / h.n) } };
  }
  return proceeds;
}

export function addShares(pl, sym, n, cost) {
  const h = pl.stocks[sym] ?? { n: 0, cost: 0 };
  pl.stocks = { ...pl.stocks, [sym]: { n: h.n + n, cost: h.cost + cost } };
}

export function sellBuilding(g, p, id) {
  const refund = GROUPS[SQUARES[id].group].houseCost / 2;
  g.props[id].houses -= 1;
  g.players[p].cash += refund;
  return refund;
}

export function mortgageProp(g, p, id) {
  g.props[id].mortgaged = true;
  g.players[p].cash += mortgageValue(id);
}

// ---------- movement ----------

export function moveBy(g, p, steps) {
  const pl = g.players[p];
  const from = pl.pos;
  const raw = from + steps;
  pl.pos = ((raw % BOARD_SIZE) + BOARD_SIZE) % BOARD_SIZE;
  emit(g, { kind: 'move', p, from, to: pl.pos, steps });
  if (steps > 0 && raw >= BOARD_SIZE) {
    pl.cash += RULES.goSalary;
    log(g, 'log.passGo', { p, amt: RULES.goSalary });
  }
}

export function sendToJail(g, p) {
  const pl = g.players[p];
  emit(g, { kind: 'move', p, from: pl.pos, to: JAIL_POS, steps: 0, jump: true });
  pl.pos = JAIL_POS;
  pl.inJail = true;
  pl.jailTurns = 0;
  if (p === g.current) {
    g.extraRoll = false;
    g.doublesCount = 0;
  }
  log(g, 'log.jailed', { p });
}

export function resolveLanding(g, p, now, opts = {}, depth = 0) {
  const pl = g.players[p];
  const sq = SQUARES[pl.pos];
  if (sq.type === 'property' || sq.type === 'station' || sq.type === 'utility') {
    const st = g.props[sq.id];
    if (st.owner === null) {
      g.pendingBuy = sq.id;
      log(g, 'log.canBuy', { p, sq: sq.id, amt: sq.price });
      setPhase(g, 'buy', now);
      return;
    }
    if (st.owner === p) return;
    if (st.mortgaged) {
      log(g, 'log.mortgagedNoRent', { p, sq: sq.id });
      return;
    }
    const diceSum = g.dice ? g.dice[0] + g.dice[1] : 7;
    const rent = rentFor(g, sq.id, diceSum, opts);
    log(g, 'log.payRent', { p, q: st.owner, sq: sq.id, amt: rent });
    emit(g, { kind: 'rent', from: p, to: st.owner, amount: rent, square: sq.id });
    charge(g, p, [{ p: st.owner, amount: rent }], { key: 'why.rent', params: { sq: sq.id } }, now);
    return;
  }
  if (sq.type === 'tax') {
    log(g, 'log.payTax', { p, sq: sq.id, amt: sq.amount });
    charge(g, p, [{ p: BANK, amount: sq.amount }], { key: 'why.tax', params: { sq: sq.id } }, now);
    return;
  }
  if (sq.type === 'chance' || sq.type === 'fate') {
    if (depth < MAX_CARD_DEPTH) drawCard(g, p, sq.type, now, depth);
    return;
  }
  if (sq.type === 'gotojail') sendToJail(g, p);
}

// ---------- cards ----------

function drawCard(g, p, deckName, now, depth) {
  const deck = g.decks[deckName];
  const id = deck[0];
  const card = CARD_BY_ID[id];
  g.decks[deckName] = card.kind === 'jail_free' ? deck.slice(1) : [...deck.slice(1), id];
  log(g, 'log.drawCard', { p, deck: deckName, card: id });
  emit(g, { kind: 'card', p, deck: deckName, card: id });
  applyCard(g, p, card, now, depth);
}

function nearestForward(from, type) {
  for (let step = 1; step <= BOARD_SIZE; step += 1) {
    if (SQUARES[(from + step) % BOARD_SIZE].type === type) return step;
  }
  return 0;
}

// Collect money from a non-current player; they liquidate automatically and go
// bankrupt (to the receiver) if they still cannot pay.
function collectFrom(g, payer, receiver, amount, now) {
  const pl = g.players[payer];
  if (pl.cash < amount && !autoRaise(g, payer, amount)) {
    bankrupt(g, payer, [{ p: receiver, amount }], now);
    return;
  }
  transfer(g, payer, [{ p: receiver, amount }]);
}

const CARD_WHY = { key: 'why.card' };

export function applyCard(g, p, card, now, depth = 0) {
  const pl = g.players[p];
  switch (card.kind) {
    case 'move_to':
      moveBy(g, p, (card.to - pl.pos + BOARD_SIZE) % BOARD_SIZE);
      resolveLanding(g, p, now, {}, depth + 1);
      break;
    case 'move_rel':
      moveBy(g, p, card.steps);
      resolveLanding(g, p, now, {}, depth + 1);
      break;
    case 'nearest':
      moveBy(g, p, nearestForward(pl.pos, card.target));
      resolveLanding(g, p, now, card.target === 'station' ? { stationMult: 2 } : { utilityMult: 10 }, depth + 1);
      break;
    case 'collect':
      pl.cash += card.amount;
      break;
    case 'pay':
      charge(g, p, [{ p: BANK, amount: card.amount }], CARD_WHY, now);
      break;
    case 'pay_each': {
      const others = alivePlayers(g).filter((i) => i !== p);
      charge(g, p, others.map((i) => ({ p: i, amount: card.amount })), CARD_WHY, now);
      break;
    }
    case 'collect_each':
      for (const i of alivePlayers(g).filter((x) => x !== p)) collectFrom(g, i, p, card.amount, now);
      break;
    case 'repairs': {
      const { houses, hotels } = buildingsOf(g, p);
      const total = houses * card.house + hotels * card.hotel;
      if (total > 0) {
        log(g, 'log.repairs', { p, houses, hotels, amt: total });
        charge(g, p, [{ p: BANK, amount: total }], { key: 'why.repairs' }, now);
      }
      break;
    }
    case 'go_jail':
      sendToJail(g, p);
      break;
    case 'jail_free':
      pl.jailCards = [...pl.jailCards, card.deck];
      break;
    case 'stock_shock':
      shockStock(g.market, card.sym, card.pct);
      break;
    case 'stock_gift':
      addShares(pl, card.sym, card.shares, 0);
      break;
    case 'market_shock':
      for (const s of STOCKS) shockStock(g.market, s.sym, card.pct);
      break;
    default:
      break;
  }
}

// ---------- dice ----------

export function roll(g, p, now) {
  const pl = g.players[p];
  const d1 = 1 + nextInt(g, 6);
  const d2 = 1 + nextInt(g, 6);
  const isDouble = d1 === d2;
  g.dice = [d1, d2];
  g.phase = 'moving';
  emit(g, { kind: 'dice', p, dice: [d1, d2] });
  log(g, isDouble ? 'log.diceDouble' : 'log.dice', { p, d1, d2, sum: d1 + d2 });

  if (pl.inJail) {
    g.extraRoll = false;
    if (isDouble) {
      pl.inJail = false;
      pl.jailTurns = 0;
      log(g, 'log.jailDoubleOut', { p });
      moveBy(g, p, d1 + d2);
      resolveLanding(g, p, now);
      return;
    }
    pl.jailTurns += 1;
    if (pl.jailTurns >= RULES.maxJailTurns) {
      charge(g, p, [{ p: BANK, amount: RULES.jailFine }], { key: 'why.bail' }, now, { kind: 'jailMove', p, steps: d1 + d2 });
      return;
    }
    log(g, 'log.jailStay', { p, n: pl.jailTurns });
    return;
  }

  if (isDouble) {
    g.doublesCount += 1;
    if (g.doublesCount >= 3) {
      log(g, 'log.speeding', { p });
      sendToJail(g, p);
      return;
    }
    g.extraRoll = true;
  } else {
    g.extraRoll = false;
  }
  moveBy(g, p, d1 + d2);
  resolveLanding(g, p, now);
}

// ---------- turn / round / end ----------

export function settle(g, now) {
  if (g.phase !== 'moving') return;
  const pl = g.players[g.current];
  if (pl.bankrupt) {
    nextTurn(g, now);
    return;
  }
  if (g.extraRoll && !pl.inJail) {
    log(g, 'log.extraRoll', { p: g.current });
    setPhase(g, 'preRoll', now);
  } else {
    setPhase(g, 'postRoll', now);
  }
}

export function nextTurn(g, now) {
  const alive = alivePlayers(g);
  if (alive.length <= 1) {
    endGame(g, now);
    return;
  }
  const after = alive.find((i) => i > g.current);
  if (after === undefined) {
    endRound(g, now);
    if (g.phase === 'gameOver') return;
  }
  g.current = after ?? alive[0];
  g.doublesCount = 0;
  g.extraRoll = false;
  g.dice = null;
  g.pendingBuy = null;
  g.turnStartedAt = now;
  setPhase(g, 'preRoll', now);
  emit(g, { kind: 'turn', p: g.current });
}

function endRound(g, now) {
  const news = closeMarket(g, g.round);
  log(g, 'log.roundClose', { round: g.round });
  if (news) log(g, 'log.news', { news: news.id });
  emit(g, { kind: 'close', round: g.round, news: news?.id ?? null });
  for (const i of alivePlayers(g)) {
    const pl = g.players[i];
    const total = Object.entries(pl.stocks).reduce((s, [sym, h]) => s + dividendFor(g.market, sym, h.n), 0);
    if (total > 0) {
      pl.cash += total;
      log(g, 'log.dividend', { p: i, amt: total });
    }
  }
  g.worthLog = [...g.worthLog, { r: g.round, w: g.players.map((pl, i) => (pl.bankrupt ? 0 : netWorth(g, i))) }];
  g.round += 1;
  if (g.round > g.maxRounds) endGame(g, now);
}

export function endGame(g, now) {
  const alive = alivePlayers(g).map((p) => ({ p, worth: netWorth(g, p) })).sort((a, b) => b.worth - a.worth);
  const fallen = [...g.bankruptOrder].reverse().map((p) => ({ p, worth: 0 }));
  g.ranking = [...alive, ...fallen];
  g.winner = g.ranking[0].p;
  g.phase = 'gameOver';
  g.deadline = null;
  g.auction = null;
  g.trade = null;
  g.debt = null;
  g.pendingBuy = null;
  g.endedAt = now;
  log(g, 'log.gameOver', { p: g.winner, amt: g.ranking[0].worth });
  emit(g, { kind: 'gameover', winner: g.winner });
}

// A single player creditor takes everything; otherwise (bank or several
// players) properties return to the bank and cash is split pro rata.
export function bankrupt(g, p, creditors, now) {
  const pl = g.players[p];
  for (const s of SQUARES) {
    const st = g.props[s.id];
    if (st?.owner === p && st.houses > 0) {
      pl.cash += st.houses * (GROUPS[s.group].houseCost / 2);
      st.houses = 0;
    }
  }
  for (const sym of Object.keys(pl.stocks)) sellShares(g, p, sym, pl.stocks[sym].n);

  const single = creditors.length === 1 && creditors[0].p !== BANK ? creditors[0].p : null;
  const cash = pl.cash;
  pl.cash = 0;
  if (single !== null) {
    g.players[single].cash += cash;
    g.players[single].jailCards = [...g.players[single].jailCards, ...pl.jailCards];
  } else {
    const owed = totalOf(creditors);
    for (const c of creditors) {
      if (c.p !== BANK && owed > 0) g.players[c.p].cash += Math.floor((cash * c.amount) / owed);
    }
    for (const deck of pl.jailCards) g.decks[deck] = [...g.decks[deck], JAIL_CARD_ID[deck]];
  }
  for (const s of SQUARES) {
    const st = g.props[s.id];
    if (st?.owner !== p) continue;
    if (single !== null) st.owner = single;
    else Object.assign(st, { owner: null, mortgaged: false, houses: 0 });
  }
  pl.jailCards = [];
  pl.inJail = false;
  pl.bankrupt = true;
  g.bankruptOrder = [...g.bankruptOrder, p];
  log(g, single !== null ? 'log.bankruptTo' : 'log.bankruptBank', { p, q: single });
  emit(g, { kind: 'bankrupt', p });
  if (alivePlayers(g).length <= 1) endGame(g, now);
}
