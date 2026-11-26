import type { BotState, Pubkey } from '../vendor/makefun-bot.ts';
import { SURGE_WINDOW_SLOTS, type Book } from './book-state.ts';

const SOL = 1_000_000_000;
const SURGE_MIN_RESERVE = 22 * SOL;
const SURGE_MAX_RESERVE = 85 * SOL;
const MIN_AGE_SLOTS = 80;
const MIN_SURGE = 0.65;
const MIN_BUYERS = 3;
const MIN_NET_INFLOW = 1 * SOL;
const BACKUP_MIN_RESERVE = 8 * SOL;
const BACKUP_MAX_RESERVE = 25 * SOL;
const BACKUP_MIN_BUYERS = 2;
const BACKUP_PACE = 36;
const BACKUP_AFTER_SHARE = 0.35;
const WINDOW_SLOTS = 403_213;

export type SignalMode = 'surge' | 'backup';

export interface Signal {
  mint: Pubkey;
  mode: SignalMode;
}

export function rankSignals(state: BotState, book: Book): Signal[] {
  const elapsed = state.slot - book.startSlot;
  const behind =
    elapsed > WINDOW_SLOTS * BACKUP_AFTER_SHARE && book.roundTrips.size < BACKUP_PACE * (elapsed / WINDOW_SLOTS);
  const signals: Signal[] = [];
  for (const mint of [...book.touched].sort()) {
    const stat = book.stats.get(mint);
    const curve = state.curves.get(mint);
    if (stat === undefined || curve === undefined || curve.complete) continue;
    if (state.positions.has(mint) || book.entered.has(mint) || stat.creatorSold || stat.creator === null) continue;
    if (state.slot - stat.created < MIN_AGE_SLOTS) continue;
    const reserve = Number(curve.real_quote_reserves);
    const now = stat.prices[stat.prices.length - 1]![1];
    const ago = book.priceAt(mint, state.slot - SURGE_WINDOW_SLOTS);
    const buyers = new Set<Pubkey>();
    let net = 0;
    for (const trade of stat.trades) {
      if (trade.isBuy) buyers.add(trade.user);
      net += trade.isBuy ? trade.sol : -trade.sol;
    }
    if (
      reserve >= SURGE_MIN_RESERVE &&
      reserve < SURGE_MAX_RESERVE &&
      ago !== null &&
      now / ago - 1 >= MIN_SURGE &&
      buyers.size >= MIN_BUYERS &&
      net >= MIN_NET_INFLOW
    ) {
      signals.push({ mint, mode: 'surge' });
    } else if (
      behind &&
      reserve >= BACKUP_MIN_RESERVE &&
      reserve <= BACKUP_MAX_RESERVE &&
      buyers.size >= BACKUP_MIN_BUYERS &&
      net > 0
    ) {
      signals.push({ mint, mode: 'backup' });
    }
  }
  return signals;
}
