import { safeHelperDiagnostic, type HelperDiagnostic } from '@haus/core/helper-protocol';

/** Helper diagnostics are failure-only and intentionally contain no home or node identifiers. */
export function sanitizeHelperDiagnostic(value: unknown): HelperDiagnostic | undefined {
  const diagnostic = safeHelperDiagnostic(value);
  return diagnostic?.outcome === 'failure' ? diagnostic : undefined;
}
