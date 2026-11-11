import { Router } from "express";
import { withUser } from "../../shared/http/with-user.ts";
import { ProductsController } from "./products.controller.ts";
import { ProductPageLoader } from "./products.page-loader.ts";
import { ProductUrlPolicy } from "./network/url-policy.ts";
import { ProductsService } from "./products.service.ts";

const policy = new ProductUrlPolicy();
const pages = new ProductPageLoader(policy);
const service = new ProductsService(pages);
const controller = new ProductsController(service);
export const productsRouter = Router();

productsRouter.use((_request, response, next) => {
  response.set("Cache-Control", "no-store");
  next();
});

productsRouter.post("/extract", withUser(controller.extract));
