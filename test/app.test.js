import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
process.env.NODE_ENV = "test";
// Render's generated HTTPS origin must work without manually setting APP_URL.
delete process.env.APP_URL;
process.env.RENDER_EXTERNAL_URL = "https://gpeit-test.onrender.com";
process.env.DATA_DIR = mkdtempSync(`${tmpdir()}/gpeit-test-`);
const { server, reminders } = await import("../server.js");
let base;
before(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise((r) => server.close(r));
  rmSync(process.env.DATA_DIR, { recursive: true, force: true });
});
async function call(path, method = "GET", body, cookie, headers = {}) {
  const r = await fetch(base + "/api" + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { cookie } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return {
    status: r.status,
    body: await r.json(),
    cookie: r.headers.get("set-cookie")?.split(";")[0],
    setCookie: r.headers.get("set-cookie"),
  };
}
const account = (email) => ({
  name: "Alex",
  email,
  password: "strong-passphrase-42",
});
test("authenticated tools preserve ownership and persist useful data", async () => {
  assert.equal((await call("/todos")).status, 401);
  assert.equal(
    (await call("/auth/register", "POST", { ...account("bad"), email: "bad" }))
      .status,
    400,
  );
  const a = await call(
    "/auth/register",
    "POST",
    account("alex@example.com"),
    undefined,
    { origin: process.env.RENDER_EXTERNAL_URL },
  );
  assert.equal(a.status, 200);
  assert.ok(a.cookie);
  assert.match(a.setCookie, /; Secure/);
  const b = await call("/auth/register", "POST", account("sam@example.com"));
  assert.equal(b.status, 200);
  assert.equal(
    (await call("/auth/register", "POST", account("alex@example.com"))).status,
    409,
  );
  const task = await call(
    "/todos",
    "POST",
    {
      title: "Plan next week",
      due: "2030-01-01T12:00:00Z",
      remind: "2030-01-01T11:00:00Z",
    },
    a.cookie,
  );
  assert.equal(task.status, 201);
  assert.equal((await call("/todos", "GET", null, b.cookie)).body.length, 0);
  assert.equal(
    (await call("/todos/" + task.body.id, "PATCH", { done: true }, b.cookie))
      .status,
    404,
  );
  assert.equal(
    (await call("/todos/" + task.body.id, "DELETE", null, b.cookie)).status,
    404,
  );
  assert.equal(
    (await call("/todos/" + task.body.id, "PATCH", { done: true }, a.cookie))
      .status,
    200,
  );
  assert.equal((await call("/todos", "GET", null, a.cookie)).body[0].done, 1);
  assert.equal(
    (
      await call("/todos", "POST", { title: "Wrong origin" }, a.cookie, {
        origin: "https://attacker.example",
      })
    ).status,
    403,
  );
  const food = await call(
    "/foods",
    "POST",
    { name: "Oatmeal", calories: 350, meal: "Breakfast", date: "2026-11-01" },
    a.cookie,
  );
  assert.equal(food.status, 201);
  await call(
    "/foods",
    "POST",
    { name: "Lunch", calories: 550, meal: "Lunch", date: "2026-11-01" },
    a.cookie,
  );
  const diary = await call("/foods?date=2026-11-01", "GET", null, a.cookie);
  assert.equal(
    diary.body.reduce((n, f) => n + f.calories, 0),
    900,
  );
  assert.equal(
    (await call("/foods?date=2026-11-02", "GET", null, a.cookie)).body.length,
    0,
  );
  assert.equal(
    (await call("/foods?date=2026-11-01", "GET", null, b.cookie)).body.length,
    0,
  );
  assert.equal(
    (await call("/foods/" + food.body.id, "DELETE", null, b.cookie)).status,
    404,
  );
  assert.equal(
    (
      await call(
        "/foods",
        "POST",
        { name: "Bad", calories: -1, meal: "Lunch", date: "2026-11-01" },
        a.cookie,
      )
    ).status,
    400,
  );
  assert.equal(
    (await call("/settings", "PATCH", { goal: 2400 }, a.cookie)).status,
    200,
  );
  assert.equal((await call("/me", "GET", null, a.cookie)).body.goal, 2400);
  assert.equal((await call("/me", "GET", null, b.cookie)).body.goal, 2000);
  await call(
    "/messages",
    "POST",
    { tool: "todos", body: "Remember your priorities" },
    a.cookie,
  );
  assert.equal((await call("/messages", "GET", null, b.cookie)).body.length, 0);
  assert.equal(
    (await call("/messages", "GET", null, a.cookie)).body[0].body,
    "Remember your priorities",
  );
  // Seed an elapsed reminder to exercise the actual worker without waiting.
  const db = new DatabaseSync(`${process.env.DATA_DIR}/app.sqlite`);
  db.prepare("INSERT INTO todos(user_id,title,remind) VALUES(?,?,?)").run(
    a.body.id,
    "Time to stretch",
    "2000-01-01T00:00:00.000Z",
  );
  db.close();
  await reminders();
  await reminders();
  const notes = (await call("/messages", "GET", null, a.cookie)).body;
  assert.equal(
    notes.filter((n) => n.body === "Reminder: Time to stretch").length,
    1,
  );
  assert.equal(
    (
      await call(
        "/messages",
        "POST",
        { tool: "todos", body: "Email this", email: true },
        a.cookie,
      )
    ).status,
    503,
  );
  assert.equal(
    (await call("/analyze", "POST", { tool: "todos" }, a.cookie)).status,
    503,
  );
  assert.equal(
    (await call("/todos/" + task.body.id + "/calendar", "POST", {}, a.cookie))
      .status,
    409,
  );
  assert.equal((await call("/auth/logout", "POST", {}, a.cookie)).status, 200);
  assert.equal((await call("/me", "GET", null, a.cookie)).status, 401);
  assert.equal(
    (
      await call("/auth/login", "POST", {
        email: "alex@example.com",
        password: "incorrect-password",
      })
    ).status,
    401,
  );
  const login = await call("/auth/login", "POST", account("alex@example.com"));
  assert.equal(login.status, 200);
  assert.equal(
    (await call("/foods?date=2026-11-01", "GET", null, login.cookie)).body
      .length,
    2,
  );
  const html = await fetch(base);
  assert.equal(html.status, 200);
  assert.match(await html.text(), /Your everyday toolkit/);
  assert.equal((await fetch(base + "/app.js")).status, 200);
});

test("Gmail permissions, MIME messages, and durable Calendar create/delete retries", async () => {
  const { processCalendarQueue } = await import("../server.js");
  const db = new DatabaseSync(`${process.env.DATA_DIR}/app.sqlite`);
  const nativeFetch = globalThis.fetch;
  const scopes =
    "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/gmail.send";
  let createStatus = 200,
    deleteStatus = 204,
    gmailStatus = 200;
  const sent = [],
    events = [];
  process.env.GOOGLE_CLIENT_ID = "test-client";
  process.env.GOOGLE_CLIENT_SECRET = "test-secret";
  globalThis.fetch = async (url, options = {}) => {
    const address = String(url);
    if (address === "https://oauth2.googleapis.com/token") {
      const params = new URLSearchParams(options.body);
      if (params.get("grant_type") === "authorization_code")
        return Response.json({
          access_token: "access-1",
          refresh_token: "test-refresh",
          scope: scopes,
        });
      return Response.json({
        access_token: "access-" + params.get("refresh_token"),
      });
    }
    if (address.startsWith("https://www.googleapis.com/calendar/v3/")) {
      events.push({
        url: address,
        ...options,
        payload: options.body ? JSON.parse(options.body) : null,
      });
      const status = options.method === "DELETE" ? deleteStatus : createStatus;
      return new Response(status === 204 ? null : "{}", { status });
    }
    if (
      address === "https://gmail.googleapis.com/gmail/v1/users/me/messages/send"
    ) {
      sent.push({
        headers: options.headers,
        raw: Buffer.from(JSON.parse(options.body).raw, "base64url").toString(),
      });
      return Response.json(
        gmailStatus === 200 ? { id: "sent-id" } : { error: "denied" },
        { status: gmailStatus },
      );
    }
    if (!address.startsWith(base))
      throw new Error("Unexpected external call: " + address);
    return nativeFetch(url, options);
  };
  try {
    const a = await call(
      "/auth/register",
      "POST",
      account("google-owner@example.com"),
    );
    const b = await call(
      "/auth/register",
      "POST",
      account("google-other@example.com"),
    );
    assert.equal(
      (
        await call(
          "/messages",
          "POST",
          { tool: "todos", body: "Hello", channel: "gmail" },
          a.cookie,
        )
      ).status,
      409,
    );
    // Grant consent using the real app redirect/callback flow and mocked token exchange.
    const connect = await fetch(base + "/api/google/connect", {
      headers: { cookie: a.cookie },
      redirect: "manual",
    });
    assert.equal(connect.status, 302);
    const authUrl = new URL(connect.headers.get("location"));
    assert.equal(authUrl.searchParams.get("scope"), scopes);
    const state = authUrl.searchParams.get("state");
    const callback = await fetch(
      base + "/api/google/callback?code=test&state=" + state,
      { headers: { cookie: a.cookie }, redirect: "manual" },
    );
    assert.equal(callback.status, 302);
    assert.equal(
      (await call("/me", "GET", null, a.cookie)).body.integrations.gmail,
      true,
    );
    const note = {
      tool: "diet",
      body: "Lunch: 鸡肉 🥗",
      channel: "gmail",
      to: "friend@example.com",
      subject: "今日饮食",
    };
    assert.equal((await call("/messages", "POST", note, a.cookie)).status, 200);
    assert.equal(sent.length, 1);
    assert.match(sent[0].raw, /To: friend@example.com\r\n/);
    assert.match(sent[0].raw, /Subject: =\?UTF-8\?B\?/);
    assert.equal(
      Buffer.from(
        sent[0].raw.split("\r\n\r\n")[1].replace(/\r\n/g, ""),
        "base64",
      ).toString(),
      note.body,
    );
    assert.equal(sent[0].headers.Authorization, "Bearer access-test-refresh");
    assert.equal(
      (
        await call(
          "/messages",
          "POST",
          { ...note, to: "friend@example.com\r\nBcc: attacker@example.com" },
          a.cookie,
        )
      ).status,
      400,
    );
    assert.equal(sent.length, 1);
    assert.equal((await call("/messages", "POST", note, b.cookie)).status, 409);
    gmailStatus = 403;
    const before = (await call("/messages", "GET", null, a.cookie)).body.length;
    assert.equal((await call("/messages", "POST", note, a.cookie)).status, 502);
    assert.equal(
      (await call("/messages", "GET", null, a.cookie)).body.length,
      before,
    );
    gmailStatus = 200;
    const task = await call(
      "/todos",
      "POST",
      { title: "Automatic event", due: "2030-01-01T12:00:00Z" },
      a.cookie,
    );
    assert.equal(task.status, 201);
    assert.ok(task.body.event_id);
    assert.equal(events.at(-1).method, "POST");
    assert.equal(events.at(-1).payload.summary, "Automatic event");
    assert.equal(
      (await call("/calendar/status", "GET", null, a.cookie)).body.length,
      0,
    );
    const callsBefore = events.length;
    assert.equal(
      (await call("/todos/" + task.body.id, "DELETE", null, b.cookie)).status,
      404,
    );
    assert.equal(events.length, callsBefore);
    deleteStatus = 503;
    assert.equal(
      (await call("/todos/" + task.body.id, "DELETE", null, a.cookie)).status,
      200,
    );
    assert.equal((await call("/todos", "GET", null, a.cookie)).body.length, 0);
    const jobs = (await call("/calendar/status", "GET", null, a.cookie)).body;
    assert.equal(jobs[0].operation, "delete");
    assert.match(jobs[0].last_error, /503/);
    assert.equal(
      (await call("/calendar/status", "GET", null, b.cookie)).body.length,
      0,
    );
    // Deleted last row IDs may be reused by SQLite: new event IDs must stay distinct.
    createStatus = 503;
    const retryTask = await call(
      "/todos",
      "POST",
      { title: "Retry me", due: "2030-02-01T12:00:00Z" },
      a.cookie,
    );
    assert.notEqual(retryTask.body.event_id, task.body.event_id);
    assert.equal(
      (await call("/calendar/status", "GET", null, a.cookie)).body.length,
      2,
    );
    // Google 409 means creation previously succeeded; 404 deletion is already complete.
    createStatus = 409;
    deleteStatus = 404;
    assert.equal(
      (await call("/calendar/retry", "POST", {}, a.cookie)).status,
      200,
    );
    assert.equal(
      (await call("/calendar/status", "GET", null, a.cookie)).body.length,
      0,
    );
    assert.ok(
      events.some(
        (e) => e.method === "DELETE" && e.url.endsWith(task.body.event_id),
      ),
    );
    const undated = await call(
      "/todos",
      "POST",
      { title: "Not scheduled" },
      a.cookie,
    );
    assert.equal(undated.body.event_id, null);
    // Reminders use Gmail when consent is present, not an administrator's email sender.
    db.prepare("UPDATE todos SET remind=? WHERE id=?").run(
      "2000-01-01T00:00:00.000Z",
      undated.body.id,
    );
    const sentBefore = sent.length;
    await reminders();
    await reminders();
    assert.equal(sent.length, sentBefore + 1);
    // A durable deletion stays queued while disconnected and completes after reconnect.
    await call("/google/disconnect", "POST", {}, a.cookie);
    await call("/todos/" + retryTask.body.id, "DELETE", null, a.cookie);
    assert.equal(
      (await call("/calendar/status", "GET", null, a.cookie)).body.length,
      1,
    );
    db.prepare(
      "UPDATE settings SET google_refresh=?,google_scopes=? WHERE user_id=?",
    ).run("test-refresh", scopes, a.body.id);
    await processCalendarQueue();
    assert.equal(
      (await call("/calendar/status", "GET", null, a.cookie)).body.length,
      0,
    );
  } finally {
    globalThis.fetch = nativeFetch;
    db.close();
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
  }
});
