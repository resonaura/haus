import { useMemo, useState } from 'react';
import { Button } from '@heroui/react';
import { ArrowRight, Check, MoveRight } from 'lucide-react';
import { Dialog } from '../../components/ui/Dialog';
import { deviceArea, planDeviceMoves, type DeviceMove } from '../../model/registry';
import type { Snapshot } from '../../model';
import type { MoveResult, RegistryController } from '../../ha/registry';

export function DeviceMoveDialog({
  ids,
  snapshot,
  registry,
  onClose,
  onMoved,
}: {
  ids: string[];
  snapshot: Snapshot;
  registry: RegistryController;
  onClose: () => void;
  onMoved: (ids: string[]) => void;
}) {
  const [destination, setDestination] = useState('');
  const [overrides, setOverrides] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);
  const [activePlan, setActivePlan] = useState<DeviceMove[]>([]);
  const [error, setError] = useState('');
  const [results, setResults] = useState<MoveResult[]>();
  const remaining = ids.filter(
    (id) => !results?.some((result) => result.deviceId === id && !result.error),
  );
  const prepared = useMemo(() => {
    try {
      return {
        plan: destination
          ? planDeviceMoves(
              snapshot,
              remaining,
              destination === 'none' ? null : destination,
              overrides,
            )
          : [],
        error: '',
      };
    } catch (reason) {
      return { plan: [], error: reason instanceof Error ? reason.message : String(reason) };
    }
  }, [snapshot, destination, overrides, remaining.join(',')]);
  const plan = prepared.plan;
  const previewPlan = busy ? activePlan : plan;
  const overrideCount = snapshot.entities.filter(
    (entry) => entry.device_id && remaining.includes(entry.device_id) && entry.area_id,
  ).length;
  const roomName = (id: string | null) =>
    snapshot.areas.find((area) => area.area_id === id)?.name ?? 'Unassigned';
  const succeeded = results?.filter((result) => !result.error).length ?? 0;
  return (
    <Dialog
      title="Move devices"
      className="device-move-dialog"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <p className="registry-help">
        Give {ids.length === 1 ? 'this device' : `${ids.length} devices`} a new place in your home.
        Review the changes before applying them.
      </p>
      <label className="management-field">
        <span>Destination room</span>
        <select
          aria-label="Destination room"
          value={destination}
          disabled={busy}
          onChange={(event) => {
            setDestination(event.target.value);
            setError('');
          }}
        >
          <option value="">Choose a room</option>
          {snapshot.areas.map((area) => (
            <option key={area.area_id} value={area.area_id}>
              {area.name}
            </option>
          ))}
          <option value="none">Unassigned · parts follow their parent</option>
        </select>
      </label>
      {overrideCount > 0 && (
        <label className="registry-check">
          <input
            type="checkbox"
            checked={overrides}
            disabled={busy}
            onChange={(event) => setOverrides(event.target.checked)}
          />
          <span>
            Move individually assigned controls too
            <small>
              {overrideCount} {overrideCount === 1 ? 'control has its' : 'controls have their'} own
              room. Keep these assignments unless you choose to move them.
            </small>
          </span>
        </label>
      )}
      <div className="device-move-preview" aria-label="Move preview">
        {previewPlan.map((item) => {
          const device = snapshot.devices.find((device) => device.id === item.deviceId);
          const after = snapshot.devices.map((device) =>
            remaining.includes(device.id) ? { ...device, area_id: item.toAreaId } : device,
          );
          return (
            <div key={item.deviceId}>
              <strong>{item.name}</strong>
              <span>
                {roomName(item.fromEffectiveAreaId)}
                <ArrowRight size={13} />
                {roomName(
                  device ? deviceArea({ ...device, area_id: item.toAreaId }, after) : item.toAreaId,
                )}
              </span>
              {item.overrides.length > 0 && (
                <small>{item.overrides.length} controls will follow this device</small>
              )}
            </div>
          );
        })}
      </div>
      {destination && !plan.length && !results && !prepared.error && (
        <p className="registry-help">These devices already use this room assignment.</p>
      )}
      {results && (
        <div className="registry-result" role="status">
          {succeeded > 0 && (
            <p>
              <Check size={16} />
              {succeeded} {succeeded === 1 ? 'device moved' : 'devices moved'}.
            </p>
          )}
          {results
            .filter((result) => result.error)
            .map((result) => (
              <p className="form-error" key={result.deviceId}>
                <strong>{result.name}</strong>: {result.error}
              </p>
            ))}
        </div>
      )}
      {prepared.error && (
        <p role="alert" className="form-error">
          {prepared.error}
        </p>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <div className="registry-dialog-actions">
        <span role="status">{busy ? `Moving ${done} of ${activePlan.length}…` : ''}</span>
        <Button variant="ghost" isDisabled={busy} onPress={onClose}>
          {results ? 'Done' : 'Cancel'}
        </Button>
        {(!results || results.some((result) => result.error)) && (
          <Button
            isPending={busy}
            isDisabled={busy || !plan.length}
            onPress={() => {
              setBusy(true);
              setDone(0);
              setError('');
              const currentPlan = plan;
              setActivePlan(currentPlan);
              void registry
                .moveDevices(currentPlan, (count) => setDone(count))
                .then((next) => {
                  setResults((previous) => [
                    ...(previous?.filter(
                      (result) => !next.some((item) => item.deviceId === result.deviceId),
                    ) ?? []),
                    ...next,
                  ]);
                  onMoved(next.filter((result) => !result.error).map((result) => result.deviceId));
                })
                .catch((reason) => setError(reason.message))
                .finally(() => setBusy(false));
            }}
          >
            <MoveRight size={16} />
            {results
              ? 'Retry remaining'
              : !plan.length
                ? 'Move devices'
                : `Move ${plan.length === 1 ? 'device' : `${plan.length} devices`}`}
          </Button>
        )}
      </div>
    </Dialog>
  );
}
