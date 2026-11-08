import type { RequestHandler } from "express";
import { env } from "../../config/env.ts";
import { HttpError } from "./http-error.ts";

// Rotas que alteram o cookie de sessão só aceitam chamadas do frontend configurado.
export const requireOrigin: RequestHandler = (request, _response, next) => {
  if (request.get("origin") !== env.FRONTEND_ORIGIN) {
    throw new HttpError(403, "ORIGIN_NOT_ALLOWED", "Origem da requisição não permitida.");
  }

  next();
};
