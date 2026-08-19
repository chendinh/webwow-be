import {
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateProjectDto {
  @ApiProperty({ example: 'My Project', minLength: 2, maxLength: 100 })
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  @ApiProperty({ required: false, description: 'Mô tả dự án' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ example: 'owner/repo', description: 'Tên đầy đủ của GitHub repository (owner/repo)' })
  @IsString()
  @IsNotEmpty()
  githubRepoFullName!: string;

  @ApiProperty({ description: 'ID của GitHub App installation' })
  @IsString()
  @IsNotEmpty()
  githubInstallationId!: string;

  @ApiProperty({ required: false, default: 'main', description: 'Nhánh mặc định của repository' })
  @IsString()
  @IsOptional()
  defaultBranch?: string;
}
