/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useEffect, useRef, useState } from 'react';
import { Box, HausButton as Button, HausModalOverlay as Modal, Pressable, Text } from '@haus/ui';
import { HelpCircle, LoaderCircle, RefreshCw } from 'lucide-react';
import type { Snapshot } from '../../model';
import { humanize, nativeApi, rest, schemaDefaults, type FlowStep } from '../../ha/management';
import { CameraSetupPreview } from './CameraSetupPreview';
import { BrandIcon } from '../../components/brand/BrandIcon';
import { evaluateFlowStep } from '@haus/ha/flow';
import { UnsupportedFlowFallback } from './UnsupportedFlowFallback';
import { FlowFormStep, FlowMenuStep } from './flow/FlowMenuStep';
import { FlowResultStep } from './flow/FlowResultStep';
import { IntegrationPicker } from './flow/IntegrationPicker';
import { OAuthExternalStep } from './flow/OAuthExternalStep';
import { PluginInstallStep } from './flow/PluginInstallStep';
import type { EcosystemCatalogSourceItem } from './flow/catalog';
import {
  buildFlowStartPayload,
  buildMenuLabels,
  createFlowLocalizationHelpers,
  extractFlowErrorMessage,
  fetchFlowPickerBootstrap,
  fetchStepTranslationResources,
  flowEyebrowLabel,
  isCompletedFlowStep,
  resolveFlowHeaderPresentation,
  resolveIntegrationTitle,
  resolveStepDocumentationUrl,
  validateRequiredFormFields,
  type FlowTarget,
  type SelectedEcosystemApp,
} from './flow/flow-helpers';

export type { FlowTarget };

