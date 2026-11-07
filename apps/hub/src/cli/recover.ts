/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { recover } from '../recovery/export.js';
const controller = new AbortController();
const stop = () => controller.abort();
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
try {
  await recover(process.argv.slice(2), (value) => console.log(value), controller.signal);
} catch {
  console.error(
    'Haus recovery failed. Check the recovery kit, arguments and destination; existing files are never overwritten.',
  );
  process.exitCode = 1;
} finally {
  process.off('SIGTERM', stop);
  process.off('SIGINT', stop);
}
