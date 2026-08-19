import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
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
import { Throttle } from '@nestjs/throttler';
import { Issue } from '@prisma/client';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { IssuesService } from './issues.service';
import { CreateIssueDto, UpdateIssueDto } from './dto';

@ApiTags('Issues')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/projects/:projectId/issues')
export class IssuesController {
  constructor(private readonly issuesService: IssuesService) {}

  // ── POST /api/projects/:projectId/issues ──────────────────────────────────

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({
    summary: 'Tạo vấn đề mới',
    description:
      'Tạo issue mới cho dự án. Kiểm tra giới hạn 20 issue/ngày và tương thích dự án. Tự động enqueue tác vụ AI_ANALYSIS.',
  })
  @ApiParam({ name: 'projectId', description: 'ID của dự án' })
  @ApiQuery({ name: 'organizationId', required: true, description: 'ID của tổ chức' })
  @ApiQuery({ name: 'userId', required: false, description: 'ID của người dùng tạo issue' })
  @ApiResponse({ status: 201, description: 'Tạo issue thành công, đang phân tích AI.' })
  @ApiResponse({ status: 400, description: 'Dữ liệu không hợp lệ hoặc dự án không được hỗ trợ.' })
  @ApiResponse({ status: 401, description: 'Chưa xác thực.' })
  @ApiResponse({ status: 404, description: 'Dự án không tồn tại.' })
  @ApiResponse({ status: 429, description: 'Vượt quá giới hạn 20 yêu cầu mỗi ngày.' })
  async create(
    @Param('projectId') projectId: string,
    @Query('organizationId') organizationId: string,
    @Query('userId') userId: string,
    @Body() dto: CreateIssueDto,
  ): Promise<Issue> {
    return this.issuesService.create(organizationId, projectId, userId, dto);
  }

  // ── GET /api/projects/:projectId/issues ───────────────────────────────────

  @Get()
  @ApiOperation({
    summary: 'Lấy danh sách vấn đề',
    description: 'Trả về tất cả vấn đề chưa bị xóa của dự án.',
  })
  @ApiParam({ name: 'projectId', description: 'ID của dự án' })
  @ApiQuery({ name: 'organizationId', required: true, description: 'ID của tổ chức' })
  @ApiResponse({ status: 200, description: 'Danh sách vấn đề.' })
  @ApiResponse({ status: 401, description: 'Chưa xác thực.' })
  async findAll(
    @Param('projectId') projectId: string,
    @Query('organizationId') organizationId: string,
  ): Promise<Issue[]> {
    return this.issuesService.findAll(projectId, organizationId);
  }

  // ── GET /api/projects/:projectId/issues/:issueId ──────────────────────────

  @Get(':issueId')
  @ApiOperation({
    summary: 'Lấy chi tiết vấn đề',
    description: 'Trả về thông tin chi tiết của một vấn đề. Kiểm tra quyền tổ chức.',
  })
  @ApiParam({ name: 'projectId', description: 'ID của dự án' })
  @ApiParam({ name: 'issueId', description: 'ID của vấn đề' })
  @ApiQuery({ name: 'organizationId', required: true, description: 'ID của tổ chức' })
  @ApiResponse({ status: 200, description: 'Chi tiết vấn đề.' })
  @ApiResponse({ status: 401, description: 'Chưa xác thực.' })
  @ApiResponse({ status: 404, description: 'Vấn đề không tồn tại hoặc bạn không có quyền truy cập.' })
  async findById(
    @Param('issueId') issueId: string,
    @Query('organizationId') organizationId: string,
  ): Promise<Issue> {
    return this.issuesService.findById(issueId, organizationId);
  }

  // ── PATCH /api/projects/:projectId/issues/:issueId ────────────────────────

  @Patch(':issueId')
  @ApiOperation({
    summary: 'Cập nhật vấn đề',
    description: 'Cập nhật tiêu đề, mô tả, loại hoặc mức độ ưu tiên của vấn đề.',
  })
  @ApiParam({ name: 'projectId', description: 'ID của dự án' })
  @ApiParam({ name: 'issueId', description: 'ID của vấn đề' })
  @ApiQuery({ name: 'organizationId', required: true, description: 'ID của tổ chức' })
  @ApiResponse({ status: 200, description: 'Cập nhật thành công.' })
  @ApiResponse({ status: 400, description: 'Dữ liệu không hợp lệ.' })
  @ApiResponse({ status: 401, description: 'Chưa xác thực.' })
  @ApiResponse({ status: 404, description: 'Vấn đề không tồn tại.' })
  async update(
    @Param('issueId') issueId: string,
    @Query('organizationId') organizationId: string,
    @Body() dto: UpdateIssueDto,
  ): Promise<Issue> {
    return this.issuesService.update(issueId, organizationId, dto);
  }

  // ── DELETE /api/projects/:projectId/issues/:issueId ───────────────────────

  @Delete(':issueId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Xóa vấn đề (soft delete)',
    description: 'Đặt deletedAt cho vấn đề. Dữ liệu không bị xóa vĩnh viễn.',
  })
  @ApiParam({ name: 'projectId', description: 'ID của dự án' })
  @ApiParam({ name: 'issueId', description: 'ID của vấn đề' })
  @ApiQuery({ name: 'organizationId', required: true, description: 'ID của tổ chức' })
  @ApiResponse({ status: 204, description: 'Xóa thành công.' })
  @ApiResponse({ status: 401, description: 'Chưa xác thực.' })
  @ApiResponse({ status: 404, description: 'Vấn đề không tồn tại.' })
  async softDelete(
    @Param('issueId') issueId: string,
    @Query('organizationId') organizationId: string,
  ): Promise<void> {
    await this.issuesService.softDelete(issueId, organizationId);
  }
}
