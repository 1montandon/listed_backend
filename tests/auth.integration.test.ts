import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { app } from "../src/app.ts";
import { env } from "../src/config/env.ts";
import { prisma } from "../src/db/prisma.ts";

test("cadastro, login, perfil e rotação de sessão", async () => {
  const server = app.listen(0);
  const address = server.address();
  assert.ok(address && typeof address !== "string");

  const baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
  const email = `auth-test-${randomUUID()}@example.com`;
  const password = "uma-senha-de-teste-segura";
  const username = `u_${randomUUID().replaceAll("-", "").slice(0, 24)}`;

  async function post(path: string, body: object, cookie?: string): Promise<Response> {
    return fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        Origin: env.FRONTEND_ORIGIN,
        "Content-Type": "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: JSON.stringify(body),
    });
  }

  try {
    const registered = await post("/auth/register", { name: "Pessoa Teste", username, email: email.toUpperCase(), password });
    assert.equal(registered.status, 201);
    const registerBody = await registered.json();
    assert.equal(registerBody.user.email, email);
    assert.equal(typeof registerBody.accessToken, "string");
    assert.equal("passwordHash" in registerBody.user, false);
    const registerSetCookie = registered.headers.get("set-cookie");
    assert.match(registerSetCookie ?? "", /HttpOnly/i);
    assert.match(registerSetCookie ?? "", /SameSite=Lax/i);

    const duplicate = await post("/auth/register", { name: "Outra", username: `x_${username}`, email, password });
    assert.equal(duplicate.status, 409);

    const wrongPassword = await post("/auth/login", { email, password: "errada" });
    assert.equal(wrongPassword.status, 401);

    const loggedIn = await post("/auth/login", { email, password });
    assert.equal(loggedIn.status, 200);
    const loginBody = await loggedIn.json();
    const oldCookie = loggedIn.headers.get("set-cookie")?.split(";")[0];
    assert.ok(oldCookie);

    const me = await fetch(`${baseUrl}/me`, {
      headers: { Authorization: `Bearer ${loginBody.accessToken}` },
    });
    assert.equal(me.status, 200);
    assert.equal((await me.json()).user.email, email);

    const updated = await fetch(`${baseUrl}/me`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${loginBody.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Novo nome" }),
    });
    assert.equal(updated.status, 200);
    assert.equal((await updated.json()).user.name, "Novo nome");

    const refreshed = await post("/auth/refresh", {}, oldCookie);
    assert.equal(refreshed.status, 200);
    const newCookie = refreshed.headers.get("set-cookie")?.split(";")[0];
    assert.ok(newCookie);
    assert.notEqual(newCookie, oldCookie);

    const replay = await post("/auth/refresh", {}, oldCookie);
    assert.equal(replay.status, 401);

    const concurrent = await Promise.all([
      post("/auth/refresh", {}, newCookie),
      post("/auth/refresh", {}, newCookie),
    ]);
    assert.deepEqual(concurrent.map((response) => response.status).sort(), [200, 401]);
    const activeCookie = concurrent.find((response) => response.status === 200)?.headers.get("set-cookie")?.split(";")[0];
    assert.ok(activeCookie);

    const loggedOut = await post("/auth/logout", {}, activeCookie);
    assert.equal(loggedOut.status, 204);
    const afterLogout = await post("/auth/refresh", {}, activeCookie);
    assert.equal(afterLogout.status, 401);

    const withoutAccessToken = await fetch(`${baseUrl}/me`);
    assert.equal(withoutAccessToken.status, 401);

    const withoutOrigin = await fetch(`${baseUrl}/auth/refresh`, {
      method: "POST",
      headers: { Cookie: newCookie },
    });
    assert.equal(withoutOrigin.status, 403);
  } finally {
    await prisma.user.deleteMany({ where: { email } });
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await prisma.$disconnect();
  }
});
