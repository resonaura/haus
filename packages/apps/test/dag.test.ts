/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { describe, expect, it } from 'vitest';
import type { AppManifest } from '../src/manifest.js';
import { injectServiceConfiguration, resolveAppStartupOrder } from '../src/dag.js';

describe('App Dependency DAG & Service Sharing', () => {
  it('topologically sorts apps based on explicit dependencies and service needs', () => {
    const mqttBroker: AppManifest = {
      id: 'haus-mqtt',
      name: 'Haus MQTT Broker',
      version: '1.0.0',
      image: 'eclipse-mosquitto:2.0',
      architectures: ['amd64', 'arm64'],
      services: ['mqtt:provide'],
    };

    const zigbee2Mqtt: AppManifest = {
      id: 'zigbee2mqtt',
      name: 'Zigbee2MQTT',
      version: '1.35.0',
      image: 'koenkk/zigbee2mqtt:latest',
      architectures: ['amd64', 'arm64'],
      services: ['mqtt:need'],
    };

    const dashboard: AppManifest = {
      id: 'custom-dashboard',
      name: 'Custom Dashboard',
      version: '1.0.0',
      image: 'haus/dashboard:latest',
      architectures: ['amd64', 'arm64'],
      dependencies: ['zigbee2mqtt'],
    };

    // Pass in reverse order: dashboard, zigbee2mqtt, mqttBroker
    const resolution = resolveAppStartupOrder([dashboard, zigbee2Mqtt, mqttBroker]);

    expect(resolution.cycles).toHaveLength(0);
    expect(resolution.missingDependencies).toHaveLength(0);
    expect(resolution.orderedApps.map((a) => a.id)).toEqual([
      'haus-mqtt',
      'zigbee2mqtt',
      'custom-dashboard',
    ]);
  });

  it('detects cyclic dependencies between apps', () => {
    const appA: AppManifest = {
      id: 'app-a',
      name: 'App A',
      version: '1.0.0',
      image: 'test/a',
      architectures: ['arm64'],
      dependencies: ['app-b'],
    };

    const appB: AppManifest = {
      id: 'app-b',
      name: 'App B',
      version: '1.0.0',
      image: 'test/b',
      architectures: ['arm64'],
      dependencies: ['app-a'],
    };

    const resolution = resolveAppStartupOrder([appA, appB]);
    expect(resolution.cycles.length).toBeGreaterThan(0);
    expect(resolution.orderedApps).toHaveLength(0);
  });

  it('reports missing services or dependencies', () => {
    const app: AppManifest = {
      id: 'app-solitary',
      name: 'Solitary App',
      version: '1.0.0',
      image: 'test/solitary',
      architectures: ['arm64'],
      dependencies: ['missing-db'],
      services: ['postgres:need'],
    };

    const resolution = resolveAppStartupOrder([app]);
    expect(resolution.missingDependencies).toEqual([
      { appId: 'app-solitary', dependency: 'missing-db' },
      { appId: 'app-solitary', dependency: 'service:postgres' },
    ]);
  });

  it('injects discovered service configuration into container environment', () => {
    const z2m: AppManifest = {
      id: 'zigbee2mqtt',
      name: 'Zigbee2MQTT',
      version: '1.35.0',
      image: 'koenkk/zigbee2mqtt:latest',
      architectures: ['arm64'],
      services: ['mqtt:need'],
    };

    const env = injectServiceConfiguration(z2m, {
      mqtt: {
        host: '127.0.0.1',
        port: 1883,
        username: 'haus_z2m',
        password: 'secure_password_99',
      },
    });

    expect(env).toEqual({
      MQTT_HOST: '127.0.0.1',
      MQTT_PORT: '1883',
      MQTT_USER: 'haus_z2m',
      MQTT_PASSWORD: 'secure_password_99',
    });
  });
});
