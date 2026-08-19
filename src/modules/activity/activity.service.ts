import { BadRequestException, Injectable } from '@nestjs/common';
import { ActivityEventType, ActivityLog } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface CreateActivityLogDto {
  /** REQUIRED — organization the activity belongs to */
  organizationId: string;
  projectId?: string;
  issueId?: string;
  taskId?: string;
  /** REQUIRED — category of event */
  eventType: ActivityEventType;
  agentType?: string;
  aiModel?: string;
  tokensUsed?: number;
  estimatedCost?: number;
  durationMs?: number;
  /** REQUIRED — Vietnamese customer-friendly message */
  friendlyMessage: string;
  technicalDetail?: Record<string, unknown>;
  oldStatus?: string;
  newStatus?: string;
  actorId?: string;
  ipAddress?: string;
}

@Injectable()
export class ActivityService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Log an activity event.
   * Throws BadRequestException if required fields are missing or empty.
   */
  async log(dto: CreateActivityLogDto): Promise<void> {
    if (!dto.organizationId?.trim()) {
      throw new BadRequestException(
        'organizationId là bắt buộc để ghi nhật ký hoạt động.',
      );
    }
    if (!dto.eventType) {
      throw new BadRequestException(
        'eventType là bắt buộc để ghi nhật ký hoạt động.',
      );
    }
    if (!dto.friendlyMessage?.trim()) {
      throw new BadRequestException(
        'friendlyMessage là bắt buộc để ghi nhật ký hoạt động.',
      );
    }

    await this.prisma.activityLog.create({
      data: {
        organizationId: dto.organizationId,
        projectId: dto.projectId ?? null,
        issueId: dto.issueId ?? null,
        taskId: dto.taskId ?? null,
        eventType: dto.eventType,
        agentType: dto.agentType ?? null,
        aiModel: dto.aiModel ?? null,
        tokensUsed: dto.tokensUsed ?? null,
        estimatedCost: dto.estimatedCost ?? null,
        durationMs: dto.durationMs ?? null,
        friendlyMessage: dto.friendlyMessage,
        technicalDetail: (dto.technicalDetail as object) ?? undefined,
        oldStatus: dto.oldStatus ?? null,
        newStatus: dto.newStatus ?? null,
        actorId: dto.actorId ?? null,
        ipAddress: dto.ipAddress ?? null,
      },
    });
  }

  /**
   * Get recent activity logs for an organization (paginated).
   */
  async findByOrg(
    organizationId: string,
    limit = 20,
    offset = 0,
  ): Promise<ActivityLog[]> {
    return this.prisma.activityLog.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });
  }

  /**
   * Get all activity logs for a specific task, scoped to an organization.
   */
  async findByTask(
    taskId: string,
    organizationId: string,
  ): Promise<ActivityLog[]> {
    return this.prisma.activityLog.findMany({
      where: { taskId, organizationId },
      orderBy: { createdAt: 'asc' },
    });
  }
}
