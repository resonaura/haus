/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import {
  Box,
  HausButton as Button,
  HausModalOverlay as Modal,
  Heading,
  Pressable,
  Text,
  TextInput,
} from '@haus/ui';
import {
  Camera,
  ChevronRight,
  Lamp,
  QrCode,
  Radar,
  RefreshCw,
  Search,
  Server,
  X,
} from 'lucide-react';
import { BrandIcon } from '../../components/brand/BrandIcon';
import type { FlowProgress } from '../../ha/management';
import type { Snapshot } from '../../model';
import { CodeFirstCommissioningDialog } from '../commissioning';
import { CameraSetup } from './CameraSetup';
import { fetchFlowPickerBootstrap, searchEcosystemCatalogLive } from './flow/flow-helpers';
import {
  buildIntegrationCatalog,
  filterIntegrationCatalog,
  VirtualizedIntegrationGrid,
  type EcosystemCatalogSourceItem,
  type IntegrationCatalogItem,
} from './flow/integration-grid';
import { IntegrationFlow, type FlowTarget } from './IntegrationFlow';
import { formatDiscoverySourceLabel } from './system/DiscoveredPanel';

const RADAR_BLIP_COORDS = [
  { x: 74, y: 26, delay: '0s' },
  { x: 24, y: 32, delay: '0.45s' },
  { x: 78, y: 68, delay: '0.9s' },
  { x: 26, y: 74, delay: '1.35s' },
  { x: 50, y: 16, delay: '1.8s' },
  { x: 52, y: 84, delay: '2.2s' },
] as const;

