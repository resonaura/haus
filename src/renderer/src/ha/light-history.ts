import type { HausNative } from '../../../shared/native';
import type { HassEntity } from '../model';

/** Read only the last useful on-state for lights whose off-state omits output parameters. */
export async function loadLastLightOutput(
  api: Pick<HausNative, 'request'>,
  ids: string[],
  stillNeeded: (id: string) => boolean,
  onState: (entity: HassEntity) => void,
  now = Date.now(),
) {
  for (const [days, endDays] of [
    [1, 0],
    [7, 1],
  ]) {
    const remaining = ids.filter(stillNeeded).slice(0, 96);
    for (let index = 0; index < remaining.length; index += 8) {
      const entityIds = remaining.slice(index, index + 8);
      const result = await api.request<Record<string, Array<Record<string, any>>>>({
        type: 'history/history_during_period',
        start_time: new Date(now - days * 86400000).toISOString(),
        end_time: new Date(now - endDays * 86400000).toISOString(),
        entity_ids: entityIds,
        include_start_time_state: true,
        significant_changes_only: false,
        minimal_response: false,
        no_attributes: false,
      });
      for (const id of entityIds) {
        const states = Array.isArray(result[id]) ? result[id] : [];
        const last = [...states]
          .reverse()
          .find((state) => (state.s ?? state.state) === 'on' && (state.a ?? state.attributes));
        if (!last) continue;
        const updatedAt =
          typeof last.lu === 'number'
            ? new Date(last.lu * 1000).toISOString()
            : String(last.last_updated ?? last.last_changed ?? '');
        onState({
          entity_id: id,
          state: 'on',
          attributes: last.a ?? last.attributes,
          last_changed: updatedAt,
          last_updated: updatedAt,
        });
      }
    }
  }
}
