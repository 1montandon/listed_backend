import { z } from "zod";

// \p{L} cobre letras de vários alfabetos; \p{M} cobre marcas de acento.
// O sinal u habilita essas propriedades Unicode. Nome continua com acentos.
export const displayNameSchema = z.string().trim().min(1).max(120)
  .regex(/^[\p{L}\p{M} ]+$/u, "Use apenas letras e espaços.");

// Normalizamos antes de validar e salvar. A restrição do banco também garante
// minúsculas, formato e unicidade mesmo com pedidos concorrentes.
export const usernameSchema = z.string().trim().toLowerCase()
  .regex(/^[a-z0-9_]{3,30}$/, "Use de 3 a 30 letras sem acento, números ou _.");

export const preferredCurrencySchema = z.enum(["BRL", "USD", "EUR"]);
