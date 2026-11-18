import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { app } from "../src/app.ts";
import { prisma } from "../src/db/prisma.ts";
import { createAccessToken } from "../src/shared/auth/access-token.ts";

test("produtos salvos validam dados e limitam o CRUD ao dono da wishlist", async () => {
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const baseUrl = `http://127.0.0.1:${address.port}/api/v1`;

  const ownerId = randomUUID();
  const visitorId = randomUUID();
  const wishlistId = randomUUID();

  function request(token: string, path: string, method = "GET", body?: object): Promise<Response> {
    return fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  }

  try {
    // Preparamos duas contas sem depender do fluxo de cadastro. Os JWTs
    // continuam passando pela mesma verificação que os tokens da aplicação.
    await prisma.user.createMany({
      data: [ownerId, visitorId].map((id) => ({
        id, name: "Pessoa Teste", email: `saved-${id}@example.com`, passwordHash: "fixture",
      })),
    });
    await prisma.wishlist.create({ data: { id: wishlistId, userId: ownerId, name: "Presentes" } });
    const ownerToken = await createAccessToken(ownerId);
    const visitorToken = await createAccessToken(visitorId);
    const listPath = `/wishlists/${wishlistId}/products`;
    const url = "https://loja.example/produto";
    const minimum = { wishlistId, name: "  Camisa  ", url };

    assert.equal((await fetch(baseUrl + listPath)).status, 401);
    const empty = await request(ownerToken, listPath);
    assert.equal(empty.status, 200);
    assert.deepEqual(await empty.json(), { products: [] });
    assert.equal((await request(visitorToken, listPath)).status, 404);
    assert.equal((await request(visitorToken, "/products", "POST", minimum)).status, 404);
    assert.equal((await request(ownerToken, "/products", "POST", { ...minimum, wishlistId: randomUUID() })).status, 404);

    for (const invalidBody of [
      { name: "Sem lista", url },
      { ...minimum, name: "   " },
      { ...minimum, url: "ftp://loja.example/produto" },
      { ...minimum, price: 25.5 },
      { ...minimum, price: "0.001" },
      { ...minimum, price: "10000000000.00" },
    ]) {
      assert.equal((await request(ownerToken, "/products", "POST", invalidBody)).status, 400);
    }

    const manual = await request(ownerToken, "/products", "POST", minimum);
    assert.equal(manual.status, 201);
    const { product } = await manual.json();
    assert.equal(product.name, "Camisa");
    assert.equal(product.url, url);
    assert.equal(product.wishlistId, wishlistId);
    assert.equal(product.imageUrl, null);
    assert.equal(product.price, null);
    assert.equal(product.currency, null);
    assert.equal(product.storeName, null);

    const reviewed = await request(ownerToken, "/products", "POST", {
      ...minimum,
      name: "Camisa azul",
      imageUrl: "https://loja.example/camisa.jpg",
      price: "249.9",
      currency: "brl",
      storeName: "Loja Exemplo",
    });
    assert.equal(reviewed.status, 201);
    const duplicate = (await reviewed.json()).product;
    assert.notEqual(duplicate.id, product.id);
    assert.equal(duplicate.url, product.url);
    assert.equal(duplicate.price, "249.90");
    assert.equal(duplicate.currency, "BRL");

    const listed = await request(ownerToken, listPath);
    assert.equal(listed.status, 200);
    const { products } = await listed.json();
    assert.deepEqual(new Set(products.map((item: { id: string }) => item.id)), new Set([duplicate.id, product.id]));

    const productPath = `/products/${duplicate.id}`;
    assert.equal((await request(visitorToken, productPath)).status, 404);
    assert.equal((await request(visitorToken, productPath, "PATCH", { name: "Nome alterado" })).status, 404);
    assert.equal((await request(visitorToken, productPath, "DELETE")).status, 404);
    const found = await request(ownerToken, productPath);
    assert.equal(found.status, 200);
    assert.deepEqual((await found.json()).product, duplicate);

    assert.equal((await request(ownerToken, productPath, "PATCH", {})).status, 400);
    assert.equal((await request(ownerToken, productPath, "PATCH", { wishlistId: randomUUID() })).status, 400);
    const edited = await request(ownerToken, productPath, "PATCH", { name: "Camisa revisada", price: null });
    assert.equal(edited.status, 200);
    const editedProduct = (await edited.json()).product;
    assert.equal(editedProduct.name, "Camisa revisada");
    assert.equal(editedProduct.price, null);
    assert.equal(editedProduct.url, duplicate.url);
    assert.equal(editedProduct.currency, "BRL");

    assert.equal((await request(ownerToken, productPath, "DELETE")).status, 204);
    assert.equal((await request(ownerToken, productPath)).status, 404);
    assert.equal((await request(ownerToken, productPath, "DELETE")).status, 404);
    const wishlist = await request(ownerToken, `/wishlists/${wishlistId}`);
    assert.equal((await wishlist.json()).wishlist.productCount, 1);
  } finally {
    try {
      await prisma.user.deleteMany({ where: { id: { in: [ownerId, visitorId] } } });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      await prisma.$disconnect();
    }
  }
});
