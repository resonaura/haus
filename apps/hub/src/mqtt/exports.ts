/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { projectMqttEndpoint } from '@haus/mqtt';
import { AuthGuard } from '../auth/auth.guard.js';
import { appActor } from '../home/actor.js';
import { STANDALONE_HOME_SERVICE, type StandaloneHomeService } from '../home/home.service.js';
import {
  PREFERENCES_SERVICE,
  type IPreferencesService,
} from '../preferences/preferences.module.js';

function selectedIds(value: unknown): Set<string> {
  return new Set(
    Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [],
  );
}

@UseGuards(AuthGuard)
@Controller('api/mqtt/exports')
export class MqttExportsController {
  constructor(
    @Inject(STANDALONE_HOME_SERVICE)
    private readonly home: Pick<StandaloneHomeService, 'getDevice'>,
    @Inject(PREFERENCES_SERVICE) private readonly preferences: IPreferencesService,
  ) {}

  @Get(':id')
  async get(@Req() request: object, @Param('id') id: string) {
    appActor(request);
    const { eligible, deviceId } = this.resolve(id);
    const current = await this.preferences.get();
    return { eligible, enabled: selectedIds(current.value.mqttExportDevices).has(deviceId) };
  }

  @Post(':id')
  @HttpCode(200)
  async set(@Req() request: object, @Param('id') id: string, @Body() body?: { enabled?: unknown }) {
    appActor(request, true);
    const enabled = body?.enabled;
    if (typeof enabled !== 'boolean')
      throw new BadRequestException({ error: 'invalid_mqtt_export_selection' });
    const { eligible, deviceId } = this.resolve(id);
    if (enabled && !eligible) throw new BadRequestException({ error: 'device_cannot_be_exported' });
    for (let attempt = 0; attempt < 4; attempt++) {
      const current = await this.preferences.get();
      const selected = selectedIds(current.value.mqttExportDevices);
      if (selected.has(deviceId) === enabled) return { eligible, enabled };
      if (enabled) selected.add(deviceId);
      else selected.delete(deviceId);
      const next = await this.preferences.patch(current.revision, {
        mqttExportDevices: [...selected],
      });
      if (!next.conflict) return { eligible, enabled };
    }
    throw new ConflictException({ error: 'mqtt_export_selection_conflict' });
  }

  private resolve(id: string) {
    if (id.length > 512) throw new BadRequestException({ error: 'invalid_mqtt_export_device' });
    const device = this.home.getDevice(id);
    if (!device) throw new NotFoundException({ error: 'device_not_found' });
    const selectedDeviceIds = new Set([device.id]);
    const eligible = device.endpoints.some((endpoint) =>
      endpoint.capabilities.some(
        (capability) =>
          projectMqttEndpoint({
            device,
            endpointId: endpoint.id,
            capabilityId: capability.id,
            endpointState: { [capability.id]: { value: null, freshness: 'unknown' } },
            selectedDeviceIds,
            homeId: 'export-eligibility',
          }).kind === 'projected',
      ),
    );
    return { eligible, deviceId: device.id };
  }
}
