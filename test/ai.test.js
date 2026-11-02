import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { encryptAIKey, decryptAIKey } from "../ai-keys.js";
process.env.NODE_ENV = "test";
process.env.DATA_DIR = mkdtempSync(`${tmpdir()}/gpeit-ai-`);
const secret = "test-only-encryption-secret-of-at-least-32-characters";
process.env.AI_KEY_ENCRYPTION_SECRET = secret;
delete process.env.GPT_API_KEY;
const { server } = await import("../server.js");
let base;
before(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise((r) => server.close(r));
  rmSync(process.env.DATA_DIR, { recursive: true, force: true });
});
async function request(path, method = "GET", body, cookie) {
  const r = await fetch(base + "/api" + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return {
    status: r.status,
    body: await r.json(),
    cookie: r.headers.get("set-cookie")?.split(";")[0],
  };
}
const keyA = "sk-test-personal-key-for-user-a-12345",
  keyB = "sk-test-personal-key-for-user-b-12345",
  replacement = "sk-test-replacement-key-for-user-a-12345";
test("personal AI keys stay encrypted and isolated throughout verification, analysis, replacement and removal", async () => {
  const nativeFetch = globalThis.fetch,
    db = new DatabaseSync(`${process.env.DATA_DIR}/app.sqlite`);
  const calls = [];
  let responseStatus = 200;
  globalThis.fetch = async (url, options = {}) => {
    const address = String(url);
    if (address.startsWith("https://api.openai.com/v1/")) {
      calls.push({
        path: address,
        authorization: options.headers.Authorization,
        body: options.body ? JSON.parse(options.body) : null,
      });
      if (options.headers.Authorization === "Bearer sk-invalid-key-1234567890")
        return Response.json(
          { error: { message: "Never echo sk-invalid-key-1234567890" } },
          { status: 401 },
        );
      if (address.endsWith("/models/unavailable-model"))
        return Response.json({ error: "No access" }, { status: 404 });
      if (address.includes("/models/"))
        return Response.json({ id: address.split("/").at(-1) });
      return Response.json(
        responseStatus === 200
          ? {
              output: [
                {
                  content: [
                    { type: "output_text", text: "A useful private analysis." },
                  ],
                },
              ],
            }
          : { error: { message: `Provider echoed ${keyA}` } },
        { status: responseStatus },
      );
    }
    if (!address.startsWith(base))
      throw new Error("Unexpected external request");
    return nativeFetch(url, options);
  };
  try {
    assert.equal((await request("/ai-connection")).status, 401);
    const register = (email) =>
      request("/auth/register", "POST", {
        email,
        name: "API user",
        password: "test-password-for-ai-42",
      });
    const a = await register("ai-a@example.com"),
      b = await register("ai-b@example.com");
    assert.equal(
      (await request("/ai-connection", "GET", null, a.cookie)).body.source,
      "none",
    );
    assert.equal(
      (
        await request(
          "/ai-connection",
          "PUT",
          { model: "gpt-4.1-mini" },
          a.cookie,
        )
      ).status,
      400,
    );
    const saved = await request(
      "/ai-connection",
      "PUT",
      { key: keyA, model: "gpt-4.1-mini" },
      a.cookie,
    );
    assert.equal(saved.status, 200);
    assert.equal(saved.body.source, "personal");
    assert.equal(JSON.stringify(saved.body).includes(keyA), false);
    await request(
      "/ai-connection",
      "PUT",
      { key: keyB, model: "gpt-4.1" },
      b.cookie,
    );
    let stored = db
      .prepare("SELECT * FROM ai_connections WHERE user_id=?")
      .get(a.body.id);
    assert.ok(stored.encrypted_key.startsWith("v1:"));
    assert.equal(stored.encrypted_key.includes(keyA), false);
    assert.equal(
      decryptAIKey(stored.encrypted_key, a.body.id, process.env.DATA_DIR),
      keyA,
    );
    assert.throws(() =>
      decryptAIKey(stored.encrypted_key, b.body.id, process.env.DATA_DIR),
    );
    assert.notEqual(
      encryptAIKey(keyA, a.body.id, process.env.DATA_DIR),
      stored.encrypted_key,
    );
    for (const path of ["/me", "/ai-connection"]) {
      const text = JSON.stringify(
        (await request(path, "GET", null, a.cookie)).body,
      );
      assert.equal(text.includes(keyA), false);
      assert.equal(text.includes(stored.encrypted_key), false);
    }
    await request("/todos", "POST", { title: "User A private task" }, a.cookie);
    await request("/todos", "POST", { title: "User B private task" }, b.cookie);
    assert.equal(
      (await request("/analyze", "POST", { tool: "todos" }, a.cookie)).status,
      200,
    );
    let call = calls.at(-1);
    assert.equal(call.authorization, `Bearer ${keyA}`);
    assert.equal(call.body.model, "gpt-4.1-mini");
    assert.match(call.body.input, /User A private task/);
    assert.doesNotMatch(call.body.input, /User B/);
    await request("/analyze", "POST", { tool: "todos" }, b.cookie);
    assert.equal(calls.at(-1).authorization, `Bearer ${keyB}`);
    assert.equal(calls.at(-1).body.model, "gpt-4.1");
    assert.equal(
      (await request("/messages", "GET", null, b.cookie)).body.length,
      1,
    );
    // Failed verification preserves the working connection and does not echo provider errors.
    const invalid = await request(
      "/ai-connection",
      "PUT",
      { key: "sk-invalid-key-1234567890", model: "gpt-4.1" },
      a.cookie,
    );
    assert.equal(invalid.status, 400);
    assert.doesNotMatch(JSON.stringify(invalid.body), /sk-invalid/);
    assert.equal(
      (
        await request(
          "/ai-connection",
          "PUT",
          { model: "unavailable-model" },
          a.cookie,
        )
      ).status,
      400,
    );
    assert.equal(
      (await request("/ai-connection", "GET", null, a.cookie)).body.model,
      "gpt-4.1-mini",
    );
    // Blank key keeps the saved key while changing the model.
    assert.equal(
      (
        await request(
          "/ai-connection",
          "PUT",
          { key: "", model: "gpt-4.1" },
          a.cookie,
        )
      ).status,
      200,
    );
    assert.equal(calls.at(-1).authorization, `Bearer ${keyA}`);
    await request(
      "/ai-connection",
      "PUT",
      { key: replacement, model: "gpt-4.1-mini", user_id: b.body.id },
      a.cookie,
    );
    await request("/analyze", "POST", { tool: "todos" }, a.cookie);
    assert.equal(calls.at(-1).authorization, `Bearer ${replacement}`);
    await request("/analyze", "POST", { tool: "todos" }, b.cookie);
    assert.equal(calls.at(-1).authorization, `Bearer ${keyB}`);
    process.env.GPT_API_KEY = "sk-test-admin-shared-key-1234567890";
    responseStatus = 429;
    const countBefore = calls.length;
    const limited = await request(
      "/analyze",
      "POST",
      { tool: "todos" },
      a.cookie,
    );
    assert.equal(limited.status, 429);
    assert.equal(calls.length, countBefore + 1);
    assert.equal(calls.at(-1).authorization, `Bearer ${replacement}`);
    assert.doesNotMatch(JSON.stringify(limited.body), /sk-/);
    responseStatus = 200;
    // Wrong master secret fails closed, without using the administrator's key.
    process.env.AI_KEY_ENCRYPTION_SECRET =
      "a-different-long-encryption-secret-123456";
    const beforeDecrypt = calls.length;
    assert.equal(
      (await request("/analyze", "POST", { tool: "todos" }, a.cookie)).status,
      503,
    );
    assert.equal(calls.length, beforeDecrypt);
    process.env.AI_KEY_ENCRYPTION_SECRET = secret;
    await request("/ai-connection", "DELETE", {}, a.cookie);
    assert.equal(
      db.prepare("SELECT * FROM ai_connections WHERE user_id=?").get(a.body.id),
      undefined,
    );
    assert.equal(
      (await request("/ai-connection", "GET", null, a.cookie)).body.source,
      "shared",
    );
    await request("/analyze", "POST", { tool: "todos" }, a.cookie);
    assert.equal(
      calls.at(-1).authorization,
      `Bearer ${process.env.GPT_API_KEY}`,
    );
    assert.equal(
      (await request("/ai-connection", "GET", null, b.cookie)).body.connected,
      true,
    );
    // Production will not accept user credentials without a server-side encryption secret.
    delete process.env.AI_KEY_ENCRYPTION_SECRET;
    process.env.NODE_ENV = "production";
    assert.equal(
      (await request("/ai-connection", "GET", null, a.cookie)).body
        .personalAvailable,
      false,
    );
    assert.equal(
      (
        await request(
          "/ai-connection",
          "PUT",
          { key: keyA, model: "gpt-4.1-mini" },
          a.cookie,
        )
      ).status,
      503,
    );
    process.env.NODE_ENV = "test";
  } finally {
    globalThis.fetch = nativeFetch;
    db.close();
    delete process.env.GPT_API_KEY;
    process.env.NODE_ENV = "test";
    process.env.AI_KEY_ENCRYPTION_SECRET = secret;
  }
});

test("local development keys remain usable across master-key reads", () => {
  const directory = mkdtempSync(`${tmpdir()}/gpeit-key-storage-`);
  const previous = process.env.AI_KEY_ENCRYPTION_SECRET;
  delete process.env.AI_KEY_ENCRYPTION_SECRET;
  try {
    const encrypted = encryptAIKey(keyA, 123, directory);
    // Each call reloads the persisted key, as it would after a server restart.
    assert.equal(decryptAIKey(encrypted, 123, directory), keyA);
    assert.throws(() => decryptAIKey(encrypted, 456, directory));
  } finally {
    process.env.AI_KEY_ENCRYPTION_SECRET = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});
