import { ExternalLink, Zap } from 'lucide-react';
import { buildAction, type HassEntity } from '../../model';
import type { Action } from '../../hooks/useHaus';
import { EmptyState as Empty } from '../../components/ui/EmptyState';
export function AutomationsPage({
  states,
  onAction,
  openServer,
}: {
  states: HassEntity[];
  onAction: (action: Action) => Promise<void>;
  openServer: (path: string) => void;
}) {
  return (
    <div className="automation-list">
      {states
        .filter((s) => s.entity_id.startsWith('automation.'))
        .map((s) => (
          <div className="automation-row" key={s.entity_id}>
            <span className="automation-icon">
              <Zap size={23} />
            </span>
            <span>
              <strong>{String(s.attributes.friendly_name ?? 'Automation')}</strong>
              <small>
                {s.state === 'on' ? 'Ready when you need it' : 'Paused'} · Managed by Home Assistant
              </small>
            </span>
            <button
              role="switch"
              aria-checked={s.state === 'on'}
              aria-label={`Enable ${s.attributes.friendly_name}`}
              className={`toggle-switch ${s.state === 'on' ? 'checked' : ''}`}
              onClick={() => void onAction(buildAction(s, 'toggle')).catch(() => {})}
            >
              <i />
            </button>
          </div>
        ))}
      {!states.some((s) => s.entity_id.startsWith('automation.')) && (
        <Empty
          icon={<Zap />}
          title="Let home take care of it"
          description="Automations from Home Assistant will appear here."
        />
      )}
      <button className="text-link" onClick={() => openServer('/config/automation/dashboard')}>
        Manage in Home Assistant <ExternalLink size={15} />
      </button>
    </div>
  );
}
