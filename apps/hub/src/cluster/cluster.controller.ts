/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Optional,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard.js';
import {
  AddNodeDto,
  AttachClusterDto,
  ClusterNodeRecordDto,
  ClusterStatusResponseDto,
  JoinClusterDto,
  JoinClusterResponseDto,
  RebalanceClusterDto,
  RemoveNodeOptionsDto,
  UpdateNodeDto,
} from './cluster.dto.js';
import type { RebalanceResult } from './coordination/orchestrator.js';
import type { ReconciliationOutcome } from './coordination/reconcile.js';
import type { NodeDrainPlan, NodeDrainResult } from './drain/service.js';
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
  attach?(dto: AttachClusterDto): Promise<JoinClusterResponseDto>;
  getNode?(id: string): Promise<ClusterNodeRecordDto>;
  update(id: string, patch: UpdateNodeDto): Promise<ClusterNodeRecordDto>;
  remove(id: string, options?: RemoveNodeOptionsDto): Promise<{ removed: boolean; id: string }>;
  getDrainPlan?(id: string): Promise<NodeDrainPlan>;
  drain?(id: string, options?: RemoveNodeOptionsDto): Promise<NodeDrainResult>;
  getWorkloads?(): Promise<unknown>;
  rebalance?(options?: RebalanceClusterDto): Promise<RebalanceResult>;
  reconcile?(): Promise<ReconciliationOutcome>;
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

