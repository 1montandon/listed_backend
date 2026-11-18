import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { Client } from "pg";
import { env } from "../src/config/env.ts";

test("migração gera usernames únicos e preserva contas existentes", async () => {
  const initial = await readFile(new URL("../prisma/migrations/20261108040512_init/migration.sql", import.meta.url), "utf8");
  const migration = await readFile(new URL("../prisma/migrations/20261118010000_profile_username/migration.sql", import.meta.url), "utf8");
  const client = new Client({ connectionString: env.DATABASE_URL });
  await client.connect();
  const schema = `profile_test_${randomUUID().replaceAll("-", "")}`;
  try {
    await client.query("BEGIN");
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET LOCAL search_path TO "${schema}"`);
    await client.query(initial);
    const ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    const names = ["João Silva", "Joao Silva", "!", "Eduardo Montandon"];
    for (let i = 0; i < ids.length; i++) {
      await client.query('INSERT INTO users (id, name, email, password_hash, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $5)',
        [ids[i], names[i], `migration${i}@example.com`, "fixture", new Date(2020, 0, 1 + i)]);
    }
    const before = await client.query('SELECT id, name, email, password_hash, created_at, updated_at FROM users ORDER BY created_at');
    await client.query(migration);
    const after = await client.query('SELECT id, name, email, password_hash, created_at, updated_at, username, bio, preferred_currency FROM users ORDER BY created_at');
    assert.deepEqual(after.rows.map(({ username, bio, preferred_currency, ...old }) => old), before.rows);
    assert.deepEqual(after.rows.map((row) => row.username), ["joaosilva", "joaosilva2", "usuario", "eduardomontandon"]);
    assert.ok(after.rows.every((row) => row.bio === null && row.preferred_currency === "BRL"));
  } finally {
    try { await client.query("ROLLBACK"); } finally { await client.end(); }
  }
});
