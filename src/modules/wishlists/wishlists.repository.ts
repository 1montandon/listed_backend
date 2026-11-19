import type { Prisma, PrismaClient } from "../../generated/prisma/client.ts";

export interface WishlistSummary {
  id: string;
  name: string;
  productCount: number;
  thumbnails: (string | null)[];
  createdAt: Date;
  updatedAt: Date;
}

const wishlistSelect = {
  id: true,
  name: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { products: true } },
  // Mesma ordem da listagem de produtos: os mais recentes primeiro e ID
  // como desempate. Selecionamos apenas a imagem dos quatro primeiros.
  products: {
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 4,
    select: { imageUrl: true },
  },
} satisfies Prisma.WishlistSelect;

type WishlistRow = Prisma.WishlistGetPayload<{ select: typeof wishlistSelect }>;

function toSummary(row: WishlistRow): WishlistSummary {
  return {
    id: row.id,
    name: row.name,
    productCount: row._count.products,
    // Um null preserva a posição de um produto que ainda não tem imagem.
    thumbnails: row.products.map((product) => product.imageUrl),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function isMissingRecord(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2025";
}

export class WishlistsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(userId: string, name: string): Promise<WishlistSummary> {
    const row = await this.prisma.wishlist.create({
      data: { userId, name },
      select: wishlistSelect,
    });
    return toSummary(row);
  }

  async listByUser(userId: string): Promise<WishlistSummary[]> {
    const rows = await this.prisma.wishlist.findMany({
      where: { userId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: wishlistSelect,
    });
    return rows.map(toSummary);
  }

  async findOwned(userId: string, id: string): Promise<WishlistSummary | null> {
    const row = await this.prisma.wishlist.findFirst({
      where: { id, userId },
      select: wishlistSelect,
    });
    return row ? toSummary(row) : null;
  }

  async findProductsForTotals(userId: string, id: string) {
    // Buscar pela lista diferencia lista vazia de lista inexistente/alheia.
    // Retornamos só os campos necessários; nenhuma outra conta entra no cálculo.
    return this.prisma.wishlist.findUnique({
      where: { id, userId },
      select: { products: { select: { priceCents: true, currency: true, isPurchased: true } } },
    });
  }

  async renameOwned(userId: string, id: string, name: string): Promise<WishlistSummary | null> {
    try {
      const row = await this.prisma.wishlist.update({
        where: { id, userId },
        data: { name },
        select: wishlistSelect,
      });
      return toSummary(row);
    } catch (error) {
      if (isMissingRecord(error)) return null;
      throw error;
    }
  }

  async deleteOwned(userId: string, id: string): Promise<boolean> {
    const result = await this.prisma.wishlist.deleteMany({ where: { id, userId } });
    return result.count === 1;
  }
}
