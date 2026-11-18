import { Router } from "express";
import { prisma } from "../../db/prisma.ts";
import { withUser } from "../../shared/http/with-user.ts";
import { ProductsController } from "./products.controller.ts";
import { ProductPageLoader } from "./products.page-loader.ts";
import { ProductUrlPolicy } from "./network/url-policy.ts";
import { ProductsService } from "./products.service.ts";
import { SavedProductsController } from "./saved-products.controller.ts";
import { SavedProductsRepository } from "./saved-products.repository.ts";
import { SavedProductsService } from "./saved-products.service.ts";

const policy = new ProductUrlPolicy();
const pages = new ProductPageLoader(policy);
const service = new ProductsService(pages);
const controller = new ProductsController(service);

const savedProductsRepository = new SavedProductsRepository(prisma);
const savedProductsService = new SavedProductsService(savedProductsRepository);
const savedProductsController = new SavedProductsController(savedProductsService);

export const productsRouter = Router();
export const wishlistProductsRouter = Router();

productsRouter.use((_request, response, next) => {
  response.set("Cache-Control", "no-store");
  next();
});

productsRouter.post("/extract", withUser(controller.extract));
productsRouter.post("/", withUser(savedProductsController.create));
productsRouter.post("/:id/move", withUser(savedProductsController.move));
productsRouter.get("/:id", withUser(savedProductsController.get));
productsRouter.patch("/:id", withUser(savedProductsController.update));
productsRouter.delete("/:id", withUser(savedProductsController.delete));

wishlistProductsRouter.get("/:id/products", withUser(savedProductsController.list));
