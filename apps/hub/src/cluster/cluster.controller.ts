/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Optional,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard.js';
import {
  AddNodeDto,
  ClusterNodeRecordDto,
  ClusterStatusResponseDto,
  JoinClusterDto,
  JoinClusterResponseDto,
  UpdateNodeDto,
} from './cluster.dto.js';
import {
  HubTransferCommitResultDto,
  HubTransferIntentDto,
  HubTransferRollbackResultDto,
  InitiateTransferDto,
} from './transfer.dto.js';

export const CLUSTER_SERVICE = 'CLUSTER_SERVICE';

export interface IClusterService {
  status(): ClusterStatusResponseDto;
  add(node: AddNodeDto): Promise<ClusterNodeRecordDto>;
  join?(joinRequest: JoinClusterDto): Promise<JoinClusterResponseDto>;
  getNode?(id: string): Promise<ClusterNodeRecordDto>;
  update(id: string, patch: UpdateNodeDto): Promise<ClusterNodeRecordDto>;
  remove(id: string): Promise<{ removed: boolean; id: string }>;
  initiateTransfer?(dto: InitiateTransferDto): Promise<HubTransferIntentDto>;
  prepareTransfer?(
    id: string,
  ): Promise<{ transferId: string; state: 'target_prepared'; valid: boolean }>;
  fenceTransfer?(
    id: string,
  ): Promise<{ transferId: string; state: 'source_fenced'; fenced: boolean; epoch: number }>;
  commitTransfer?(id: string): Promise<HubTransferCommitResultDto>;
  rollbackTransfer?(id: string, reason?: string): Promise<HubTransferRollbackResultDto>;
  getTransfer?(id: string): Promise<HubTransferIntentDto>;
  listTransfers?(): Promise<HubTransferIntentDto[]>;
}

