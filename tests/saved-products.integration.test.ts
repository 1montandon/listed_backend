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
      { ...minimum, url: "" },
      { ...minimum, url: "   " },
      { ...minimum, url: 123 },
      { ...minimum, url: "ftp://loja.example/produto" },
      { ...minimum, price: 25.5 },
      { ...minimum, price: "0.001" },
      { ...minimum, price: "10000000000.00" },
    ]) {
      assert.equal((await request(ownerToken, "/products", "POST", invalidBody)).status, 400);
    }

    // E1.1: dentro de uma lista própria, só o nome é obrigatório no produto.
    // Os mesmos endpoints precisam distinguir campo omitido, null e texto inválido.
    const nameOnly = { wishlistId, name: "  Presente sem link  " };
    assert.equal((await request(visitorToken, "/products", "POST", nameOnly)).status, 404);
    const withoutUrl = await request(ownerToken, "/products", "POST", nameOnly);
    assert.equal(withoutUrl.status, 201);
    const nameOnlyProduct = (await withoutUrl.json()).product;
    assert.equal(nameOnlyProduct.name, "Presente sem link");
    for (const field of ["url", "imageUrl", "price", "currency", "storeName"]) {
      assert.equal(nameOnlyProduct[field], null);
    }

    const explicitNull = await request(ownerToken, "/products", "POST", { ...nameOnly, url: null });
    assert.equal(explicitNull.status, 201);
    const nullUrlProduct = (await explicitNull.json()).product;
    assert.equal(nullUrlProduct.url, null);
    const listWithoutUrls = await request(ownerToken, listPath);
    assert.equal(listWithoutUrls.status, 200);
    const savedWithoutUrls = (await listWithoutUrls.json()).products;
    assert.equal(savedWithoutUrls.length, 2);
    assert.ok(savedWithoutUrls.every((item: { url: string | null }) => item.url === null));

    const nameOnlyPath = `/products/${nameOnlyProduct.id}`;
    assert.equal((await request(visitorToken, nameOnlyPath)).status, 404);
    assert.equal((await request(visitorToken, nameOnlyPath, "PATCH", { url })).status, 404);
    assert.equal((await request(visitorToken, nameOnlyPath, "DELETE")).status, 404);

    const addUrl = await request(ownerToken, nameOnlyPath, "PATCH", { url });
    assert.equal(addUrl.status, 200);
    assert.equal((await addUrl.json()).product.url, url);
    const keepUrl = await request(ownerToken, nameOnlyPath, "PATCH", { name: "Presente revisado" });
    assert.equal(keepUrl.status, 200);
    assert.equal((await keepUrl.json()).product.url, url);

    for (const invalidUrl of ["", "   ", "sem-protocolo", "ftp://loja.example/produto", 123]) {
      const invalidUpdate = await request(ownerToken, nameOnlyPath, "PATCH", { url: invalidUrl });
      assert.equal(invalidUpdate.status, 400);
    }
    const afterInvalidUpdate = await request(ownerToken, nameOnlyPath);
    assert.equal((await afterInvalidUpdate.json()).product.url, url);

    const removeUrl = await request(ownerToken, nameOnlyPath, "PATCH", { url: null });
    assert.equal(removeUrl.status, 200);
    assert.equal((await removeUrl.json()).product.url, null);
    const reloadWithoutUrl = await request(ownerToken, nameOnlyPath);
    assert.equal(reloadWithoutUrl.status, 200);
    assert.equal((await reloadWithoutUrl.json()).product.url, null);
    const persisted = await prisma.savedProduct.findUniqueOrThrow({ where: { id: nameOnlyProduct.id } });
    assert.equal(persisted.url, null);
    assert.equal(persisted.name, "Presente revisado");

    assert.equal((await request(ownerToken, nameOnlyPath, "DELETE")).status, 204);
    assert.equal((await request(ownerToken, `/products/${nullUrlProduct.id}`, "DELETE")).status, 204);

    // A extração é outra operação: não há página para buscar sem uma URL.
    for (const invalidExtraction of [{}, { url: null }, { url: "" }]) {
      const extraction = await request(ownerToken, "/products/extract", "POST", invalidExtraction);
      assert.equal(extraction.status, 400);
      assert.equal((await extraction.json()).error.code, "VALIDATION_ERROR");
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
