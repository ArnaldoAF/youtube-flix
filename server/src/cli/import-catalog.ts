// npm run import-catalog [-- <file>] [-- --replace]
// Refuses while youtube-flix has the catalog open (checked through the database lock, on any port).
import path from 'node:path';
import { DB_PATH, PROJECT_ROOT } from '../config.js';
import { CatalogTransferError, importCatalog } from '../transfer.js';
import { describeCounts, fail, fromUserCwd } from './common.js';

const args = process.argv.slice(2);
const replace = args.includes('--replace');
const file = fromUserCwd(args.find((a) => !a.startsWith('--'))) ?? path.join(PROJECT_ROOT, 'youtube-flix-catalog.db');

try {
  const { counts, backup } = await importCatalog({ file, dbPath: DB_PATH, replace });
  console.log(`
Catalog imported: ${describeCounts(counts)}.${backup ? `\nYour previous catalog was saved as:\n  ${backup}` : ''}

Start youtube-flix as usual. Episodes play from YouTube until you download them again.`);
} catch (err) {
  if (err instanceof CatalogTransferError && err.message.includes('--replace')) {
    console.error(`\n${err.message}\n  npm run import-catalog -- "${file}" --replace\n`);
    process.exit(1);
  }
  fail(err);
}
