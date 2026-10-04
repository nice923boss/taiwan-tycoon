// Stock market: six fictional Taiwan-style companies. Names, sectors and news
// text live in js/i18n (keys `stock.<SYM>`, `sector.<SYM>`, `news.<id>`).
// Prices carry 2 decimals; cash stays integer (buy cost rounds up, sell proceeds round down).
// Every close is limited to ±10% of the previous close (Taiwan daily price limit).
// `history` holds one candle per closed round: { r, o, h, l, c }. Card shocks during
// a round move `price` and widen that round's high/low (`hi`/`lo`).

import { gaussian, nextFloat, nextInt } from './rng.js';

export const STOCKS = [
  { sym: 'CHIP', base: 120, vol: 0.045, drift: 0.004, beta: 1.3, div: 0.002 },
  { sym: 'SHIP', base: 60, vol: 0.055, drift: 0.002, beta: 1.1, div: 0.006 },
  { sym: 'BEAR', base: 30, vol: 0.02, drift: 0.002, beta: 0.7, div: 0.008 },
  { sym: 'BOBA', base: 45, vol: 0.035, drift: 0.003, beta: 0.8, div: 0.005 },
  { sym: 'TOUR', base: 50, vol: 0.04, drift: 0.002, beta: 0.9, div: 0.004 },
  { sym: 'GREN', base: 40, vol: 0.05, drift: 0.004, beta: 1.0, div: 0.003 },
];

export const STOCK_BY_SYM = Object.fromEntries(STOCKS.map((s) => [s.sym, s]));

export const PRICE_LIMIT = 0.1;
const HISTORY_LEN = 40;
const NEWS_KEEP = 8;
const NEWS_CHANCE = 0.4;
const MARKET_VOL = 0.012;
const MEAN_REVERSION = 0.04;

const scaleAll = (pct) => Object.fromEntries(STOCKS.map((s) => [s.sym, pct]));

export const NEWS = [
  { id: 'n01', fx: { CHIP: 0.08 } },
  { id: 'n02', fx: { CHIP: -0.07 } },
  { id: 'n03', fx: { SHIP: 0.09 } },
  { id: 'n04', fx: { SHIP: -0.08 } },
  { id: 'n05', fx: { BEAR: 0.04 } },
  { id: 'n06', fx: { BEAR: -0.06 } },
  { id: 'n07', fx: { BOBA: 0.08 } },
  { id: 'n08', fx: { BOBA: -0.08 } },
  { id: 'n09', fx: { TOUR: 0.07 } },
  { id: 'n10', fx: { TOUR: -0.08 } },
  { id: 'n11', fx: { GREN: 0.08 } },
  { id: 'n12', fx: { GREN: -0.07 } },
  { id: 'n13', fx: scaleAll(0.04) },
  { id: 'n14', fx: scaleAll(-0.05) },
  { id: 'n15', fx: { CHIP: -0.03, GREN: 0.05 } },
  { id: 'n16', fx: { SHIP: 0.04, GREN: -0.04 } },
];

export const round2 = (n) => Math.round(n * 100) / 100;

export function createMarket() {
  const stocks = Object.fromEntries(
    STOCKS.map((s) => [s.sym, {
      price: s.base,
      prevClose: s.base,
      hi: s.base,
      lo: s.base,
      history: [{ r: 0, o: s.base, h: s.base, l: s.base, c: s.base }],
    }]),
  );
  return { stocks, news: [] };
}

export function buyCost(price, shares) {
  return Math.ceil(round2(price * shares));
}

export function sellProceeds(price, shares) {
  return Math.floor(round2(price * shares));
}

function clampToLimit(price, prevClose) {
  const lo = prevClose * (1 - PRICE_LIMIT);
  const hi = prevClose * (1 + PRICE_LIMIT);
  return round2(Math.max(0.01, Math.min(hi, Math.max(lo, price))));
}

// Immediate price shock (cards). Still bounded by today's price limit.
export function shockStock(market, sym, pct) {
  const st = market.stocks[sym];
  st.price = clampToLimit(st.price * (1 + pct), st.prevClose);
  st.hi = Math.max(st.hi, st.price);
  st.lo = Math.min(st.lo, st.price);
}

// Round close: random walk + news + mean reversion. Mutates `holder.market` (a draft)
// and consumes randomness from `holder.rng`. Returns the news item (or null).
export function closeMarket(holder, round) {
  const { market } = holder;
  const news = nextFloat(holder) < NEWS_CHANCE ? NEWS[nextInt(holder, NEWS.length)] : null;
  const marketMove = gaussian(holder) * MARKET_VOL;
  for (const def of STOCKS) {
    const st = market.stocks[def.sym];
    const revert = MEAN_REVERSION * Math.log(def.base / st.price);
    const change = def.drift + revert + def.beta * marketMove + def.vol * gaussian(holder) + (news?.fx[def.sym] ?? 0);
    const closed = clampToLimit(st.price * (1 + change), st.prevClose);
    const candle = { r: round, o: st.prevClose, h: Math.max(st.hi, closed), l: Math.min(st.lo, closed), c: closed };
    st.price = closed;
    st.prevClose = closed;
    st.hi = closed;
    st.lo = closed;
    st.history = [...st.history, candle].slice(-HISTORY_LEN);
  }
  if (news) market.news = [{ round, id: news.id }, ...market.news].slice(0, NEWS_KEEP);
  return news;
}

export function dividendFor(market, sym, shares) {
  return Math.floor((shares * Math.round(market.stocks[sym].price * 100) * Math.round(STOCK_BY_SYM[sym].div * 1000)) / 100000);
}

export function holdingsValue(market, holdings) {
  return Object.entries(holdings).reduce(
    (sum, [sym, h]) => sum + sellProceeds(market.stocks[sym].price, h.n),
    0,
  );
}