export function IntegrationFlow({
  target,
  snapshot,
  onClose,
  onDone,
  domains,
  initialHandlers,
  initialEcosystemApps,
  names: providedNames,
}: {
  target: FlowTarget;
  snapshot: Snapshot;
  onClose: () => void;
  onDone: (step?: FlowStep) => void;
  domains?: ReadonlySet<string>;
  initialHandlers?: readonly string[];
  initialEcosystemApps?: readonly EcosystemCatalogSourceItem[];
  names?: Readonly<Record<string, string>>;
}) {
  const [step, setStep] = useState<FlowStep | null>(null);
  const [handlers, setHandlers] = useState<string[]>(() => [...(initialHandlers ?? [])]);
  const [ecosystemApps, setEcosystemApps] = useState<readonly EcosystemCatalogSourceItem[]>(
    initialEcosystemApps ?? [],
  );
  const [selectedApp, setSelectedApp] = useState<SelectedEcosystemApp | null>(() =>
    target.appCatalogId && target.appRuntime
      ? {
          appId: target.appCatalogId,
          title: target.title ?? target.appCatalogId,
          runtime: target.appRuntime,
        }
      : null,
  );
  const [names, setNames] = useState<Record<string, string>>(() => ({ ...providedNames }));
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
    setTuyaFollowup(
      next.type === 'create_entry' && next.handler === 'tuya' && kind === 'config'
        ? 'active'
        : 'none',
    );
    if (isCompletedFlowStep(next)) onDone(next);
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
  const refreshPickerCatalog = () =>
    fetchFlowPickerBootstrap(domains).then((res) => {
      if (!active.current) return;
      setHandlers(res.handlers);
      setNames(res.names);
      setEcosystemApps(res.ecosystemApps);
    });
  const start = (domain: string) =>
    perform(() => rest('POST', base, buildFlowStartPayload(target, kind, domain)), true);

  useEffect(() => {
    active.current = true;
    const initialize = async () => {
      const session = await nativeApi()
        .getSession()
        .catch(() => null);
      if (!active.current) return;
      setIsHubSession(session?.kind === 'haus-hub');
      if (target.appCatalogId && target.appRuntime) return;
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
        if (!initialHandlers || initialHandlers.length === 0) setBusy(true);
        void refreshPickerCatalog()
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
      queueMicrotask(() => {
        if (
          !active.current &&
          current &&
          owned &&
          !['create_entry', 'abort'].includes(current.type)
        ) {
          void rest('DELETE', `${base}/${current.flow_id}`).catch(() => {});
        }
      });
    };
  }, []);

  const domain =
    (kind === 'options' ? target.domain : step?.handler) ??
    target.domain ??
    target.repair?.domain ??
    '';

  useEffect(() => {
    const alt = step?.translation_domain ?? step?.supported_by;
    const domainList = [...new Set([domain, alt].filter((x): x is string => Boolean(x)))];
    if (domainList.length === 0) return;
    void fetchStepTranslationResources(domainList, target.repair ? 'issues' : kind)
      .then(setTranslations)
      .catch(() => {});
  }, [domain, step?.translation_domain, step?.supported_by, kind, target.repair]);

  useEffect(() => {
    if (!step || !['progress', 'external', 'progress_done', 'external_done'].includes(step.type))
      return;
    const poll = () => {
      if (!pending.current) void perform(() => rest('GET', `${base}/${step.flow_id}`));
    };
    const timer = setInterval(poll, 1200);
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string } | null;
      if (
        step.type === 'external' &&
        data &&
        typeof data === 'object' &&
        data.type === 'haus-oauth-complete'
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

  const hasTarget = Boolean(
    target.domain || target.entryId || target.flowId || target.repair || selectedApp,
  );
  const retryable = Boolean(target.flowId || domain);
  const retry = () => {
    if (target.flowId) void perform(() => rest('GET', `${base}/${target.flowId}`), false);
    else if (domain) void start(target.repair?.domain ?? domain);
  };
  const integrationTitle = resolveIntegrationTitle(domain, {
    explicitTitle: target.title,
    providedNames,
    pickerNames: names,
    translations,
    supportedBy: step?.supported_by,
  });
  const localization = createFlowLocalizationHelpers({
    domain,
    integrationTitle,
    kind,
    repair: target.repair,
    step,
    translations,
  });
  const { text, humanizeSlug, title, submitLabel } = localization;
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
    ? evaluateFlowStep(step, { mode: isHubSession ? 'standalone-hub' : 'remote-ha' })
    : null;
  const unsupported = Boolean(isHubSession !== null && assessment && !assessment.supported);
  const menuLabels = buildMenuLabels(step, text, humanize);
  const { displayTitle, headerIconId, headerIconKind, headerIconHint } =
    resolveFlowHeaderPresentation({
      selectedApp,
      step,
      hasTarget,
      domain,
      integrationTitle,
      brandTitle: target.brandItem?.title,
      title,
    });
  const isPicker = !step && !hasTarget;
  const dialogClass = `haus-dialog integration-flow-dialog${isPicker ? ' is-picker' : ''}`;

  return (
    <Modal isOpen onOpenChange={(open) => !open && onClose()}>
      <Modal.Backdrop variant="blur">
        <Modal.Container size="lg">
          <Modal.Dialog className={dialogClass}>
            <Modal.CloseTrigger />
            <Modal.Header>
              {(!isPicker || docUrl) && (
                <Box className="flow-header-top">
                  {!isPicker && (
                    <Text className="flow-eyebrow">{flowEyebrowLabel({ ...target, kind })}</Text>
                  )}
                  {docUrl && (
                    <Pressable
                      className="flow-help-button"
                      ariaLabel="Open documentation"
                      title="Open documentation"
                      onPress={() =>
                        void nativeApi()
                          .openExternal(docUrl)
                          .catch(() => {})
                      }
                    >
                      <HelpCircle size={18} />
                    </Pressable>
                  )}
                </Box>
              )}
              <Box className="management-dialog-title">
                {headerIconId && (
                  <Text className="integration-logo">
                    <BrandIcon kind={headerIconKind} id={headerIconId} hint={headerIconHint} />
                  </Text>
                )}
                <Modal.Heading>{displayTitle}</Modal.Heading>
              </Box>
            </Modal.Header>
            <Modal.Body>
              {error && !selectedApp && (
                <Text semantic="p" role="alert" className="form-error">
                  {error}
                </Text>
              )}
              {busy && !step && !selectedApp && (!isPicker || handlers.length === 0) && (
                <Box className="management-loading">
                  <LoaderCircle className="spin" />
                  Loading setup…
                </Box>
              )}
              {selectedApp && (
                <PluginInstallStep
                  appId={selectedApp.appId}
                  runtime={selectedApp.runtime}
                  hacsRepositoryId={selectedApp.hacsRepositoryId}
                  hacsDomain={selectedApp.hacsDomain}
                  onBack={!target.appCatalogId ? () => setSelectedApp(null) : undefined}
                  onCancel={onClose}
                  onInstalled={() => onDone()}
                  onConfigureHacsDomain={(hacsDomain) => {
                    setSelectedApp(null);
                    void refreshPickerCatalog().catch(() => {});
                    void start(hacsDomain);
                  }}
                />
              )}
              {isPicker && (
                <IntegrationPicker
                  query={query}
                  onQueryChange={setQuery}
                  handlers={handlers}
                  names={names}
                  ecosystemApps={ecosystemApps}
                  initialSelectedBrand={target.brandItem ?? null}
                  busy={busy}
                  onStartDomain={(id) => void start(id)}
                  onSelectEcosystemApp={(appId, appTitle, runtime, meta) =>
                    setSelectedApp({ appId, title: appTitle, runtime, ...meta })
                  }
                  onCombinedGoveeDone={() => onDone()}
                  onRefreshCatalog={() => void refreshPickerCatalog().catch(() => {})}
                />
              )}
              {!selectedApp && unsupported && assessment && (
                <UnsupportedFlowFallback
                  assessment={assessment}
                  domain={domain}
                  domainName={integrationTitle}
                  onClose={onClose}
                />
              )}
              {!selectedApp &&
                !unsupported &&
                domain === 'generic' &&
                step?.step_id === 'user_confirm' && <CameraSetupPreview flowId={step.flow_id} />}
              {!selectedApp && !unsupported && step?.type === 'form' && (
                <FlowFormStep
                  step={step}
                  values={values}
                  clientErrors={clientErrors}
                  snapshot={snapshot}
                  localization={localization}
                  onChangeValues={setValues}
                  onChangeClientErrors={setClientErrors}
                  onSubmit={submit}
                />
              )}
              {!selectedApp && !unsupported && step?.type === 'menu' && (
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
              {!selectedApp && !unsupported && step?.type === 'external' && (
                <OAuthExternalStep
                  domain={domain}
                  domainName={integrationTitle}
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
              {!selectedApp &&
                !unsupported &&
                step &&
                ['progress', 'progress_done', 'external_done'].includes(step.type) && (
                  <Box className="management-loading">
                    <LoaderCircle className="spin" />
                    <Text>
                      {step.description ||
                        text(
                          `progress.${step.progress_action}`,
                          humanize(step.progress_action ?? 'Waiting for device'),
                        )}
                    </Text>
                  </Box>
                )}
              {!selectedApp && terminal && step && (
                <FlowResultStep
                  step={step}
                  domain={domain}
                  domainName={integrationTitle}
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
            {!selectedApp && !(terminal && tuyaFollowup === 'active') && (
              <Modal.Footer>
                <Button variant="ghost" onPress={onClose}>
                  {error && !step ? 'Close' : terminal ? 'Done' : 'Cancel'}
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
                {error && !step && retryable && (
                  <Button variant="secondary" onPress={retry} isPending={busy} isDisabled={busy}>
                    <RefreshCw size={15} />
                    Retry
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
