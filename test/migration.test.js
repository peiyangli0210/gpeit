import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
test("existing Calendar connection survives additive Gmail migration without granting Gmail", async () => {
  process.env.NODE_ENV = "test";
  process.env.DATA_DIR = mkdtempSync(`${tmpdir()}/gpeit-migrate-`);
  const db = new DatabaseSync(`${process.env.DATA_DIR}/app.sqlite`);
  db.exec(`CREATE TABLE settings(user_id INTEGER PRIMARY KEY,goal INTEGER DEFAULT 2000,google_refresh TEXT);
 INSERT INTO settings VALUES(77,2100,'legacy-test-refresh');
 CREATE TABLE todos(id INTEGER PRIMARY KEY,user_id INTEGER,title TEXT,due TEXT,remind TEXT,done INTEGER DEFAULT 0,event_id TEXT,reminded INTEGER DEFAULT 0);
 INSERT INTO todos(user_id,title,done) VALUES(77,'Completed before migration',1),(77,'Pending before migration',0);`);
  try {
    await import("../server.js");
    const s = db.prepare("SELECT * FROM settings WHERE user_id=77").get();
    assert.equal(s.goal, 2100);
    const migrated = db
      .prepare("SELECT title,status,done FROM todos ORDER BY id")
      .all();
    assert.equal(migrated[0].status, "done");
    assert.equal(migrated[0].done, 1);
    assert.equal(migrated[1].status, "not_started");
    assert.equal(migrated[1].done, 0);
    assert.equal(s.google_refresh, "legacy-test-refresh");
    assert.equal(
      s.google_scopes,
      "https://www.googleapis.com/auth/calendar.events",
    );
    assert.equal(
      db.prepare("SELECT count(*) AS count FROM calendar_jobs").get().count,
      0,
    );
  } finally {
    db.close();
    rmSync(process.env.DATA_DIR, { recursive: true, force: true });
  }
});
