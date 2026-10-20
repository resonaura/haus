import { useState } from 'react';
import { ConnectionDetailLayout } from './ConnectionDetailLayout';
import { Button } from '@heroui/react';
import { ChevronRight } from 'lucide-react';
import type { Snapshot } from '../../model';
import {
  humanize,
  nativeApi,
  rest,
  type IntegrationEntry,
  type FlowProgress,
} from '../../ha/management';
import { BrandIcon } from '../../components/brand/BrandIcon';
import type { RepairIssue } from '../../model/notifications';
import { IntegrationRepairList } from './IntegrationRepairList';
import { attentionFlow, entryNeedsAttention as issue } from './integration-health';
import { type FlowTarget } from './IntegrationFlow';

import { ManagementFeedback, type Confirmation } from './ManagementFeedback';
export function IntegrationDetails({
  name,
  entries,
  snapshot,
  busy,
  onClose,
  onFlow,
  onChange,
  onConfirm,
  feedback,
  progress,
  issues,
}: {
  name: string;
  progress: FlowProgress[];
  issues: RepairIssue[];
  entries: IntegrationEntry[];
  snapshot: Snapshot;
  busy: boolean;
  onClose: () => void;
  onFlow: (target: FlowTarget) => void;
  onChange: (operation: () => Promise<unknown>, success?: string) => Promise<void>;
  onConfirm: (confirmation: Confirmation) => void;
  feedback: { error: string; notice: string };
}) {
  return (
    <ConnectionDetailLayout
      title={name}
      icon={<BrandIcon kind="integration" id={entries[0]?.domain ?? ''} />}
      subtitle="Accounts, devices and connection settings"
      onBack={onClose}
    >
      <ManagementFeedback {...feedback} />
      <IntegrationRepairList issues={issues} admin={snapshot.user.is_admin} onFlow={onFlow} />
      <div className="integration-detail-entries">
        {entries.map((entry) => (
          <IntegrationEntryDetail
            key={entry.entry_id}
            entry={entry}
            progress={progress}
            snapshot={snapshot}
            busy={busy}
            onFlow={onFlow}
            onChange={onChange}
            onConfirm={onConfirm}
          />
        ))}
      </div>
    </ConnectionDetailLayout>
  );
}
function IntegrationEntryDetail({
  entry,
  progress,
  snapshot,
  busy,
  onFlow,
  onChange,
  onConfirm,
}: {
  entry: IntegrationEntry;
  progress: FlowProgress[];
  snapshot: Snapshot;
  busy: boolean;
  onFlow: (target: FlowTarget) => void;
  onChange: (operation: () => Promise<unknown>, success?: string) => Promise<void>;
  onConfirm: (confirmation: Confirmation) => void;
}) {
  const [title, setTitle] = useState(entry.title);
  const [disableNew, setDisableNew] = useState(!!entry.pref_disable_new_entities);
  const [disablePolling, setDisablePolling] = useState(!!entry.pref_disable_polling);
  const admin = snapshot.user.is_admin;
  const attention = attentionFlow(entry, progress);
  const devices = snapshot.devices.filter(
    (d) => Array.isArray(d.config_entries) && d.config_entries.includes(entry.entry_id),
  );
  return (
    <section className="integration-entry-detail">
      <div className="management-detail-heading">
        <h3>{entry.title}</h3>
        <span
          className={`status-pill ${issue(entry, progress) ? 'status-unavailable' : entry.disabled_by ? 'status-disabled' : 'status-available'}`}
        >
          <i />
          {entry.disabled_by ? 'Disabled' : humanize(entry.state)}
        </span>
      </div>
      {entry.reason && <p className="form-error">{humanize(entry.reason)}</p>}
      <div className="management-action-row">
        {attention && (
          <Button
            variant="primary"
            isDisabled={!admin || busy}
            onPress={() =>
              onFlow({ domain: entry.domain, entryId: entry.entry_id, flowId: attention.flow_id })
            }
          >
            Sign in again
          </Button>
        )}

        {entry.supports_options && (
          <Button
            variant="secondary"
            isDisabled={!admin || busy}
            onPress={() =>
              onFlow({ domain: entry.domain, entryId: entry.entry_id, kind: 'options' })
            }
          >
            Options
          </Button>
        )}
        {entry.supports_reconfigure && (
          <Button
            variant="secondary"
            isDisabled={!admin || busy}
            onPress={() =>
              onFlow({ domain: entry.domain, entryId: entry.entry_id, reconfigure: true })
            }
          >
            Reconfigure
          </Button>
        )}
        <Button
          variant="secondary"
          isDisabled={!admin || busy || !!entry.disabled_by}
          onPress={() =>
            void onChange(
              () => rest('POST', `config/config_entries/entry/${entry.entry_id}/reload`),
              'Integration reloaded.',
            )
          }
        >
          Reload
        </Button>
        <Button
          variant="ghost"
          isDisabled={!admin || busy}
          onPress={() =>
            void onChange(() =>
              nativeApi().request({
                type: 'config_entries/disable',
                entry_id: entry.entry_id,
                disabled_by: entry.disabled_by ? null : 'user',
              }),
            )
          }
        >
          {entry.disabled_by ? 'Enable' : 'Disable'}
        </Button>
      </div>
      <details className="management-entry-settings">
        <summary>
          Connection settings
          <ChevronRight size={14} />
        </summary>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void onChange(() =>
              nativeApi().request({
                type: 'config_entries/update',
                entry_id: entry.entry_id,
                title,
                pref_disable_new_entities: disableNew,
                pref_disable_polling: disablePolling,
              }),
            );
          }}
        >
          <label className="management-field">
            <span>Name</span>
            <input value={title} required onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="management-check">
            <input
              type="checkbox"
              checked={disableNew}
              onChange={(e) => setDisableNew(e.target.checked)}
            />
            <span>Disable newly added entities</span>
          </label>
          <label className="management-check">
            <input
              type="checkbox"
              checked={disablePolling}
              onChange={(e) => setDisablePolling(e.target.checked)}
            />
            <span>Disable polling for updates</span>
          </label>
          <Button type="submit" variant="secondary" isDisabled={!admin || busy}>
            Save settings
          </Button>
        </form>
      </details>
      <details className="management-related-devices">
        <summary>
          {devices.length} devices
          <ChevronRight size={14} />
        </summary>
        {devices.map((device) => (
          <div key={device.id}>
            <strong>{device.name_by_user ?? device.name ?? 'Device'}</strong>
            <small>{[device.manufacturer, device.model].filter(Boolean).join(' · ')}</small>
          </div>
        ))}
      </details>
      <button
        className="management-remove"
        disabled={!admin || busy}
        onClick={() =>
          onConfirm({
            title: `Remove ${entry.title}?`,
            description:
              'This removes the integration connection and its devices and entities from Home Assistant. Related automations may need to be updated.',
            label: 'Remove integration',
            danger: true,
            action: () => rest('DELETE', `config/config_entries/entry/${entry.entry_id}`),
          })
        }
      >
        Remove integration
      </button>
    </section>
  );
}
