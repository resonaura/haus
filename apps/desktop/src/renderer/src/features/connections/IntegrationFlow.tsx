/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useEffect, useRef, useState } from 'react';
import { Button, Modal } from '@heroui/react';
import { HelpCircle, LoaderCircle, RefreshCw } from 'lucide-react';
import type { Snapshot } from '../../model';
import {
  humanize,
  nativeApi,
  rest,
  schemaDefaults,
  type FlowStep,
  type FlowProgress,
} from '../../ha/management';
import { SchemaFields } from '../../components/forms/SchemaForm';
import { ServerMarkdown } from '../../components/ui/ServerMarkdown';
import { CameraSetupPreview } from './CameraSetupPreview';
import { BrandIcon } from '../../components/brand/BrandIcon';
import { evaluateFlowStep } from '@haus/ha/flow';
import { UnsupportedFlowFallback } from './UnsupportedFlowFallback';
import { FlowMenuStep } from './flow/FlowMenuStep';
import { FlowResultStep } from './flow/FlowResultStep';
import { IntegrationPicker } from './flow/IntegrationPicker';
import { OAuthExternalStep } from './flow/OAuthExternalStep';
import {
  buildMenuLabels,
  createFlowLocalizationHelpers,
  extractFlowErrorMessage,
  fetchFlowPickerBootstrap,
  fetchStepTranslationResources,
  resolveStepDocumentationUrl,
  validateRequiredFormFields,
} from './flow/flow-helpers';

