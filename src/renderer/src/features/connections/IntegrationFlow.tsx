import { useEffect, useRef, useState } from 'react';
import { Button, Modal } from '@heroui/react';
import { Check, ExternalLink, LoaderCircle, RefreshCw, Search, ChevronRight } from 'lucide-react';
import type { Snapshot } from '../../model';
import {
  humanize,
  nativeApi,
  rest,
  schemaDefaults,
  translationStrings,
  type FlowStep,
} from '../../ha/management';
import { SchemaFields } from '../../components/forms/SchemaForm';
import { BrandIcon } from '../../components/brand/BrandIcon';

export type FlowTarget = {
  domain?: string;
  entryId?: string;
  flowId?: string;
  kind?: 'config' | 'options';
  reconfigure?: boolean;
};
export function IntegrationFlow({
  target,
  snapshot,
  onClose,
  onDone,
}: {
  target: FlowTarget;
  snapshot: Snapshot;
  onClose: () => void;
  onDone: () => void;
}) {
  const [step, setStep] = useState<FlowStep | null>(null);
  const [handlers, setHandlers] = useState<string[]>([]);
  const [discovered, setDiscovered] = useState<
    Array<{
      flow_id: string;
      handler: string;
      context?: { title_placeholders?: Record<string, string>; source?: string };
    }>
  >([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [translations, setTranslations] = useState<Record<string, string>>({});
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const flowRef = useRef<FlowStep | null>(null);
  const pending = useRef(false);
  const kind = target.kind ?? 'config';
  const base =
    kind === 'options' ? 'config/config_entries/options/flow' : 'config/config_entries/flow';
  const accept = (next: FlowStep) => {
    flowRef.current = next;
    setStep(next);
    setValues(schemaDefaults(next.data_schema ?? []));
    if (next.type === 'create_entry') onDone();
  };
  const perform = async (operation: () => Promise<FlowStep>) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      accept(await operation());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Setup could not continue.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  const start = (domain: string) =>
    perform(() =>
      rest('POST', base, {
        handler: kind === 'options' ? (target.entryId ?? domain) : domain,
        ...(target.entryId && kind !== 'options' ? { entry_id: target.entryId } : {}),
        ...(target.reconfigure ? { show_advanced_options: false } : {}),
      }),
    );
  useEffect(() => {
    if (target.flowId) void perform(() => rest('GET', `${base}/${target.flowId}`));
    else if (target.domain || target.entryId) void start(target.domain ?? '');
    else {
      setBusy(true);
      void Promise.all([
        rest<string[]>('GET', 'config/config_entries/flow_handlers'),
        nativeApi().request<typeof discovered>({ type: 'config_entries/flow/progress' }),
        nativeApi().request<{ resources: Record<string, string> }>({
          type: 'frontend/get_translations',
          language: 'en',
          category: 'title',
          config_flow: true,
        }),
      ])
        .then(([available, progress, titles]) => {
          setHandlers(available);
          setDiscovered(progress);
          setNames(translationStrings(titles.resources));
        })
        .catch((e) => setError(String(e.message ?? e)))
        .finally(() => setBusy(false));
    }
    return () => {
      const current = flowRef.current;
      if (current && !['create_entry', 'abort'].includes(current.type))
        void rest('DELETE', `${base}/${current.flow_id}`).catch(() => {});
    };
  }, []);
  useEffect(() => {
    const translationDomain = kind === 'options' ? target.domain : step?.handler;
    if (!translationDomain) return;
    void nativeApi()
      .request<{ resources: Record<string, string> }>({
        type: 'frontend/get_translations',
        language: 'en',
        category: kind,
        integration: translationDomain,
      })
      .then((result) => setTranslations(translationStrings(result.resources)))
      .catch(() => {});
  }, [step?.handler, kind, target.domain]);
  useEffect(() => {
    if (!step || !['progress', 'external', 'progress_done', 'external_done'].includes(step.type))
      return;
    const timer = setInterval(() => {
      if (!pending.current) void perform(() => rest('GET', `${base}/${step.flow_id}`));
    }, 3000);
    return () => clearInterval(timer);
  }, [step?.flow_id, step?.type]);
  const domain = (kind === 'options' ? target.domain : step?.handler) ?? target.domain ?? '';
  const text = (suffix: string, fallback: string) => {
    let result = translations[`component.${domain}.${kind}.${suffix}`] ?? fallback;
    for (const [key, value] of Object.entries(step?.description_placeholders ?? {}))
      result = result.replaceAll(`{${key}}`, value);
    return result;
  };
  const title = step
    ? text(`step.${step.step_id}.title`, step.title ?? humanize(domain))
    : 'Connect an integration';
  const submit = () => step && perform(() => rest('POST', `${base}/${step.flow_id}`, values));
  const terminal = step && ['create_entry', 'abort'].includes(step.type);
  return (
    <Modal
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Modal.Backdrop variant="blur">
        <Modal.Container size="lg">
          <Modal.Dialog className="haus-dialog integration-flow-dialog">
            <Modal.CloseTrigger />
            <Modal.Header>
              <span className="flow-eyebrow">
                {kind === 'options' ? 'INTEGRATION OPTIONS' : 'CONNECT YOUR HOME'}
              </span>
              <div className="management-dialog-title">
                {domain && (
                  <span className="integration-logo">
                    <BrandIcon kind="integration" id={domain} />
                  </span>
                )}
                <Modal.Heading>{title}</Modal.Heading>
              </div>
            </Modal.Header>
            <Modal.Body>
              {error && (
                <p role="alert" className="form-error">
                  {error}
                </p>
              )}
              {busy && !step && (
                <div className="management-loading">
                  <LoaderCircle className="spin" />
                  Loading setup…
                </div>
              )}
              {!step && (
                <>
                  <label className="management-search">
                    <Search size={17} />
                    <input
                      aria-label="Find integration"
                      placeholder="Find a brand or integration"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </label>
                  {!!discovered.length && !query && (
                    <section className="flow-discovered">
                      <h3>Discovered & ready to set up</h3>
                      {discovered.map((item) => (
                        <button
                          key={item.flow_id}
                          onClick={() => void perform(() => rest('GET', `${base}/${item.flow_id}`))}
                        >
                          <BrandIcon kind="integration" id={item.handler} />
                          <span>
                            {item.context?.title_placeholders?.name ??
                              names[`component.${item.handler}.title`] ??
                              humanize(item.handler)}
                          </span>
                          <small>{item.context?.source ?? 'Discovered'}</small>
                          <ChevronRight size={15} />
                        </button>
                      ))}
                    </section>
                  )}
                  <div className="integration-picker">
                    {handlers
                      .filter((id) =>
                        `${id} ${names[`component.${id}.title`] ?? ''}`
                          .toLowerCase()
                          .includes(query.toLowerCase()),
                      )
                      .slice(0, query ? 100 : 40)
                      .map((id) => (
                        <button key={id} disabled={busy} onClick={() => void start(id)}>
                          <span className="integration-logo">
                            <BrandIcon kind="integration" id={id} />
                          </span>
                          <span>{names[`component.${id}.title`] ?? humanize(id)}</span>
                          <ChevronRight size={15} />
                        </button>
                      ))}
                  </div>
                  {handlers.length > 40 && !query && (
                    <p className="management-hint">
                      Search {handlers.length} available integrations.
                    </p>
                  )}
                </>
              )}
              {step?.type === 'form' && (
                <form
                  id="integration-setup-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void submit();
                  }}
                >
                  <p className="flow-description server-description">
                    {text(
                      `step.${step.step_id}.description`,
                      step.data_schema?.length
                        ? 'Enter the details for this connection.'
                        : 'Continue when your device is ready.',
                    )}
                  </p>
                  {step.errors?.base && (
                    <p role="alert" className="form-error">
                      {text(`error.${step.errors.base}`, humanize(step.errors.base))}
                    </p>
                  )}
                  <SchemaFields
                    key={`${step.flow_id}:${step.step_id}`}
                    schema={step.data_schema ?? []}
                    values={values}
                    onChange={setValues}
                    snapshot={snapshot}
                    label={(key) => text(`step.${step.step_id}.data.${key}`, humanize(key))}
                    errors={Object.fromEntries(
                      Object.entries(step.errors ?? {}).map(([key, value]) => [
                        key,
                        text(`error.${value}`, humanize(value)),
                      ]),
                    )}
                  />
                </form>
              )}
              {step?.type === 'menu' && (
                <div className="flow-menu">
                  {(Array.isArray(step.menu_options)
                    ? step.menu_options.map((id) => [
                        id,
                        text(`step.${step.step_id}.menu_options.${id}`, humanize(id)),
                      ])
                    : Object.entries(step.menu_options ?? {})
                  ).map(([id, title]) => (
                    <Button
                      key={id}
                      variant="secondary"
                      isDisabled={busy}
                      onPress={() =>
                        void perform(() =>
                          rest('POST', `${base}/${step.flow_id}`, { next_step_id: id }),
                        )
                      }
                    >
                      {title}
                      <ChevronRight size={16} />
                    </Button>
                  ))}
                </div>
              )}
              {step?.type === 'external' && (
                <div className="flow-prepare">
                  <ExternalLink size={30} />
                  <h3>Sign in with {humanize(domain)}</h3>
                  <p className="flow-description">
                    {text(
                      `step.${step.step_id}.description`,
                      'The provider requires browser authorization. This setup will continue here after sign-in.',
                    )}
                  </p>
                  <Button
                    onPress={() =>
                      void nativeApi()
                        .openIntegrationLogin(step.flow_id, kind === 'options')
                        .catch((e) => setError(e.message))
                    }
                  >
                    Continue to sign in
                    <ExternalLink size={15} />
                  </Button>
                </div>
              )}
              {step && ['progress', 'progress_done', 'external_done'].includes(step.type) && (
                <div className="management-loading">
                  <LoaderCircle className="spin" />
                  <span>
                    {text(
                      `progress.${step.progress_action}`,
                      humanize(step.progress_action ?? 'Waiting for device'),
                    )}
                  </span>
                </div>
              )}
              {terminal && (
                <div className="flow-result">
                  {step.type === 'create_entry' ? <Check size={34} /> : <InfoSymbol />}
                  <h3>
                    {step.type === 'create_entry'
                      ? 'Connection updated'
                      : text(`abort.${step.reason}`, humanize(step.reason ?? 'Setup ended'))}
                  </h3>
                </div>
              )}
            </Modal.Body>
            <Modal.Footer>
              <Button variant="ghost" onPress={onClose}>
                {terminal ? 'Done' : 'Cancel'}
              </Button>
              {step?.type === 'form' && (
                <Button
                  type="submit"
                  form="integration-setup-form"
                  isPending={busy}
                  isDisabled={busy}
                >
                  {step.last_step ? 'Finish setup' : 'Continue'}
                </Button>
              )}
              {error && !step && (
                <Button variant="secondary" onPress={onClose}>
                  <RefreshCw size={15} />
                  Close and retry
                </Button>
              )}
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
function InfoSymbol() {
  return <span className="management-result-symbol">i</span>;
}
