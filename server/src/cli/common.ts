import path from 'node:path';
import { CatalogTransferError, type CatalogCounts } from '../transfer.js';

/** npm runs workspace scripts from server/, so relative paths resolve against the folder the command was typed in. */
export function fromUserCwd(arg: string | undefined): string | undefined {
  return arg ? path.resolve(process.env.INIT_CWD ?? process.cwd(), arg) : undefined;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export const describeCounts = ({ titles, episodes, withProgress }: CatalogCounts) =>
  `${plural(titles, 'title')}, ${plural(episodes, 'episode')}, watch progress for ${plural(withProgress, 'episode')}`;

export function fail(err: unknown): never {
  if (err instanceof CatalogTransferError) {
    console.error(`\n${err.message}\n`);
  } else {
    console.error('\nSomething went wrong:', err, '\n');
  }
  process.exit(1);
}
