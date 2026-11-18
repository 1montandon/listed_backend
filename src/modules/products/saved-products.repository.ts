import { Prisma, type PrismaClient, type SavedProduct } from "../../generated/prisma/client.ts";
import type { CreateSavedProductInput, UpdateSavedProductInput } from "./saved-products.schema.ts";

// Omit reaproveita os campos da linha do Prisma, trocando só o tipo de price.
export type SavedProductView = Omit<SavedProduct, "price"> & { price: string | null };

function toView(row: SavedProduct): SavedProductView {
  return { ...row, price: row.price?.toFixed(2) ?? null };
}

export class SavedProductsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createInOwnedWishlist(userId: string, input: CreateSavedProductInput): Promise<SavedProductView | null> {
    try {
      const row = await this.prisma.savedProduct.create({
        data: {
          name: input.name,
          // Na criação, ausência e null representam o mesmo dado: sem URL.
          // No PATCH abaixo, a ausência precisa continuar significando "preservar".
          url: input.url ?? null,
          imageUrl: input.imageUrl ?? null,
          price: input.price ?? null,
          currency: input.currency ?? null,
          storeName: input.storeName ?? null,
          // connect vincula uma lista existente. O ID identifica a lista, e
          // userId exige que ela pertença a quem fez o pedido.
          wishlist: { connect: { id: input.wishlistId, userId } },
        },
      });
      return toView(row);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        // Lista ausente, alheia ou excluída durante a criação.
        if (["P2025", "P2018", "P2003"].includes(error.code)) return null;
      }
      throw error;
    }
  }

  async listInOwnedWishlist(userId: string, wishlistId: string): Promise<SavedProductView[] | null> {
    // Começamos pela lista para distinguir uma lista própria vazia de uma
    // lista inexistente ou alheia. Uma consulta só de produtos daria [] nos três casos.
    const wishlist = await this.prisma.wishlist.findUnique({
      where: { id: wishlistId, userId },
      select: { products: { orderBy: [{ createdAt: "desc" }, { id: "desc" }] } },
    });
    if (wishlist === null) return null;
    return wishlist.products.map(toView);
  }

  async findOwned(userId: string, id: string): Promise<SavedProductView | null> {
    const row = await this.prisma.savedProduct.findUnique({
      where: { id, wishlist: { userId } },
    });
    return row === null ? null : toView(row);
  }

  async updateOwned(userId: string, id: string, input: UpdateSavedProductInput): Promise<SavedProductView | null> {
    // No PATCH, montamos a escrita só com campos presentes. undefined indica
    // ausência no formulário. null precisa chegar ao banco para limpar o valor.
    const data: Prisma.SavedProductUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.url !== undefined) data.url = input.url;
    if (input.imageUrl !== undefined) data.imageUrl = input.imageUrl;
    if (input.price !== undefined) data.price = input.price;
    if (input.currency !== undefined) data.currency = input.currency;
    if (input.storeName !== undefined) data.storeName = input.storeName;

    try {
      const row = await this.prisma.savedProduct.update({
        // A escrita tem o filtro de propriedade na própria operação.
        where: { id, wishlist: { userId } },
        data,
      });
      return toView(row);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") return null;
      throw error;
    }
  }

  async deleteOwned(userId: string, id: string): Promise<boolean> {
    // deleteMany com ID único afeta zero ou um registro. O contador indica
    // se havia um produto que atendia ao filtro, sem outra consulta.
    const result = await this.prisma.savedProduct.deleteMany({ where: { id, wishlist: { userId } } });
    return result.count === 1;
  }
}
