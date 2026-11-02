import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { nextCronRun, createCronService } from "../cron-jobs.js";
process.env.NODE_ENV = "test";
process.env.DATA_DIR = mkdtempSync(`${tmpdir()}/gpeit-cron-`);
process.env.AI_KEY_ENCRYPTION_SECRET =
  "cron-test-only-master-secret-at-least-32-characters";
process.env.GPT_API_KEY = "sk-shared-admin-key-must-not-run-cron-123456";
const { server, cronService } = await import("../server.js");
let base;
before(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await cronService.waitForIdle();
  await new Promise((r) => server.close(r));
  rmSync(process.env.DATA_DIR, { recursive: true, force: true });
});
async function call(path, method = "GET", body, cookie) {
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
const job = {
  name: "Writing ideas",
  prompt: "Write a creative idea.",
  cron: "*/15 * * * *",
  timezone: "America/Los_Angeles",
  enabled: true,
  max_tokens: 1000,
};
test("cron validation and DST-aware next times", () => {
  assert.equal(
    new Date(
      nextCronRun("*/15 * * * *", "UTC", Date.parse("2030-01-01T00:07:00Z")),
    ).toISOString(),
    "2030-01-01T00:15:00.000Z",
  );
  assert.equal(
    new Date(
      nextCronRun(
        "0 9 * * *",
        "America/Los_Angeles",
        Date.parse("2026-03-07T18:00:00Z"),
      ),
    ).toISOString(),
    "2026-03-08T16:00:00.000Z",
  );
  assert.equal(
    new Date(
      nextCronRun(
        "0 9 * * 1-5",
        "America/Los_Angeles",
        Date.parse("2026-11-07T18:00:00Z"),
      ),
    ).toISOString(),
    "2026-11-09T17:00:00.000Z",
  );
  for (const cron of ["bad", "* * * * * *", "61 * * * *", "0 0 31 2 *"])
    assert.throws(() => nextCronRun(cron, "UTC"), { status: 400 });
  assert.throws(() => nextCronRun("0 9 * * *", "Not/AZone"), { status: 400 });
});

test("task lifecycle and owned scheduled GPT execution, logs, errors and billing", async () => {
  const nativeFetch = globalThis.fetch,
    db = new DatabaseSync(`${process.env.DATA_DIR}/app.sqlite`);
  const calls = [];
  let failProvider = false,
    holdProvider = false,
    release;
  globalThis.fetch = async (url, options = {}) => {
    const address = String(url);
    if (address.startsWith("https://api.openai.com/v1/")) {
      if (address.includes("/models/"))
        return Response.json({ id: "gpt-4.1-mini" });
      calls.push({
        auth: options.headers.Authorization,
        body: JSON.parse(options.body),
      });
      if (holdProvider) await new Promise((r) => (release = r));
      if (failProvider)
        return Response.json(
          { error: "Never log sk-provider-secret-echo" },
          { status: 429 },
        );
      return Response.json({
        output: [
          {
            content: [
              { type: "output_text", text: "A fresh idea from your schedule." },
            ],
          },
        ],
        usage: { input_tokens: 30, output_tokens: 50 },
      });
    }
    if (!address.startsWith(base))
      throw new Error("Unexpected external request");
    return nativeFetch(url, options);
  };
  try {
    const register = (email) =>
      call("/auth/register", "POST", {
        name: "Cron tester",
        email,
        password: "a-long-test-password-123",
      });
    const a = await register("cron-a@example.com"),
      b = await register("cron-b@example.com");
    const task = await call(
      "/todos",
      "POST",
      { title: "Work on this", status: "in_progress" },
      a.cookie,
    );
    assert.equal(task.body.status, "in_progress");
    assert.equal(task.body.done, 0);
    assert.equal(
      (
        await call(
          "/todos/" + task.body.id,
          "PATCH",
          { status: "done" },
          b.cookie,
        )
      ).status,
      404,
    );
    await call("/todos/" + task.body.id, "PATCH", { status: "done" }, a.cookie);
    let tasks = (await call("/todos", "GET", null, a.cookie)).body;
    assert.equal(tasks[0].done, 1);
    assert.equal(tasks[0].status, "done");
    await call(
      "/todos/" + task.body.id,
      "PATCH",
      { status: "not_started" },
      a.cookie,
    );
    assert.equal((await call("/todos", "GET", null, a.cookie)).body[0].done, 0);
    assert.equal(
      (
        await call(
          "/todos/" + task.body.id,
          "PATCH",
          { status: "invalid" },
          a.cookie,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await call(
          "/todos",
          "POST",
          { title: "Bad", status: "invalid" },
          a.cookie,
        )
      ).status,
      400,
    );
    assert.equal((await call("/cron/jobs")).status, 401);
    assert.equal((await call("/cron/jobs", "POST", job, a.cookie)).status, 409);
    const draft = await call(
      "/cron/jobs",
      "POST",
      { ...job, enabled: false },
      a.cookie,
    );
    assert.equal(draft.status, 201);
    assert.equal(
      (await call("/cron/jobs/" + draft.body.id + "/run", "POST", {}, a.cookie))
        .status,
      409,
    );
    assert.equal(calls.length, 0); // No shared billing even though the server has a key.
    assert.equal(
      (
        await call(
          "/cron/jobs",
          "POST",
          { ...job, cron: "invalid", enabled: false },
          a.cookie,
        )
      ).status,
      400,
    );
    const keyA = "sk-personal-cron-owner-a-123456789",
      keyB = "sk-personal-cron-owner-b-123456789";
    await call(
      "/ai-connection",
      "PUT",
      { key: keyA, model: "gpt-4.1-mini" },
      a.cookie,
    );
    await call(
      "/ai-connection",
      "PUT",
      { key: keyB, model: "gpt-4.1" },
      b.cookie,
    );
    const enabled = await call(
      "/cron/jobs/" + draft.body.id,
      "PATCH",
      { enabled: true },
      a.cookie,
    );
    assert.equal(enabled.status, 200);
    assert.equal(
      (await call("/cron/jobs", "GET", null, b.cookie)).body.length,
      0,
    );
    for (const [suffix, method, data] of [
      ["/run", "POST", {}],
      ["/runs", "GET", null],
      ["", "PATCH", { enabled: false }],
      ["", "DELETE", null],
    ])
      assert.equal(
        (
          await call(
            "/cron/jobs/" + draft.body.id + suffix,
            method,
            data,
            b.cookie,
          )
        ).status,
        404,
      );
    const manual = await call(
      "/cron/jobs/" + draft.body.id + "/run",
      "POST",
      {},
      a.cookie,
    );
    assert.equal(manual.status, 202);
    await cronService.waitForIdle();
    let logs = (
      await call("/cron/jobs/" + draft.body.id + "/runs", "GET", null, a.cookie)
    ).body.runs;
    assert.equal(logs[0].status, "succeeded");
    assert.equal(logs[0].trigger, "manual");
    assert.equal(logs[0].output, "A fresh idea from your schedule.");
    assert.equal(logs[0].input_tokens, 30);
    assert.equal(logs[0].output_tokens, 50);
    assert.equal(logs[0].model, "gpt-4.1-mini");
    assert.equal(calls.at(-1).auth, `Bearer ${keyA}`);
    assert.equal(calls.at(-1).body.max_output_tokens, 1000);
    assert.equal(JSON.stringify(logs).includes(keyA), false);
    const due = Date.now() - 3600000;
    db.prepare("UPDATE cron_jobs SET next_run=? WHERE id=?").run(
      due,
      draft.body.id,
    );
    const before = calls.length;
    cronService.tick();
    cronService.tick();
    await cronService.waitForIdle();
    assert.equal(calls.length, before + 1);
    assert.ok(
      db.prepare("SELECT next_run FROM cron_jobs WHERE id=?").get(draft.body.id)
        .next_run > Date.now(),
    );
    logs = (
      await call("/cron/jobs/" + draft.body.id + "/runs", "GET", null, a.cookie)
    ).body.runs;
    assert.equal(logs[0].trigger, "scheduled");
    assert.equal(logs[0].scheduled_for, due);
    // Failure is visible, doesn't retry the same occurrence and doesn't leak upstream data.
    failProvider = true;
    const errorRun = await call(
      "/cron/jobs/" + draft.body.id + "/run",
      "POST",
      {},
      a.cookie,
    );
    assert.equal(errorRun.status, 202);
    await cronService.waitForIdle();
    logs = (
      await call("/cron/jobs/" + draft.body.id + "/runs", "GET", null, a.cookie)
    ).body.runs;
    assert.equal(logs[0].status, "failed");
    assert.match(logs[0].error, /billing/);
    assert.equal(logs[0].error.includes("sk-provider"), false);
    const failedCalls = calls.length;
    cronService.tick();
    await cronService.waitForIdle();
    assert.equal(calls.length, failedCalls);
    failProvider = false;
    holdProvider = true;
    assert.equal(
      (await call("/cron/jobs/" + draft.body.id + "/run", "POST", {}, a.cookie))
        .status,
      202,
    );
    assert.equal(
      (await call("/cron/jobs/" + draft.body.id + "/run", "POST", {}, a.cookie))
        .status,
      409,
    );
    assert.equal(
      (await call("/cron/jobs/" + draft.body.id, "DELETE", null, a.cookie))
        .status,
      409,
    );
    assert.equal(
      (
        await call(
          "/cron/jobs/" + draft.body.id,
          "PATCH",
          { enabled: false },
          a.cookie,
        )
      ).status,
      409,
    );
    release();
    holdProvider = false;
    await cronService.waitForIdle();
    const bJob = await call(
      "/cron/jobs",
      "POST",
      { ...job, name: "B job" },
      b.cookie,
    );
    await call("/cron/jobs/" + bJob.body.id + "/run", "POST", {}, b.cookie);
    await cronService.waitForIdle();
    assert.equal(calls.at(-1).auth, `Bearer ${keyB}`);
    await call("/ai-connection", "DELETE", {}, a.cookie);
    assert.equal(
      (await call("/cron/jobs", "GET", null, a.cookie)).body[0].enabled,
      0,
    );
    assert.equal(
      (await call("/cron/jobs/" + draft.body.id + "/run", "POST", {}, a.cookie))
        .status,
      409,
    );
    assert.equal(
      (await call("/cron/jobs", "GET", null, b.cookie)).body[0].enabled,
      1,
    );
    assert.equal(
      (await call("/cron/jobs/" + draft.body.id, "DELETE", null, a.cookie))
        .status,
      200,
    );
    assert.equal(
      (
        await call(
          "/cron/jobs/" + draft.body.id + "/runs",
          "GET",
          null,
          a.cookie,
        )
      ).status,
      404,
    );
  } finally {
    if (release) release();
    await cronService.waitForIdle();
    globalThis.fetch = nativeFetch;
    db.close();
  }
});

test("scheduler restart keeps results and marks uncertain executions interrupted", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(
    "PRAGMA foreign_keys=ON;CREATE TABLE users(id INTEGER PRIMARY KEY);INSERT INTO users VALUES(1);CREATE TABLE ai_connections(user_id INTEGER PRIMARY KEY,model TEXT);INSERT INTO ai_connections VALUES(1,'gpt-4.1-mini');",
  );
  let paidCalls = 0;
  const execute = async () => {
    paidCalls++;
    return { text: "Stored result", model: "gpt-4.1-mini" };
  };
  try {
    const service = createCronService(db, execute),
      job = service.create(1, jobFixture());
    service.runNow(1, job.id);
    await service.waitForIdle();
    db.prepare(
      "INSERT INTO cron_runs(job_id,user_id,trigger,status,started,prompt,model) VALUES(1,1,'scheduled','running',?,?,?)",
    ).run(Date.now(), "Uncertain prompt", "gpt-4.1-mini");
    const restarted = createCronService(db, execute);
    const logs = restarted.history(1, job.id).runs;
    assert.equal(logs[0].status, "interrupted");
    assert.match(logs[0].error, /not automatically retried/);
    assert.equal(logs[1].output, "Stored result");
    restarted.tick();
    await restarted.waitForIdle();
    assert.equal(paidCalls, 1);
  } finally {
    db.close();
  }
});
function jobFixture() {
  return { ...job, enabled: false };
}

test("scheduler enforces per-user/global concurrency and bounds paginated run history", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`PRAGMA foreign_keys=ON;CREATE TABLE users(id INTEGER PRIMARY KEY);INSERT INTO users VALUES(1),(2),(3);
 CREATE TABLE ai_connections(user_id INTEGER PRIMARY KEY,model TEXT);INSERT INTO ai_connections VALUES(1,'gpt-4.1-mini'),(2,'gpt-4.1-mini'),(3,'gpt-4.1-mini');`);
  let hold = true;
  const pending = [];
  const service = createCronService(db, async () => {
    if (hold) await new Promise((r) => pending.push(r));
    return { text: "A result", model: "gpt-4.1-mini" };
  });
  try {
    const a = [1, 2, 3].map(() => service.create(1, jobFixture()));
    const b = [1, 2].map(() => service.create(2, jobFixture()));
    const c = service.create(3, jobFixture());
    service.runNow(1, a[0].id);
    service.runNow(1, a[1].id);
    assert.throws(() => service.runNow(1, a[2].id), { status: 429 });
    service.runNow(2, b[0].id);
    service.runNow(2, b[1].id);
    assert.throws(() => service.runNow(3, c.id), { status: 429 });
    await Promise.resolve();
    assert.equal(pending.length, 4);
    hold = false;
    for (const resolve of pending) resolve();
    await service.waitForIdle();
    service.runNow(3, c.id);
    await service.waitForIdle();
    assert.equal(service.history(3, c.id).runs[0].status, "succeeded");
    const insert = db.prepare(
      "INSERT INTO cron_runs(job_id,user_id,trigger,status,started,prompt,output) VALUES(1,1,'manual','succeeded',?,'Saved prompt','Saved result')",
    );
    for (let i = 0; i < 205; i++) insert.run(Date.now());
    service.runNow(1, a[0].id);
    await service.waitForIdle();
    assert.equal(
      db
        .prepare("SELECT count(*) AS n FROM cron_runs WHERE job_id=?")
        .get(a[0].id).n,
      200,
    );
    const first = service.history(1, a[0].id),
      second = service.history(1, a[0].id, first.nextCursor);
    assert.equal(first.runs.length, 25);
    assert.equal(second.runs.length, 25);
    assert.ok(second.runs[0].id < first.runs.at(-1).id);
    assert.throws(() => service.history(2, a[0].id), { status: 404 });
  } finally {
    hold = false;
    for (const resolve of pending) resolve();
    await service.waitForIdle();
    db.close();
  }
});
