import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload } from '../../common/types/jwt-payload.type';
import { ApprovalsService } from './approvals.service';
import { ApproveIssueDto, RejectIssueDto } from './dto';

@ApiTags('Approvals')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('issues/:issueId')
export class ApprovalsController {
  constructor(private readonly approvalsService: ApprovalsService) {}

  // ── POST /api/issues/:issueId/approve ─────────────────────────────────────

  @Post('approve')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Phê duyệt kế hoạch thực hiện',
    description:
      'Khách hàng phê duyệt kế hoạch AI đã lập. Issue chuyển sang APPROVED và AI_CODING job được enqueue. ' +
      'AI không được sửa code trước bước này (R9.1).',
  })
  @ApiParam({ name: 'issueId', description: 'ID của vấn đề cần phê duyệt' })
  @ApiQuery({ name: 'organizationId', required: true, description: 'ID của tổ chức' })
  @ApiResponse({ status: 204, description: 'Phê duyệt thành công, AI đang được enqueue.' })
  @ApiResponse({ status: 400, description: 'Issue không ở trạng thái PLAN_READY.' })
  @ApiResponse({ status: 401, description: 'Chưa xác thực.' })
  @ApiResponse({ status: 404, description: 'Vấn đề không tồn tại.' })
  async approve(
    @Param('issueId') issueId: string,
    @Query('organizationId') organizationId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: ApproveIssueDto,
  ): Promise<void> {
    await this.approvalsService.approve(
      issueId,
      organizationId,
      user.sub,
      dto.ipAddress,
    );
  }

  // ── POST /api/issues/:issueId/reject ──────────────────────────────────────

  @Post('reject')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Từ chối kế hoạch thực hiện',
    description:
      'Khách hàng từ chối kế hoạch AI đã lập. Issue chuyển sang REJECTED và lý do được lưu lại (R9.4).',
  })
  @ApiParam({ name: 'issueId', description: 'ID của vấn đề cần từ chối' })
  @ApiQuery({ name: 'organizationId', required: true, description: 'ID của tổ chức' })
  @ApiResponse({ status: 204, description: 'Từ chối thành công.' })
  @ApiResponse({ status: 400, description: 'Issue không ở trạng thái PLAN_READY.' })
  @ApiResponse({ status: 401, description: 'Chưa xác thực.' })
  @ApiResponse({ status: 404, description: 'Vấn đề không tồn tại.' })
  async reject(
    @Param('issueId') issueId: string,
    @Query('organizationId') organizationId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: RejectIssueDto,
  ): Promise<void> {
    await this.approvalsService.reject(
      issueId,
      organizationId,
      user.sub,
      dto.reason,
    );
  }
}
