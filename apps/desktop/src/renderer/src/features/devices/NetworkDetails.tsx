/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useState } from 'react';
import { Button } from '@heroui/react';
import { ArrowUpCircle, Check, ExternalLink, Globe, Users, Wifi } from 'lucide-react';
import { networkDeviceIcon } from '../../components/icons/Icon';
import type { HausAccessory } from '../../model';

export function NetworkDetails({ accessory }: { accessory: HausAccessory }) {
  const [openError, setOpenError] = useState<string | null>(null);
  const entities = [accessory.state, ...accessory.secondaryEntities];
  const clients = entities.find((item) => item.entity_id.endsWith('connected_clients'));
  const firmware = entities.find((item) => item.entity_id.startsWith('update.'));
  const status =
    entities.find(
      (item) =>
        /(?:^|_)status$/.test(item.entity_id) || item.attributes.device_class === 'connectivity',
    ) ?? accessory.state;
  const healthy = ['green', 'connected', 'online', 'on'].includes(status?.state ?? '');
  const offline = status?.state === 'off' || status?.state === 'offline';
  const unavailable = ['unavailable', 'unknown'].includes(status?.state ?? accessory.state.state);
  const names = Array.isArray(clients?.attributes.clients)
    ? clients.attributes.clients.filter((item): item is string => typeof item === 'string')
    : [];
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

  return (
    <section className="haus-network-details">
      <div className="haus-network-hero">
        <HeroIcon size={40} strokeWidth={1.3} />
        <strong>{accessory.model ?? 'Network device'}</strong>
        <span>
          <Wifi size={14} />
          {unavailable
            ? 'No response'
            : healthy
              ? 'Connected'
              : offline
                ? 'Offline'
                : (status?.state ?? 'Status unavailable')}
        </span>
        {managementUrl && (
          <Button variant="primary" size="sm" onPress={openInBrowser}>
            <ExternalLink size={15} />
            Open in Browser
          </Button>
        )}
        {openError && <p className="haus-inline-warning">{openError}</p>}
      </div>
      <div className="haus-network-metrics">
        {managementUrl ? (
          <div>
            <Globe size={20} />
            <strong>{hostLabel ?? '—'}</strong>
            <span>Web interface</span>
          </div>
        ) : (
          <div>
            <Users size={20} />
            <strong>
              {clients && Number.isFinite(Number(clients.state)) ? clients.state : '—'}
            </strong>
            <span>Connected devices</span>
          </div>
        )}
        <div>
          {firmware?.state === 'on' ? <ArrowUpCircle size={20} /> : <Check size={20} />}
          <strong>
            {firmware
              ? String(firmware.attributes.installed_version ?? '—')
              : healthy
                ? 'Online'
                : offline
                  ? 'Offline'
                  : '—'}
          </strong>
          <span>
            {firmware?.state === 'on' ? 'Update available' : firmware ? 'Firmware' : 'Reachability'}
          </span>
        </div>
      </div>
      {names.length > 0 && (
        <details className="haus-network-clients">
          <summary>Connected devices · {names.length}</summary>
          <ul>
            {names.map((name, index) => (
              <li key={`${index}:${name}`}>{name}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
