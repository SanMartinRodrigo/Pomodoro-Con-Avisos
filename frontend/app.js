// ============================================================
// Estado global
// ============================================================
const API = "/api";
let currentUser = null; // { role: 'admin'|'guest', name? }
let allTags = [];
let allGoalsPomodoro = [];
let allGoalsAnti = [];

let selectedGoalPomodoro = null;
let selectedGoalAnti = null;

let pomodoroState = null; // { sessionId, goal, phase, secondsLeft, cycle, interval, running }
let antiState = null;     // { sessionId, goal, activeSeconds, pausedSeconds, status, interval, dayActive, daySeconds }
let guestState = null;

let healthThresholds = null;
let healthTimers = {};
let dismissedHealthUntil = 0;

let chatSocket = null;
let newGoalModalMode = null; // 'pomodoro' | 'anti'
let newGoalSelectedTags = new Set();

// ============================================================
// Utilidades
// ============================================================
function fmtHMS(totalSeconds) {
  totalSeconds = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return [h, m, s].map(v => String(v).padStart(2, "0")).join(":");
}

function fmtMS(totalSeconds) {
  totalSeconds = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function timeAgo(isoString) {
  if (!isoString) return "nunca";
  const then = new Date(isoString);
  const now = new Date();
  const diffMs = now - then;
  const days = Math.floor(diffMs / 86400000);
  const hours = Math.floor(diffMs / 3600000);
  const mins = Math.floor(diffMs / 60000);
  if (days >= 1) return `hace ${days} día${days === 1 ? "" : "s"}`;
  if (hours >= 1) return `hace ${hours} hora${hours === 1 ? "" : "s"}`;
  if (mins >= 1) return `hace ${mins} min`;
  return "recién";
}

async function api(path, options = {}) {
  const res = await fetch(API + path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Error" }));
    throw new Error(err.detail || "Error en la petición");
  }
  if (res.status === 204) return null;
  return res.json();
}

// ============================================================
// Tema (modo nocturno)
// ============================================================
function initTheme() {
  const saved = localStorage.getItem("theme") || "dark";
  document.documentElement.setAttribute("data-theme", saved);
  document.getElementById("btnTheme").textContent = saved === "dark" ? "☀️" : "🌙";
}

document.getElementById("btnTheme").addEventListener("click", () => {
  const current = document.documentElement.getAttribute("data-theme");
  const next = current === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("theme", next);
  document.getElementById("btnTheme").textContent = next === "dark" ? "☀️" : "🌙";
});

// ============================================================
// Login
// ============================================================
document.querySelectorAll(".login-tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".login-tab").forEach(t => t.classList.remove("active"));
    document.querySelectorAll(".login-panel").forEach(p => p.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById(`login${tab.dataset.tab === "admin" ? "Admin" : "Guest"}`).classList.add("active");
  });
});

document.getElementById("btnLoginAdmin").addEventListener("click", async () => {
  const password = document.getElementById("adminPassword").value;
  try {
    await api("/login/admin", { method: "POST", body: JSON.stringify({ password }) });
    currentUser = { role: "admin" };
    localStorage.setItem("session_role", "admin");
    enterApp();
  } catch (e) {
    document.getElementById("adminError").textContent = "Clave incorrecta.";
  }
});

document.getElementById("btnLoginGuest").addEventListener("click", async () => {
  const name = document.getElementById("guestName").value.trim();
  if (!name) {
    document.getElementById("guestError").textContent = "Ingresá un nombre.";
    return;
  }
  try {
    await api("/login/guest", { method: "POST", body: JSON.stringify({ name }) });
    currentUser = { role: "guest", name };
    localStorage.setItem("session_role", "guest");
    localStorage.setItem("session_name", name);
    enterApp();
  } catch (e) {
    document.getElementById("guestError").textContent = e.message;
  }
});

document.getElementById("btnLogout").addEventListener("click", () => {
  localStorage.removeItem("session_role");
  localStorage.removeItem("session_name");
  location.reload();
});

function enterApp() {
  document.getElementById("loginScreen").classList.add("hidden");
  document.getElementById("app").classList.remove("hidden");

  const badge = document.getElementById("userBadge");
  if (currentUser.role === "admin") {
    badge.textContent = "Admin";
  } else {
    badge.textContent = `Invitado: ${currentUser.name}`;
    // Invitados solo pueden ver la pestaña de invitados
    document.querySelectorAll('.tab-btn[data-view="pomodoro"], .tab-btn[data-view="anti"], .tab-btn[data-view="analytics"]')
      .forEach(btn => btn.classList.add("hidden"));
    switchView("guests");
  }

  initAll();
}

