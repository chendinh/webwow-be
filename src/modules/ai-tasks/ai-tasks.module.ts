import { Module, forwardRef } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';
import { ActivityModule } from '../activity/activity.module';
import { AITasksController } from './ai-tasks.controller';
import { AITasksService } from './ai-tasks.service';
import { StateMachineService } from './state-machine.service';
import { QueueModule } from '../../queue/queue.module';

@Module({
  imports: [PrismaModule, ActivityModule, forwardRef(() => QueueModule)],
  controllers: [AITasksController],
  providers: [StateMachineService, AITasksService],
  exports: [AITasksService, StateMachineService],
})
export class AITasksModule {}
