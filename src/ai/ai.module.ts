import { DynamicModule, Module } from '@nestjs/common';
import { AiModule } from './providers/ai.module';
import { AI_PROVIDER } from './providers/ai-provider.interface';
import { AnalysisAgent } from './agents/analysis.agent';
import { PlanningAgent } from './agents/planning.agent';
import { CodingAgent } from './agents/coding.agent';
import { ReviewAgent } from './agents/review.agent';

@Module({})
export class AiCoreModule {
  static register(): DynamicModule {
    return {
      module: AiCoreModule,
      imports: [AiModule.register()],
      providers: [AnalysisAgent, PlanningAgent, CodingAgent, ReviewAgent],
      exports: [AI_PROVIDER, AnalysisAgent, PlanningAgent, CodingAgent, ReviewAgent],
    };
  }
}
