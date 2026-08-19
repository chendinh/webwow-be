import { DynamicModule, Module } from '@nestjs/common';
import { AiModule } from './providers/ai.module';
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
      exports: [AiModule, AnalysisAgent, PlanningAgent, CodingAgent, ReviewAgent],
    };
  }
}
