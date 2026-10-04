// End-of-game results: ranking table, net-worth chart per round, a PNG export of
// the results card, and "play again" for the room leader.

import { SQUARES } from '../engine/board.js';
import { holdingsValue } from '../engine/stocks.js';
import { money, t } from '../i18n/i18n.js';
import { button, h, icon, openDialog, toast } from './dom.js';
import { lib } from './libs.js';

export function createResults({ session }) {
  let dlg = null;
  let last = null;

  function rankTable(g) {
    const cols = [t('ui.colRank'), t('ui.colPlayer'), t('ui.colWorth'), t('ui.colCash'), t('ui.properties'), t('ui.stocks')];
    const head = h('tr', {}, cols.map((label) => h('th', {}, label)));
    const rows = g.ranking.map(({ p, worth }, k) => {
      const pl = g.players[p];
      const props = SQUARES.filter((sq) => g.props[sq.id]?.owner === p).length;
      return h('tr', { class: k === 0 ? 'win' : null },
        h('td', {}, k === 0 ? icon('crown') : null, ` ${k + 1}`),
        h('td', {}, h('span', { style: { color: pl.color } }, '● '), pl.name),
        h('td', { class: 'num' }, pl.bankrupt ? t('ui.bankrupt') : money(worth)),
        h('td', { class: 'num' }, money(pl.cash)),
        h('td', { class: 'num' }, String(props)),
        h('td', { class: 'num' }, money(Math.round(holdingsValue(g.market, pl.stocks)))));
    });
    return h('table', { class: 'rank-table' }, h('thead', {}, head), h('tbody', {}, rows));
  }

  async function drawChart(box, g) {
    const lw = await lib('charts');
    if (!lw || !box.isConnected || g.worthLog.length === 0) {
      box.hidden = true;
      return;
    }
    const chart = lw.createChart(box, {
      autoSize: true,
      layout: { background: { type: 'solid', color: '#0e221d' }, textColor: '#cfe3dc', fontSize: 11 },
      grid: { vertLines: { color: 'rgba(255,255,255,0.05)' }, horzLines: { color: 'rgba(255,255,255,0.05)' } },
      timeScale: { tickMarkFormatter: (time) => `R${time}`, fixLeftEdge: true, fixRightEdge: true },
      localization: { timeFormatter: (time) => t('ui.roundN', { n: time }), priceFormatter: (v) => money(Math.round(v)) },
      handleScroll: false,
      handleScale: false,
    });
    g.players.forEach((pl, p) => {
      const series = chart.addSeries(lw.LineSeries, { color: pl.color, lineWidth: 2, title: pl.name });
      series.setData(g.worthLog.map((row) => ({ time: row.r, value: row.w[p] })));
    });
    chart.timeScale().fitContent();
  }

  async function savePng(card) {
    const toPng = await lib('toPng');
    if (!toPng) return;
    try {
      const url = await toPng(card, { backgroundColor: '#102b25', pixelRatio: 2 });
      const link = h('a', { href: url, download: 'monopoly-results.png', hidden: true });
      document.body.append(link);
      link.click();
      link.remove();
    } catch {
      toast(t('ui.imageFailed'), 'warn');
    }
  }

  function build(state) {
    const g = state.game;
    const { room, you } = state;
    const leaderName = room.seats.find((s) => s.id === room.leader)?.name ?? '?';
    const chartBox = h('div', { class: 'worth-chart' });
    const card = h('div', { class: 'results' },
      h('p', {}, icon('trophy'), ' ', t('ui.winnerIs', { name: g.players[g.winner].name })),
      rankTable(g),
      h('h3', {}, t('ui.worthByRound')),
      chartBox);
    dlg.setBody(card);
    dlg.setActions(
      button(t('ui.saveImage'), { iconName: 'share-2', onClick: () => savePng(card) }),
      button(t('ui.playAgain'), {
        kind: 'btn-primary',
        iconName: 'rotate-ccw',
        onClick: () => session.send({ t: 'again' }),
        reason: room.leader === you ? null : t('ui.onlyLeader', { name: leaderName }),
      }),
      button(t('ui.close'), { onClick: () => dlg.close() }));
    drawChart(chartBox, g);
  }

  function open(state = last) {
    if (!state?.game?.ranking) return;
    last = state;
    dlg?.close();
    const d = openDialog({ title: t('ui.resultsTitle'), body: [], wide: true, onClose: () => { if (dlg === d) dlg = null; } });
    dlg = d;
    build(state);
  }

  return {
    open,
    // Back in the lobby (leader pressed "play again"): the results no longer apply.
    render(state) {
      last = state;
      if (dlg && state.game?.phase !== 'gameOver') dlg.close();
    },
    relabel() {
      if (dlg && last?.game?.ranking) {
        dlg.setTitle(t('ui.resultsTitle'));
        build(last);
      }
    },
  };
}