// ============================================================
// Navegación entre pestañas
// ============================================================
document.getElementById("mainTabs").addEventListener("click", (e) => {
  const btn = e.target.closest(".tab-btn");
  if (!btn || btn.classList.contains("hidden")) return;
  switchView(btn.dataset.view);
});

function switchView(view) {
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.toggle("active", b.dataset.view === view));
  document.querySelectorAll(".view").forEach(v => v.classList.toggle("active", v.id === `view-${view}`));
  if (view === "analytics") loadAnalytics();
  if (view === "guests" && !chatSocket) connectChat();
}

// ============================================================
// Inicialización general tras login
// ============================================================
async function initAll() {
  await loadTags();
  await loadHealthThresholds();

  if (currentUser.role === "admin") {
    await loadGoals();
    renderGoalList("pomodoro");
    renderGoalList("anti");
    await resumeActiveSession("pomodoro");
    await resumeActiveSession("anti");
  }

  await populateGuestSelectors();
  startHealthWatcher();
}

// ============================================================
// Etiquetas
// ============================================================
async function loadTags() {
  allTags = await api("/tags");
}

function tagChipHTML(tag) {
  return `<span class="tag-chip" style="background:${tag.color}">${escapeHtml(tag.name)}</span>`;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

document.getElementById("btnAddTag").addEventListener("click", async () => {
  const name = document.getElementById("newTagName").value.trim();
  const color = document.getElementById("newTagColor").value;
  if (!name) return;
  try {
    await api("/tags", { method: "POST", body: JSON.stringify({ name, color }) });
    document.getElementById("newTagName").value = "";
    await loadTags();
    renderTagManager();
    await populateGuestSelectors();
  } catch (e) {
    alert(e.message);
  }
});

function renderTagManager() {
  const el = document.getElementById("tagManagerList");
  el.innerHTML = allTags.map(t => `
    <div class="tag-manager-item">
      <span class="dot" style="background:${t.color}"></span>
      ${escapeHtml(t.name)}
      <button data-id="${t.id}" class="btn-del-tag">✕</button>
    </div>
  `).join("");
  el.querySelectorAll(".btn-del-tag").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!confirm("¿Eliminar esta etiqueta? No se borran las sesiones, solo deja de asociarse.")) return;
      await api(`/tags/${btn.dataset.id}`, { method: "DELETE" });
      await loadTags();
      renderTagManager();
      await populateGuestSelectors();
    });
  });
}

// ============================================================
// Metas: carga y renderizado
// ============================================================
async function loadGoals() {
  allGoalsPomodoro = await api("/goals?mode=pomodoro");
  allGoalsAnti = await api("/goals?mode=anti");
}

function renderGoalList(mode) {
  const goals = mode === "pomodoro" ? allGoalsPomodoro : allGoalsAnti;
  const selected = mode === "pomodoro" ? selectedGoalPomodoro : selectedGoalAnti;
  const container = document.getElementById(mode === "pomodoro" ? "goalListPomodoro" : "goalListAnti");

  if (goals.length === 0) {
    container.innerHTML = `<p style="color:var(--text-muted); font-size:0.9rem;">Todavía no hay metas. Creá una con "+ Nueva meta".</p>`;
    return;
  }

  container.innerHTML = goals.map(g => `
    <div class="goal-card ${selected && selected.id === g.id ? "selected" : ""}" data-id="${g.id}">
      <div class="goal-card-title">${escapeHtml(g.title)}</div>
      <div class="goal-card-meta">
        <span>${g.mode === "pomodoro" ? `${g.study_minutes}m / ${g.break_minutes}m` : "cronómetro"}</span>
      </div>
      <div class="goal-card-tags">${(g.tags || []).map(tagChipHTML).join("")}</div>
    </div>
  `).join("");

  container.querySelectorAll(".goal-card").forEach(card => {
    card.addEventListener("click", () => selectGoal(mode, parseInt(card.dataset.id)));
  });
}

function selectGoal(mode, goalId) {
  const goals = mode === "pomodoro" ? allGoalsPomodoro : allGoalsAnti;
  const goal = goals.find(g => g.id === goalId);
  if (mode === "pomodoro") {
    selectedGoalPomodoro = goal;
    renderGoalList("pomodoro");
    showPomodoroPanel(goal);
  } else {
    selectedGoalAnti = goal;
    renderGoalList("anti");
    showAntiPanel(goal);
  }
}

// ============================================================
// Modal nueva meta
// ============================================================
document.getElementById("btnNewGoalPomodoro").addEventListener("click", () => openGoalModal("pomodoro"));
document.getElementById("btnNewGoalAnti").addEventListener("click", () => openGoalModal("anti"));
document.getElementById("btnCancelGoal").addEventListener("click", () => closeGoalModal());

