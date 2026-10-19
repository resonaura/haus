import { useEffect, useState } from 'react';
import type { HausAccessory, HassEntity } from '../../model';
type Reading = { value: number; at: string; average?: boolean };
const percentage = (state: string) =>
  state.trim() && Number.isFinite(Number(state)) && Number(state) >= 0 && Number(state) <= 100
    ? Number(state)
    : undefined;
export function PrinterSupplies({ accessory, demo }: { accessory: HausAccessory; demo: boolean }) {
  const supplies = [accessory.state, ...accessory.secondaryEntities].filter((item) =>
    /ink|toner|cartridge/i.test(`${item.entity_id} ${item.attributes.friendly_name}`),
  );
  const [remembered, setRemembered] = useState<Record<string, Reading>>({});
  const [error, setError] = useState('');
  const ids = supplies.map((item) => item.entity_id).join(',');
  useEffect(() => {
    let active = true;
    const load = async () => {
      const api = window.hausNative;
      const session = await api?.getSession().catch(() => null);
      if (!active) return;
      const storageKey = `haus.ink:${demo ? 'demo' : (session?.url ?? 'local')}`;
      let cache: Record<string, Reading> = {};
      try {
        const stored: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '{}');
        if (stored && typeof stored === 'object' && !Array.isArray(stored))
          cache = Object.fromEntries(
            Object.entries(stored).filter(
              ([, value]) =>
                value &&
                typeof value === 'object' &&
                Number.isFinite(value.value) &&
                value.value >= 0 &&
                value.value <= 100 &&
                typeof value.at === 'string',
            ),
          );
      } catch {
        /* A stale cache never prevents current readings. */
      }
      const valid = (item: HassEntity) => {
        const value = percentage(item.state);
        if (value !== undefined)
          cache[item.entity_id] = { value, at: item.last_updated || item.last_changed };
      };
      supplies.forEach(valid);
      if (active) setRemembered({ ...cache });
      const missing = supplies
        .filter((item) => percentage(item.state) === undefined && !cache[item.entity_id])
        .map((item) => item.entity_id);
      if (api && !demo && missing.length) {
        try {
          const now = Date.now();
          for (let end = 0; end < 28 && missing.some((id) => !cache[id]); end += 7) {
            const history = await api.request<Record<string, Array<Record<string, any>>>>({
              type: 'history/history_during_period',
              entity_ids: missing.filter((id) => !cache[id]),
              start_time: new Date(now - (end + 7) * 86400000).toISOString(),
              end_time: new Date(now - end * 86400000).toISOString(),
              minimal_response: true,
              no_attributes: true,
              include_start_time_state: true,
              significant_changes_only: true,
            });
            if (!active) return;
            for (const id of missing) {
              const last = [...(history[id] ?? [])]
                .reverse()
                .find((item) => percentage(String(item.s ?? item.state)) !== undefined);
              if (last)
                cache[id] = {
                  value: percentage(String(last.s ?? last.state))!,
                  at:
                    typeof last.lu === 'number'
                      ? new Date(last.lu * 1000).toISOString()
                      : String(last.last_updated || last.last_changed || ''),
                };
            }
            setRemembered({ ...cache });
          }
          const absent = missing.filter((id) => !cache[id]);
          if (absent.length) {
            const series = await api.request<Record<string, Array<Record<string, any>>>>({
              type: 'recorder/statistics_during_period',
              statistic_ids: absent,
              start_time: new Date(now - 365 * 86400000).toISOString(),
              end_time: new Date(now).toISOString(),
              period: 'day',
              types: ['mean'],
            });
            if (!active) return;
            for (const id of absent) {
              const last = [...(series[id] ?? [])]
                .reverse()
                .find(
                  (point) =>
                    point.mean !== null &&
                    point.mean !== undefined &&
                    percentage(String(point.mean)) !== undefined,
                );
              if (last)
                cache[id] = {
                  value: Number(last.mean),
                  at:
                    typeof last.start === 'number'
                      ? new Date(last.start).toISOString()
                      : String(last.start),
                  average: true,
                };
            }
            setRemembered({ ...cache });
          }
        } catch {
          if (active)
            setError('Recorded ink levels could not be loaded. Cached levels remain available.');
        }
      }
      localStorage.setItem(storageKey, JSON.stringify(cache));
    };
    void load().catch(() => {
      if (active) setError('Ink history is unavailable. Current readings remain visible.');
    });
    return () => {
      active = false;
    };
  }, [ids, demo, supplies.map((item) => `${item.state}:${item.last_updated}`).join('|')]);
  return (
    <section className="printer-supplies" aria-label="Printer supplies">
      <h3>Ink & toner</h3>
      <div className="printer-cartridges">
        {supplies.map((item) => {
          const current = percentage(item.state),
            old = remembered[item.entity_id];
          const value = current ?? old?.value;
          const name = String(item.attributes.friendly_name ?? item.entity_id)
            .replace(accessory.name, '')
            .replace(/ink|toner|cartridge/gi, '')
            .trim();
          const color = /cyan/i.test(name)
            ? '#38cddd'
            : /magenta/i.test(name)
              ? '#ed65b7'
              : /yellow/i.test(name)
                ? '#f2d651'
                : /photo/i.test(name)
                  ? '#858585'
                  : '#353535';
          return (
            <article key={item.entity_id} style={{ '--ink-colour': color } as React.CSSProperties}>
              <span
                className="printer-cartridge"
                role="meter"
                aria-label={name}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={value}
              >
                <i style={{ height: `${value ?? 0}%` }} />
              </span>
              <strong>{name}</strong>
              <b>{value === undefined ? '—' : `${Math.round(value)}%`}</b>
              {current === undefined && (
                <small>
                  {old
                    ? `${old.average ? 'Last daily average' : 'Last known'} · ${old.at ? new Date(old.at).toLocaleDateString() : 'date unavailable'}`
                    : 'Not recorded'}
                </small>
              )}
            </article>
          );
        })}
      </div>
      {error && <p role="status">{error}</p>}
    </section>
  );
}
