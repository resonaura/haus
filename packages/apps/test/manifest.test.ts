/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { describe, expect, it } from 'vitest';
import { type AppManifest, assessAppPermissions, validateAppManifest } from '../src/index.js';

describe('App Manifest Validation', () => {
  const validManifest: AppManifest = {
    id: 'zigbee2mqtt',
    name: 'Zigbee2MQTT',
    version: '1.35.1',
    image: 'koenkk/zigbee2mqtt:1.35.1',
    description: 'Zigbee to MQTT bridge',
    architectures: ['amd64', 'arm64'],
    health: {
      path: '/health',
      port: 8080,
      intervalSeconds: 30,
      timeoutSeconds: 5,
      retries: 3,
    },
    options: [
      { name: 'mqtt_server', type: 'string', required: true, default: 'mqtt://localhost' },
      { name: 'log_level', type: 'select', choices: ['info', 'warn', 'error', 'debug'] },
    ],
    secrets: [{ name: 'mqtt_password', required: true, description: 'MQTT broker password' }],
    ports: [{ containerPort: 8080, hostPort: 8080, protocol: 'tcp' }],
    mounts: [
      { target: 'data', containerPath: '/app/data' },
      { target: 'media', containerPath: '/app/media', readOnly: true },
    ],
    devices: [{ type: 'serial', hostPath: '/dev/ttyACM0', permissions: 'rw' }],
    network: { mode: 'bridge' },
    resources: {
      cpuLimit: 1.0,
      memoryLimitMb: 512,
      memoryReservationMb: 128,
    },
    ingress: {
      enabled: true,
      port: 8080,
      slug: 'zigbee2mqtt',
      title: 'Zigbee2MQTT Web UI',
      websocket: true,
    },
    lifecycle: {
      restartPolicy: 'unless-stopped',
      stopTimeoutSeconds: 15,
    },
  };

  it('validates a correct and comprehensive app manifest', () => {
    const result = validateAppManifest(validManifest);
    expect(result.valid).toBe(true);
    expect(result.manifest).toEqual(validManifest);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects invalid or missing mandatory manifest attributes', () => {
    expect(validateAppManifest(null).valid).toBe(false);
    expect(validateAppManifest({}).valid).toBe(false);

    // Invalid id format
    expect(validateAppManifest({ ...validManifest, id: 'Zigbee_App!' }).valid).toBe(false);

    // Missing version
    expect(validateAppManifest({ ...validManifest, version: '' }).valid).toBe(false);

    // Missing image
    expect(validateAppManifest({ ...validManifest, image: '' }).valid).toBe(false);

    // Invalid architecture
    expect(
      validateAppManifest({ ...validManifest, architectures: ['riscv64' as never] }).valid,
    ).toBe(false);

    // Invalid port number
    expect(
      validateAppManifest({
        ...validManifest,
        ports: [{ containerPort: 999999 }],
      }).valid,
    ).toBe(false);

    // Invalid mount target
    expect(
      validateAppManifest({
        ...validManifest,
        mounts: [{ target: 'root' as never, containerPath: '/mnt' }],
      }).valid,
    ).toBe(false);

    // Relative container path
    expect(
      validateAppManifest({
        ...validManifest,
        mounts: [{ target: 'data', containerPath: 'relative/path' }],
      }).valid,
    ).toBe(false);
  });
});

describe('App Permission Policy Matrix & Security Contract', () => {
  const baseApp: AppManifest = {
    id: 'simple-sensor',
    name: 'Simple Sensor',
    version: '1.0.0',
    image: 'haus/sensor:1.0',
    architectures: ['amd64', 'arm64'],
    mounts: [{ target: 'data', containerPath: '/data' }],
    network: { mode: 'bridge' },
  };

  it('permits default sandboxed app with isolated data mount without special privileges', () => {
    const assessment = assessAppPermissions(baseApp);
    expect(assessment.allowed).toBe(true);
    expect(assessment.requiredPermissions).toHaveLength(0);
    expect(assessment.missingPermissions).toHaveLength(0);
    expect(assessment.violations).toHaveLength(0);
  });

  it('denies unknown or ungranted privileges by default', () => {
    const privilegedApp: AppManifest = {
      ...baseApp,
      network: { mode: 'host' },
      mounts: [
        { target: 'data', containerPath: '/data' },
        { target: 'media', containerPath: '/media' },
        { target: 'backup', containerPath: '/backup' },
      ],
      devices: [
        { type: 'gpu', hostPath: '/dev/dri' },
        { type: 'serial', hostPath: '/dev/ttyUSB0' },
      ],
      ingress: { enabled: true, port: 8080 },
    };

    const denied = assessAppPermissions(privilegedApp, []);
    expect(denied.allowed).toBe(false);
    expect(denied.missingPermissions).toEqual([
      'mount:media',
      'mount:backup',
      'network:host',
      'device:gpu',
      'device:serial',
      'ingress',
    ]);

    // When all permissions are explicitly granted:
    const allowed = assessAppPermissions(privilegedApp, [
      'mount:media',
      'mount:backup',
      'network:host',
      'device:gpu',
      'device:serial',
      'ingress',
    ]);
    expect(allowed.allowed).toBe(true);
    expect(allowed.missingPermissions).toHaveLength(0);
  });

  it('strictly forbids Docker socket mounts and flags critical violation', () => {
    const dockerSocketApps: AppManifest[] = [
      {
        ...baseApp,
        mounts: [{ target: 'data', containerPath: '/data', hostPath: '/var/run/docker.sock' }],
      },
      {
        ...baseApp,
        mounts: [{ target: 'data', containerPath: '/var/run/docker.sock' }],
      },
    ];

    for (const app of dockerSocketApps) {
      const assessment = assessAppPermissions(app, [
        'network:host',
        'mount:media',
        'mount:share',
        'mount:backup',
        'mount:config',
      ]);
      expect(assessment.allowed).toBe(false);
      expect(assessment.violations.some((v) => v.critical && v.code.includes('DOCKER'))).toBe(true);
    }
  });

  it('strictly forbids arbitrary host filesystem root and path escapes', () => {
    const maliciousApps: AppManifest[] = [
      {
        ...baseApp,
        mounts: [{ target: 'data', containerPath: '/data', hostPath: '/' }],
      },
      {
        ...baseApp,
        mounts: [{ target: 'data', containerPath: '/data', hostPath: '/etc' }],
      },
      {
        ...baseApp,
        mounts: [{ target: 'data', containerPath: '/data', hostPath: '/var/run' }],
      },
      {
        ...baseApp,
        mounts: [{ target: 'data', containerPath: '/data', hostPath: '/mnt/../etc' }],
      },
      {
        ...baseApp,
        devices: [{ type: 'usb', hostPath: '/dev/../../etc/shadow' }],
      },
    ];

    for (const app of maliciousApps) {
      const assessment = assessAppPermissions(app);
      expect(assessment.allowed).toBe(false);
      expect(assessment.violations.length).toBeGreaterThan(0);
      expect(assessment.violations[0].critical).toBe(true);
    }
  });

  it('requires privileged port permission when exposing host ports < 1024', () => {
    const lowPortApp: AppManifest = {
      ...baseApp,
      ports: [{ containerPort: 80, hostPort: 80 }],
    };

    const denied = assessAppPermissions(lowPortApp, []);
    expect(denied.allowed).toBe(false);
    expect(denied.missingPermissions).toContain('port:privileged');

    const granted = assessAppPermissions(lowPortApp, ['port:privileged']);
    expect(granted.allowed).toBe(true);
  });
});
