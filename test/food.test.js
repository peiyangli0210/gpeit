import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
process.env.NODE_ENV = "test";
process.env.DATA_DIR = mkdtempSync(`${tmpdir()}/gpeit-food-`);
process.env.AI_KEY_ENCRYPTION_SECRET =
  "food-test-only-server-secret-at-least-32-characters";
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
const entry = (date, calories = 350, name = "Oatmeal") => ({
  date,
  calories,
  name,
  meal: "Breakfast",
});

test("historical food totals, corrections, missing days, leap dates and user isolation", async () => {
  assert.equal(
    (await call("/foods/history?start=2024-02-28&end=2024-03-02")).status,
    401,
  );
  const register = (email) =>
    call("/auth/register", "POST", {
      name: "Food tester",
      email,
      password: "food-test-password-123",
    });
  const a = await register("history-a@example.com"),
    b = await register("history-b@example.com");
  const first = await call("/foods", "POST", entry("2024-02-29"), a.cookie);
  assert.equal(first.status, 201);
  await call("/foods", "POST", entry("2024-02-29", 500, "Lunch"), a.cookie);
  await call(
    "/foods",
    "POST",
    entry("2024-03-01", 0, "Unsweetened tea"),
    a.cookie,
  );
  await call(
    "/foods",
    "POST",
    entry("2024-02-29", 9999, "Other user meal"),
    b.cookie,
  );
  let result = await call(
    "/foods/history?start=2024-02-28&end=2024-03-02",
    "GET",
    null,
    a.cookie,
  );
  assert.equal(result.status, 200);
  assert.equal(result.body.days.length, 4);
  assert.deepEqual(
    result.body.days.map((d) => [d.date, d.calories, d.entries]),
    [
      ["2024-02-28", 0, 0],
      ["2024-02-29", 850, 2],
      ["2024-03-01", 0, 1],
      ["2024-03-02", 0, 0],
    ],
  );
  assert.equal(
    (
      await call(
        "/foods/" + first.body.id,
        "PATCH",
        entry("2024-03-02", 400),
        b.cookie,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await call(
        "/foods/" + first.body.id,
        "PATCH",
        entry("2024-03-02", 400),
        a.cookie,
      )
    ).status,
    200,
  );
  result = await call(
    "/foods/history?start=2024-02-28&end=2024-03-02",
    "GET",
    null,
    a.cookie,
  );
  assert.equal(result.body.days[1].calories, 500);
  assert.equal(result.body.days[3].calories, 400);
  await call("/foods/" + first.body.id, "DELETE", null, a.cookie);
  result = await call(
    "/foods/history?start=2024-03-02&end=2024-03-02",
    "GET",
    null,
    a.cookie,
  );
  assert.deepEqual(result.body.days, [
    { date: "2024-03-02", calories: 0, entries: 0 },
  ]);
  assert.equal(
    (await call("/foods", "POST", entry("2026-02-29"), a.cookie)).status,
    400,
  );
  for (const query of [
    "start=2024-03-02&end=2024-02-28",
    "start=2024-02-30&end=2024-03-02",
    "start=2024-01-01&end=2025-01-01",
    "start=2024-01-01",
  ])
    assert.equal(
      (await call("/foods/history?" + query, "GET", null, a.cookie)).status,
      400,
    );
  assert.equal(
    (
      await call(
        "/foods/history?start=2024-01-01&end=2024-12-31",
        "GET",
        null,
        a.cookie,
      )
    ).body.days.length,
    366,
  );
});

test("planned meals have private CRUD and never count as eaten; AI review selects only the plan", async () => {
  const nativeFetch = globalThis.fetch;
  const analyses = [];
  globalThis.fetch = async (url, options = {}) => {
    const address = String(url);
    if (address.startsWith("https://api.openai.com/v1/")) {
      if (address.includes("/models/"))
        return Response.json({ id: "gpt-4.1-mini" });
      analyses.push(JSON.parse(options.body));
      return Response.json({
        output: [
          {
            content: [
              { type: "output_text", text: "A balanced proposed week." },
            ],
          },
        ],
      });
    }
    if (!address.startsWith(base))
      throw new Error("Unexpected external request");
    return nativeFetch(url, options);
  };
  try {
    const register = (email) =>
      call("/auth/register", "POST", {
        name: "Plan tester",
        email,
        password: "food-plan-test-password-123",
      });
    const a = await register("plan-a@example.com"),
      b = await register("plan-b@example.com");
    assert.equal(
      (await call("/food-plans?start=2027-03-01&end=2027-03-07")).status,
      401,
    );
    const plan = await call(
      "/food-plans",
      "POST",
      entry("2027-03-01", 600, "Planned salmon bowl"),
      a.cookie,
    );
    assert.equal(plan.status, 201);
    await call(
      "/food-plans",
      "POST",
      { ...entry("2027-03-02", 500, "Planned pasta"), meal: "Dinner" },
      a.cookie,
    );
    await call(
      "/food-plans",
      "POST",
      entry("2027-03-08", 700, "Following week meal"),
      a.cookie,
    );
    await call(
      "/food-plans",
      "POST",
      entry("2027-03-01", 900, "Other user secret plan"),
      b.cookie,
    );
    let week = (
      await call(
        "/food-plans?start=2027-03-01&end=2027-03-07",
        "GET",
        null,
        a.cookie,
      )
    ).body;
    assert.equal(week.length, 2);
    assert.equal(
      week.reduce((n, f) => n + f.calories, 0),
      1100,
    );
    assert.equal(
      (await call("/foods?date=2027-03-01", "GET", null, a.cookie)).body.length,
      0,
    );
    assert.equal(
      (
        await call(
          "/foods/history?start=2027-03-01&end=2027-03-07",
          "GET",
          null,
          a.cookie,
        )
      ).body.days.reduce((n, d) => n + d.calories, 0),
      0,
    );
    assert.equal(
      (await call("/food-plans/" + plan.body.id, "DELETE", null, b.cookie))
        .status,
      404,
    );
    assert.equal(
      (
        await call(
          "/food-plans/" + plan.body.id,
          "PATCH",
          entry("2027-03-03", 650),
          b.cookie,
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await call(
          "/food-plans/" + plan.body.id,
          "PATCH",
          entry("2027-03-03", 650, "Updated planned bowl"),
          a.cookie,
        )
      ).status,
      200,
    );
    week = (
      await call(
        "/food-plans?start=2027-03-01&end=2027-03-07",
        "GET",
        null,
        a.cookie,
      )
    ).body;
    assert.equal(week.find((f) => f.id === plan.body.id).date, "2027-03-03");
    assert.equal(
      week.reduce((n, f) => n + f.calories, 0),
      1150,
    );
    for (const data of [
      entry("2027-02-30"),
      entry("2027-03-01", -1),
      entry("2027-03-01", 1.5),
      { ...entry("2027-03-01"), meal: "Invalid" },
    ])
      assert.equal(
        (await call("/food-plans", "POST", data, a.cookie)).status,
        400,
      );
    await call(
      "/foods",
      "POST",
      entry("2027-03-03", 800, "Actually eaten food"),
      a.cookie,
    );
    await call(
      "/ai-connection",
      "PUT",
      { key: "sk-test-meal-plan-personal-key-1234567", model: "gpt-4.1-mini" },
      a.cookie,
    );
    const review = await call(
      "/analyze",
      "POST",
      { tool: "diet", scope: "plan", start: "2027-03-01", end: "2027-03-07" },
      a.cookie,
    );
    assert.equal(review.status, 200);
    assert.match(analyses.at(-1).instructions, /planned meals/);
    assert.match(analyses.at(-1).input, /Updated planned bowl/);
    assert.doesNotMatch(
      analyses.at(-1).input,
      /Other user|Following week|Actually eaten/,
    );
    assert.equal(
      (
        await call(
          "/analyze",
          "POST",
          {
            tool: "diet",
            scope: "plan",
            start: "2027-03-01",
            end: "2027-04-07",
          },
          a.cookie,
        )
      ).status,
      400,
    );
    assert.equal(
      (await call("/food-plans/" + plan.body.id, "DELETE", null, a.cookie))
        .status,
      200,
    );
    assert.equal(
      (await call("/foods?date=2027-03-03", "GET", null, a.cookie)).body[0]
        .calories,
      800,
    );
  } finally {
    globalThis.fetch = nativeFetch;
  }
});
