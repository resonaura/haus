import type { CameraDiagnostic } from '../../../../shared/camera-diagnostics';

/** Extract counters only; never log candidates, track identifiers, SDP or addresses. */
export function liveStats(report: Pick<RTCStatsReport, 'forEach'>): Partial<CameraDiagnostic> {
  const result: Partial<CameraDiagnostic> = {};
  const add = (key: keyof CameraDiagnostic, value: unknown) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return;
    Object.assign(result, { [key]: Number(result[key] ?? 0) + value });
  };
  report.forEach((row) => {
    if (row.type !== 'inbound-rtp') return;
    if (row.kind === 'video' || row.mediaType === 'video') {
      add('videoBytes', row.bytesReceived);
      add('videoPacketsLost', row.packetsLost);
      add('decodedVideoFrames', row.framesDecoded);
      add('freezeCount', row.freezeCount);
      add('freezeSeconds', row.totalFreezesDuration);
    } else if (row.kind === 'audio' || row.mediaType === 'audio') {
      add('audioBytes', row.bytesReceived);
      add('audioPacketsLost', row.packetsLost);
      add('audioSamples', row.jitterBufferEmittedCount);
    }
  });
  return result;
}
