export interface CameraEvent {
  id: string;
  cameraId: string;
  startAt: number;
  /** First frame in the file, before the triggering detection when pre-roll is available. */
  mediaStartAt?: number;
  endAt: number;
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
/** Keep in sync with Haus Helper's conservative original-media compatibility policy. */
export const ORIGINAL_PLAYBACK_POLICY_VERSION = 1;
export function canPlayOriginalImmediately(event: CameraEvent) {
  return (
    event.playbackInfo?.originalCompatible === true &&
    event.playbackInfo.originalPolicyVersion === ORIGINAL_PLAYBACK_POLICY_VERSION
  );
}
export const recordingStart = (event: CameraEvent) => event.mediaStartAt ?? event.startAt;
/** Prepared media may be shorter than the archive metadata used for the gesture. */
export function recordingSeek(seconds: number, duration: number) {
  const lastFrame =
    Number.isFinite(duration) && duration > 0 ? Math.max(0, duration - 0.05) : Infinity;
  return Math.min(lastFrame, Math.max(0, Number.isFinite(seconds) ? seconds : 0));
}
export interface CameraAvailability {
  cameraId: string;
  startAt: number;
  endAt: number;
  state: 'online' | 'offline' | 'unknown';
}
export function chronologicalRecordings(events: CameraEvent[]) {
  return [...events].sort((a, b) => a.startAt - b.startAt || a.id.localeCompare(b.id));
}
/** Skip pending/failed clips and never loop back to footage already played. */
export function nextRecording(events: CameraEvent[], currentId: string) {
  const ordered = chronologicalRecordings(events);
  const current = ordered.findIndex((event) => event.id === currentId);
  return current < 0
    ? undefined
    : ordered.slice(current + 1).find((event) => event.status === 'ready');
}
