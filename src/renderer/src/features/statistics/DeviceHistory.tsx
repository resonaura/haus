import { useEffect, useState } from 'react';
import type { HausAccessory } from '../../model';
type Point = { at: number; state: string };
export function DeviceHistory({ accessory, demo }: { accessory: HausAccessory; demo: boolean }) {
  const entities = [accessory.state, ...accessory.secondaryEntities].filter(
    (item) =>
      /^(sensor|binary_sensor|light|switch|climate|cover|fan|lock|media_player)\./.test(
        item.entity_id,
      ) && !/url|stream|token/i.test(item.entity_id),
  );
  const [id, setId] = useState(entities[0]?.entity_id ?? '');
  const [days, setDays] = useState(1);
  const [points, setPoints] = useState<Point[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let active = true;
    setError('');
    setPoints([]);
    if (!id) return;
    if (demo || !window.hausNative) return;
    setLoading(true);
    const end = new Date();
    void window.hausNative
      .request<Record<string, Array<Record<string, any>>>>({
        type: 'history/history_during_period',
        entity_ids: [id],
        start_time: new Date(+end - days * 86400000).toISOString(),
        end_time: end.toISOString(),
        minimal_response: true,
        no_attributes: true,
        include_start_time_state: true,
        significant_changes_only: false,
      })
      .then((result) => {
        if (active)
          setPoints(
            (result[id] ?? [])
              .map((item) => ({
                state: String(item.s ?? item.state),
                at:
                  typeof item.lu === 'number'
                    ? item.lu * 1000
                    : Date.parse(item.last_updated || item.last_changed),
              }))
              .filter((item) => Number.isFinite(item.at)),
          );
      })
      .catch((reason) => {
        if (active) setError(reason.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [id, days, demo]);
  const numeric = points.filter((item) => item.state.trim() && Number.isFinite(Number(item.state)));
  const { low, high } = numeric.reduce(
    (range, item) => ({
      low: Math.min(range.low, Number(item.state)),
      high: Math.max(range.high, Number(item.state)),
    }),
    { low: Infinity, high: -Infinity },
  );
  const start = points[0]?.at ?? 0,
    end = points.at(-1)?.at ?? 1;
  const unit = entities.find((item) => item.entity_id === id)?.attributes.unit_of_measurement ?? '';
  return (
    <section className="device-history">
      <div className="device-history-filters">
        <label>
          Measurement
          <select value={id} onChange={(event) => setId(event.target.value)}>
            {entities.map((item) => (
              <option key={item.entity_id} value={item.entity_id}>
                {String(item.attributes.friendly_name ?? item.entity_id)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Period
          <select value={days} onChange={(event) => setDays(Number(event.target.value))}>
            <option value={1}>24 hours</option>
            <option value={7}>7 days</option>
          </select>
        </label>
      </div>
      {loading && <p role="status">Loading history…</p>}
      {error && <p role="alert">{error}</p>}
      {!loading && !error && !points.length && (
        <p>
          {demo
            ? 'Connect your home to see recorded device history.'
            : 'No recorded states in this period.'}
        </p>
      )}
      {numeric.length > 0 && (
        <>
          <p className="device-history-range">
            {low} – {high} {unit}
          </p>
          <svg viewBox="0 0 600 160" role="img" aria-label="Recorded measurement history">
            <path
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              d={numeric
                .map(
                  (point, index) =>
                    `${index ? 'L' : 'M'} ${10 + ((point.at - start) / Math.max(1, end - start)) * 580} ${145 - ((Number(point.state) - low) / Math.max(1, high - low)) * 130}`,
                )
                .join(' ')}
            />
          </svg>
        </>
      )}
      <ol className="device-history-log">
        {points
          .slice(-100)
          .reverse()
          .map((point, index) => (
            <li key={`${point.at}:${index}`}>
              <time dateTime={new Date(point.at).toISOString()}>
                {new Date(point.at).toLocaleString()}
              </time>
              <strong>
                {point.state} {unit}
              </strong>
            </li>
          ))}
      </ol>
    </section>
  );
}
