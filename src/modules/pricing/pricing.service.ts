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
  developerComparison: number;  // equivalent manual cost
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

// Developer hours per complexity level
const DEV_HOURS: Record<PricingInput['complexity'], number> = {
  LOW: 2,
  MEDIUM: 6,
  HIGH: 16,
  CRITICAL: 40,
};

// Developer hourly rate
const DEV_HOURLY_RATE = 75;

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

    // Developer comparison: hours × $75/hour
    const developerComparison = DEV_HOURS[complexity] * DEV_HOURLY_RATE;

    // Expiry: 24 hours from now
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    return {
      internalAiCost: this.round2(internalAiCost),
      internalTokens: estimatedTokens,
      customerPriceMin: this.round2(customerPriceMin),
      customerPriceBase: this.round2(customerPriceBase),
      customerPriceMax: this.round2(customerPriceMax),
      developerComparison: this.round2(developerComparison),
      expiresAt,
    };
  }

  /** Round a number to 2 decimal places */
  private round2(value: number): number {
    return Math.round(value * 100) / 100;
  }
}
