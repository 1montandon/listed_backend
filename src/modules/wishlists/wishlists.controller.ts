import type { Request } from "express";
import type { AuthenticatedHandler } from "../../shared/http/with-user.ts";
import { wishlistBodySchema, wishlistIdSchema } from "./wishlists.schema.ts";
import { WishlistsService } from "./wishlists.service.ts";

function idFrom(request: Request): string {
  const id: unknown = request.params.id;
  return wishlistIdSchema.parse(id);
}

export class WishlistsController {
  constructor(private readonly service: WishlistsService) {}

  readonly create: AuthenticatedHandler = async (request, response, userId) => {
    const body: unknown = request.body;
    const input = wishlistBodySchema.parse(body);
    const wishlist = await this.service.create(userId, input);
    response.status(201).json({ wishlist });
  };

  readonly list: AuthenticatedHandler = async (_request, response, userId) => {
    response.json({ wishlists: await this.service.list(userId) });
  };

  readonly get: AuthenticatedHandler = async (request, response, userId) => {
    response.json({ wishlist: await this.service.get(userId, idFrom(request)) });
  };

  readonly rename: AuthenticatedHandler = async (request, response, userId) => {
    const body: unknown = request.body;
    const input = wishlistBodySchema.parse(body);
    response.json({ wishlist: await this.service.rename(userId, idFrom(request), input) });
  };

  readonly delete: AuthenticatedHandler = async (request, response, userId) => {
    await this.service.delete(userId, idFrom(request));
    response.status(204).end();
  };
}
