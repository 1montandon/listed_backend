import express from "express";
import { prisma } from "./db/prisma.ts";
import { errorHandler } from "./shared/http/error-handler.ts";
import { HttpError } from "./shared/http/http-error.ts";

export const app = express();

app.disable("x-powered-by");
app.use(express.json({ limit: "32kb" }));

app.get("/api/v1/health", (_request, response) => {
  response.json({ status: "ok" });
});

app.get("/api/v1/ready", async (_request, response) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    throw new HttpError(503, "DATABASE_UNAVAILABLE", "Banco de dados indisponível.");
  }
  response.json({ status: "ok" });
});

app.use(() => {
  throw new HttpError(404, "NOT_FOUND", "Rota não encontrada.");
});

app.use(errorHandler);
