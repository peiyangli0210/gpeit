import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
process.env.NODE_ENV = "test";
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
  const a = await call("/auth/register", "POST", account("alex@example.com"));
  assert.equal(a.status, 200);
  assert.ok(a.cookie);
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
