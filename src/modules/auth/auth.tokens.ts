import { createHash, randomBytes } from "node:crypto";
import argon2 from "argon2";

// Argon2id é um hash lento para SENHAS. Os parâmetros definem memória (KiB),
// número de passagens e paralelismo. O hash resultante já contém salt e custo.
const passwordOptions = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export const REFRESH_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

export function newRefreshToken(): string {
  // 32 bytes gerados criptograficamente dão 256 bits de entropia. base64url
  // permite transportar o valor em cookie sem caracteres especiais.
  return randomBytes(32).toString("base64url");
}

export function hashRefreshToken(token: string): string {
  // Aqui SHA-256 é suficiente porque o token é aleatório, não escolhido por uma
  // pessoa. O banco guarda só esse verificador; um vazamento não revela o cookie.
  // Para senhas, usamos Argon2id abaixo, nunca este hash rápido.
  return createHash("sha256").update(token).digest("hex");
}

export function refreshExpiration(): Date {
  // A validade também fica no banco: apagar ou revogar o cookie não substitui
  // a verificação do prazo no servidor.
  return new Date(Date.now() + REFRESH_LIFETIME_MS);
}

export function hashPassword(password: string): Promise<string> {
  // A biblioteca cria salt novo para cada senha e codifica os parâmetros no hash.
  return argon2.hash(password, passwordOptions);
}

export function verifyPassword(hash: string, password: string): Promise<boolean> {
  // Lê salt e parâmetros do hash gravado, então compara com a senha informada.
  return argon2.verify(hash, password);
}
