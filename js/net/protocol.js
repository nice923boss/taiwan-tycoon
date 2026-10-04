// Wire protocol between the host tab and the other tabs. Every message that
// crosses the network is checked here (Zod) before it touches room or game logic:
// the host checks client commands, clients check host states, and a new host
// checks the snapshots offered to it during a host migration.
//
// Messages are plain objects with a `t` tag. PeerJS sends them with its
// default `binary` serialization (json drops messages over ~16 KB).

import { z } from 'zod';
import { OWNABLE_IDS } from '../engine/board.js';
import { ACTION_TYPES, HOST_ONLY, STATE_VERSION } from '../engine/game.js';
import { RULES } from '../engine/rules.js';
import { STOCKS } from '../engine/stocks.js';

export const PROTOCOL_VERSION = 2;
export const CHARACTERS = ['bear', 'leopardcat', 'magpie', 'pangolin', 'macaque', 'deer'];
export const NAME_MAX = 16;
export const CHAT_MAX = 200;
export const CHAT_KEEP = 40;
export const MAX_CONNS = 24;

const SYMS = STOCKS.map((s) => s.sym);
const PHASES = ['preRoll', 'moving', 'buy', 'auction', 'postRoll', 'debt', 'trade', 'gameOver'];
const OWNABLE_KEYS = new Set(OWNABLE_IDS.map(String));

// Strip control characters and collapse whitespace; cut to `max` code points.
export function cleanText(text, max) {
  return [...String(text).replace(/\p{Cc}+/gu, ' ').replace(/\s+/g, ' ').trim()].slice(0, max).join('').trim();
}

const Int = z.number().int();
const Seat = Int.min(0).max(RULES.maxPlayers - 1);
const Id = z.string().regex(/^[0-9a-f]{16}$/);
const Name = z.string().max(64).transform((s) => cleanText(s, NAME_MAX)).pipe(z.string().min(1));
const Char = z.enum(CHARACTERS);
const Square = Int.min(0).max(39);
const Scalar = z.union([z.string().max(64), z.number(), z.boolean(), z.null()]);
const Params = z.record(z.string().max(16), Scalar);
const Msg = z.object({ key: z.string().max(48), params: Params.optional() });

// ---------- game state (public view from engine sanitize()) ----------

const TradeSide = z.object({
  cash: Int.min(0).max(1e9),
  props: z.array(Square).max(OWNABLE_IDS.length),
  cards: Int.min(0).max(2),
});

const Player = z.object({
  id: Id,
  name: z.string().min(1).max(64),
  char: Char,
  color: z.string().max(16),
  cash: Int.min(0),
  pos: Square,
  inJail: z.boolean(),
  jailTurns: Int.min(0).max(RULES.maxJailTurns),
  jailCards: z.array(z.enum(['chance', 'fate'])).max(2),
  stocks: z.partialRecord(z.enum(SYMS), z.object({ n: Int.min(1), cost: Int.min(0) })),
  bankrupt: z.boolean(),
});

const Candle = z.object({ r: Int.min(0), o: z.number(), h: z.number(), l: z.number(), c: z.number() });

const Market = z.object({
  stocks: z.record(z.enum(SYMS), z.object({
    price: z.number().positive(),
    prevClose: z.number().positive(),
    hi: z.number().positive(),
    lo: z.number().positive(),
    history: z.array(Candle).max(40),
  })),
  news: z.array(z.object({ round: Int.min(0), id: z.string().max(8) })).max(8),
});

const Event = z.object({ n: Int, kind: z.string().max(16) })
  .catchall(z.union([Scalar, z.array(Int).max(2)]));

export const GameSchema = z.object({
  v: z.literal(STATE_VERSION),
  phase: z.enum(PHASES),
  round: Int.min(1),
  maxRounds: z.union(RULES.roundOptions.map((n) => z.literal(n))),
  current: Seat,
  dice: z.tuple([Int.min(1).max(6), Int.min(1).max(6)]).nullable(),
  doublesCount: Int.min(0).max(3),
  extraRoll: z.boolean(),
  pendingBuy: Square.nullable(),
  auction: z.object({ sq: Square, bid: Int.min(0), bidder: Seat.nullable(), active: z.array(Seat).max(6) }).nullable(),
  trade: z.object({ from: Seat, to: Seat, give: TradeSide, get: TradeSide, back: z.enum(['preRoll', 'postRoll']) }).nullable(),
  debt: z.object({
    p: Seat,
    creditors: z.array(z.object({ p: Int.min(-1).max(5), amount: Int.min(0) })).min(1).max(6),
    amount: Int.min(1),
    why: Msg,
    then: z.object({ kind: z.literal('jailMove'), p: Seat, steps: Int.min(2).max(12) }).nullable(),
  }).nullable(),
  props: z.record(z.string(), z.object({ owner: Seat.nullable(), houses: Int.min(0).max(5), mortgaged: z.boolean() })),
  market: Market,
  log: z.array(z.object({ n: Int, key: z.string().max(48), params: Params })).max(60),
  logSeq: Int.min(0),
  events: z.array(Event).max(24),
  eventSeq: Int.min(0),
  deadline: z.number().nullable(),
  startedAt: z.number(),
  turnStartedAt: z.number(),
  endedAt: z.number().nullable(),
  bankruptOrder: z.array(Seat).max(6),
  worthLog: z.array(z.object({ r: Int.min(1), w: z.array(Int).max(6) })).max(40),
  ranking: z.array(z.object({ p: Seat, worth: Int })).max(6).nullable(),
  winner: Seat.nullable(),
  players: z.array(Player).min(RULES.minPlayers).max(RULES.maxPlayers),
}).superRefine((g, ctx) => {
  const n = g.players.length;
  const bad = (message) => ctx.addIssue({ code: 'custom', message });
  const keys = Object.keys(g.props);
  if (keys.length !== OWNABLE_KEYS.size || !keys.every((k) => OWNABLE_KEYS.has(k))) bad('props keys');
  if (Object.values(g.props).some((st) => st.owner !== null && st.owner >= n)) bad('prop owner');
  if (g.current >= n) bad('current');
  if (g.debt && g.debt.p >= n) bad('debt seat');
  if (g.auction?.active.some((p) => p >= n)) bad('auction seat');
  if (g.trade && (g.trade.from >= n || g.trade.to >= n)) bad('trade seat');
  if (new Set(g.players.map((pl) => pl.id)).size !== n) bad('duplicate player id');
});