export type FlowTarget = {
  domain?: string;
  entryId?: string;
  flowId?: string;
  kind?: 'config' | 'options';
  reconfigure?: boolean;
  reauth?: boolean;
  repair?: { domain: string; issue_id: string; translation_key?: string };
  initialStep?: FlowStep;
};
export function IntegrationFlow({
  target,
  snapshot,
  onClose,
  onDone,
  domains,
}: {
  target: FlowTarget;
  snapshot: Snapshot;
  onClose: () => void;
  onDone: (step?: FlowStep) => void;
  domains?: ReadonlySet<string>;
}) {
  const [step, setStep] = useState<FlowStep | null>(null);
  const [handlers, setHandlers] = useState<string[]>([]);
  const [discovered, setDiscovered] = useState<FlowProgress[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [translations, setTranslations] = useState<Record<string, string>>({});
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});
  const [tuyaFollowup, setTuyaFollowup] = useState<'none' | 'active' | 'done'>('none');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [isHubSession, setIsHubSession] = useState<boolean | null>(null);
  const flowRef = useRef<FlowStep | null>(null);
  const ownsFlow = useRef(false);
  const initialized = useRef(false);
  const active = useRef(true);
  const pending = useRef(false);
  const kind = target.kind ?? 'config';
  const base = target.repair
    ? 'repairs/issues/fix'
    : kind === 'options'
      ? 'config/config_entries/options/flow'
      : 'config/config_entries/flow';
  const accept = (next: FlowStep) => {
    flowRef.current = next;
    setStep(next);
    setClientErrors({});
    setValues(schemaDefaults(next.data_schema ?? []));
    const shouldCheckTuyaCameras =
      next.type === 'create_entry' && next.handler === 'tuya' && kind === 'config';
    setTuyaFollowup(shouldCheckTuyaCameras ? 'active' : 'none');
    if (next.type === 'create_entry') onDone(next);
  };
  const perform = async (operation: () => Promise<FlowStep>, ownership?: boolean) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      const next = await operation();
      if (!active.current) {
        if ((ownership ?? ownsFlow.current) && !['create_entry', 'abort'].includes(next.type))
          void rest('DELETE', `${base}/${next.flow_id}`).catch(() => {});
        return;
      }
      if (ownership !== undefined) ownsFlow.current = ownership;
      accept(next);
    } catch (e) {
      setError(extractFlowErrorMessage(e));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  const start = (domain: string) =>
    perform(
      () =>
        rest('POST', base, {
          handler: kind === 'options' ? (target.entryId ?? domain) : domain,
          ...(kind === 'options' && domain ? { domain } : {}),
          ...(target.repair ? { issue_id: target.repair.issue_id } : {}),
          ...(target.entryId && kind !== 'options' ? { entry_id: target.entryId } : {}),
          ...(target.reauth
            ? { reauth: true, source: 'reauth', reauth_entry_id: target.entryId }
            : {}),
          ...(target.reconfigure ? { source: 'reconfigure', show_advanced_options: false } : {}),
        }),
      true,
    );
  useEffect(() => {
    active.current = true;
    const initialize = async () => {
      const session = await nativeApi()
        .getSession()
        .catch(() => null);
      if (!active.current) return;
      setIsHubSession(session?.kind === 'haus-hub');

      if (target.initialStep) {
        ownsFlow.current = true;
        accept(target.initialStep);
      } else if (target.flowId) {
        void perform(() => rest('GET', `${base}/${target.flowId}`));
      } else if (target.repair) {
        void start(target.repair.domain);
      } else if (target.domain || target.entryId) {
        void start(target.domain ?? '');
      } else {
        setBusy(true);
        void fetchFlowPickerBootstrap(domains)
          .then((res) => {
            setHandlers(res.handlers);
            setDiscovered(res.discovered);
            setNames(res.names);
          })
          .catch((e) => setError(String(e.message ?? e)))
          .finally(() => setBusy(false));
      }
    };
    if (!initialized.current) {
      initialized.current = true;
      void initialize();
    }
    return () => {
      active.current = false;
      const current = flowRef.current;
      const owned = ownsFlow.current;
      // React StrictMode replays effects before setup has actually been dismissed.
      // Delay cancellation one microtask so that replay cannot abort the live flow.
      queueMicrotask(() => {
        if (
          !active.current &&
          current &&
          owned &&
          !['create_entry', 'abort'].includes(current.type)
        )
          void rest('DELETE', `${base}/${current.flow_id}`).catch(() => {});
      });
    };
  }, []);
  useEffect(() => {
    const primaryDomain = kind === 'options' ? target.domain : step?.handler;
    const altDomain = step?.translation_domain ?? step?.supported_by;
    const domainList = [
      ...new Set([primaryDomain, altDomain].filter((x): x is string => Boolean(x))),
    ];
    if (domainList.length === 0) return;
    void fetchStepTranslationResources(domainList, target.repair ? 'issues' : kind)
      .then(setTranslations)
      .catch(() => {});
  }, [step?.handler, step?.translation_domain, step?.supported_by, kind, target.domain]);
  useEffect(() => {
    if (!step || !['progress', 'external', 'progress_done', 'external_done'].includes(step.type))
      return;
    const poll = () => {
      if (!pending.current) void perform(() => rest('GET', `${base}/${step.flow_id}`));
    };
    const timer = setInterval(poll, 1200);
    const onMessage = (event: MessageEvent) => {
      if (
        step.type === 'external' &&
        event.data &&
        typeof event.data === 'object' &&
        (event.data as { type?: string }).type === 'haus-oauth-complete'
      ) {
        poll();
      }
    };
    if (step.type === 'external') {
      window.addEventListener('focus', poll);
      window.addEventListener('message', onMessage);
    }
    return () => {
      clearInterval(timer);
      if (step.type === 'external') {
        window.removeEventListener('focus', poll);
        window.removeEventListener('message', onMessage);
      }
    };
  }, [step?.flow_id, step?.type]);
  const domain = (kind === 'options' ? target.domain : step?.handler) ?? target.domain ?? '';
  const { text, humanizeSlug, title, submitLabel, fieldLabel, fieldDescription, selectorOptions } =
    createFlowLocalizationHelpers({
      domain,
      kind,
      repair: target.repair,
      step,
      translations,
    });
  const docUrl = step ? resolveStepDocumentationUrl(step) : undefined;
  const submit = () => {
    if (!step) return;
    if (step.type === 'form') {
      const missing = validateRequiredFormFields(step.data_schema, values);
      if (Object.keys(missing).length > 0) {
        setClientErrors(missing);
        return;
      }
    }
    setClientErrors({});
    void perform(() => rest('POST', `${base}/${step.flow_id}`, values));
  };
  const terminal = step && ['create_entry', 'abort'].includes(step.type);
  const assessment = step
    ? evaluateFlowStep(step, {
        mode: isHubSession ? 'standalone-hub' : 'remote-ha',
      })
    : null;
  const unsupported = Boolean(isHubSession !== null && assessment && !assessment.supported);
  const menuLabels = buildMenuLabels(step, text, humanize);
  const mergedFormErrors = step ? { ...step.errors, ...clientErrors } : {};
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
              <div className="flow-header-top">
                <span className="flow-eyebrow">
                  {target.repair
                    ? 'REPAIR INTEGRATION'
                    : target.reauth
                      ? 'REAUTHENTICATE'
                      : target.reconfigure
                        ? 'RECONFIGURE'
                        : kind === 'options'
                          ? 'INTEGRATION OPTIONS'
                          : 'CONNECT YOUR HOME'}
                </span>
                {docUrl && (
                  <button
                    type="button"
                    className="flow-help-button"
                    aria-label="Open documentation"
                    title="Open documentation"
                    onClick={() =>
                      void nativeApi()
                        .openExternal(docUrl)
                        .catch(() => {})
                    }
                  >
                    <HelpCircle size={18} />
                  </button>
                )}
              </div>
              <div className="management-dialog-title">
                {domain && (
                  <span className="integration-logo">
                    <BrandIcon
                      kind="integration"
                      id={domain}
                      hint={{
                        ...(title ? { name: title } : {}),
                        ...(step?.supported_by ? { supportedBy: step.supported_by } : {}),
                      }}
                    />
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
                <IntegrationPicker
                  query={query}
                  onQueryChange={setQuery}
                  discovered={discovered}
                  handlers={handlers}
                  names={names}
                  busy={busy}
                  onResumeDiscovered={(flowId) =>
                    void perform(() => rest('GET', `${base}/${flowId}`), false)
                  }
                  onStartDomain={(id) => void start(id)}
                />
              )}
              {unsupported && assessment && (
                <UnsupportedFlowFallback
                  assessment={assessment}
                  domain={domain}
                  onClose={onClose}
                />
              )}
              {!unsupported && domain === 'generic' && step?.step_id === 'user_confirm' && (
                <CameraSetupPreview flowId={step.flow_id} />
              )}
              {!unsupported && step?.type === 'form' && (
                <form
                  id="integration-setup-form"
                  noValidate
                  onSubmit={(event) => {
                    event.preventDefault();
                    submit();
                  }}
                >
                  <div className="flow-description">
                    <ServerMarkdown
                      text={text(
                        `step.${step.step_id}.description`,
                        step.description ||
                          (step.data_schema?.length
                            ? 'Enter the details for this connection.'
                            : 'Continue when your device is ready.'),
                      )}
                    />
                  </div>
                  {step.errors?.base && (
                    <p role="alert" className="form-error">
                      {text(`error.${step.errors.base}`, humanizeSlug(step.errors.base))}
                    </p>
                  )}
                  <SchemaFields
                    key={`${step.flow_id}:${step.step_id}`}
                    schema={step.data_schema ?? []}
                    values={values}
                    onChange={(nextValues) => {
                      setValues(nextValues);
                      if (Object.keys(clientErrors).length > 0) {
                        setClientErrors((prev) =>
                          Object.fromEntries(
                            Object.entries(prev).filter(([k]) => nextValues[k] === values[k]),
                          ),
                        );
                      }
                    }}
                    snapshot={snapshot}
                    label={fieldLabel}
                    description={fieldDescription}
                    selectorOptions={selectorOptions}
                    errors={Object.fromEntries(
                      Object.entries(mergedFormErrors).map(([key, value]) => [
                        key,
                        text(`error.${value}`, humanizeSlug(value)),
                      ]),
                    )}
                  />
                </form>
              )}
              {!unsupported && step?.type === 'menu' && (
                <FlowMenuStep
                  step={step}
                  menuLabels={menuLabels}
                  description={step.description}
                  busy={busy}
                  humanize={humanize}
                  onNext={(choiceKey) =>
                    void perform(() =>
                      rest('POST', `${base}/${step.flow_id}`, { next_step_id: choiceKey }),
                    )
                  }
                />
              )}
              {!unsupported && step?.type === 'external' && (
                <OAuthExternalStep
                  domain={domain}
                  step={step}
                  isOptions={kind === 'options'}
                  isHubSession={Boolean(isHubSession)}
                  description={text(
                    `step.${step.step_id}.description`,
                    'The provider requires browser authorization. This setup will continue here after sign-in.',
                  )}
                  onStep={(next) => accept(next)}
                  onError={setError}
                />
              )}
              {!unsupported &&
                step &&
                ['progress', 'progress_done', 'external_done'].includes(step.type) && (
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
              {terminal && step && (
                <FlowResultStep
                  step={step}
                  domain={domain}
                  tuyaFollowup={tuyaFollowup}
                  isHubSession={isHubSession}
                  text={text}
                  humanizeSlug={humanizeSlug}
                  onNoTuyaCameras={() => setTuyaFollowup('done')}
                  onDone={onDone}
                  onClose={onClose}
                  onRetry={() => void start(domain)}
                  onError={setError}
                />
              )}
            </Modal.Body>
            {!(terminal && tuyaFollowup === 'active') && (
              <Modal.Footer>
                <Button variant="ghost" onPress={onClose}>
                  {terminal ? 'Done' : 'Cancel'}
                </Button>
                {!unsupported && step?.type === 'form' && (
                  <Button
                    type="submit"
                    form="integration-setup-form"
                    isPending={busy}
                    isDisabled={busy}
                  >
                    {submitLabel}
                  </Button>
                )}
                {error && !step && (
                  <Button variant="secondary" onPress={onClose}>
                    <RefreshCw size={15} />
                    Close and retry
                  </Button>
                )}
              </Modal.Footer>
            )}
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
