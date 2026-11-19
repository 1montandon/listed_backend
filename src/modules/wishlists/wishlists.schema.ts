import { z } from "zod";
import { preferredCurrencySchema } from "../../shared/validation/user-fields.ts";

export const wishlistBodySchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
});

export const wishlistIdSchema = z.uuid();
export const wishlistTotalsQuerySchema = z.strictObject({ currency: preferredCurrencySchema });

export type WishlistInput = z.output<typeof wishlistBodySchema>;
