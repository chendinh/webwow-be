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
import { InviteMemberDto, UpdateMemberRoleDto } from './dto';

// ─── Accept Invite DTO ────────────────────────────────────────────────────────

import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

class AcceptInviteDto {
  @ApiProperty({ description: 'Token từ email lời mời', example: 'uuid-v4-token' })
  @IsString()
  @IsNotEmpty()
  token!: string;
}

// ─── Members Controller ───────────────────────────────────────────────────────

@ApiTags('Members')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/organizations/:organizationId/members')
export class MembersController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  // ── POST /api/organizations/:organizationId/members/invite ────────────────────

  @Post('invite')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Mời thành viên vào tổ chức', description: 'Gửi email lời mời. Yêu cầu vai trò OWNER hoặc ADMIN.' })
  @ApiParam({ name: 'organizationId', description: 'ID của tổ chức' })
  @ApiResponse({ status: 204, description: 'Lời mời đã được gửi.' })
  @ApiResponse({ status: 403, description: 'Không có quyền mời thành viên.' })
  @ApiResponse({ status: 404, description: 'Tổ chức không tồn tại.' })
  @ApiResponse({ status: 409, description: 'Người dùng đã là thành viên.' })
  async inviteMember(
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: InviteMemberDto,
  ): Promise<void> {
    await this.organizationsService.inviteMember(organizationId, user.sub, dto);
  }

  // ── GET /api/organizations/:organizationId/members ────────────────────────────

  @Get()
  @ApiOperation({ summary: 'Lấy danh sách thành viên', description: 'Trả về tất cả thành viên của tổ chức. Yêu cầu là thành viên của tổ chức.' })
  @ApiParam({ name: 'organizationId', description: 'ID của tổ chức' })
  @ApiResponse({ status: 200, description: 'Danh sách thành viên.' })
  @ApiResponse({ status: 404, description: 'Tổ chức không tồn tại hoặc bạn không có quyền truy cập.' })
  async getMembers(
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.organizationsService.getMembers(organizationId, user.sub);
  }

  // ── PATCH /api/organizations/:organizationId/members/:userId ──────────────────

  @Patch(':userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Cập nhật vai trò thành viên', description: 'Thay đổi vai trò của một thành viên. Chỉ OWNER mới có quyền.' })
  @ApiParam({ name: 'organizationId', description: 'ID của tổ chức' })
  @ApiParam({ name: 'userId', description: 'ID của thành viên cần cập nhật vai trò' })
  @ApiResponse({ status: 204, description: 'Vai trò đã được cập nhật.' })
  @ApiResponse({ status: 400, description: 'Không thể thay đổi vai trò của chính mình.' })
  @ApiResponse({ status: 403, description: 'Chỉ chủ sở hữu mới có quyền thay đổi vai trò.' })
  @ApiResponse({ status: 404, description: 'Tổ chức hoặc thành viên không tồn tại.' })
  async updateMemberRole(
    @Param('organizationId') organizationId: string,
    @Param('userId') userId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateMemberRoleDto,
  ): Promise<void> {
    await this.organizationsService.updateMemberRole(
      organizationId,
      userId,
      user.sub,
      dto,
    );
  }

  // ── DELETE /api/organizations/:organizationId/members/:userId ─────────────────

  @Delete(':userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Xóa thành viên khỏi tổ chức', description: 'Xóa một thành viên. Yêu cầu vai trò OWNER hoặc ADMIN. OWNER không thể tự xóa mình.' })
  @ApiParam({ name: 'organizationId', description: 'ID của tổ chức' })
  @ApiParam({ name: 'userId', description: 'ID của thành viên cần xóa' })
  @ApiResponse({ status: 204, description: 'Thành viên đã bị xóa.' })
  @ApiResponse({ status: 400, description: 'Chủ sở hữu không thể tự xóa mình khỏi tổ chức.' })
  @ApiResponse({ status: 403, description: 'Không có quyền xóa thành viên.' })
  @ApiResponse({ status: 404, description: 'Tổ chức hoặc thành viên không tồn tại.' })
  async removeMember(
    @Param('organizationId') organizationId: string,
    @Param('userId') userId: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<void> {
    await this.organizationsService.removeMember(
      organizationId,
      userId,
      user.sub,
    );
  }
}

// ─── Invitations Controller ───────────────────────────────────────────────────

@ApiTags('Invitations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/invitations')
export class InvitationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  // ── POST /api/invitations/accept ──────────────────────────────────────────────

  @Post('accept')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Chấp nhận lời mời tham gia tổ chức', description: 'Dùng token từ email lời mời để tham gia tổ chức.' })
  @ApiResponse({ status: 204, description: 'Lời mời đã được chấp nhận.' })
  @ApiResponse({ status: 400, description: 'Token không hợp lệ hoặc đã hết hạn.' })
  async acceptInvite(
    @CurrentUser() user: JwtPayload,
    @Body() dto: AcceptInviteDto,
  ): Promise<void> {
    await this.organizationsService.acceptInvite(dto.token, user.sub);
  }
}
