import { BPS, type BotState, type BuyInput, type Pubkey, type SellInput } from '../vendor/makefun-bot.ts';
import type { Book } from './book-state.ts';
import { markPrice } from './book-state.ts';
import type { Signal } from './alpha-model.ts';

const SAFETY_BPS = 9000n;
const SURGE_STAKE_LAMPORTS = 250_000_000n;
const BACKUP_STAKE_LAMPORTS = 12_000_000n;
const MIN_BUY_LAMPORTS = 12_000_000n;
const ENTRY_SLIPPAGE_BPS = 2000;
const EXIT_SLIPPAGE_BPS = 10_000;
const MAX_ORDERS_PER_BATCH = 4;
const MAX_HOLD_SLOTS = 6000;
const BACKUP_HOLD_SLOTS = 40;
const STOP_LOSS_RATIO = 0.85;
const BACKUP_STOP_RATIO = 0.9;
const TRAIL_ARM_RATIO = 1.35;
const TRAIL_KEEP = 0.72;

export function planExits(state: BotState, book: Book): SellInput[] {
  const selling = new Set<Pubkey>();
  for (const pending of state.pending.values()) {
    if (pending.order.side === 'sell') selling.add(pending.order.mint);
  }
  const orders: SellInput[] = [];
  for (const [mint, holding] of state.positions) {
    const curve = state.curves.get(mint);
    if (selling.has(mint) || curve === undefined || curve.complete) continue;
    if (holding.token_amount === 0n || holding.cost_lamports === 0n) continue;
    const price = markPrice(state, mint);
    if (price === null) continue;
    const ratio = (Number(holding.token_amount) * price) / Number(holding.cost_lamports);
    const peak = Math.max(book.peak.get(mint) ?? 0, ratio);
    book.peak.set(mint, peak);
    const held = state.slot - (book.entrySlot.get(mint) ?? state.slot);
    const creatorSold = book.stats.get(mint)?.creatorSold === true;
    let exit: boolean;
    if (book.backup.has(mint)) {
      exit = held >= BACKUP_HOLD_SLOTS || creatorSold || ratio <= BACKUP_STOP_RATIO;
    } else {
      const trailHit = peak >= TRAIL_ARM_RATIO && ratio <= peak * TRAIL_KEEP;
      exit = ratio <= STOP_LOSS_RATIO || trailHit || held >= MAX_HOLD_SLOTS || creatorSold;
    }
    if (exit) {
      orders.push({ side: 'sell', mint, token_amount: holding.token_amount, max_slippage_bps: EXIT_SLIPPAGE_BPS });
    }
  }
  return orders;
}

export function planEntries(state: BotState, signals: Signal[], book: Book, queued: number): BuyInput[] {
  const busy = new Set<Pubkey>();
  for (const pending of state.pending.values()) busy.add(pending.order.mint);
  const orders: BuyInput[] = [];
  let slots = state.hello.caps.max_open_positions - state.committedPositionCount();
  let free = state.freeCashLamports();
  const tx = state.txFeeLamports();
  for (const signal of signals) {
    if (slots <= 0 || queued + orders.length >= MAX_ORDERS_PER_BATCH) break;
    if (busy.has(signal.mint)) continue;
    const cap = (state.maxBuyLamports(signal.mint) * SAFETY_BPS) / BPS;
    const stake = signal.mode === 'surge' ? SURGE_STAKE_LAMPORTS : BACKUP_STAKE_LAMPORTS;
    const quote = cap < stake ? cap : stake;
    if (quote < MIN_BUY_LAMPORTS || free < quote + tx) continue;
    orders.push({ side: 'buy', mint: signal.mint, quote_lamports: quote, max_slippage_bps: ENTRY_SLIPPAGE_BPS });
    book.entered.add(signal.mint);
    book.roundTrips.add(signal.mint);
    if (signal.mode === 'backup') book.backup.add(signal.mint);
    free -= quote + tx;
    slots--;
  }
  return orders;
}
