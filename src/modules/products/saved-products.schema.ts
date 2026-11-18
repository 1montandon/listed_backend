import { z } from "zod";

const webUrl = z.string().trim().max(2048).pipe(z.url({ protocol: /^https?$/ }));

const productFields = {
  name: z.string().trim().min(1).max(300),
  // nullish aceita ausência (undefined) ou null, além de uma URL válida.
  // Criar sem URL é permitido; editar sem enviar o campo preserva o valor.
  // Texto vazio continua inválido: para remover a URL, envie null.
  url: webUrl.nullish(),
  imageUrl: webUrl.nullish(),
  // Decimal(12,2) comporta até dez dígitos antes do ponto e dois depois.
  // O texto segue para o Prisma sem passar por number ou arredondamento.
  price: z.string().trim().regex(/^\d{1,10}(\.\d{1,2})?$/).nullish(),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).nullish(),
  storeName: z.string().trim().min(1).max(160).nullish(),
};

export const createSavedProductSchema = z.strictObject({
  wishlistId: z.uuid(),
  ...productFields,
});

// .partial torna todos os campos opcionais. Ausência preserva o dado atual,
// e null limpa um campo que aceita nulo, como price. O ID da lista fica fora.
export const updateSavedProductSchema = z.strictObject(productFields).partial().refine(
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
