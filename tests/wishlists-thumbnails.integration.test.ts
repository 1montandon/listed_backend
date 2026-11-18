import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { app } from "../src/app.ts";
import { prisma } from "../src/db/prisma.ts";
import { createAccessToken } from "../src/shared/auth/access-token.ts";

test("resumo inclui até quatro miniaturas ordenadas e isoladas por usuário", async () => {
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
  const ownerId = randomUUID();
  const otherId = randomUUID();
  const listId = randomUUID();
  const destinationId = randomUUID();
  const otherListId = randomUUID();
  function request(token: string, path: string, method = "GET", body?: object): Promise<Response> {
    return fetch(baseUrl + path, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  }
  try {
    await prisma.user.createMany({ data: [ownerId, otherId].map((id) => ({
      id, name: "Teste", email: `thumbs-${id}@example.com`, passwordHash: "fixture",
    })) });
    await prisma.wishlist.createMany({ data: [
      { id: listId, userId: ownerId, name: "Origem" },
      { id: destinationId, userId: ownerId, name: "Destino" },
      { id: otherListId, userId: otherId, name: "Alheia" },
    ] });
    const token = await createAccessToken(ownerId);
    const otherToken = await createAccessToken(otherId);
    const empty = await request(token, `/wishlists/${listId}`);
    assert.deepEqual((await empty.json()).wishlist.thumbnails, []);
    const products = [];
    for (let index = 0; index < 5; index++) {
      products.push(await prisma.savedProduct.create({ data: {
        wishlistId: listId, name: `Produto ${index}`,
        imageUrl: index === 3 ? null : `https://example.com/${index}.jpg`,
        createdAt: new Date(Date.UTC(2020, 0, 1 + index)),
      } }));
      if (index === 1) {
        const few = await request(token, `/wishlists/${listId}`);
        assert.deepEqual((await few.json()).wishlist.thumbnails, ["https://example.com/1.jpg", "https://example.com/0.jpg"]);
      }
    }
    const collection = await request(token, "/wishlists");
    const list = (await collection.json()).wishlists.find((item: { id: string }) => item.id === listId);
    assert.equal(list.productCount, 5);
    assert.deepEqual(list.thumbnails, ["https://example.com/4.jpg", null, "https://example.com/2.jpg", "https://example.com/1.jpg"]);
    const otherCollection = await request(otherToken, "/wishlists");
    const otherLists = (await otherCollection.json()).wishlists;
    assert.equal(otherLists.length, 1);
    assert.equal(otherLists[0].id, otherListId);
    assert.deepEqual(otherLists[0].thumbnails, []);
    assert.equal((await request(otherToken, `/wishlists/${listId}`)).status, 404);

    const edited = await request(token, `/products/${products[3]!.id}`, "PATCH", { imageUrl: "https://example.com/new.jpg" });
    assert.equal(edited.status, 200);
    const afterEdit = (await (await request(token, `/wishlists/${listId}`)).json()).wishlist;
    assert.equal(afterEdit.thumbnails[1], "https://example.com/new.jpg");
    const moved = await request(token, `/products/${products[4]!.id}/move`, "POST", { destinationWishlistId: destinationId });
    assert.equal(moved.status, 200);
    const afterMove = (await (await request(token, `/wishlists/${listId}`)).json()).wishlist;
    assert.equal(afterMove.productCount, 4);
    assert.deepEqual(afterMove.thumbnails, ["https://example.com/new.jpg", "https://example.com/2.jpg", "https://example.com/1.jpg", "https://example.com/0.jpg"]);
    const destination = (await (await request(token, `/wishlists/${destinationId}`)).json()).wishlist;
    assert.deepEqual(destination.thumbnails, ["https://example.com/4.jpg"]);
    assert.equal((await request(token, `/products/${products[3]!.id}`, "DELETE")).status, 204);
    const afterDelete = (await (await request(token, `/wishlists/${listId}`)).json()).wishlist;
    assert.equal(afterDelete.productCount, 3);
    assert.deepEqual(afterDelete.thumbnails, ["https://example.com/2.jpg", "https://example.com/1.jpg", "https://example.com/0.jpg"]);
    const created = await request(token, "/products", "POST", {
      wishlistId: listId, name: "Novo", imageUrl: "https://example.com/novo.jpg",
    });
    assert.equal(created.status, 201);
    const afterCreate = (await (await request(token, `/wishlists/${listId}`)).json()).wishlist;
    assert.equal(afterCreate.productCount, 4);
    assert.deepEqual(afterCreate.thumbnails, ["https://example.com/novo.jpg", "https://example.com/2.jpg", "https://example.com/1.jpg", "https://example.com/0.jpg"]);
  } finally {
    try { await prisma.user.deleteMany({ where: { id: { in: [ownerId, otherId] } } }); }
    finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await prisma.$disconnect();
    }
  }
});
