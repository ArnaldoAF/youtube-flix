// npm run export-catalog [-- <file>]
// Safe to run while youtube-flix is open: it copies a consistent snapshot.
import path from 'node:path';
import { DB_PATH, PROJECT_ROOT } from '../config.js';
import { exportCatalog } from '../transfer.js';
import { describeCounts, fail, fromUserCwd } from './common.js';

const dest = fromUserCwd(process.argv[2]) ?? path.join(PROJECT_ROOT, 'youtube-flix-catalog.db');

try {
  const counts = await exportCatalog(DB_PATH, dest);
  console.log(`
Catalog exported: ${describeCounts(counts)}.
  ${dest}

Copy this file to the other computer, then run there:
  npm run import-catalog -- <path to the file>

Downloaded videos, the household password and this PC's folders are not included.`);
} catch (err) {
  fail(err);
}
