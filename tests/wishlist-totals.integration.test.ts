import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { app } from "../src/app.ts";
import { prisma } from "../src/db/prisma.ts";
import { createAccessToken } from "../src/shared/auth/access-token.ts";

test("totais em uma moeda indicam valores excluídos sem conversão", async () => {
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/api/v1`;
  const ownerId = randomUUID(), otherId = randomUUID(), listId = randomUUID();
  const route = `/wishlists/${listId}/totals`;
  function get(token: string, query: string): Promise<Response> {
    return fetch(base + route + query, { headers: { Authorization: `Bearer ${token}` } });
  }
  try {
    await prisma.user.createMany({ data: [ownerId, otherId].map((id) => ({ id,
      username: `u_${id.replaceAll("-", "").slice(0, 24)}`, name: "Pessoa", email: `totals-${id}@example.com`, passwordHash: "fixture" })) });
    await prisma.wishlist.create({ data: { id: listId, userId: ownerId, name: "Lista" } });
    const owner = await createAccessToken(ownerId), other = await createAccessToken(otherId);
    assert.equal((await fetch(base + route + "?currency=BRL")).status, 401);
    assert.equal((await get(other, "?currency=BRL")).status, 404);
    assert.equal((await get(owner, "")).status, 400);
    assert.equal((await get(owner, "?currency=JPY")).status, 400);
    assert.equal((await get(owner, "?currency=BRL&unknown=1")).status, 400);
    const empty = await get(owner, "?currency=BRL");
    assert.equal(empty.status, 200);
    assert.deepEqual((await empty.json()).totals, { currency: "BRL", all: {
      amountCents: 0, productCount: 0, included: 0, excluded: { missingPrice: 0, missingCurrency: 0, otherCurrency: 0 }, isComplete: true,
    }, remaining: {
      amountCents: 0, productCount: 0, included: 0, excluded: { missingPrice: 0, missingCurrency: 0, otherCurrency: 0 }, isComplete: true,
    } });
    const items = [
      { name: "Um", priceCents: 10n, currency: "BRL", isPurchased: false },
      { name: "Dois", priceCents: 20n, currency: "BRL", isPurchased: true },
      { name: "Zero", priceCents: 0n, currency: "BRL", isPurchased: false },
      { name: "Sem preço e moeda", priceCents: null, currency: null, isPurchased: false },
      { name: "Sem moeda", priceCents: 400n, currency: null, isPurchased: false },
      { name: "Dólar", priceCents: 500n, currency: "USD", isPurchased: true },
      { name: "Legado", priceCents: 600n, currency: "JPY", isPurchased: false },
    ];
    await prisma.savedProduct.createMany({ data: items.map((item) => ({ ...item, wishlistId: listId })) });
    const response = await get(owner, "?currency=BRL");
    const { totals } = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(totals.all, { amountCents: 30, productCount: 7, included: 3,
      excluded: { missingPrice: 1, missingCurrency: 1, otherCurrency: 2 }, isComplete: false });
    assert.deepEqual(totals.remaining, { amountCents: 10, productCount: 5, included: 2,
      excluded: { missingPrice: 1, missingCurrency: 1, otherCurrency: 1 }, isComplete: false });
    const dollar = (await (await get(owner, "?currency=USD")).json()).totals;
    assert.equal(dollar.all.amountCents, 500);
    assert.equal(dollar.remaining.amountCents, 0);
    await prisma.savedProduct.updateMany({ where: { wishlistId: listId }, data: { isPurchased: true } });
    const allBought = (await (await get(owner, "?currency=BRL")).json()).totals;
    assert.deepEqual(allBought.remaining, { amountCents: 0, productCount: 0, included: 0,
      excluded: { missingPrice: 0, missingCurrency: 0, otherCurrency: 0 }, isComplete: true });

    // Um único preço cabe no JSON, mas 9.008 preços no limite já excedem
    // Number.MAX_SAFE_INTEGER em centavos. Inserimos as linhas de uma vez.
    await prisma.$executeRaw`
      INSERT INTO saved_products (id, wishlist_id, name, price_cents, currency, updated_at)
      SELECT gen_random_uuid(), ${listId}::uuid, 'Produto caro', 999999999999, 'BRL', CURRENT_TIMESTAMP
      FROM generate_series(1, 9008)
    `;
    const overflow = await get(owner, "?currency=BRL");
    assert.equal(overflow.status, 422);
    assert.equal((await overflow.json()).error.code, "TOTAL_OUT_OF_RANGE");
  } finally {
    try { await prisma.user.deleteMany({ where: { id: { in: [ownerId, otherId] } } }); }
    finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await prisma.$disconnect();
    }
  }
});