@ApiTags('Cluster')
@ApiBearerAuth('bearer')
@UseGuards(AuthGuard)
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
      if (err instanceof HttpException) throw err;
      const msg = err instanceof Error ? err.message : 'add_node_failed';
      throw new HttpException({ error: msg }, HttpStatus.BAD_REQUEST);
    }
  }

  @ApiOperation({ summary: 'Join secondary Hub into existing home cluster' })
  @ApiResponse({
    status: 201,
    description: 'Secondary Hub joined successfully',
    type: JoinClusterResponseDto,
  })
  @Post('join')
  async join(@Body() body: JoinClusterDto): Promise<JoinClusterResponseDto> {
    const service = this.requireService();
    if (!service.join)
      throw new HttpException({ error: 'not_implemented' }, HttpStatus.NOT_IMPLEMENTED);
    try {
      return await service.join(body);
    } catch (err: unknown) {
      if (err instanceof HttpException) throw err;
      const msg = err instanceof Error ? err.message : 'join_cluster_failed';
      throw new HttpException({ error: msg }, HttpStatus.BAD_REQUEST);
    }
  }

  @ApiOperation({ summary: 'Get cluster node details' })
  @ApiParam({ name: 'id', description: 'Cluster node UUID' })
  @ApiResponse({ status: 200, description: 'Node details', type: ClusterNodeRecordDto })
  @Get('nodes/:id')
  async getNode(@Param('id') id: string): Promise<ClusterNodeRecordDto> {
    const service = this.requireService();
    if (!service.getNode)
      throw new HttpException({ error: 'not_implemented' }, HttpStatus.NOT_IMPLEMENTED);
    return service.getNode(id);
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
  async removeNode(@Param('id') id: string): Promise<{ removed: boolean; id: string }> {
    const service = this.requireService();
    try {
      return await service.remove(id);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'remove_node_failed';
      throw new HttpException({ error: msg }, HttpStatus.BAD_REQUEST);
    }
  }

  @ApiOperation({ summary: 'Initiate Hub-to-Hub coordinator transfer' })
  @ApiResponse({ status: 201, description: 'Transfer initiated', type: HubTransferIntentDto })
  @Post('transfer/initiate')
  async initiateTransfer(@Body() body: InitiateTransferDto): Promise<HubTransferIntentDto> {
    const service = this.requireService();
    if (!service.initiateTransfer)
      throw new HttpException({ error: 'not_implemented' }, HttpStatus.NOT_IMPLEMENTED);
    return service.initiateTransfer(body);
  }

  @ApiOperation({ summary: 'Prepare / stage transfer on target' })
  @ApiParam({ name: 'id', description: 'Transfer ID' })
  @ApiResponse({ status: 200, description: 'Target prepared and validated' })
  @HttpCode(200)
  @Post('transfer/:id/prepare')
  async prepareTransfer(
    @Param('id') id: string,
  ): Promise<{ transferId: string; state: 'target_prepared'; valid: boolean }> {
    const service = this.requireService();
    if (!service.prepareTransfer)
      throw new HttpException({ error: 'not_implemented' }, HttpStatus.NOT_IMPLEMENTED);
    return service.prepareTransfer(id);
  }

  @ApiOperation({ summary: 'Fence source coordinator during Hub transfer' })
  @ApiParam({ name: 'id', description: 'Transfer ID' })
  @ApiResponse({ status: 200, description: 'Source fenced' })
  @HttpCode(200)
  @Post('transfer/:id/fence')
  async fenceTransfer(
    @Param('id') id: string,
  ): Promise<{ transferId: string; state: 'source_fenced'; fenced: boolean; epoch: number }> {
    const service = this.requireService();
    if (!service.fenceTransfer)
      throw new HttpException({ error: 'not_implemented' }, HttpStatus.NOT_IMPLEMENTED);
    return service.fenceTransfer(id);
  }

  @ApiOperation({ summary: 'Commit Hub transfer and activate target coordinator' })
  @ApiParam({ name: 'id', description: 'Transfer ID' })
  @ApiResponse({ status: 200, description: 'Transfer committed', type: HubTransferCommitResultDto })
  @HttpCode(200)
  @Post('transfer/:id/commit')
  async commitTransfer(@Param('id') id: string): Promise<HubTransferCommitResultDto> {
    const service = this.requireService();
    if (!service.commitTransfer)
      throw new HttpException({ error: 'not_implemented' }, HttpStatus.NOT_IMPLEMENTED);
    return service.commitTransfer(id);
  }

  @ApiOperation({ summary: 'Rollback Hub transfer and restore coordinator' })
  @ApiParam({ name: 'id', description: 'Transfer ID' })
  @ApiResponse({
    status: 200,
    description: 'Transfer rolled back',
    type: HubTransferRollbackResultDto,
  })
  @HttpCode(200)
  @Post('transfer/:id/rollback')
  async rollbackTransfer(
    @Param('id') id: string,
    @Body() body: { reason?: string },
  ): Promise<HubTransferRollbackResultDto> {
    const service = this.requireService();
    if (!service.rollbackTransfer)
      throw new HttpException({ error: 'not_implemented' }, HttpStatus.NOT_IMPLEMENTED);
    return service.rollbackTransfer(id, body?.reason);
  }

  @ApiOperation({ summary: 'Get transfer intent and progress' })
  @ApiParam({ name: 'id', description: 'Transfer ID' })
  @ApiResponse({ status: 200, description: 'Transfer details', type: HubTransferIntentDto })
  @Get('transfer/:id')
  async getTransfer(@Param('id') id: string): Promise<HubTransferIntentDto> {
    const service = this.requireService();
    if (!service.getTransfer)
      throw new HttpException({ error: 'not_implemented' }, HttpStatus.NOT_IMPLEMENTED);
    return service.getTransfer(id);
  }

  @ApiOperation({ summary: 'List all transfer intents' })
  @ApiResponse({ status: 200, description: 'List of transfers', type: [HubTransferIntentDto] })
  @Get('transfers')
  async listTransfers(): Promise<HubTransferIntentDto[]> {
    const service = this.requireService();
    if (!service.listTransfers)
      throw new HttpException({ error: 'not_implemented' }, HttpStatus.NOT_IMPLEMENTED);
    return service.listTransfers();
  }
}
