import { HttpError } from "../../shared/http/http-error.ts";
import { SavedProductsRepository, type SavedProductView } from "./saved-products.repository.ts";
import type { CreateSavedProductInput, UpdateSavedProductInput } from "./saved-products.schema.ts";

function wishlistNotFound(): HttpError {
  return new HttpError(404, "WISHLIST_NOT_FOUND", "Lista não encontrada.");
}

function productNotFound(): HttpError {
  return new HttpError(404, "PRODUCT_NOT_FOUND", "Produto não encontrado.");
}

export class SavedProductsService {
  constructor(private readonly repository: SavedProductsRepository) {}

  async create(userId: string, input: CreateSavedProductInput): Promise<SavedProductView> {
    const product = await this.repository.createInOwnedWishlist(userId, input);
    if (product === null) throw wishlistNotFound();
    return product;
  }

  async list(userId: string, wishlistId: string): Promise<SavedProductView[]> {
    const products = await this.repository.listInOwnedWishlist(userId, wishlistId);
    if (products === null) throw wishlistNotFound();
    return products;
  }

  async get(userId: string, id: string): Promise<SavedProductView> {
    const product = await this.repository.findOwned(userId, id);
    if (product === null) throw productNotFound();
    return product;
  }

  async update(userId: string, id: string, input: UpdateSavedProductInput): Promise<SavedProductView> {
    const product = await this.repository.updateOwned(userId, id, input);
    if (product === null) throw productNotFound();
    return product;
  }

  async delete(userId: string, id: string): Promise<void> {
    const deleted = await this.repository.deleteOwned(userId, id);
    if (!deleted) throw productNotFound();
  }

  async move(userId: string, id: string, destinationWishlistId: string): Promise<SavedProductView> {
    const result = await this.repository.moveOwned(userId, id, destinationWishlistId);
    if (result.status === "product-not-found") throw productNotFound();
    if (result.status === "wishlist-not-found") throw wishlistNotFound();
    if (result.status === "same-wishlist") {
      throw new HttpError(400, "SAME_WISHLIST", "Escolha uma lista diferente da lista atual.");
    }
    if (result.status === "conflict") {
      throw new HttpError(409, "MOVE_CONFLICT", "O produto ou a lista mudou durante a movimentação. Tente novamente.");
    }
    return result.product;
  }
}
