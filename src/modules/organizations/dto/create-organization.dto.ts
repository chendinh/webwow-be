import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateOrganizationDto {
  @ApiProperty({ example: 'My Organization', minLength: 2, maxLength: 100 })
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  @ApiProperty({ example: 'my-organization', description: 'Slug chỉ chứa chữ thường, số và dấu gạch ngang' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-z0-9-]+$/, {
    message: 'Slug chỉ được chứa chữ thường, số và dấu gạch ngang.',
  })
  slug!: string;

  @ApiProperty({ required: false, example: 'https://example.com/logo.png' })
  @IsString()
  @IsOptional()
  logoUrl?: string;
}
