/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { createNestApp } from './nest.js';

async function bootstrap() {
  const port = Number(process.env.PORT || 8790);
  const app = await createNestApp();
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(
    `Haus Hub NestJS running on port ${port} (Swagger UI: /api/docs, Postman: /api/docs/postman.json)`,
  );
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Failed to bootstrap Haus Hub NestJS:', err);
  process.exit(1);
});
