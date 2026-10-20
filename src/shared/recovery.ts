export type FailureKind =
  'render' | 'renderer' | 'unresponsive' | 'load' | 'gpu' | 'main' | 'startup';
export interface FailureReport {
  kind: FailureKind;
  name?: string;
  reference?: string;
}
export interface RecoveryInfo {
  restartRequired: boolean;
  diagnostic: string;
}

/** Never send stack traces, home addresses, media URLs or exception messages to diagnostics. */
export function failureReport(kind: FailureKind, error?: unknown): FailureReport {
  const name = error instanceof Error ? error.name : '';
  let hash = 2166136261;
  const source = error instanceof Error ? error.stack || error.message : String(error ?? kind);
  for (const character of source.slice(0, 16384)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return {
    kind,
    name: /^(?:Error|TypeError|RangeError|ReferenceError|SyntaxError|URIError|EvalError)$/.test(
      name,
    )
      ? name
      : 'Error',
    reference: (hash >>> 0).toString(16).padStart(8, '0'),
  };
}

export function validateFailure(value: unknown): FailureReport {
  if (!value || typeof value !== 'object') throw Error('Invalid failure report.');
  const report = value as FailureReport;
  if (
    !['render', 'renderer', 'unresponsive', 'load', 'gpu', 'main', 'startup'].includes(report.kind)
  )
    throw Error('Invalid failure report.');
  return {
    kind: report.kind,
    name: failureReport(report.kind, Object.assign(new Error(), { name: report.name })).name,
    reference: /^[a-f0-9]{8}$/.test(report.reference ?? '') ? report.reference : undefined,
  };
}
