// Auction of an unbought square. Every alive player (including the one who
// declined) may bid; each bid restarts the countdown. When the countdown ends,
// or only the high bidder is left, the high bidder buys the square.

import { RULES, alivePlayers, fail } from './rules.js';
import { emit, log, setPhase } from './state.js';
import { autoRaise } from './turn.js';

export function startAuction(g, sq, now) {
  g.pendingBuy = null;
  g.auction = { sq, bid: 0, bidder: null, active: alivePlayers(g) };
  log(g, 'log.auctionStart', { sq });
  setPhase(g, 'auction', now);
}

export function minNextBid(auction) {
  return auction.bidder === null ? RULES.minBid : auction.bid + RULES.bidStep;
}

export function bid(g, p, amount, now) {
  const a = g.auction;
  if (!a.active.includes(p)) return fail('notInAuction');
  if (a.bidder === p) return fail('alreadyTopBid');
  if (!Number.isInteger(amount) || amount < minNextBid(a)) return fail('bidTooLow', { amt: minNextBid(a) });
  if (amount > g.players[p].cash) return fail('notEnoughCash');
  g.auction = { ...a, bid: amount, bidder: p };
  log(g, 'log.bid', { p, amt: amount });
  setPhase(g, 'auction', now);
  return checkAuctionEnd(g, now);
}

export function passBid(g, p, now) {
  const a = g.auction;
  if (!a.active.includes(p)) return fail('notInAuction');
  g.auction = { ...a, active: a.active.filter((i) => i !== p) };
  log(g, 'log.bidPass', { p });
  return checkAuctionEnd(g, now);
}

// Remove a player who left the game (resignation) from a running auction.
export function dropFromAuction(g, p, now) {
  const a = g.auction;
  const lostHighBid = a.bidder === p;
  g.auction = {
    ...a,
    active: a.active.filter((i) => i !== p),
    bid: lostHighBid ? 0 : a.bid,
    bidder: lostHighBid ? null : a.bidder,
  };
  checkAuctionEnd(g, now);
}

function checkAuctionEnd(g, now) {
  const { active, bidder } = g.auction;
  if (active.length === 0 || (active.length === 1 && active[0] === bidder)) resolveAuction(g, now);
  return null;
}

export function resolveAuction(g, now) {
  const { sq, bid: amount, bidder } = g.auction;
  g.auction = null;
  const winner = bidder === null ? null : g.players[bidder];
  // Cash may have dropped since the bid (stock purchases); sell assets to cover it.
  if (winner && (winner.cash >= amount || autoRaise(g, bidder, amount))) {
    winner.cash -= amount;
    g.props[sq].owner = bidder;
    log(g, 'log.auctionWon', { p: bidder, sq, amt: amount });
    emit(g, { kind: 'buy', p: bidder, square: sq });
  } else {
    log(g, 'log.auctionNoSale', { sq });
  }
  setPhase(g, 'moving', now);
}
