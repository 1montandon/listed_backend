import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { app } from "../src/app.ts";
import { env } from "../src/config/env.ts";
import { prisma } from "../src/db/prisma.ts";

test("cadastro e perfil validam username, nome, bio e moeda", async () => {
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/api/v1`;
  const suffix = randomUUID().replaceAll("-", "").slice(0, 18);
  const emails = [`profile1-${suffix}@example.com`, `profile2-${suffix}@example.com`, `profile3-${suffix}@example.com`];
  const username = `p_${suffix}`;
  const password = "uma-senha-de-teste-segura";
  function post(body: object): Promise<Response> {
    return fetch(`${base}/auth/register`, { method: "POST", headers: { Origin: env.FRONTEND_ORIGIN, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  }
  function patch(token: string, body: object): Promise<Response> {
    return fetch(`${base}/me`, { method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  }
  try {
    for (const body of [
      { name: "Pessoa 123", username, email: emails[0], password },
      { name: "Pessoa!", username, email: emails[0], password },
      { name: "Pessoa", email: emails[0], password },
      { name: "Pessoa", username: "áéí", email: emails[0], password },
      { name: "Pessoa", username: "ab", email: emails[0], password },
    ]) assert.equal((await post(body)).status, 400);
    const registered = await post({ name: "  João Silva  ", username: username.toUpperCase(), email: emails[0], password });
    assert.equal(registered.status, 201);
    const session = await registered.json();
    assert.equal(session.user.name, "João Silva");
    assert.equal(session.user.username, username);
    assert.equal(session.user.bio, null);
    assert.equal(session.user.preferredCurrency, "BRL");
    const duplicate = await post({ name: "Outra Pessoa", username, email: emails[1], password });
    assert.equal(duplicate.status, 409);
    assert.equal((await duplicate.json()).error.code, "USERNAME_ALREADY_EXISTS");
    const second = await post({ name: "Outra Pessoa", username: `q_${suffix}`, email: emails[1], password });
    assert.equal(second.status, 201);
    const other = await second.json();
    const duplicateUpdate = await patch(other.accessToken, { username: username.toUpperCase() });
    assert.equal(duplicateUpdate.status, 409);
    assert.equal((await duplicateUpdate.json()).error.code, "USERNAME_ALREADY_EXISTS");
    assert.equal((await patch(session.accessToken, {})).status, 400);
    assert.equal((await patch(session.accessToken, { preferredCurrency: "JPY" })).status, 400);
    assert.equal((await patch(session.accessToken, { name: "Pessoa 9" })).status, 400);
    const updated = await patch(session.accessToken, { bio: "  Olá!  ", preferredCurrency: "USD" });
    assert.equal(updated.status, 200);
    const profile = (await updated.json()).user;
    assert.equal(profile.bio, "Olá!");
    assert.equal(profile.preferredCurrency, "USD");
    assert.equal(profile.username, username);
    const cleared = await patch(session.accessToken, { bio: null, username: `novo_${suffix}` });
    assert.equal(cleared.status, 200);
    const changed = (await cleared.json()).user;
    assert.equal(changed.bio, null);
    assert.equal(changed.preferredCurrency, "USD");
    assert.equal(changed.username, `novo_${suffix}`);
    const me = await fetch(`${base}/me`, { headers: { Authorization: `Bearer ${session.accessToken}` } });
    assert.equal((await me.json()).user.username, `novo_${suffix}`);
    // Unicidade deve valer mesmo quando duas requisições chegam juntas.
    const shared = `c_${suffix}`;
    const attempts = await Promise.all([
      patch(session.accessToken, { username: shared }),
      patch(other.accessToken, { username: shared.toUpperCase() }),
    ]);
    assert.deepEqual(attempts.map((response) => response.status).sort(), [200, 409]);
  } finally {
    try { await prisma.user.deleteMany({ where: { email: { in: emails } } }); }
    finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await prisma.$disconnect();
    }
  }
});
