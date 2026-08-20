import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { GithubModule } from '../github/github.module';
import { QueueModule } from '../../queue/queue.module';
import { KnowledgeService } from './knowledge.service';
import { KnowledgeController } from './knowledge.controller';

@Module({
  imports: [
    PrismaModule,
    GithubModule,
    forwardRef(() => QueueModule),
  ],
  controllers: [KnowledgeController],
  providers: [KnowledgeService],
  exports: [KnowledgeService],
})
export class KnowledgeModule {}
