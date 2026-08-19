import { Injectable } from '@nestjs/common';
import { CompatibilityTier } from '@prisma/client';

export interface AnalysisInput {
  primaryLanguage: string | null;
  frameworks: string[];
  databases: string[];
  buildTools: string[];
  detectedModules: unknown[];
  testCoverage: number | null;
  buildScripts: Record<string, string> | null;
  directoryStructure: unknown;
}

export interface CompatibilityNote {
  factor: string;
  score: number;
  note: string;
  suggestion?: string;
}

export interface CompatibilityResult {
  score: number;
  tier: CompatibilityTier;
  breakdown: {
    languageScore: number;
    testScore: number;
    configScore: number;
    complexityScore: number;
  };
  notes: CompatibilityNote[];
}

@Injectable()
export class CompatibilityScorerService {
  /**
   * Calculate compatibility score (0–100) and tier for a given analysis input.
   */
  calculate(input: AnalysisInput): CompatibilityResult {
    const notes: CompatibilityNote[] = [];

    const languageScore = this.calcLanguageScore(input, notes);
    const testScore = this.calcTestScore(input, notes);
    const configScore = this.calcConfigScore(input, notes);
    const complexityScore = this.calcComplexityScore(input, notes);

    const rawScore = languageScore + testScore + configScore + complexityScore;
    const score = Math.min(100, Math.max(0, Math.round(rawScore)));
    const tier = this.classifyTier(score);

    return {
      score,
      tier,
      breakdown: { languageScore, testScore, configScore, complexityScore },
      notes,
    };
  }

