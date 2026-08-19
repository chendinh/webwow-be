import { Injectable, Logger } from '@nestjs/common';
import { NEXTJS_RULES, NEXTJS_ANALYSIS_RULES } from './rules/nextjs.rules';
import { REACT_RULES, REACT_ANALYSIS_RULES } from './rules/react.rules';
import { TYPESCRIPT_RULES, TYPESCRIPT_ANALYSIS_RULES } from './rules/typescript.rules';
import { TAILWIND_RULES, TAILWIND_ANALYSIS_RULES } from './rules/tailwind.rules';
import { NESTJS_RULES, NESTJS_ANALYSIS_RULES } from './rules/nestjs.rules';
import { PRISMA_RULES, PRISMA_ANALYSIS_RULES } from './rules/prisma.rules';
import { ZUSTAND_RULES, ZUSTAND_ANALYSIS_RULES } from './rules/zustand.rules';

// ─── Rule Registry ────────────────────────────────────────────────────────────

interface TechRule {
  /** Keywords that trigger this rule set */
  triggers: string[];
  /** Rules injected into coding/fix prompts */
  codingRules: string;
  /** Rules injected into analysis/planning prompts */
  analysisRules: string;
}

const TECH_REGISTRY: TechRule[] = [
  {
    triggers: ['next', 'next.js', 'nextjs'],
    codingRules: NEXTJS_RULES,
    analysisRules: NEXTJS_ANALYSIS_RULES,
  },
  {
    triggers: ['react'],
    codingRules: REACT_RULES,
    analysisRules: REACT_ANALYSIS_RULES,
  },
  {
    triggers: ['typescript', 'ts'],
    codingRules: TYPESCRIPT_RULES,
    analysisRules: TYPESCRIPT_ANALYSIS_RULES,
  },
  {
    triggers: ['tailwind', 'tailwindcss'],
    codingRules: TAILWIND_RULES,
    analysisRules: TAILWIND_ANALYSIS_RULES,
  },
  {
    triggers: ['nestjs', '@nestjs'],
    codingRules: NESTJS_RULES,
    analysisRules: NESTJS_ANALYSIS_RULES,
  },
  {
    triggers: ['prisma', '@prisma/client'],
    codingRules: PRISMA_RULES,
    analysisRules: PRISMA_ANALYSIS_RULES,
  },
  {
    triggers: ['zustand'],
    codingRules: ZUSTAND_RULES,
    analysisRules: ZUSTAND_ANALYSIS_RULES,
  },
];

// ─── Service ──────────────────────────────────────────────────────────────────

export interface Rulebook {
  /** Combined rules for coding/fix agents */
  codingRules: string;
  /** Combined rules for analysis/planning agents */
  analysisRules: string;
  /** List of detected technologies */
  detectedTech: string[];
}

@Injectable()
export class RulebookService {
  private readonly logger = new Logger(RulebookService.name);

  /**
   * Compose a full rulebook from the detected tech stack.
   * Called after ProjectAnalysis completes and cached in ProjectAnalysis.rulebook.
   *
   * @param frameworks - e.g. ['next.js', 'react']
   * @param databases  - e.g. ['prisma', 'postgresql']
   * @param dependencies - raw dep names from package.json keys
   * @param primaryLanguage - 'typescript' | 'javascript'
   */
  compose(input: {
    frameworks: string[];
    databases: string[];
    dependencies: string[];
    primaryLanguage: string | null;
  }): Rulebook {
    const allSignals = [
      ...input.frameworks.map(f => f.toLowerCase()),
      ...input.databases.map(d => d.toLowerCase()),
      ...input.dependencies.map(d => d.toLowerCase()),
      input.primaryLanguage?.toLowerCase() ?? '',
    ];

    const matchedTech: string[] = [];
    const codingRuleBlocks: string[] = [];
    const analysisRuleBlocks: string[] = [];

    for (const rule of TECH_REGISTRY) {
      const matched = rule.triggers.some(trigger =>
        allSignals.some(signal => signal.includes(trigger) || trigger.includes(signal))
      );

      if (matched) {
        const techName = rule.triggers[0];
        matchedTech.push(techName);
        codingRuleBlocks.push(rule.codingRules);
        analysisRuleBlocks.push(rule.analysisRules);
      }
    }

    this.logger.log(`Rulebook composed for: ${matchedTech.join(', ') || 'unknown stack'}`);

    return {
      codingRules: codingRuleBlocks.join('\n'),
      analysisRules: analysisRuleBlocks.join('\n'),
      detectedTech: matchedTech,
    };
  }

  /**
   * Compose from a saved rulebook JSON (stored in ProjectAnalysis).
   * Used by agents at runtime to avoid recomputing.
   */
  fromStored(stored: unknown): Rulebook | null {
    if (!stored || typeof stored !== 'object') return null;
    const r = stored as Record<string, unknown>;
    if (typeof r.codingRules !== 'string') return null;
    return {
      codingRules: r.codingRules as string,
      analysisRules: (r.analysisRules as string) ?? '',
      detectedTech: (r.detectedTech as string[]) ?? [],
    };
  }

  /**
   * Quick compose from framework list only (used when full analysis not available).
   */
  fromFrameworks(frameworks: string[]): Rulebook {
    return this.compose({
      frameworks,
      databases: [],
      dependencies: [],
      primaryLanguage: null,
    });
  }
}
