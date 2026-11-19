// Faixa de preço preservada da coluna DECIMAL(12,2) na migração para BIGINT.
export const MAX_PRICE_CENTS = 999_999_999_999;

/** Recebe um preço decimal já validado, com ponto e até duas casas. */
export function decimalToCents(value: string): bigint {
  const [units, fraction = ""] = value.split(".");
  // "12.3" vira "1230" antes da conversão para inteiro. Nenhuma etapa usa float.
  return BigInt(units + fraction.padEnd(2, "0"));
}
