import { Module } from '@nestjs/common';
import { RulebookService } from './rulebook.service';
import { FailureLearnerService } from './failure-learner.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [RulebookService, FailureLearnerService],
  exports: [RulebookService, FailureLearnerService],
})
export class KnowledgeModule {}
