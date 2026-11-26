import type { BotState, Batch, Pubkey } from '../vendor/makefun-bot.ts';

const PRICE_KEEP_SLOTS = 400;
export const SURGE_WINDOW_SLOTS = 80;

export interface Trade {
  slot: number;
  user: Pubkey;
  isBuy: boolean;
  sol: number;
}

export interface MintStats {
  creator: Pubkey | null;
  creatorSold: boolean;
  created: number;
  prices: [number, number][];
  trades: Trade[];
}

export class Book {
  readonly stats = new Map<Pubkey, MintStats>();
  readonly entrySlot = new Map<Pubkey, number>();
  readonly peak = new Map<Pubkey, number>();
  readonly entered = new Set<Pubkey>();
  readonly backup = new Set<Pubkey>();
  readonly roundTrips = new Set<Pubkey>();
  touched = new Set<Pubkey>();
  startSlot = -1;

  observe(batch: Batch): void {
    if (this.startSlot < 0) this.startSlot = batch.slot;
    this.touched = new Set<Pubkey>();
    for (const event of batch.events) {
      if (event.event === 'CreateEvent') {
        const stat = this.stat(event.mint, event.slot);
        stat.creator = event.creator;
        stat.created = event.slot;
        continue;
      }
      if (event.event !== 'TradeEvent') continue;
      const stat = this.stat(event.mint, event.slot);
      if (stat.creator === null) stat.creator = event.creator;
      if (!event.is_buy && event.user === stat.creator) stat.creatorSold = true;
      stat.prices.push([event.slot, Number(event.virtual_quote_reserves) / Number(event.virtual_token_reserves)]);
      stat.trades.push({ slot: event.slot, user: event.user, isBuy: event.is_buy, sol: Number(event.quote_amount) });
      while (stat.prices.length > 2 && stat.prices[1]![0] <= event.slot - PRICE_KEEP_SLOTS) stat.prices.shift();
      while (stat.trades.length > 0 && stat.trades[0]!.slot < event.slot - SURGE_WINDOW_SLOTS) stat.trades.shift();
      this.touched.add(event.mint);
    }
    for (const fill of batch.fills) {
      if (fill.side === 'buy' && fill.status === 'filled' && !this.entrySlot.has(fill.mint)) {
        this.entrySlot.set(fill.mint, fill.slot);
      }
    }
  }

  prune(state: BotState): void {
    for (const mint of this.entrySlot.keys()) {
      if (!state.positions.has(mint)) {
        this.entrySlot.delete(mint);
        this.peak.delete(mint);
      }
    }
  }

  priceAt(mint: Pubkey, slot: number): number | null {
    let found: number | null = null;
    for (const [priceSlot, price] of this.stats.get(mint)?.prices ?? []) {
      if (priceSlot > slot) break;
      found = price;
    }
    return found;
  }

  private stat(mint: Pubkey, slot: number): MintStats {
    let stat = this.stats.get(mint);
    if (stat === undefined) {
      stat = { creator: null, creatorSold: false, created: slot, prices: [], trades: [] };
      this.stats.set(mint, stat);
    }
    return stat;
  }
}

export function markPrice(state: BotState, mint: Pubkey): number | null {
  const curve = state.curves.get(mint);
  if (curve === undefined || curve.virtual_token_reserves === 0n) return null;
  return Number(curve.virtual_quote_reserves) / Number(curve.virtual_token_reserves);
}
