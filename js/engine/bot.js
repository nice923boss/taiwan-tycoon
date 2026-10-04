// Computer play for a seat whose player is away. Cautious on purpose: it keeps
// the seat alive without making choices the player might regret (no bids, no
// stock trades, no deals).

import { SQUARES } from './board.js';
import { actorOf } from './game.js';

export const BOT_RESERVE = 300; // cash kept after buying a square

// The action seat `p` takes now, or null when it has nothing to do.
export function computerAction(g, p) {
  const pl = g.players[p];
  if (!pl || pl.bankrupt || !actorOf(g).includes(p)) return null;
  switch (g.phase) {
    case 'preRoll':
      return { type: pl.inJail && pl.jailCards.length > 0 ? 'USE_JAIL_CARD' : 'ROLL', p };
    case 'buy':
      return { type: pl.cash - SQUARES[g.pendingBuy].price >= BOT_RESERVE ? 'BUY' : 'DECLINE', p };
    case 'auction':
      return { type: 'PASS_BID', p };
    case 'postRoll':
      return { type: 'END_TURN', p };
    case 'trade':
      return { type: 'REJECT_TRADE', p };
    case 'debt':
      return { type: 'LIQUIDATE', p };
    default:
      return null;
  }
}
