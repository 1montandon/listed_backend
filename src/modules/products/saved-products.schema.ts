import { z } from "zod";

const webUrl = z.string().trim().max(2048).pipe(z.url({ protocol: /^https?$/ }));

const productFields = {
  name: z.string().trim().min(1).max(300),
  url: webUrl,
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

export type CreateSavedProductInput = z.output<typeof createSavedProductSchema>;
export type UpdateSavedProductInput = z.output<typeof updateSavedProductSchema>;
