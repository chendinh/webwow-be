export interface DevLevel {
  hours: number;
  costUsd: number;
}

export interface TaskSummaryDto {
  issueId: string;
  title: string;
  status: string;
  complexity: string | null;
  riskLevel: string | null;

  // WebWow AI Team performance (NO internal costs exposed)
  webwowAiTeam: {
    completionMinutes: number | null;
    customerPrice: number | null;        // customerPriceBase from CostEstimate
    customerPriceMin: number | null;
    customerPriceMax: number | null;
    baselineCostIncluded: number | null; // shown as "project analysis fee included"
  };

  // Developer comparison
  devComparison: {
    junior: DevLevel;
    middle: DevLevel;
    senior: DevLevel;
  } | null;

  // Task results
  filesChanged: string[];
  testPassed: boolean | null;
  pullRequestUrl: string | null;

  // Estimate vs actual token comparison (internal metric shown as efficiency %)
  tokenEfficiency: {
    estimatedTokens: number | null;
    actualTokens: number | null;
    variancePct: number | null;         // positive = used more than estimated
  } | null;
}
