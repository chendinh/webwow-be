import { z } from 'zod';

export const ImplementationStepSchema = z.object({
  order: z.number().int().positive(),
  type: z.enum(['CREATE', 'MODIFY', 'DELETE']),
  filePath: z
    .string()
    .min(1)
    .transform(p => p.replace(/\/+$/, '')) // strip trailing slashes
    .refine(
      p => /\.[a-zA-Z0-9]+$/.test(p),
      { message: 'filePath must be a file with an extension, not a directory path' },
    ),
  description: z.string().min(1),
  testRequired: z.boolean(),
  rollbackNote: z.string().optional(),
});

export const ImplementationPlanSchema = z.object({
  summary: z.string().min(1),
  steps: z.array(ImplementationStepSchema).min(1),
  testsToWrite: z.array(z.string()),
  rollbackStrategy: z.string().min(1),
  estimatedMinutes: z.number().int().positive(),
  complexityLevel: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  estimatedTokens: z.number().int().positive(),
});

export type ImplementationStep = z.infer<typeof ImplementationStepSchema>;
export type ImplementationPlan = z.infer<typeof ImplementationPlanSchema>;
