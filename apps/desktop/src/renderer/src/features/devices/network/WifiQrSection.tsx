/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useCallback, useEffect, useState } from 'react';
import { HausQrCard, HausSplitPane } from '@haus/ui';
import { getHomeTransport } from '../../../app/transport';
import type { HassEntity, HausAccessory } from '../../../model';
import { canonicalObjectId, friendlyEntityLabel } from './entity-matchers';

function extractImageDataUrl(res: unknown): string | null {
  if (typeof res === 'string' && res.startsWith('data:image/')) {
    return res;
  }
  if (!res || typeof res !== 'object') return null;
  const record = res as Record<string, unknown>;
  if (typeof record.dataUrl === 'string' && record.dataUrl.startsWith('data:image/')) {
    return record.dataUrl;
  }
  if (typeof record.data_base64 === 'string' && record.data_base64) {
    const mime =
      typeof record.content_type === 'string' && record.content_type
        ? record.content_type
        : 'image/png';
    return `data:${mime};base64,${record.data_base64}`;
  }
  return null;
}

function QrEntityItem({
  entity,
  accessory,
}: {
  readonly entity: HassEntity;
  readonly accessory: HausAccessory;
}) {
  const objectId = canonicalObjectId(entity);
  const label = friendlyEntityLabel(entity, accessory.name);
  const isGuest = objectId.includes('guest') || label.toLowerCase().includes('guest');

  const primarySsid =
    typeof entity.attributes.ssid === 'string' && entity.attributes.ssid
      ? entity.attributes.ssid
      : typeof accessory.state.attributes.ssid === 'string' && accessory.state.attributes.ssid
        ? accessory.state.attributes.ssid
        : accessory.name;

  const guestSsid =
    typeof entity.attributes.guest_network_name === 'string' && entity.attributes.guest_network_name
      ? entity.attributes.guest_network_name
      : typeof accessory.state.attributes.guest_network_name === 'string' &&
          accessory.state.attributes.guest_network_name
        ? accessory.state.attributes.guest_network_name
        : `${primarySsid} Guest`;

  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const loadQr = useCallback(() => {
    setLoading(true);
    void getHomeTransport()
      .request({
        type: 'haus/entity_image',
        entity_id: entity.entity_id,
      })
      .then((res: unknown) => {
        const parsed = extractImageDataUrl(res);
        if (parsed) setDataUrl(parsed);
      })
      .catch(() => {
        // Keep previous image or show unavailable placeholder
      })
      .finally(() => {
        setLoading(false);
      });
  }, [entity.entity_id]);

  useEffect(() => {
    loadQr();
  }, [loadQr, entity.state]);

  return (
    <HausQrCard
      id={entity.entity_id}
      title={isGuest ? 'Guest Network QR Code' : 'Wi-Fi Network QR Code'}
      ssid={isGuest ? guestSsid : primarySsid}
      isGuest={isGuest}
      imageDataUrl={dataUrl}
      loading={loading}
      onRefresh={loadQr}
    />
  );
}

export function WifiQrSection({
  entities,
  accessory,
}: {
  readonly entities: readonly HassEntity[];
  readonly accessory: HausAccessory;
}) {
  if (entities.length === 0) return null;

  return (
    <HausSplitPane columns="adaptive" minColumnWidthPx={260} gapPx={12}>
      {entities.map((entity) => (
        <QrEntityItem key={entity.entity_id} entity={entity} accessory={accessory} />
      ))}
    </HausSplitPane>
  );
}