function openGoalModal(mode) {
  newGoalModalMode = mode;
  newGoalSelectedTags = new Set();
  document.getElementById("newGoalTitle").value = "";
  document.getElementById("newGoalNextStep").value = "";
  document.getElementById("newGoalStudyMin").value = 25;
  document.getElementById("newGoalBreakMin").value = 5;
  document.getElementById("newGoalLongBreakMin").value = 20;
  document.getElementById("newGoalCycles").value = 4;
  document.getElementById("goalModalPomodoroFields").classList.toggle("hidden", mode !== "pomodoro");
  document.getElementById("goalModalTitle").textContent = mode === "pomodoro" ? "Nueva meta — Pomodoro" : "Nueva meta — Anti-Pomodoro";

  const tagPicker = document.getElementById("newGoalTags");
  tagPicker.innerHTML = allTags.map(t => `
    <span class="tag-pick" data-id="${t.id}" style="--tag-color:${t.color}">${escapeHtml(t.name)}</span>
  `).join("");
  tagPicker.querySelectorAll(".tag-pick").forEach(el => {
    el.addEventListener("click", () => {
      const id = parseInt(el.dataset.id);
      const tag = allTags.find(t => t.id === id);
      if (newGoalSelectedTags.has(id)) {
        newGoalSelectedTags.delete(id);
        el.classList.remove("selected");
        el.style.background = "";
        el.style.borderColor = "";
      } else {
        newGoalSelectedTags.add(id);
        el.classList.add("selected");
        el.style.background = tag.color;
        el.style.borderColor = tag.color;
      }
    });
  });

  document.getElementById("goalModal").classList.remove("hidden");
}

function closeGoalModal() {
  document.getElementById("goalModal").classList.add("hidden");
}

document.getElementById("btnConfirmGoal").addEventListener("click", async () => {
  const title = document.getElementById("newGoalTitle").value.trim();
  if (!title) { alert("Poné un título para la meta."); return; }

  const payload = {
    title,
    mode: newGoalModalMode,
    next_step: document.getElementById("newGoalNextStep").value.trim(),
    tag_ids: Array.from(newGoalSelectedTags),
  };

  if (newGoalModalMode === "pomodoro") {
    payload.study_minutes = parseInt(document.getElementById("newGoalStudyMin").value) || 25;
    payload.break_minutes = parseInt(document.getElementById("newGoalBreakMin").value) || 5;
    payload.long_break_minutes = parseInt(document.getElementById("newGoalLongBreakMin").value) || 20;
    payload.cycles_before_long_break = parseInt(document.getElementById("newGoalCycles").value) || 4;
  }

  await api("/goals", { method: "POST", body: JSON.stringify(payload) });
  await loadGoals();
  renderGoalList(newGoalModalMode);
  closeGoalModal();
  await populateGuestSelectors();
});

// ============================================================
// POMODORO
// ============================================================
function showPomodoroPanel(goal) {
  document.getElementById("noGoalSelectedPomodoro").classList.add("hidden");
  document.getElementById("pomodoroActive").classList.remove("hidden");
  document.getElementById("activeGoalTitlePomodoro").textContent = goal.title;
  document.getElementById("activeGoalNextStepPomodoro").textContent = goal.next_step ? `📝 ${goal.next_step}` : "";
  document.getElementById("cfgStudyMin").value = goal.study_minutes;
  document.getElementById("cfgBreakMin").value = goal.break_minutes;
  document.getElementById("cfgLongBreakMin").value = goal.long_break_minutes;
  document.getElementById("cfgCycles").value = goal.cycles_before_long_break;
  document.getElementById("nextStepPomodoro").value = goal.next_step || "";

  if (!pomodoroState || pomodoroState.goal.id !== goal.id) {
    resetPomodoroUIForGoal(goal);
  }
}

function resetPomodoroUIForGoal(goal) {
  pomodoroState = {
    sessionId: null,
    goal,
    phase: "study",
    secondsLeft: goal.study_minutes * 60,
    cycle: 1,
    interval: null,
    running: false,
  };
  updatePomodoroDisplay();
  document.getElementById("btnPomodoroStart").classList.remove("hidden");
  document.getElementById("btnPomodoroPause").classList.add("hidden");
}

function updatePomodoroDisplay() {
  document.getElementById("pomodoroPhase").textContent =
    pomodoroState.phase === "study" ? "Estudio" :
    pomodoroState.phase === "break" ? "Descanso" : "Descanso largo";
  document.getElementById("pomodoroDisplay").textContent = fmtMS(pomodoroState.secondsLeft);
  document.getElementById("pomodoroCycles").textContent =
    `Pomodoro ${pomodoroState.cycle} de ${pomodoroState.goal.cycles_before_long_break}`;
}

