import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  UseGuards,
  BadRequestException,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import {
  SystemHealthService,
  SystemIssue,
  FailurePattern,
  IssueStats,
} from './system-health.service';

// ─── DTOs ─────────────────────────────────────────────────────────────────────

interface ResolveIssueBody {
  solution: string;
}

// ─── Controller ───────────────────────────────────────────────────────────────

@Controller('system')
@UseGuards(JwtAuthGuard)
export class SystemHealthController {
  constructor(private readonly systemHealthService: SystemHealthService) {}

  /**
   * GET /api/system/issues?organizationId=xxx&status=open&errorType=xxx&framework=xxx
   * Returns all recorded platform issues (grouped by error type).
   */
  @Get('issues')
  async getIssues(
    @Query('organizationId') organizationId: string,
    @Query('status') status?: 'open' | 'resolved',
    @Query('errorType') errorType?: string,
    @Query('framework') framework?: string,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit?: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset?: number,
  ): Promise<SystemIssue[]> {
    if (!organizationId?.trim()) {
      throw new BadRequestException('organizationId là bắt buộc.');
    }
    return this.systemHealthService.getIssues({
      organizationId,
      status,
      errorType,
      framework,
      limit,
      offset,
    });
  }

  /**
   * GET /api/system/issues/stats?organizationId=xxx
   * Returns aggregate statistics: most common errors, resolution rates, weekly totals.
   */
  @Get('issues/stats')
  async getStats(
    @Query('organizationId') organizationId: string,
  ): Promise<IssueStats> {
    if (!organizationId?.trim()) {
      throw new BadRequestException('organizationId là bắt buộc.');
    }
    return this.systemHealthService.getStats(organizationId);
  }

  /**
   * POST /api/system/issues/:id/resolve
   * Mark a system issue as resolved and record the fix as a learned pattern.
   * Body: { solution: string }
   */
  @Post('issues/:id/resolve')
  async resolveIssue(
    @Param('id') id: string,
    @Body() body: ResolveIssueBody,
  ): Promise<{ success: true; message: string }> {
    if (!id?.trim()) {
      throw new BadRequestException('Issue ID là bắt buộc.');
    }
    if (!body?.solution?.trim()) {
      throw new BadRequestException('solution là bắt buộc để đánh dấu sự cố đã giải quyết.');
    }
    await this.systemHealthService.resolveIssue(id, body.solution);
    return { success: true, message: 'Sự cố đã được đánh dấu là đã giải quyết và mẫu sửa lỗi đã được lưu.' };
  }

  /**
   * GET /api/system/patterns
   * Returns all known fix patterns that the AI has learned from past resolutions.
   */
  @Get('patterns')
  async getPatterns(): Promise<FailurePattern[]> {
    return this.systemHealthService.getPatterns();
  }
}