  /**
   * Classify a numeric score into a CompatibilityTier.
   * Boundaries are hard: ≥90 FULL_AI_SUPPORT, ≥70 AI_ASSISTED, ≥40 LIMITED_SUPPORT, <40 UNSUPPORTED.
   */
  classifyTier(score: number): CompatibilityTier {
    if (score >= 90) return CompatibilityTier.FULL_AI_SUPPORT;
    if (score >= 70) return CompatibilityTier.AI_ASSISTED;
    if (score >= 40) return CompatibilityTier.LIMITED_SUPPORT;
    return CompatibilityTier.UNSUPPORTED;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private scoring helpers
  // ─────────────────────────────────────────────────────────────────────────

  private calcLanguageScore(
    input: AnalysisInput,
    notes: CompatibilityNote[],
  ): number {
    const lang = (input.primaryLanguage ?? '').toLowerCase();

    let base = 10; // unknown/other default
    let langLabel = input.primaryLanguage ?? 'không xác định';

    if (lang === 'typescript') {
      base = 40;
    } else if (lang === 'javascript') {
      base = 30;
    } else if (lang === 'python') {
      base = 25;
    } else if (['java', 'kotlin', 'go', 'rust'].includes(lang)) {
      base = 20;
    }

    // Framework bonus: +5 each for supported frameworks, max +10
    const supportedFrameworks = [
      'react',
      'next.js',
      'nextjs',
      'nestjs',
      'express',
      'vue',
      'angular',
    ];
    const normalizedFrameworks = input.frameworks.map((f) => f.toLowerCase());
    const matchedCount = normalizedFrameworks.filter((f) =>
      supportedFrameworks.includes(f),
    ).length;
    const bonus = Math.min(matchedCount * 5, 10);

    const total = base + bonus;

    const matchedFrameworks = input.frameworks.filter((f) =>
      supportedFrameworks.includes(f.toLowerCase()),
    );

    let note: string;
    let suggestion: string | undefined;

    if (base === 40) {
      note = `Dự án sử dụng TypeScript — ngôn ngữ được hỗ trợ tốt nhất bởi AI.`;
    } else if (base === 30) {
      note = `Dự án sử dụng JavaScript — được AI hỗ trợ tốt.`;
      suggestion = 'Nâng cấp sang TypeScript để tăng khả năng hỗ trợ AI lên mức tối đa.';
    } else if (base === 25) {
      note = `Dự án sử dụng Python — AI có khả năng hỗ trợ ở mức trung bình.`;
    } else if (base === 20) {
      note = `Dự án sử dụng ${langLabel} — AI hỗ trợ cơ bản cho ngôn ngữ này.`;
      suggestion = 'Xem xét sử dụng TypeScript hoặc Python để nhận hỗ trợ AI tốt hơn.';
    } else {
      note = `Ngôn ngữ "${langLabel}" chưa được AI hỗ trợ đầy đủ.`;
      suggestion = 'Chuyển sang TypeScript, JavaScript, hoặc Python để tối ưu khả năng hỗ trợ AI.';
    }

    if (bonus > 0) {
      note += ` Phát hiện framework được hỗ trợ: ${matchedFrameworks.join(', ')} (+${bonus} điểm).`;
    }

    notes.push({
      factor: 'Ngôn ngữ & Framework',
      score: total,
      note,
      ...(suggestion ? { suggestion } : {}),
    });

    return total;
  }

  private calcTestScore(
    input: AnalysisInput,
    notes: CompatibilityNote[],
  ): number {
    const { testCoverage, buildScripts } = input;
    let score = 0;
    let note: string;
    let suggestion: string | undefined;

    if (testCoverage !== null && testCoverage !== undefined) {
      if (testCoverage >= 70) {
        score = 25;
        note = `Độ phủ test đạt ${testCoverage}% — xuất sắc! AI có thể làm việc an toàn với codebase này.`;
      } else if (testCoverage >= 40) {
        score = 15;
        note = `Độ phủ test đạt ${testCoverage}% — mức trung bình.`;
        suggestion = 'Tăng độ phủ test lên ≥70% để AI có thể tự tin hơn khi chỉnh sửa code.';
      } else if (testCoverage >= 10) {
        score = 8;
        note = `Độ phủ test chỉ đạt ${testCoverage}% — còn thấp.`;
        suggestion = 'Bổ sung unit test để AI có thể kiểm tra code một cách đáng tin cậy hơn.';
      } else {
        score = 0;
        note = `Dự án chưa có test (độ phủ 0%).`;
        suggestion = 'Thêm unit test và tích hợp CI để nâng cao chất lượng và khả năng hỗ trợ AI.';
      }
    } else {
      // testCoverage is null — check buildScripts for "test" key
      const hasTestScript =
        buildScripts !== null &&
        buildScripts !== undefined &&
        'test' in buildScripts;

      if (hasTestScript) {
        score = 10;
        note = `Không có dữ liệu độ phủ test, nhưng dự án có script "test" được cấu hình.`;
        suggestion = 'Tích hợp báo cáo độ phủ test để AI có thể đánh giá chính xác hơn.';
      } else {
        score = 0;
        note = `Không phát hiện test hoặc script test trong dự án.`;
        suggestion = 'Thêm unit test và script "test" vào package.json để cải thiện khả năng hỗ trợ AI.';
      }
    }

    notes.push({
      factor: 'Độ phủ Test',
      score,
      note,
      ...(suggestion ? { suggestion } : {}),
    });

    return score;
  }

  private calcConfigScore(
    input: AnalysisInput,
    notes: CompatibilityNote[],
  ): number {
    const { frameworks, primaryLanguage, directoryStructure, buildTools } =
      input;

    let score = 0;
    const detectedConfigs: string[] = [];

    // Has tsconfig.json
    const normalizedFrameworks = frameworks.map((f) => f.toLowerCase());
    const langLower = (primaryLanguage ?? '').toLowerCase();
    const hasTypescript =
      normalizedFrameworks.includes('typescript') || langLower === 'typescript';
    if (hasTypescript) {
      score += 8;
      detectedConfigs.push('tsconfig.json');
    }

    // Has CI config — detect from directoryStructure string or frameworks
    const directoryStr = JSON.stringify(directoryStructure ?? '').toLowerCase();
    const hasCi =
      directoryStr.includes('.github') ||
      directoryStr.includes('gitlab-ci') ||
      directoryStr.includes('circleci') ||
      directoryStr.includes('.travis') ||
      directoryStr.includes('jenkinsfile') ||
      normalizedFrameworks.some((f) =>
        ['github-actions', 'gitlab-ci', 'circleci', 'jenkins'].includes(f),
      );
    if (hasCi) {
      score += 6;
      detectedConfigs.push('CI config');
    }

    // Has Dockerfile
    const hasDocker =
      directoryStr.includes('dockerfile') ||
      directoryStr.includes('docker-compose') ||
      normalizedFrameworks.includes('docker');
    if (hasDocker) {
      score += 3;
      detectedConfigs.push('Dockerfile');
    }

    // Has package.json / lock file
    const hasBuildTools = buildTools.length > 0;
    if (hasBuildTools) {
      score += 3;
      detectedConfigs.push('package.json / build config');
    }

    let note: string;
    let suggestion: string | undefined;

    if (detectedConfigs.length === 0) {
      note = 'Không phát hiện cấu hình dự án chuẩn (TypeScript, CI, Docker, build tools).';
      suggestion = 'Thêm tsconfig.json, CI pipeline, và Dockerfile để AI có thể làm việc hiệu quả hơn.';
    } else {
      note = `Phát hiện cấu hình: ${detectedConfigs.join(', ')}.`;
      if (score < 20) {
        suggestion = 'Bổ sung thêm cấu hình CI/CD và Docker để tối ưu hỗ trợ AI.';
      }
    }

    notes.push({
      factor: 'Chất lượng cấu hình',
      score,
      note,
      ...(suggestion ? { suggestion } : {}),
    });

    return score;
  }

  private calcComplexityScore(
    input: AnalysisInput,
    notes: CompatibilityNote[],
  ): number {
    const moduleCount = input.detectedModules.length;
    let score: number;
    let note: string;
    let suggestion: string | undefined;

    if (moduleCount <= 5) {
      score = 15;
      note = `Codebase đơn giản với ${moduleCount} module — AI có thể xử lý toàn bộ dự án.`;
    } else if (moduleCount <= 15) {
      score = 10;
      note = `Codebase ở mức trung bình với ${moduleCount} module.`;
    } else if (moduleCount <= 30) {
      score = 5;
      note = `Codebase phức tạp với ${moduleCount} module — AI sẽ xử lý từng phần thay vì toàn bộ.`;
      suggestion = 'Xem xét tách nhỏ các module lớn để AI hoạt động chính xác hơn.';
    } else {
      score = 2;
      note = `Codebase rất phức tạp với ${moduleCount} module — khả năng AI bị giới hạn đáng kể.`;
      suggestion = 'Cân nhắc tái cấu trúc theo kiến trúc microservices để AI có thể xử lý hiệu quả từng service.';
    }

    notes.push({
      factor: 'Độ phức tạp codebase',
      score,
      note,
      ...(suggestion ? { suggestion } : {}),
    });

    return score;
  }
}
