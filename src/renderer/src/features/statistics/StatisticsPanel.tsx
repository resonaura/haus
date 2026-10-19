import { useEffect, useMemo, useState } from 'react';
import { ScrollShadow } from '@heroui/react';
import { Activity, Database, RefreshCw, Search, Waves } from 'lucide-react';
import { titleCase } from '../../model/presentation';
import type { HassEntity } from '../../model';

type StatisticMetadata = {
  statistic_id: string;
  name?: string | null;
  source?: string;
  unit_of_measurement?: string | null;
  mean_type?: number;
  has_mean?: boolean;
  has_sum?: boolean;
};

type StatisticPoint = {
  start: number | string;
  end?: number | string;
  mean?: number | string | null;
  min?: number | string | null;
  max?: number | string | null;
  state?: number | string | null;
  sum?: number | string | null;
  [key: string]: unknown;
};

type Metric = 'mean' | 'min' | 'max' | 'sum' | 'state';
type Range = 'day' | 'week' | 'month' | 'year';

const ranges: Array<{ id: Range; label: string; days: number; period: string }> = [
  { id: 'day', label: '24 hours', days: 1, period: 'hour' },
  { id: 'week', label: '7 days', days: 7, period: 'hour' },
  { id: 'month', label: '30 days', days: 30, period: 'day' },
  { id: 'year', label: '12 months', days: 365, period: 'month' },
];

const metricLabels: Record<Metric, string> = {
  mean: 'Mean',
  min: 'Minimum',
  max: 'Maximum',
  sum: 'Total',
  state: 'Value',
};

const numericValue = (value: unknown): number | null => {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (value === '') return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
};

