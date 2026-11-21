/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { createHubService } from './runtime/application.js';
import { createHubLogger } from './runtime/logger.js';

const log = createHubLogger('Hub');
const service = createHubService({
  diagnostic: (code) => log.warn(`Runtime diagnostic: ${code}`),
  ready: (config, port) => log.info(`Listening on http://${config.address}:${port} (Fastify)`),
});
const shutdown = () => {
  log.info('Shutting down…');
  void service.stop().catch((error) => {
    log.error('Shutdown incomplete', error);
    process.exitCode = 1;
  });
};
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
try {
  await service.start();
} catch (error) {
  log.error('Startup failed', error);
  process.exitCode = 1;
  await service.stop().catch(() => {
    process.exitCode = 1;
  });
}
