import { Inject, Injectable, Logger } from '@nestjs/common';
import { AI_PROVIDER, IAIProvider } from '../providers/ai-provider.interface';
import { CodingPrompt } from '../prompts/coding.prompt';
import { ImplementationPlan, ImplementationStep } from '../schemas/implementation-plan.schema';
import { KnowledgeContext } from '../agents/knowledge-reader.agent';

export interface CodeChange {
  filePath: string;
  content: string;  // empty string for DELETE
  type: 'CREATE' | 'MODIFY' | 'DELETE';
}

@Injectable()
export class CodingAgent {
  private readonly logger = new Logger(CodingAgent.name);

  constructor(
    @Inject(AI_PROVIDER) private readonly aiProvider: IAIProvider,
  ) {}

  /**
   * Implement a single file step from the ImplementationPlan.
   * Only generates code for the specific file — does NOT touch sandbox.
   * Requirements: R11.2
   */
  async implementStep(
    step: ImplementationStep,
    existingContent: string | null,
    context: { framework: string; language: string },
    aiOutputLanguage = 'en',
    rulebookRules = '',
    knowledgeContext?: KnowledgeContext | null,
  ): Promise<CodeChange> {
    if (step.type === 'DELETE') {
      return { filePath: step.filePath, content: '', type: 'DELETE' };
    }

    const systemPrompt = CodingPrompt.buildSystem(aiOutputLanguage, context.framework, rulebookRules);
    const baseUserPrompt = CodingPrompt.buildUser(step, existingContent, context);
    const userPrompt = knowledgeContext
      ? `${knowledgeContext.promptSection}\n\n---\n\n${baseUserPrompt}`
      : baseUserPrompt;

    this.logger.log(`Implementing ${step.type} for: ${step.filePath}`);

    const response = await this.aiProvider.call<string>(systemPrompt, userPrompt, {
      maxTokens: 4096,
      temperature: 0.1,
    });

    this.logger.log(
      `Code generated for ${step.filePath}: ${response.inputTokens + response.outputTokens} tokens`,
    );

    // Response is raw file content as string (not JSON object)
    const content = typeof response.content === 'string'
      ? response.content
      : JSON.stringify(response.content);

    return {
      filePath: step.filePath,
      content,
      type: step.type,
    };
  }

  /**
   * Generate a Conventional Commits message for the changes.
   */
  generateCommitMessage(plan: ImplementationPlan): string {
    const type = plan.complexityLevel === 'CRITICAL' ? 'feat!' : 'feat';
    const scope = plan.steps[0]?.filePath.split('/')[1] ?? 'app';
    const subject = plan.summary.slice(0, 72).replace(/\n/g, ' ');
    return `${type}(${scope}): ${subject}`;
  }

  /**
   * Phase 1 of the two-phase fix loop.
   * Classifies the error, traces the stack, and identifies root-cause files
   * WITHOUT touching any code. Returns a structured diagnosis to guide Phase 2.
   */
  async diagnoseBuildErrors(
    newErrors: string[],
    repoFileTree: string[],
    context: { framework: string; language: string },
    fullBuildOutput?: string,
  ): Promise<{ errorType: string; rootCause: string; affectedFiles: string[]; diagnosis: string }> {
    const systemPrompt = `You are a senior ${context.framework} (${context.language}) software engineer. Your only job is to diagnose build errors. Return valid JSON only.`;
    const userPrompt = CodingPrompt.buildDiagnose(newErrors, repoFileTree, context, fullBuildOutput);

    this.logger.log(`Diagnosing ${newErrors.length} error(s) — phase 1 of fix loop`);

    try {
      const response = await this.aiProvider.call<unknown>(systemPrompt, userPrompt, {
        maxTokens: 2048,
        temperature: 0.0,
      });

      const raw = typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content);

      const cleaned = raw.replace(/^```[a-z]*\n?/gm, '').replace(/```$/gm, '').trim();
      const parsed = JSON.parse(cleaned) as {
        errorType: string;
        rootCause: string;
        affectedFiles: string[];
        diagnosis: string;
      };

      this.logger.log(
        `Diagnosis: type=${parsed.errorType}, rootCause="${parsed.rootCause}", ` +
        `affectedFiles=[${parsed.affectedFiles.join(', ')}]`,
      );

      return parsed;
    } catch (err) {
      this.logger.warn(`Diagnosis phase failed (${String(err)}) — proceeding without diagnosis`);
      return { errorType: 'other', rootCause: 'unknown', affectedFiles: [], diagnosis: '' };
    }
  }

  /**
   * Fix ALL build errors in one shot — analyzes all errors together with full context.
   * This approach is far more effective than fixing file-by-file because:
   * 1. AI sees ALL errors at once and can understand relationships (e.g. missing file causes import error)
   * 2. AI has the repo file tree to know what files exist vs need to be created
   * 3. AI can create NEW files (e.g. missing hooks/utils) instead of just patching imports
   */
  async fixBuildErrors(
    newErrors: string[],
    allChangedFiles: Array<{ filePath: string; content: string }>,
    repoFileTree: string[],
    context: { framework: string; language: string },
    aiOutputLanguage = 'en',
    fullBuildOutput?: string,
    rulebookRules = '',
    diagnosis?: { errorType: string; rootCause: string; affectedFiles: string[]; diagnosis: string },
  ): Promise<CodeChange[]> {
    if (newErrors.length === 0 && !fullBuildOutput) return [];

    this.logger.log(
      `Fixing ${newErrors.length} build error(s) holistically. ` +
      `Context: ${allChangedFiles.length} files, ${repoFileTree.length} repo files`,
    );

    const systemPrompt = CodingPrompt.buildSystem(aiOutputLanguage, context.framework, rulebookRules);
    const userPrompt = CodingPrompt.buildFix(newErrors, allChangedFiles, repoFileTree, context, fullBuildOutput, diagnosis);

    try {
      const response = await this.aiProvider.call<unknown>(systemPrompt, userPrompt, {
        maxTokens: 8000,
        temperature: 0.05,
      });

      this.logger.log(
        `Fix response received: ${
          typeof response.content === 'string'
            ? response.content.length
            : JSON.stringify(response.content).length
        } chars, ${response.inputTokens + response.outputTokens} tokens`,
      );

      // Parse JSON array response
      let parsed: Array<{ filePath: string; type: string; content: string }>;
      const raw = typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content);

      // Strip any accidental markdown fences
      const cleaned = raw.replace(/^```[a-z]*\n?/gm, '').replace(/```$/gm, '').trim();

      try {
        parsed = JSON.parse(cleaned) as Array<{ filePath: string; type: string; content: string }>;
      } catch (parseErr) {
        this.logger.warn(`Fix response JSON parse failed: ${String(parseErr)}\nRaw response (first 500 chars): ${cleaned.substring(0, 500)}`);
        return [];
      }

      if (!Array.isArray(parsed)) return [];

      const fixes: CodeChange[] = parsed
        .filter(item => item.filePath && item.content && (item.type === 'CREATE' || item.type === 'MODIFY'))
        .map(item => ({
          filePath: item.filePath.replace(/^\.\//, ''), // normalise path
          content: item.content,
          type: item.type as 'CREATE' | 'MODIFY',
        }));

      this.logger.log(
        `Fix plan: ${fixes.map(f => `${f.type} ${f.filePath}`).join(', ')}`,
      );

      return fixes;
    } catch (err) {
      this.logger.warn(`Fix generation failed: ${String(err)}`);
      return [];
    }
  }
}
