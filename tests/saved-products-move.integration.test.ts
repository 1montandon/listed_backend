import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { app } from "../src/app.ts";
import { prisma } from "../src/db/prisma.ts";
import { createAccessToken } from "../src/shared/auth/access-token.ts";

test("move produto entre listas próprias preservando identidade e dados", async () => {
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/api/v1`;
  const ownerId = randomUUID();
  const otherId = randomUUID();
  const sourceId = randomUUID();
  const destinationId = randomUUID();
  const otherListId = randomUUID();
  function request(token: string, url: string, method = "GET", body?: object): Promise<Response> {
    return fetch(base + url, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  }
  try {
    await prisma.user.createMany({ data: [ownerId, otherId].map((id) => ({
      id, name: "Teste", email: `move-${id}@example.com`, passwordHash: "fixture",
    })) });
    await prisma.wishlist.createMany({ data: [
      { id: sourceId, userId: ownerId, name: "Origem" },
      { id: destinationId, userId: ownerId, name: "Destino" },
      { id: otherListId, userId: otherId, name: "Alheia" },
    ] });
    const owner = await createAccessToken(ownerId);
    const other = await createAccessToken(otherId);
    const original = await prisma.savedProduct.create({ data: {
      wishlistId: sourceId, name: "Camisa", url: null, imageUrl: "https://example.com/foto.jpg",
      price: "12.30", currency: "BRL", storeName: "Loja",
      createdAt: new Date("2020-01-01T00:00:00.000Z"), updatedAt: new Date("2020-01-01T00:00:00.000Z"),
    } });
    const route = `/products/${original.id}/move`;
    assert.equal((await fetch(base + route, { method: "POST" })).status, 401);
    assert.equal((await request(owner, route, "POST", {})).status, 400);
    assert.equal((await request(owner, route, "POST", { destinationWishlistId: "inválido" })).status, 400);
    assert.equal((await request(other, route, "POST", { destinationWishlistId: otherListId })).status, 404);
    assert.equal((await request(owner, route, "POST", { destinationWishlistId: otherListId })).status, 404);
    assert.equal((await request(owner, route, "POST", { destinationWishlistId: randomUUID() })).status, 404);
    const same = await request(owner, route, "POST", { destinationWishlistId: sourceId });
    assert.equal(same.status, 400);
    assert.equal((await same.json()).error.code, "SAME_WISHLIST");
    assert.ok(await prisma.savedProduct.findUnique({ where: { id: original.id } }));

    // Pedidos concorrentes nunca criam registros adicionais. O segundo pode
    // observar o destino já atualizado (400) ou uma disputa de escrita (409).
    const responses = await Promise.all([
      request(owner, route, "POST", { destinationWishlistId: destinationId }),
      request(owner, route, "POST", { destinationWishlistId: destinationId }),
    ]);
    assert.equal(responses.filter((response) => response.status === 200).length, 1);
    const rejected = responses.find((response) => response.status !== 200);
    assert.ok(rejected && [400, 409].includes(rejected.status));
    const success = responses.find((response) => response.status === 200);
    assert.ok(success);
    const moved = (await success.json()).product;
    assert.equal(moved.id, original.id);
    assert.equal(moved.wishlistId, destinationId);
    assert.equal(moved.name, original.name);
    assert.equal(moved.url, null);
    assert.equal(moved.imageUrl, original.imageUrl);
    assert.equal(moved.price, "12.30");
    assert.equal(moved.currency, "BRL");
    assert.equal(moved.storeName, "Loja");
    assert.equal(moved.createdAt, original.createdAt.toISOString());
    assert.notEqual(moved.updatedAt, original.updatedAt.toISOString());
    const persisted = await prisma.savedProduct.findUniqueOrThrow({ where: { id: original.id } });
    assert.equal(persisted.wishlistId, destinationId);
    assert.equal(await prisma.savedProduct.count({ where: { wishlistId: sourceId } }), 0);
    assert.equal(await prisma.savedProduct.count({ where: { wishlistId: destinationId } }), 1);
    assert.equal(await prisma.savedProduct.count({ where: { id: original.id } }), 1);
    const again = await request(owner, route, "POST", { destinationWishlistId: destinationId });
    assert.equal(again.status, 400);

  } finally {
    try { await prisma.user.deleteMany({ where: { id: { in: [ownerId, otherId] } } }); }
    finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await prisma.$disconnect();
    }
  }
});
