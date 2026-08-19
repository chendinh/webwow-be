import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class RejectIssueDto {
  @ApiPropertyOptional({ description: 'Lý do từ chối kế hoạch thực hiện (tùy chọn)', maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}
