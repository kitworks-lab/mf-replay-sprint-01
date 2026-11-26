import { runBot, type OrderInput } from './vendor/makefun-bot.ts';
import { Book } from './src/book-state.ts';
import { rankSignals } from './src/alpha-model.ts';
import { planEntries, planExits } from './src/execution-risk.ts';

const book = new Book();

await runBot({
  onBatch(state, batch) {
    book.observe(batch);
    book.prune(state);
    const exits: OrderInput[] = planExits(state, book);
    const entries = planEntries(state, rankSignals(state, book), book, exits.length);
    return [...exits, ...entries];
  },
});
