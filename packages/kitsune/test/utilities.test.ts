/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { describe, it } from 'vitest';
import { HacsVirtualizer } from '../src/hacs/virtualizer.js';
import type { PythonSidecarHarness } from '../src/hacs/sidecar.js';
import type { HacsEntityPayload, HacsEntityUpdatePayload } from '../src/hacs/types.js';

class MockSidecar extends EventEmitter {
  readonly serviceCalls: Array<{
    domain: string;
    service: string;
    serviceData: Record<string, unknown>;
  }> = [];
  isStarted = false;
  async start(): Promise<void> {
    this.isStarted = true;
  }
  async stop(): Promise<void> {
    this.isStarted = false;
  }
  async setupEntry(): Promise<void> {}
  async callService(call: {
    domain: string;
    service: string;
    serviceData: Record<string, unknown>;
  }): Promise<void> {
    this.serviceCalls.push(call);
  }
  addEntity(payload: HacsEntityPayload): void {
    this.emit('entity_added', payload);
  }
  updateEntity(payload: HacsEntityUpdatePayload): void {
    this.emit('entity_updated', payload);
  }
}

function add(
  sidecar: MockSidecar,
  entityId: string,
  domain: string,
  name: string,
  state: string | number | boolean,
  attributes: Record<string, unknown> = {},
  deviceId?: string,
  areaId?: string,
) {
  sidecar.addEntity({ entityId, domain, name, state, attributes, deviceId, areaId });
}

