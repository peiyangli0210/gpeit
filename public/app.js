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
function shiftDay(day, amount) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + amount);
  return d.toISOString().slice(0, 10);
}
function mondayOf(day) {
  return shiftDay(day, -((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7));
}
const upcomingWeek = () => shiftDay(mondayOf(localDate()), 7);
const displayDay = (day, options = { month: "short", day: "numeric" }) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, {
    ...options,
    timeZone: "UTC",
  });
let user,
  todos = [],
  foods = [],
  foodHistory = [],
  foodPlans = [],
  historyStart = shiftDay(localDate(), -29),
  historyEnd = localDate(),
  planStart = upcomingWeek(),
  messages = [],
  calendarSync = [],
  cronJobs = [],
  cronRuns = [],
  selectedCronId = null,
  cronCursor = null,
  taskFilter = "all",
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
  let history, plans;
  [todos, foods, messages, calendarSync, cronJobs, history, plans] =
    await Promise.all([
      api("/todos"),
      api("/foods?date=" + selectedDate),
      api("/messages"),
      api("/calendar/status"),
      api("/cron/jobs"),
      api(`/foods/history?start=${historyStart}&end=${historyEnd}`),
      api(`/food-plans?start=${planStart}&end=${shiftDay(planStart, 6)}`),
    ]);
  foodHistory = history.days;
  foodPlans = plans;
  if (selectedCronId && cronJobs.some((j) => j.id === selectedCronId)) {
    const logs = await api(`/cron/jobs/${selectedCronId}/runs`);
    cronRuns = logs.runs;
    cronCursor = logs.nextCursor;
  } else {
    selectedCronId = null;
    cronRuns = [];
    cronCursor = null;
  }
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
    cron: [
      "A little intelligence, on schedule.",
      "Custom prompts, your API account, and a clear history of every run.",
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
      ["cron", "◷", "GPT schedules"],
      ["inbox", "▤", "Inbox"],
    ]
      .map(
        ([id, icon, label]) =>
          `<button data-nav="${id}" class="${view === id ? "active" : ""}"><span>${icon}</span>${label}${id === "todos" ? `<em>${pending.length}</em>` : ""}</button>`,
      )
      .join(
        "",
      )}</nav><div class="sidebar-note"><span>✦</span><strong>A toolkit that grows with you</strong><p>More useful tools, one thoughtful space.</p></div><div class="aside-bottom"><button data-nav="settings" class="settings-link">⚙ &nbsp; Settings & connections</button><div class="profile"><span class="avatar">${esc(user.name[0].toUpperCase())}</span><div>${esc(user.name)}<small>Personal account</small></div><button id="logout" title="Sign out" aria-label="Sign out">→</button></div></div></aside><div class="main-wrap"><header><span>Workspace <b>/</b> ${view === "overview" ? "Overview" : view === "todos" ? "To-do list" : view === "diet" ? "Food journal" : view === "cron" ? "GPT schedules" : view === "inbox" ? "Inbox" : "Settings"}</span><span class="header-date">${new Date().toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}<span class="avatar small">${esc(user.name[0].toUpperCase())}</span></span></header><main><div class="page-heading"><div><div class="eyebrow">${view === "overview" ? "YOUR EVERYDAY, ORGANIZED" : "YOUR PERSONAL TOOLKIT"}</div><h1>${headings[view][0]}</h1><p>${headings[view][1]}</p></div>${view === "overview" || view === "todos" ? '<button class="primary" id="add-task">＋ Add a task</button>' : view === "diet" ? '<button class="primary" id="add-food">＋ Log food</button>' : view === "cron" ? '<button class="primary" id="add-cron">＋ New scheduled job</button>' : ""}</div>${view === "overview" ? overview(pending, done) : view === "todos" ? todoView() : view === "diet" ? dietView() : view === "cron" ? cronView() : view === "inbox" ? inboxView() : settingsView()}<footer>Made for your everyday. <span>One step at a time. ✳</span></footer></main></div>`;
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
  $("#add-cron")?.addEventListener("click", () => cronDialog());
  $("#task-filter")?.addEventListener("change", (e) => {
    taskFilter = e.target.value;
    render();
  });
  document.querySelectorAll("[data-task-status]").forEach(
    (select) =>
      (select.onchange = () =>
        action(() =>
          api("/todos/" + select.dataset.taskStatus, "PATCH", {
            status: select.value,
          }),
        )),
  );
  document
    .querySelectorAll("[data-cron-edit]")
    .forEach(
      (b) =>
        (b.onclick = () =>
          cronDialog(
            cronJobs.find((j) => j.id === Number(b.dataset.cronEdit)),
          )),
    );
  document.querySelectorAll("[data-cron-toggle]").forEach(
    (b) =>
      (b.onclick = () =>
        action(() =>
          api("/cron/jobs/" + b.dataset.cronToggle, "PATCH", {
            enabled: b.dataset.enabled !== "1",
          }),
        )),
  );
  document
    .querySelectorAll("[data-cron-delete]")
    .forEach(
      (b) =>
        (b.onclick = () =>
          confirmDelete(
            "Delete this scheduled job and all of its saved logs?",
            () => api("/cron/jobs/" + b.dataset.cronDelete, "DELETE"),
          )),
    );
  document.querySelectorAll("[data-cron-run]").forEach(
    (b) =>
      (b.onclick = async () => {
        b.disabled = true;
        try {
          const result = await api(
            "/cron/jobs/" + b.dataset.cronRun + "/run",
            "POST",
            {},
          );
          selectedCronId = result.job_id;
          await refresh();
          render();
          toast("Run started using your personal OpenAI API account");
        } catch (e) {
          toast(e.message);
          b.disabled = false;
        }
      }),
  );
  document.querySelectorAll("[data-cron-logs]").forEach(
    (b) =>
      (b.onclick = async () => {
        try {
          selectedCronId = Number(b.dataset.cronLogs);
          await refresh();
          render();
          $("#run-history")?.scrollIntoView({
            behavior: "smooth",
            block: "start",
          });
        } catch (e) {
          toast(e.message);
        }
      }),
  );
  $("#refresh-runs")?.addEventListener("click", () => action(async () => {}));
  $("#older-runs")?.addEventListener("click", async () => {
    try {
      const logs = await api(
        `/cron/jobs/${selectedCronId}/runs?before=${cronCursor}`,
      );
      cronRuns.push(...logs.runs);
      cronCursor = logs.nextCursor;
      render();
    } catch (e) {
      toast(e.message);
    }
  });
  $("#add-food")?.addEventListener("click", () => foodDialog());
  $("#quick-food")?.addEventListener("click", () => foodDialog());
  $("#retry-calendar")?.addEventListener("click", () =>
    action(() => api("/calendar/retry", "POST")),
  );
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
  document.querySelectorAll("[data-toggle]").forEach(
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
            "Delete this task and its linked Google Calendar event? Calendar changes retry automatically if Google is temporarily unavailable.",
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
  $("#food-date")?.addEventListener("change", (e) =>
    selectJournalDate(e.target.value || localDate()),
  );
  $("#journal-today")?.addEventListener("click", () =>
    selectJournalDate(localDate()),
  );
  $("#log-past-food")?.addEventListener("click", () =>
    foodDialog(null, shiftDay(localDate(), -1)),
  );
  $("#jump-planner")?.addEventListener("click", () =>
    $("#meal-planner").scrollIntoView({ behavior: "smooth" }),
  );
  document
    .querySelectorAll("[data-edit-food]")
    .forEach(
      (b) =>
        (b.onclick = () =>
          foodDialog(foods.find((f) => f.id === Number(b.dataset.editFood)))),
    );
  document.querySelectorAll("[data-history-date]").forEach((b) => {
    const select = () => selectJournalDate(b.dataset.historyDate, true);
    b.onclick = select;
    if (b.tagName.toLowerCase() === "g")
      b.onkeydown = (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          select();
        }
      };
  });
  document
    .querySelectorAll("[data-history-days]")
    .forEach(
      (b) =>
        (b.onclick = () =>
          setHistoryRange(
            shiftDay(localDate(), 1 - Number(b.dataset.historyDays)),
            localDate(),
          )),
    );
  $("#history-range")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const b = Object.fromEntries(new FormData(e.target));
    setHistoryRange(b.start, b.end);
  });
  $("#add-plan")?.addEventListener("click", () => planDialog());
  document
    .querySelectorAll("[data-plan-date]")
    .forEach((b) => (b.onclick = () => planDialog(null, b.dataset.planDate)));
  document
    .querySelectorAll("[data-edit-plan]")
    .forEach(
      (b) =>
        (b.onclick = () =>
          planDialog(
            foodPlans.find((f) => f.id === Number(b.dataset.editPlan)),
          )),
    );
  document
    .querySelectorAll("[data-delete-plan]")
    .forEach(
      (b) =>
        (b.onclick = () =>
          confirmDelete(
            "Remove this planned meal? Logged food and historical calorie totals will stay as they are.",
            () => api("/food-plans/" + b.dataset.deletePlan, "DELETE"),
          )),
    );
  document
    .querySelectorAll("[data-plan-week]")
    .forEach(
      (b) =>
        (b.onclick = () =>
          changePlanWeek(shiftDay(planStart, Number(b.dataset.planWeek)))),
    );
  $("#plan-upcoming")?.addEventListener("click", () =>
    changePlanWeek(upcomingWeek()),
  );
  $("#plan-week-date")?.addEventListener("change", (e) => {
    if (e.target.value) changePlanWeek(mondayOf(e.target.value));
  });
  $("#analyze-plan")?.addEventListener("click", (e) =>
    analyze("diet", e.currentTarget, {
      scope: "plan",
      start: planStart,
      end: shiftDay(planStart, 6),
    }),
  );
  $("#ai-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target,
      button = form.querySelector('button[type="submit"]');
    const key = form.elements.apiKey.value;
    const model = form.elements.model.value.trim();
    form.elements.apiKey.value = "";
    button.disabled = true;
    $("#ai-error").textContent = "";
    try {
      await api("/ai-connection", "PUT", { ...(key ? { key } : {}), model });
      await load();
      toast("Personal AI connection verified and saved");
    } catch (err) {
      $("#ai-error").textContent = err.message;
    } finally {
      button.disabled = false;
    }
  });
  $("#remove-ai")?.addEventListener("click", () => {
    const f = openDialog(
      "Remove personal AI connection?",
      `<p>The saved key will be removed from this app. Analysis will use the shared app connection if one is available. This does not revoke your key at OpenAI. All your scheduled GPT jobs will be paused; an already-running request may finish.</p>`,
      "Remove connection",
    );
    f.onsubmit = (e) =>
      saveDialog(e, async () => {
        await api("/ai-connection", "DELETE");
        user = await api("/me");
      });
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
  return `<div class="stats"><div class="stat"><span class="stat-icon mint">✓</span><span>Tasks to do<strong>${pending.length}<small> things on your mind</small></strong></span></div><div class="stat"><span class="stat-icon peach">◔</span><span>Calories today<strong>${total().toLocaleString()}<small> / ${user.goal.toLocaleString()} kcal</small></strong></span></div><div class="stat"><span class="stat-icon lavender">→</span><span>Tasks completed<strong>${done}<small> little wins</small></strong></span></div></div><div class="section-heading"><h2>Your tools <span>03</span></h2><span>A place for everything you do</span></div><div class="tool-grid"><article class="tool-card"><div class="tool-top"><span class="tool-icon mint">✓</span><span class="badge">PRODUCTIVITY</span></div><h2>To-do list</h2><p>Less to remember. More to get done.<br>Keep your next steps in one place.</p><div class="tool-preview">${
    pending.length
      ? pending
          .slice(0, 2)
          .map(
            (t) => `<div><span class="fake-check"></span>${esc(t.title)}</div>`,
          )
          .join("")
      : '<div><span class="fake-check"></span>Your next great idea starts here</div><div class="muted">Add your first task to get going.</div>'
  }</div><div class="tool-bottom"><span>${pending.length} open tasks</span><button data-nav="todos">Open tool →</button></div></article><article class="tool-card"><div class="tool-top"><span class="tool-icon peach">◔</span><span class="badge">WELLBEING</span></div><h2>Food journal</h2><p>A simple way to see your daily fuel.<br>Log your meals, notice your patterns.</p><div class="tool-preview"><div class="calorie-summary"><strong>${total().toLocaleString()} <small>kcal logged today</small></strong><span>${Math.round((total() / user.goal) * 100)}%</span></div><progress max="${user.goal}" value="${total()}"></progress><small class="muted">Your daily reference: ${user.goal.toLocaleString()} kcal</small></div><div class="tool-bottom"><span>${foods.length} food entries today</span><button data-nav="diet">Open tool →</button></div></article>${cronOverviewCard()}</div><div class="bottom-grid"><section class="card"><div class="section-heading"><h2>Coming up</h2><button class="text-button" data-nav="todos">View all →</button></div>${
    pending
      .filter((t) => t.due)
      .slice(0, 3)
      .map(taskRow)
      .join("") ||
    '<div class="empty small-empty"><span>☀</span><h3>A little breathing room</h3><p>Tasks with a due date will appear here.</p></div>'
  }</section><section class="insight-card"><span class="spark">✦</span><div class="eyebrow">A FRESH PERSPECTIVE</div><h2>Your tools, with a little intelligence.</h2><p>Turn your tasks and food journal into useful insights with GPT analysis.</p><button data-ai="todos" class="secondary">Explore task insights →</button></section></div>`;
}
function taskRow(t) {
  return `<div class="task-row ${t.done ? "completed" : ""}"><button class="check ${t.done ? "checked" : ""}" data-toggle="${t.id}" data-done="${t.done}" aria-label="${t.done ? "Reopen" : "Complete"} ${esc(t.title)}">${t.done ? "✓" : ""}</button><div class="task-content"><strong>${esc(t.title)}</strong><small>${t.due ? esc(new Date(t.due).toLocaleString()) : "No due date"}${t.remind ? " · Reminder set" : ""}${t.event_id ? (calendarSync.some((j) => j.event_id === t.event_id) ? " · Calendar sync pending" : " · In Google Calendar") : ""}</small></div><select class="task-status ${t.status}" data-task-status="${t.id}" aria-label="Status for ${esc(t.title)}">${[
    ["not_started", "Not started"],
    ["in_progress", "In progress"],
    ["done", "Done"],
  ]
    .map(
      ([value, label]) =>
        `<option value="${value}" ${t.status === value ? "selected" : ""}>${label}</option>`,
    )
    .join(
      "",
    )}</select>${!t.event_id && t.due ? `<button class="icon-button" data-calendar="${t.id}" title="Add to Google Calendar" aria-label="Add to Google Calendar">▦</button>` : ""}<button class="icon-button delete" data-delete-task="${t.id}" title="Delete task" aria-label="Delete task">×</button></div>`;
}
function todoView() {
  return `<div class="integration-banner"><span>▦</span><div><strong>Keep your plans connected</strong><p>${user.integrations.google ? "Dated tasks are added to Google Calendar automatically. Deleting a task removes its linked event." : "Connect Google to sync dated tasks and send messages through Gmail."}</p></div><button class="secondary" id="connect-google">${user.integrations.google ? "Reconnect" : "Connect calendar"} →</button></div><section class="card"><div class="section-heading"><h2>All tasks <span>${todos.length}</span></h2><div class="actions"><select id="task-filter" aria-label="Filter tasks by status">${[
    ["all", "All statuses"],
    ["not_started", "Not started"],
    ["in_progress", "In progress"],
    ["done", "Done"],
  ]
    .map(
      ([value, label]) =>
        `<option value="${value}" ${taskFilter === value ? "selected" : ""}>${label}</option>`,
    )
    .join(
      "",
    )}</select><button class="secondary" data-message="todos">Send a note</button><button class="secondary" data-ai="todos">✦ AI analysis</button></div></div>${calendarSync.length ? `<div class="integration-banner"><div><strong>${calendarSync.length} Calendar change(s) pending</strong><p>${esc(calendarSync.find((j) => j.last_error)?.last_error || "Changes sync automatically while Google is connected.")}</p></div><button id="retry-calendar" class="secondary">Retry sync</button></div>` : ""}${
    todos.length
      ? todos
          .filter((t) => taskFilter === "all" || t.status === taskFilter)
          .map(taskRow)
          .join("") || '<p class="hint">No tasks with this status.</p>'
      : '<div class="empty"><span>✓</span><h3>A clear page, a fresh start.</h3><p>Add your first task and give it a little space to happen.</p></div>'
  }</section><p class="hint">Tasks need a due date to appear on Google Calendar. Additions and deletions sync automatically; pending changes retry after connection failures. Reminders arrive in your inbox and through Gmail when connected. Changes made in Google Calendar do not change tasks here.</p>`;
}
function dietView() {
  const difference = user.goal - total();
  return `<div class="diet-top"><section class="card calorie-card"><span class="eyebrow">LOGGED INTAKE · ${esc(displayDay(selectedDate))}</span><h2>${total().toLocaleString()} <small>kcal</small></h2><progress max="${user.goal}" value="${total()}"></progress><p>${Math.abs(difference).toLocaleString()} kcal ${difference >= 0 ? "below" : "above"} your ${user.goal.toLocaleString()} kcal reference</p></section><section class="card"><h2>Every day has a story.</h2><p>Forgot to log a meal? Add it to the date you ate it. Plan next week's meals separately below.</p><div class="actions"><button class="secondary" id="log-past-food">Log a past meal</button><button class="secondary" id="jump-planner">View food plan →</button><button class="secondary" data-ai="diet">✦ Analyze selected day</button><button class="secondary" data-message="diet">Send a note</button></div></section></div>
  ${historyChart()}
  <section class="card" id="journal-section"><div class="section-heading"><div><h2>Food journal</h2><p class="hint">${esc(displayDay(selectedDate, { weekday: "long", year: "numeric", month: "long", day: "numeric" }))} · ${foods.length} entries</p></div><div class="actions"><button class="text-button" id="journal-today">Today</button><input type="date" id="food-date" aria-label="Journal date" value="${selectedDate}"></div></div>${foods.length ? foods.map((f) => `<div class="food-row"><span class="food-icon">◔</span><div class="task-content"><strong>${esc(f.name)}</strong><small>${esc(f.meal)}</small></div><strong>${f.calories} <small>kcal</small></strong><button class="text-button" data-edit-food="${f.id}" aria-label="Edit food ${esc(f.name)}">Edit</button><button class="icon-button delete" aria-label="Remove food entry" data-delete-food="${f.id}">×</button></div>`).join("") : '<div class="empty"><span>◔</span><h3>What’s on your plate?</h3><p>No food logged for this day yet. You can add past meals too.</p><button class="secondary" id="quick-food">＋ Log food for this day</button></div>'}</section>
  ${weeklyPlan()}
  <p class="hint">Only logged food counts toward historical intake. Planned meals are not counted as eaten. Calories are entered by you; your reference is a personal preference, not a medical recommendation.</p>`;
}
function historyChart() {
  const days = foodHistory,
    logged = days.filter((d) => d.entries > 0),
    sum = days.reduce((n, d) => n + d.calories, 0);
  const width = 900,
    height = 260,
    left = 55,
    right = 18,
    top = 22,
    bottom = 205,
    plot = width - left - right;
  const peak = Math.max(user.goal, ...days.map((d) => d.calories), 100),
    max = Math.ceil((peak * 1.1) / 500) * 500;
  const y = (value) => bottom - (value / max) * (bottom - top),
    step = plot / Math.max(days.length, 1),
    bar = Math.max(2, step * 0.66);
  const grid = [0, max / 2, max]
    .map(
      (value) =>
        `<line class="chart-grid" x1="${left}" y1="${y(value)}" x2="${width - right}" y2="${y(value)}"/><text class="chart-label" x="${left - 10}" y="${y(value) + 4}" text-anchor="end">${value.toLocaleString()}</text>`,
    )
    .join("");
  const bars = days
    .map((day, i) => {
      const x = left + step * i + (step - bar) / 2,
        label = day.entries
          ? `${day.date}: ${day.calories} kcal from ${day.entries} food entries`
          : `${day.date}: no food logged`;
      return `<g class="chart-day" tabindex="0" role="button" aria-label="${esc(label)}. Open this day" data-history-date="${day.date}"><title>${esc(label)}</title><rect class="chart-hit" x="${left + step * i}" y="${top}" width="${step}" height="${bottom - top}"/><rect class="calorie-bar ${day.entries ? "" : "no-entry"} ${day.date === selectedDate ? "selected" : ""}" x="${x}" y="${day.calories ? y(day.calories) : bottom - 3}" width="${bar}" height="${day.calories ? bottom - y(day.calories) : 3}" rx="2"/>${i % Math.ceil(days.length / 7) === 0 || i === days.length - 1 ? `<text class="chart-label" x="${left + step * (i + 0.5)}" y="230" text-anchor="middle">${esc(displayDay(day.date))}</text>` : ""}</g>`;
    })
    .join("");
  return `<section class="card food-history"><div class="section-heading"><div><h2>Calorie history</h2><p class="hint">Daily logged intake · click a day to view or add food</p></div><div class="actions">${[7, 30, 90].map((n) => `<button class="secondary" data-history-days="${n}">Last ${n} days</button>`).join("")}</div></div><form id="history-range" class="history-controls"><label>History from<input name="start" type="date" required value="${historyStart}"></label><label>History to<input name="end" type="date" required value="${historyEnd}"></label><button class="secondary">Apply range</button></form><div class="history-summary"><span><strong>${sum.toLocaleString()}</strong> kcal logged</span><span><strong>${logged.length ? Math.round(sum / logged.length).toLocaleString() : "—"}</strong> kcal average on logged days</span><span><strong>${logged.length}/${days.length}</strong> days logged</span></div><div class="chart-scroll"><svg class="calorie-chart" viewBox="0 0 ${width} ${height}" role="group" aria-labelledby="history-title history-description"><title id="history-title">Daily calorie intake from ${historyStart} to ${historyEnd}</title><desc id="history-description">Green bars show logged calories. Gray marks mean no food was logged. The dashed line shows your current reference of ${user.goal} kcal. Each day is a button that opens the journal.</desc>${grid}<line class="chart-reference" x1="${left}" y1="${y(user.goal)}" x2="${width - right}" y2="${y(user.goal)}"/>${bars}</svg></div><p class="hint">Green: logged intake · Gray: no entries · Dashed line: current ${user.goal.toLocaleString()} kcal reference. Missing entries do not mean zero food intake.</p><details class="history-table"><summary>View daily totals as a table</summary><table><thead><tr><th>Date</th><th>Logged kcal</th><th>Entries</th></tr></thead><tbody>${days.map((d) => `<tr><td><button class="text-button" data-history-date="${d.date}">${esc(displayDay(d.date, { year: "numeric", month: "short", day: "numeric" }))}</button></td><td>${d.entries ? d.calories.toLocaleString() : "Not logged"}</td><td>${d.entries}</td></tr>`).join("")}</tbody></table></details></section>`;
}
function weeklyPlan() {
  const week = Array.from({ length: 7 }, (_, i) => shiftDay(planStart, i)),
    sum = foodPlans.reduce((n, f) => n + f.calories, 0);
  return `<section class="card meal-planner" id="meal-planner"><div class="section-heading"><div><h2>Weekly food plan</h2><p class="hint">${esc(displayDay(planStart))} – ${esc(displayDay(week[6], { year: "numeric", month: "short", day: "numeric" }))} · ${sum.toLocaleString()} kcal planned</p></div><div class="actions"><button class="secondary" id="analyze-plan">✦ AI review plan</button><button class="primary" id="add-plan">＋ Plan a meal</button></div></div><div class="planner-controls"><button class="secondary" data-plan-week="-7" aria-label="Previous plan week">← Previous</button><label>Week of<input type="date" id="plan-week-date" value="${planStart}"></label><button class="secondary" data-plan-week="7" aria-label="Next plan week">Next →</button><button class="text-button" id="plan-upcoming">Upcoming week</button></div><div class="week-plan-grid">${week
    .map((day) => {
      const meals = foodPlans
          .filter((f) => f.date === day)
          .sort(
            (a, b) =>
              ["Breakfast", "Lunch", "Dinner", "Snack"].indexOf(a.meal) -
              ["Breakfast", "Lunch", "Dinner", "Snack"].indexOf(b.meal),
          ),
        total = meals.reduce((n, f) => n + f.calories, 0);
      return `<article class="plan-day"><div class="plan-day-heading"><strong>${esc(displayDay(day, { weekday: "short" }))}</strong><span>${esc(displayDay(day))}</span></div><div class="plan-day-total">${total.toLocaleString()} <small>kcal planned</small></div>${meals.length ? meals.map((f) => `<div class="planned-meal"><small>${esc(f.meal)}</small><strong>${esc(f.name)}</strong><span>${f.calories.toLocaleString()} kcal</span><div class="actions"><button class="text-button" data-edit-plan="${f.id}" aria-label="Edit planned meal ${esc(f.name)}">Edit</button><button class="text-button" data-delete-plan="${f.id}" aria-label="Delete planned meal ${esc(f.name)}">Remove</button></div></div>`).join("") : '<p class="hint">No meals planned</p>'}<button class="text-button add-day-plan" data-plan-date="${day}" aria-label="Plan food for ${day}">＋ Add meal</button></article>`;
    })
    .join(
      "",
    )}</div><p class="hint">Planned calories stay separate from your journal. Log the actual meal on the day you eat it. Use the week controls to prepare future weeks or review past plans.</p></section>`;
}
async function selectJournalDate(day, scroll = false) {
  const previous = selectedDate;
  selectedDate = day;
  try {
    await refresh();
    render();
    if (scroll) $("#journal-section").scrollIntoView({ behavior: "smooth" });
  } catch (e) {
    selectedDate = previous;
    toast(e.message);
  }
}
async function setHistoryRange(start, end) {
  const previous = [historyStart, historyEnd];
  historyStart = start;
  historyEnd = end;
  try {
    await refresh();
    render();
  } catch (e) {
    [historyStart, historyEnd] = previous;
    toast(e.message);
  }
}
async function changePlanWeek(start) {
  const previous = planStart;
  planStart = start;
  try {
    await refresh();
    render();
  } catch (e) {
    planStart = previous;
    toast(e.message);
  }
}
function inboxView() {
  return `<section class="card">${messages.length ? messages.map((m) => `<article class="message"><span class="tool-icon ${m.tool === "todos" ? "mint" : m.tool === "cron" ? "lavender" : "peach"}">${m.tool === "todos" ? "✓" : m.tool === "cron" ? "◷" : "◔"}</span><div><small>${esc(user.tools.find((t) => t.id === m.tool)?.name || m.tool)} · ${esc(new Date(m.created.replace(" ", "T") + "Z").toLocaleString())}</small><p>${esc(m.body)}</p></div></article>`).join("") : '<div class="empty"><span>▤</span><h3>All quiet for now.</h3><p>Your tool reminders, messages, and AI analyses will appear here.</p></div>'}</section>`;
}
function settingsView() {
  const i = user.integrations;
  return `<div class="settings-grid"><section class="card"><h2>Your account</h2><label>Name<input readonly value="${esc(user.name)}"></label><label>Email<input readonly value="${esc(user.email)}"></label><p class="hint">Email/password sign-in is active. Email ownership verification and password recovery are not included in this first version.</p></section><section class="card"><h2>Daily calorie reference</h2><p>A reference you choose for your journal.</p><form id="goal-form"><label>Calories per day<input name="goal" type="number" min="1" max="20000" required value="${user.goal}"></label><button class="primary">Save preference</button></form></section>${aiSettings()}<section class="card connections"><h2>Connections</h2>${[
    [
      "Google Calendar",
      i.google
        ? "Connected"
        : i.googleAvailable
          ? "Ready to connect"
          : "Needs configuration",
    ],
    ["GPT analysis", i.ai ? "Available" : "Needs configuration"],
    ["Gmail sending", i.gmail ? "Connected" : "Reconnect Google to enable"],
    ["Email service (optional)", i.email ? "Available" : "Needs configuration"],
  ]
    .map(
      ([name, status]) =>
        `<div><strong>${name}</strong><span class="status ${["Connected", "Available"].includes(status) ? "available" : ""}">${status}</span></div>`,
    )
    .join(
      "",
    )}<button class="secondary" id="connect-google">Connect Google: Calendar & Gmail →</button>${i.google ? '<button class="text-button" id="disconnect-google">Disconnect Google</button>' : ""}</section><section class="card"><span class="spark">✳</span><h2>Built to grow.</h2><p>Every tool shares your account, messaging, and AI analysis. Add new tool definitions to expand your workspace.</p><p class="hint">An administrator configures optional services on the server. Credentials never belong in the browser.</p></section></div>`;
}
function aiSettings() {
  const ai = user.aiConnection;
  return `<section class="card"><h2>AI connection</h2><p>${ai.source === "personal" ? "Analysis uses your personal OpenAI API account." : ai.source === "shared" ? "Analysis currently uses the shared app account." : "Connect your API account to enable analysis."}</p>
    <p class="hint">OpenAI API usage is billed separately from ChatGPT Free, Plus, and Pro. Your selected tool data is sent to OpenAI only when you request analysis. <a class="text-button" href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer">Create an API key →</a></p>
    ${!ai.personalAvailable ? '<p class="error">Personal connections need server setup. Ask the administrator to configure AI_KEY_ENCRYPTION_SECRET.</p>' : ""}
    <form id="ai-form"><label>OpenAI API key<input type="password" name="apiKey" autocomplete="off" spellcheck="false" autocapitalize="none" maxlength="512" ${ai.connected ? "" : "required"} ${ai.personalAvailable ? "" : "disabled"} placeholder="${ai.connected ? "Leave blank to keep your saved key" : "sk-…"}"></label>
    <label>Analysis model<input name="model" required maxlength="100" list="ai-models" value="${esc(ai.model)}" ${ai.personalAvailable ? "" : "disabled"}></label>
    <datalist id="ai-models"><option value="gpt-4.1-mini"></option><option value="gpt-4.1"></option><option value="gpt-4o-mini"></option></datalist>
    <p class="hint">Enter a Responses API model available to your API account. Saving checks key and model access. Your key is encrypted on the server and is never returned to this page. No API key is stored in browser storage.</p>
    <p id="ai-error" class="error" role="alert"></p><div class="actions"><button class="primary" type="submit" ${ai.personalAvailable ? "" : "disabled"}>Verify and save</button>${ai.connected ? '<button class="secondary" id="remove-ai" type="button">Remove connection</button>' : ""}</div></form></section>`;
}
function cronOverviewCard() {
  return `<article class="tool-card"><div class="tool-top"><span class="tool-icon lavender">◷</span><span class="badge">AUTOMATION</span></div><h2>GPT schedules</h2><p>A prompt, a schedule, a useful result.<br>Your personal AI, working on a rhythm.</p><div class="tool-preview"><strong>${cronJobs.filter((j) => j.enabled).length} active schedules</strong><p class="hint">Results and run logs in one place.</p></div><div class="tool-bottom"><span>${cronJobs.length} saved jobs</span><button data-nav="cron">Open tool →</button></div></article>`;
}
function cronView() {
  const selected = cronJobs.find((j) => j.id === selectedCronId);
  const fmt = (t) => (t ? esc(new Date(t).toLocaleString()) : "—");
  return `<div class="integration-banner"><span>✦</span><div><strong>${user.aiConnection.connected ? "Uses your personal API account · " + esc(user.aiConnection.model) : "Connect your personal OpenAI API account first"}</strong><p>API usage has separate charges from ChatGPT subscriptions. Jobs generate text from your prompts; they cannot browse live sources, run shell commands, or perform external actions.</p></div><button class="secondary" data-nav="settings">AI settings →</button></div><div class="actions cron-actions"><button class="secondary" data-ai="cron">✦ Analyze run history</button><button class="secondary" data-message="cron">Send a note</button></div>
  <div class="cron-grid">${cronJobs.length ? cronJobs.map((j) => `<article class="card cron-card"><div class="section-heading"><h2>${esc(j.name)}</h2><span class="status ${j.enabled ? "available" : ""}">${j.enabled ? "Scheduled" : "Paused"}</span></div><p class="cron-prompt">${esc(j.prompt)}</p><div class="cron-meta"><code>${esc(j.cron)}</code><span>${esc(j.timezone)}</span></div><p class="hint">${j.enabled ? "Next run: " + esc(new Date(j.next_run).toLocaleString(undefined, { timeZone: j.timezone, timeZoneName: "short" })) : "Automatic execution paused"}<br>Latest: ${esc(j.last_status || "Not run yet")} · Output limit: ${j.max_tokens} tokens</p><div class="actions"><button class="secondary" data-cron-run="${j.id}" ${!user.aiConnection.connected || j.last_status === "running" ? "disabled" : ""}>Run now</button><button class="secondary" data-cron-logs="${j.id}">View logs</button><button class="text-button" data-cron-edit="${j.id}">Edit</button><button class="text-button" data-cron-toggle="${j.id}" data-enabled="${j.enabled}">${j.enabled ? "Pause" : "Enable"}</button><button class="text-button" data-cron-delete="${j.id}">Delete</button></div></article>`).join("") : '<section class="card empty"><span>◷</span><h3>Your next routine starts here.</h3><p>Create a prompt and give it a schedule. Every execution has its own log.</p></section>'}</div>
  ${selected ? `<section class="card" id="run-history"><div class="section-heading"><h2>Run history · ${esc(selected.name)}</h2><button class="secondary" id="refresh-runs">Refresh logs</button></div>${cronRuns.length ? cronRuns.map((r) => `<details class="run-log"><summary><span class="run-state ${r.status}">${esc(r.status)}</span> ${fmt(r.started)} <small>${esc(r.trigger)} · ${esc(r.model || "No model")} · #${r.id}</small></summary><dl><dt>Started</dt><dd>${fmt(r.started)}</dd><dt>Finished</dt><dd>${fmt(r.finished)}</dd><dt>Scheduled for</dt><dd>${fmt(r.scheduled_for)}</dd><dt>API tokens</dt><dd>${r.input_tokens ?? "—"} input / ${r.output_tokens ?? "—"} output</dd></dl><strong>Prompt</strong><pre>${esc(r.prompt)}</pre>${r.output ? `<strong>Result</strong><pre>${esc(r.output)}</pre>` : ""}${r.error ? `<p class="error">${esc(r.error)}</p>` : ""}${r.status === "running" ? '<p class="hint">The request is running. Refresh logs shortly for the result.</p>' : ""}</details>`).join("") : '<p class="hint">No runs yet. Choose Run now, or wait for the next scheduled time.</p>'}${cronCursor ? '<button id="older-runs" class="secondary">Load older runs</button>' : ""}</section>` : ""}
  <p class="hint">The server must stay running for schedules to execute. One overdue run is executed after downtime; missed intervals are skipped. Failed or interrupted paid requests are not automatically retried. The latest 200 runs per job are retained. At most 20 jobs per user; up to 2 concurrent requests per user.</p>`;
}
function cronDialog(job) {
  const timezone =
    job?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const form = openDialog(
    job ? "Edit scheduled job" : "A prompt, on your schedule",
    `<label>Job name<input name="name" required maxlength="120" value="${esc(job?.name || "")}" placeholder="Daily writing idea"></label><label>GPT prompt<textarea name="prompt" required rows="5" maxlength="8000" placeholder="Generate one creative writing prompt and a short outline.">${esc(job?.prompt || "")}</textarea></label><label>Cron schedule<input name="cron" required maxlength="200" value="${esc(job?.cron || "0 9 * * *")}"></label><p class="hint">Five fields: minute hour day month weekday. Examples: <code>0 9 * * *</code> daily at 9; <code>0 9 * * 1-5</code> weekdays; <code>*/30 * * * *</code> every 30 minutes.</p><label>Time zone<input name="timezone" required maxlength="100" value="${esc(timezone)}" placeholder="America/Los_Angeles"></label><label>Maximum output tokens<input name="max_tokens" type="number" min="100" max="4000" required value="${job?.max_tokens || 1000}"></label><label class="checkbox-label"><input type="checkbox" name="enabled" ${(job ? job.enabled : user.aiConnection.connected) ? "checked" : ""}> Run automatically using my paid OpenAI API account</label><p class="hint">Uses your personal connection's selected model. A ChatGPT subscription does not include API usage. You can save a paused job before connecting your API key.</p>`,
    "Save scheduled job",
  );
  form.onsubmit = (e) =>
    saveDialog(e, (b) =>
      api("/cron/jobs" + (job ? "/" + job.id : ""), job ? "PATCH" : "POST", {
        ...b,
        enabled: b.enabled === "on",
        max_tokens: Number(b.max_tokens),
      }),
    );
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
    `<label>What needs to happen?<input name="title" required maxlength="200" placeholder="e.g. Plan the week ahead" autofocus></label><label>Task status<select name="status" aria-label="Task status"><option value="not_started">Not started</option><option value="in_progress">In progress</option><option value="done">Done</option></select></label><label>Due date & time <small>optional</small><input type="datetime-local" name="due"></label><label>Remind me <small>optional</small><input type="datetime-local" name="remind"></label><p class="hint">Reminders appear in your inbox and can be emailed when email is configured.</p>`,
    "Add task",
  );
  f.onsubmit = (e) =>
    saveDialog(e, async (b) => {
      await api("/todos", "POST", {
        title: b.title,
        status: b.status,
        due: b.due ? new Date(b.due).toISOString() : null,
        remind: b.remind ? new Date(b.remind).toISOString() : null,
      });
    });
}
function foodDialog(entry = null, presetDate = selectedDate) {
  const form = openDialog(
    entry ? "Edit logged food" : "Log food · any date",
    `<label>Food or meal<input name="name" required maxlength="200" value="${esc(entry?.name || "")}" placeholder="e.g. Oatmeal with blueberries" autofocus></label><div class="form-grid"><label>Calories (kcal)<input name="calories" type="number" min="0" max="20000" required value="${entry?.calories ?? ""}" placeholder="320"></label><label>Meal<select name="meal" aria-label="Meal">${["Breakfast", "Lunch", "Dinner", "Snack"].map((meal) => `<option ${entry?.meal === meal ? "selected" : ""}>${meal}</option>`).join("")}</select></label></div><label>Eaten date<input name="date" type="date" required value="${entry?.date || presetDate}"></label><p class="hint">Choose the date you ate this food. Past dates are welcome; totals and the history chart update for that day.</p>`,
    entry ? "Update food" : "Save food",
  );
  form.onsubmit = (e) =>
    saveDialog(e, async (b) => {
      await api(
        "/foods" + (entry ? "/" + entry.id : ""),
        entry ? "PATCH" : "POST",
        { ...b, calories: Number(b.calories) },
      );
      selectedDate = b.date;
      if (b.date < historyStart || b.date > historyEnd) {
        historyEnd = b.date;
        historyStart = shiftDay(b.date, -29);
      }
    });
}
function planDialog(entry = null, presetDate = planStart) {
  const form = openDialog(
    entry ? "Edit planned meal" : "Plan a meal",
    `<label>Planned food or meal<input name="name" required maxlength="200" value="${esc(entry?.name || "")}" placeholder="e.g. Salmon, rice and vegetables"></label><div class="form-grid"><label>Planned calories (kcal)<input name="calories" type="number" min="0" max="20000" required value="${entry?.calories ?? ""}"></label><label>Meal<select name="meal" aria-label="Planned meal">${["Breakfast", "Lunch", "Dinner", "Snack"].map((meal) => `<option ${entry?.meal === meal ? "selected" : ""}>${meal}</option>`).join("")}</select></label></div><label>Plan date<input name="date" type="date" required value="${entry?.date || presetDate}"></label><p class="hint">This is a plan. It will not add calories to your logged intake.</p>`,
    entry ? "Update planned meal" : "Save planned meal",
  );
  form.onsubmit = (e) =>
    saveDialog(e, async (b) => {
      await api(
        "/food-plans" + (entry ? "/" + entry.id : ""),
        entry ? "PATCH" : "POST",
        { ...b, calories: Number(b.calories) },
      );
      planStart = mondayOf(b.date);
    });
}
function messageDialog(tool) {
  const f = openDialog(
    "Send a note from your tool",
    `<label>Message<textarea name="body" required maxlength="2000" rows="4" placeholder="A note to your future self…"></textarea></label><label>Delivery<select name="channel"><option value="inbox">In-app inbox only</option><option value="gmail">Send through my Gmail</option>${user.integrations.email ? '<option value="email">Email service (to myself)</option>' : ""}</select></label><label>Recipient (Gmail)<input type="email" name="to" value="${esc(user.email)}" required></label><label>Subject<input name="subject" maxlength="120" value="Gpeit · ${tool === "todos" ? "To-do list" : tool === "cron" ? "GPT schedules" : "Food journal"}" required></label><p class="hint">The message is saved to your private inbox. Gmail sends from your connected Google account; reconnect Google first to grant sending permission.</p>`,
    "Send message",
  );
  f.onsubmit = (e) =>
    saveDialog(e, (b) =>
      api("/messages", "POST", {
        tool,
        body: b.body,
        channel: b.channel,
        to: b.to,
        subject: b.subject,
      }),
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
      "Google needs OAuth credentials configured by the app administrator.",
    );
    return;
  }
  location.href = "/api/google/connect";
}
async function analyze(tool, button, options = {}) {
  button.disabled = true;
  button.textContent = "Thinking…";
  try {
    const r = await api("/analyze", "POST", {
      tool,
      date: selectedDate,
      ...options,
    });
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
      const sync = await api("/calendar/status");
      if (JSON.stringify(sync) !== JSON.stringify(calendarSync)) {
        await refresh();
        render();
      }
      const next = await api("/messages");
      if (next.length !== messages.length) {
        messages = next;
        if (view === "inbox") render();
        toast("A new message is in your inbox");
      }
    } catch {}
}, 30000);

setInterval(async () => {
  if (
    !user ||
    view !== "cron" ||
    $("#dialog").open ||
    document.querySelector("#run-history details[open]")
  )
    return;
  try {
    await refresh();
    render();
  } catch {}
}, 5000);
