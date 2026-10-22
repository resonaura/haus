import type { HassEntity } from '../../model';

export interface CameraPtzButtons {
  up?: HassEntity;
  down?: HassEntity;
  left?: HassEntity;
  right?: HassEntity;
  zoomIn?: HassEntity;
  zoomOut?: HassEntity;
  stop?: HassEntity;
  home?: HassEntity;
}

const labelOf = (entity: HassEntity) =>
  `${String(entity.attributes.friendly_name ?? '')} ${entity.entity_id}`
    .toLocaleLowerCase()
    .replace(/[_.-]+/g, ' ');

export function cameraPtzButtons(entities: HassEntity[]): CameraPtzButtons | undefined {
  const result: CameraPtzButtons = {};
  for (const entity of entities) {
    if (!['button', 'input_button'].includes(entity.entity_id.split('.')[0])) continue;
    const label = labelOf(entity);
    // Direction words can also belong to a camera/room name. Require a motor command.
    const direction =
      /\b(?:ptz|pan|tilt|move|turn|rotate|direction)(?: camera)? (left|right|up|down|north|south|east|west)\b/.exec(
        label,
      )?.[1];
    if (direction && ['left', 'west'].includes(direction) && !result.left) result.left = entity;
    else if (direction && ['right', 'east'].includes(direction) && !result.right)
      result.right = entity;
    else if (direction && ['up', 'north'].includes(direction) && !result.up) result.up = entity;
    else if (direction && ['down', 'south'].includes(direction) && !result.down)
      result.down = entity;
    if (/\bzoom (?:in|tele)\b/.test(label) && !result.zoomIn) result.zoomIn = entity;
    else if (/\bzoom (?:out|wide)\b/.test(label) && !result.zoomOut) result.zoomOut = entity;
    if (
      /\b(?:(?:stop|halt)(?: camera)? (?:ptz|pan|tilt|movement|motor)|(?:ptz|pan|tilt|movement|motor)(?: camera)? (?:stop|halt))\b/.test(
        label,
      ) &&
      !result.stop
    )
      result.stop = entity;
    if (/\b(?:go home|home position|return home|preset home)\b/.test(label) && !result.home)
      result.home = entity;
  }
  const movementCount =
    Number(Boolean(result.up)) +
    Number(Boolean(result.down)) +
    Number(Boolean(result.left)) +
    Number(Boolean(result.right)) +
    Number(Boolean(result.zoomIn)) +
    Number(Boolean(result.zoomOut));
  return movementCount >= 2 ? result : undefined;
}
