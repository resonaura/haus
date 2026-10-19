import { useCallback, useEffect, useState } from 'react';
import { Button, Modal } from '@heroui/react';
import { LoaderCircle, RefreshCw, ExternalLink } from 'lucide-react';
import type { Snapshot } from '../../model';
import { humanize, nativeApi, rest, supervisor, type AddonInfo } from '../../ha/management';
import { BrandIcon } from '../../components/brand/BrandIcon';

import { JsonField, SchemaFields } from '../../components/forms/SchemaForm';
import { ServerMarkdown } from '../../components/ui/ServerMarkdown';

import { ManagementFeedback } from './ManagementFeedback';
export function AddonDetails({
  addon,
  snapshot,
  busy,
  onClose,
  onAction,
  onChange,
  revision,
  feedback,
}: {
  addon: AddonInfo;
  snapshot: Snapshot;
  busy: boolean;
  onClose: () => void;
  onAction: (addon: AddonInfo, action: string) => void;
  onChange: (operation: () => Promise<unknown>, success?: string) => Promise<void>;
  revision: AddonInfo[];
  feedback: { error: string; notice: string };
}) {
  const [info, setInfo] = useState<AddonInfo | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('info');
  const [text, setText] = useState('');
  const [reading, setReading] = useState(false);
  const [options, setOptions] = useState<Record<string, unknown>>({});
  const [network, setNetwork] = useState<Record<string, unknown>>({});
  const [boot, setBoot] = useState(false);
  const [watchdog, setWatchdog] = useState(false);
  const [autoUpdate, setAutoUpdate] = useState(false);
  const [panel, setPanel] = useState(false);
  const installed = revision.some((a) => a.slug === addon.slug);
  const load = useCallback(async () => {
    setReading(true);
    setError('');
    try {
      const result = await supervisor<AddonInfo>(
        installed ? `/addons/${addon.slug}/info` : `/store/addons/${addon.slug}`,
      );
      setInfo(result);
      setOptions(result.options ?? {});
      setNetwork(result.network ?? {});
      setBoot(result.boot === 'auto');
      setWatchdog(!!result.watchdog);
      setAutoUpdate(!!result.auto_update);
      setPanel(!!result.ingress_panel);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read add-on details.');
    } finally {
      setReading(false);
    }
  }, [addon.slug, installed]);
  useEffect(() => {
    void load();
  }, [load, revision]);
  const readText = useCallback(async () => {
    setReading(true);
    setError('');
    try {
      const result = await rest<string>(
        'GET',
        `hassio/addons/${addon.slug}/${tab === 'docs' ? 'documentation' : tab === 'changes' ? 'changelog' : 'logs'}`,
      );
      setText(
        typeof result === 'string'
          ? result.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g'), '')
          : JSON.stringify(result, null, 2),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read add-on data.');
    } finally {
      setReading(false);
    }
  }, [addon.slug, tab]);
  useEffect(() => {
    if (['logs', 'docs', 'changes'].includes(tab)) void readText();
  }, [tab, readText]);
  const admin = snapshot.user.is_admin;
  const current = info ?? addon;
  return (
    <Modal
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Modal.Backdrop variant="blur">
        <Modal.Container size="lg">
          <Modal.Dialog className="haus-dialog addon-detail-dialog">
            <Modal.CloseTrigger />
            <Modal.Header>
              <div className="management-dialog-title">
                <span className="addon-glyph">
                  <BrandIcon kind="addon" id={addon.slug} />
                </span>
                <div>
                  <Modal.Heading>{addon.name}</Modal.Heading>
                  <small>
                    {current.version
                      ? `Version ${current.version}`
                      : current.version_latest
                        ? `Version ${current.version_latest}`
                        : ''}
                  </small>
                </div>
              </div>
            </Modal.Header>
            <Modal.Body>
              <ManagementFeedback {...feedback} />
              <div className="filter-tabs management-detail-tabs">
                {[
                  { id: 'info', label: 'Overview' },
                  ...(installed
                    ? [
                        { id: 'options', label: 'Configuration' },
                        { id: 'logs', label: 'Logs' },
                      ]
                    : []),
                  ...(current.documentation ? [{ id: 'docs', label: 'Documentation' }] : []),
                  ...(current.changelog ? [{ id: 'changes', label: 'Changelog' }] : []),
                ].map((item) => (
                  <button
                    key={item.id}
                    aria-pressed={tab === item.id}
                    className={tab === item.id ? 'selected' : ''}
                    onClick={() => setTab(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              {error && (
                <p role="alert" className="form-error">
                  {error}
                </p>
              )}
              {reading && (
                <div className="management-loading">
                  <LoaderCircle className="spin" size={18} />
                  Loading…
                </div>
              )}
              {tab === 'info' && (
                <>
                  <p className="flow-description">{current.description}</p>
                  {current.long_description && <ServerMarkdown text={current.long_description} />}
                  <div className="addon-facts">
                    <span>
                      State
                      <strong>
                        {installed ? humanize(current.state ?? 'unknown') : 'Not installed'}
                      </strong>
                    </span>
                    <span>
                      Repository<strong>{current.repository ?? 'Unknown'}</strong>
                    </span>
                    <span>
                      Latest version<strong>{current.version_latest ?? 'Unknown'}</strong>
                    </span>
                  </div>
                  <div className="management-action-row">
                    {installed && (current.ingress || current.webui) && (
                      <Button
                        variant="secondary"
                        isDisabled={current.state !== 'started' || busy}
                        onPress={() =>
                          void nativeApi()
                            .openAddon(addon.slug)
                            .catch((e) => setError(e.message))
                        }
                      >
                        <ExternalLink size={15} />
                        Open web interface
                      </Button>
                    )}
                    {installed ? (
                      <>
                        <Button
                          isDisabled={!admin || busy}
                          variant="secondary"
                          onPress={() =>
                            onAction(current, current.state === 'started' ? 'stop' : 'start')
                          }
                        >
                          {current.state === 'started' ? 'Stop' : 'Start'}
                        </Button>
                        <Button
                          variant="secondary"
                          isDisabled={!admin || busy || current.state !== 'started'}
                          onPress={() => onAction(current, 'restart')}
                        >
                          Restart
                        </Button>
                        {current.update_available && (
                          <Button
                            isDisabled={!admin || busy}
                            onPress={() => onAction(current, 'update')}
                          >
                            Update with backup
                          </Button>
                        )}
                        {current.repository === 'local' && (
                          <Button
                            variant="ghost"
                            isDisabled={!admin || busy}
                            onPress={() => onAction(current, 'rebuild')}
                          >
                            Rebuild
                          </Button>
                        )}
                      </>
                    ) : (
                      <Button
                        isDisabled={!admin || busy || current.available === false}
                        onPress={() => onAction(current, 'install')}
                      >
                        Install add-on
                      </Button>
                    )}
                  </div>
                  {installed && !current.system_managed && (
                    <button
                      className="management-remove"
                      disabled={!admin || busy}
                      onClick={() => onAction(current, 'uninstall')}
                    >
                      Uninstall add-on
                    </button>
                  )}
                </>
              )}
              {tab === 'options' && info && (
                <form
                  id="addon-options"
                  onSubmit={(event) => {
                    event.preventDefault();
                    setError('');
                    void onChange(async () => {
                      const checked = await supervisor<{ valid: boolean; message?: string }>(
                        `/addons/${addon.slug}/options/validate`,
                        'post',
                        { options },
                      );
                      if (!checked.valid)
                        throw new Error(
                          checked.message ?? 'The add-on configuration is not valid.',
                        );
                      await supervisor(`/addons/${addon.slug}/options`, 'post', {
                        options,
                        network,
                        ...(info.boot_config !== 'manual_only'
                          ? { boot: boot ? 'auto' : 'manual' }
                          : {}),
                        watchdog,
                        auto_update: autoUpdate,
                        ...(info.ingress_panel !== undefined ? { ingress_panel: panel } : {}),
                      });
                    }, 'Add-on configuration saved. Restart the add-on if required.');
                  }}
                >
                  <h3 className="management-form-heading">Options</h3>
                  {info.schema?.length ? (
                    <SchemaFields
                      schema={info.schema}
                      values={options}
                      onChange={setOptions}
                      snapshot={snapshot}
                    />
                  ) : (
                    <JsonField
                      label="Add-on options"
                      value={options}
                      onChange={(next) => setOptions(next as Record<string, unknown>)}
                    />
                  )}
                  {!!Object.keys(network).length && (
                    <>
                      <h3 className="management-form-heading">Network ports</h3>
                      {Object.entries(network).map(([key, value]) => (
                        <label className="management-field" key={key}>
                          <span>{key}</span>
                          <input
                            type="number"
                            min={1}
                            max={65535}
                            placeholder="Disabled"
                            value={value == null ? '' : String(value)}
                            onChange={(event) =>
                              setNetwork({
                                ...network,
                                [key]: event.target.value ? event.target.valueAsNumber : null,
                              })
                            }
                          />
                        </label>
                      ))}
                    </>
                  )}
                  <h3 className="management-form-heading">Startup & maintenance</h3>
                  {info.boot_config !== 'manual_only' && (
                    <label className="management-check">
                      <input
                        type="checkbox"
                        checked={boot}
                        onChange={(e) => setBoot(e.target.checked)}
                      />
                      <span>Start on boot</span>
                    </label>
                  )}
                  <label className="management-check">
                    <input
                      type="checkbox"
                      checked={watchdog}
                      onChange={(e) => setWatchdog(e.target.checked)}
                    />
                    <span>Watchdog · restart if the add-on stops</span>
                  </label>
                  <label className="management-check">
                    <input
                      type="checkbox"
                      checked={autoUpdate}
                      onChange={(e) => setAutoUpdate(e.target.checked)}
                    />
                    <span>Automatic updates</span>
                  </label>
                  {info.ingress_panel !== undefined && (
                    <label className="management-check">
                      <input
                        type="checkbox"
                        checked={panel}
                        onChange={(e) => setPanel(e.target.checked)}
                      />
                      <span>Show in Home Assistant sidebar</span>
                    </label>
                  )}
                </form>
              )}
              {['logs', 'docs', 'changes'].includes(tab) && (
                <>
                  <div className="management-text-toolbar">
                    <span>
                      {tab === 'logs'
                        ? 'Latest server logs'
                        : tab === 'docs'
                          ? 'Documentation'
                          : 'Release notes'}
                    </span>
                    <button
                      className="text-link"
                      onClick={() => void readText()}
                      disabled={reading}
                    >
                      <RefreshCw size={14} />
                      Refresh
                    </button>
                  </div>
                  {tab === 'logs' ? (
                    <pre className="management-server-text is-log">
                      {text || (reading ? 'Loading…' : 'No content reported.')}
                    </pre>
                  ) : (
                    <ServerMarkdown
                      text={text || (reading ? 'Loading…' : 'No content reported.')}
                    />
                  )}
                </>
              )}
            </Modal.Body>
            <Modal.Footer>
              <Button variant="ghost" onPress={onClose}>
                Done
              </Button>
              {tab === 'options' && (
                <Button
                  type="submit"
                  form="addon-options"
                  isDisabled={!admin || busy || reading}
                  isPending={busy}
                >
                  Save configuration
                </Button>
              )}
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
