import { z } from 'zod';

export const AnalysisResultSchema = z.object({
  affectedFiles: z.array(z.string()),
  aiDiagnosis: z.string(),
  riskLevel: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  complexity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  feasibilityNotes: z.string(),
  estimatedTokens: z.number().int().positive(),
  relatedModules: z.array(z.string()),
});

export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;