export function AddDeviceFlow(props: {
  snapshot: Snapshot;
  demo: boolean;
  onClose: () => void;
  onConnect: () => void;
  onDone: () => void;
  onApps: () => void;
}) {
  const { snapshot, demo, onClose, onConnect, onDone, onApps } = props;
  const [kind, setKind] = useState<'code' | 'camera' | 'other'>();
  const [directTarget, setDirectTarget] = useState<FlowTarget | null>(null);
  const [discovered, setDiscovered] = useState<FlowProgress[]>([]);
  const [handlers, setHandlers] = useState<string[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [ecosystemApps, setEcosystemApps] = useState<readonly EcosystemCatalogSourceItem[]>([]);
  const [liveResults, setLiveResults] = useState<readonly EcosystemCatalogSourceItem[]>([]);
  const [loadingDiscovery, setLoadingDiscovery] = useState(false);
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const effectiveQuery = query.trim().length === 0 ? '' : deferredQuery;

  const loadDiscovery = useCallback(async (showSpinner = false) => {
    if (showSpinner) setLoadingDiscovery(true);
    try {
      const res = await fetchFlowPickerBootstrap();
      setHandlers(res.handlers);
      setDiscovered(res.discovered);
      setNames(res.names);
      setEcosystemApps(res.ecosystemApps);
    } catch {
      // Keep modal interactive even if catalog warmup is still in progress.
    } finally {
      if (showSpinner) setLoadingDiscovery(false);
    }
  }, []);

  useEffect(() => {
    const trimmed = effectiveQuery.trim();
    if (trimmed.length < 2) {
      setLiveResults([]);
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      void searchEcosystemCatalogLive(trimmed).then((found) => {
        if (active) setLiveResults(found);
      });
    }, 260);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [effectiveQuery]);

  useEffect(() => {
    if (demo) return;
    void loadDiscovery(true);
    const timer = setInterval(() => {
      void loadDiscovery(false);
    }, 5000);
    return () => clearInterval(timer);
  }, [demo, loadDiscovery]);

  const resolveDomainTitle = useCallback(
    (domain: string) => names[`component.${domain}.title`] ?? names[domain] ?? domain,
    [names],
  );

  const mergedEcosystemApps = useMemo(() => {
    if (liveResults.length === 0) return ecosystemApps;
    const byId = new Map<string, EcosystemCatalogSourceItem>();
    for (const item of ecosystemApps) byId.set(item.id, item);
    for (const item of liveResults) byId.set(item.id, item);
    return [...byId.values()];
  }, [ecosystemApps, liveResults]);

  const catalog = useMemo(
    () => buildIntegrationCatalog(handlers, names, mergedEcosystemApps),
    [handlers, names, mergedEcosystemApps],
  );
  const filteredCatalog = useMemo(
    () => filterIntegrationCatalog(catalog, effectiveQuery),
    [catalog, effectiveQuery],
  );

  const handleSelectIntegration = useCallback(
    (id: string, title: string, item?: IntegrationCatalogItem) => {
      setDirectTarget(item ? { brandItem: item, title } : { domain: id, title });
    },
    [],
  );

  if (!demo && directTarget) {
    return (
      <IntegrationFlow
        target={directTarget}
        initialHandlers={handlers}
        initialEcosystemApps={ecosystemApps}
        names={names}
        snapshot={snapshot}
        onClose={onClose}
        onDone={onDone}
      />
    );
  }
  if (!demo && kind === 'code')
    return <CodeFirstCommissioningDialog snapshot={snapshot} onClose={onClose} onDone={onDone} />;
  if (!demo && kind === 'camera')
    return <CameraSetup snapshot={snapshot} onClose={onClose} onDone={onDone} onApps={onApps} />;
  if (!demo && kind === 'other')
    return (
      <IntegrationFlow
        target={{}}
        initialHandlers={handlers}
        initialEcosystemApps={ecosystemApps}
        names={names}
        snapshot={snapshot}
        onClose={onClose}
        onDone={onDone}
      />
    );

  if (!demo) {
    const radarItems = discovered.slice(0, RADAR_BLIP_COORDS.length);
    const searching = effectiveQuery.trim().length > 0;
    return (
      <Modal
        isOpen
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <Modal.Backdrop variant="blur">
          <Modal.Container size="lg">
            <Modal.Dialog
              className={`haus-dialog add-device-dialog${searching ? ' is-searching' : ''}`}
            >
              <Modal.CloseTrigger />
              <Modal.Header>
                <Modal.Heading>What are we adding?</Modal.Heading>
                <Text semantic="p" className="add-device-subtitle">
                  Set up a nearby discovered device, pair with a code, or search all integrations.
                </Text>
              </Modal.Header>
              <Modal.Body className="add-device-body">
                <Box className="integration-search-bar">
                  <Text semantic="label" className="management-search integration-search-field">
                    <Search size={16} />
                    <TextInput
                      ariaLabel="Search integrations"
                      placeholder={
                        catalog.length > 0
                          ? `Search ${catalog.length.toLocaleString()} brands & integrations (Xiaomi, Hue, Govee, Matter)…`
                          : 'Search brands & integrations…'
                      }
                      value={query}
                      onChange={setQuery}
                    />
                    {query.length > 0 && (
                      <Pressable
                        className="integration-search-clear"
                        ariaLabel="Clear search"
                        onPress={() => setQuery('')}
                      >
                        <X size={14} />
                      </Pressable>
                    )}
                  </Text>
                  {catalog.length > 0 && (
                    <Text className="integration-count-badge">
                      {searching
                        ? `${filteredCatalog.length.toLocaleString()} / ${catalog.length.toLocaleString()}`
                        : catalog.length.toLocaleString()}
                    </Text>
                  )}
                </Box>

                {searching ? (
                  <VirtualizedIntegrationGrid
                    items={filteredCatalog}
                    query={effectiveQuery}
                    grouped={false}
                    loading={loadingDiscovery && catalog.length === 0}
                    onSelect={handleSelectIntegration}
                  />
                ) : (
                  <Box className="add-device-overview">
                    <Box
                      semantic="section"
                      className="add-device-radar-panel"
                      ariaLabel="Nearby discovered devices"
                    >
                      <Box className="heroui-radar-stage">
                        <Box className="heroui-radar-disc" ariaHidden={radarItems.length === 0}>
                          <Text className="heroui-radar-ring ring-outer" />
                          <Text className="heroui-radar-ring ring-mid" />
                          <Text className="heroui-radar-ring ring-inner" />
                          <Text className="heroui-radar-axis axis-h" />
                          <Text className="heroui-radar-axis axis-v" />
                          <Text className="heroui-radar-sweep" />
                          <Text className="heroui-radar-pulse pulse-1" />
                          <Text className="heroui-radar-pulse pulse-2" />
                          <Text className="heroui-radar-core">
                            <Radar size={16} />
                          </Text>
                          {radarItems.length > 0 ? (
                            radarItems.map((item, idx) => {
                              const coord = RADAR_BLIP_COORDS[idx]!;
                              const integrationTitle = resolveDomainTitle(item.handler);
                              const label =
                                item.context?.title_placeholders?.name || integrationTitle;
                              return (
                                <Pressable
                                  key={item.flow_id}
                                  className="heroui-radar-blip"
                                  surfaceTokens={{
                                    left: `${coord.x}%`,
                                    top: `${coord.y}%`,
                                    animationDelay: coord.delay,
                                  }}
                                  title={`Set up ${label}`}
                                  onPress={() =>
                                    setDirectTarget({
                                      flowId: item.flow_id,
                                      domain: item.handler,
                                      title: integrationTitle,
                                    })
                                  }
                                >
                                  <Text className="heroui-radar-blip-halo" />
                                  <Text className="integration-logo">
                                    <BrandIcon
                                      kind="integration"
                                      id={item.handler}
                                      size={28}
                                      hint={{ name: label }}
                                    />
                                  </Text>
                                  <Text className="heroui-radar-blip-label">{label}</Text>
                                </Pressable>
                              );
                            })
                          ) : (
                            <>
                              <Text className="heroui-radar-echo echo-1" />
                              <Text className="heroui-radar-echo echo-2" />
                              <Text className="heroui-radar-echo echo-3" />
                            </>
                          )}
                        </Box>
                        <Box className="heroui-radar-caption">
                          <Text className="heroui-radar-status-dot" />
                          <Text>
                            {discovered.length > 0
                              ? `${discovered.length} ${discovered.length === 1 ? 'device' : 'devices'} broadcasting nearby`
                              : 'Scanning mDNS, Matter, BLE & HomeKit…'}
                          </Text>
                        </Box>
                      </Box>

                      <Box className="add-device-discovered-pane">
                        <Box className="add-device-discovered-head">
                          <Box className="add-device-discovered-title">
                            <Heading level={3}>Discovered nearby</Heading>
                            <Text className="add-device-count-pill">{discovered.length}</Text>
                          </Box>
                          <Pressable
                            className="add-device-rescan-btn"
                            disabled={loadingDiscovery}
                            onPress={() => void loadDiscovery(true)}
                          >
                            <RefreshCw size={12} className={loadingDiscovery ? 'spin' : ''} />
                            Rescan
                          </Pressable>
                        </Box>

                        {discovered.length > 0 ? (
                          <Box className="add-device-discovered-list">
                            {discovered.map((item) => {
                              const integrationTitle = resolveDomainTitle(item.handler);
                              const label =
                                item.context?.title_placeholders?.name || integrationTitle;
                              const sourceLabel = formatDiscoverySourceLabel(item.context?.source);
                              return (
                                <Box key={item.flow_id} className="add-device-discovered-item">
                                  <Text className="integration-logo">
                                    <BrandIcon
                                      kind="integration"
                                      id={item.handler}
                                      size={36}
                                      hint={{
                                        name: label,
                                        ...(item.context?.source
                                          ? { category: item.context.source }
                                          : {}),
                                      }}
                                    />
                                  </Text>
                                  <Box className="add-device-discovered-copy">
                                    <Box className="add-device-discovered-row">
                                      <Text semantic="strong">{label}</Text>
                                      <Text className="discovered-source-pill">{sourceLabel}</Text>
                                    </Box>
                                    <Text semantic="small">{integrationTitle}</Text>
                                  </Box>
                                  <Button
                                    size="sm"
                                    onPress={() =>
                                      setDirectTarget({
                                        flowId: item.flow_id,
                                        domain: item.handler,
                                        title: integrationTitle,
                                      })
                                    }
                                  >
                                    Set up
                                  </Button>
                                </Box>
                              );
                            })}
                          </Box>
                        ) : (
                          <Box className="add-device-discovered-empty">
                            <Text semantic="strong">
                              {loadingDiscovery
                                ? 'Listening for nearby devices…'
                                : 'No unconfigured broadcasts waiting'}
                            </Text>
                            <Text semantic="p">
                              Power on any Matter, HomeKit, Bluetooth, mDNS, or MQTT device and it
                              will appear on the radar, or choose a setup method below.
                            </Text>
                          </Box>
                        )}
                      </Box>
                    </Box>

                    <Box className="add-device-paths-grid">
                      <Button
                        variant="secondary"
                        className="setup-path setup-path-card"
                        onPress={() => setKind('code')}
                      >
                        <Text className="setup-path-icon">
                          <QrCode size={18} />
                        </Text>
                        <Text className="setup-path-copy">
                          <Text semantic="strong">Set up with code</Text>
                          <Text semantic="small">Matter QR, HomeKit PIN, Improv, or Wi-Fi</Text>
                        </Text>
                        <ChevronRight size={15} className="setup-path-chevron" />
                      </Button>
                      <Button
                        variant="secondary"
                        className="setup-path setup-path-card"
                        onPress={() => setKind('camera')}
                      >
                        <Text className="setup-path-icon">
                          <Camera size={18} />
                        </Text>
                        <Text className="setup-path-copy">
                          <Text semantic="strong">Camera</Text>
                          <Text semantic="small">
                            Live video, RTSP/ONVIF, Tuya, Aqara &amp; NVR
                          </Text>
                        </Text>
                        <ChevronRight size={15} className="setup-path-chevron" />
                      </Button>
                      <Button
                        variant="secondary"
                        className="setup-path setup-path-card"
                        onPress={() => setKind('other')}
                      >
                        <Text className="setup-path-icon">
                          <Lamp size={18} />
                        </Text>
                        <Text className="setup-path-copy">
                          <Text semantic="strong">Browse all integrations</Text>
                          <Text semantic="small">
                            {catalog.length > 0
                              ? `Explore ${catalog.length.toLocaleString()} bridges, accounts & services`
                              : 'Bridges, cloud accounts, and smart services'}
                          </Text>
                        </Text>
                        <ChevronRight size={15} className="setup-path-chevron" />
                      </Button>
                    </Box>
                  </Box>
                )}
              </Modal.Body>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    );
  }

  return (
    <Modal
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Modal.Backdrop variant="blur">
        <Modal.Container>
          <Modal.Dialog className="haus-dialog">
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>Connect your home first</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <Box className="flow-prepare">
                <Server size={34} />
                <Text semantic="p">
                  Connect your Haus Hub to discover devices and complete setup in Haus.
                </Text>
              </Box>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="ghost" onPress={onClose}>
                Cancel
              </Button>
              <Button
                onPress={() => {
                  onClose();
                  onConnect();
                }}
              >
                Connect Haus Hub
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
