import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

export interface UsageSummary {
  totalTasks: number;
  totalTokens: number;
  customerCost: number;
  capUsagePercent: number;
  isNearCap: boolean;
  isCapExceeded: boolean;
}

export interface UsageMonthSummary {
  year: number;
  month: number;
  totalTasks: number;
  totalTokens: number;
  customerCost: number;
}

@Injectable()
export class UsageService {
  private readonly logger = new Logger(UsageService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly notificationsService?: NotificationsService,
  ) {}

  /**
   * Increment usage for an organization in the current month.
   * Called after each completed AITask.
   * NOTE: internalCost is stored internally but NEVER exposed to customers.
   */
  async incrementUsage(
    organizationId: string,
    taskCost: { internalCost: number; customerCost: number; tokens: number },
  ): Promise<void> {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1; // 1-12

    await this.prisma.usage.upsert({
      where: {
        organizationId_year_month: {
          organizationId,
          year,
          month,
        },
      },
      create: {
        organizationId,
        year,
        month,
        totalTasks: 1,
        totalTokens: taskCost.tokens,
        internalCost: taskCost.internalCost,
        customerCost: taskCost.customerCost,
      },
      update: {
        totalTasks: { increment: 1 },
        totalTokens: { increment: taskCost.tokens },
        internalCost: { increment: taskCost.internalCost },
        customerCost: { increment: taskCost.customerCost },
      },
    });

    this.logger.debug(
      `Incremented usage for org=${organizationId} year=${year} month=${month}`,
    );
  }

  /**
   * Get current month usage for an organization.
   * Returns ONLY customer-facing data (never internalCost).
   */
  async getCurrentMonthUsage(organizationId: string): Promise<UsageSummary> {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;

    const [usage, org] = await Promise.all([
      this.prisma.usage.findUnique({
        where: {
          organizationId_year_month: {
            organizationId,
            year,
            month,
          },
        },
        select: {
          totalTasks: true,
          totalTokens: true,
          customerCost: true,
          // internalCost is intentionally NOT selected
        },
      }),
      this.prisma.organization.findUniqueOrThrow({
        where: { id: organizationId },
        select: { usageCap: true },
      }),
    ]);

    const totalTasks = usage?.totalTasks ?? 0;
    const totalTokens = usage?.totalTokens ?? 0;
    const customerCost = usage?.customerCost ?? 0;
    const usageCap = org.usageCap;

    const capUsagePercent =
      usageCap > 0 ? (customerCost / usageCap) * 100 : 0;

    return {
      totalTasks,
      totalTokens,
      customerCost,
      capUsagePercent,
      isNearCap: capUsagePercent >= 80,
      isCapExceeded: customerCost >= usageCap,
    };
  }

  /**
   * Get usage history (last N months) for an organization.
   * NEVER includes internalCost.
   */
  async getUsageHistory(
    organizationId: string,
    months = 12,
  ): Promise<UsageMonthSummary[]> {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;

    // Build list of (year, month) pairs for the past N months
    const periods: Array<{ year: number; month: number }> = [];
    for (let i = 0; i < months; i++) {
      let y = year;
      let m = month - i;
      while (m <= 0) {
        m += 12;
        y -= 1;
      }
      periods.push({ year: y, month: m });
    }

    // Fetch all usage records for the org in the relevant range
    const startYear = periods[periods.length - 1].year;
    const startMonth = periods[periods.length - 1].month;

    const records = await this.prisma.usage.findMany({
      where: {
        organizationId,
        OR: [
          { year: { gt: startYear } },
          { year: startYear, month: { gte: startMonth } },
        ],
      },
      select: {
        year: true,
        month: true,
        totalTasks: true,
        totalTokens: true,
        customerCost: true,
        // internalCost is intentionally NOT selected
      },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });

    // Map existing records by key
    const recordMap = new Map<string, (typeof records)[0]>();
    for (const r of records) {
      recordMap.set(`${r.year}-${r.month}`, r);
    }

    // Return summaries for each period (fill zeros for months with no data)
    return periods.map((p) => {
      const key = `${p.year}-${p.month}`;
      const r = recordMap.get(key);
      return {
        year: p.year,
        month: p.month,
        totalTasks: r?.totalTasks ?? 0,
        totalTokens: r?.totalTokens ?? 0,
        customerCost: r?.customerCost ?? 0,
      };
    });
  }

  /**
   * Check if an organization has exceeded its monthly usage cap.
   * Returns true if customerCost >= org.usageCap
   */
  async isCapExceeded(organizationId: string): Promise<boolean> {
    const summary = await this.getCurrentMonthUsage(organizationId);
    return summary.isCapExceeded;
  }

  /**
   * Check if approaching cap (>= 80%) and send warning email if so.
   * Called after incrementUsage.
   */
  async checkCapAndNotify(organizationId: string): Promise<void> {
    if (!this.notificationsService) {
      return;
    }

    try {
      const [summary, org] = await Promise.all([
        this.getCurrentMonthUsage(organizationId),
        this.prisma.organization.findUniqueOrThrow({
          where: { id: organizationId },
          select: {
            name: true,
            members: {
              where: { role: 'OWNER' },
              select: {
                user: {
                  select: { email: true, name: true },
                },
              },
              take: 5,
            },
          },
        }),
      ]);

      if (!summary.isNearCap) {
        return;
      }

      const ownerEmails = org.members
        .map((m) => m.user.email)
        .filter(Boolean);

      if (ownerEmails.length === 0) {
        this.logger.warn(
          `No owner emails found for org=${organizationId} to send cap warning`,
        );
        return;
      }

      const subject = summary.isCapExceeded
        ? `[${org.name}] Monthly usage cap exceeded`
        : `[${org.name}] Approaching monthly usage cap (${summary.capUsagePercent.toFixed(1)}%)`;

      const body = summary.isCapExceeded
        ? `
          <p>Your organization <strong>${org.name}</strong> has exceeded its monthly usage cap.</p>
          <p>Current usage: <strong>$${summary.customerCost.toFixed(2)}</strong> (${summary.capUsagePercent.toFixed(1)}% of cap).</p>
          <p>New AI tasks cannot be created until the next billing cycle or your cap is increased.</p>
        `
        : `
          <p>Your organization <strong>${org.name}</strong> is approaching its monthly usage cap.</p>
          <p>Current usage: <strong>$${summary.customerCost.toFixed(2)}</strong> (${summary.capUsagePercent.toFixed(1)}% of cap).</p>
          <p>Please review your usage or consider upgrading your plan.</p>
        `;

      await Promise.all(
        ownerEmails.map((email) =>
          this.notificationsService!.sendEmail(email, subject, body),
        ),
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Failed to check/notify cap for org=${organizationId}: ${message}`,
      );
    }
  }
}