document.getElementById("btnSaveTimerConfig").addEventListener("click", async () => {
  const goal = selectedGoalPomodoro;
  const payload = {
    study_minutes: parseInt(document.getElementById("cfgStudyMin").value) || 25,
    break_minutes: parseInt(document.getElementById("cfgBreakMin").value) || 5,
    long_break_minutes: parseInt(document.getElementById("cfgLongBreakMin").value) || 20,
    cycles_before_long_break: parseInt(document.getElementById("cfgCycles").value) || 4,
  };
  const updated = await api(`/goals/${goal.id}`, { method: "PATCH", body: JSON.stringify(payload) });
  Object.assign(selectedGoalPomodoro, updated);
  const idx = allGoalsPomodoro.findIndex(g => g.id === goal.id);
  if (idx >= 0) allGoalsPomodoro[idx] = updated;
  if (!pomodoroState.running) resetPomodoroUIForGoal(updated);
  alert("Configuración guardada.");
});

document.getElementById("btnSaveNextStepPomodoro").addEventListener("click", async () => {
  const goal = selectedGoalPomodoro;
  const next_step = document.getElementById("nextStepPomodoro").value.trim();
  const updated = await api(`/goals/${goal.id}`, { method: "PATCH", body: JSON.stringify({ next_step }) });
  Object.assign(selectedGoalPomodoro, updated);
  document.getElementById("activeGoalNextStepPomodoro").textContent = next_step ? `📝 ${next_step}` : "";
  const idx = allGoalsPomodoro.findIndex(g => g.id === goal.id);
  if (idx >= 0) allGoalsPomodoro[idx] = updated;
});

document.getElementById("btnPomodoroStart").addEventListener("click", async () => {
  if (!pomodoroState.sessionId) {
    const session = await api("/sessions", {
      method: "POST",
      body: JSON.stringify({
        goal_id: pomodoroState.goal.id,
        mode: "pomodoro",
        source: "admin",
        tag_ids: (pomodoroState.goal.tags || []).map(t => t.id),
      }),
    });
    pomodoroState.sessionId = session.id;
  }
  pomodoroState.running = true;
  document.getElementById("btnPomodoroStart").classList.add("hidden");
  document.getElementById("btnPomodoroPause").classList.remove("hidden");
  tickPomodoro();
  pomodoroState.interval = setInterval(tickPomodoro, 1000);
});

document.getElementById("btnPomodoroPause").addEventListener("click", async () => {
  pomodoroState.running = false;
  clearInterval(pomodoroState.interval);
  document.getElementById("btnPomodoroPause").classList.add("hidden");
  document.getElementById("btnPomodoroStart").classList.remove("hidden");
  document.getElementById("btnPomodoroStart").textContent = "▶ Reanudar";
  if (pomodoroState.sessionId) {
    await api(`/sessions/${pomodoroState.sessionId}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "paused" }),
    });
  }
});

document.getElementById("btnPomodoroStop").addEventListener("click", async () => {
  if (!confirm("¿Detener la sesión de pomodoro? Se guardarán los datos.")) return;
  clearInterval(pomodoroState.interval);
  if (pomodoroState.sessionId) {
    const elapsedInPhase = computeElapsedStudySeconds();
    await api(`/sessions/${pomodoroState.sessionId}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "stopped", active_seconds: elapsedInPhase }),
    });
  }
  resetPomodoroUIForGoal(pomodoroState.goal);
  document.getElementById("btnPomodoroStart").textContent = "▶ Iniciar";
});

let pomodoroStudySecondsAccum = 0;

function computeElapsedStudySeconds() {
  return pomodoroStudySecondsAccum;
}

function tickPomodoro() {
  if (!pomodoroState.running) return;
  pomodoroState.secondsLeft--;
  if (pomodoroState.phase === "study") pomodoroStudySecondsAccum++;

  if (pomodoroState.secondsLeft <= 0) {
    advancePomodoroPhase();
  }
  updatePomodoroDisplay();
}

