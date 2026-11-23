/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useState } from 'react';
import {
  Box,
  corners,
  Grid,
  HausBadge,
  HausButton,
  HausCard,
  HausGlassSurface,
  insets,
  pct,
  px,
  rgba,
  Row,
  SolidMaterial,
  Stack,
  Text,
} from '@haus/ui';
import {
  Activity,
  ArrowDown,
  ArrowUp,
  ArrowUpCircle,
  Check,
  ExternalLink,
  Globe,
  Shield,
  Users,
  Wifi,
} from 'lucide-react';
import { networkDeviceIcon } from '../../components/icons/Icon';
import type { buildAction, HausAccessory } from '../../model';
import { classifyNetworkEntities } from './network/entity-matchers';
import { FirmwareUpdateCard } from './network/FirmwareUpdateCard';
import { NetworkControlsSection } from './network/NetworkControlsSection';
import { WifiQrSection } from './network/WifiQrSection';

type Action = ReturnType<typeof buildAction>;

export interface NetworkDetailsProps {
  readonly accessory: HausAccessory;
  readonly pending?: boolean;
  readonly onAction?: (action: Action) => void;
}

export function NetworkDetails({ accessory, pending = false, onAction }: NetworkDetailsProps) {
  const [openError, setOpenError] = useState<string | null>(null);
  const classified = classifyNetworkEntities(accessory);
  const {
    statusEntity,
    clientsEntity,
    guestClientsEntity,
    downloadSpeedEntity,
    uploadSpeedEntity,
    publicIpEntity,
    gatewayIpEntity,
    statusLightEntity,
    switchEntities,
    buttonEntities,
    selectEntities,
    updateEntities,
    qrImageEntities,
  } = classified;

  const primaryFirmware = updateEntities[0];
  const rawState = (statusEntity?.state ?? accessory.state.state ?? '').toLowerCase();
  const healthy = ['green', 'connected', 'online', 'on', 'active'].includes(rawState);
  const offline = ['off', 'offline', 'disconnected', 'red'].includes(rawState);
  const unavailable = ['unavailable', 'unknown'].includes(rawState);

  const rawClientsAttr = clientsEntity?.attributes.clients ?? accessory.state.attributes.clients;
  const clientNames = Array.isArray(rawClientsAttr)
    ? rawClientsAttr.filter((item): item is string => typeof item === 'string')
    : [];

  const connectedCount =
    clientsEntity && Number.isFinite(Number(clientsEntity.state))
      ? clientsEntity.state
      : typeof accessory.state.attributes.connected_clients_count === 'number'
        ? String(accessory.state.attributes.connected_clients_count)
        : clientNames.length > 0
          ? String(clientNames.length)
          : null;

  const guestCount =
    guestClientsEntity && Number.isFinite(Number(guestClientsEntity.state))
      ? guestClientsEntity.state
      : null;

  const formatSpeed = (val?: string, unit?: unknown): string | null => {
    if (!val || !Number.isFinite(Number(val))) return null;
    const num = Number(val);
    const suffix = typeof unit === 'string' && unit ? unit : 'Mbps';
    return `${num >= 100 ? Math.round(num) : num.toFixed(1)} ${suffix}`;
  };

  const downSpeed = formatSpeed(
    downloadSpeedEntity?.state,
    downloadSpeedEntity?.attributes.unit_of_measurement,
  );
  const upSpeed = formatSpeed(
    uploadSpeedEntity?.state,
    uploadSpeedEntity?.attributes.unit_of_measurement,
  );

  const ipAddress =
    (publicIpEntity && !['unavailable', 'unknown'].includes(publicIpEntity.state)
      ? publicIpEntity.state
      : null) ??
    (gatewayIpEntity && !['unavailable', 'unknown'].includes(gatewayIpEntity.state)
      ? gatewayIpEntity.state
      : null) ??
    (typeof accessory.state.attributes.public_ip === 'string'
      ? accessory.state.attributes.public_ip
      : typeof accessory.state.attributes.ip_address === 'string'
        ? accessory.state.attributes.ip_address
        : null);

  const firmwareVersion =
    (primaryFirmware && typeof primaryFirmware.attributes.installed_version === 'string'
      ? primaryFirmware.attributes.installed_version
      : null) ??
    (typeof accessory.state.attributes.sw_version === 'string'
      ? accessory.state.attributes.sw_version
      : null);

  const hasFirmwareUpdate = updateEntities.some(
    (u) =>
      u.state === 'on' ||
      (typeof u.attributes.installed_version === 'string' &&
        typeof u.attributes.latest_version === 'string' &&
        u.attributes.installed_version !== u.attributes.latest_version),
  );

  const HeroIcon = networkDeviceIcon(accessory.deviceType);
  const managementUrl = accessory.managementUrl;
  const hostLabel = (() => {
    if (!managementUrl) return undefined;
    try {
      return new URL(managementUrl).host;
    } catch {
      return managementUrl;
    }
  })();

  const openInBrowser = () => {
    if (!managementUrl) return;
    setOpenError(null);
    if (window.hausNative) {
      void window.hausNative.openExternal(managementUrl).catch((error: unknown) => {
        setOpenError(error instanceof Error ? error.message : 'Could not open URL in browser.');
      });
      return;
    }
    window.open(managementUrl, '_blank', 'noopener,noreferrer');
  };

  const statusTone = unavailable
    ? ('default' as const)
    : hasFirmwareUpdate
      ? ('warning' as const)
      : healthy
        ? ('success' as const)
        : offline
          ? ('danger' as const)
          : ('accent' as const);

  const statusText = unavailable
    ? 'No response'
    : healthy
      ? 'Connected'
      : offline
        ? 'Offline'
        : (statusEntity?.state ?? 'Ready');

  const statTileStyle = {
    layout: {
      padding: insets(10, 12),
      display: 'flex' as const,
      direction: 'column' as const,
      gap: px(3),
    },
    corners: corners(12),
    material: new SolidMaterial(rgba(128, 128, 128, 0.08)),
  };

  return (
    <Stack
      semantic="section"
      className="haus-network-details"
      gapPx={14}
      style={{ layout: { width: pct(100) } }}
    >
      <HausGlassSurface variant="liquid-glass" paddingPx={16}>
        <Row justify="between" gapPx={14} wrap>
          <Row gapPx={14}>
            <Row
              justify="center"
              style={{
                layout: { width: px(48), height: px(48) },
                corners: corners(14),
                material: new SolidMaterial(rgba(128, 128, 128, 0.12)),
              }}
            >
              <HeroIcon size={28} strokeWidth={1.45} />
            </Row>
            <Stack gapPx={3}>
              <Row gapPx={8}>
                <Text semantic="strong" size={15} weight={600}>
                  {accessory.model ?? 'Network device'}
                </Text>
                <HausBadge label={statusText} tone={statusTone} />
              </Row>
              <Row gapPx={6}>
                <Wifi size={13} />
                <Text size={12} tone="secondary">
                  {accessory.manufacturer ? `${accessory.manufacturer} · ` : ''}
                  {firmwareVersion ? `Firmware ${firmwareVersion}` : 'Mesh Network'}
                </Text>
              </Row>
            </Stack>
          </Row>

          {managementUrl && (
            <HausButton variant="primary" size="sm" onPress={openInBrowser}>
              <Row gapPx={6}>
                <ExternalLink size={14} />
                Open in Browser
              </Row>
            </HausButton>
          )}
        </Row>

        {openError && (
          <Text semantic="p" className="haus-inline-warning">
            {openError}
          </Text>
        )}

        <Grid minColumnWidthPx={135} gapPx={10} style={{ layout: { margin: { top: px(14) } } }}>
          {connectedCount !== null && (
            <Box style={statTileStyle}>
              <Row gapPx={5}>
                <Users size={13} />
                <Text size={11} tone="secondary">
                  Connected clients
                </Text>
              </Row>
              <Text semantic="strong" size={16} mono>
                {connectedCount}
                {guestCount && Number(guestCount) > 0 ? ` (+${guestCount} guest)` : ''}
              </Text>
            </Box>
          )}

          {(downSpeed || upSpeed) && (
            <Box style={statTileStyle}>
              <Row gapPx={5}>
                <Activity size={13} />
                <Text size={11} tone="secondary">
                  Throughput
                </Text>
              </Row>
              <Row gapPx={8}>
                {downSpeed && (
                  <Row gapPx={2}>
                    <ArrowDown size={12} />
                    <Text semantic="strong" size={13} mono>
                      {downSpeed}
                    </Text>
                  </Row>
                )}
                {upSpeed && (
                  <Row gapPx={2}>
                    <ArrowUp size={12} />
                    <Text semantic="strong" size={13} mono>
                      {upSpeed}
                    </Text>
                  </Row>
                )}
              </Row>
            </Box>
          )}

          {(ipAddress || hostLabel) && (
            <Box style={statTileStyle}>
              <Row gapPx={5}>
                <Globe size={13} />
                <Text size={11} tone="secondary">
                  {ipAddress ? 'WAN / Gateway IP' : 'Web interface'}
                </Text>
              </Row>
              <Text semantic="strong" size={13} mono>
                {ipAddress ?? hostLabel}
              </Text>
            </Box>
          )}

          <Box style={statTileStyle}>
            <Row gapPx={5}>
              {hasFirmwareUpdate ? <ArrowUpCircle size={13} /> : <Check size={13} />}
              <Text size={11} tone="secondary">
                {primaryFirmware ? 'Router Firmware' : 'Health'}
              </Text>
            </Row>
            <Text semantic="strong" size={13.5}>
              {hasFirmwareUpdate
                ? 'Update ready'
                : (firmwareVersion ?? (healthy ? 'Online' : offline ? 'Offline' : 'Active'))}
            </Text>
          </Box>
        </Grid>
      </HausGlassSurface>

      {updateEntities.map((fwEntity) => (
        <FirmwareUpdateCard
          key={fwEntity.entity_id}
          entity={fwEntity}
          deviceName={accessory.name}
          pending={pending}
          onAction={onAction}
        />
      ))}

      <WifiQrSection entities={qrImageEntities} accessory={accessory} />

      <NetworkControlsSection
        accessory={accessory}
        statusLightEntity={statusLightEntity}
        switchEntities={switchEntities}
        buttonEntities={buttonEntities}
        selectEntities={selectEntities}
        pending={pending}
        onAction={onAction}
      />

      {clientNames.length > 0 && (
        <HausCard
          title={`Connected Devices · ${clientNames.length}`}
          subtitle="Active wireless and wired clients on this node/profile"
          badge={{ label: `${clientNames.length} online`, tone: 'accent' }}
        >
          <Grid
            minColumnWidthPx={165}
            gapPx={6}
            style={{ layout: { maxHeight: px(210), overflowY: 'auto' } }}
          >
            {clientNames.map((clientName, index) => (
              <Row
                key={`${index}:${clientName}`}
                gapPx={6}
                style={{
                  layout: { padding: insets(6, 10), overflowX: 'hidden' },
                  corners: corners(9),
                  material: new SolidMaterial(rgba(128, 128, 128, 0.08)),
                }}
              >
                <Shield size={12} />
                <Text size={12} style={{ typography: { maxLines: 1 } }}>
                  {clientName}
                </Text>
              </Row>
            ))}
          </Grid>
        </HausCard>
      )}
    </Stack>
  );
}
