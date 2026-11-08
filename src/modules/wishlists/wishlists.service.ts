import { HttpError } from "../../shared/http/http-error.ts";
import { WishlistsRepository, type WishlistSummary } from "./wishlists.repository.ts";
import type { WishlistInput } from "./wishlists.schema.ts";

function listNotFound(): HttpError {
  return new HttpError(404, "WISHLIST_NOT_FOUND", "Lista não encontrada.");
}

export class WishlistsService {
  constructor(private readonly repository: WishlistsRepository) {}

  create(userId: string, input: WishlistInput): Promise<WishlistSummary> {
    return this.repository.create(userId, input.name);
  }

  list(userId: string): Promise<WishlistSummary[]> {
    return this.repository.listByUser(userId);
  }

  async get(userId: string, id: string): Promise<WishlistSummary> {
    const wishlist = await this.repository.findOwned(userId, id);
    if (!wishlist) throw listNotFound();
    return wishlist;
  }

  async rename(userId: string, id: string, input: WishlistInput): Promise<WishlistSummary> {
    const wishlist = await this.repository.renameOwned(userId, id, input.name);
    if (!wishlist) throw listNotFound();
    return wishlist;
  }

  async delete(userId: string, id: string): Promise<void> {
    const deleted = await this.repository.deleteOwned(userId, id);
    if (!deleted) throw listNotFound();
  }
}
