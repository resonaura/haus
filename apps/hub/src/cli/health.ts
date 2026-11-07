/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { checkHealth } from '../runtime/health.js';

try {
  process.exitCode = (await checkHealth()) ? 0 : 1;
} catch {
  // Health checks expose status only, never deployment configuration or private diagnostics.
  process.exitCode = 1;
}
