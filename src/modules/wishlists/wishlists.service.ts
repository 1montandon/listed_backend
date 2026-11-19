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

  async getTotals(userId: string, id: string, currency: "BRL" | "USD" | "EUR") {
    const wishlist = await this.repository.findProductsForTotals(userId, id);
    if (wishlist === null) throw listNotFound();

    // Somamos centavos inteiros com bigint: 0.10 + 0.20 vira 10 + 20 = 30.
    // Isso evita arredondamento de Number e limites de precisão em somas grandes.
    const calculate = (products: typeof wishlist.products) => {
      let cents = 0n;
      let included = 0;
      const excluded = { missingPrice: 0, missingCurrency: 0, otherCurrency: 0 };
      for (const product of products) {
        // Motivos são mutuamente exclusivos: preço ausente tem prioridade,
        // depois moeda ausente, e então moeda diferente da selecionada.
        if (product.priceCents === null) {
          excluded.missingPrice++;
        } else if (product.currency === null) {
          excluded.missingCurrency++;
        } else if (product.currency !== currency) {
          excluded.otherCurrency++;
        } else {
          cents += product.priceCents;
          included++;
        }
      }
      const excludedCount = excluded.missingPrice + excluded.missingCurrency + excluded.otherCurrency;
      // Cada preço cabe em um number seguro, mas a soma de muitos pode
      // ultrapassar o limite. Nesse caso, sinalizamos o erro ao cliente.
      const amountCents = Number(cents);
      if (!Number.isSafeInteger(amountCents)) {
        throw new HttpError(422, "TOTAL_OUT_OF_RANGE", "O total em centavos excede a faixa de inteiros seguros.");
      }
      return {
        amountCents,
        productCount: products.length,
        included,
        excluded,
        isComplete: excludedCount === 0,
      };
    };

    const remaining = wishlist.products.filter((product) => !product.isPurchased);
    return { currency, all: calculate(wishlist.products), remaining: calculate(remaining) };
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
