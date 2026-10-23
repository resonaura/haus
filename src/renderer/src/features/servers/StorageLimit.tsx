import { useState } from 'react';
import { Button, Label, Slider } from '@heroui/react';
import { Check, Infinity as InfinityIcon, HardDrive } from 'lucide-react';
import { allocatedSpace, bytes, GIB, quotaRange } from './presentation';
import type { HomeServer } from './types';

export function StorageLimit({
  server,
  admin,
  busy,
  onSave,
}: {
  server: HomeServer;
  admin: boolean;
  busy: boolean;
  onSave: (limit: number | null) => Promise<void>;
}) {
  const saved = server.settings?.storageLimitBytes ?? null;
  const localCache =
    server.kind === 'home-assistant' && server.storage?.cachePolicy === 'verified-archive';
  const [draft, setDraft] = useState<number | null | undefined>();
  const [savedFeedback, setSavedFeedback] = useState(false);
  const current = draft === undefined ? saved : draft;
  const max = quotaRange(server);
  const changed = current !== saved;
  const save = () =>
    onSave(current)
      .then(() => {
        setDraft(undefined);
        setSavedFeedback(true);
      })
      .catch(() => {});
  const update = (value: number | null) => {
    setDraft(value);
    setSavedFeedback(false);
  };
  return (
    <section className="server-panel server-storage-limit">
      <div className="server-section-heading">
        <div>
          <h3>{localCache ? 'Recent video on Home Assistant' : 'Space for Haus'}</h3>
          <p>
            {localCache
              ? 'Keep recent recordings here; older footage stays on your NVR servers.'
              : server.kind === 'home-assistant'
                ? 'Set a budget for original camera recordings.'
                : 'Set a budget for media and recovery copies.'}
          </p>
        </div>
        <span>{current === null ? 'Unlimited' : bytes(current)}</span>
      </div>
      <div className="server-limit-modes" aria-label="Storage limit">
        <Button
          variant={current === null ? 'secondary' : 'ghost'}
          aria-pressed={current === null}
          isDisabled={!admin || busy || !server.online}
          onPress={() => update(null)}
        >
          <InfinityIcon size={19} />
          Unlimited
        </Button>
        <Button
          variant={current !== null ? 'secondary' : 'ghost'}
          aria-pressed={current !== null}
          isDisabled={!admin || busy || !server.online}
          onPress={() => {
            if (current === null) update(Math.min(max, Math.max(1, Math.round(max / 2))) * GIB);
          }}
        >
          <HardDrive size={17} />
          Set a limit
        </Button>
      </div>
      {server.storage && (
        <div className="server-limit-usage">
          <span>
            {bytes(server.storage.usedBytes)} {localCache ? 'on Home Assistant' : 'saved'}
          </span>
          <span>
            {allocatedSpace(server) !== undefined
              ? allocatedSpace(server) === null
                ? 'Available space is not reported'
                : `${bytes(allocatedSpace(server))} available for Haus`
              : `${bytes(server.storage.freeBytes)} free on disk`}
          </span>
        </div>
      )}
      {localCache && server.storage?.archivedBytes !== undefined && (
        <p className="server-muted">
          {bytes(server.storage.archivedBytes)} archived on NVR · 10 GB local cache by default
        </p>
      )}
      {current !== null && (
        <div className="server-limit-adjust">
          <Slider
            aria-label="Storage budget in gigabytes"
            minValue={1}
            maxValue={max}
            step={1}
            value={current / GIB}
            isDisabled={!admin || busy || !server.online}
            onChange={(value) => {
              if (typeof value === 'number') update(value * GIB);
            }}
          >
            <Label>Storage budget</Label>
            <Slider.Output>{bytes(current)}</Slider.Output>
            <Slider.Track>
              <Slider.Fill />
              <Slider.Thumb />
            </Slider.Track>
          </Slider>
          <label className="server-limit-number">
            <input
              aria-label="Exact storage budget in gigabytes"
              type="number"
              min={1}
              max={max}
              step={1}
              value={Math.round(current / GIB)}
              disabled={!admin || busy || !server.online}
              onChange={(event) => {
                const value = Number(event.target.value);
                if (Number.isFinite(value) && value >= 1) update(Math.min(max, value) * GIB);
              }}
            />
            <span>GB</span>
          </label>
        </div>
      )}
      <div className="server-limit-footer">
        <p>
          {current === null
            ? 'No fixed cap. Haus keeps a reserve of free disk space. Recording retention still applies.'
            : localCache
              ? 'Older local files are released after their NVR archive is verified. Your timeline stays available. Without a verified archive, recording pauses safely.'
              : server.kind === 'home-assistant'
                ? 'Existing recordings and backups stay. New recordings pause at this limit; normal recording retention still applies.'
                : 'Existing files stay. New copies pause until usage falls below this limit.'}
        </p>
        {admin && (
          <Button
            variant={changed ? 'primary' : 'ghost'}
            isPending={busy}
            isDisabled={busy || !changed || !server.online}
            onPress={() => {
              void save();
            }}
          >
            {savedFeedback && !changed ? (
              <>
                <Check size={16} />
                Saved
              </>
            ) : (
              'Save limit'
            )}
          </Button>
        )}
      </div>
    </section>
  );
}
