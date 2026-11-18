import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { app } from "../src/app.ts";
import { prisma } from "../src/db/prisma.ts";
import { createAccessToken } from "../src/shared/auth/access-token.ts";

test("marcar e desmarcar comprado preserva estado, isolamento e movimentação", async () => {
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/api/v1`;
  const ownerId = randomUUID();
  const otherId = randomUUID();
  const sourceId = randomUUID();
  const destinationId = randomUUID();
  function request(token: string, path: string, method = "GET", body?: object): Promise<Response> {
    return fetch(base + path, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  }
  try {
    await prisma.user.createMany({ data: [ownerId, otherId].map((id) => ({
      id, username: `u_${id.replaceAll("-", "").slice(0, 24)}`, name: "Teste", email: `purchased-${id}@example.com`, passwordHash: "fixture",
    })) });
    await prisma.wishlist.createMany({ data: [
      { id: sourceId, userId: ownerId, name: "Origem" },
      { id: destinationId, userId: ownerId, name: "Destino" },
    ] });
    const owner = await createAccessToken(ownerId);
    const other = await createAccessToken(otherId);
    const created = await request(owner, "/products", "POST", { wishlistId: sourceId, name: "Livro" });
    assert.equal(created.status, 201);
    const product = (await created.json()).product;
    assert.equal(product.isPurchased, false);
    const path = `/products/${product.id}`;
    assert.equal((await request(other, path, "PATCH", { isPurchased: true })).status, 404);
    for (const invalid of [null, "true", 1]) {
      assert.equal((await request(owner, path, "PATCH", { isPurchased: invalid })).status, 400);
    }
    for (let i = 0; i < 2; i++) {
      const marked = await request(owner, path, "PATCH", { isPurchased: true });
      assert.equal(marked.status, 200);
      assert.equal((await marked.json()).product.isPurchased, true);
    }
    assert.equal((await (await request(owner, path)).json()).product.isPurchased, true);
    const list = await request(owner, `/wishlists/${sourceId}/products`);
    assert.equal((await list.json()).products[0].isPurchased, true);
    const moved = await request(owner, `${path}/move`, "POST", { destinationWishlistId: destinationId });
    assert.equal(moved.status, 200);
    assert.equal((await moved.json()).product.isPurchased, true);
    const stored = await prisma.savedProduct.findUniqueOrThrow({ where: { id: product.id } });
    assert.equal(stored.isPurchased, true);
    for (let i = 0; i < 2; i++) {
      const unmarked = await request(owner, path, "PATCH", { isPurchased: false });
      assert.equal(unmarked.status, 200);
      assert.equal((await unmarked.json()).product.isPurchased, false);
    }
    assert.equal((await (await request(owner, path)).json()).product.isPurchased, false);
  } finally {
    try { await prisma.user.deleteMany({ where: { id: { in: [ownerId, otherId] } } }); }
    finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await prisma.$disconnect();
    }
  }
});
