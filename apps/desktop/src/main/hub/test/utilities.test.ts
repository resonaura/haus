/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { describe, expect, it } from 'vitest';
import { translateService } from '../commands';
import { buildView } from '../entities';
import { parseDevices, parseStates } from '../types';

describe('Desktop Utility & Cloud Services (P18.6.2.8)', () => {
  const devices = parseDevices({
    devices: [
      {
        id: 'narnia_miku_transmission',
        name: 'Narnia Miku Transmission',
        category: 'network',
        roomId: 'system',
        availability: 'online',
        endpoints: [
          {
            id: 'switch.narnia_miku_transmission_switch',
            name: 'Transmission Switch',
            capabilities: [
              {
                id: 'on_off',
                kind: 'binary',
                operations: ['turn_on', 'turn_off', 'set'],
              },
            ],
          },
          {
            id: 'switch.narnia_miku_transmission_turtle_mode',
            name: 'Turtle Mode',
            capabilities: [
              {
                id: 'on_off',
                kind: 'binary',
                operations: ['turn_on', 'turn_off', 'set'],
              },
            ],
          },
          {
            id: 'sensor.narnia_miku_transmission_download_speed',
            name: 'Download Speed',
            capabilities: [
              {
                id: 'data_rate',
                kind: 'numeric',
                operations: [],
                deviceClass: 'data_rate',
                unit: 'MB/s',
              },
            ],
          },
          {
            id: 'sensor.narnia_miku_transmission_available_disk_space',
            name: 'Available Disk Space',
            capabilities: [
              {
                id: 'data_size',
                kind: 'numeric',
                operations: [],
                deviceClass: 'data_size',
                unit: 'GiB',
              },
            ],
          },
          {
            id: 'sensor.narnia_miku_transmission_status',
            name: 'Status',
            capabilities: [
              {
                id: 'value',
                kind: 'string',
                operations: [],
              },
            ],
          },
        ],
      },
      {
        id: 'speedtest',
        name: 'SpeedTest',
        category: 'network',
        roomId: 'system',
        availability: 'online',
        endpoints: [
          {
            id: 'sensor.speedtest_ping',
            name: 'Ping',
            capabilities: [
              {
                id: 'duration',
                kind: 'numeric',
                operations: [],
                deviceClass: 'duration',
                unit: 'ms',
              },
            ],
          },
          {
            id: 'sensor.speedtest_download',
            name: 'Download',
            capabilities: [
              {
                id: 'data_rate',
                kind: 'numeric',
                operations: [],
                deviceClass: 'data_rate',
                unit: 'Mbit/s',
              },
            ],
          },
          {
            id: 'sensor.speedtest_upload',
            name: 'Upload',
            capabilities: [
              {
                id: 'data_rate',
                kind: 'numeric',
                operations: [],
                deviceClass: 'data_rate',
                unit: 'Mbit/s',
              },
            ],
          },
        ],
      },
      {
        id: 'outdoor_weather',
        name: 'Outdoor Weather',
        category: 'environmental_sensors',
        roomId: 'outdoor',
        availability: 'online',
        endpoints: [
          {
            id: 'weather.outdoor_weather',
            name: 'Outdoor Weather',
            capabilities: [
              {
                id: 'weather',
                kind: 'weather',
                operations: [],
              },
            ],
          },
          {
            id: 'sensor.outdoor_weather_temperature',
            name: 'Temperature',
            capabilities: [
              {
                id: 'temperature',
                kind: 'numeric',
                operations: [],
                deviceClass: 'temperature',
                unit: '°C',
              },
            ],
          },
          {
            id: 'sensor.outdoor_weather_humidity',
            name: 'Humidity',
            capabilities: [
              {
                id: 'humidity',
                kind: 'numeric',
                operations: [],
                deviceClass: 'humidity',
                unit: '%',
              },
            ],
          },
          {
            id: 'sensor.outdoor_weather_pressure',
            name: 'Pressure',
            capabilities: [
              {
                id: 'pressure',
                kind: 'numeric',
                operations: [],
                deviceClass: 'pressure',
                unit: 'hPa',
              },
            ],
          },
          {
            id: 'sensor.outdoor_weather_wind_speed',
            name: 'Wind Speed',
            capabilities: [
              {
                id: 'wind_speed',
                kind: 'numeric',
                operations: [],
                deviceClass: 'wind_speed',
                unit: 'km/h',
              },
            ],
          },
        ],
      },
      {
        id: 'levi',
        name: 'Levi',
        category: 'generic',
        roomId: 'system',
        availability: 'online',
        endpoints: [
          {
            id: 'notify.telegram_bot_8228712089_1003034932068',
            name: 'Laundry Notifications',
            capabilities: [
              {
                id: 'notify',
                kind: 'service',
                operations: ['send_message', 'notify'],
              },
            ],
          },
          {
            id: 'event.levi_update_event',
            name: 'Update Event',
            capabilities: [
              {
                id: 'event',
                kind: 'event',
                operations: [],
                choices: ['message_received', 'callback_query'],
              },
            ],
          },
        ],
      },
    ],
  });

  const states = parseStates({
    states: {
      'switch.narnia_miku_transmission_switch': {
        on_off: true,
        state: 'on',
      },
      'switch.narnia_miku_transmission_turtle_mode': {
        on_off: false,
        state: 'off',
      },
      'sensor.narnia_miku_transmission_download_speed': {
        data_rate: 12.4,
        state: 12.4,
        unit: 'MB/s',
      },
      'sensor.narnia_miku_transmission_available_disk_space': {
        data_size: 142.27,
        state: 142.27,
        unit: 'GiB',
      },
      'sensor.narnia_miku_transmission_status': {
        value: 'downloading',
        state: 'downloading',
      },
      'sensor.speedtest_ping': {
        duration: 81,
        state: 81,
        unit: 'ms',
      },
      'sensor.speedtest_download': {
        data_rate: 211.17,
        state: 211.17,
        unit: 'Mbit/s',
      },
      'sensor.speedtest_upload': {
        data_rate: 34.03,
        state: 34.03,
        unit: 'Mbit/s',
      },
      'weather.outdoor_weather': {
        weather: 'cloudy',
        condition: 'cloudy',
        temperature: 7.43,
        humidity: 92,
        pressure: 1017,
        wind_speed: 18.5,
        wind_bearing: 40,
        visibility: 10000,
        state: 'cloudy',
      },
      'sensor.outdoor_weather_temperature': {
        temperature: 7.43,
        state: 7.43,
        unit: '°C',
      },
      'sensor.outdoor_weather_humidity': {
        humidity: 92,
        state: 92,
        unit: '%',
      },
      'sensor.outdoor_weather_pressure': {
        pressure: 1017,
        state: 1017,
        unit: 'hPa',
      },
      'sensor.outdoor_weather_wind_speed': {
        wind_speed: 18.5,
        state: 18.5,
        unit: 'km/h',
      },
      'notify.telegram_bot_8228712089_1003034932068': {
        notify: 'ready',
        state: 'ready',
      },
      'event.levi_update_event': {
        event: 'message_received',
        event_type: 'message_received',
        state: 'message_received',
      },
    },
  });

  it('projects Transmission, SpeedTest, Weather, and Telegram Bot entities into CompatView', () => {
    const view = buildView(devices, states);

    // 1. Transmission switches and sensors
    const transSwitch = view.states.find((s) => s.entity_id === 'switch.narnia_miku_transmission');
    expect(transSwitch).toBeDefined();
    expect(transSwitch?.state).toBe('on');

    const turtleSwitch = view.states.find(
      (s) => s.entity_id === 'switch.narnia_miku_transmission_2',
    );
    expect(turtleSwitch).toBeDefined();
    expect(turtleSwitch?.state).toBe('off');

    const dlSensor = view.states.find((s) => s.entity_id === 'sensor.narnia_miku_transmission');
    expect(dlSensor).toBeDefined();
    expect(dlSensor?.state).toBe('12.4');
    expect(dlSensor?.attributes.device_class).toBe('data_rate');
    expect(dlSensor?.attributes.unit_of_measurement).toBe('MB/s');

    const diskSensor = view.states.find((s) => s.entity_id === 'sensor.narnia_miku_transmission_2');
    expect(diskSensor).toBeDefined();
    expect(diskSensor?.state).toBe('142.27');
    expect(diskSensor?.attributes.device_class).toBe('data_size');
    expect(diskSensor?.attributes.unit_of_measurement).toBe('GiB');

    // 2. SpeedTest sensors
    const pingSensor = view.states.find((s) => s.entity_id === 'sensor.speedtest');
    expect(pingSensor).toBeDefined();
    expect(pingSensor?.state).toBe('81');
    expect(pingSensor?.attributes.device_class).toBe('duration');
    expect(pingSensor?.attributes.unit_of_measurement).toBe('ms');

    const stDlSensor = view.states.find((s) => s.entity_id === 'sensor.speedtest_2');
    expect(stDlSensor).toBeDefined();
    expect(stDlSensor?.state).toBe('211.17');
    expect(stDlSensor?.attributes.device_class).toBe('data_rate');
    expect(stDlSensor?.attributes.unit_of_measurement).toBe('Mbit/s');

    // 3. OpenWeatherMap weather entity and environmental sensors
    const weatherEntity = view.states.find((s) => s.entity_id === 'weather.outdoor_weather');
    expect(weatherEntity).toBeDefined();
    expect(weatherEntity?.state).toBe('cloudy');
    expect(weatherEntity?.attributes.temperature).toBe(7.43);
    expect(weatherEntity?.attributes.temperature_unit).toBe('°C');
    expect(weatherEntity?.attributes.humidity).toBe(92);
    expect(weatherEntity?.attributes.pressure).toBe(1017);
    expect(weatherEntity?.attributes.wind_speed).toBe(18.5);
    expect(weatherEntity?.attributes.wind_bearing).toBe(40);
    expect(weatherEntity?.attributes.visibility).toBe(10000);

    const tempSensor = view.states.find((s) => s.entity_id === 'sensor.outdoor_weather');
    expect(tempSensor).toBeDefined();
    expect(tempSensor?.state).toBe('7.43');
    expect(tempSensor?.attributes.device_class).toBe('temperature');
    expect(tempSensor?.attributes.unit_of_measurement).toBe('°C');

    // 4. Telegram Bot notify and event entities
    const notifyEntity = view.states.find((s) => s.entity_id === 'notify.levi');
    expect(notifyEntity).toBeDefined();
    expect(notifyEntity?.state).toBe('ready');

    const eventEntity = view.states.find((s) => s.entity_id === 'event.levi');
    expect(eventEntity).toBeDefined();
    expect(eventEntity?.state).toBe('message_received');
  });

  it('translates Transmission switch and Telegram Bot notify service calls', () => {
    const view = buildView(devices, states);
    const isOn = (id: string) => view.states.find((s) => s.entity_id === id)?.state === 'on';

    // Actuate turtle mode switch
    const turtleCmds = translateService(
      view.bindings,
      {
        service: 'turn_on',
        target: { entity_id: 'switch.narnia_miku_transmission_2' },
      },
      isOn,
    );
    expect(turtleCmds).toHaveLength(1);
    expect(turtleCmds[0]).toEqual({
      deviceId: 'narnia_miku_transmission',
      endpointId: 'switch.narnia_miku_transmission_turtle_mode',
      capability: 'on_off',
      command: 'turn_on',
    });

    // Actuate notify send_message
    const notifyCmds = translateService(
      view.bindings,
      {
        service: 'send_message',
        target: { entity_id: 'notify.levi' },
        service_data: {
          message: 'Laundry finished!',
          title: 'Haus Laundry',
        },
      },
      isOn,
    );
    expect(notifyCmds).toHaveLength(1);
    expect(notifyCmds[0]).toEqual({
      deviceId: 'levi',
      endpointId: 'notify.telegram_bot_8228712089_1003034932068',
      capability: 'notify',
      command: 'send_message',
      parameters: {
        message: 'Laundry finished!',
        title: 'Haus Laundry',
      },
    });
  });
});
