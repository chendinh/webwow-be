import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { OrganizationsService } from './organizations.service';
import { OrganizationsController } from './organizations.controller';
import { MembersController, InvitationsController } from './members.controller';

@Module({
  imports: [PrismaModule],
  controllers: [OrganizationsController, MembersController, InvitationsController],
  providers: [OrganizationsService],
  exports: [OrganizationsService],
})
export class OrganizationsModule {}
