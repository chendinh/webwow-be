import {
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { UsageService, UsageSummary, UsageMonthSummary } from './usage.service';

@ApiTags('Usage')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/usage')
export class UsageController {
  constructor(private readonly usageService: UsageService) {}

  // ── GET /api/usage?organizationId=xxx ─────────────────────────────────────

  @Get()
  @ApiOperation({
    summary: 'Lấy mức sử dụng tháng hiện tại',
    description:
      'Trả về tổng hợp sử dụng AI của tháng hiện tại cho tổ chức. Không bao gồm chi phí nội bộ.',
  })
  @ApiQuery({
    name: 'organizationId',
    required: true,
    description: 'ID của tổ chức',
  })
  @ApiResponse({
    status: 200,
    description: 'Tổng hợp sử dụng tháng hiện tại.',
  })
  @ApiResponse({ status: 401, description: 'Chưa xác thực.' })
  async getCurrentMonthUsage(
    @Query('organizationId') organizationId: string,
  ): Promise<UsageSummary> {
    return this.usageService.getCurrentMonthUsage(organizationId);
  }

  // ── GET /api/usage/history?organizationId=xxx ─────────────────────────────

  @Get('history')
  @ApiOperation({
    summary: 'Lấy lịch sử sử dụng (12 tháng gần nhất)',
    description:
      'Trả về lịch sử sử dụng AI trong 12 tháng gần nhất cho tổ chức. Không bao gồm chi phí nội bộ.',
  })
  @ApiQuery({
    name: 'organizationId',
    required: true,
    description: 'ID của tổ chức',
  })
  @ApiResponse({
    status: 200,
    description: 'Lịch sử sử dụng 12 tháng.',
  })
  @ApiResponse({ status: 401, description: 'Chưa xác thực.' })
  async getUsageHistory(
    @Query('organizationId') organizationId: string,
  ): Promise<UsageMonthSummary[]> {
    return this.usageService.getUsageHistory(organizationId);
  }
}
