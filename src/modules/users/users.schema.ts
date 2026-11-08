import { z } from "zod";

export const updateProfileBodySchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
});

export type UpdateProfileInput = z.output<typeof updateProfileBodySchema>;
