import { CronExpressionParser } from "cron-parser";

function fail(status, message) {
  throw Object.assign(new Error(message), { status });
}
function text(value, max, label) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max)
    fail(400, `Enter a valid ${label}.`);
  return value.trim();
}
export function nextCronRun(cron, timezone, now = Date.now()) {
  if (
    typeof cron !== "string" ||
    cron.trim().split(/\s+/).length !== 5 ||
    cron.length > 200
  )
    fail(
      400,
      "Use a five-field cron expression: minute hour day month weekday.",
    );
  if (typeof timezone !== "string" || timezone.length > 100)
    fail(400, "Choose a valid IANA time zone.");
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone });
  } catch {
    fail(
      400,
      "Choose a valid IANA time zone, for example America/Los_Angeles.",
    );
  }
  try {
    return CronExpressionParser.parse(cron, {
      tz: timezone,
      currentDate: new Date(now),
    })
      .next()
      .toDate()
      .getTime();
  } catch {
    fail(
      400,
      "This cron expression has no valid upcoming run. Check its fields.",
    );
  }
}

export function createCronService(db, execute) {
  db.exec(`CREATE TABLE IF NOT EXISTS cron_jobs(
 id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL REFERENCES users(id),name TEXT NOT NULL,prompt TEXT NOT NULL,
 cron TEXT NOT NULL,timezone TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1,max_tokens INTEGER NOT NULL DEFAULT 1000,
 next_run INTEGER NOT NULL,created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS cron_runs(
 id INTEGER PRIMARY KEY AUTOINCREMENT,job_id INTEGER NOT NULL REFERENCES cron_jobs(id) ON DELETE CASCADE,
 user_id INTEGER NOT NULL REFERENCES users(id),trigger TEXT NOT NULL,status TEXT NOT NULL,
 scheduled_for INTEGER,started INTEGER NOT NULL,finished INTEGER,prompt TEXT NOT NULL,model TEXT,output TEXT,error TEXT,
 input_tokens INTEGER,output_tokens INTEGER);
 CREATE UNIQUE INDEX IF NOT EXISTS cron_one_active_run ON cron_runs(job_id) WHERE status='running';
 CREATE INDEX IF NOT EXISTS cron_due ON cron_jobs(enabled,next_run);
 CREATE INDEX IF NOT EXISTS cron_run_history ON cron_runs(user_id,job_id,id DESC);`);
  // Never replay a paid request whose outcome is unknown after a restart.
  db.prepare(
    "UPDATE cron_runs SET status='interrupted',finished=?,error=? WHERE status='running'",
  ).run(
    Date.now(),
    "The server restarted during this run. Its outcome is unknown; it was not automatically retried. Check API usage before running again.",
  );
  const one = (sql, ...p) => db.prepare(sql).get(...p),
    all = (sql, ...p) => db.prepare(sql).all(...p),
    run = (sql, ...p) => db.prepare(sql).run(...p);
  const active = new Map();
  const jobFor = (uid, id) => {
    const j = one("SELECT * FROM cron_jobs WHERE id=? AND user_id=?", id, uid);
    if (!j) fail(404, "Scheduled job not found.");
    return j;
  };
  const personal = (uid) => {
    if (!one("SELECT user_id FROM ai_connections WHERE user_id=?", uid))
      fail(
        409,
        "Connect your personal OpenAI API key in Settings before enabling or running a scheduled job.",
      );
  };
  function fields(b) {
    const name = text(b.name, 120, "job name"),
      prompt = text(b.prompt, 8000, "prompt");
    if (typeof b.enabled !== "boolean")
      fail(400, "Choose whether this job is enabled.");
    const cron = text(b.cron, 200, "cron schedule"),
      timezone = text(b.timezone, 100, "time zone");
    const maxTokens = b.max_tokens ?? 1000;
    if (!Number.isInteger(maxTokens) || maxTokens < 100 || maxTokens > 4000)
      fail(400, "Output limit must be 100–4,000 tokens.");
    return {
      name,
      prompt,
      cron,
      timezone,
      enabled: b.enabled ? 1 : 0,
      maxTokens,
      next: nextCronRun(cron, timezone),
    };
  }
  function list(uid) {
    return all(
      `SELECT cron_jobs.*,
 (SELECT status FROM cron_runs WHERE job_id=cron_jobs.id ORDER BY id DESC LIMIT 1) AS last_status,
 (SELECT started FROM cron_runs WHERE job_id=cron_jobs.id ORDER BY id DESC LIMIT 1) AS last_run
 FROM cron_jobs WHERE user_id=? ORDER BY id DESC`,
      uid,
    );
  }
  function create(uid, b) {
    if (one("SELECT count(*) AS n FROM cron_jobs WHERE user_id=?", uid).n >= 20)
      fail(400, "You can save up to 20 scheduled jobs.");
    const f = fields(b);
    if (f.enabled) personal(uid);
    const id = Number(
      run(
        "INSERT INTO cron_jobs(user_id,name,prompt,cron,timezone,enabled,max_tokens,next_run,created) VALUES(?,?,?,?,?,?,?,?,?)",
        uid,
        f.name,
        f.prompt,
        f.cron,
        f.timezone,
        f.enabled,
        f.maxTokens,
        f.next,
        Date.now(),
      ).lastInsertRowid,
    );
    return jobFor(uid, id);
  }
  function update(uid, id, b) {
    const job = jobFor(uid, id),
      f = fields({ ...job, enabled: !!job.enabled, ...b });
    if (f.enabled) personal(uid);
    if (one("SELECT id FROM cron_runs WHERE job_id=? AND status='running'", id))
      fail(
        409,
        "Wait for the active run to finish before editing or pausing this job.",
      );
    run(
      "UPDATE cron_jobs SET name=?,prompt=?,cron=?,timezone=?,enabled=?,max_tokens=?,next_run=? WHERE id=? AND user_id=?",
      f.name,
      f.prompt,
      f.cron,
      f.timezone,
      f.enabled,
      f.maxTokens,
      f.next,
      id,
      uid,
    );
    return jobFor(uid, id);
  }
  function remove(uid, id) {
    jobFor(uid, id);
    if (one("SELECT id FROM cron_runs WHERE job_id=? AND status='running'", id))
      fail(409, "Wait for the active run to finish before deleting this job.");
    run("DELETE FROM cron_jobs WHERE id=? AND user_id=?", id, uid);
  }
  function history(uid, id, before) {
    jobFor(uid, id);
    if (before !== undefined && (!Number.isSafeInteger(before) || before < 1))
      fail(400, "Invalid log cursor.");
    const rows = all(
      "SELECT * FROM cron_runs WHERE job_id=? AND user_id=? AND id<? ORDER BY id DESC LIMIT 26",
      id,
      uid,
      before ?? Number.MAX_SAFE_INTEGER,
    );
    return {
      runs: rows.slice(0, 25),
      nextCursor: rows.length > 25 ? rows[24].id : null,
    };
  }
  function launch(job, trigger, now = Date.now()) {
    if (
      active.size >= 4 ||
      [...active.values()].filter((v) => v.uid === job.user_id).length >= 2
    )
      fail(429, "Execution capacity is busy. Try again shortly.");
    if (
      one(
        "SELECT id FROM cron_runs WHERE job_id=? AND status='running'",
        job.id,
      )
    )
      fail(409, "This job already has a run in progress.");
    let id;
    db.exec("BEGIN IMMEDIATE");
    try {
      id = Number(
        run(
          "INSERT INTO cron_runs(job_id,user_id,trigger,status,scheduled_for,started,prompt,model) VALUES(?,?,?,'running',?,?,?,?)",
          job.id,
          job.user_id,
          trigger,
          trigger === "scheduled" ? job.next_run : null,
          now,
          job.prompt,
          one("SELECT model FROM ai_connections WHERE user_id=?", job.user_id)
            ?.model ?? null,
        ).lastInsertRowid,
      );
      if (trigger === "scheduled")
        run(
          "UPDATE cron_jobs SET next_run=? WHERE id=?",
          nextCronRun(job.cron, job.timezone, now),
          job.id,
        );
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    // Defer to a microtask so callers receive the running log before a provider call starts.
    const promise = Promise.resolve().then(async () => {
      try {
        const result = await execute(job.user_id, job.prompt, job.max_tokens);
        run(
          "UPDATE cron_runs SET status='succeeded',finished=?,model=?,output=?,input_tokens=?,output_tokens=? WHERE id=?",
          Date.now(),
          result.model,
          result.text,
          result.usage?.input_tokens ?? null,
          result.usage?.output_tokens ?? null,
          id,
        );
      } catch (e) {
        run(
          "UPDATE cron_runs SET status='failed',finished=?,error=? WHERE id=?",
          Date.now(),
          e.status
            ? e.message
            : "The AI request failed. Check your connection and try again.",
          id,
        );
      } finally {
        active.delete(id);
        run(
          "DELETE FROM cron_runs WHERE job_id=? AND status!='running' AND id NOT IN (SELECT id FROM cron_runs WHERE job_id=? ORDER BY id DESC LIMIT 200)",
          job.id,
          job.id,
        );
      }
    });
    active.set(id, { uid: job.user_id, promise });
    return one("SELECT * FROM cron_runs WHERE id=?", id);
  }
  function runNow(uid, id) {
    const job = jobFor(uid, id);
    personal(uid);
    return launch(job, "manual");
  }
  function tick(now = Date.now()) {
    for (const job of all(
      "SELECT * FROM cron_jobs WHERE enabled=1 AND next_run<=? ORDER BY next_run LIMIT 20",
      now,
    )) {
      try {
        launch(job, "scheduled", now);
      } catch (e) {
        if (e.status !== 409 && e.status !== 429) throw e;
      }
    }
  }
  async function waitForIdle() {
    while (active.size)
      await Promise.all([...active.values()].map((v) => v.promise));
  }
  return { list, create, update, remove, history, runNow, tick, waitForIdle };
}