// ---------- room ----------

export const RoomSchema = z.object({
  epoch: Int.min(0),
  rev: Int.min(0),
  stage: z.enum(['lobby', 'game']),
  // bot: the computer plays this away player; vacant: a spectator may take the seat over.
  seats: z.array(z.object({
    id: Id, name: z.string().min(1).max(64), char: Char, online: z.boolean(), bot: z.boolean().default(false), vacant: z.boolean().default(false),
  })).max(RULES.maxPlayers),
  spectators: z.array(z.object({ id: Id, name: z.string().min(1).max(64) })).max(MAX_CONNS),
  leader: Id.nullable(),
  host: Id.nullable(),
  rounds: z.union(RULES.roundOptions.map((n) => z.literal(n))),
});

// Chat is not part of the state broadcast (it would resend the whole backlog on
// every dice roll); the host sends the backlog once on join, then each new line.
export const ChatLineSchema = z.object({ n: Int.min(1), id: Id, name: z.string().min(1).max(64), text: z.string().min(1).max(CHAT_MAX * 2), ts: z.number() });
const ChatLines = z.array(ChatLineSchema).max(CHAT_KEEP);

// Saved in sessionStorage and offered to a new host during a migration.
export const SnapshotSchema = z.object({ room: RoomSchema, game: GameSchema.nullable(), chat: ChatLines.default([]) })
  .refine((s) => (s.room.stage === 'game') === (s.game !== null), 'stage/game mismatch');

// ---------- client -> host ----------

const Action = z.object({
  type: z.enum(ACTION_TYPES.filter((type) => !HOST_ONLY.includes(type))),
  sq: Square.optional(),
  amount: Int.min(0).max(1e9).optional(),
  sym: z.enum(SYMS).optional(),
  n: Int.min(1).max(RULES.maxShareOrder).optional(),
  to: Seat.optional(),
  give: TradeSide.optional(),
  get: TradeSide.optional(),
});

export const ClientMsgSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('hello'), v: Int, secret: z.string().regex(/^[0-9a-f]{32}$/), name: Name, snap: SnapshotSchema.nullable().optional() }),
  z.object({ t: z.literal('sit'), char: Char }),
  z.object({ t: z.literal('stand') }),
  z.object({ t: z.literal('rounds'), n: z.union(RULES.roundOptions.map((n) => z.literal(n))) }),
  z.object({ t: z.literal('start') }),
  z.object({ t: z.literal('again') }),
  z.object({ t: z.literal('act'), a: Action }),
  z.object({ t: z.literal('chat'), text: z.string().max(CHAT_MAX * 4).transform((s) => cleanText(s, CHAT_MAX)).pipe(z.string().min(1)) }),
  z.object({ t: z.literal('name'), name: Name }),
  z.object({ t: z.literal('claim'), char: Char }),
  z.object({ t: z.literal('beat') }),
]);

// ---------- host -> client ----------

export const HostMsgSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('welcome'), id: Id }),
  z.object({ t: z.literal('state'), now: z.number(), room: RoomSchema, game: GameSchema.nullable() }),
  z.object({ t: z.literal('chat'), lines: ChatLines, reset: z.boolean() }),
  z.object({ t: z.literal('err'), key: z.string().max(48), params: Params }),
  z.object({ t: z.literal('bye'), key: z.string().max(48) }),
  z.object({ t: z.literal('beat'), now: z.number() }),
]);

// Parse helpers return the cleaned message, or null when it does not match.
export function parseClientMsg(raw) {
  const res = ClientMsgSchema.safeParse(raw);
  return res.success ? res.data : null;
}

export function parseHostMsg(raw) {
  const res = HostMsgSchema.safeParse(raw);
  return res.success ? res.data : null;
}

export function parseSnapshot(raw) {
  const res = SnapshotSchema.safeParse(raw);
  return res.success ? res.data : null;
}