function advancePomodoroPhase() {
  const goal = pomodoroState.goal;
  playBeep();

  if (pomodoroState.phase === "study") {
    const isLongBreak = pomodoroState.cycle >= goal.cycles_before_long_break;
    if (isLongBreak) {
      pomodoroState.phase = "longbreak";
      pomodoroState.secondsLeft = goal.long_break_minutes * 60;
    } else {
      pomodoroState.phase = "break";
      pomodoroState.secondsLeft = goal.break_minutes * 60;
    }
    api(`/sessions/${pomodoroState.sessionId}`, {
      method: "PATCH",
      body: JSON.stringify({
        pomodoros_completed: pomodoroState.cycle,
        active_seconds: pomodoroStudySecondsAccum,
      }),
    });
  } else {
    const wasLong = pomodoroState.phase === "longbreak";
    pomodoroState.phase = "study";
    pomodoroState.secondsLeft = goal.study_minutes * 60;
    pomodoroState.cycle = wasLong ? 1 : pomodoroState.cycle + 1;
  }
}

function playBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 660;
    gain.gain.value = 0.1;
    osc.start();
    setTimeout(() => { osc.stop(); ctx.close(); }, 350);
  } catch (e) { /* ignore */ }
}

async function resumeActiveSession(mode) {
  const session = await api(`/sessions/active?source=admin`).catch(() => null);
  if (!session || session.mode !== mode) return;
  // Resumen simplificado: seleccionamos la meta y dejamos que el usuario reinicie el timer visual,
  // los datos ya guardados en backend no se pierden.
  const goals = mode === "pomodoro" ? allGoalsPomodoro : allGoalsAnti;
  const goal = goals.find(g => g.id === session.goal_id);
  if (!goal) return;
  if (mode === "pomodoro") {
    selectGoal("pomodoro", goal.id);
    pomodoroState.sessionId = session.id;
    pomodoroStudySecondsAccum = session.active_seconds || 0;
  } else {
    selectGoal("anti", goal.id);
    antiState.sessionId = session.id;
    antiState.activeSeconds = session.active_seconds || 0;
    antiState.pausedSeconds = session.paused_seconds || 0;
    antiState.status = session.status;
    updateAntiDisplay();
    if (session.status === "paused") {
      document.getElementById("btnAntiStart").classList.add("hidden");
      document.getElementById("btnAntiResume").classList.remove("hidden");
      document.getElementById("btnAntiPause").classList.add("hidden");
      document.getElementById("antiPauseIndicator").classList.remove("hidden");
    }
  }
}

// ============================================================
// ANTI-POMODORO
// ============================================================
function showAntiPanel(goal) {
  document.getElementById("noGoalSelectedAnti").classList.add("hidden");
  document.getElementById("antiActive").classList.remove("hidden");
  document.getElementById("activeGoalTitleAnti").textContent = goal.title;
  document.getElementById("activeGoalNextStepAnti").textContent = goal.next_step ? `📝 ${goal.next_step}` : "";
  document.getElementById("nextStepAnti").value = goal.next_step || "";

  if (!antiState || antiState.goal.id !== goal.id) {
    resetAntiUIForGoal(goal);
  }
}

function resetAntiUIForGoal(goal) {
  if (antiState && antiState.interval) clearInterval(antiState.interval);
  antiState = {
    sessionId: null,
    goal,
    activeSeconds: 0,
    pausedSeconds: 0,
    status: "idle",
    interval: null,
    dayActive: false,
    daySeconds: 0,
  };
  updateAntiDisplay();
  document.getElementById("btnAntiStart").classList.remove("hidden");
  document.getElementById("btnAntiPause").classList.add("hidden");
  document.getElementById("btnAntiResume").classList.add("hidden");
  document.getElementById("antiPauseIndicator").classList.add("hidden");
}

function updateAntiDisplay() {
  document.getElementById("antiDisplay").textContent = fmtHMS(antiState.activeSeconds);
  document.getElementById("antiTotalTime").textContent = fmtHMS(antiState.activeSeconds);
  document.getElementById("antiPausedTime").textContent = fmtHMS(antiState.pausedSeconds);
  document.getElementById("antiDaySessionTime").textContent = fmtHMS(antiState.daySeconds);
}

document.getElementById("btnSaveNextStepAnti").addEventListener("click", async () => {
  const goal = selectedGoalAnti;
  const next_step = document.getElementById("nextStepAnti").value.trim();
  const updated = await api(`/goals/${goal.id}`, { method: "PATCH", body: JSON.stringify({ next_step }) });
  Object.assign(selectedGoalAnti, updated);
  document.getElementById("activeGoalNextStepAnti").textContent = next_step ? `📝 ${next_step}` : "";
  const idx = allGoalsAnti.findIndex(g => g.id === goal.id);
  if (idx >= 0) allGoalsAnti[idx] = updated;
});

