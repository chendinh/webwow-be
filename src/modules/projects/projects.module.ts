import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { QueueModule } from '../../queue/queue.module';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { CompatibilityScorerService } from './compatibility-scorer.service';

@Module({
  imports: [PrismaModule, QueueModule],
  controllers: [ProjectsController],
  providers: [ProjectsService, CompatibilityScorerService],
  exports: [ProjectsService, CompatibilityScorerService],
})
export class ProjectsModule {}
