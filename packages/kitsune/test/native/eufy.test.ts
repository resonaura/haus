/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */
import { expect, it } from 'vitest';
import { EufyCameraSession } from '../../src/vendors/native/eufy/cameras.js';

const serial = 'T8410C0000000001';

class FixtureSession extends EufyCameraSession {
  readonly commands: { command: string; params: Record<string, unknown> }[] = [];

  constructor(private readonly response: Record<string, unknown>) {
    super('ws://127.0.0.1');
    this.initialState = { devices: [null, 'invalid serial', serial, serial] };
  }

  override async command(
    command: string,
    params: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    this.commands.push({ command, params });
    return command === 'device.get_properties' ? this.response : { exists: true };
  }
}

it('ignores malformed and duplicate discoveries while retaining current device properties', async () => {
  const session = new FixtureSession({
    serialNumber: serial,
    properties: {
      name: 'Side Camera',
      model: 'T8410C',
      rtspStreamUrl: 'rtsp://127.0.0.1/live',
      autoNightvision: false,
    },
  });
  expect(await session.cameras()).toMatchObject([
    {
      serial,
      name: 'Side Camera',
      model: 'T8410C',
      panTilt: true,
      operating: { nightVision: false },
    },
  ]);
  expect(session.commands).toEqual([
    { command: 'device.get_properties', params: { serialNumber: serial } },
    {
      command: 'device.has_command',
      params: { serialNumber: serial, commandName: 'devicePanAndTilt' },
    },
  ]);
});

it('refuses a property response belonging to another camera before creating controls', async () => {
  const session = new FixtureSession({
    serialNumber: 'T8410C0000000002',
    properties: { rtspStreamUrl: 'rtsp://127.0.0.1/live' },
  });
  await expect(session.cameras()).rejects.toThrow('eufy_device_identity_mismatch');
  expect(session.commands.map(({ command }) => command)).toEqual(['device.get_properties']);
});
