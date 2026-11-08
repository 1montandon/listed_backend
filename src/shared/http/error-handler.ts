import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { HttpError } from "./http-error.ts";

export const errorHandler: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
  if (error instanceof ZodError) {
    response.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Dados inválidos.",
        issues: error.issues.map((issue) => ({ path: issue.path, message: issue.message })),
      },
    });
    return;
  }

  if (error instanceof HttpError) {
    response.status(error.status).json({
      error: { code: error.code, message: error.message },
    });
    return;
  }

  console.error("Erro não tratado em requisição:", error);
  response.status(500).json({
    error: { code: "INTERNAL_ERROR", message: "Erro interno do servidor." },
  });
};
