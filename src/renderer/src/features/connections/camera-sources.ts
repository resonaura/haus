import type { Snapshot } from '../../model';
import type { FlowStep } from '../../ha/management';
export type CameraSourceKind = 'stream' | 'snapshot' | 'talk';
const protocols = {
  stream: ['rtsp:', 'rtsps:', 'http:', 'https:'],
  snapshot: ['http:', 'https:'],
  talk: ['rtmp:'],
};
export function sourceEntities(snapshot: Snapshot, kind: CameraSourceKind) {
  return snapshot.states.filter(
    (state) =>
      /^(sensor|text|input_text)\.[a-z0-9_]+$/.test(state.entity_id) &&
      validSourceUrl(state.state, kind),
  );
}
export function validSourceUrl(value: string, kind: CameraSourceKind) {
  try {
    const url = new URL(value);
    return (
      value.length <= 2048 && protocols[kind].includes(url.protocol) && !!url.hostname && !url.hash
    );
  } catch {
    return false;
  }
}
export function cameraSource(
  value: string,
  entityId: string,
  kind: CameraSourceKind,
  snapshot: Snapshot,
) {
  if (entityId) {
    if (!sourceEntities(snapshot, kind).some((state) => state.entity_id === entityId))
      throw Error('Choose an available source entity.');
    return `{{ states('${entityId}') }}`;
  }
  if (!value.trim()) return undefined;
  if (!validSourceUrl(value.trim(), kind))
    throw Error(
      kind === 'snapshot'
        ? 'Enter an HTTP snapshot address.'
        : kind === 'talk'
          ? 'Enter an RTMP microphone address.'
          : 'Enter an RTSP or HTTP stream address.',
    );
  return value.trim();
}
export function genericCameraInput(
  step: FlowStep,
  sources: { stream?: string; snapshot?: string },
) {
  const names = new Set(step.data_schema?.map((field) => field.name));
  const advanced = {
    framerate: 2,
    verify_ssl: true,
    rtsp_transport: 'tcp',
    authentication: 'basic',
  };
  return {
    ...(sources.stream ? { stream_source: sources.stream } : {}),
    ...(sources.snapshot ? { still_image_url: sources.snapshot } : {}),
    ...(names.has('advanced')
      ? { advanced }
      : Object.fromEntries(Object.entries(advanced).filter(([key]) => names.has(key)))),
  };
}
