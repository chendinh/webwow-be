import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload } from '../../common/types/jwt-payload.type';
import { PersonalAccessTokenService } from './personal-access-token.service';

// ─── DTOs ─────────────────────────────────────────────────────────────────────

class CreatePATDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  expiresInDays?: number;
}

// ─── Controller ──────────────────────────────────────────────────────────────

@ApiTags('Personal Access Tokens')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('auth/tokens')
export class PATController {
  constructor(private readonly patService: PersonalAccessTokenService) {}

  // ── POST /api/auth/tokens ─────────────────────────────────────────────────

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Tạo Personal Access Token mới' })
  @ApiResponse({ status: 201, description: 'Token được tạo thành công. Raw token chỉ trả về một lần.' })
  @ApiResponse({ status: 401, description: 'Chưa đăng nhập.' })
  async create(
    @Body() dto: CreatePATDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.patService.create(user.sub, dto.name, dto.expiresInDays);
  }

  // ── GET /api/auth/tokens ──────────────────────────────────────────────────

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Lấy danh sách Personal Access Tokens' })
  @ApiResponse({ status: 200, description: 'Danh sách token của người dùng.' })
  @ApiResponse({ status: 401, description: 'Chưa đăng nhập.' })
  async list(@CurrentUser() user: JwtPayload) {
    return this.patService.list(user.sub);
  }

  // ── DELETE /api/auth/tokens/:tokenId ──────────────────────────────────────

  @Delete(':tokenId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Thu hồi một Personal Access Token' })
  @ApiResponse({ status: 204, description: 'Token đã được thu hồi.' })
  @ApiResponse({ status: 401, description: 'Chưa đăng nhập.' })
  @ApiResponse({ status: 404, description: 'Token không tìm thấy.' })
  async revoke(
    @Param('tokenId') tokenId: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<void> {
    await this.patService.revoke(tokenId, user.sub);
  }
}
