import { SignJWT, jwtVerify } from "jose";
import { env } from "../../config/env.ts";

export const ACCESS_TOKEN_LIFETIME_SECONDS = 15 * 60;
const issuer = "listed-api";
const audience = "listed-web";
// O módulo ES é carregado uma vez por processo. A chave é convertida uma vez
// e as duas funções abaixo a compartilham, sem precisar de uma classe.
const secret = new TextEncoder().encode(env.JWT_SECRET);

// jose assina o JWT. SignJWT({}) começa com payload vazio; os métodos
// adicionam sub (usuário), iss (emissor), aud (destinatário), iat e exp.
export async function createAccessToken(userId: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" }) // algoritmo da assinatura
    .setSubject(userId)
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TOKEN_LIFETIME_SECONDS}s`)
    .sign(secret);
}

export async function getUserIdFromAccessToken(token: string): Promise<string> {
  // jwtVerify confere assinatura, expiração, emissor, destinatário e a lista
  // de algoritmos aceitos. Se algo falhar, jose lança erro; withUser devolve 401.
  const { payload } = await jwtVerify(token, secret, {
    algorithms: ["HS256"],
    issuer,
    audience,
  });

  if (!payload.sub) {
    throw new Error("Token sem identificador de usuário.");
  }

  return payload.sub;
}
