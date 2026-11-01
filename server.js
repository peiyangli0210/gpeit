import http from "node:http";
import { DatabaseSync } from "node:sqlite";
import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tools } from "./tools.js";

const root = fileURLToPath(new URL(".", import.meta.url));
mkdirSync(process.env.DATA_DIR || `${root}data`, { recursive: true });
const db = new DatabaseSync(
  `${process.env.DATA_DIR || `${root}data`}/app.sqlite`,
);
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT NOT NULL,password TEXT NOT NULL,created TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id INTEGER REFERENCES users(id),expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS todos(id INTEGER PRIMARY KEY,user_id INTEGER REFERENCES users(id),title TEXT NOT NULL,due TEXT,remind TEXT,done INTEGER DEFAULT 0,event_id TEXT,reminded INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS foods(id INTEGER PRIMARY KEY,user_id INTEGER REFERENCES users(id),name TEXT NOT NULL,calories INTEGER NOT NULL,date TEXT NOT NULL,meal TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY,user_id INTEGER REFERENCES users(id),tool TEXT NOT NULL,body TEXT NOT NULL,created TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS settings(user_id INTEGER PRIMARY KEY REFERENCES users(id),goal INTEGER DEFAULT 2000,google_refresh TEXT);
CREATE TABLE IF NOT EXISTS oauth_states(state TEXT PRIMARY KEY,user_id INTEGER REFERENCES users(id),expires INTEGER NOT NULL);
`);
const run = (sql, ...p) => db.prepare(sql).run(...p);
const one = (sql, ...p) => db.prepare(sql).get(...p);
const all = (sql, ...p) => db.prepare(sql).all(...p);
const hash = (s) => createHash("sha256").update(s).digest("hex");
const appUrl = new URL(
  process.env.APP_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    "http://localhost:3000",
).origin;
const secure = appUrl.startsWith("https:");
const cookie = (t) =>
  `session=${t}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${secure ? "; Secure" : ""}`;
const emailReady = () =>
  !!(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
const googleReady = () =>
  !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
function fail(status, message) {
  throw Object.assign(new Error(message), { status });
}
function str(v, max = 200) {
  if (typeof v !== "string" || !v.trim() || v.trim().length > max)
    fail(400, "Please check the supplied fields.");
  return v.trim();
}
function date(v) {
  if (
    typeof v !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(v) ||
    isNaN(Date.parse(v)) ||
    new Date(v).toISOString().slice(0, 10) !== v
  )
    fail(400, "Choose a valid date.");
  return v;
}
function instant(v) {
  if (!v) return null;
  if (typeof v !== "string" || isNaN(Date.parse(v)))
    fail(400, "Choose a valid time.");
  return new Date(v).toISOString();
}
async function body(req) {
  let b = "";
  for await (const chunk of req) {
    b += chunk;
    if (b.length > 20000) fail(413, "Request too large.");
  }
  try {
    return JSON.parse(b || "{}");
  } catch {
    fail(400, "Invalid JSON.");
  }
}
async function external(url, opts) {
  const r = await fetch(url, { ...opts, signal: AbortSignal.timeout(20000) });
  if (!r.ok)
    fail(
      502,
      "The connected service could not complete this request. Please check its configuration and try again.",
    );
  return r.json();
}
async function sendEmail(to, subject, text) {
  if (!emailReady())
    fail(
      503,
      "Email delivery is not configured. Your in-app messages still work.",
    );
  await external("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM,
      to: [to],
      subject,
      text,
    }),
  });
}
async function googleToken(uid) {
  const s = one("SELECT google_refresh FROM settings WHERE user_id=?", uid);
  if (!s?.google_refresh) fail(409, "Connect Google Calendar first.");
  return (
    await external("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        refresh_token: s.google_refresh,
        grant_type: "refresh_token",
      }),
    })
  ).access_token;
}
const limits = new Map();
function rate(key, max = 20) {
  const now = Date.now();
  let v = limits.get(key);
  if (!v || v.until < now) {
    v = { count: 0, until: now + 900000 };
    limits.set(key, v);
  }
  if (++v.count > max) fail(429, "Too many attempts. Please try again later.");
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of limits) if (v.until < now) limits.delete(k);
}, 60000).unref();

export const server = http.createServer(async (req, res) => {
  const json = (v, status = 200) => {
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(v));
  };
  try {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    const url = new URL(req.url, "http://localhost"),
      p = url.pathname;
    if (!p.startsWith("/api/")) {
      if (req.method !== "GET") fail(405, "Method not allowed.");
      const files = {
        "/": "index.html",
        "/app.js": "app.js",
        "/style.css": "style.css",
      };
      if (!files[p]) fail(404, "Not found.");
      res.setHeader(
        "Content-Type",
        p.endsWith(".js")
          ? "text/javascript"
          : p.endsWith(".css")
            ? "text/css"
            : "text/html",
      );
      res.end(readFileSync(`${root}public/${files[p]}`));
      return;
    }
    if (
      !["GET", "HEAD"].includes(req.method) &&
      req.headers.origin &&
      req.headers.origin !== appUrl
    )
      fail(403, "Untrusted request origin.");
    if (p === "/api/auth/register" || p === "/api/auth/login") {
      if (req.method !== "POST") fail(405, "Method not allowed.");
      rate(req.socket.remoteAddress);
      const b = await body(req),
        email = str(b.email, 254).toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        fail(400, "Enter a valid email address.");
      if (
        typeof b.password !== "string" ||
        b.password.length < 10 ||
        b.password.length > 128
      )
        fail(400, "Use a password of 10–128 characters.");
      let u = one("SELECT * FROM users WHERE email=?", email);
      if (p.endsWith("register")) {
        if (u) fail(409, "This email is already registered. Sign in instead.");
        const name = str(b.name, 80),
          salt = randomBytes(16).toString("hex");
        const id = Number(
          run(
            "INSERT INTO users(email,name,password) VALUES(?,?,?)",
            email,
            name,
            `${salt}:${scryptSync(b.password, salt, 64).toString("hex")}`,
          ).lastInsertRowid,
        );
        run("INSERT INTO settings(user_id) VALUES(?)", id);
        u = one("SELECT * FROM users WHERE id=?", id);
      } else {
        const [salt, digest] = (
          u?.password || `${"0".repeat(32)}:${"0".repeat(128)}`
        ).split(":");
        const valid = timingSafeEqual(
          scryptSync(b.password, salt, 64),
          Buffer.from(digest, "hex"),
        );
        if (!u || !valid) fail(401, "Email or password is incorrect.");
      }
      const token = randomBytes(32).toString("hex");
      run(
        "INSERT INTO sessions VALUES(?,?,?)",
        hash(token),
        u.id,
        Date.now() + 2592000000,
      );
      res.setHeader("Set-Cookie", cookie(token));
      json({ id: u.id, name: u.name, email: u.email });
      return;
    }
    const token = req.headers.cookie
      ?.split("; ")
      .find((x) => x.startsWith("session="))
      ?.slice(8);
    const u =
      token &&
      one(
        "SELECT users.* FROM sessions JOIN users ON users.id=sessions.user_id WHERE token=? AND expires>?",
        hash(token),
        Date.now(),
      );
    if (!u) fail(401, "Please sign in.");
    const uid = u.id;
    if (p === "/api/auth/logout" && req.method === "POST") {
      run("DELETE FROM sessions WHERE token=?", hash(token));
      res.setHeader(
        "Set-Cookie",
        `session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure ? "; Secure" : ""}`,
      );
      json({ ok: true });
      return;
    }
    if (p === "/api/me" && req.method === "GET") {
      const s = one("SELECT * FROM settings WHERE user_id=?", uid);
      json({
        id: uid,
        name: u.name,
        email: u.email,
        goal: s.goal,
        tools,
        integrations: {
          ai: !!process.env.GPT_API_KEY,
          email: emailReady(),
          googleAvailable: googleReady(),
          google: !!s.google_refresh,
        },
      });
      return;
    }
    if (p === "/api/settings" && req.method === "PATCH") {
      const b = await body(req);
      if (!Number.isInteger(b.goal) || b.goal < 1 || b.goal > 20000)
        fail(400, "Enter a goal between 1 and 20,000.");
      run("UPDATE settings SET goal=? WHERE user_id=?", b.goal, uid);
      json({ ok: true });
      return;
    }
    if (p === "/api/todos" && req.method === "GET") {
      json(
        all(
          "SELECT * FROM todos WHERE user_id=? ORDER BY done, due IS NULL, due, id DESC",
          uid,
        ),
      );
      return;
    }
    if (p === "/api/todos" && req.method === "POST") {
      const b = await body(req),
        title = str(b.title),
        due = instant(b.due),
        remind = instant(b.remind);
      if (remind && Date.parse(remind) < Date.now())
        fail(400, "Set a reminder in the future.");
      const id = Number(
        run(
          "INSERT INTO todos(user_id,title,due,remind) VALUES(?,?,?,?)",
          uid,
          title,
          due,
          remind,
        ).lastInsertRowid,
      );
      json(one("SELECT * FROM todos WHERE id=?", id), 201);
      return;
    }
    const todo = p.match(/^\/api\/todos\/(\d+)(\/calendar)?$/);
    if (todo) {
      const t = one(
        "SELECT * FROM todos WHERE id=? AND user_id=?",
        Number(todo[1]),
        uid,
      );
      if (!t) fail(404, "Task not found.");
      if (todo[2] && req.method === "POST") {
        if (!t.due)
          fail(400, "Set a due time before adding this task to Calendar.");
        if (t.event_id) {
          json({ ok: true });
          return;
        }
        const access = await googleToken(uid);
        // A deterministic Google event ID makes retries safe after interrupted requests.
        const eventId = hash(`gpeit:${uid}:${t.id}`);
        const response = await fetch(
          "https://www.googleapis.com/calendar/v3/calendars/primary/events",
          {
            method: "POST",
            signal: AbortSignal.timeout(20000),
            headers: {
              Authorization: `Bearer ${access}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              id: eventId,
              summary: t.title,
              start: { dateTime: t.due },
              end: {
                dateTime: new Date(Date.parse(t.due) + 1800000).toISOString(),
              },
              reminders: t.remind
                ? {
                    useDefault: false,
                    overrides: [
                      {
                        method: "popup",
                        minutes: Math.max(
                          0,
                          Math.min(
                            40320,
                            Math.round(
                              (Date.parse(t.due) - Date.parse(t.remind)) /
                                60000,
                            ),
                          ),
                        ),
                      },
                    ],
                  }
                : { useDefault: true },
            }),
          },
        );
        if (!response.ok && response.status !== 409)
          fail(
            502,
            "Calendar could not save this event. Try reconnecting Google.",
          );
        run(
          "UPDATE todos SET event_id=? WHERE id=? AND user_id=?",
          eventId,
          t.id,
          uid,
        );
        json({ ok: true });
        return;
      }
      if (!todo[2] && req.method === "PATCH") {
        const b = await body(req);
        if (typeof b.done !== "boolean") fail(400, "Invalid task state.");
        run(
          "UPDATE todos SET done=? WHERE id=? AND user_id=?",
          b.done ? 1 : 0,
          t.id,
          uid,
        );
        json({ ok: true });
        return;
      }
      if (!todo[2] && req.method === "DELETE") {
        run("DELETE FROM todos WHERE id=? AND user_id=?", t.id, uid);
        json({ ok: true });
        return;
      }
    }
    if (p === "/api/foods" && req.method === "GET") {
      json(
        all(
          "SELECT * FROM foods WHERE user_id=? AND date=? ORDER BY id DESC",
          uid,
          date(url.searchParams.get("date")),
        ),
      );
      return;
    }
    if (p === "/api/foods" && req.method === "POST") {
      const b = await body(req);
      if (!Number.isInteger(b.calories) || b.calories < 0 || b.calories > 20000)
        fail(400, "Calories must be a whole number from 0 to 20,000.");
      if (!["Breakfast", "Lunch", "Dinner", "Snack"].includes(b.meal))
        fail(400, "Choose a meal.");
      const id = Number(
        run(
          "INSERT INTO foods(user_id,name,calories,date,meal) VALUES(?,?,?,?,?)",
          uid,
          str(b.name),
          b.calories,
          date(b.date),
          b.meal,
        ).lastInsertRowid,
      );
      json(one("SELECT * FROM foods WHERE id=?", id), 201);
      return;
    }
    const food = p.match(/^\/api\/foods\/(\d+)$/);
    if (food && req.method === "DELETE") {
      const result = run(
        "DELETE FROM foods WHERE id=? AND user_id=?",
        Number(food[1]),
        uid,
      );
      if (!result.changes) fail(404, "Food not found.");
      json({ ok: true });
      return;
    }
    if (p === "/api/messages" && req.method === "GET") {
      json(
        all(
          "SELECT * FROM messages WHERE user_id=? ORDER BY id DESC LIMIT 100",
          uid,
        ),
      );
      return;
    }
    if (p === "/api/messages" && req.method === "POST") {
      const b = await body(req);
      if (!tools.some((t) => t.id === b.tool)) fail(400, "Unknown tool.");
      const text = str(b.body, 2000);
      if (b.email) {
        rate(`email:${uid}`, 10);
        await sendEmail(u.email, `Gpeit · ${b.tool}`, text);
      }
      run(
        "INSERT INTO messages(user_id,tool,body) VALUES(?,?,?)",
        uid,
        b.tool,
        text,
      );
      json({ ok: true });
      return;
    }
    if (p === "/api/analyze" && req.method === "POST") {
      if (!process.env.GPT_API_KEY)
        fail(
          503,
          "GPT analysis needs a GPT_API_KEY configured by the app administrator.",
        );
      rate(`ai:${uid}`, 20);
      const b = await body(req),
        tool = tools.find((t) => t.id === b.tool);
      if (!tool) fail(400, "Unknown tool.");
      const data =
        tool.id === "todos"
          ? all(
              "SELECT title,due,done FROM todos WHERE user_id=? LIMIT 100",
              uid,
            )
          : all(
              "SELECT name,calories,meal,date FROM foods WHERE user_id=? AND date=?",
              uid,
              date(b.date),
            );
      const result = await external("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.GPT_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: process.env.GPT_MODEL || "gpt-4.1-mini",
          instructions: tool.analysisPrompt,
          input: JSON.stringify(data),
          max_output_tokens: 600,
        }),
      });
      const text = result.output
        ?.flatMap((o) => o.content || [])
        .filter((c) => c.type === "output_text")
        .map((c) => c.text)
        .join("\n");
      if (!text) fail(502, "No analysis returned. Please try again.");
      run(
        "INSERT INTO messages(user_id,tool,body) VALUES(?,?,?)",
        uid,
        tool.id,
        text,
      );
      json({ text });
      return;
    }
    if (p === "/api/google/connect" && req.method === "GET") {
      if (!googleReady())
        fail(
          503,
          "Google Calendar needs Google OAuth credentials configured by the app administrator.",
        );
      const state = randomBytes(24).toString("hex");
      run("DELETE FROM oauth_states WHERE expires<?", Date.now());
      run(
        "INSERT INTO oauth_states VALUES(?,?,?)",
        state,
        uid,
        Date.now() + 600000,
      );
      const q = new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID,
        redirect_uri: `${appUrl}/api/google/callback`,
        response_type: "code",
        scope: "https://www.googleapis.com/auth/calendar.events",
        access_type: "offline",
        prompt: "consent",
        state,
      });
      res.writeHead(302, {
        Location: `https://accounts.google.com/o/oauth2/v2/auth?${q}`,
      });
      res.end();
      return;
    }
    if (p === "/api/google/callback" && req.method === "GET") {
      const state = url.searchParams.get("state"),
        s = one(
          "SELECT * FROM oauth_states WHERE state=? AND user_id=? AND expires>?",
          state,
          uid,
          Date.now(),
        );
      if (!s) fail(400, "Calendar connection expired. Please try again.");
      run("DELETE FROM oauth_states WHERE state=?", state);
      if (!url.searchParams.get("code"))
        fail(400, "Calendar permission was not granted.");
      const tokens = await external("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: process.env.GOOGLE_CLIENT_ID,
          client_secret: process.env.GOOGLE_CLIENT_SECRET,
          code: url.searchParams.get("code"),
          redirect_uri: `${appUrl}/api/google/callback`,
          grant_type: "authorization_code",
        }),
      });
      if (!tokens.refresh_token)
        fail(
          502,
          "Google did not return offline access. Try connecting again.",
        );
      run(
        "UPDATE settings SET google_refresh=? WHERE user_id=?",
        tokens.refresh_token,
        uid,
      );
      res.writeHead(302, { Location: "/?calendar=connected" });
      res.end();
      return;
    }
    if (p === "/api/google/disconnect" && req.method === "POST") {
      run("UPDATE settings SET google_refresh=NULL WHERE user_id=?", uid);
      json({ ok: true });
      return;
    }
    fail(404, "Not found.");
  } catch (e) {
    json(
      {
        error: e.status ? e.message : "Something went wrong. Please try again.",
      },
      e.status || 500,
    );
    if (!e.status) console.error("Request failed:", e.name);
  }
});

let processing = false;
export async function reminders() {
  if (processing) return;
  processing = true;
  try {
    for (const t of all(
      "SELECT todos.*,users.email FROM todos JOIN users ON users.id=todos.user_id WHERE reminded=0 AND done=0 AND remind IS NOT NULL AND remind<=?",
      new Date().toISOString(),
    )) {
      run(
        "INSERT INTO messages(user_id,tool,body) VALUES(?,?,?)",
        t.user_id,
        "todos",
        `Reminder: ${t.title}`,
      );
      run("UPDATE todos SET reminded=1 WHERE id=?", t.id);
      if (emailReady())
        try {
          await sendEmail(t.email, "Gpeit · Task reminder", t.title);
        } catch {
          run(
            "INSERT INTO messages(user_id,tool,body) VALUES(?,?,?)",
            t.user_id,
            "todos",
            `Email delivery failed for “${t.title}”. Your reminder is saved here.`,
          );
        }
    }
  } finally {
    processing = false;
  }
}
if (process.env.NODE_ENV !== "test") {
  server.listen(Number(process.env.PORT || 3000), "0.0.0.0", () =>
    console.log(`Gpeit running on port ${process.env.PORT || 3000}`),
  );
  reminders();
  setInterval(reminders, 30000).unref();
}
