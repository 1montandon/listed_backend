import { z } from "zod";
import { MAX_PRICE_CENTS } from "../../shared/money/cents.ts";

const webUrl = z.string().trim().max(2048).pipe(z.url({ protocol: /^https?$/ }));

const productFields = {
  name: z.string().trim().min(1).max(300),
  // nullish aceita ausência (undefined) ou null, além de uma URL válida.
  // Criar sem URL é permitido; editar sem enviar o campo preserva o valor.
  // Texto vazio continua inválido: para remover a URL, envie null.
  url: webUrl.nullish(),
  imageUrl: webUrl.nullish(),
  // 27990 representa 279,90 na moeda informada. A validação aceita JSON
  // numérico inteiro na faixa da coluna de preços e preserva null.
  priceCents: z.int().min(0).max(MAX_PRICE_CENTS).nullish(),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).nullish(),
  storeName: z.string().trim().min(1).max(160).nullish(),
};

export const createSavedProductSchema = z.strictObject({
  wishlistId: z.uuid(),
  ...productFields,
});

// .partial torna todos os campos opcionais. Ausência preserva o dado atual,
// e null limpa um campo que aceita nulo, como priceCents. O ID da lista fica fora.
export const updateSavedProductSchema = z.strictObject({
  ...productFields,
  // Recebemos o estado desejado, não um comando para inverter o estado atual.
  isPurchased: z.boolean(),
}).partial().refine(
  (input) => Object.keys(input).length > 0,
  "Envie ao menos um campo para editar.",
);

export const savedProductIdSchema = z.uuid();

export const moveSavedProductSchema = z.strictObject({
  destinationWishlistId: z.uuid(),
});

export type CreateSavedProductInput = z.output<typeof createSavedProductSchema>;
export type UpdateSavedProductInput = z.output<typeof updateSavedProductSchema>;
export type MoveSavedProductInput = z.output<typeof moveSavedProductSchema>;
