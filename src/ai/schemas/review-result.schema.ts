import { z } from 'zod';

export const ReviewResultSchema = z.object({
  summary: z.string(),
  issues: z.array(
    z.object({
      severity: z.enum(['LOW', 'MEDIUM', 'HIGH']),
      description: z.string(),
      filePath: z.string().optional(),
    }),
  ),
  approved: z.boolean(),
  customerFriendlySummary: z.string(),
});

export type ReviewResult = z.infer<typeof ReviewResultSchema>;
