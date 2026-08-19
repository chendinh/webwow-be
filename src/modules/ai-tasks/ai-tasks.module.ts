import { Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';
import { ActivityModule } from '../activity/activity.module';
import { AITasksController } from './ai-tasks.controller';
import { AITasksService } from './ai-tasks.service';
import { StateMachineService } from './state-machine.service';

@Module({
  imports: [PrismaModule, ActivityModule],
  controllers: [AITasksController],
  providers: [StateMachineService, AITasksService],
  exports: [AITasksService, StateMachineService],
})
export class AITasksModule {}
