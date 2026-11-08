/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { describe, expect, it } from 'vitest';
import {
  generateMosquittoConfig,
  resolveMqttConnectionInfo,
  HausMqttBroker,
} from '../src/broker.js';
import { HausMqttClient } from '../src/client.js';
import type { MqttMessage } from '../src/types.js';

describe('@haus/mqtt — OS-Agnostic MQTT Broker Configuration', () => {
  it('generates secure baseline configuration without hardcoded OS paths', () => {
    const config = generateMosquittoConfig({
      port: 1883,
      allowAnonymous: false,
    });
    expect(config).toContain('listener 1883 0.0.0.0');
    expect(config).toContain('allow_anonymous false');
    expect(config).toContain('persistence true');
    expect(config).not.toContain('/var/lib');
    expect(config).not.toContain('/etc');
  });

  it('normalizes injected dataDirectory and passwordFilePath across operating systems', () => {
    const posixConfig = generateMosquittoConfig({
      dataDirectory: '/custom/storage/mqtt',
      passwordFilePath: '/custom/storage/mqtt/passwords',
    });
    expect(posixConfig).toContain('persistence_location /custom/storage/mqtt/');
    expect(posixConfig).toContain('password_file /custom/storage/mqtt/passwords');

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

describe('@haus/mqtt — HausMqttBroker In-Process Server', () => {
  it('starts an in-process MQTT broker and exchanges messages with HausMqttClient', async () => {
    const broker = new HausMqttBroker({
      port: 0,
      host: '127.0.0.1',
      allowAnonymous: true,
    });

    const { port } = await broker.listen();
    expect(port).toBeGreaterThan(0);
    expect(broker.listening).toBe(true);

    const receivedByInternalBroker: MqttMessage[] = [];
    broker.subscribe('haus/test/#', (msg) => {
      receivedByInternalBroker.push(msg);
    });

    const client = new HausMqttClient({
      host: '127.0.0.1',
      port,
      allowAnonymous: true,
    });

    await client.connect();
    expect(client.connected).toBe(true);

    const receivedByTcpClient: MqttMessage[] = [];
    await client.subscribe('haus/device/+', (msg) => {
      receivedByTcpClient.push(msg);
    });

    // 1. TCP Client publishes -> internal broker router receives it
    await client.publish({
      topic: 'haus/test/sensor',
      payload: JSON.stringify({ temp: 22.5 }),
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(receivedByInternalBroker).toHaveLength(1);
    expect(receivedByInternalBroker[0].topic).toBe('haus/test/sensor');
    expect(JSON.parse(receivedByInternalBroker[0].payload)).toEqual({ temp: 22.5 });

    // 2. Internal broker publishes -> TCP client subscriber receives it
    await broker.publish({
      topic: 'haus/device/lamp',
      payload: JSON.stringify({ state: 'ON' }),
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(receivedByTcpClient).toHaveLength(1);
    expect(receivedByTcpClient[0].topic).toBe('haus/device/lamp');
    expect(JSON.parse(receivedByTcpClient[0].payload)).toEqual({ state: 'ON' });

    await client.close();
    await broker.close();
    expect(broker.listening).toBe(false);
  });

  it('enforces authentication when allowAnonymous is false', async () => {
    const broker = new HausMqttBroker({
      port: 0,
      host: '127.0.0.1',
      allowAnonymous: false,
      username: 'haus-user',
      password: 'secret-password',
    });

    const { port } = await broker.listen();

    // 1. Connection with wrong password fails
    const badClient = new HausMqttClient({
      host: '127.0.0.1',
      port,
      allowAnonymous: false,
      username: 'haus-user',
      password: 'wrong-password',
    });

    await expect(badClient.connect()).rejects.toThrow();

    // 2. Connection with correct credentials succeeds
    const goodClient = new HausMqttClient({
      host: '127.0.0.1',
      port,
      allowAnonymous: false,
      username: 'haus-user',
      password: 'secret-password',
    });

    await goodClient.connect();
    expect(goodClient.connected).toBe(true);

    await goodClient.close();
    await broker.close();
  });
});
