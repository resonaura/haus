import type { HassEntity } from './types';

export const CAMERA_ORDER_SCOPE = 'home:cameras';

export function orderCameras(cameras: HassEntity[], saved: readonly string[] = []) {
  const ranks = new Map(saved.map((id, index) => [id, index]));
  return [...cameras].sort(
    (a, b) => (ranks.get(a.entity_id) ?? Infinity) - (ranks.get(b.entity_id) ?? Infinity),
  );
}

export function moveCamera(ids: readonly string[], from: string, to: string) {
  const source = ids.indexOf(from),
    target = ids.indexOf(to);
  if (source < 0 || target < 0 || source === target) return [...ids];
  const next = [...ids];
  next.splice(target, 0, next.splice(source, 1)[0]);
  return next;
}

/** Reorder visible slots without dropping hidden, temporarily missing or new cameras. */
export function cameraOrderPatch(
  saved: readonly string[] = [],
  known: readonly string[],
  visible: readonly string[],
) {
  const complete = [...new Set([...saved, ...known, ...visible])];
  const selected = new Set(visible);
  let index = 0;
  return complete.map((id) => (selected.has(id) ? visible[index++] : id));
}
