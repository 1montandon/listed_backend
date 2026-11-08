import type { Request, RequestHandler, Response } from "express";
import { getUserIdFromAccessToken } from "../auth/access-token.ts";
import { HttpError } from "./http-error.ts";

export type AuthenticatedHandler = (
  request: Request,
  response: Response,
  userId: string,
) => Promise<void>;

// Passa o userId validado como argumento explícito, sem alterar tipos globais do Express.
export function withUser(handler: AuthenticatedHandler): RequestHandler {
  return async (request, response) => {
    const authorization = request.get("authorization");
    const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : undefined;

    if (!token) {
      throw new HttpError(401, "UNAUTHORIZED", "Autenticação necessária.");
    }

    let userId: string;
    try {
      userId = await getUserIdFromAccessToken(token);
    } catch {
      throw new HttpError(401, "INVALID_ACCESS_TOKEN", "Token de acesso inválido ou expirado.");
    }

    await handler(request, response, userId);
  };
}
