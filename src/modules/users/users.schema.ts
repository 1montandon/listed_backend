import { z } from "zod";
import { displayNameSchema, preferredCurrencySchema, usernameSchema } from "../../shared/validation/user-fields.ts";

export const updateProfileBodySchema = z.strictObject({
  name: displayNameSchema.optional(),
  username: usernameSchema.optional(),
  bio: z.string().trim().max(500).nullable().optional(),
  preferredCurrency: preferredCurrencySchema.optional(),
}).refine((input) => Object.keys(input).length > 0, "Envie ao menos um campo para editar.");

export type UpdateProfileInput = z.output<typeof updateProfileBodySchema>;
