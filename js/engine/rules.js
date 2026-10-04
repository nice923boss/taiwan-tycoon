// Game constants and pure read-only rule helpers (no state mutation here).

import {
  GROUPS, SQUARES, STATION_RENT, UTILITY_MULT, groupMembers, mortgageValue,
} from './board.js';
import { holdingsValue } from './stocks.js';

export const RULES = {
  maxPlayers: 6,
  minPlayers: 2,
  startCash: 1500,
  goSalary: 200,
  jailFine: 50,
  maxJailTurns: 3,
  roundOptions: [15, 25, 40, 0], // 0: no round limit, play until one player is left
  defaultRounds: 25,
  // In every game, rent rises by perRound percent each round after round `after`.
  rentRise: { after: 20, perRound: 20 },
  minBid: 10,
  bidStep: 10,
  mortgageTransferFee: 0.1,
  maxShareOrder: 100000,
  // Per-phase decision time (ms). The host fires TIMEOUT when a deadline passes.
  phaseMs: { preRoll: 40000, buy: 25000, auction: 12000, postRoll: 40000, debt: 60000, trade: 30000 },
  turnCapMs: 180000,
};

export const PLAYER_COLORS = ['#e8453c', '#2f7de1', '#2fae5a', '#f2b632', '#8e5bd6', '#f07c2a'];

export const alivePlayers = (g) => g.players.map((p, i) => i).filter((i) => !g.players[i].bankrupt);

export function ownsWholeGroup(g, p, group) {
  return groupMembers(group).every((id) => g.props[id].owner === p);
}

export function groupHasBuildings(g, group) {
  return groupMembers(group).some((id) => g.props[id].houses > 0);
}

export function countOwnedOfType(g, p, type) {
  return SQUARES.filter((s) => s.type === type && g.props[s.id].owner === p).length;
}

// Rent in percent of the listed rent during `round`.
export const rentPercent = (round) => 100 + RULES.rentRise.perRound * Math.max(0, round - RULES.rentRise.after);

// Rent owed when landing on `id`. `opts.stationMult` / `opts.utilityMult` come from cards.
export function rentFor(g, id, diceSum, opts = {}) {
  return Math.round((listedRent(g, id, diceSum, opts) * rentPercent(g.round)) / 100);
}

function listedRent(g, id, diceSum, opts) {
  const sq = SQUARES[id];
  const st = g.props[id];
  if (st.owner === null || st.mortgaged) return 0;
  if (sq.type === 'station') {
    return STATION_RENT[countOwnedOfType(g, st.owner, 'station') - 1] * (opts.stationMult ?? 1);
  }
  if (sq.type === 'utility') {
    const mult = opts.utilityMult ?? UTILITY_MULT[countOwnedOfType(g, st.owner, 'utility') - 1];
    return diceSum * mult;
  }
  if (st.houses > 0) return sq.rent[st.houses];
  return ownsWholeGroup(g, st.owner, sq.group) ? sq.rent[0] * 2 : sq.rent[0];
}

export function buildingsOf(g, p) {
  let houses = 0;
  let hotels = 0;
  for (const s of SQUARES) {
    const st = g.props[s.id];
    if (!st || st.owner !== p) continue;
    if (st.houses === 5) hotels += 1;
    else houses += st.houses;
  }
  return { houses, hotels };
}

export function netWorth(g, p) {
  const pl = g.players[p];
  let total = pl.cash + holdingsValue(g.market, pl.stocks);
  for (const s of SQUARES) {
    const st = g.props[s.id];
    if (!st || st.owner !== p) continue;
    total += st.mortgaged ? mortgageValue(s.id) : s.price;
    if (s.group) total += st.houses * GROUPS[s.group].houseCost;
  }
  return total;
}

// --- Validation helpers: return an error { key, params } or null. ---
// Errors are language-neutral; the UI renders `key` via js/i18n.

export const fail = (key, params = {}) => ({ key: `err.${key}`, params });

export function buildError(g, p, id) {
  const sq = SQUARES[id];
  const st = g.props[id];
  if (!sq || sq.type !== 'property') return fail('notBuildable');
  if (st.owner !== p) return fail('notYourProperty');
  if (!ownsWholeGroup(g, p, sq.group)) return fail('needFullGroup');
  const members = groupMembers(sq.group);
  if (members.some((m) => g.props[m].mortgaged)) return fail('groupMortgaged');
  if (st.houses >= 5) return fail('alreadyHotel');
  const minLevel = Math.min(...members.map((m) => g.props[m].houses));
  if (st.houses > minLevel) return fail('buildEvenly');
  if (g.players[p].cash < GROUPS[sq.group].houseCost) return fail('notEnoughCash');
  return null;
}

export function sellBuildingError(g, p, id) {
  const sq = SQUARES[id];
  const st = g.props[id];
  if (!sq || sq.type !== 'property' || st.owner !== p) return fail('notYourProperty');
  if (st.houses === 0) return fail('noBuilding');
  const maxLevel = Math.max(...groupMembers(sq.group).map((m) => g.props[m].houses));
  if (st.houses < maxLevel) return fail('sellEvenly');
  return null;
}

export function mortgageError(g, p, id) {
  const sq = SQUARES[id];
  const st = g.props[id];
  if (!st || st.owner !== p) return fail('notYourProperty');
  if (st.mortgaged) return fail('alreadyMortgaged');
  if (sq.group && groupHasBuildings(g, sq.group)) return fail('groupHasBuildings');
  return null;
}

export function unmortgageError(g, p, id, cost) {
  const st = g.props[id];
  if (!st || st.owner !== p) return fail('notYourProperty');
  if (!st.mortgaged) return fail('notMortgaged');
  if (g.players[p].cash < cost) return fail('notEnoughCash');
  return null;
}

// A property can change hands only when its color group has no buildings.
export function tradableError(g, p, id) {
  const sq = SQUARES[id];
  const st = g.props[id];
  if (!st || st.owner !== p) return fail('notOwnedBy', { sq: id, p });
  if (sq.group && groupHasBuildings(g, sq.group)) return fail('tradeHasBuildings', { sq: id });
  return null;
}
