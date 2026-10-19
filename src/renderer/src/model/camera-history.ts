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
  error?: string;
  playbackInfo?: {
    largestGap?: number;
    sourceGaps?: { at: number; duration: number }[];
    audio?: boolean;
    sourceAudioMissing?: boolean;
  };
  bytes: number;
}
export const recordingStart = (event: CameraEvent) => event.mediaStartAt ?? event.startAt;
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
