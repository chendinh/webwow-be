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
import { Project, ProjectAnalysis } from '@prisma/client';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ProjectsService } from './projects.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';

@ApiTags('Projects')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  // ── POST /api/projects ────────────────────────────────────────────────────────

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Tạo dự án mới',
    description: 'Tạo dự án và enqueue phân tích lần đầu. Yêu cầu organizationId.',
  })
  @ApiQuery({ name: 'organizationId', required: false, description: 'ID của tổ chức (có thể truyền qua query hoặc body)' })
  @ApiResponse({ status: 201, description: 'Tạo dự án thành công.' })
  @ApiResponse({ status: 400, description: 'Dữ liệu không hợp lệ.' })
  @ApiResponse({ status: 401, description: 'Chưa xác thực.' })
  async create(
    @Query('organizationId') organizationId: string,
    @Body() dto: CreateProjectDto,
  ): Promise<Project> {
    return this.projectsService.create(organizationId, dto);
  }

  // ── GET /api/projects?organizationId=xxx ──────────────────────────────────────

  @Get()
  @ApiOperation({
    summary: 'Lấy danh sách dự án',
    description: 'Trả về tất cả dự án chưa bị xóa của tổ chức.',
  })
  @ApiQuery({ name: 'organizationId', required: true, description: 'ID của tổ chức' })
  @ApiResponse({ status: 200, description: 'Danh sách dự án.' })
  @ApiResponse({ status: 401, description: 'Chưa xác thực.' })
  async findAll(
    @Query('organizationId') organizationId: string,
  ): Promise<Project[]> {
    return this.projectsService.findAll(organizationId);
  }

  // ── GET /api/projects/:projectId ──────────────────────────────────────────────

  @Get(':projectId')
  @ApiOperation({
    summary: 'Lấy chi tiết dự án',
    description: 'Trả về thông tin chi tiết của một dự án. Kiểm tra quyền tổ chức.',
  })
  @ApiParam({ name: 'projectId', description: 'ID của dự án' })
  @ApiQuery({ name: 'organizationId', required: true, description: 'ID của tổ chức' })
  @ApiResponse({ status: 200, description: 'Chi tiết dự án.' })
  @ApiResponse({ status: 401, description: 'Chưa xác thực.' })
  @ApiResponse({ status: 404, description: 'Dự án không tồn tại hoặc bạn không có quyền truy cập.' })
  async findById(
    @Param('projectId') projectId: string,
    @Query('organizationId') organizationId: string,
  ): Promise<Project> {
    return this.projectsService.findById(projectId, organizationId);
  }

  // ── PATCH /api/projects/:projectId ────────────────────────────────────────────

  @Patch(':projectId')
  @ApiOperation({
    summary: 'Cập nhật thông tin dự án',
    description: 'Cập nhật tên, mô tả hoặc nhánh mặc định của dự án.',
  })
  @ApiParam({ name: 'projectId', description: 'ID của dự án' })
  @ApiQuery({ name: 'organizationId', required: true, description: 'ID của tổ chức' })
  @ApiResponse({ status: 200, description: 'Cập nhật thành công.' })
  @ApiResponse({ status: 400, description: 'Dữ liệu không hợp lệ.' })
  @ApiResponse({ status: 401, description: 'Chưa xác thực.' })
  @ApiResponse({ status: 404, description: 'Dự án không tồn tại.' })
  async update(
    @Param('projectId') projectId: string,
    @Query('organizationId') organizationId: string,
    @Body() dto: UpdateProjectDto,
  ): Promise<Project> {
    return this.projectsService.update(projectId, organizationId, dto);
  }

  // ── DELETE /api/projects/:projectId ──────────────────────────────────────────

  @Delete(':projectId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Xóa dự án (soft delete)',
    description: 'Đặt deletedAt cho dự án. Dữ liệu không bị xóa vĩnh viễn.',
  })
  @ApiParam({ name: 'projectId', description: 'ID của dự án' })
  @ApiQuery({ name: 'organizationId', required: true, description: 'ID của tổ chức' })
  @ApiResponse({ status: 204, description: 'Xóa thành công.' })
  @ApiResponse({ status: 401, description: 'Chưa xác thực.' })
  @ApiResponse({ status: 404, description: 'Dự án không tồn tại.' })
  async softDelete(
    @Param('projectId') projectId: string,
    @Query('organizationId') organizationId: string,
  ): Promise<void> {
    await this.projectsService.softDelete(projectId, organizationId);
  }

  // ── GET /api/projects/:projectId/analysis ─────────────────────────────────────

  @Get(':projectId/analysis')
  @ApiOperation({
    summary: 'Lấy kết quả phân tích dự án',
    description: 'Trả về ProjectAnalysis mới nhất. Trả về null nếu chưa có kết quả phân tích.',
  })
  @ApiParam({ name: 'projectId', description: 'ID của dự án' })
  @ApiQuery({ name: 'organizationId', required: true, description: 'ID của tổ chức' })
  @ApiResponse({ status: 200, description: 'Kết quả phân tích hoặc null.' })
  @ApiResponse({ status: 401, description: 'Chưa xác thực.' })
  @ApiResponse({ status: 404, description: 'Dự án không tồn tại.' })
  async getAnalysis(
    @Param('projectId') projectId: string,
    @Query('organizationId') organizationId: string,
  ): Promise<ProjectAnalysis | null> {
    return this.projectsService.getAnalysis(projectId, organizationId);
  }

  // ── POST /api/projects/:projectId/reanalyze ───────────────────────────────────

  @Post(':projectId/reanalyze')
  @HttpCode(HttpStatus.NO_CONTENT)
  async reanalyze(
    @Param('projectId') projectId: string,
    @Query('organizationId') organizationId: string,
  ): Promise<void> {
    await this.projectsService.reanalyze(projectId, organizationId);
  }

  // ── POST /api/projects/:projectId/health-check ────────────────────────────────

  @Post(':projectId/health-check')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Kích hoạt health check cho dự án' })
  async triggerHealthCheck(
    @Param('projectId') projectId: string,
    @Query('organizationId') organizationId: string,
  ): Promise<void> {
    await this.projectsService.triggerHealthCheck(projectId, organizationId);
  }

  // ── POST /api/projects/:projectId/deploy-to-main ─────────────────────────────

  @Post(':projectId/deploy-to-main')
  @ApiOperation({ summary: 'Tạo PR merge ai/main → main để deploy' })
  async deployToMain(
    @Param('projectId') projectId: string,
    @Query('organizationId') organizationId: string,
  ) {
    return this.projectsService.deployToMain(projectId, organizationId);
  }

  // ── GET /api/projects/:projectId/health-check ─────────────────────────────────

  @Get(':projectId/health-check')
  @ApiOperation({ summary: 'Lấy kết quả health check mới nhất' })
  async getHealthCheck(
    @Param('projectId') projectId: string,
    @Query('organizationId') organizationId: string,
  ) {
    return this.projectsService.getHealthCheck(projectId, organizationId);
  }
}
