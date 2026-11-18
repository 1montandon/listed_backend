import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { Client } from "pg";
import { env } from "../src/config/env.ts";

test("migração preserva produtos antigos e inicializa comprado como false", async () => {
  const initial = await readFile(new URL("../prisma/migrations/20261108040512_init/migration.sql", import.meta.url), "utf8");
  const migration = await readFile(new URL("../prisma/migrations/20261118020000_product_purchased/migration.sql", import.meta.url), "utf8");
  const client = new Client({ connectionString: env.DATABASE_URL });
  await client.connect();
  const schema = `purchased_test_${randomUUID().replaceAll("-", "")}`;
  const userId = randomUUID();
  const listId = randomUUID();
  const productId = randomUUID();
  try {
    await client.query("BEGIN");
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET LOCAL search_path TO "${schema}"`);
    await client.query(initial);
    await client.query('INSERT INTO users (id, name, email, password_hash, updated_at) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)', [userId, "Pessoa", "purchased@example.com", "fixture"]);
    await client.query('INSERT INTO wishlists (id, user_id, name, updated_at) VALUES ($1, $2, $3, CURRENT_TIMESTAMP)', [listId, userId, "Presentes"]);
    await client.query('INSERT INTO saved_products (id, wishlist_id, name, url, price, updated_at) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)', [productId, listId, "Livro", "https://example.com", "19.90"]);
    const before = await client.query('SELECT * FROM saved_products WHERE id = $1', [productId]);
    await client.query(migration);
    const after = await client.query('SELECT * FROM saved_products WHERE id = $1', [productId]);
    const { is_purchased, ...originalFields } = after.rows[0];
    assert.equal(is_purchased, false);
    assert.deepEqual(originalFields, before.rows[0]);
  } finally {
    try { await client.query("ROLLBACK"); } finally { await client.end(); }
  }
});
