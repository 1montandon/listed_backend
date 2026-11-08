import { Router } from "express";
import { prisma } from "../../db/prisma.ts";
import { requireOrigin } from "../../shared/http/require-origin.ts";
import { AuthController } from "./auth.controller.ts";
import { AuthRepository } from "./auth.repository.ts";
import { AuthService } from "./auth.service.ts";

// Este arquivo é avaliado uma vez por processo. O router e suas camadas são
// criados aqui e reutilizados por todas as requisições.
const repository = new AuthRepository(prisma);
const service = new AuthService(repository);
const controller = new AuthController(service);
export const authRouter = Router();

authRouter.use((_request, response, next) => {
  response.set("Cache-Control", "no-store");
  next();
});

authRouter.post("/register", requireOrigin, controller.register);
authRouter.post("/login", requireOrigin, controller.login);
authRouter.post("/refresh", requireOrigin, controller.refresh);
authRouter.post("/logout", requireOrigin, controller.logout);