describe('Utility & Cloud Services Acceptance (P18.6.2.8)', () => {
  it('projects Transmission client with bandwidth telemetry, storage, status, and switch actuation', async () => {
    const sidecar = new MockSidecar();
    const virtualizer = new HacsVirtualizer(sidecar as unknown as PythonSidecarHarness);
    await virtualizer.start();

    const devId = 'hacs:transmission:narnia_miku_transmission';
    add(
      sidecar,
      'switch.narnia_miku_transmission_switch',
      'switch',
      'Transmission Switch',
      'on',
      {},
      devId,
      'system',
    );
    add(
      sidecar,
      'switch.narnia_miku_transmission_turtle_mode',
      'switch',
      'Turtle Mode',
      'off',
      {},
      devId,
      'system',
    );
    add(
      sidecar,
      'sensor.narnia_miku_transmission_download_speed',
      'sensor',
      'Download Speed',
      0.0,
      { device_class: 'data_rate', unit_of_measurement: 'MB/s' },
      devId,
      'system',
    );
    add(
      sidecar,
      'sensor.narnia_miku_transmission_upload_speed',
      'sensor',
      'Upload Speed',
      0.0,
      { device_class: 'data_rate', unit_of_measurement: 'MB/s' },
      devId,
      'system',
    );
    add(
      sidecar,
      'sensor.narnia_miku_transmission_available_disk_space',
      'sensor',
      'Available Disk Space',
      142.27,
      { device_class: 'data_size', unit_of_measurement: 'GiB' },
      devId,
      'system',
    );
    add(
      sidecar,
      'sensor.narnia_miku_transmission_total_download',
      'sensor',
      'Total Download',
      3585.17,
      { device_class: 'data_size', unit_of_measurement: 'GiB' },
      devId,
      'system',
    );
    add(
      sidecar,
      'sensor.narnia_miku_transmission_active_torrents',
      'sensor',
      'Active Torrents',
      3,
      { unit_of_measurement: 'torrents' },
      devId,
      'system',
    );
    add(
      sidecar,
      'sensor.narnia_miku_transmission_status',
      'sensor',
      'Transmission Status',
      'downloading',
      {},
      devId,
      'system',
    );
    add(
      sidecar,
      'event.narnia_miku_transmission_torrent',
      'event',
      'Torrent Event',
      'torrent_added',
      { event_type: 'torrent_added' },
      devId,
      'system',
    );

    const dev = virtualizer.getDevice(devId);
    assert.ok(dev);
    assert.equal(dev.category, 'network');
    assert.equal(dev.endpoints.length, 9);

    // Verify main switch and turtle mode
    const mainSw = dev.endpoints.find((e) => e.id === 'switch.narnia_miku_transmission_switch');
    assert.ok(mainSw);
    assert.equal(mainSw.readings.on_off?.value, true);

    const turtleSw = dev.endpoints.find(
      (e) => e.id === 'switch.narnia_miku_transmission_turtle_mode',
    );
    assert.ok(turtleSw);
    assert.equal(turtleSw.readings.on_off?.value, false);

    // Verify bandwidth and storage telemetry
    const dlSpeed = dev.endpoints.find(
      (e) => e.id === 'sensor.narnia_miku_transmission_download_speed',
    );
    assert.ok(dlSpeed);
    assert.equal(dlSpeed.readings.data_rate?.value, 0.0);
    assert.equal(dlSpeed.readings.temperature, undefined);

    const diskSpace = dev.endpoints.find(
      (e) => e.id === 'sensor.narnia_miku_transmission_available_disk_space',
    );
    assert.ok(diskSpace);
    assert.equal(diskSpace.readings.data_size?.value, 142.27);

    const statusEp = dev.endpoints.find((e) => e.id === 'sensor.narnia_miku_transmission_status');
    assert.ok(statusEp);
    assert.equal(statusEp.readings.value?.value, 'downloading');

    // Actuate main switch and turtle mode
    await virtualizer.executeCommand(
      devId,
      'switch.narnia_miku_transmission_switch',
      'on_off',
      false,
    );
    assert.equal(sidecar.serviceCalls.length, 1);
    assert.deepEqual(sidecar.serviceCalls[0], {
      domain: 'switch',
      service: 'turn_off',
      serviceData: { entity_id: 'switch.narnia_miku_transmission_switch' },
    });

    await virtualizer.executeCommand(
      devId,
      'switch.narnia_miku_transmission_turtle_mode',
      'on_off',
      true,
    );
    assert.equal(sidecar.serviceCalls.length, 2);
    assert.deepEqual(sidecar.serviceCalls[1], {
      domain: 'switch',
      service: 'turn_on',
      serviceData: { entity_id: 'switch.narnia_miku_transmission_turtle_mode' },
    });

    // Update download speed dynamically
    sidecar.updateEntity({
      entityId: 'sensor.narnia_miku_transmission_download_speed',
      state: 14.8,
      attributes: { device_class: 'data_rate', unit_of_measurement: 'MB/s' },
    });
    const updatedDl = virtualizer
      .getDevice(devId)
      ?.endpoints.find((e) => e.id === 'sensor.narnia_miku_transmission_download_speed');
    assert.equal(updatedDl?.readings.data_rate?.value, 14.8);
  });

  it('projects SpeedTest diagnostics with bandwidth rates and ping latency', async () => {
    const sidecar = new MockSidecar();
    const virtualizer = new HacsVirtualizer(sidecar as unknown as PythonSidecarHarness);
    await virtualizer.start();

    const devId = 'hacs:speedtestdotnet:speedtest';
    add(
      sidecar,
      'sensor.speedtest_ping',
      'sensor',
      'Ping',
      81,
      { device_class: 'duration', unit_of_measurement: 'ms' },
      devId,
      'system',
    );
    add(
      sidecar,
      'sensor.speedtest_download',
      'sensor',
      'Download',
      211.17,
      { device_class: 'data_rate', unit_of_measurement: 'Mbit/s' },
      devId,
      'system',
    );
    add(
      sidecar,
      'sensor.speedtest_upload',
      'sensor',
      'Upload',
      34.03,
      { device_class: 'data_rate', unit_of_measurement: 'Mbit/s' },
      devId,
      'system',
    );

    const dev = virtualizer.getDevice(devId);
    assert.ok(dev);
    assert.equal(dev.category, 'network');
    assert.equal(dev.endpoints.length, 3);

    const ping = dev.endpoints.find((e) => e.id === 'sensor.speedtest_ping');
    assert.ok(ping);
    assert.equal(ping.readings.duration?.value, 81);
    assert.equal(ping.capabilities[0]?.unit, 'ms');

    const download = dev.endpoints.find((e) => e.id === 'sensor.speedtest_download');
    assert.ok(download);
    assert.equal(download.readings.data_rate?.value, 211.17);
    assert.equal(download.capabilities[0]?.unit, 'Mbit/s');

    const upload = dev.endpoints.find((e) => e.id === 'sensor.speedtest_upload');
    assert.ok(upload);
    assert.equal(upload.readings.data_rate?.value, 34.03);
  });

  it('projects OpenWeatherMap forecast, conditions, and environmental sensors', async () => {
    const sidecar = new MockSidecar();
    const virtualizer = new HacsVirtualizer(sidecar as unknown as PythonSidecarHarness);
    await virtualizer.start();

    const devId = 'hacs:openweathermap:outdoor_weather';
    add(
      sidecar,
      'weather.outdoor_weather',
      'weather',
      'Outdoor Weather',
      'cloudy',
      {
        temperature: 7.43,
        humidity: 92,
        pressure: 1017,
        wind_speed: 18.504,
        wind_bearing: 40,
        visibility: 10000,
        condition: 'cloudy',
      },
      devId,
      'outdoor',
    );
    add(
      sidecar,
      'sensor.outdoor_weather_temperature',
      'sensor',
      'Temperature',
      7.43,
      { device_class: 'temperature', unit_of_measurement: '°C' },
      devId,
      'outdoor',
    );
    add(
      sidecar,
      'sensor.outdoor_weather_humidity',
      'sensor',
      'Humidity',
      92,
      { device_class: 'humidity', unit_of_measurement: '%' },
      devId,
      'outdoor',
    );
    add(
      sidecar,
      'sensor.outdoor_weather_pressure',
      'sensor',
      'Pressure',
      1017,
      { device_class: 'pressure', unit_of_measurement: 'hPa' },
      devId,
      'outdoor',
    );
    add(
      sidecar,
      'sensor.outdoor_weather_wind_speed',
      'sensor',
      'Wind Speed',
      18.5,
      { device_class: 'wind_speed', unit_of_measurement: 'km/h' },
      devId,
      'outdoor',
    );
    add(
      sidecar,
      'sensor.outdoor_weather_summary',
      'sensor',
      'Summary',
      'broken clouds',
      {},
      devId,
      'outdoor',
    );

    const dev = virtualizer.getDevice(devId);
    assert.ok(dev);
    assert.equal(dev.category, 'environmental_sensors');
    assert.equal(dev.endpoints.length, 6);

    const weatherEp = dev.endpoints.find((e) => e.id === 'weather.outdoor_weather');
    assert.ok(weatherEp);
    assert.equal(weatherEp.readings.weather?.value, 'cloudy');
    assert.equal(weatherEp.readings.temperature?.value, 7.43);
    assert.equal(weatherEp.readings.humidity?.value, 92);
    assert.equal(weatherEp.readings.pressure?.value, 1017);
    assert.equal(weatherEp.readings.wind_speed?.value, 18.504);
    assert.equal(weatherEp.capabilities[0]?.kind, 'weather');

    const tempEp = dev.endpoints.find((e) => e.id === 'sensor.outdoor_weather_temperature');
    assert.ok(tempEp);
    assert.equal(tempEp.readings.temperature?.value, 7.43);

    const summaryEp = dev.endpoints.find((e) => e.id === 'sensor.outdoor_weather_summary');
    assert.ok(summaryEp);
    assert.equal(summaryEp.readings.value?.value, 'broken clouds');
  });

  it('projects Telegram notification bot and dispatches messages via notify service', async () => {
    const sidecar = new MockSidecar();
    const virtualizer = new HacsVirtualizer(sidecar as unknown as PythonSidecarHarness);
    await virtualizer.start();

    const devId = 'hacs:telegram_bot:levi';
    add(
      sidecar,
      'notify.telegram_bot_8228712089_1003034932068',
      'notify',
      'Laundry Notifications',
      'ready',
      {},
      devId,
      'system',
    );
    add(
      sidecar,
      'event.levi_update_event',
      'event',
      'Update Event',
      'message_received',
      { event_types: ['message_received', 'callback_query'] },
      devId,
      'system',
    );

    const dev = virtualizer.getDevice(devId);
    assert.ok(dev);
    assert.equal(dev.category, 'generic');
    assert.equal(dev.endpoints.length, 2);

    const notifyEp = dev.endpoints.find(
      (e) => e.id === 'notify.telegram_bot_8228712089_1003034932068',
    );
    assert.ok(notifyEp);
    assert.equal(notifyEp.readings.notify?.value, 'ready');

    // Dispatch message via virtualizer executeCommand
    await virtualizer.executeCommand({
      deviceId: devId,
      endpointId: 'notify.telegram_bot_8228712089_1003034932068',
      capability: 'notify',
      value: 'Washing cycle complete!',
      parameters: { message: 'Washing cycle complete!', title: 'Haus Laundry' },
    });

    assert.equal(sidecar.serviceCalls.length, 1);
    assert.deepEqual(sidecar.serviceCalls[0], {
      domain: 'notify',
      service: 'send_message',
      serviceData: {
        entity_id: 'notify.telegram_bot_8228712089_1003034932068',
        message: 'Washing cycle complete!',
        title: 'Haus Laundry',
      },
    });

    // Truthfully reject unsupported capabilities
    await assert.rejects(
      async () =>
        virtualizer.executeCommand(
          devId,
          'notify.telegram_bot_8228712089_1003034932068',
          'vacuum',
          true,
        ),
      /kitsune_unsupported_capability:vacuum/,
    );
  });
});
