/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { createHubService } from './runtime/application.js';

let interrupted = false;
const service = createHubService({
  diagnostic: (code) => console.warn(`Haus runtime: ${code}`),
  ready: (_config, port) => console.log(`Haus Hub ready on port ${port}.`),
});
const shutdown = () => {
  interrupted = true;
  void service.stop().catch(() => {
    console.error('Haus shutdown incomplete.');
    process.exitCode = 1;
  });
};
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
try {
  await service.start();
} catch (error) {
  console.error('Haus startup failed:', error);
  process.exitCode = 1;
  await service.stop().catch(() => {
    process.exitCode = 1;
  });
}
