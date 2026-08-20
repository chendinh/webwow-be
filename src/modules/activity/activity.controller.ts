import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  ParseIntPipe,
  DefaultValuePipe,
  BadRequestException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ActivityService } from './activity.service';
import { ActivityLog } from '@prisma/client';

@Controller('activity')
@UseGuards(JwtAuthGuard)
export class ActivityController {
  constructor(private readonly activityService: ActivityService) {}

  /**
   * GET /api/activity?organizationId=xxx&limit=20&offset=0
   * Returns paginated activity logs for an organization.
   */
  @Get()
  async findByOrg(
    @Query('organizationId') organizationId: string,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
  ): Promise<ActivityLog[]> {
    if (!organizationId?.trim()) {
      throw new BadRequestException('organizationId là bắt buộc.');
    }
    return this.activityService.findByOrg(organizationId, limit, offset);
  }

  /**
   * GET /api/activity/:taskId?organizationId=xxx
   * Returns all activity logs for a specific task.
   */
  @Get(':taskId')
  async findByTask(
    @Param('taskId') taskId: string,
    @Query('organizationId') organizationId: string,
  ): Promise<ActivityLog[]> {
    if (!organizationId?.trim()) {
      throw new BadRequestException('organizationId là bắt buộc.');
    }
    return this.activityService.findByTask(taskId, organizationId);
  }
}
