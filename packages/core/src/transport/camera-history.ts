/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

export interface CameraEvent {
  readonly id: string;
  readonly cameraId: string;
  readonly startAt: number;
  /** First frame in the file, before the triggering detection when pre-roll is available. */
  readonly mediaStartAt?: number;
  readonly endAt: number;
  status: string;
  kinds: string[];
  duration: number;
  originalDuration?: number;
  error?: string;
  playbackInfo?: {
    largestGap?: number;
    sourceGaps?: { at: number; duration: number }[];
    audio?: boolean;
    sourceAudioMissing?: boolean;
    originalCompatible?: boolean;
    originalPolicyVersion?: number;
    duration?: number;
    audioTailSeconds?: number;
    audioTrimSeconds?: number;
  };
  bytes: number;
}

export interface CameraAvailability {
  readonly cameraId: string;
  readonly startAt: number;
  readonly endAt: number;
  readonly state: 'online' | 'offline' | 'unknown';
}

export interface CameraActivityStatus {
  readonly state: string;
  readonly fresh?: boolean;
  readonly processor?: string;
  readonly placement?: 'nvr' | 'home';
  readonly fallbackReason?: 'no_nodes' | 'no_analysis_nodes' | 'nodes_unavailable' | 'nodes_busy';
  readonly blocked?: 'capacity' | 'unsupported';
}

export interface CameraOperatingControl {
  readonly id: string;
  readonly available: boolean;
  readonly value: boolean;
}

export interface CameraHomeKitStatus {
  readonly enabled: boolean;
  readonly processor: string;
  readonly state: 'off' | 'waiting' | 'pairing' | 'paired' | 'unavailable';
  readonly recording: boolean;
  readonly prebufferReady: boolean;
  readonly processorName?: string;
  readonly talkback: boolean;
  readonly paired?: boolean;
  readonly pairingManagement?: boolean;
  readonly message?: string;
}

export interface CameraDeviceConfig {
  id: string;
  enabled: boolean;
  aliases?: string[];
  talkAvailable?: boolean;
  motionDetection?: { enabled: boolean; mode: 'objects' | 'motion' };
  motionStatus?: CameraActivityStatus;
  activity?: {
    available: boolean;
    active: boolean;
    source: string;
    assistState?: string;
    replaces?: string[];
  };
  operating?: Partial<Record<'indicator' | 'nightVision', CameraOperatingControl>>;
  homekit?: CameraHomeKitStatus;
}

/** Keep in sync with Haus Hub's conservative original-media compatibility policy. */
export const ORIGINAL_PLAYBACK_POLICY_VERSION = 1;

export function canPlayOriginalImmediately(event: CameraEvent): boolean {
  return (
    event.playbackInfo?.originalCompatible === true &&
    event.playbackInfo.originalPolicyVersion === ORIGINAL_PLAYBACK_POLICY_VERSION
  );
}

export function recordingStart(event: CameraEvent): number {
  return event.mediaStartAt ?? event.startAt;
}

/** Prepared media may be shorter than the archive metadata used for the gesture. */
export function recordingSeek(seconds: number, duration: number): number {
  const lastFrame =
    Number.isFinite(duration) && duration > 0 ? Math.max(0, duration - 0.05) : Infinity;
  return Math.min(lastFrame, Math.max(0, Number.isFinite(seconds) ? seconds : 0));
}

export function chronologicalRecordings(events: readonly CameraEvent[]): CameraEvent[] {
  return [...events].sort((a, b) => a.startAt - b.startAt || a.id.localeCompare(b.id));
}

/** Skip pending/failed clips and never loop back to footage already played. */
export function nextRecording(
  events: readonly CameraEvent[],
  currentId: string,
): CameraEvent | undefined {
  const ordered = chronologicalRecordings(events);
  const current = ordered.findIndex((event) => event.id === currentId);
  return current < 0
    ? undefined
    : ordered.slice(current + 1).find((event) => event.status === 'ready');
}

export function recordingDay(at: number | Date): string {
  const date = new Date(at);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function recordingDayRange(day: string): { readonly from: number; readonly to: number } {
  const date = new Date(`${day}T00:00:00`);
  const from = date.getTime();
  date.setDate(date.getDate() + 1);
  return { from, to: date.getTime() };
}

/** Local midnights, preserving 23/25-hour days at daylight-saving transitions. */
export function recordingMonthBoundaries(month: string): number[] {
  const date = new Date(`${month}-01T00:00:00`);
  const current = date.getMonth();
  const boundaries = [date.getTime()];
  do {
    date.setDate(date.getDate() + 1);
    boundaries.push(date.getTime());
  } while (date.getMonth() === current);
  return boundaries;
}

const EVENT_KIND_LABELS: Readonly<Record<string, string>> = {
  motion: 'Motion',
  person: 'Person',
  pet: 'Pet',
  vehicle: 'Vehicle',
  doorbell: 'Doorbell',
  manual: 'Manual recording',
};

export function formatEventKindLabel(kind: string): string {
  return EVENT_KIND_LABELS[kind] ?? kind;
}

export function demoCameraEvents(cameraId: string, now = Date.now()): CameraEvent[] {
  const { from } = recordingDayRange(recordingDay(now));
  const specs: readonly { offsetMs: number; duration: number; kinds: string[]; bytes: number }[] = [
    { offsetMs: 12 * 60_000, duration: 24, kinds: ['person'], bytes: 3_400_000 },
    { offsetMs: 68 * 60_000, duration: 15, kinds: ['motion'], bytes: 2_100_000 },
    { offsetMs: 145 * 60_000, duration: 32, kinds: ['vehicle'], bytes: 4_800_000 },
    { offsetMs: 210 * 60_000, duration: 18, kinds: ['doorbell', 'person'], bytes: 2_750_000 },
  ];
  return specs.map((spec, index) => {
    const startAt = Math.max(from + (specs.length - index) * 60_000, now - spec.offsetMs);
    return {
      id: `demo-${cameraId}-${index}`,
      cameraId,
      startAt,
      mediaStartAt: startAt - 3_000,
      endAt: startAt + spec.duration * 1000,
      status: 'ready',
      kinds: [...spec.kinds],
      duration: spec.duration,
      bytes: spec.bytes,
    };
  });
}
