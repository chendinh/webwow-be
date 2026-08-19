import { Module } from '@nestjs/common';
import { RulebookService } from './rulebook.service';

@Module({
  providers: [RulebookService],
  exports: [RulebookService],
})
export class KnowledgeModule {}
