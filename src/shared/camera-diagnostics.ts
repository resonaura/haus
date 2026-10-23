const events = [
  'open',
  'source',
  'rtc-state',
  'rtc-ready',
  'hls-ready',
  'fallback',
  'fallback-failed',
  'transport-error',
  'snapshot-failed',
  'watchdog',
  'restart',
  'close',
] as const;
export type CameraDiagnosticEvent = (typeof events)[number];
export type CameraDiagnostic = {
  camera: string;
  viewer: string;
  event: CameraDiagnosticEvent;
  elapsedMs?: number;
  videoTime?: number;
  width?: number;
  height?: number;
  readyState?: number;
  lastFrameAgeMs?: number;
  frames?: number;
  mediaErrorCode?: number;
  fragmentSequence?: number;
  continuityCounter?: number;
  fatal?: boolean;
  hlsType?: string;
  hlsDetail?: string;
  winner?: 'rtc' | 'hls' | 'none';
  source?: string;
  rtcState?: string;
  reason?: string;
};

/** Keep diagnostics useful without accepting URLs, SDP, credentials or arbitrary text. */
export function sanitizeCameraDiagnostic(value: unknown): CameraDiagnostic | undefined {
  if (!value || typeof value !== 'object') return;
  const input = value as Record<string, unknown>;
  if (
    typeof input.camera !== 'string' ||
    !/^camera\.[a-z0-9_]{1,120}$/.test(input.camera) ||
    typeof input.viewer !== 'string' ||
    !/^[a-z0-9-]{1,64}$/.test(input.viewer) ||
    !events.includes(input.event as CameraDiagnosticEvent)
  )
    return;
  const result: CameraDiagnostic = {
    camera: input.camera,
    viewer: input.viewer,
    event: input.event as CameraDiagnosticEvent,
  };
  for (const key of [
    'elapsedMs',
    'videoTime',
    'width',
    'height',
    'readyState',
    'lastFrameAgeMs',
    'frames',
    'mediaErrorCode',
    'fragmentSequence',
    'continuityCounter',
  ] as const) {
    const number = input[key];
    if (typeof number === 'number' && Number.isFinite(number) && number >= 0 && number <= 1e12)
      result[key] = Math.round(number * 1000) / 1000;
  }
  if (typeof input.fatal === 'boolean') result.fatal = input.fatal;
  if (['networkError', 'mediaError', 'muxError', 'otherError'].includes(String(input.hlsType)))
    result.hlsType = String(input.hlsType);
  if (
    ['reset', 'append', 'codec', 'fragment', 'manifest', 'other'].includes(String(input.hlsDetail))
  )
    result.hlsDetail = String(input.hlsDetail);
  if (['rtc', 'hls', 'none'].includes(String(input.winner)))
    result.winner = input.winner as CameraDiagnostic['winner'];
  if (
    ['idle', 'streaming', 'recording', 'off', 'unavailable', 'unknown'].includes(
      String(input.source),
    )
  )
    result.source = String(input.source);
  if (
    ['new', 'connecting', 'connected', 'disconnected', 'failed', 'closed'].includes(
      String(input.rtcState),
    )
  )
    result.rtcState = String(input.rtcState);
  if (
    [
      'startup',
      'repair',
      'restart',
      'rtc-disconnected',
      'rtc-failed',
      'rtc-signal',
      'rtc-negotiation',
      'hls-network',
      'hls-media',
      'hls-fatal',
      'hls-request',
      'hls-reset',
      'deadline',
      'snapshot-request',
    ].includes(String(input.reason))
  )
    result.reason = String(input.reason);
  return result;
}
