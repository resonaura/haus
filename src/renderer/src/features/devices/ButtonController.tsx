import { useEffect, useState } from 'react';
import { CircleDot, RotateCw, Workflow } from 'lucide-react';
import type { HausAccessory, Snapshot } from '../../model';
import { deviceDisplayName } from '../../model/device-name';
export function ButtonController({
  accessory,
  snapshot,
  demo,
}: {
  accessory: HausAccessory;
  snapshot: Snapshot;
  demo: boolean;
}) {
  const controls = [accessory.state, ...accessory.secondaryEntities]
    .filter((item) => item.entity_id.startsWith('event.'))
    .sort((a, b) => a.entity_id.localeCompare(b.entity_id, undefined, { numeric: true }));
  const [links, setLinks] = useState<Record<string, string[]>>({});
  const [error, setError] = useState('');
  useEffect(() => {
    if (demo || !window.hausNative || !accessory.deviceId) return;
    let active = true;
    const api = window.hausNative;
    const read = async () => {
      const results = await Promise.all([
        api.request<{ automation?: string[] }>({
          type: 'search/related',
          item_type: 'device',
          item_id: accessory.deviceId,
        }),
        ...controls.map((control) =>
          api.request<{ automation?: string[] }>({
            type: 'search/related',
            item_type: 'entity',
            item_id: control.entity_id,
          }),
        ),
      ]);
      if (active)
        setLinks(
          Object.fromEntries(
            results.map((result, index) => [
              index === 0 ? 'device' : controls[index - 1].entity_id,
              result.automation ?? [],
            ]),
          ),
        );
    };
    void read().catch(() => {
      if (active) setError('Linked automations are unavailable right now.');
    });
    return () => {
      active = false;
    };
  }, [accessory.deviceId, accessory.primaryEntityId, demo]);
  const automationName = (id: string) =>
    String(
      snapshot.states.find((item) => item.entity_id === id)?.attributes.friendly_name ??
        id.replace('automation.', '').replaceAll('_', ' '),
    );
  return (
    <section className="haus-button-controller">
      <p className="haus-controller-explanation">
        Physical buttons and their automations. Press a button on the remote to run its assignments.
      </p>
      <div className="haus-remote-buttons">
        {controls.map((control, index) => (
          <div key={control.entity_id} className="haus-physical-button">
            {/rotary|dial/.test(control.entity_id) ? (
              <RotateCw size={25} />
            ) : (
              <CircleDot size={25} />
            )}
            <strong>
              {deviceDisplayName(
                String(control.attributes.friendly_name ?? `Button ${index + 1}`),
                accessory.name,
                `Button ${index + 1}`,
              )}
            </strong>
            {(links[control.entity_id] ?? []).map((id) => (
              <small key={id}>
                <Workflow size={12} />
                {automationName(id)}
              </small>
            ))}
            {Array.isArray(control.attributes.event_types) && (
              <span>
                {control.attributes.event_types
                  .map(String)
                  .map((type) => type.replaceAll('_', ' '))
                  .join(' · ')}
              </span>
            )}
          </div>
        ))}
      </div>
      {(links.device?.length ?? 0) > 0 && (
        <div className="haus-remote-linked">
          <h3>Linked automations</h3>
          {links.device.map((id) => (
            <p key={id}>
              <Workflow size={15} />
              {automationName(id)}
              <small>
                {snapshot.states.find((item) => item.entity_id === id)?.state === 'on'
                  ? 'Enabled'
                  : 'Disabled'}
              </small>
            </p>
          ))}
        </div>
      )}
      {error && <p role="status">{error}</p>}
    </section>
  );
}
