import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3333),
  DATABASE_URL: z.url().refine(
    (value) => value.startsWith("postgresql://") || value.startsWith("postgres://"),
    "DATABASE_URL deve usar PostgreSQL",
  ),
});

export type Env = z.output<typeof envSchema>;

export const env: Env = envSchema.parse(process.env);
