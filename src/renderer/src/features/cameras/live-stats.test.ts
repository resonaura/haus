import { expect, it } from 'vitest';
import { liveStats } from './live-stats';
it('keeps real inbound video/audio counters without persisting signaling or candidate details', () => {
  const rows = new Map([
    [
      'video',
      {
        type: 'inbound-rtp',
        kind: 'video',
        bytesReceived: 8000,
        packetsLost: 3,
        framesDecoded: 40,
        freezeCount: 1,
        totalFreezesDuration: 0.7,
        trackIdentifier: 'private',
      },
    ],
    [
      'audio',
      {
        type: 'inbound-rtp',
        kind: 'audio',
        bytesReceived: 1000,
        packetsLost: 0,
        jitterBufferEmittedCount: 16000,
      },
    ],
    [
      'candidate',
      { type: 'local-candidate', address: 'private', url: 'secret', bytesReceived: 9999 },
    ],
    ['outbound', { type: 'outbound-rtp', kind: 'audio', bytesReceived: 9999 }],
  ]);
  expect(liveStats(rows as unknown as RTCStatsReport)).toEqual({
    videoBytes: 8000,
    videoPacketsLost: 3,
    decodedVideoFrames: 40,
    freezeCount: 1,
    freezeSeconds: 0.7,
    audioBytes: 1000,
    audioPacketsLost: 0,
    audioSamples: 16000,
  });
});
it('leaves missing or invalid counters absent and sums valid simulcast tracks', () => {
  expect(
    liveStats(
      new Map([
        ['a', { type: 'inbound-rtp', mediaType: 'video', bytesReceived: 100, packetsLost: -1 }],
        ['b', { type: 'inbound-rtp', kind: 'video', bytesReceived: 200, framesDecoded: Infinity }],
        ['c', { type: 'inbound-rtp', kind: 'audio', bytesReceived: NaN }],
      ]) as unknown as RTCStatsReport,
    ),
  ).toEqual({ videoBytes: 300 });
});
