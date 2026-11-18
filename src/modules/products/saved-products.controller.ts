import type { AuthenticatedHandler } from "../../shared/http/with-user.ts";
import { wishlistIdSchema } from "../wishlists/wishlists.schema.ts";
import { createSavedProductSchema, savedProductIdSchema, updateSavedProductSchema } from "./saved-products.schema.ts";
import { SavedProductsService } from "./saved-products.service.ts";

export class SavedProductsController {
  constructor(private readonly service: SavedProductsService) {}

  readonly create: AuthenticatedHandler = async (request, response, userId) => {
    const body: unknown = request.body;
    const input = createSavedProductSchema.parse(body);
    const product = await this.service.create(userId, input);
    response.status(201).json({ product });
  };

  readonly list: AuthenticatedHandler = async (request, response, userId) => {
    const wishlistId = wishlistIdSchema.parse(request.params.id);
    const products = await this.service.list(userId, wishlistId);
    response.json({ products });
  };

  readonly get: AuthenticatedHandler = async (request, response, userId) => {
    const productId = savedProductIdSchema.parse(request.params.id);
    const product = await this.service.get(userId, productId);
    response.json({ product });
  };

  readonly update: AuthenticatedHandler = async (request, response, userId) => {
    const productId = savedProductIdSchema.parse(request.params.id);
    const body: unknown = request.body;
    const input = updateSavedProductSchema.parse(body);
    const product = await this.service.update(userId, productId, input);
    response.json({ product });
  };

  readonly delete: AuthenticatedHandler = async (request, response, userId) => {
    const productId = savedProductIdSchema.parse(request.params.id);
    await this.service.delete(userId, productId);
    response.status(204).end();
  };
}
