import { Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';
import { QueueModule } from '../../queue/queue.module';
import { ActivityModule } from '../activity/activity.module';
import { ApprovalsController } from './approvals.controller';
import { ApprovalsService } from './approvals.service';

@Module({
  imports: [PrismaModule, QueueModule, ActivityModule],
  controllers: [ApprovalsController],
  providers: [ApprovalsService],
  exports: [ApprovalsService],
})
export class ApprovalsModule {}