document.getElementById("btnAntiStart").addEventListener("click", async () => {
  if (!antiState.sessionId) {
    const session = await api("/sessions", {
      method: "POST",
      body: JSON.stringify({
        goal_id: antiState.goal.id,
        mode: "anti",
        source: "admin",
        tag_ids: (antiState.goal.tags || []).map(t => t.id),
      }),
    });
    antiState.sessionId = session.id;
  }
  antiState.status = "running";
  startAntiTicking();
  document.getElementById("btnAntiStart").classList.add("hidden");
  document.getElementById("btnAntiPause").classList.remove("hidden");
  document.getElementById("antiPauseIndicator").classList.add("hidden");
});

document.getElementById("btnAntiPause").addEventListener("click", async () => {
  antiState.status = "paused";
  clearInterval(antiState.interval);
  document.getElementById("btnAntiPause").classList.add("hidden");
  document.getElementById("btnAntiResume").classList.remove("hidden");
  document.getElementById("antiPauseIndicator").classList.remove("hidden");
  await api(`/sessions/${antiState.sessionId}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "paused", active_seconds: antiState.activeSeconds, paused_seconds: antiState.pausedSeconds }),
  });
  antiState.interval = setInterval(() => {
    antiState.pausedSeconds++;
    updateAntiDisplay();
  }, 1000);
});

document.getElementById("btnAntiResume").addEventListener("click", () => {
  clearInterval(antiState.interval);
  antiState.status = "running";
  startAntiTicking();
  document.getElementById("btnAntiResume").classList.add("hidden");
  document.getElementById("btnAntiPause").classList.remove("hidden");
  document.getElementById("antiPauseIndicator").classList.add("hidden");
});

document.getElementById("btnAntiStop").addEventListener("click", async () => {
  if (!confirm("¿Detener definitivamente esta sesión? Se guardan los datos (el tiempo de pausa no cuenta).")) return;
  clearInterval(antiState.interval);
  if (antiState.sessionId) {
    await api(`/sessions/${antiState.sessionId}`, {
      method: "PATCH",
      body: JSON.stringify({
        status: "stopped",
        active_seconds: antiState.activeSeconds,
        paused_seconds: antiState.pausedSeconds,
      }),
    });
  }
  resetAntiUIForGoal(antiState.goal);
});

function startAntiTicking() {
  clearInterval(antiState.interval);
  antiState.interval = setInterval(() => {
    antiState.activeSeconds++;
    if (antiState.dayActive) antiState.daySeconds++;
    updateAntiDisplay();
    checkHealthThresholds(antiState.activeSeconds);
  }, 1000);
}

document.getElementById("toggleDaySession").addEventListener("change", (e) => {
  antiState.dayActive = e.target.checked;
  document.getElementById("daySessionBody").classList.toggle("hidden", !e.target.checked);
  if (e.target.checked) antiState.daySeconds = 0;
});

// Colapsar contador de tiempo total
document.querySelectorAll(".counter-box-header[data-target]").forEach(header => {
  header.addEventListener("click", () => {
    header.closest(".counter-box").classList.toggle("collapsed");
  });
});

// ============================================================
// RECORDATORIOS DE SALUD
// ============================================================
async function loadHealthThresholds() {
  healthThresholds = await api("/health-thresholds");
}

function startHealthWatcher() {
  // Watcher genérico: revisa cada segundo si corresponde mostrar un aviso,
  // basado en antiState.activeSeconds (anti-pomodoro es el modo donde más
  // importa, por ser sesiones largas sin cortes automáticos).
}

let lastHealthSecondTriggered = { active_break: 0, hydration: 0, posture: 0 };

function checkHealthThresholds(activeSeconds) {
  if (!healthThresholds) return;
  const t = healthThresholds;

  const checks = [
    { key: "active_break", seconds: t.active_break_minutes * 60, msg: () => randomExercise() },
    { key: "hydration", seconds: t.hydration_minutes * 60, msg: () => "💧 Tomá un poco de agua. Llevás un buen rato sentado/a." },
    { key: "posture", seconds: t.posture_minutes * 60, msg: () => "🧍 Revisá tu postura: espalda recta, hombros relajados, pies apoyados." },
  ];

  for (const check of checks) {
    if (activeSeconds > 0 && activeSeconds % check.seconds === 0 && activeSeconds !== lastHealthSecondTriggered[check.key]) {
      lastHealthSecondTriggered[check.key] = activeSeconds;
      showHealthBanner(check.msg());
    }
  }
}

function randomExercise() {
  const list = healthThresholds.exercises;
  const pick = list[Math.floor(Math.random() * list.length)];
  return `🏃 Hora de una pausa activa — ${pick}`;
}

function showHealthBanner(text) {
  const banner = document.getElementById("healthBanner");
  document.getElementById("healthBannerText").textContent = text;
  banner.classList.remove("hidden");
}

document.getElementById("healthBannerDismiss").addEventListener("click", () => {
  document.getElementById("healthBanner").classList.add("hidden");
});

// ============================================================
// MODO INVITADOS
// ============================================================
async function populateGuestSelectors() {
  const goalSelect = document.getElementById("guestGoalSelect");
  const tagSelect = document.getElementById("guestTagSelect");

  if (currentUser && currentUser.role === "admin") {
    const goals = await api("/goals?mode=pomodoro").catch(() => []);
    goalSelect.innerHTML = `<option value="">— Tiempo compartido genérico —</option>` +
      goals.map(g => `<option value="${g.id}">${escapeHtml(g.title)}</option>`).join("");
  } else {
    goalSelect.innerHTML = `<option value="">— Tiempo compartido genérico —</option>`;
  }

  tagSelect.innerHTML = allTags.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join("");
}

document.getElementById("btnGuestStart").addEventListener("click", async () => {
  const goalId = document.getElementById("guestGoalSelect").value || null;
  const tagId = document.getElementById("guestTagSelect").value;
  const counts = document.getElementById("guestCountsToggle").checked;
  const studyMin = parseInt(document.getElementById("guestStudyMin").value) || 25;
  const breakMin = parseInt(document.getElementById("guestBreakMin").value) || 5;

  const session = await api("/sessions", {
    method: "POST",
    body: JSON.stringify({
      goal_id: goalId ? parseInt(goalId) : null,
      mode: "guest",
      source: "guest",
      guest_name: currentUser.role === "guest" ? currentUser.name : "Admin",
      counts_toward_total: counts,
      tag_ids: tagId ? [parseInt(tagId)] : [],
    }),
  });

  guestState = {
    sessionId: session.id,
    phase: "study",
    secondsLeft: studyMin * 60,
    studyMin, breakMin,
    studySecondsAccum: 0,
    interval: null,
    running: true,
  };

  document.getElementById("guestSetup").classList.add("hidden");
  document.getElementById("guestActive").classList.remove("hidden");
  document.getElementById("btnGuestStart").classList.add("hidden");
  document.getElementById("btnGuestPause").classList.remove("hidden");
  updateGuestDisplay();
  guestState.interval = setInterval(tickGuest, 1000);
});

document.getElementById("btnGuestPause").addEventListener("click", async () => {
  guestState.running = !guestState.running;
  document.getElementById("btnGuestPause").textContent = guestState.running ? "⏸ Pausar" : "▶ Reanudar";
  await api(`/sessions/${guestState.sessionId}`, {
    method: "PATCH",
    body: JSON.stringify({ status: guestState.running ? "running" : "paused" }),
  });
});

document.getElementById("btnGuestStop").addEventListener("click", async () => {
  if (!confirm("¿Detener la sesión compartida?")) return;
  clearInterval(guestState.interval);
  await api(`/sessions/${guestState.sessionId}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "stopped", active_seconds: guestState.studySecondsAccum }),
  });
  guestState = null;
  document.getElementById("guestSetup").classList.remove("hidden");
  document.getElementById("guestActive").classList.add("hidden");
  document.getElementById("btnGuestStart").classList.remove("hidden");
  document.getElementById("btnGuestPause").classList.add("hidden");
  document.getElementById("btnGuestPause").textContent = "⏸ Pausar";
});

