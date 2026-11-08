import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { app } from "../src/app.ts";
import { env } from "../src/config/env.ts";
import { prisma } from "../src/db/prisma.ts";

test("wishlists privadas, contagem e exclusão em cascata", async () => {
  const server = app.listen(0);
  const address = server.address();
  assert.ok(address && typeof address !== "string");

  const baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
  const emails = [
    `wishlist-a-${randomUUID()}@example.com`,
    `wishlist-b-${randomUUID()}@example.com`,
  ] as const;

  async function register(email: string): Promise<string> {
    const response = await fetch(`${baseUrl}/auth/register`, {
      method: "POST",
      headers: { Origin: env.FRONTEND_ORIGIN, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Pessoa Teste", email, password: "uma-senha-de-teste-segura" }),
    });
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(typeof body.accessToken, "string");
    return body.accessToken;
  }

  async function request(token: string, path: string, method = "GET", body?: object): Promise<Response> {
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
    const [tokenA, tokenB] = await Promise.all([register(emails[0]), register(emails[1])]);

    const created = await request(tokenA, "/wishlists", "POST", { name: "  Presentes  " });
    assert.equal(created.status, 201);
    const createdBody = await created.json();
    const wishlistId: string = createdBody.wishlist.id;
    assert.equal(createdBody.wishlist.name, "Presentes");
    assert.equal(createdBody.wishlist.productCount, 0);

    const ownerList = await request(tokenA, "/wishlists");
    assert.equal(ownerList.status, 200);
    assert.equal((await ownerList.json()).wishlists.length, 1);

    const otherList = await request(tokenB, "/wishlists");
    assert.equal(otherList.status, 200);
    assert.deepEqual((await otherList.json()).wishlists, []);

    assert.equal((await request(tokenB, `/wishlists/${wishlistId}`)).status, 404);
    assert.equal((await request(tokenB, `/wishlists/${wishlistId}`, "PATCH", { name: "Invadida" })).status, 404);
    assert.equal((await request(tokenB, `/wishlists/${wishlistId}`, "DELETE")).status, 404);
    assert.equal((await request(tokenA, "/wishlists/invalida")).status, 400);
    assert.equal((await request(tokenA, "/wishlists", "POST", { name: "   " })).status, 400);

    const renamed = await request(tokenA, `/wishlists/${wishlistId}`, "PATCH", { name: "Casa" });
    assert.equal(renamed.status, 200);
    assert.equal((await renamed.json()).wishlist.name, "Casa");

    // A API de produtos virá depois. Criamos o registro diretamente para
    // verificar a contagem e a cascata já definidas no esquema do banco.
    const product = await prisma.savedProduct.create({
      data: { wishlistId, name: "Produto teste", url: "https://example.com/produto" },
    });
    const withProduct = await request(tokenA, `/wishlists/${wishlistId}`);
    assert.equal(withProduct.status, 200);
    assert.equal((await withProduct.json()).wishlist.productCount, 1);

    const deleted = await request(tokenA, `/wishlists/${wishlistId}`, "DELETE");
    assert.equal(deleted.status, 204);
    assert.equal(await prisma.savedProduct.findUnique({ where: { id: product.id } }), null);
    assert.equal((await request(tokenA, `/wishlists/${wishlistId}`)).status, 404);

    const withoutToken = await fetch(`${baseUrl}/wishlists`);
    assert.equal(withoutToken.status, 401);
  } finally {
    await prisma.user.deleteMany({ where: { email: { in: [...emails] } } });
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await prisma.$disconnect();
  }
});
