import { z } from "zod";

export const wishlistBodySchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
});

export const wishlistIdSchema = z.uuid();

export type WishlistInput = z.output<typeof wishlistBodySchema>;
