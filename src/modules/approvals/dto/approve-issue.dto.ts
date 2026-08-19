import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ApproveIssueDto {
  @ApiPropertyOptional({ description: 'Địa chỉ IP của khách hàng (tùy chọn, dùng để ghi log kiểm toán)' })
  @IsOptional()
  @IsString()
  ipAddress?: string;
}
