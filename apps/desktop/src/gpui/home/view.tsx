/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { KeyEvent } from '@gpuix/react';
import { CompactDashboard, ConnectHomePanel } from '@haus/ui/components';
import { HausButton, HausUiProvider, Row, Text } from '@haus/ui/primitives';
import { colorToken, corners, insets, px, SolidMaterial, type UiStyleSpec } from '@haus/ui/ir';
import { GPUIX_CONTENT_HOST } from '@haus/ui/gpui';
import type { SidebarBackdrop } from '../../platform/sidebar.js';
import { createGpuiCameraApi } from '../camera/transport.js';
import type { GpuiPlatform } from '../platform.js';
import { Preview } from '../preview.js';
import { shouldTriggerControlHaptic } from './model.js';
import { HomeWorkspace } from './workspace.js';
import type { HomeSessionStatusInfo } from './settings-view.js';
import type { GpuiHomeRuntime } from './runtime.js';
import type { GpuiCameraStreams } from '../camera/stream.js';

const fieldStyle: UiStyleSpec = {
  layout: { minHeight: px(40), padding: insets(8, 10) },
  corners: corners(8),
  border: { width: 1, color: colorToken('border') },
  material: new SolidMaterial(colorToken('surface')),
  typography: { color: colorToken('textPrimary'), size: 14 },
};

