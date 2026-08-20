import { Injectable } from '@nestjs/common';
import { ActivityEventType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SystemIssue {
  id: string;
  errorType: string;
  errorMessage: string;
  framework: string | null;
  occurrences: number;
  lastSeen: Date;
  status: 'open' | 'resolved';
  solution: string | null;
  organizationId: string;
  projectId: string | null;
  taskId: string | null;
  createdAt: Date;
}

export interface FailurePattern {
  id: string;
  errorType: string;
  framework: string | null;
  solution: string;
  occurrences: number;
  successRate: number;
  lastApplied: Date;
  createdAt: Date;
}

export interface IssueStats {
  totalIssues: number;
  openIssues: number;
  resolvedIssues: number;
  resolutionRate: number;
  totalThisWeek: number;
  mostCommonErrorType: string | null;
  avgFixAttempts: number;
  byErrorType: Array<{ errorType: string; count: number }>;
  byFramework: Array<{ framework: string; count: number }>;
}

export interface RecordIssueDto {
  organizationId: string;
  projectId?: string;
  taskId?: string;
  errorType: string;
  errorMessage: string;
  framework?: string;
  stackTrace?: string;
}

export interface GetIssuesFilters {
  organizationId: string;
  status?: 'open' | 'resolved';
  errorType?: string;
  framework?: string;
  limit?: number;
  offset?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// FUTURE: SelfUpdateWorker
// Runs weekly. Analyzes all FAILURE_PATTERN logs. Identifies recurring errors.
// Generates rule additions for NEXTJS_RULES / REACT_RULES / etc.
// Creates a PR to the platform's own repo (webwow-be) with:
//   - Updated rule files in src/ai/knowledge/rules/
//   - Updated seed data for known fix patterns
// Human reviews and merges. Platform improves with each deployment.
// ─────────────────────────────────────────────────────────────────────────────

@Injectable()
export class SystemHealthService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Record a new platform issue (worker failure, API error, etc.)
   * Stored as an ActivityLog with eventType: ERROR and technicalDetail.type: SYSTEM_ISSUE
   */
  async recordIssue(dto: RecordIssueDto): Promise<void> {
    await this.prisma.activityLog.create({
      data: {
        organizationId: dto.organizationId,
        projectId: dto.projectId ?? null,
        taskId: dto.taskId ?? null,
        eventType: ActivityEventType.ERROR,
        friendlyMessage: `Lỗi hệ thống: ${dto.errorType} — ${dto.errorMessage.slice(0, 120)}`,
        technicalDetail: {
          type: 'SYSTEM_ISSUE',
          status: 'open',
          errorType: dto.errorType,
          errorMessage: dto.errorMessage,
          framework: dto.framework ?? null,
          stackTrace: dto.stackTrace ?? null,
          solution: null,
        },
        actorId: 'system',
      },
    });
  }

  /**
   * Query system issues (ActivityLog ERROR entries with type=SYSTEM_ISSUE)
   */
  async getIssues(filters: GetIssuesFilters): Promise<SystemIssue[]> {
    const { organizationId, status, errorType, framework, limit = 50, offset = 0 } = filters;

    const rows = await this.prisma.activityLog.findMany({
      where: {
        organizationId,
        eventType: ActivityEventType.ERROR,
      },
      orderBy: { createdAt: 'desc' },
      take: limit + offset, // fetch enough to group below
    });

    // Filter to SYSTEM_ISSUE type entries
    const issueRows = rows.filter((r) => {
      const d = r.technicalDetail as Record<string, unknown> | null;
      return d?.type === 'SYSTEM_ISSUE';
    });

    // Group by errorType + framework to aggregate occurrences
    const grouped = new Map<string, SystemIssue>();
    for (const row of issueRows) {
      const d = row.technicalDetail as Record<string, unknown>;
      const et = String(d.errorType ?? 'UNKNOWN');
      const fw = d.framework ? String(d.framework) : null;
      const key = `${et}::${fw ?? ''}`;

      if (!grouped.has(key)) {
        grouped.set(key, {
          id: row.id,
          errorType: et,
          errorMessage: String(d.errorMessage ?? ''),
          framework: fw,
          occurrences: 1,
          lastSeen: row.createdAt,
          status: (d.status as 'open' | 'resolved') ?? 'open',
          solution: d.solution ? String(d.solution) : null,
          organizationId: row.organizationId,
          projectId: row.projectId ?? null,
          taskId: row.taskId ?? null,
          createdAt: row.createdAt,
        });
      } else {
        const existing = grouped.get(key)!;
        existing.occurrences += 1;
        if (row.createdAt > existing.lastSeen) {
          existing.lastSeen = row.createdAt;
        }
        // If any entry is open, the group is open
        if (d.status === 'open') existing.status = 'open';
        if (d.solution && !existing.solution) existing.solution = String(d.solution);
      }
    }

    let results = Array.from(grouped.values());

    if (status) results = results.filter((r) => r.status === status);
    if (errorType) results = results.filter((r) => r.errorType === errorType);
    if (framework) results = results.filter((r) => r.framework === framework);

    return results.slice(offset, offset + limit);
  }

  /**
   * Mark a system issue as resolved and persist the solution as a FAILURE_PATTERN
   */
  async resolveIssue(id: string, solution: string): Promise<void> {
    const row = await this.prisma.activityLog.findUnique({ where: { id } });
    if (!row) throw new Error(`SystemIssue not found: ${id}`);

    const d = row.technicalDetail as Record<string, unknown>;

    // Update the original issue log
    await this.prisma.activityLog.update({
      where: { id },
      data: {
        technicalDetail: {
          ...d,
          status: 'resolved',
          solution,
        } as object,
      },
    });

    // Persist learned fix pattern
    await this.prisma.activityLog.create({
      data: {
        organizationId: row.organizationId,
        projectId: row.projectId ?? null,
        taskId: row.taskId ?? null,
        eventType: ActivityEventType.ERROR,
        friendlyMessage: `Mẫu sửa lỗi đã học: ${String(d.errorType ?? 'UNKNOWN')}`,
        technicalDetail: {
          type: 'FAILURE_PATTERN',
          errorType: d.errorType ?? 'UNKNOWN',
          framework: d.framework ?? null,
          solution,
          successRate: 1.0,
          occurrences: 1,
        },
        actorId: 'system',
      },
    });
  }

  /**
   * Get all known fix patterns (FAILURE_PATTERN entries)
   */
  async getPatterns(): Promise<FailurePattern[]> {
    const rows = await this.prisma.activityLog.findMany({
      where: {
        eventType: ActivityEventType.ERROR,
      },
      orderBy: { createdAt: 'desc' },
      take: 1000,
    });

    const patternRows = rows.filter((r) => {
      const d = r.technicalDetail as Record<string, unknown> | null;
      return d?.type === 'FAILURE_PATTERN';
    });

    // Group patterns by errorType + framework
    const grouped = new Map<string, FailurePattern>();
    for (const row of patternRows) {
      const d = row.technicalDetail as Record<string, unknown>;
      const et = String(d.errorType ?? 'UNKNOWN');
      const fw = d.framework ? String(d.framework) : null;
      const key = `${et}::${fw ?? ''}`;

      if (!grouped.has(key)) {
        grouped.set(key, {
          id: row.id,
          errorType: et,
          framework: fw,
          solution: String(d.solution ?? ''),
          occurrences: Number(d.occurrences ?? 1),
          successRate: Number(d.successRate ?? 1.0),
          lastApplied: row.createdAt,
          createdAt: row.createdAt,
        });
      } else {
        const existing = grouped.get(key)!;
        existing.occurrences += Number(d.occurrences ?? 1);
        if (row.createdAt > existing.lastApplied) {
          existing.lastApplied = row.createdAt;
          existing.solution = String(d.solution ?? existing.solution);
        }
      }
    }

    return Array.from(grouped.values()).sort((a, b) => b.occurrences - a.occurrences);
  }

  /**
   * Aggregate statistics for the issues dashboard
   */
  async getStats(organizationId: string): Promise<IssueStats> {
    const rows = await this.prisma.activityLog.findMany({
      where: {
        organizationId,
        eventType: ActivityEventType.ERROR,
      },
      orderBy: { createdAt: 'desc' },
      take: 5000,
    });

    const issueRows = rows.filter((r) => {
      const d = r.technicalDetail as Record<string, unknown> | null;
      return d?.type === 'SYSTEM_ISSUE';
    });

    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    let openCount = 0;
    let resolvedCount = 0;
    let thisWeekCount = 0;
    const errorTypeCounts: Record<string, number> = {};
    const frameworkCounts: Record<string, number> = {};

    for (const row of issueRows) {
      const d = row.technicalDetail as Record<string, unknown>;
      const isResolved = d.status === 'resolved';

      if (isResolved) resolvedCount++;
      else openCount++;

      if (row.createdAt >= oneWeekAgo) thisWeekCount++;

      const et = String(d.errorType ?? 'UNKNOWN');
      errorTypeCounts[et] = (errorTypeCounts[et] ?? 0) + 1;

      if (d.framework) {
        const fw = String(d.framework);
        frameworkCounts[fw] = (frameworkCounts[fw] ?? 0) + 1;
      }
    }

    const total = issueRows.length;
    const resolutionRate = total > 0 ? resolvedCount / total : 0;

    const byErrorType = Object.entries(errorTypeCounts)
      .map(([errorType, count]) => ({ errorType, count }))
      .sort((a, b) => b.count - a.count);

    const byFramework = Object.entries(frameworkCounts)
      .map(([framework, count]) => ({ framework, count }))
      .sort((a, b) => b.count - a.count);

    const mostCommonErrorType = byErrorType[0]?.errorType ?? null;

    // Avg fix attempts: ratio of total issue entries to unique resolved error types
    const resolvedTypes = new Set(
      issueRows
        .filter((r) => (r.technicalDetail as Record<string, unknown>).status === 'resolved')
        .map((r) => String((r.technicalDetail as Record<string, unknown>).errorType ?? '')),
    );
    const avgFixAttempts =
      resolvedTypes.size > 0 ? Math.round(resolvedCount / resolvedTypes.size) : 0;

    return {
      totalIssues: total,
      openIssues: openCount,
      resolvedIssues: resolvedCount,
      resolutionRate: Math.round(resolutionRate * 100) / 100,
      totalThisWeek: thisWeekCount,
      mostCommonErrorType,
      avgFixAttempts,
      byErrorType: byErrorType.slice(0, 10),
      byFramework: byFramework.slice(0, 10),
    };
  }
}
