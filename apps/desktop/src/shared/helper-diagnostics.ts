/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { safeHelperDiagnostic, type HelperDiagnostic } from '@haus/core/helper-protocol';

/** Helper diagnostics are failure-only and intentionally contain no home or node identifiers. */
export function sanitizeHelperDiagnostic(value: unknown): HelperDiagnostic | undefined {
  const diagnostic = safeHelperDiagnostic(value);
  return diagnostic?.outcome === 'failure' ? diagnostic : undefined;
}
