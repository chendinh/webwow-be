import { Injectable } from '@nestjs/common';

export interface PricingInput {
  complexity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  estimatedTokens: number;
  estimatedSteps: number;
  risk: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  projectSizeKb: number;
}

// IMPORTANT: internalAiCost MUST NEVER appear in any API response DTO — it's internal only
export interface CostEstimateData {
  internalAiCost: number;       // USD — NEVER expose to customer
  internalTokens: number;
  customerPriceMin: number;     // base × 0.8
  customerPriceBase: number;    // what customer pays
  customerPriceMax: number;     // base × 1.2
  devComparison: {
    junior:  { hours: number; costUsd: number };
    middle:  { hours: number; costUsd: number };
    senior:  { hours: number; costUsd: number };
  };
  expiresAt: Date;              // now + 24 hours
}

// Token cost (GPT-4o pricing approximation)
const TOKEN_COST_PER_MILLION = 15; // $15/million tokens

// Complexity multipliers
const COMPLEXITY_MULTIPLIER: Record<PricingInput['complexity'], number> = {
  LOW: 1.0,
  MEDIUM: 1.8,
  HIGH: 3.2,
  CRITICAL: 5.0,
};

// Risk surcharge
const RISK_SURCHARGE: Record<PricingInput['risk'], number> = {
  LOW: 0,
  MEDIUM: 0.10,   // +10%
  HIGH: 0.25,     // +25%
  CRITICAL: 0.50, // +50%
};

// Customer price margin
const PRICE_MARGIN = 2.5;

// Minimum charge to avoid $0 prices
const MINIMUM_CUSTOMER_PRICE = 0.50;

// Vietnam international market rates 2026 (source: secondtalent.com)
const DEV_RATES = {
  junior: 20,  // $20/hr
  middle: 35,  // $35/hr
  senior: 55,  // $55/hr
};

// Estimated hours per complexity level per seniority
const DEV_HOURS_BY_LEVEL: Record<PricingInput['complexity'], { junior: number; middle: number; senior: number }> = {
  LOW:      { junior: 2,  middle: 1.5, senior: 0.5 },
  MEDIUM:   { junior: 8,  middle: 4,   senior: 2   },
  HIGH:     { junior: 24, middle: 16,  senior: 8   },
  CRITICAL: { junior: 60, middle: 40,  senior: 20  },
};

@Injectable()
export class PricingService {
  /**
   * Calculate cost estimate for an AI task.
   *
   * NOTE: The returned `internalAiCost` is for internal use only.
   * NEVER include it in any API response DTO exposed to customers.
   */
  calculate(input: PricingInput): CostEstimateData {
    const { complexity, estimatedTokens, risk } = input;

    // Token cost
    const tokenCostUsd = (estimatedTokens / 1_000_000) * TOKEN_COST_PER_MILLION;

    // Internal cost = tokenCost × complexityMultiplier × (1 + riskSurcharge)
    const internalAiCost = tokenCostUsd
      * COMPLEXITY_MULTIPLIER[complexity]
      * (1 + RISK_SURCHARGE[risk]);

    // Customer price = internalCost × PRICE_MARGIN (2.5×)
    let customerPriceBase = internalAiCost * PRICE_MARGIN;

    // Minimum charge: $0.50 to avoid $0 prices
    customerPriceBase = Math.max(customerPriceBase, MINIMUM_CUSTOMER_PRICE);

    const customerPriceMin = customerPriceBase * 0.8;  // -20%
    const customerPriceMax = customerPriceBase * 1.2;  // +20%

    // Developer comparison table: junior / middle / senior
    const hours = DEV_HOURS_BY_LEVEL[complexity];
    const devComparison = {
      junior: { hours: hours.junior, costUsd: this.round2(hours.junior * DEV_RATES.junior) },
      middle: { hours: hours.middle, costUsd: this.round2(hours.middle * DEV_RATES.middle) },
      senior: { hours: hours.senior, costUsd: this.round2(hours.senior * DEV_RATES.senior) },
    };

    // Expiry: 24 hours from now
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    return {
      internalAiCost: this.round2(internalAiCost),
      internalTokens: estimatedTokens,
      customerPriceMin: this.round2(customerPriceMin),
      customerPriceBase: this.round2(customerPriceBase),
      customerPriceMax: this.round2(customerPriceMax),
      devComparison,
      expiresAt,
    };
  }

  /** Round a number to 2 decimal places */
  private round2(value: number): number {
    return Math.round(value * 100) / 100;
  }
}
