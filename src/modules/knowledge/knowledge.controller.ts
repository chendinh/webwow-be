import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Request,
  UseGuards,
  HttpCode,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { KnowledgeService } from './knowledge.service';
import { KnowledgeStatusDto } from './types/knowledge.types';

@Controller('projects/:projectId/knowledge')
export class KnowledgeController {
  constructor(private readonly knowledgeService: KnowledgeService) {}

  /**
   * POST /api/projects/:projectId/knowledge/analyze
   * Enqueues a knowledge analysis job for the project (incremental).
   * Returns HTTP 202 if accepted, 409 if already running.
   */
  @Post('analyze')
  @HttpCode(202)
  @UseGuards(JwtAuthGuard)
  async triggerAnalysis(
    @Param('projectId') projectId: string,
    @Query('organizationId') organizationId: string,
    @Request() req: any,
  ): Promise<{ message: string }> {
    await this.knowledgeService.enqueueAnalysis(projectId, organizationId, false);
    return { message: 'Phân tích kiến trúc đã được xếp hàng.' };
  }

  /**
   * POST /api/projects/:projectId/knowledge/force-analyze
   * Enqueues a full force re-analysis job for the project.
   * Returns HTTP 202 if accepted, 409 if already running.
   */
  @Post('force-analyze')
  @HttpCode(202)
  @UseGuards(JwtAuthGuard)
  async triggerForceAnalysis(
    @Param('projectId') projectId: string,
    @Query('organizationId') organizationId: string,
    @Request() req: any,
  ): Promise<{ message: string }> {
    await this.knowledgeService.enqueueAnalysis(projectId, organizationId, true);
    return { message: 'Phân tích lại toàn bộ đã được xếp hàng.' };
  }

  /**
   * GET /api/projects/:projectId/knowledge/status
   * Returns the current knowledge analysis status for the project.
   */
  @Get('status')
  @UseGuards(JwtAuthGuard)
  async getStatus(
    @Param('projectId') projectId: string,
    @Query('organizationId') organizationId: string,
  ): Promise<KnowledgeStatusDto> {
    return this.knowledgeService.getStatus(projectId, organizationId);
  }
}
