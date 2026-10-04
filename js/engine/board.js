// Board data: 40 squares, Taiwan theme. Rent arrays are [base, 1 house, 2, 3, 4, hotel].
// Display names live in js/i18n (keys `sq.<id>` and `group.<key>`).

export const GROUPS = {
  brown: { color: '#8d5a3b', houseCost: 50 },
  lightblue: { color: '#7cc6ee', houseCost: 50 },
  pink: { color: '#e05a9c', houseCost: 100 },
  orange: { color: '#f08c2e', houseCost: 100 },
  red: { color: '#d93a32', houseCost: 150 },
  yellow: { color: '#f2c230', houseCost: 150 },
  green: { color: '#2f9e57', houseCost: 200 },
  darkblue: { color: '#2c4fa3', houseCost: 200 },
};

const prop = (id, group, price, rent) => ({ id, type: 'property', group, price, rent });

export const SQUARES = [
  { id: 0, type: 'go' },
  prop(1, 'brown', 60, [2, 10, 30, 90, 160, 250]),
  { id: 2, type: 'fate' },
  prop(3, 'brown', 60, [4, 20, 60, 180, 320, 450]),
  { id: 4, type: 'tax', amount: 200 },
  { id: 5, type: 'station', price: 200 },
  prop(6, 'lightblue', 100, [6, 30, 90, 270, 400, 550]),
  { id: 7, type: 'chance' },
  prop(8, 'lightblue', 100, [6, 30, 90, 270, 400, 550]),
  prop(9, 'lightblue', 120, [8, 40, 100, 300, 450, 600]),
  { id: 10, type: 'jail' },
  prop(11, 'pink', 140, [10, 50, 150, 450, 625, 750]),
  { id: 12, type: 'utility', price: 150 },
  prop(13, 'pink', 140, [10, 50, 150, 450, 625, 750]),
  prop(14, 'pink', 160, [12, 60, 180, 500, 700, 900]),
  { id: 15, type: 'station', price: 200 },
  prop(16, 'orange', 180, [14, 70, 200, 550, 750, 950]),
  { id: 17, type: 'fate' },
  prop(18, 'orange', 180, [14, 70, 200, 550, 750, 950]),
  prop(19, 'orange', 200, [16, 80, 220, 600, 800, 1000]),
  { id: 20, type: 'parking' },
  prop(21, 'red', 220, [18, 90, 250, 700, 875, 1050]),
  { id: 22, type: 'chance' },
  prop(23, 'red', 220, [18, 90, 250, 700, 875, 1050]),
  prop(24, 'red', 240, [20, 100, 300, 750, 925, 1100]),
  { id: 25, type: 'station', price: 200 },
  prop(26, 'yellow', 260, [22, 110, 330, 800, 975, 1150]),
  prop(27, 'yellow', 260, [22, 110, 330, 800, 975, 1150]),
  { id: 28, type: 'utility', price: 150 },
  prop(29, 'yellow', 280, [24, 120, 360, 850, 1025, 1200]),
  { id: 30, type: 'gotojail' },
  prop(31, 'green', 300, [26, 130, 390, 900, 1100, 1275]),
  prop(32, 'green', 300, [26, 130, 390, 900, 1100, 1275]),
  { id: 33, type: 'fate' },
  prop(34, 'green', 320, [28, 150, 450, 1000, 1200, 1400]),
  { id: 35, type: 'station', price: 200 },
  { id: 36, type: 'chance' },
  prop(37, 'darkblue', 350, [35, 175, 500, 1100, 1300, 1500]),
  { id: 38, type: 'tax', amount: 100 },
  prop(39, 'darkblue', 400, [50, 200, 600, 1400, 1700, 2000]),
];

export const BOARD_SIZE = SQUARES.length;
export const JAIL_POS = 10;
export const STATION_RENT = [25, 50, 100, 200];
export const UTILITY_MULT = [4, 10];

export const OWNABLE_TYPES = new Set(['property', 'station', 'utility']);
export const OWNABLE_IDS = SQUARES.filter((s) => OWNABLE_TYPES.has(s.type)).map((s) => s.id);

export function isOwnable(squareId) {
  const sq = SQUARES[squareId];
  return Boolean(sq) && OWNABLE_TYPES.has(sq.type);
}

export function groupMembers(group) {
  return SQUARES.filter((s) => s.group === group).map((s) => s.id);
}

export function mortgageValue(squareId) {
  return SQUARES[squareId].price / 2;
}

export function unmortgageCost(squareId) {
  return Math.ceil((mortgageValue(squareId) * 11) / 10);
}
