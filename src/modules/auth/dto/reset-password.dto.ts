import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @ApiProperty({ example: 'reset-token-uuid' })
  @IsString()
  @IsNotEmpty()
  token!: string;

  @ApiProperty({ example: 'newSecurePassword123', minLength: 8 })
  @IsString()
  @MinLength(8)
  password!: string;
}
