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
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload } from '../../common/types/jwt-payload.type';
import { OrganizationsService } from './organizations.service';
import { CreateOrganizationDto, UpdateOrganizationDto } from './dto';

@ApiTags('Organizations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/organizations')
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  // ── POST /api/organizations ───────────────────────────────────────────────────

  @Post()
  @ApiOperation({ summary: 'Tạo tổ chức mới', description: 'Người dùng hiện tại sẽ trở thành OWNER của tổ chức.' })
  @ApiResponse({ status: 201, description: 'Tạo tổ chức thành công.' })
  @ApiResponse({ status: 400, description: 'Dữ liệu không hợp lệ.' })
  @ApiResponse({ status: 409, description: 'Slug đã tồn tại.' })
  async create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateOrganizationDto,
  ) {
    return this.organizationsService.create(user.sub, dto);
  }

  // ── GET /api/organizations ────────────────────────────────────────────────────

  @Get()
  @ApiOperation({ summary: 'Lấy danh sách tổ chức của tôi', description: 'Trả về tất cả tổ chức mà người dùng hiện tại là thành viên.' })
  @ApiResponse({ status: 200, description: 'Danh sách tổ chức.' })
  async findAll(@CurrentUser() user: JwtPayload) {
    return this.organizationsService.findAllForUser(user.sub);
  }

  // ── GET /api/organizations/:organizationId ────────────────────────────────────

  @Get(':organizationId')
  @ApiOperation({ summary: 'Lấy chi tiết tổ chức', description: 'Trả về thông tin chi tiết của một tổ chức. Chỉ thành viên của tổ chức mới có thể truy cập.' })
  @ApiParam({ name: 'organizationId', description: 'ID của tổ chức' })
  @ApiResponse({ status: 200, description: 'Chi tiết tổ chức.' })
  @ApiResponse({ status: 404, description: 'Tổ chức không tồn tại hoặc bạn không có quyền truy cập.' })
  async findById(
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.organizationsService.findById(organizationId, user.sub);
  }

  // ── PATCH /api/organizations/:organizationId ──────────────────────────────────

  @Patch(':organizationId')
  @ApiOperation({ summary: 'Cập nhật thông tin tổ chức', description: 'Cập nhật tên, slug hoặc logo. Yêu cầu vai trò OWNER hoặc ADMIN.' })
  @ApiParam({ name: 'organizationId', description: 'ID của tổ chức' })
  @ApiResponse({ status: 200, description: 'Cập nhật thành công.' })
  @ApiResponse({ status: 403, description: 'Không có quyền thực hiện thao tác này.' })
  @ApiResponse({ status: 404, description: 'Tổ chức không tồn tại.' })
  @ApiResponse({ status: 409, description: 'Slug đã tồn tại.' })
  async update(
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateOrganizationDto,
  ) {
    return this.organizationsService.update(organizationId, user.sub, dto);
  }

  // ── DELETE /api/organizations/:organizationId ─────────────────────────────────

  @Delete(':organizationId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Xóa tổ chức (soft delete)', description: 'Đặt deletedAt cho tổ chức. Chỉ OWNER mới có quyền thực hiện.' })
  @ApiParam({ name: 'organizationId', description: 'ID của tổ chức' })
  @ApiResponse({ status: 204, description: 'Xóa thành công.' })
  @ApiResponse({ status: 403, description: 'Chỉ chủ sở hữu mới có quyền xóa tổ chức.' })
  @ApiResponse({ status: 404, description: 'Tổ chức không tồn tại.' })
  async softDelete(
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<void> {
    await this.organizationsService.softDelete(organizationId, user.sub);
  }
}
