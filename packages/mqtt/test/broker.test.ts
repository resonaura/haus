/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { describe, expect, it } from 'vitest';
import { generateMosquittoConfig, resolveMqttConnectionInfo } from '../src/broker.js';

describe('@haus/mqtt — OS-Agnostic MQTT Broker Configuration', () => {
  it('generates secure baseline configuration without hardcoded OS paths', () => {
    const config = generateMosquittoConfig({
      port: 1883,
      allowAnonymous: false,
    });
    expect(config).toContain('listener 1883 0.0.0.0');
    expect(config).toContain('allow_anonymous false');
    expect(config).toContain('persistence true');
    // Ensure no hardcoded /var/lib or /etc paths exist
    expect(config).not.toContain('/var/lib');
    expect(config).not.toContain('/etc');
  });

  it('normalizes injected dataDirectory and passwordFilePath across operating systems', () => {
    // POSIX path
    const posixConfig = generateMosquittoConfig({
      dataDirectory: '/custom/storage/mqtt',
      passwordFilePath: '/custom/storage/mqtt/passwords',
    });
    expect(posixConfig).toContain('persistence_location /custom/storage/mqtt/');
    expect(posixConfig).toContain('password_file /custom/storage/mqtt/passwords');

    // Windows backslash path
    const winConfig = generateMosquittoConfig({
      dataDirectory: 'C:\\HausData\\mqtt',
      passwordFilePath: 'C:\\HausData\\mqtt\\passwords',
    });
    expect(winConfig).toContain('persistence_location C:/HausData/mqtt/');
    expect(winConfig).toContain('password_file C:/HausData/mqtt/passwords');
  });

  it('resolves connection info with defaults', () => {
    const info = resolveMqttConnectionInfo({ port: 1883 });
    expect(info.host).toBe('127.0.0.1');
    expect(info.port).toBe(1883);
    expect(info.allowAnonymous).toBe(false);
  });
});
