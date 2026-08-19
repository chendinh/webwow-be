import { IsEmail, IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { OrgRole } from '@prisma/client';

export class InviteMemberDto {
  @ApiProperty({ example: 'member@example.com' })
  @IsEmail({}, { message: 'Địa chỉ email không hợp lệ.' })
  email!: string;

  @ApiProperty({ enum: OrgRole, example: OrgRole.MEMBER })
  @IsEnum(OrgRole, { message: 'Vai trò không hợp lệ.' })
  role!: OrgRole;
}
