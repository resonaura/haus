import { useState } from 'react';
import { Button, Modal } from '@heroui/react';
import { ChevronRight } from 'lucide-react';
import type { Snapshot } from '../../model';
import { humanize, nativeApi, rest, type IntegrationEntry } from '../../ha/management';
import { BrandIcon } from '../../components/brand/BrandIcon';
import { type FlowTarget } from './IntegrationFlow';

import { ManagementFeedback, type Confirmation } from './ManagementFeedback';
const issue = (entry: IntegrationEntry) =>
  !entry.disabled_by &&
  ['setup_error', 'migration_error', 'setup_retry', 'failed_unload'].includes(entry.state);
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
}: {
  name: string;
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
    <Modal
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Modal.Backdrop variant="blur">
        <Modal.Container size="lg">
          <Modal.Dialog className="haus-dialog connection-detail-dialog">
            <Modal.CloseTrigger />
            <Modal.Header>
              <div className="management-dialog-title">
                <span className="integration-logo">
                  <BrandIcon kind="integration" id={entries[0]?.domain ?? ''} />
                </span>
                <Modal.Heading>{name}</Modal.Heading>
              </div>
            </Modal.Header>
            <Modal.Body>
              <ManagementFeedback {...feedback} />
              <div className="integration-detail-entries">
                {entries.map((entry) => (
                  <IntegrationEntryDetail
                    key={entry.entry_id}
                    entry={entry}
                    snapshot={snapshot}
                    busy={busy}
                    onFlow={onFlow}
                    onChange={onChange}
                    onConfirm={onConfirm}
                  />
                ))}
              </div>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="ghost" onPress={onClose}>
                Done
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
function IntegrationEntryDetail({
  entry,
  snapshot,
  busy,
  onFlow,
  onChange,
  onConfirm,
}: {
  entry: IntegrationEntry;
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
  const devices = snapshot.devices.filter(
    (d) => Array.isArray(d.config_entries) && d.config_entries.includes(entry.entry_id),
  );
  return (
    <section className="integration-entry-detail">
      <div className="management-detail-heading">
        <h3>{entry.title}</h3>
        <span
          className={`status-pill ${issue(entry) ? 'status-unavailable' : entry.disabled_by ? 'status-disabled' : 'status-available'}`}
        >
          <i />
          {entry.disabled_by ? 'Disabled' : humanize(entry.state)}
        </span>
      </div>
      {entry.reason && <p className="form-error">{humanize(entry.reason)}</p>}
      <div className="management-action-row">
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
