/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import type { OnboardingDiscoveredFlow } from '@haus/core/transport';
import {
  Box,
  DiscoveryRadarPanel,
  HausButton as Button,
  HausModalOverlay as Modal,
  insets,
  ManagementGlassCard,
  pct,
  Pressable,
  px,
  Row,
  Stack,
  Text,
  TextInput,
} from '@haus/ui';
import { Camera, ChevronRight, Lamp, QrCode, Search, Server, X } from 'lucide-react';
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
    const discoveredCards: OnboardingDiscoveredFlow[] = discovered.map((item) => {
      const integrationTitle = resolveDomainTitle(item.handler);
      return {
        flowId: item.flow_id,
        domain: item.handler,
        title: integrationTitle,
        label: item.context?.title_placeholders?.name || integrationTitle,
        source: item.context?.source,
        sourceLabel: formatDiscoverySourceLabel(item.context?.source),
      };
    });
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
                  <Stack gapPx={14} style={{ layout: { width: pct(100) } }}>
                    <DiscoveryRadarPanel
                      discovered={discoveredCards}
                      loading={loadingDiscovery}
                      onRescan={() => void loadDiscovery(true)}
                      onSelectDiscovered={(item) =>
                        setDirectTarget({
                          flowId: item.flowId,
                          domain: item.domain,
                          title: item.title,
                        })
                      }
                    />

                    <Row gapPx={10} wrap style={{ layout: { width: pct(100) } }}>
                      <ManagementGlassCard
                        radius={18}
                        padding={insets(12, 14)}
                        interactive
                        onPress={() => setKind('code')}
                        style={{ layout: { flexGrow: 1, flexShrink: 1, minWidth: px(200) } }}
                      >
                        <Row
                          align="center"
                          justify="between"
                          gapPx={10}
                          style={{ layout: { width: pct(100) } }}
                        >
                          <Row
                            align="center"
                            gapPx={10}
                            style={{ layout: { flexGrow: 1, minWidth: px(0) } }}
                          >
                            <Text className="setup-path-icon">
                              <QrCode size={18} />
                            </Text>
                            <Stack gapPx={2} style={{ layout: { flexGrow: 1, minWidth: px(0) } }}>
                              <Text size={13} weight={600}>
                                Set up with code
                              </Text>
                              <Text size={11.5} tone="muted">
                                Matter QR, HomeKit PIN, Improv, or Wi-Fi
                              </Text>
                            </Stack>
                          </Row>
                          <ChevronRight size={15} />
                        </Row>
                      </ManagementGlassCard>
                      <ManagementGlassCard
                        radius={18}
                        padding={insets(12, 14)}
                        interactive
                        onPress={() => setKind('camera')}
                        style={{ layout: { flexGrow: 1, flexShrink: 1, minWidth: px(200) } }}
                      >
                        <Row
                          align="center"
                          justify="between"
                          gapPx={10}
                          style={{ layout: { width: pct(100) } }}
                        >
                          <Row
                            align="center"
                            gapPx={10}
                            style={{ layout: { flexGrow: 1, minWidth: px(0) } }}
                          >
                            <Text className="setup-path-icon">
                              <Camera size={18} />
                            </Text>
                            <Stack gapPx={2} style={{ layout: { flexGrow: 1, minWidth: px(0) } }}>
                              <Text size={13} weight={600}>
                                Camera
                              </Text>
                              <Text size={11.5} tone="muted">
                                Live video, RTSP/ONVIF, Tuya, Aqara &amp; NVR
                              </Text>
                            </Stack>
                          </Row>
                          <ChevronRight size={15} />
                        </Row>
                      </ManagementGlassCard>
                      <ManagementGlassCard
                        radius={18}
                        padding={insets(12, 14)}
                        interactive
                        onPress={() => setKind('other')}
                        style={{ layout: { flexGrow: 1, flexShrink: 1, minWidth: px(200) } }}
                      >
                        <Row
                          align="center"
                          justify="between"
                          gapPx={10}
                          style={{ layout: { width: pct(100) } }}
                        >
                          <Row
                            align="center"
                            gapPx={10}
                            style={{ layout: { flexGrow: 1, minWidth: px(0) } }}
                          >
                            <Text className="setup-path-icon">
                              <Lamp size={18} />
                            </Text>
                            <Stack gapPx={2} style={{ layout: { flexGrow: 1, minWidth: px(0) } }}>
                              <Text size={13} weight={600}>
                                Browse all integrations
                              </Text>
                              <Text size={11.5} tone="muted">
                                {catalog.length > 0
                                  ? `Explore ${catalog.length.toLocaleString()} bridges, accounts & services`
                                  : 'Bridges, cloud accounts, and smart services'}
                              </Text>
                            </Stack>
                          </Row>
                          <ChevronRight size={15} />
                        </Row>
                      </ManagementGlassCard>
                    </Row>
                  </Stack>
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