const displayValue = (value: number, unit?: string | null) => {
  const maximumFractionDigits = Math.abs(value) < 1 && value !== 0 ? 3 : 2;
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits }).format(value)}${unit ? ` ${unit}` : ''}`;
};

const dateLabel = (timestamp: number, range: Range) => {
  const date = new Date(timestamp);
  return new Intl.DateTimeFormat(undefined, {
    ...(range === 'day' || range === 'week' ? { hour: 'numeric' } : { month: 'short' }),
    ...(range === 'day' || range === 'week' ? {} : { day: 'numeric' }),
  }).format(date);
};

function TrendChart({
  points,
  metric,
  range,
}: {
  points: StatisticPoint[];
  metric: Metric;
  range: Range;
}) {
  const values = points.flatMap((point) => {
    const value = numericValue(point[metric]);
    return value === null ? [] : [{ point, value }];
  });
  if (!values.length) return null;

  const numbers = values.map(({ value }) => value);
  const low = Math.min(...numbers);
  const high = Math.max(...numbers);
  const spread = high - low || Math.max(Math.abs(high) * 0.08, 1);
  const firstX = 28;
  const lastX = 692;
  const top = 18;
  const bottom = 154;
  const plotted = values.map(({ point, value }, index) => {
    const time = Number(point.start);
    const x =
      values.length === 1
        ? (firstX + lastX) / 2
        : firstX + (index / (values.length - 1)) * (lastX - firstX);
    const y = bottom - ((value - low) / spread) * (bottom - top);
    return { x, y, value, time };
  });
  const line = plotted.map(({ x, y }, index) => `${index ? 'L' : 'M'} ${x} ${y}`).join(' ');
  const area = `${line} L ${lastX} ${bottom} L ${firstX} ${bottom} Z`;
  const labelIndices = [0, Math.floor((plotted.length - 1) / 2), plotted.length - 1];

  return (
    <div className="recorder-chart">
      <svg viewBox="0 0 720 190" role="img" aria-label={`${metricLabels[metric]} history chart`}>
        <defs>
          <linearGradient id="recorder-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity=".2" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[18, 63, 108, 154].map((y) => (
          <line key={y} x1="28" x2="692" y1={y} y2={y} className="recorder-grid-line" />
        ))}
        <path d={area} fill="url(#recorder-fill)" />
        <path d={line} className="recorder-chart-line" />
        {plotted.length < 80 &&
          plotted.map(({ x, y }, index) => (
            <circle key={`${x}-${index}`} cx={x} cy={y} r="2.5" className="recorder-chart-point" />
          ))}
      </svg>
      <div className="recorder-chart-labels">
        {labelIndices.map((index) => (
          <span key={index}>{dateLabel(plotted[index].time, range)}</span>
        ))}
      </div>
    </div>
  );
}

export function StatisticsPanel({ mode, states }: { mode: 'demo' | 'live'; states: HassEntity[] }) {
  const [statistics, setStatistics] = useState<StatisticMetadata[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [range, setRange] = useState<Range>('week');
  const [metric, setMetric] = useState<Metric>('mean');
  const [points, setPoints] = useState<StatisticPoint[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingSeries, setLoadingSeries] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');
  const [retryToken, setRetryToken] = useState(0);
  const stateById = useMemo(
    () => new Map(states.map((state) => [state.entity_id, state])),
    [states],
  );
  const statisticName = (item: StatisticMetadata) =>
    String(
      item.name ||
        stateById.get(item.statistic_id)?.attributes.friendly_name ||
        titleCase(item.statistic_id.split('.').at(-1) ?? item.statistic_id),
    );

  useEffect(() => {
    if (mode !== 'live' || !window.hausNative) {
      setStatistics([]);
      setSelectedId('');
      setPoints([]);
      setError('');
      return;
    }
    let active = true;
    setLoadingList(true);
    setError('');
    void window.hausNative
      .request<StatisticMetadata[]>({ type: 'recorder/list_statistic_ids' })
      .then((result) => {
        if (!active) return;
        const rows = Array.isArray(result)
          ? result.filter(
              (item): item is StatisticMetadata =>
                Boolean(item) && typeof item.statistic_id === 'string',
            )
          : [];
        rows.sort((a, b) => statisticName(a).localeCompare(statisticName(b)));
        setStatistics(rows);
        setSelectedId((current) =>
          rows.some((item) => item.statistic_id === current)
            ? current
            : (rows.find((item) => {
                const value = stateById.get(item.statistic_id)?.state;
                return value !== undefined && numericValue(value) !== null;
              })?.statistic_id ??
              rows[0]?.statistic_id ??
              ''),
        );
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (active) setLoadingList(false);
      });
    return () => {
      active = false;
    };
  }, [mode, retryToken]);

  useEffect(() => {
    if (mode !== 'live' || !selectedId || !window.hausNative) {
      setPoints([]);
      return;
    }
    let active = true;
    const selectedRange = ranges.find((item) => item.id === range)!;
    const start = new Date(Date.now() - selectedRange.days * 86_400_000).toISOString();
    setPoints([]);
    setLoadingSeries(true);
    setError('');
    void window.hausNative
      .request<Record<string, StatisticPoint[]>>({
        type: 'recorder/statistics_during_period',
        start_time: start,
        statistic_ids: [selectedId],
        period: selectedRange.period,
        types: ['change', 'last_reset', 'max', 'mean', 'min', 'state', 'sum'],
      })
      .then((result) => {
        if (!active) return;
        setPoints(Array.isArray(result?.[selectedId]) ? result[selectedId] : []);
      })
      .catch((cause: unknown) => {
        if (active) {
          setPoints([]);
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      })
      .finally(() => {
        if (active) setLoadingSeries(false);
      });
    return () => {
      active = false;
    };
  }, [mode, range, retryToken, selectedId]);

  const selected = statistics.find((item) => item.statistic_id === selectedId);
  const selectedEntity = stateById.get(selectedId);
  const metricOptions = useMemo(() => {
    const options: Metric[] = [];
    const supportsMean = (selected?.mean_type ?? (selected?.has_mean ? 1 : 0)) !== 0;
    if (supportsMean) options.push('mean', 'min', 'max');
    if (selected?.has_sum) options.push('sum');
    if (points.some((point) => numericValue(point.state) !== null)) options.push('state');
    return options.filter((item) => points.some((point) => numericValue(point[item]) !== null));
  }, [points, selected]);
  useEffect(() => {
    if (metricOptions.length && !metricOptions.includes(metric)) setMetric(metricOptions[0]);
  }, [metric, metricOptions]);

  const filteredStatistics = statistics.filter((item) =>
    `${statisticName(item)} ${item.statistic_id}`.toLowerCase().includes(filter.toLowerCase()),
  );
  const values = points.flatMap((point) => {
    const value = numericValue(point[metric]);
    return value === null ? [] : [{ point, value }];
  });
  const latest = values.at(-1);
  const latestTime = latest ? Number(latest.point.start) : null;
  const title = selected ? statisticName(selected) : 'Statistics';
  const unit = selected?.unit_of_measurement;

  if (mode === 'demo') {
    return (
      <div className="recorder-empty">
        <span className="recorder-empty-icon">
          <Database size={22} />
        </span>
        <h2>Recorded sensor history</h2>
        <p>Connect your Home Assistant instance to browse its recorded sensor statistics.</p>
      </div>
    );
  }

  return (
    <div className="recorder-page">
      <div className="recorder-summary">
        <article>
          <span>Tracked statistics</span>
          <strong>{loadingList ? '—' : statistics.length}</strong>
        </article>
        <article>
          <span>Points in this view</span>
          <strong>{loadingSeries ? '—' : values.length}</strong>
        </article>
        <article>
          <span>Latest recorded value</span>
          <strong>{latest ? displayValue(latest.value, unit) : '—'}</strong>
        </article>
      </div>

      {error && (
        <div className="recorder-error" role="status">
          <Activity size={17} />
          <span>{error}</span>
          <button onClick={() => setRetryToken((value) => value + 1)}>
            <RefreshCw size={13} /> Retry
          </button>
        </div>
      )}

      <div className="recorder-workspace">
        <aside className="recorder-browser">
          <div className="recorder-browser-heading">
            <div>
              <strong>Recorded sensors</strong>
              <small>{statistics.length} recorded at home</small>
            </div>
          </div>
          <label className="recorder-filter">
            <Search size={15} />
            <input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Find a statistic"
              aria-label="Find a statistic"
            />
          </label>
          <ScrollShadow
            className="recorder-sensor-scroll"
            orientation="vertical"
            size={24}
            hideScrollBar
          >
            <div className="recorder-sensor-list">
              {filteredStatistics.map((item) => (
                <button
                  key={item.statistic_id}
                  className={`recorder-sensor${item.statistic_id === selectedId ? ' is-selected' : ''}`}
                  onClick={() => setSelectedId(item.statistic_id)}
                  title={statisticName(item)}
                >
                  <span className="recorder-sensor-icon">
                    <Waves size={16} />
                  </span>
                  <span className="recorder-sensor-copy">
                    <strong>{statisticName(item)}</strong>
                    <small>{item.statistic_id}</small>
                  </span>
                  <span className="recorder-sensor-unit">{item.unit_of_measurement ?? ''}</span>
                </button>
              ))}
              {!loadingList && !filteredStatistics.length && (
                <p className="recorder-list-empty">
                  {statistics.length
                    ? 'No matching statistics.'
                    : 'No long-term statistics are available.'}
                </p>
              )}
            </div>
          </ScrollShadow>
        </aside>

        <section className="recorder-detail" aria-label="Selected sensor statistics">
          {loadingList && !statistics.length ? (
            <div className="recorder-detail-empty">
              <Activity size={20} />
              <span>Loading sensor history…</span>
            </div>
          ) : !selected ? (
            <div className="recorder-detail-empty">
              <Database size={20} />
              <span>No long-term sensor history is available yet.</span>
            </div>
          ) : (
            <>
              <header className="recorder-detail-heading">
                <div className="recorder-detail-title">
                  <span className="recorder-detail-icon">
                    <Waves size={19} />
                  </span>
                  <div>
                    <small>
                      {selected.source ||
                        selectedEntity?.attributes.device_class ||
                        'Recorded sensor history'}
                    </small>
                    <h2 title={title}>{title}</h2>
                    <span>{selected.statistic_id}</span>
                  </div>
                </div>
                <div className="recorder-current-value">
                  <small>
                    {latestTime
                      ? `Recorded ${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(latestTime)}`
                      : 'No recent value'}
                  </small>
                  <strong>{latest ? displayValue(latest.value, unit) : '—'}</strong>
                </div>
              </header>

              <div className="recorder-toolbar">
                <div className="recorder-metrics" aria-label="Statistic type">
                  {(metricOptions.length ? metricOptions : (['mean'] as Metric[])).map((item) => (
                    <button
                      key={item}
                      className={metric === item ? 'is-active' : ''}
                      aria-pressed={metric === item}
                      onClick={() => setMetric(item)}
                    >
                      {metricLabels[item]}
                    </button>
                  ))}
                </div>
                <div className="recorder-ranges" aria-label="History range">
                  {ranges.map((item) => (
                    <button
                      key={item.id}
                      className={range === item.id ? 'is-active' : ''}
                      aria-pressed={range === item.id}
                      onClick={() => setRange(item.id)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              {loadingSeries ? (
                <div className="recorder-detail-empty">
                  <Activity size={20} />
                  <span>Loading recorded values…</span>
                </div>
              ) : values.length ? (
                <>
                  <TrendChart points={points} metric={metric} range={range} />
                  <div className="recorder-range-summary">
                    <span>
                      <small>Low</small>
                      <strong>
                        {displayValue(Math.min(...values.map((item) => item.value)), unit)}
                      </strong>
                    </span>
                    <span>
                      <small>Average</small>
                      <strong>
                        {displayValue(
                          values.reduce((sum, item) => sum + item.value, 0) / values.length,
                          unit,
                        )}
                      </strong>
                    </span>
                    <span>
                      <small>High</small>
                      <strong>
                        {displayValue(Math.max(...values.map((item) => item.value)), unit)}
                      </strong>
                    </span>
                  </div>
                </>
              ) : (
                <div className="recorder-detail-empty">
                  <Database size={20} />
                  <span>No recorded values for this period.</span>
                </div>
              )}
              <footer className="recorder-source-note">
                <Database size={14} />
                Recorded locally by your home
              </footer>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
