/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { linuxDisks } from '../../src/index.js';
export const filesystem = async () => ({
  blocks: 1000,
  bsize: 1,
  bfree: 400,
  bavail: 350,
});
export const collect = (
  blockdevices: unknown[],
  options: NonNullable<Parameters<typeof linuxDisks>[0]> = {},
) =>
  linuxDisks({
    run: async () => JSON.stringify({ blockdevices }),
    filesystem,
    ...options,
  });
