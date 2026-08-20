import { DynamicModule, Module } from '@nestjs/common';
import { AiModule } from './providers/ai.module';
import { AnalysisAgent } from './agents/analysis.agent';
import { PlanningAgent } from './agents/planning.agent';
import { CodingAgent } from './agents/coding.agent';
import { ReviewAgent } from './agents/review.agent';
import { KnowledgeReaderAgent } from './agents/knowledge-reader.agent';
import { GithubModule } from '../modules/github/github.module';
import { ActivityModule } from '../modules/activity/activity.module';

@Module({})
export class AiCoreModule {
  static register(): DynamicModule {
    return {
      module: AiCoreModule,
      imports: [AiModule.register(), GithubModule, ActivityModule],
      providers: [AnalysisAgent, PlanningAgent, CodingAgent, ReviewAgent, KnowledgeReaderAgent],
      exports: [AiModule, AnalysisAgent, PlanningAgent, CodingAgent, ReviewAgent, KnowledgeReaderAgent],
    };
  }
}
