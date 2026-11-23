/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { Button, Modal } from '@heroui/react';
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

const RADAR_BLIP_COORDS: ReadonlyArray<{
  readonly x: number;
  readonly y: number;
  readonly delay: string;
}> = [
  { x: 74, y: 26, delay: '0s' },
  { x: 24, y: 32, delay: '0.45s' },
  { x: 78, y: 68, delay: '0.9s' },
  { x: 26, y: 74, delay: '1.35s' },
  { x: 50, y: 16, delay: '1.8s' },
  { x: 52, y: 84, delay: '2.2s' },
];

export function AddDeviceFlow({
  snapshot,
  demo,
  onClose,
  onConnect,
  onDone,
  onApps,
}: {
  snapshot: Snapshot;
  demo: boolean;
  onClose: () => void;
  onConnect: () => void;
  onDone: () => void;
  onApps: () => void;
}) {
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
    (_id: string, title: string, item?: IntegrationCatalogItem) => {
      if (item) {
        setDirectTarget({ brandItem: item, title });
        return;
      }
      setDirectTarget({ domain: _id, title });
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
                <p className="add-device-subtitle">
                  Set up a nearby discovered device, pair with a code, or search all integrations.
                </p>
              </Modal.Header>
              <Modal.Body className="add-device-body">
                <div className="integration-search-bar">
                  <label className="management-search integration-search-field">
                    <Search size={16} />
                    <input
                      aria-label="Search integrations"
                      placeholder={
                        catalog.length > 0
                          ? `Search ${catalog.length.toLocaleString()} brands & integrations (Xiaomi, Hue, Govee, Matter)…`
                          : 'Search brands & integrations…'
                      }
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                    {query.length > 0 && (
                      <button
                        type="button"
                        className="integration-search-clear"
                        aria-label="Clear search"
                        onClick={() => setQuery('')}
                      >
                        <X size={14} />
                      </button>
                    )}
                  </label>
                  {catalog.length > 0 && (
                    <span className="integration-count-badge">
                      {searching
                        ? `${filteredCatalog.length.toLocaleString()} / ${catalog.length.toLocaleString()}`
                        : catalog.length.toLocaleString()}
                    </span>
                  )}
                </div>

                {searching ? (
                  <VirtualizedIntegrationGrid
                    items={filteredCatalog}
                    query={effectiveQuery}
                    grouped={false}
                    loading={loadingDiscovery && catalog.length === 0}
                    onSelect={handleSelectIntegration}
                  />
                ) : (
                  <div className="add-device-overview">
                    <section
                      className="add-device-radar-panel"
                      aria-label="Nearby discovered devices"
                    >
                      <div className="heroui-radar-stage">
                        <div className="heroui-radar-disc" aria-hidden={radarItems.length === 0}>
                          <span className="heroui-radar-ring ring-outer" />
                          <span className="heroui-radar-ring ring-mid" />
                          <span className="heroui-radar-ring ring-inner" />
                          <span className="heroui-radar-axis axis-h" />
                          <span className="heroui-radar-axis axis-v" />
                          <span className="heroui-radar-sweep" />
                          <span className="heroui-radar-pulse pulse-1" />
                          <span className="heroui-radar-pulse pulse-2" />
                          <span className="heroui-radar-core">
                            <Radar size={16} />
                          </span>
                          {radarItems.length > 0 ? (
                            radarItems.map((item, idx) => {
                              const coord = RADAR_BLIP_COORDS[idx]!;
                              const integrationTitle = resolveDomainTitle(item.handler);
                              const label =
                                item.context?.title_placeholders?.name || integrationTitle;
                              return (
                                <button
                                  key={item.flow_id}
                                  type="button"
                                  className="heroui-radar-blip"
                                  style={{
                                    left: `${coord.x}%`,
                                    top: `${coord.y}%`,
                                    animationDelay: coord.delay,
                                  }}
                                  title={`Set up ${label}`}
                                  onClick={() =>
                                    setDirectTarget({
                                      flowId: item.flow_id,
                                      domain: item.handler,
                                      title: integrationTitle,
                                    })
                                  }
                                >
                                  <span className="heroui-radar-blip-halo" />
                                  <span className="integration-logo">
                                    <BrandIcon
                                      kind="integration"
                                      id={item.handler}
                                      size={28}
                                      hint={{ name: label }}
                                    />
                                  </span>
                                  <span className="heroui-radar-blip-label">{label}</span>
                                </button>
                              );
                            })
                          ) : (
                            <>
                              <span className="heroui-radar-echo echo-1" />
                              <span className="heroui-radar-echo echo-2" />
                              <span className="heroui-radar-echo echo-3" />
                            </>
                          )}
                        </div>
                        <div className="heroui-radar-caption">
                          <span className="heroui-radar-status-dot" />
                          <span>
                            {discovered.length > 0
                              ? `${discovered.length} ${discovered.length === 1 ? 'device' : 'devices'} broadcasting nearby`
                              : 'Scanning mDNS, Matter, BLE & HomeKit…'}
                          </span>
                        </div>
                      </div>

                      <div className="add-device-discovered-pane">
                        <div className="add-device-discovered-head">
                          <div className="add-device-discovered-title">
                            <h3>Discovered nearby</h3>
                            <span className="add-device-count-pill">{discovered.length}</span>
                          </div>
                          <button
                            type="button"
                            className="add-device-rescan-btn"
                            disabled={loadingDiscovery}
                            onClick={() => void loadDiscovery(true)}
                          >
                            <RefreshCw size={12} className={loadingDiscovery ? 'spin' : ''} />
                            Rescan
                          </button>
                        </div>

                        {discovered.length > 0 ? (
                          <div className="add-device-discovered-list">
                            {discovered.map((item) => {
                              const integrationTitle = resolveDomainTitle(item.handler);
                              const label =
                                item.context?.title_placeholders?.name || integrationTitle;
                              const sourceLabel = formatDiscoverySourceLabel(item.context?.source);
                              return (
                                <div key={item.flow_id} className="add-device-discovered-item">
                                  <span className="integration-logo">
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
                                  </span>
                                  <div className="add-device-discovered-copy">
                                    <div className="add-device-discovered-row">
                                      <strong>{label}</strong>
                                      <span className="discovered-source-pill">{sourceLabel}</span>
                                    </div>
                                    <small>{integrationTitle}</small>
                                  </div>
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
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="add-device-discovered-empty">
                            <strong>
                              {loadingDiscovery
                                ? 'Listening for nearby devices…'
                                : 'No unconfigured broadcasts waiting'}
                            </strong>
                            <p>
                              Power on any Matter, HomeKit, Bluetooth, mDNS, or MQTT device and it
                              will appear on the radar, or choose a setup method below.
                            </p>
                          </div>
                        )}
                      </div>
                    </section>

                    <div className="add-device-paths-grid">
                      <Button
                        variant="secondary"
                        className="setup-path setup-path-card"
                        onPress={() => setKind('code')}
                      >
                        <span className="setup-path-icon">
                          <QrCode size={18} />
                        </span>
                        <span className="setup-path-copy">
                          <strong>Set up with code</strong>
                          <small>Matter QR, HomeKit PIN, Improv, or Wi-Fi</small>
                        </span>
                        <ChevronRight size={15} className="setup-path-chevron" />
                      </Button>
                      <Button
                        variant="secondary"
                        className="setup-path setup-path-card"
                        onPress={() => setKind('camera')}
                      >
                        <span className="setup-path-icon">
                          <Camera size={18} />
                        </span>
                        <span className="setup-path-copy">
                          <strong>Camera</strong>
                          <small>Live video, RTSP/ONVIF, Tuya, Aqara &amp; NVR</small>
                        </span>
                        <ChevronRight size={15} className="setup-path-chevron" />
                      </Button>
                      <Button
                        variant="secondary"
                        className="setup-path setup-path-card"
                        onPress={() => setKind('other')}
                      >
                        <span className="setup-path-icon">
                          <Lamp size={18} />
                        </span>
                        <span className="setup-path-copy">
                          <strong>Browse all integrations</strong>
                          <small>
                            {catalog.length > 0
                              ? `Explore ${catalog.length.toLocaleString()} bridges, accounts & services`
                              : 'Bridges, cloud accounts, and smart services'}
                          </small>
                        </span>
                        <ChevronRight size={15} className="setup-path-chevron" />
                      </Button>
                    </div>
                  </div>
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
              <div className="flow-prepare">
                <Server size={34} />
                <p>Connect your Haus Hub to discover devices and complete setup in Haus.</p>
              </div>
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
