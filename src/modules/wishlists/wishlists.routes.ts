import { Router } from "express";
import { prisma } from "../../db/prisma.ts";
import { withUser } from "../../shared/http/with-user.ts";
import { WishlistsController } from "./wishlists.controller.ts";
import { WishlistsRepository } from "./wishlists.repository.ts";
import { WishlistsService } from "./wishlists.service.ts";

const repository = new WishlistsRepository(prisma);
const service = new WishlistsService(repository);
const controller = new WishlistsController(service);
export const wishlistsRouter = Router();

wishlistsRouter.use((_request, response, next) => {
  response.set("Cache-Control", "no-store");
  next();
});

wishlistsRouter.post("/", withUser(controller.create));
wishlistsRouter.get("/", withUser(controller.list));
wishlistsRouter.get("/:id/totals", withUser(controller.totals));
wishlistsRouter.get("/:id", withUser(controller.get));
wishlistsRouter.patch("/:id", withUser(controller.rename));
wishlistsRouter.delete("/:id", withUser(controller.delete));
