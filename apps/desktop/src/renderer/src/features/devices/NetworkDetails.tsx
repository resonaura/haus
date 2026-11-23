/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useState } from 'react';
import { HausBadge, HausButton, HausCard, HausGlassSurface } from '@haus/ui';
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

  return (
    <section
      className="haus-network-details"
      style={{ display: 'flex', flexDirection: 'column', gap: '14px', width: '100%' }}
    >
      <HausGlassSurface variant="liquid-glass" paddingPx={16}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '14px',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div
              style={{
                width: '48px',
                height: '48px',
                borderRadius: '14px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'rgba(128, 128, 128, 0.12)',
              }}
            >
              <HeroIcon size={28} strokeWidth={1.45} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <strong style={{ fontSize: '15px', fontWeight: 600 }}>
                  {accessory.model ?? 'Network device'}
                </strong>
                <HausBadge label={statusText} tone={statusTone} />
              </div>
              <span
                style={{
                  fontSize: '12px',
                  opacity: 0.72,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <Wifi size={13} />
                {accessory.manufacturer ? `${accessory.manufacturer} · ` : ''}
                {firmwareVersion ? `Firmware ${firmwareVersion}` : 'Mesh Network'}
              </span>
            </div>
          </div>

          {managementUrl && (
            <HausButton variant="primary" size="sm" onPress={openInBrowser}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                <ExternalLink size={14} />
                Open in Browser
              </span>
            </HausButton>
          )}
        </div>

        {openError && <p className="haus-inline-warning">{openError}</p>}

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(135px, 1fr))',
            gap: '10px',
            marginTop: '14px',
          }}
        >
          {connectedCount !== null && (
            <div
              style={{
                padding: '10px 12px',
                borderRadius: '12px',
                background: 'rgba(128, 128, 128, 0.08)',
                display: 'flex',
                flexDirection: 'column',
                gap: '3px',
              }}
            >
              <span
                style={{
                  fontSize: '11px',
                  opacity: 0.7,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                }}
              >
                <Users size={13} /> Connected clients
              </span>
              <strong style={{ fontSize: '16px', fontVariantNumeric: 'tabular-nums' }}>
                {connectedCount}
                {guestCount && Number(guestCount) > 0 ? ` (+${guestCount} guest)` : ''}
              </strong>
            </div>
          )}

          {(downSpeed || upSpeed) && (
            <div
              style={{
                padding: '10px 12px',
                borderRadius: '12px',
                background: 'rgba(128, 128, 128, 0.08)',
                display: 'flex',
                flexDirection: 'column',
                gap: '3px',
              }}
            >
              <span
                style={{
                  fontSize: '11px',
                  opacity: 0.7,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                }}
              >
                <Activity size={13} /> Throughput
              </span>
              <strong
                style={{
                  fontSize: '13px',
                  fontVariantNumeric: 'tabular-nums',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                {downSpeed && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
                    <ArrowDown size={12} /> {downSpeed}
                  </span>
                )}
                {upSpeed && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
                    <ArrowUp size={12} /> {upSpeed}
                  </span>
                )}
              </strong>
            </div>
          )}

          {(ipAddress || hostLabel) && (
            <div
              style={{
                padding: '10px 12px',
                borderRadius: '12px',
                background: 'rgba(128, 128, 128, 0.08)',
                display: 'flex',
                flexDirection: 'column',
                gap: '3px',
              }}
            >
              <span
                style={{
                  fontSize: '11px',
                  opacity: 0.7,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                }}
              >
                <Globe size={13} /> {ipAddress ? 'WAN / Gateway IP' : 'Web interface'}
              </span>
              <strong style={{ fontSize: '13px', fontFamily: 'monospace' }}>
                {ipAddress ?? hostLabel}
              </strong>
            </div>
          )}

          <div
            style={{
              padding: '10px 12px',
              borderRadius: '12px',
              background: 'rgba(128, 128, 128, 0.08)',
              display: 'flex',
              flexDirection: 'column',
              gap: '3px',
            }}
          >
            <span
              style={{
                fontSize: '11px',
                opacity: 0.7,
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
              }}
            >
              {hasFirmwareUpdate ? <ArrowUpCircle size={13} /> : <Check size={13} />}
              {primaryFirmware ? 'Router Firmware' : 'Health'}
            </span>
            <strong style={{ fontSize: '13.5px' }}>
              {hasFirmwareUpdate
                ? 'Update ready'
                : (firmwareVersion ?? (healthy ? 'Online' : offline ? 'Offline' : 'Active'))}
            </strong>
          </div>
        </div>
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
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(165px, 1fr))',
              gap: '6px',
              maxHeight: '210px',
              overflowY: 'auto',
            }}
          >
            {clientNames.map((clientName, index) => (
              <div
                key={`${index}:${clientName}`}
                style={{
                  padding: '6px 10px',
                  borderRadius: '9px',
                  background: 'rgba(128, 128, 128, 0.08)',
                  fontSize: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                <Shield size={12} style={{ opacity: 0.65, flexShrink: 0 }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{clientName}</span>
              </div>
            ))}
          </div>
        </HausCard>
      )}
    </section>
  );
}
