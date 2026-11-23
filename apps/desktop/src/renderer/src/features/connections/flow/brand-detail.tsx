/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Button } from '@heroui/react';
import { ArrowLeft, Layers, Settings2 } from 'lucide-react';
import { BrandIcon } from '../../../components/brand/BrandIcon';
import { HausGoveeGroupView, type HausGoveeEngineItem } from '../../apps/haus-govee-group';
import { formatStabilityMedal, VENDOR_GROUP_WHY_DEFAULT } from '../../apps/vendor-grouping';
import type { IntegrationCatalogItem } from './integration-grid';

export function IntegrationBrandDetail({
  selectedBrand,
  busy,
  onBack,
  onLaunchDriver,
  onStartDomain,
  onSelectEcosystemApp,
  onCombinedGoveeDone,
}: {
  selectedBrand: IntegrationCatalogItem;
  busy: boolean;
  onBack: () => void;
  onLaunchDriver: (driver: IntegrationCatalogItem) => void;
  onStartDomain: (domain: string) => void;
  onSelectEcosystemApp?: (
    appId: string,
    title: string,
    runtime: 'hacs' | 'homebridge' | 'scrypted' | 'docker',
    meta?: { readonly hacsRepositoryId?: string; readonly hacsDomain?: string },
  ) => void;
  onCombinedGoveeDone?: () => void;
}) {
  if (selectedBrand.isCombinedHausGovee) {
    const extraEngines: HausGoveeEngineItem[] = (selectedBrand.groupItems ?? [])
      .filter(
        (g) =>
          g.id !== 'govee' &&
          g.appId !== 'homebridge-govee' &&
          g.appId !== 'govee2mqtt' &&
          g.id !== 'homebridge:homebridge-govee' &&
          g.id !== 'docker:govee2mqtt',
      )
      .map((g) => ({
        id: g.appId ?? g.id,
        title: g.title,
        runtime:
          g.runtime === 'hacs'
            ? 'HACS'
            : g.runtime === 'homebridge'
              ? 'Homebridge'
              : g.runtime === 'scrypted'
                ? 'Scrypted'
                : 'Home Assistant',
        description: g.description ?? `Configure ${g.title} (${g.packageName ?? g.id}) separately.`,
        trustScore: g.trustScore ?? 85,
        stabilityTier: g.stabilityTier ?? 'silver',
        installed: g.installed,
        onConfigureSeparately: () => onLaunchDriver(g),
      }));

    return (
      <div className="integration-picker-panel">
        <div className="vendor-brand-detail-scroll">
          <HausGoveeGroupView
            admin
            extraEngines={[
              {
                id: 'homebridge-govee',
                title: 'Homebridge Govee',
                runtime: 'Homebridge',
                description:
                  'Direct LAN UDP, Bluetooth Low Energy (BLE), and AWS IoT cloud driver — ideal for Govee smart outlets and sub-devices.',
                trustScore: 96,
                stabilityTier: 'gold',
                onConfigureSeparately: () =>
                  onSelectEcosystemApp
                    ? onSelectEcosystemApp('homebridge-govee', 'Homebridge Govee', 'homebridge')
                    : onStartDomain('homebridge-govee'),
              },
              {
                id: 'govee2mqtt',
                title: 'Govee to MQTT',
                runtime: 'Docker · MQTT',
                description:
                  'High-throughput LAN, BLE, and Matter-to-MQTT bridge for Govee RGBIC lights, strips, and environmental sensors.',
                trustScore: 95,
                stabilityTier: 'gold',
                onConfigureSeparately: () =>
                  onSelectEcosystemApp
                    ? onSelectEcosystemApp('govee2mqtt', 'Govee to MQTT', 'docker')
                    : onStartDomain('govee2mqtt'),
              },
              ...extraEngines,
            ]}
            onBack={onBack}
            onCombinedSaved={() => onCombinedGoveeDone?.()}
          />
        </div>
      </div>
    );
  }

  const drivers = selectedBrand.groupItems ?? [selectedBrand];
  const topMedal = formatStabilityMedal(
    selectedBrand.stabilityTier,
    selectedBrand.trustScore,
    selectedBrand.verified,
  );

  return (
    <div className="integration-picker-panel">
      <div className="vendor-brand-detail-scroll">
        <div className="haus-govee-back-row">
          <Button variant="ghost" size="sm" onPress={onBack}>
            <ArrowLeft size={15} />
            Back to all brands
          </Button>
        </div>

        <section className="vendor-group-explainer-banner">
          <div className="vendor-group-explainer-head">
            <span className="integration-logo">
              <BrandIcon
                kind="integration"
                id={selectedBrand.iconId ?? selectedBrand.id}
                size={42}
                hint={{
                  name: selectedBrand.title,
                  ...(selectedBrand.vendorId ? { supportedBy: selectedBrand.vendorId } : {}),
                  ...(selectedBrand.repositoryUrl
                    ? { repositoryUrl: selectedBrand.repositoryUrl }
                    : {}),
                }}
              />
            </span>
            <div className="vendor-group-explainer-titles">
              <div className="vendor-group-title-row">
                <h3>{selectedBrand.title}</h3>
                <span className="vendor-group-count-pill">
                  <Layers size={12} />
                  {drivers.length} {drivers.length === 1 ? 'integration' : 'integrations'}
                </span>
                <span className={`stability-medal-pill is-${topMedal.tier}`}>{topMedal.label}</span>
              </div>
              <p>{VENDOR_GROUP_WHY_DEFAULT}</p>
            </div>
          </div>
        </section>

        <section className="vendor-group-drivers-section">
          <div className="vendor-group-drivers-head">
            <h4>Top Integrations for {selectedBrand.title}</h4>
            <span>Ranked by stability medal &amp; community trust score</span>
          </div>
          <div className="vendor-group-driver-list">
            {drivers.map((driver, index) => {
              const medal = formatStabilityMedal(
                driver.stabilityTier,
                driver.trustScore,
                driver.verified,
              );
              const runtimeLabel =
                driver.runtime === 'hacs'
                  ? 'HACS'
                  : driver.runtime === 'homebridge'
                    ? 'Homebridge'
                    : driver.runtime === 'scrypted'
                      ? 'Scrypted'
                      : driver.runtime === 'docker'
                        ? 'Docker'
                        : 'Home Assistant';
              const iconKind =
                driver.runtime === 'hacs'
                  ? 'hacs'
                  : driver.runtime === 'homebridge'
                    ? 'homebridge'
                    : driver.runtime === 'scrypted'
                      ? 'scrypted'
                      : driver.runtime === 'docker'
                        ? 'app'
                        : 'integration';
              return (
                <article key={driver.id} className="vendor-driver-card">
                  <span className="vendor-driver-rank">
                    {index === 0 ? '#1 Top' : `#${index + 1}`}
                  </span>
                  <span className="integration-logo">
                    <BrandIcon
                      kind={iconKind}
                      id={driver.iconId ?? driver.packageName ?? driver.appId ?? driver.id}
                      size={36}
                      hint={{
                        name: driver.title,
                        ...(driver.vendorId ? { supportedBy: driver.vendorId } : {}),
                        ...(driver.repositoryUrl ? { repositoryUrl: driver.repositoryUrl } : {}),
                      }}
                    />
                  </span>
                  <div className="vendor-driver-copy">
                    <div className="vendor-group-title-row">
                      <strong>{driver.title}</strong>
                      <span className={`stability-medal-pill is-${medal.tier}`}>{medal.label}</span>
                      <span className="integration-runtime-pill">{runtimeLabel}</span>
                      {driver.installed && (
                        <span className="integration-runtime-pill">Installed</span>
                      )}
                    </div>
                    <p>
                      {driver.description ??
                        `Official ${runtimeLabel} integration (${driver.packageName ?? driver.id}).`}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant={index === 0 ? 'primary' : 'secondary'}
                    isDisabled={busy}
                    onPress={() => onLaunchDriver(driver)}
                  >
                    <Settings2 size={14} />
                    {drivers.length > 1 ? 'Configure separately' : 'Set up'}
                  </Button>
                </article>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