function tickGuest() {
  if (!guestState.running) return;
  guestState.secondsLeft--;
  if (guestState.phase === "study") guestState.studySecondsAccum++;
  if (guestState.secondsLeft <= 0) {
    playBeep();
    if (guestState.phase === "study") {
      guestState.phase = "break";
      guestState.secondsLeft = guestState.breakMin * 60;
      api(`/sessions/${guestState.sessionId}`, {
        method: "PATCH",
        body: JSON.stringify({ active_seconds: guestState.studySecondsAccum }),
      });
    } else {
      guestState.phase = "study";
      guestState.secondsLeft = guestState.studyMin * 60;
    }
  }
  updateGuestDisplay();
}

function updateGuestDisplay() {
  document.getElementById("guestPhase").textContent = guestState.phase === "study" ? "Estudio" : "Descanso";
  document.getElementById("guestDisplay").textContent = fmtMS(guestState.secondsLeft);
}

// ============================================================
// CHAT (WebSocket)
// ============================================================
function connectChat() {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  chatSocket = new WebSocket(`${protocol}//${location.host}/ws/chat`);

  chatSocket.addEventListener("open", async () => {
    const history = await api("/chat");
    renderChatHistory(history);
  });

  chatSocket.addEventListener("message", (event) => {
    const data = JSON.parse(event.data);
    if (data.type === "message") {
      appendChatMessage(data);
    } else if (data.type === "cleared") {
      document.getElementById("chatMessages").innerHTML = "";
    }
  });

  chatSocket.addEventListener("close", () => {
    chatSocket = null;
    setTimeout(() => { if (document.getElementById("view-guests").classList.contains("active")) connectChat(); }, 2000);
  });
}

