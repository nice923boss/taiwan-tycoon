// Chance and Fate decks. Card ids are stable strings so decks can be rebuilt
// after a host migration. Card text lives in js/i18n (key `card.<id>`).

export const DECKS = {
  chance: [
    { id: 'c01', kind: 'move_to', to: 0 },
    { id: 'c02', kind: 'move_to', to: 21 },
    { id: 'c03', kind: 'move_to', to: 39 },
    { id: 'c04', kind: 'nearest', target: 'station' },
    { id: 'c05', kind: 'nearest', target: 'station' },
    { id: 'c06', kind: 'nearest', target: 'utility' },
    { id: 'c07', kind: 'collect', amount: 50 },
    { id: 'c08', kind: 'jail_free' },
    { id: 'c09', kind: 'move_rel', steps: -3 },
    { id: 'c10', kind: 'go_jail' },
    { id: 'c11', kind: 'repairs', house: 25, hotel: 100 },
    { id: 'c12', kind: 'pay', amount: 15 },
    { id: 'c13', kind: 'move_to', to: 35 },
    { id: 'c14', kind: 'pay_each', amount: 50 },
    { id: 'c15', kind: 'collect', amount: 150 },
    { id: 'c16', kind: 'stock_shock', sym: 'CHIP', pct: 0.1 },
    { id: 'c17', kind: 'stock_gift', sym: 'BEAR', shares: 20 },
  ],
  fate: [
    { id: 'f01', kind: 'move_to', to: 0 },
    { id: 'f02', kind: 'collect', amount: 200 },
    { id: 'f03', kind: 'pay', amount: 50 },
    { id: 'f04', kind: 'collect', amount: 50 },
    { id: 'f05', kind: 'jail_free' },
    { id: 'f06', kind: 'go_jail' },
    { id: 'f07', kind: 'collect_each', amount: 10 },
    { id: 'f08', kind: 'collect', amount: 20 },
    { id: 'f09', kind: 'collect', amount: 100 },
    { id: 'f10', kind: 'pay', amount: 100 },
    { id: 'f11', kind: 'pay', amount: 50 },
    { id: 'f12', kind: 'collect', amount: 25 },
    { id: 'f13', kind: 'repairs', house: 40, hotel: 115 },
    { id: 'f14', kind: 'collect', amount: 10 },
    { id: 'f15', kind: 'collect', amount: 100 },
    { id: 'f16', kind: 'stock_shock', sym: 'TOUR', pct: -0.1 },
    { id: 'f17', kind: 'stock_shock', sym: 'BOBA', pct: 0.08 },
    { id: 'f18', kind: 'market_shock', pct: -0.08 },
  ],
};

export const CARD_BY_ID = Object.fromEntries(
  Object.entries(DECKS).flatMap(([deck, cards]) => cards.map((c) => [c.id, { ...c, deck }])),
);
