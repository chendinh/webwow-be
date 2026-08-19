import { z } from 'zod';

export const ImplementationOptionSchema = z.object({
  id: z.string(),                         // e.g. "option_a"
  title: z.string(),                       // Short title: "Dùng Zustand store"
  plainTitle: z.string(),                  // Non-technical: "Lưu theme vào bộ nhớ trình duyệt"
  description: z.string(),                 // Technical description
  plainDescription: z.string(),            // What this means for the user, no jargon
  pros: z.array(z.string()),               // Benefits (plain language)
  cons: z.array(z.string()),               // Drawbacks (plain language)
  complexity: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  estimatedMinutes: z.number().int().positive(),
  affectedFiles: z.array(z.string()),      // Files this option touches
  recommended: z.boolean(),
});

export const AnalysisResultSchema = z.object({
  affectedFiles: z.array(z.string()),
  aiDiagnosis: z.string(),
  plainDiagnosis: z.string(),              // Same as aiDiagnosis but no jargon, for non-dev users
  riskLevel: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  complexity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  feasibilityNotes: z.string(),
  estimatedTokens: z.number().int().positive(),
  relatedModules: z.array(z.string()),
  implementationOptions: z.array(ImplementationOptionSchema).optional(), // multiple approaches for user to choose
  clarifyingQuestions: z.array(z.string()).optional(), // questions if request is ambiguous
});

export type ImplementationOption = z.infer<typeof ImplementationOptionSchema>;
export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;
