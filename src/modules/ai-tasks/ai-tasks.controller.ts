import {
  Controller,
  Get,
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
import { AITask, ActivityLog } from '@prisma/client';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AITasksService } from './ai-tasks.service';

@ApiTags('AI Tasks')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('ai-tasks')
export class AITasksController {
  constructor(private readonly aiTasksService: AITasksService) {}

  // ── GET /api/ai-tasks?organizationId=xxx ──────────────────────────────────

  @Get()
  @ApiOperation({
    summary: 'Lấy danh sách tác vụ AI',
    description: 'Trả về tất cả tác vụ AI của tổ chức.',
  })
  @ApiQuery({ name: 'organizationId', required: true, description: 'ID của tổ chức' })
  @ApiResponse({ status: 200, description: 'Danh sách tác vụ AI.' })
  @ApiResponse({ status: 401, description: 'Chưa xác thực.' })
  async findAll(
    @Query('organizationId') organizationId: string,
  ): Promise<AITask[]> {
    return this.aiTasksService.findAll(organizationId);
  }

  // ── GET /api/ai-tasks/:taskId?organizationId=xxx ──────────────────────────

  @Get(':taskId')
  @ApiOperation({
    summary: 'Lấy chi tiết tác vụ AI',
    description: 'Trả về thông tin chi tiết của một tác vụ AI. Kiểm tra quyền tổ chức.',
  })
  @ApiParam({ name: 'taskId', description: 'ID của tác vụ AI' })
  @ApiQuery({ name: 'organizationId', required: true, description: 'ID của tổ chức' })
  @ApiResponse({ status: 200, description: 'Chi tiết tác vụ AI.' })
  @ApiResponse({ status: 401, description: 'Chưa xác thực.' })
  @ApiResponse({ status: 404, description: 'Tác vụ không tồn tại hoặc bạn không có quyền truy cập.' })
  async findById(
    @Param('taskId') taskId: string,
    @Query('organizationId') organizationId: string,
  ): Promise<AITask> {
    return this.aiTasksService.findById(taskId, organizationId);
  }

  // ── POST /api/ai-tasks/:taskId/cancel?organizationId=xxx ──────────────────

  @Post(':taskId/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Hủy tác vụ AI',
    description: 'Hủy tác vụ AI nếu đang ở trạng thái cho phép hủy.',
  })
  @ApiParam({ name: 'taskId', description: 'ID của tác vụ AI' })
  @ApiQuery({ name: 'organizationId', required: true, description: 'ID của tổ chức' })
  @ApiResponse({ status: 200, description: 'Tác vụ đã được hủy thành công.' })
  @ApiResponse({ status: 400, description: 'Tác vụ không thể hủy ở trạng thái hiện tại.' })
  @ApiResponse({ status: 401, description: 'Chưa xác thực.' })
  @ApiResponse({ status: 404, description: 'Tác vụ không tồn tại hoặc bạn không có quyền truy cập.' })
  async cancel(
    @Param('taskId') taskId: string,
    @Query('organizationId') organizationId: string,
  ): Promise<AITask> {
    return this.aiTasksService.cancel(taskId, organizationId);
  }

  // ── POST /api/ai-tasks/:taskId/resume?organizationId=xxx ──────────────────

  @Post(':taskId/resume')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Tiếp tục tác vụ AI sau khi xác nhận lỗi',
    description: 'Cho phép tiếp tục tác vụ AI đang ở trạng thái WAITING_APPROVAL. Đặt preflightApproved=true và đưa lại vào hàng đợi.',
  })
  @ApiParam({ name: 'taskId', description: 'ID của tác vụ AI' })
  @ApiQuery({ name: 'organizationId', required: true, description: 'ID của tổ chức' })
  @ApiResponse({ status: 200, description: 'Tác vụ đã được đưa lại vào hàng đợi.' })
  @ApiResponse({ status: 400, description: 'Tác vụ không ở trạng thái WAITING_APPROVAL.' })
  @ApiResponse({ status: 401, description: 'Chưa xác thực.' })
  @ApiResponse({ status: 404, description: 'Tác vụ không tồn tại hoặc bạn không có quyền truy cập.' })
  async resume(
    @Param('taskId') taskId: string,
    @Query('organizationId') organizationId: string,
  ): Promise<AITask> {
    return this.aiTasksService.resume(taskId, organizationId);
  }

  // ── GET /api/ai-tasks/:taskId/logs?organizationId=xxx ────────────────────

  @Get(':taskId/logs')
  @ApiOperation({
    summary: 'Lấy nhật ký hoạt động của tác vụ AI',
    description: 'Trả về tất cả nhật ký hoạt động liên quan đến tác vụ AI.',
  })
  @ApiParam({ name: 'taskId', description: 'ID của tác vụ AI' })
  @ApiQuery({ name: 'organizationId', required: true, description: 'ID của tổ chức' })
  @ApiResponse({ status: 200, description: 'Danh sách nhật ký hoạt động.' })
  @ApiResponse({ status: 401, description: 'Chưa xác thực.' })
  @ApiResponse({ status: 404, description: 'Tác vụ không tồn tại hoặc bạn không có quyền truy cập.' })
  async getLogs(
    @Param('taskId') taskId: string,
    @Query('organizationId') organizationId: string,
  ): Promise<ActivityLog[]> {
    return this.aiTasksService.getLogs(taskId, organizationId);
  }
}
