import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ZodError } from 'zod';
import { AI_PROVIDER, IAIProvider } from '../providers/ai-provider.interface';
import { IssueAnalysisPrompt } from '../prompts/issue-analysis.prompt';
import { AnalysisResultSchema, AnalysisResult } from '../schemas/analysis-result.schema';
import { KnowledgeContext } from '../agents/knowledge-reader.agent';

export interface AnalysisAgentResult {
  result: AnalysisResult;
  tokensUsed: number;
  costUsd: number;
}

@Injectable()
export class AnalysisAgent {
  private readonly logger = new Logger(AnalysisAgent.name);

  constructor(
    @Inject(AI_PROVIDER) private readonly aiProvider: IAIProvider,
    private readonly configService: ConfigService,
  ) {}

  async analyze(
    issue: {
      title: string;
      description: string;
      type: string;
      priority: string;
    },
    projectContext: {
      primaryLanguage: string | null;
      frameworks: string[];
      detectedModules: unknown[];
      mainDependencies: unknown[];
      buildScripts: unknown | null;
      directoryStructure?: {
        fileTree?: string[];
        readmeSnippet?: string | null;
        [key: string]: unknown;
      } | null;
    },
    language = 'en',
    knowledgeContext?: KnowledgeContext | null,
  ): Promise<AnalysisAgentResult> {
    const systemPrompt = IssueAnalysisPrompt.buildSystem(language);
    const baseUserPrompt = IssueAnalysisPrompt.buildUser(issue, projectContext);
    const userPrompt = knowledgeContext
      ? `${knowledgeContext.promptSection}\n\n---\n\n${baseUserPrompt}`
      : baseUserPrompt;

    this.logger.log(`Starting analysis for issue: ${issue.title}`);

    const planningModel = this.configService.get<string>('ai.planningModel');

    const response = await this.aiProvider.call<unknown>(systemPrompt, userPrompt, {
      model: planningModel,
      maxTokens: 4096,
      temperature: 0.1,
    });

    const tokensUsed = response.inputTokens + response.outputTokens;
    const costUsd = response.estimatedCostUsd;

    this.logger.log(
      `AI analysis complete: ${tokensUsed} tokens, $${costUsd.toFixed(4)}`,
    );

    // If the provider returned a raw string (JSON parse failed upstream),
    // attempt to parse it here before Zod validation.
    let parsedContent: unknown = response.content;
    if (typeof parsedContent === 'string') {
      // Strip BOM, zero-width spaces, and other invisible Unicode characters that
      // can cause JSON.parse to fail even when the content looks valid.
      const cleaned = parsedContent
        .replace(/^\uFEFF/, '')          // BOM
        .replace(/[\u200B-\u200D\uFEFF]/g, '') // zero-width chars
        .trim();

      try {
        parsedContent = JSON.parse(cleaned);
      } catch (firstErr) {
        this.logger.error(`First JSON.parse failed: ${(firstErr as Error).message}, first 100 chars hex: ${Buffer.from(cleaned.slice(0, 100)).toString('hex')}`);
        // Try extracting the first JSON object/array from the string
        const jsonMatch = cleaned.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
        if (jsonMatch) {
          try {
            parsedContent = JSON.parse(jsonMatch[1]);
          } catch (secondErr) {
            this.logger.error(`Second JSON.parse (extracted) failed: ${(secondErr as Error).message}`);
            // leave as string — will fail Zod with a useful error below
          }
        }
      }
    }

    // Validate response against Zod schema — throws ZodError if invalid
    try {
      const result = AnalysisResultSchema.parse(parsedContent);
      return { result, tokensUsed, costUsd };
    } catch (err) {
      if (err instanceof ZodError) {
        const issues = JSON.stringify(err.issues);
        this.logger.error(`AI analysis response validation failed: ${issues}`);
        this.logger.error(
          `Raw content type: ${typeof response.content}, value: ${JSON.stringify(response.content).slice(0, 500)}`,
        );
        throw new Error(`AI phân tích trả về kết quả không hợp lệ: ${err.issues.map(i => i.message).join(', ')}`);
      }
      throw err;
    }
  }
}
