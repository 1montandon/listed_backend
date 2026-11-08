import { z } from "zod";

const email = z.string().trim().toLowerCase().pipe(z.email().max(320));

export const registerBodySchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  email,
  password: z.string().min(12).max(128),
});

export const loginBodySchema = z.strictObject({
  email,
  password: z.string().min(1),
});

export type RegisterInput = z.output<typeof registerBodySchema>;
export type LoginInput = z.output<typeof loginBodySchema>;
