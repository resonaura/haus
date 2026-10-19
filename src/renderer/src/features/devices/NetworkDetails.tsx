import { Router, Users, Wifi, Check, ArrowUpCircle } from 'lucide-react';
import type { HausAccessory } from '../../model';
export function NetworkDetails({ accessory }: { accessory: HausAccessory }) {
  const entities = [accessory.state, ...accessory.secondaryEntities];
  const clients = entities.find((item) => item.entity_id.endsWith('connected_clients'));
  const firmware = entities.find((item) => item.entity_id.startsWith('update.'));
  const status = entities.find((item) => /(?:^|_)status$/.test(item.entity_id));
  const healthy = ['green', 'connected', 'online', 'on'].includes(status?.state ?? '');
  const unavailable = ['unavailable', 'unknown'].includes(status?.state ?? accessory.state.state);
  const names = Array.isArray(clients?.attributes.clients)
    ? clients.attributes.clients.filter((item): item is string => typeof item === 'string')
    : [];
  return (
    <section className="haus-network-details">
      <div className="haus-network-hero">
        <Router size={40} strokeWidth={1.3} />
        <strong>{accessory.model ?? 'Network device'}</strong>
        <span>
          <Wifi size={14} />
          {unavailable
            ? 'No response'
            : healthy
              ? 'Connected'
              : (status?.state ?? 'Status unavailable')}
        </span>
      </div>
      <div className="haus-network-metrics">
        <div>
          <Users size={20} />
          <strong>{clients && Number.isFinite(Number(clients.state)) ? clients.state : '—'}</strong>
          <span>Connected devices</span>
        </div>
        <div>
          {firmware?.state === 'on' ? <ArrowUpCircle size={20} /> : <Check size={20} />}
          <strong>{String(firmware?.attributes.installed_version ?? '—')}</strong>
          <span>
            {firmware?.state === 'on'
              ? 'Update available'
              : firmware
                ? 'Firmware'
                : 'Version unavailable'}
          </span>
        </div>
      </div>
      {names.length > 0 && (
        <details className="haus-network-clients">
          <summary>Connected devices · {names.length}</summary>
          <ul>
            {names.map((name, index) => (
              <li key={`${index}:${name}`}>{name}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
