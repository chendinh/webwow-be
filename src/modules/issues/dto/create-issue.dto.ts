import { IsEnum, IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { IssueType, IssuePriority } from '@prisma/client';

export class CreateIssueDto {
  @ApiProperty({
    example: 'Lỗi không thể đăng nhập khi sử dụng email',
    minLength: 5,
    maxLength: 200,
    description: 'Tiêu đề vấn đề',
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(5)
  @MaxLength(200)
  title!: string;

  @ApiProperty({
    example: 'Khi người dùng nhập email và mật khẩu đúng, hệ thống vẫn báo lỗi...',
    minLength: 10,
    maxLength: 5000,
    description: 'Mô tả chi tiết vấn đề bằng ngôn ngữ tự nhiên',
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(10)
  @MaxLength(5000)
  description!: string;

  @ApiProperty({ enum: IssueType, description: 'Loại vấn đề' })
  @IsEnum(IssueType)
  type!: IssueType;

  @ApiProperty({ enum: IssuePriority, description: 'Mức độ ưu tiên' })
  @IsEnum(IssuePriority)
  priority!: IssuePriority;
}