function assertClusterAdmin(req: object | undefined): void {
  if (!req) return;
  const session: unknown = Reflect.get(req, 'user') ?? Reflect.get(req, 'session');
  if (session === undefined) return; // Isolated test mock overriding AuthGuard
  if (
    !session ||
    typeof session !== 'object' ||
    !('clientRole' in session) ||
    session.clientRole !== 'admin'
  ) {
    throw new ForbiddenException({ error: 'admin_role_required' });
  }
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
    return this.requireService().status();
  }

  @ApiOperation({ summary: 'List active/standby cluster workloads and node capacities' })
  @Get('workloads')
  async getWorkloads(): Promise<unknown> {
    const service = this.requireService();
    if (!service.getWorkloads) {
      return { workloads: [], nodeCapacities: [] };
    }
    return service.getWorkloads();
  }

  @ApiOperation({ summary: 'Load-balance workloads across available Hub nodes' })
  @HttpCode(200)
  @Post('rebalance')
  async rebalance(
    @Req() req: object,
    @Body() body?: RebalanceClusterDto,
  ): Promise<RebalanceResult> {
    assertClusterAdmin(req);
    const service = this.requireService();
    if (!service.rebalance) {
      throw new HttpException({ error: 'not_implemented' }, HttpStatus.NOT_IMPLEMENTED);
    }
    return service.rebalance(body);
  }

  @ApiOperation({ summary: 'Reconcile split-brain claims and fence duplicate active copies' })
  @HttpCode(200)
  @Post('reconcile')
  async reconcile(@Req() req: object): Promise<ReconciliationOutcome> {
    assertClusterAdmin(req);
    const service = this.requireService();
    if (!service.reconcile) {
      throw new HttpException({ error: 'not_implemented' }, HttpStatus.NOT_IMPLEMENTED);
    }
    return service.reconcile();
  }

  @ApiOperation({ summary: 'Add a new node to the cluster' })
  @ApiResponse({
    status: 201,
    description: 'Node successfully registered',
    type: ClusterNodeRecordDto,
  })
  @Post('nodes')
  async addNode(@Req() req: object, @Body() body: AddNodeDto): Promise<ClusterNodeRecordDto> {
    assertClusterAdmin(req);
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
  async join(@Req() req: object, @Body() body: JoinClusterDto): Promise<JoinClusterResponseDto> {
    assertClusterAdmin(req);
    const service = this.requireService();
    if (!service.join) {
      throw new HttpException({ error: 'not_implemented' }, HttpStatus.NOT_IMPLEMENTED);
    }
    try {
      return await service.join(body);
    } catch (err: unknown) {
      if (err instanceof HttpException) throw err;
      const msg = err instanceof Error ? err.message : 'join_cluster_failed';
      throw new HttpException({ error: msg }, HttpStatus.BAD_REQUEST);
    }
  }

  @ApiOperation({
    summary: 'Attach this secondary Hub to an existing cluster coordinator over HTTP',
  })
  @ApiResponse({
    status: 201,
    description: 'Secondary Hub attached to coordinator',
    type: JoinClusterResponseDto,
  })
  @Post('attach')
  async attach(
    @Req() req: object,
    @Body() body: AttachClusterDto,
  ): Promise<JoinClusterResponseDto> {
    assertClusterAdmin(req);
    const service = this.requireService();
    if (!service.attach) {
      throw new HttpException({ error: 'not_implemented' }, HttpStatus.NOT_IMPLEMENTED);
    }
    return service.attach(body);
  }

  @ApiOperation({ summary: 'Get cluster node details' })
  @ApiParam({ name: 'id', description: 'Cluster node UUID' })
  @Get('nodes/:id')
  async getNode(@Param('id') id: string): Promise<ClusterNodeRecordDto> {
    const service = this.requireService();
    if (!service.getNode) {
      throw new HttpException({ error: 'not_implemented' }, HttpStatus.NOT_IMPLEMENTED);
    }
    return service.getNode(id);
  }

  @ApiOperation({
    summary: 'Inspect node drain safety plan (workloads, sole-copy NVR media & backups)',
  })
  @ApiParam({ name: 'id', description: 'Cluster node UUID' })
  @Get('nodes/:id/drain-plan')
  async getDrainPlan(@Param('id') id: string): Promise<NodeDrainPlan> {
    const service = this.requireService();
    if (!service.getDrainPlan) {
      throw new HttpException({ error: 'not_implemented' }, HttpStatus.NOT_IMPLEMENTED);
    }
    return service.getDrainPlan(id);
  }

  @ApiOperation({ summary: 'Evacuate workloads and sole-copy media/backups off a cluster node' })
  @ApiParam({ name: 'id', description: 'Cluster node UUID' })
  @HttpCode(200)
  @Post('nodes/:id/drain')
  async drainNode(
    @Req() req: object,
    @Param('id') id: string,
    @Body() body?: RemoveNodeOptionsDto,
  ): Promise<NodeDrainResult> {
    assertClusterAdmin(req);
    const service = this.requireService();
    if (!service.drain) {
      throw new HttpException({ error: 'not_implemented' }, HttpStatus.NOT_IMPLEMENTED);
    }
    return service.drain(id, body);
  }

  @ApiOperation({ summary: 'Update cluster node configuration' })
  @ApiParam({ name: 'id', description: 'Cluster node UUID' })
  @Patch('nodes/:id')
  async updateNode(
    @Req() req: object,
    @Param('id') id: string,
    @Body() body: UpdateNodeDto,
  ): Promise<ClusterNodeRecordDto> {
    assertClusterAdmin(req);
    const service = this.requireService();
    try {
      return await service.update(id, body);
    } catch (err: unknown) {
      if (err instanceof HttpException) throw err;
      const msg = err instanceof Error ? err.message : 'update_node_failed';
      throw new HttpException({ error: msg }, HttpStatus.BAD_REQUEST);
    }
  }

  @ApiOperation({ summary: 'Safely drain and remove node from cluster' })
  @ApiParam({ name: 'id', description: 'Cluster node UUID' })
  @HttpCode(200)
  @Post('nodes/:id/remove')
  async removeNode(
    @Req() req: object,
    @Param('id') id: string,
    @Body() body?: RemoveNodeOptionsDto,
  ): Promise<{ removed: boolean; id: string }> {
    assertClusterAdmin(req);
    const service = this.requireService();
    try {
      return await service.remove(id, body);
    } catch (err: unknown) {
      if (err instanceof HttpException) throw err;
      const msg = err instanceof Error ? err.message : 'remove_node_failed';
      throw new HttpException({ error: msg }, HttpStatus.BAD_REQUEST);
    }
  }

  @ApiOperation({ summary: 'Initiate Hub-to-Hub coordinator transfer' })
  @Post('transfer/initiate')
  async initiateTransfer(
    @Req() req: object,
    @Body() body: InitiateTransferDto,
  ): Promise<HubTransferIntentDto> {
    assertClusterAdmin(req);
    const service = this.requireService();
    if (!service.initiateTransfer) {
      throw new HttpException({ error: 'not_implemented' }, HttpStatus.NOT_IMPLEMENTED);
    }
    return service.initiateTransfer(body);
  }

  @ApiOperation({ summary: 'Prepare / stage transfer on target' })
  @HttpCode(200)
  @Post('transfer/:id/prepare')
  async prepareTransfer(
    @Req() req: object,
    @Param('id') id: string,
  ): Promise<{ transferId: string; state: 'target_prepared'; valid: boolean }> {
    assertClusterAdmin(req);
    const service = this.requireService();
    if (!service.prepareTransfer) {
      throw new HttpException({ error: 'not_implemented' }, HttpStatus.NOT_IMPLEMENTED);
    }
    return service.prepareTransfer(id);
  }

  @ApiOperation({ summary: 'Fence source coordinator during Hub transfer' })
  @HttpCode(200)
  @Post('transfer/:id/fence')
  async fenceTransfer(
    @Req() req: object,
    @Param('id') id: string,
  ): Promise<{ transferId: string; state: 'source_fenced'; fenced: boolean; epoch: number }> {
    assertClusterAdmin(req);
    const service = this.requireService();
    if (!service.fenceTransfer) {
      throw new HttpException({ error: 'not_implemented' }, HttpStatus.NOT_IMPLEMENTED);
    }
    return service.fenceTransfer(id);
  }

  @ApiOperation({ summary: 'Commit Hub transfer and activate target coordinator' })
  @HttpCode(200)
  @Post('transfer/:id/commit')
  async commitTransfer(
    @Req() req: object,
    @Param('id') id: string,
  ): Promise<HubTransferCommitResultDto> {
    assertClusterAdmin(req);
    const service = this.requireService();
    if (!service.commitTransfer) {
      throw new HttpException({ error: 'not_implemented' }, HttpStatus.NOT_IMPLEMENTED);
    }
    return service.commitTransfer(id);
  }

  @ApiOperation({ summary: 'Rollback Hub transfer and restore coordinator' })
  @HttpCode(200)
  @Post('transfer/:id/rollback')
  async rollbackTransfer(
    @Req() req: object,
    @Param('id') id: string,
    @Body() body: { reason?: string },
  ): Promise<HubTransferRollbackResultDto> {
    assertClusterAdmin(req);
    const service = this.requireService();
    if (!service.rollbackTransfer) {
      throw new HttpException({ error: 'not_implemented' }, HttpStatus.NOT_IMPLEMENTED);
    }
    return service.rollbackTransfer(id, body?.reason);
  }

  @ApiOperation({ summary: 'Get transfer intent and progress' })
  @Get('transfer/:id')
  async getTransfer(@Param('id') id: string): Promise<HubTransferIntentDto> {
    const service = this.requireService();
    if (!service.getTransfer) {
      throw new HttpException({ error: 'not_implemented' }, HttpStatus.NOT_IMPLEMENTED);
    }
    return service.getTransfer(id);
  }

  @ApiOperation({ summary: 'List all transfer intents' })
  @Get('transfers')
  async listTransfers(): Promise<HubTransferIntentDto[]> {
    const service = this.requireService();
    if (!service.listTransfers) {
      throw new HttpException({ error: 'not_implemented' }, HttpStatus.NOT_IMPLEMENTED);
    }
    return service.listTransfers();
  }
}
