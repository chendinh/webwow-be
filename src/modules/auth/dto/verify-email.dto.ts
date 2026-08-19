import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class VerifyEmailDto {
  @ApiProperty({ example: 'verify-token-uuid' })
  @IsString()
  @IsNotEmpty()
  token!: string;
}
