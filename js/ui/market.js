// Market panel: quotes, candlestick chart of the selected stock, order box, news.
// Prices follow the Taiwan convention: rising in red, falling in green.

import { PRICE_LIMIT, STOCKS, buyCost, sellProceeds } from '../engine/stocks.js';
import { RULES } from '../engine/rules.js';
import { money, t } from '../i18n/i18n.js';
import { $, button, fill, h } from './dom.js';
import { lib } from './libs.js';

const UP = '#e8453c';
const DOWN = '#2fae5a';
const pct = (n) => `${n > 0 ? '+' : ''}${(n * 100).toFixed(2)}%`;
// Chart time must be positive and increasing: round r is plotted at r + 1.
const candle = (r, o, hi, lo, c) => ({ time: r + 1, open: o, high: hi, low: lo, close: c });

// Change of the latest close plus any card shock since, against the close before it.
function change(st) {
  const ref = st.history.at(-1).o;
  return ref ? (st.price - ref) / ref : 0;
}

export function createMarket({ session }) {
  const panel = $('#panel-market');
  const list = h('div', { class: 'stock-list', role: 'listbox', 'aria-label': t('ui.tabMarket') });
  const chartBox = h('div', { class: 'stock-chart' });
  const credit = h('p', { class: 'chart-credit' }, h('a', { href: 'https://www.tradingview.com/lightweight-charts/', target: '_blank', rel: 'noopener' }, 'TradingView Lightweight Charts™'));
  const box = h('div', { class: 'trade-box' });
  const news = h('ul', { class: 'news-list' });
  const shares = h('input', { type: 'number', min: 1, max: RULES.maxShareOrder, step: 1, value: 10 });
  const newsTitle = h('h3', {});
  fill(panel, list, chartBox, credit, box, newsTitle, news);

  let sel = STOCKS[0].sym;
  let last = null;
  let chart = null;
  let series = null;
  let chartSig = '';
  let chartTried = false;

  async function ensureChart() {
    if (chartTried) return;
    chartTried = true;
    const lw = await lib('charts');
    if (!lw) {
      chartBox.hidden = true;
      return;
    }
    chart = lw.createChart(chartBox, {
      autoSize: true,
      layout: { background: { type: 'solid', color: '#0e221d' }, textColor: '#cfe3dc', fontSize: 11 },
      grid: { vertLines: { color: 'rgba(255,255,255,0.05)' }, horzLines: { color: 'rgba(255,255,255,0.05)' } },
      timeScale: { tickMarkFormatter: (time) => `R${time - 1}`, fixLeftEdge: true, fixRightEdge: true },
      localization: { timeFormatter: (time) => t('ui.roundN', { n: time - 1 }), priceFormatter: (p) => p.toFixed(2) },
      rightPriceScale: { borderVisible: false },
      handleScroll: false,
      handleScale: false,
    });
    series = chart.addSeries(lw.CandlestickSeries, {
      upColor: UP, downColor: DOWN, borderUpColor: UP, borderDownColor: DOWN, wickUpColor: UP, wickDownColor: DOWN,
    });
    drawChart();
  }

  function drawChart() {
    if (!series || !last?.game) return;
    const st = last.game.market.stocks[sel];
    const sig = `${sel}|${st.history.length}|${st.history.at(-1).r}|${st.price}|${st.hi}|${st.lo}`;
    if (sig === chartSig) return;
    chartSig = sig;
    const data = st.history.map((c) => candle(c.r, c.o, c.h, c.l, c.c));
    // The round in progress, moved only by card shocks so far.
    data.push(candle(st.history.at(-1).r + 1, st.prevClose, st.hi, st.lo, st.price));
    series.setData(data);
    chart.timeScale().fitContent();
  }

  function row(game, me, def) {
    const st = game.market.stocks[def.sym];
    const chg = change(st);
    const lastC = st.history.at(-1);
    const limit = lastC.o && Math.abs(lastC.c / lastC.o - 1) >= PRICE_LIMIT - 0.0005;
    const held = me >= 0 ? game.players[me].stocks[def.sym]?.n ?? 0 : 0;
    const el = h('button', {
      type: 'button', class: `stock${def.sym === sel ? ' sel' : ''}`, role: 'option', 'aria-selected': String(def.sym === sel),
      onclick: () => { sel = def.sym; render(last); },
    },
    h('span', {}, h('span', { class: 'stock-name' }, t(`stock.${def.sym}`)), ' ', h('span', { class: 'stock-sym' }, `${def.sym} · ${t(`sector.${def.sym}`)}`)),
    h('span', { class: 'stock-price num' }, st.price.toFixed(2)),
    h('span', { class: 'stock-chg num', style: { color: chg > 0 ? UP : chg < 0 ? DOWN : 'inherit' } },
      limit ? (lastC.c > lastC.o ? t('ui.limitUp') : t('ui.limitDown')) : pct(chg)),
    held ? h('span', { class: 'stock-hold' }, t('ui.holdLine', { n: held, amt: sellProceeds(st.price, held) })) : null);
    return el;
  }

  function orderBox(game, me) {
    const def = STOCKS.find((s) => s.sym === sel);
    const st = game.market.stocks[sel];
    const pl = me >= 0 ? game.players[me] : null;
    const n = () => Math.floor(Number(shares.value) || 0);
    const held = pl?.stocks[sel]?.n ?? 0;
    const blocked = !pl ? t('err.notAPlayer') : pl.bankrupt ? t('err.bankrupt') : game.phase === 'gameOver' ? t('err.gameOver') : null;
    const buyReason = blocked ?? (game.debt?.p === me ? t('ui.debtNoBuy') : null);
    const sellReason = blocked ?? (held ? null : t('err.notEnoughShares'));
    const quote = h('p', { class: 'muted small' });
    const updateQuote = () => {
      const k = n();
      quote.textContent = k > 0 ? t('ui.orderQuote', { n: k, amt: buyCost(st.price, k), amt2: sellProceeds(st.price, k) }) : '';
    };
    shares.oninput = updateQuote;
    updateQuote();
    const send = (type) => {
      const k = n();
      if (k > 0) session.send({ t: 'act', a: { type, sym: sel, n: k } });
    };
    const maxBuy = pl ? Math.min(RULES.maxShareOrder, Math.floor(pl.cash / st.price)) : 0;
    const position = held
      ? t('ui.position', { n: held, amt: Math.round(pl.stocks[sel].cost), amt2: sellProceeds(st.price, held) })
      : t('ui.noPosition');
    return [
      h('strong', {}, t('ui.orderFor', { sym: def.sym })),
      h('span', { class: 'muted small' }, position),
      h('label', { class: 'form-row' }, h('span', {}, t('ui.shares')), shares),
      h('div', { class: 'dock-row' },
        button(t('ui.maxShares', { n: maxBuy }), { kind: 'btn-sm btn-ghost', onClick: () => { shares.value = String(Math.max(1, maxBuy)); updateQuote(); }, reason: buyReason }),
        held ? button(t('ui.allShares', { n: held }), { kind: 'btn-sm btn-ghost', onClick: () => { shares.value = String(held); updateQuote(); } }) : null),
      quote,
      h('div', { class: 'dock-row' },
        button(t('ui.buyShares'), { kind: 'btn-primary', iconName: 'arrow-up', onClick: () => send('BUY_STOCK'), reason: buyReason }),
        button(t('ui.sellShares'), { iconName: 'arrow-down', onClick: () => send('SELL_STOCK'), reason: sellReason })),
    ];
  }

  function render(state) {
    last = state;
    const { game, you } = state;
    if (!game) return;
    const me = game.players.findIndex((pl) => pl.id === you);
    const focusedSym = document.activeElement?.closest?.('.stock') ? sel : null;
    fill(list, STOCKS.map((def) => row(game, me, def)));
    if (focusedSym) list.querySelector('.stock.sel')?.focus({ preventScroll: true });
    const typing = document.activeElement === shares;
    if (!typing) fill(box, orderBox(game, me));
    newsTitle.textContent = t('ui.news');
    fill(news, game.market.news.length
      ? game.market.news.map((it) => h('li', {}, h('strong', {}, t('ui.roundN', { n: it.round })), ' ', t(`news.${it.id}`)))
      : h('li', { class: 'muted' }, t('ui.noNews')));
    ensureChart();
    drawChart();
  }

  return {
    render,
    // Pre-select a stock the viewer holds (used when raising cash for a debt).
    focusHolding(state) {
      const me = state.game?.players.findIndex((pl) => pl.id === state.you) ?? -1;
      const held = me >= 0 ? STOCKS.find((s) => state.game.players[me].stocks[s.sym]?.n) : null;
      if (held) sel = held.sym;
      render(state);
    },
    relabel: () => {
      list.setAttribute('aria-label', t('ui.tabMarket'));
      chartSig = '';
      if (chart) chart.applyOptions({ localization: { timeFormatter: (time) => t('ui.roundN', { n: time - 1 }), priceFormatter: (p) => p.toFixed(2) } });
      if (last) render(last);
    },
  };
}
