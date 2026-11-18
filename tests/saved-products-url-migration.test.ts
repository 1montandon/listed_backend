import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { Client } from "pg";
import { env } from "../src/config/env.ts";

test("migração de URL opcional preserva produtos existentes e permite null", async () => {
  const initialMigration = await readFile(
    new URL("../prisma/migrations/20261108040512_init/migration.sql", import.meta.url), "utf8",
  );
  const optionalUrlMigration = await readFile(
    new URL("../prisma/migrations/20261118000000_saved_product_url_optional/migration.sql", import.meta.url), "utf8",
  );
  const database = new Client({ connectionString: env.DATABASE_URL });
  await database.connect();

  // Um schema PostgreSQL é um espaço de nomes para tabelas. Criamos um exclusivo
  // deste teste para aplicar a migração antiga sem tocar nas tabelas da aplicação.
  // O nome vem de um UUID nosso (somente letras, números e _), não da entrada HTTP.
  const schemaName = `migration_test_${randomUUID().replaceAll("-", "")}`;
  const userId = randomUUID();
  const wishlistId = randomUUID();
  const productId = randomUUID();

  try {
    await database.query("BEGIN");
    await database.query(`CREATE SCHEMA "${schemaName}"`);
    // SET LOCAL vale só dentro desta transação. Os SQLs de migração usam nomes
    // de tabela sem schema; search_path os direciona ao espaço isolado do teste.
    await database.query(`SET LOCAL search_path TO "${schemaName}"`);
    await database.query(initialMigration);
    await database.query(
      'INSERT INTO users (id, name, email, password_hash, updated_at) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)',
      [userId, "Pessoa Teste", "migration@example.com", "fixture"],
    );
    await database.query(
      'INSERT INTO wishlists (id, user_id, name, updated_at) VALUES ($1, $2, $3, CURRENT_TIMESTAMP)',
      [wishlistId, userId, "Presentes"],
    );
    await database.query(
      `INSERT INTO saved_products
        (id, wishlist_id, name, url, image_url, price, currency, store_name, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)`,
      [productId, wishlistId, "Produto antigo", "https://loja.example/produto",
        "https://loja.example/foto.jpg", "279.90", "BRL", "Loja Exemplo"],
    );

    const before = await database.query('SELECT * FROM saved_products WHERE id = $1', [productId]);
    const previousColumn = await database.query(
      `SELECT is_nullable FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = 'saved_products' AND column_name = 'url'`,
      [schemaName],
    );
    assert.equal(previousColumn.rows[0].is_nullable, "NO");

    await database.query(optionalUrlMigration);

    // Comparamos a linha inteira, incluindo IDs, datas, preço e relacionamento.
    // Testar só em banco vazio não detectaria perda de dados antigos.
    const after = await database.query('SELECT * FROM saved_products WHERE id = $1', [productId]);
    assert.deepEqual(after.rows, before.rows);

    const newProductId = randomUUID();
    const manualProduct = await database.query(
      `INSERT INTO saved_products (id, wishlist_id, name, updated_at)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP) RETURNING url`,
      [newProductId, wishlistId, "Produto sem link"],
    );
    assert.equal(manualProduct.rows[0].url, null);

    const clearedProduct = await database.query(
      'UPDATE saved_products SET url = NULL WHERE id = $1 RETURNING url', [productId],
    );
    assert.equal(clearedProduct.rows[0].url, null);
  } finally {
    try {
      // PostgreSQL também desfaz CREATE SCHEMA/TABLE no rollback: nenhuma tabela
      // ou fixture deste teste fica no banco, inclusive quando uma asserção falha.
      await database.query("ROLLBACK");
    } finally {
      await database.end();
    }
  }
});