function renderChatHistory(messages) {
  const container = document.getElementById("chatMessages");
  container.innerHTML = "";
  messages.forEach(appendChatMessage);
}

function appendChatMessage(msg) {
  const container = document.getElementById("chatMessages");
  const div = document.createElement("div");
  div.className = "chat-msg";
  const time = new Date(msg.created_at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
  div.innerHTML = `
    <div class="chat-msg-author">${escapeHtml(msg.author)}</div>
    <div class="chat-msg-text">${escapeHtml(msg.message)}</div>
    <div class="chat-msg-time">${time}</div>
  `;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function sendChat() {
  const input = document.getElementById("chatInput");
  const message = input.value.trim();
  if (!message || !chatSocket || chatSocket.readyState !== WebSocket.OPEN) return;
  const author = currentUser.role === "guest" ? currentUser.name : "Admin";
  chatSocket.send(JSON.stringify({ action: "message", author, message }));
  input.value = "";
}

document.getElementById("btnSendChat").addEventListener("click", sendChat);
document.getElementById("chatInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendChat();
});

document.getElementById("btnClearChat").addEventListener("click", () => {
  if (!confirm("¿Borrar todo el chat? Esta acción no se puede deshacer.")) return;
  if (chatSocket && chatSocket.readyState === WebSocket.OPEN) {
    chatSocket.send(JSON.stringify({ action: "clear" }));
  } else {
    api("/chat", { method: "DELETE" }).then(() => {
      document.getElementById("chatMessages").innerHTML = "";
    });
  }
});

// ============================================================
// ANÁLISIS DE DATOS
// ============================================================
async function loadAnalytics() {
  const byTag = await api("/analytics/by-tag");
  const byGoal = await api("/analytics/by-goal");

  // Leyenda
  document.getElementById("tagLegend").innerHTML = byTag.map(item => `
    <span class="tag-chip" style="background:${item.tag.color}">${escapeHtml(item.tag.name)}: ${fmtHMS(item.total_seconds)}</span>
  `).join("");

  // Grid por etiqueta
  document.getElementById("analyticsByTag").innerHTML = byTag.map(item => {
    const ago = timeAgo(item.last_activity_at);
    const isStale = item.last_activity_at && (Date.now() - new Date(item.last_activity_at)) > 3 * 86400000;
    return `
      <div class="analytics-card" style="border-left-color:${item.tag.color}">
        <div class="analytics-card-title">${escapeHtml(item.tag.name)}</div>
        <div class="analytics-card-time">${fmtHMS(item.total_seconds)}</div>
        <div class="analytics-card-sub ${isStale ? "warn" : ""}">
          Última vez: ${ago}${item.last_goal_title ? ` — ${escapeHtml(item.last_goal_title)}` : ""}
        </div>
        <div class="analytics-card-sub">${item.session_count} sesión(es)</div>
      </div>
    `;
  }).join("") || `<p style="color:var(--text-muted)">Todavía no hay datos.</p>`;

  // Grid por meta
  document.getElementById("analyticsByGoal").innerHTML = byGoal.map(item => {
    const ago = timeAgo(item.last_activity_at);
    return `
      <div class="analytics-card">
        <div class="analytics-card-title">${escapeHtml(item.goal.title)}</div>
        <div class="analytics-card-time">${fmtHMS(item.total_seconds)}</div>
        <div class="analytics-card-sub">${item.total_pomodoros} pomodoros completados</div>
        <div class="analytics-card-sub">Última vez: ${ago}</div>
        <div class="goal-card-tags">${(item.goal.tags || []).map(tagChipHTML).join("")}</div>
      </div>
    `;
  }).join("") || `<p style="color:var(--text-muted)">Todavía no hay metas.</p>`;

  renderTagManager();
}

// ============================================================
// Arranque
// ============================================================
initTheme();

// Reintentar sesión guardada (simple, sin tokens: solo para comodidad local)
const savedRole = localStorage.getItem("session_role");
if (savedRole === "admin") {
  // Para admin pedimos clave igual por seguridad mínima, no auto-login.
} else if (savedRole === "guest") {
  const name = localStorage.getItem("session_name");
  if (name) {
    document.querySelector('.login-tab[data-tab="guest"]').click();
    document.getElementById("guestName").value = name;
  }
}