export function LiveHome({
  runtime,
  platform,
  streams,
  sidebar,
  subscribeKeyDown,
  systemTheme = 'dark',
  reducedTransparency,
  onExploreDemo,
}: {
  runtime: GpuiHomeRuntime;
  platform: GpuiPlatform;
  streams?: GpuiCameraStreams;
  sidebar?: SidebarBackdrop;
  subscribeKeyDown?: (listener: (event: KeyEvent) => void) => () => void;
  systemTheme?: 'light' | 'dark';
  reducedTransparency?: boolean;
  onExploreDemo?: () => void;
}) {
  const state = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot);
  const { snapshot, preferences } = state;
  const [address, setAddress] = useState('');
  const [explicitHa, setExplicitHa] = useState(false);
  const [demoOverride, setDemoOverride] = useState(false);
  const [managingConnection, setManagingConnection] = useState(false);
  const code = useRef('');
  const [codeValue, setCodeValue] = useState('');
  const dark = (preferences.theme === 'system' ? systemTheme : preferences.theme) === 'dark';

  useEffect(() => {
    void runtime.start();
  }, [runtime]);
  const hubCameraUrl = state.sessionKind === 'haus-hub' ? state.session?.url : undefined;
  const streaming = useMemo(
    () => (streams && hubCameraUrl && !state.offline ? { streams, hub: hubCameraUrl } : undefined),
    [streams, hubCameraUrl, state.offline],
  );
  const cameraApi = useMemo(
    () =>
      hubCameraUrl ? createGpuiCameraApi(runtime.createCameraViewer, hubCameraUrl) : undefined,
    [runtime, hubCameraUrl],
  );
  useEffect(() => () => cameraApi?.clear(), [cameraApi]);
  useEffect(() => {
    code.current = '';
    setCodeValue('');
  }, [state.pairingUrl]);
  useEffect(() => {
    if (!platform.openExternal || (state.session && !managingConnection) || state.pairingUrl) {
      return;
    }
    void runtime.scan(explicitHa);
  }, [
    explicitHa,
    managingConnection,
    platform.openExternal,
    runtime,
    state.pairingUrl,
    state.session,
  ]);

  const submit = (target?: string) => {
    const rawTarget = (target ?? state.pairingUrl ?? address).trim();
    const rawCode = code.current.trim();
    if (state.busy || !(state.pairingUrl ? rawCode : rawTarget)) return;
    void runtime.connect(rawTarget, state.pairingUrl ? rawCode : undefined, explicitHa).then(() => {
      if (runtime.getSnapshot().session) setManagingConnection(false);
    });
    code.current = '';
    setCodeValue('');
  };

  const notice = (
    <>
      {state.error && (
        <Text tone="critical" role="alert">
          {state.error}
        </Text>
      )}
      {state.offline && (
        <Text tone="secondary" role="status">
          Waiting for the Hub. Controls are paused.
        </Text>
      )}
      {state.preferenceStatus === 'offline' && !state.offline && !state.busy && state.session && (
        <Text tone="secondary" role="status">
          Could not sync Home settings.
        </Text>
      )}
    </>
  );

  if (state.session && snapshot) {
    const sessionMeta: HomeSessionStatusInfo = {
      hasSession: true,
      url: state.session.url,
      kind: state.sessionKind,
      statusText: demoOverride
        ? 'Demo mode (live home paused)'
        : state.offline
          ? 'Reconnecting'
          : 'Connected',
      syncStatus: state.preferenceStatus,
    };

    if (managingConnection) {
      return (
        <HausUiProvider
          mode={dark ? 'dark' : 'light'}
          reducedTransparency={reducedTransparency}
          contentHost={GPUIX_CONTENT_HOST}
        >
          <CompactDashboard title="Manage connection">
            {notice}
            <ConnectHomePanel
              servers={state.servers}
              scanning={state.scanning}
              pending={state.busy}
              explicitHa={explicitHa}
              url={address || state.session.url}
              code={codeValue}
              pairingUrl={state.pairingUrl}
              error={state.error}
              fieldStyle={fieldStyle}
              onUrlChange={setAddress}
              onCodeChange={(value) => {
                code.current = value;
                setCodeValue(value);
              }}
              onSubmit={(target) => submit(target)}
              onToggleExplicitHa={(next) => {
                setExplicitHa(next);
                setAddress('');
                runtime.cancelPairing();
              }}
              onScan={() => void runtime.scan(explicitHa)}
              onCancelPairing={() => runtime.cancelPairing()}
              onClose={() => setManagingConnection(false)}
              cancelLabel="Back to home"
            />
          </CompactDashboard>
        </HausUiProvider>
      );
    }

    if (demoOverride) {
      return (
        <Preview
          platform={platform}
          sidebar={sidebar}
          subscribeKeyDown={subscribeKeyDown}
          systemTheme={systemTheme}
          reducedTransparency={reducedTransparency}
          sessionMeta={sessionMeta}
          onToggleDemo={(enabled) => setDemoOverride(enabled)}
          onConnect={() => setManagingConnection(true)}
          onDisconnect={() => {
            setDemoOverride(false);
            void runtime.disconnect();
          }}
        />
      );
    }

    const openExternal = platform.openExternal;
    return (
      <HomeWorkspace
        key={state.session.url}
        snapshot={snapshot}
        registry={runtime.registry}
        statistics={runtime.readStatistics}
        fetchCameraSnapshot={runtime.readCameraSnapshot}
        management={runtime.managementPort}
        system={runtime.systemPorts}
        brandIcons={runtime.brandIcons}
        onApplySceneEntities={runtime.applySceneEntities}
        alertsTransport={runtime.alertsTransport}
        platform={platform}
        subscribeKeyDown={subscribeKeyDown}
        preferences={preferences}
        systemTheme={systemTheme}
        reducedTransparency={reducedTransparency}
        sidebar={sidebar}
        streaming={streaming}
        cameraApi={cameraApi}
        disabled={state.busy || state.offline}
        canFavorite={!state.busy && !state.offline && state.preferenceStatus === 'synced'}
        sessionMeta={sessionMeta}
        notice={notice}
        onControl={(id, intent, value) => {
          if (state.busy || state.offline) return;
          if (shouldTriggerControlHaptic(intent)) platform.hapticFeedback?.('alignment');
          void runtime.controlDevice(id, intent, value);
        }}
        onFavorite={(id, favorite) => void runtime.setFavorite(id, favorite)}
        onTheme={(theme) => void runtime.setTheme(theme)}
        onGrouping={(enabled) => void runtime.setLightGrouping(enabled)}
        onPreferencesPatch={(patch) => void runtime.savePreferences(patch)}
        onResetLightGroups={() => void runtime.resetSeparatedLightGroups()}
        onToggleDemo={(enabled) => setDemoOverride(enabled)}
        onConnect={() => setManagingConnection(true)}
        onManage={
          openExternal ? (url) => void runtime.openDeviceAddress(url, openExternal) : undefined
        }
        onRefresh={() => void runtime.reconnect()}
        onDisconnect={() => void runtime.disconnect()}
      />
    );
  }

  return (
    <HausUiProvider
      mode={dark ? 'dark' : 'light'}
      reducedTransparency={reducedTransparency}
      contentHost={GPUIX_CONTENT_HOST}
    >
      <CompactDashboard
        title={
          state.session?.name ?? (explicitHa ? 'Connect Home Assistant' : 'Connect to Haus Hub')
        }
      >
        {state.session ? (
          <>
            {notice}
            <Row gapPx={8}>
              <HausButton
                id="hub-reconnect"
                variant="secondary"
                disabled={state.busy}
                onPress={() => void runtime.reconnect()}
              >
                <Text tone="primary">Refresh</Text>
              </HausButton>
              <HausButton
                id="hub-sign-out"
                variant="secondary"
                disabled={state.busy}
                onPress={() => void runtime.disconnect()}
              >
                <Text tone="primary">Sign out</Text>
              </HausButton>
            </Row>
          </>
        ) : (
          <ConnectHomePanel
            servers={state.servers}
            scanning={state.scanning}
            pending={state.busy}
            explicitHa={explicitHa}
            url={address}
            code={codeValue}
            pairingUrl={state.pairingUrl}
            error={state.error}
            fieldStyle={fieldStyle}
            onUrlChange={setAddress}
            onCodeChange={(value) => {
              code.current = value;
              setCodeValue(value);
            }}
            onSubmit={(target) => submit(target)}
            onToggleExplicitHa={(next) => {
              setExplicitHa(next);
              setAddress('');
              runtime.cancelPairing();
            }}
            onScan={() => void runtime.scan(explicitHa)}
            onCancelPairing={() => runtime.cancelPairing()}
            onClose={onExploreDemo}
          />
        )}
      </CompactDashboard>
    </HausUiProvider>
  );
}
