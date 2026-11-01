const $ = (s) => document.querySelector(s),
  esc = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
const localDate = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
let user,
  todos = [],
  foods = [],
  messages = [],
  view = "overview",
  selectedDate = localDate(),
  authMode = "register";
async function api(path, method = "GET", data) {
  const r = await fetch("/api" + path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: data ? JSON.stringify(data) : undefined,
  });
  const v = await r.json();
  if (!r.ok) {
    if (r.status === 401 && user) {
      user = null;
      auth();
    }
    throw new Error(v.error);
  }
  return v;
}
function toast(s) {
  $("#toast").textContent = s;
  $("#toast").classList.add("show");
  setTimeout(() => $("#toast").classList.remove("show"), 4500);
}
function auth() {
  $("#app").innerHTML =
    `<div class="auth-wrap"><section class="auth-story"><a class="brand" href="/">g<span>✳</span>peit</a><div><div class="eyebrow">A LITTLE MORE INTENTIONAL</div><h1>Everyday tools.<br>More room for life.</h1><p>Organize your plans, understand your habits, and bring your useful tools together.</p><div class="story-cards"><div>✓<strong>Make things happen</strong><span>Your plans, one step at a time.</span></div><div>◔<strong>Build better habits</strong><span>A clearer picture of your day.</span></div></div></div><small>YOUR SPACE TO GET THINGS TOGETHER.</small></section><section class="auth-panel"><form id="auth-form"><div class="eyebrow">YOUR PERSONAL TOOLKIT</div><h2>${authMode === "register" ? "A fresh start, all in one place." : "Welcome back."}</h2><p>${authMode === "register" ? "Create your account and make yourself at home." : "Pick up right where you left off."}</p>${authMode === "register" ? '<label>Your name<input name="name" required maxlength="80" autocomplete="name" placeholder="Alex Morgan"></label>' : ""}<label>Email address<input type="email" name="email" required autocomplete="email" placeholder="you@example.com"></label><label>Password<input type="password" name="password" required minlength="10" maxlength="128" autocomplete="${authMode === "register" ? "new-password" : "current-password"}" placeholder="At least 10 characters"></label><p id="auth-error" class="error" role="alert"></p><button class="primary wide">${authMode === "register" ? "Create account" : "Sign in"} <span>→</span></button><p class="center">${authMode === "register" ? "Already have an account?" : "New here?"} <button type="button" class="text-button" id="switch-auth">${authMode === "register" ? "Sign in" : "Create account"}</button></p></form></section></div>`;
  $("#switch-auth").onclick = () => {
    authMode = authMode === "register" ? "login" : "register";
    auth();
  };
  $("#auth-form").onsubmit = async (e) => {
    e.preventDefault();
    const button = e.target.querySelector(".primary");
    button.disabled = true;
    try {
      await api(
        "/auth/" + authMode,
        "POST",
        Object.fromEntries(new FormData(e.target)),
      );
      await load();
    } catch (err) {
      $("#auth-error").textContent = err.message;
    } finally {
      button.disabled = false;
    }
  };
}
async function load() {
  user = await api("/me");
  await refresh();
  render();
}
async function refresh() {
  [todos, foods, messages] = await Promise.all([
    api("/todos"),
    api("/foods?date=" + selectedDate),
    api("/messages"),
  ]);
}
const total = () => foods.reduce((n, f) => n + f.calories, 0);
function render() {
  if (!user) return;
  const pending = todos.filter((t) => !t.done),
    done = todos.filter((t) => t.done).length;
  const headings = {
    overview: [
      "Your day, a little clearer.",
      "Small steps. Good habits. Everything in one place.",
    ],
    todos: [
      "Make space for what matters.",
      "Capture a task, set a reminder, take the next step.",
    ],
    diet: [
      "A little awareness, every day.",
      "Keep a simple record of what fuels you.",
    ],
    inbox: [
      "Updates from your tools.",
      "Your reminders, notes, and AI insights live here.",
    ],
    settings: [
      "Make it your own.",
      "Connect your services and set your preferences.",
    ],
  };
  $("#app").innerHTML =
    `<aside><a href="/" class="brand">g<span>✳</span>peit</a><div class="workspace"><span class="workspace-icon">${esc(user.name[0].toUpperCase())}</span><div>Personal workspace<small>Just for you</small></div></div><div class="nav-label">WORKSPACE</div><nav>${[
      ["overview", "▦", "Overview"],
      ["todos", "✓", "To-do list"],
      ["diet", "◔", "Food journal"],
      ["inbox", "▤", "Inbox"],
    ]
      .map(
        ([id, icon, label]) =>
          `<button data-nav="${id}" class="${view === id ? "active" : ""}"><span>${icon}</span>${label}${id === "todos" ? `<em>${pending.length}</em>` : ""}</button>`,
      )
      .join(
        "",
      )}</nav><div class="sidebar-note"><span>✦</span><strong>A toolkit that grows with you</strong><p>More useful tools, one thoughtful space.</p></div><div class="aside-bottom"><button data-nav="settings" class="settings-link">⚙ &nbsp; Settings & connections</button><div class="profile"><span class="avatar">${esc(user.name[0].toUpperCase())}</span><div>${esc(user.name)}<small>Personal account</small></div><button id="logout" title="Sign out" aria-label="Sign out">→</button></div></div></aside><div class="main-wrap"><header><span>Workspace <b>/</b> ${view === "overview" ? "Overview" : view === "todos" ? "To-do list" : view === "diet" ? "Food journal" : view === "inbox" ? "Inbox" : "Settings"}</span><span class="header-date">${new Date().toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}<span class="avatar small">${esc(user.name[0].toUpperCase())}</span></span></header><main><div class="page-heading"><div><div class="eyebrow">${view === "overview" ? "YOUR EVERYDAY, ORGANIZED" : "YOUR PERSONAL TOOLKIT"}</div><h1>${headings[view][0]}</h1><p>${headings[view][1]}</p></div>${view === "overview" || view === "todos" ? '<button class="primary" id="add-task">＋ Add a task</button>' : view === "diet" ? '<button class="primary" id="add-food">＋ Log food</button>' : ""}</div>${view === "overview" ? overview(pending, done) : view === "todos" ? todoView() : view === "diet" ? dietView() : view === "inbox" ? inboxView() : settingsView()}<footer>Made for your everyday. <span>One step at a time. ✳</span></footer></main></div>`;
  document.querySelectorAll("[data-nav]").forEach(
    (b) =>
      (b.onclick = async () => {
        view = b.dataset.nav;
        if (view === "overview" && selectedDate !== localDate()) {
          selectedDate = localDate();
          try {
            await refresh();
          } catch (e) {
            toast(e.message);
          }
        }
        render();
      }),
  );
  $("#logout").onclick = async () => {
    try {
      await api("/auth/logout", "POST");
      user = null;
      auth();
    } catch (e) {
      toast(e.message);
    }
  };
  $("#add-task")?.addEventListener("click", taskDialog);
  $("#add-food")?.addEventListener("click", foodDialog);
  $("#quick-food")?.addEventListener("click", foodDialog);
  $("#connect-google")?.addEventListener("click", connectGoogle);
  $("#disconnect-google")?.addEventListener("click", async () => {
    try {
      await api("/google/disconnect", "POST");
      await load();
      toast("Calendar disconnected");
    } catch (e) {
      toast(e.message);
    }
  });
  document
    .querySelectorAll("[data-toggle]")
    .forEach(
      (b) =>
        (b.onclick = () =>
          action(() =>
            api("/todos/" + b.dataset.toggle, "PATCH", {
              done: b.dataset.done !== "1",
            }),
          )),
    );
  document
    .querySelectorAll("[data-delete-task]")
    .forEach(
      (b) =>
        (b.onclick = () =>
          confirmDelete(
            "Delete this task? Calendar events already created are kept in Google Calendar.",
            () => api("/todos/" + b.dataset.deleteTask, "DELETE"),
          )),
    );
  document
    .querySelectorAll("[data-delete-food]")
    .forEach(
      (b) =>
        (b.onclick = () =>
          confirmDelete("Remove this food entry?", () =>
            api("/foods/" + b.dataset.deleteFood, "DELETE"),
          )),
    );
  document
    .querySelectorAll("[data-calendar]")
    .forEach(
      (b) =>
        (b.onclick = () =>
          action(() =>
            api("/todos/" + b.dataset.calendar + "/calendar", "POST"),
          )),
    );
  document
    .querySelectorAll("[data-ai]")
    .forEach((b) => (b.onclick = () => analyze(b.dataset.ai, b)));
  document
    .querySelectorAll("[data-message]")
    .forEach((b) => (b.onclick = () => messageDialog(b.dataset.message)));
  $("#food-date")?.addEventListener("change", async (e) => {
    selectedDate = e.target.value || localDate();
    try {
      await refresh();
      render();
    } catch (err) {
      toast(err.message);
    }
  });
  $("#goal-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    await action(() =>
      api("/settings", "PATCH", {
        goal: Number(new FormData(e.target).get("goal")),
      }),
    );
    user = await api("/me");
    render();
    toast("Daily reference saved");
  });
}
function overview(pending, done) {
  return `<div class="stats"><div class="stat"><span class="stat-icon mint">✓</span><span>Tasks to do<strong>${pending.length}<small> things on your mind</small></strong></span></div><div class="stat"><span class="stat-icon peach">◔</span><span>Calories today<strong>${total().toLocaleString()}<small> / ${user.goal.toLocaleString()} kcal</small></strong></span></div><div class="stat"><span class="stat-icon lavender">→</span><span>Tasks completed<strong>${done}<small> little wins</small></strong></span></div></div><div class="section-heading"><h2>Your tools <span>02</span></h2><span>A place for everything you do</span></div><div class="tool-grid"><article class="tool-card"><div class="tool-top"><span class="tool-icon mint">✓</span><span class="badge">PRODUCTIVITY</span></div><h2>To-do list</h2><p>Less to remember. More to get done.<br>Keep your next steps in one place.</p><div class="tool-preview">${
    pending.length
      ? pending
          .slice(0, 2)
          .map(
            (t) => `<div><span class="fake-check"></span>${esc(t.title)}</div>`,
          )
          .join("")
      : '<div><span class="fake-check"></span>Your next great idea starts here</div><div class="muted">Add your first task to get going.</div>'
  }</div><div class="tool-bottom"><span>${pending.length} open tasks</span><button data-nav="todos">Open tool →</button></div></article><article class="tool-card"><div class="tool-top"><span class="tool-icon peach">◔</span><span class="badge">WELLBEING</span></div><h2>Food journal</h2><p>A simple way to see your daily fuel.<br>Log your meals, notice your patterns.</p><div class="tool-preview"><div class="calorie-summary"><strong>${total().toLocaleString()} <small>kcal logged today</small></strong><span>${Math.round((total() / user.goal) * 100)}%</span></div><progress max="${user.goal}" value="${total()}"></progress><small class="muted">Your daily reference: ${user.goal.toLocaleString()} kcal</small></div><div class="tool-bottom"><span>${foods.length} food entries today</span><button data-nav="diet">Open tool →</button></div></article></div><div class="bottom-grid"><section class="card"><div class="section-heading"><h2>Coming up</h2><button class="text-button" data-nav="todos">View all →</button></div>${
    pending
      .filter((t) => t.due)
      .slice(0, 3)
      .map(taskRow)
      .join("") ||
    '<div class="empty small-empty"><span>☀</span><h3>A little breathing room</h3><p>Tasks with a due date will appear here.</p></div>'
  }</section><section class="insight-card"><span class="spark">✦</span><div class="eyebrow">A FRESH PERSPECTIVE</div><h2>Your tools, with a little intelligence.</h2><p>Turn your tasks and food journal into useful insights with GPT analysis.</p><button data-ai="todos" class="secondary">Explore task insights →</button></section></div>`;
}
function taskRow(t) {
  return `<div class="task-row ${t.done ? "completed" : ""}"><button class="check ${t.done ? "checked" : ""}" data-toggle="${t.id}" data-done="${t.done}" aria-label="${t.done ? "Reopen" : "Complete"} ${esc(t.title)}">${t.done ? "✓" : ""}</button><div class="task-content"><strong>${esc(t.title)}</strong><small>${t.due ? esc(new Date(t.due).toLocaleString()) : "No due date"}${t.remind ? " · Reminder set" : ""}${t.event_id ? " · In Google Calendar" : ""}</small></div>${!t.event_id && t.due ? `<button class="icon-button" data-calendar="${t.id}" title="Add to Google Calendar" aria-label="Add to Google Calendar">▦</button>` : ""}<button class="icon-button delete" data-delete-task="${t.id}" title="Delete task" aria-label="Delete task">×</button></div>`;
}
function todoView() {
  return `<div class="integration-banner"><span>▦</span><div><strong>Keep your plans connected</strong><p>${user.integrations.google ? "Your Google Calendar is connected. Add dated tasks with the calendar button." : "Connect Google Calendar to add tasks and calendar reminders."}</p></div><button class="secondary" id="connect-google">${user.integrations.google ? "Reconnect" : "Connect calendar"} →</button></div><section class="card"><div class="section-heading"><h2>All tasks <span>${todos.length}</span></h2><div class="actions"><button class="secondary" data-message="todos">Send a note</button><button class="secondary" data-ai="todos">✦ AI analysis</button></div></div>${todos.length ? todos.map(taskRow).join("") : '<div class="empty"><span>✓</span><h3>A clear page, a fresh start.</h3><p>Add your first task and give it a little space to happen.</p></div>'}</section><p class="hint">Reminders arrive in your inbox while the app server is running. Email delivery is available when configured. Calendar events are copies; changes here do not change them.</p>`;
}
function dietView() {
  return `<div class="diet-top"><section class="card calorie-card"><span class="eyebrow">DAILY INTAKE</span><h2>${total().toLocaleString()} <small>kcal</small></h2><progress max="${user.goal}" value="${total()}"></progress><p>${Math.max(0, user.goal - total()).toLocaleString()} kcal below your ${user.goal.toLocaleString()} kcal reference</p></section><section class="card"><h2>One meal at a time.</h2><p>Log the calories for the portion you ate. Your daily total updates automatically.</p><div class="actions"><button class="secondary" data-ai="diet">✦ AI analysis</button><button class="secondary" data-message="diet">Send a note</button></div></section></div><section class="card"><div class="section-heading"><h2>Food journal</h2><input type="date" id="food-date" aria-label="Journal date" value="${selectedDate}"></div>${foods.length ? foods.map((f) => `<div class="food-row"><span class="food-icon">◔</span><div class="task-content"><strong>${esc(f.name)}</strong><small>${esc(f.meal)}</small></div><strong>${f.calories} <small>kcal</small></strong><button class="icon-button delete" aria-label="Remove food entry" data-delete-food="${f.id}">×</button></div>`).join("") : '<div class="empty"><span>◔</span><h3>What’s on your plate?</h3><p>No food logged for this day yet.</p><button class="secondary" id="quick-food">＋ Log your first food</button></div>'}</section><p class="hint">Calories are entered by you. Your daily reference is a personal preference, not a medical recommendation.</p>`;
}
function inboxView() {
  return `<section class="card">${messages.length ? messages.map((m) => `<article class="message"><span class="tool-icon ${m.tool === "todos" ? "mint" : "peach"}">${m.tool === "todos" ? "✓" : "◔"}</span><div><small>${m.tool === "todos" ? "To-do list" : "Food journal"} · ${esc(new Date(m.created.replace(" ", "T") + "Z").toLocaleString())}</small><p>${esc(m.body)}</p></div></article>`).join("") : '<div class="empty"><span>▤</span><h3>All quiet for now.</h3><p>Your tool reminders, messages, and AI analyses will appear here.</p></div>'}</section>`;
}
function settingsView() {
  const i = user.integrations;
  return `<div class="settings-grid"><section class="card"><h2>Your account</h2><label>Name<input readonly value="${esc(user.name)}"></label><label>Email<input readonly value="${esc(user.email)}"></label><p class="hint">Email/password sign-in is active. Email ownership verification and password recovery are not included in this first version.</p></section><section class="card"><h2>Daily calorie reference</h2><p>A reference you choose for your journal.</p><form id="goal-form"><label>Calories per day<input name="goal" type="number" min="1" max="20000" required value="${user.goal}"></label><button class="primary">Save preference</button></form></section><section class="card connections"><h2>Connections</h2>${[
    [
      "Google Calendar",
      i.google
        ? "Connected"
        : i.googleAvailable
          ? "Ready to connect"
          : "Needs configuration",
    ],
    ["GPT analysis", i.ai ? "Available" : "Needs configuration"],
    ["Email messages", i.email ? "Available" : "Needs configuration"],
  ]
    .map(
      ([name, status]) =>
        `<div><strong>${name}</strong><span class="status ${["Connected", "Available"].includes(status) ? "available" : ""}">${status}</span></div>`,
    )
    .join(
      "",
    )}<button class="secondary" id="connect-google">Connect Google Calendar →</button>${i.google ? '<button class="text-button" id="disconnect-google">Disconnect calendar</button>' : ""}</section><section class="card"><span class="spark">✳</span><h2>Built to grow.</h2><p>Every tool shares your account, messaging, and AI analysis. Add new tool definitions to expand your workspace.</p><p class="hint">An administrator configures optional services on the server. Credentials never belong in the browser.</p></section></div>`;
}
function openDialog(title, content, submit) {
  const d = $("#dialog");
  d.innerHTML = `<form id="dialog-form"><div class="section-heading"><h2>${title}</h2><button type="button" id="close-dialog" class="icon-button" aria-label="Close">×</button></div>${content}<p class="error" id="dialog-error" role="alert"></p><button class="primary wide" id="dialog-submit">${submit}</button></form>`;
  $("#close-dialog").onclick = () => d.close();
  d.showModal();
  return $("#dialog-form");
}
function taskDialog() {
  const f = openDialog(
    "A new next step",
    `<label>What needs to happen?<input name="title" required maxlength="200" placeholder="e.g. Plan the week ahead" autofocus></label><label>Due date & time <small>optional</small><input type="datetime-local" name="due"></label><label>Remind me <small>optional</small><input type="datetime-local" name="remind"></label><p class="hint">Reminders appear in your inbox and can be emailed when email is configured.</p>`,
    "Add task",
  );
  f.onsubmit = (e) =>
    saveDialog(e, async (b) => {
      await api("/todos", "POST", {
        title: b.title,
        due: b.due ? new Date(b.due).toISOString() : null,
        remind: b.remind ? new Date(b.remind).toISOString() : null,
      });
    });
}
function foodDialog() {
  const f = openDialog(
    "A little fuel for your day",
    `<label>Food or meal<input name="name" required maxlength="200" placeholder="e.g. Oatmeal with blueberries" autofocus></label><div class="form-grid"><label>Calories (kcal)<input name="calories" type="number" min="0" max="20000" required placeholder="320"></label><label>Meal<select name="meal"><option>Breakfast</option><option>Lunch</option><option>Dinner</option><option>Snack</option></select></label></div><label>Date<input name="date" type="date" required value="${selectedDate}"></label>`,
    "Save food",
  );
  f.onsubmit = (e) =>
    saveDialog(e, (b) =>
      api("/foods", "POST", { ...b, calories: Number(b.calories) }),
    );
}
function messageDialog(tool) {
  const f = openDialog(
    "Send a note from your tool",
    `<label>Message<textarea name="body" required maxlength="2000" rows="4" placeholder="A note to your future self…"></textarea></label><label class="checkbox-label"><input type="checkbox" name="email"> Also email this to ${esc(user.email)}</label><p class="hint">The message is saved to your private inbox. Email requires a configured delivery service.</p>`,
    "Send message",
  );
  f.onsubmit = (e) =>
    saveDialog(e, (b) =>
      api("/messages", "POST", { tool, body: b.body, email: b.email === "on" }),
    );
}
async function saveDialog(e, fn) {
  e.preventDefault();
  $("#dialog-submit").disabled = true;
  try {
    await fn(Object.fromEntries(new FormData(e.target)));
    $("#dialog").close();
    await refresh();
    render();
    toast("Saved to your workspace");
  } catch (err) {
    $("#dialog-error").textContent = err.message;
  } finally {
    if ($("#dialog-submit")) $("#dialog-submit").disabled = false;
  }
}
function confirmDelete(text, fn) {
  const f = openDialog("Remove entry?", `<p>${esc(text)}</p>`, "Delete");
  f.onsubmit = (e) => saveDialog(e, fn);
}
async function action(fn) {
  try {
    await fn();
    await refresh();
    render();
  } catch (e) {
    toast(e.message);
  }
}
async function connectGoogle() {
  if (!user.integrations.googleAvailable) {
    toast(
      "Google Calendar needs OAuth credentials configured by the app administrator.",
    );
    return;
  }
  location.href = "/api/google/connect";
}
async function analyze(tool, button) {
  button.disabled = true;
  button.textContent = "Thinking…";
  try {
    const r = await api("/analyze", "POST", { tool, date: selectedDate });
    const f = openDialog(
      "✦ A fresh perspective",
      `<div class="analysis">${esc(r.text)}</div>`,
      "Done",
    );
    f.onsubmit = (e) => {
      e.preventDefault();
      $("#dialog").close();
    };
    await refresh();
  } catch (e) {
    toast(e.message);
  } finally {
    button.disabled = false;
    button.textContent = "✦ AI analysis";
  }
}
load().catch((e) => {
  auth();
  if (e.message !== "Please sign in.") toast(e.message);
});
setInterval(async () => {
  if (user)
    try {
      const next = await api("/messages");
      if (next.length !== messages.length) {
        messages = next;
        if (view === "inbox") render();
        toast("A new message is in your inbox");
      }
    } catch {}
}, 30000);
