import { z } from "zod";
import { displayNameSchema, usernameSchema } from "../../shared/validation/user-fields.ts";

const email = z.string().trim().toLowerCase().pipe(z.email().max(320));

export const registerBodySchema = z.strictObject({
  name: displayNameSchema,
  username: usernameSchema,
  email,
  password: z.string().min(12).max(128),
});

export const loginBodySchema = z.strictObject({
  email,
  password: z.string().min(1),
});

export type RegisterInput = z.output<typeof registerBodySchema>;
export type LoginInput = z.output<typeof loginBodySchema>;
