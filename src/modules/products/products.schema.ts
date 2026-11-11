import { z } from "zod";

// O controller valida somente o formato de entrada. A segurança da URL é
// verificada no cliente HTTP, inclusive após cada redirecionamento.
export const extractProductSchema = z.strictObject({
  url: z.string().trim().url().max(2048),
});

export type ExtractProductInput = z.output<typeof extractProductSchema>;
