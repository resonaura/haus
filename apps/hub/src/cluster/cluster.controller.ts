/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Optional,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import {
  AddNodeDto,
  UpdateNodeDto,
  ClusterNodeRecordDto,
  ClusterStatusResponseDto,
} from './cluster.dto.js';

export const CLUSTER_SERVICE = 'CLUSTER_SERVICE';

export interface IClusterService {
  status(): ClusterStatusResponseDto;
  add(node: AddNodeDto): Promise<ClusterNodeRecordDto>;
  update(id: string, patch: UpdateNodeDto): Promise<ClusterNodeRecordDto>;
  remove(id: string): { removed: boolean; id: string };
}

@ApiTags('Cluster')
@ApiBearerAuth('bearer')
@Controller('api/cluster')
export class ClusterController {
  constructor(
    @Optional()
    @Inject(CLUSTER_SERVICE)
    private readonly clusterService?: IClusterService,
  ) {}

  private requireService(): IClusterService {
    if (!this.clusterService) {
      throw new HttpException(
        { error: 'cluster_service_unavailable' },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return this.clusterService;
  }

  @ApiOperation({ summary: 'Get cluster status and registered nodes' })
  @ApiResponse({
    status: 200,
    description: 'Cluster topology and nodes',
    type: ClusterStatusResponseDto,
  })
  @Get()
  status(): ClusterStatusResponseDto {
    const service = this.requireService();
    return service.status();
  }

  @ApiOperation({ summary: 'Add a new node to the cluster' })
  @ApiResponse({
    status: 201,
    description: 'Node successfully registered',
    type: ClusterNodeRecordDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid node registration data' })
  @Post('nodes')
  async addNode(@Body() body: AddNodeDto): Promise<ClusterNodeRecordDto> {
    const service = this.requireService();
    try {
      return await service.add(body);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'add_node_failed';
      throw new HttpException({ error: msg }, HttpStatus.BAD_REQUEST);
    }
  }

  @ApiOperation({ summary: 'Update cluster node configuration' })
  @ApiParam({ name: 'id', description: 'Cluster node UUID' })
  @ApiResponse({
    status: 200,
    description: 'Node configuration updated',
    type: ClusterNodeRecordDto,
  })
  @Patch('nodes/:id')
  async updateNode(
    @Param('id') id: string,
    @Body() body: UpdateNodeDto,
  ): Promise<ClusterNodeRecordDto> {
    const service = this.requireService();
    try {
      return await service.update(id, body);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'update_node_failed';
      throw new HttpException({ error: msg }, HttpStatus.BAD_REQUEST);
    }
  }

  @ApiOperation({ summary: 'Remove node from cluster' })
  @ApiParam({ name: 'id', description: 'Cluster node UUID' })
  @ApiResponse({ status: 200, description: 'Node successfully removed' })
  @HttpCode(200)
  @Post('nodes/:id/remove')
  removeNode(@Param('id') id: string): { removed: boolean; id: string } {
    const service = this.requireService();
    try {
      return service.remove(id);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'remove_node_failed';
      throw new HttpException({ error: msg }, HttpStatus.BAD_REQUEST);
    }
  }
}
