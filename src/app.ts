import express from "express";
import cors from "cors";
import { env } from "./config/env.ts";
import { prisma } from "./db/prisma.ts";
import { authRouter } from "./modules/auth/auth.routes.ts";
import { usersRouter } from "./modules/users/users.routes.ts";
import { wishlistsRouter } from "./modules/wishlists/wishlists.routes.ts";
import { productsRouter, wishlistProductsRouter } from "./modules/products/products.routes.ts";
import { errorHandler } from "./shared/http/error-handler.ts";
import { HttpError } from "./shared/http/http-error.ts";

export const app = express();

app.disable("x-powered-by");
app.use(cors({ origin: env.FRONTEND_ORIGIN, credentials: true }));
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

app.use("/api/v1/auth", authRouter);
app.use("/api/v1", usersRouter);
app.use("/api/v1/wishlists", wishlistsRouter, wishlistProductsRouter);
app.use("/api/v1/products", productsRouter);

app.use(() => {
  throw new HttpError(404, "NOT_FOUND", "Rota não encontrada.");
});

app.use(errorHandler);
