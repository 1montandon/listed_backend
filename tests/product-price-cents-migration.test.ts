import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { Client } from "pg";
import { env } from "../src/config/env.ts";

test("migra preços para centavos sem alterar os demais dados", async () => {
  const migrationNames = [
    "20261108040512_init",
    "20261118000000_saved_product_url_optional",
    "20261118010000_profile_username",
    "20261118020000_product_purchased",
    "20261118030000_product_price_cents",
  ] as const;
  const readMigration = (name: typeof migrationNames[number]) => readFile(
    new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url), "utf8",
  );

  const database = new Client({ connectionString: env.DATABASE_URL });
  const schema = `price_test_${randomUUID().replaceAll("-", "")}`;
  const userId = randomUUID();
  const wishlistId = randomUUID();
  await database.connect();

  try {
    // O schema isolado permite executar a migração real, incluindo seu COMMIT,
    // sem trocar a coluna usada pelos outros testes ou pela aplicação.
    await database.query(`CREATE SCHEMA "${schema}"`);
    await database.query(`SET search_path TO "${schema}"`);
    for (const name of migrationNames.slice(0, -1)) {
      await database.query(await readMigration(name));
    }

    await database.query(
      "INSERT INTO users (id, name, username, email, password_hash, updated_at) VALUES ($1, 'Teste', 'teste', 'price@example.com', 'fixture', CURRENT_TIMESTAMP)",
      [userId],
    );
    await database.query(
      "INSERT INTO wishlists (id, user_id, name, updated_at) VALUES ($1, $2, 'Presentes', CURRENT_TIMESTAMP)",
      [wishlistId, userId],
    );

    const cases = [
      { name: "ausente", price: null, cents: null },
      { name: "centavo", price: "0.01", cents: "1" },
      { name: "comum", price: "279.90", cents: "27990" },
      { name: "legado negativo", price: "-0.01", cents: "-1" },
      { name: "limite", price: "9999999999.99", cents: "999999999999" },
      { name: "zero", price: "0.00", cents: "0" },
    ];
    for (const item of cases) {
      await database.query(
        `INSERT INTO saved_products (id, wishlist_id, name, price, currency, is_purchased, updated_at)
         VALUES ($1, $2, $3, $4, 'BRL', true, CURRENT_TIMESTAMP)`,
        [randomUUID(), wishlistId, item.name, item.price],
      );
    }

    const before = await database.query("SELECT * FROM saved_products ORDER BY id");
    await database.query(await readMigration("20261118030000_product_price_cents"));
    const after = await database.query("SELECT * FROM saved_products ORDER BY id");

    // pg devolve BIGINT como texto para não perder precisão.
    const centsByName = new Map(after.rows.map((row) => [row.name, row.price_cents]));
    for (const item of cases) {
      assert.equal(centsByName.get(item.name), item.cents);
    }
    assert.deepEqual(
      after.rows.map(({ price_cents, ...row }) => row),
      before.rows.map(({ price, ...row }) => row),
    );
  } finally {
    try {
      // Se a migração falhar dentro do BEGIN, liberamos a transação antes da limpeza.
      await database.query("ROLLBACK");
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    } finally {
      await database.end();
    }
  }
});
