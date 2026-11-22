// سجّل واكسب — الواجهة الأمامية
// كل الكتابة والقراءة عبر الـ Edge Function "rewards" على مشروع shoghl-fawry:
//   POST https://xqtmtbvhtenwlnsipdsq.supabase.co/functions/v1/rewards?action=<name>
//   مع Authorization: Bearer <access_token> (متخزن في localStorage بعد الدخول)

// ---------- الإعدادات ----------
const CFG = window.SW_CONFIG || {};
const API_BASE = CFG.API_BASE || "";
const CONFIG_OK = API_BASE && !API_BASE.includes("PROJECT_REF");

const TOKEN_KEY = "sw-token";
const USER_KEY = "sw-user";
const DEVICE_KEY = "sw-device-id";

const TASK_TYPES = [
  { value: "all", label: "الكل" },
  { value: "like", label: "لايك 👍" },
  { value: "follow", label: "متابعة ➕" },
  { value: "share", label: "مشاركة 🔁" }
];

// ---------- حالة التطبيق ----------
const state = {
  user: null,        // { id, name, email, role, points_balance, points_held, total_earned, referral_code }
  tasks: [],
  taskFilter: "all",
  mining: null,      // الجلسة النشطة { id, ends_at, points_earned, ... } أو null
  miningRemaining: 0,
  wallet: null,
  adminStats: null,
  adminUsers: [],
  adminTasks: [],
  cashbackOffers: [],
  myCashbackClaims: [],
  adminCashbackOffers: [],
  adminCashbackClaims: [],
};

let countdownTimer = null;

// ---------- أدوات مساعدة ----------
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[c]));
const fmtPoints = (n) => Number(n ?? 0).toLocaleString("en-US") + " نقطة";
const fmtUsd = (n) => {
  const v = Number(n ?? 0);
  return "$" + (Number.isInteger(v) ? v.toLocaleString("en-US") : v.toFixed(2));
};
const fmtDate = (iso) => {
  if (!iso) return "";
  try { return new Date(iso).toLocaleString("ar-EG", { dateStyle: "medium", timeStyle: "short" }); }
  catch { return String(iso); }
};
const METHOD_LABEL = { binance: "Binance (USDT)" };
const TASK_STATUS = {
  pending: ["في المراجعة", "status-pending"],
  approved: ["اتقبل ✅", "status-approved"],
  rejected: ["اترفض", "status-rejected"]
};
const WD_STATUS = {
  pending: ["قيد المراجعة", "status-pending"],
  paid: ["اتدفع ✅", "status-paid"],
  rejected: ["اترفض", "status-rejected"]
};
const TX_LABEL = {
  mining: "تجميع تعدين ⛏️",
  daily_bonus: "مكافأة يومية 🎁",
  task_pay: "أجر مهمة 👍",
  referral: "مكافأة إحالة 👥",
  withdrawal_hold: "حجز نقاط سحب",
  withdrawal_paid: "سحب اتدفع",
  withdrawal_refund: "استرجاع سحب مرفوض",
  adjustment: "تعديل من الأدمن",
  cashback: "كاش باك 💸"
};

function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.hidden = true; }, 4000);
}

function setMsg(el, text, kind) {
  if (!el) return;
  el.textContent = text || "";
  el.className = "form-msg" + (kind ? " " + kind : "");
}

// بصمة الجهاز: UUID v4 يتولد مرة واحدة ويتخزن في localStorage
function getDeviceId() {
  let id = null;
  try { id = localStorage.getItem(DEVICE_KEY); } catch { /* تجاهل */ }
  if (!id) {
    id = (crypto.randomUUID ? crypto.randomUUID() : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    }));
    try { localStorage.setItem(DEVICE_KEY, id); } catch { /* تجاهل */ }
  }
  return id;
}

// ---------- استدعاء الباك إند ----------
function getToken() {
  try { return localStorage.getItem(TOKEN_KEY) || ""; } catch { return ""; }
}

async function api(action, body) {
  if (!CONFIG_OK) throw new Error("لسه الإعدادات ما اتظبطتش — ظبط API_BASE في ملف config.js.");
  const token = getToken();
  const res = await fetch(API_BASE + "?action=" + encodeURIComponent(action), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {})
    },
    body: JSON.stringify(body || {})
  });
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (!res.ok || (data && data.ok === false)) {
    const msg = (data && (data.error || data.message)) || ("حصلت مشكلة (كود " + res.status + ")، جرّب تاني");
    const e = new Error(msg);
    e.status = res.status;
    e.data = data;
    throw e;
  }
  return (data && data.data !== undefined) ? data.data : (data || {});
}

function isDeviceError(e) {
  const text = ((e && e.message) || "") + " " + JSON.stringify(e && e.data ? e.data : "");
  return (e && e.status === 409) || /device/i.test(text) || /الجهاز/.test(text);
}

// ---------- التنقل بين الصفحات ----------
const VIEWS = ["home", "auth", "mining", "tasks", "cashback", "referral", "wallet", "admin"];
function showView(name) {
  for (const v of VIEWS) {
    const el = $("view-" + v);
    if (el) el.hidden = v !== name;
  }
  document.querySelectorAll(".nav-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.nav === name);
  });
  window.scrollTo({ top: 0 });
  if (name === "mining") loadMining();
  if (name === "tasks") loadTasks();
  if (name === "cashback") loadCashback();
  if (name === "referral") loadReferral();
  if (name === "wallet") loadWallet();
  if (name === "admin") loadAdmin();
}

document.addEventListener("click", (e) => {
  const nav = e.target.closest("[data-nav]");
  if (nav) {
    e.preventDefault();
    const target = nav.dataset.nav;
    if ((target === "mining" || target === "tasks" || target === "cashback" || target === "referral" || target === "wallet" || target === "admin") && !state.user) {
      showView("auth");
      setMsg($("authMsg"), "سجّل دخولك الأول عشان توصل للصفحة دي.", "error");
      return;
    }
    if (target === "admin" && state.user && state.user.role !== "admin") {
      toast("الصفحة دي للأدمن بس.");
      return;
    }
    showView(target);
  }
});

// ---------- المصادقة ----------
function applyAuthUI() {
  const loggedIn = !!state.user;
  const isAdmin = state.user && state.user.role === "admin";
  document.querySelectorAll(".auth-only").forEach((el) => { el.hidden = !loggedIn; });
  document.querySelectorAll(".guest-only").forEach((el) => { el.hidden = loggedIn; });
  document.querySelectorAll(".admin-only").forEach((el) => { el.hidden = !isAdmin; });
  if (loggedIn && state.user) {
    $("userChip").textContent = "👋 " + (state.user.name || state.user.email || "") +
      (isAdmin ? " (أدمن)" : "") + " • " + fmtPoints(state.user.points_balance);
  }
}

function saveSession(token, user) {
  try {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch { /* تجاهل */ }
  state.user = user;
  applyAuthUI();
}

function clearSession() {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  } catch { /* تجاهل */ }
  state.user = null;
  state.mining = null;
  stopCountdown();
  applyAuthUI();
}

async function loadProfile() {
  try {
    const me = await api("me");
    state.user = me;
    try { localStorage.setItem(USER_KEY, JSON.stringify(me)); } catch { /* تجاهل */ }
  } catch (e) {
    // التوكن منتهي أو البروفايل مش موجود — اخرج
    if (e.status === 401) clearSession();
  }
  applyAuthUI();
}

async function refreshSession() {
  let cached = null;
  try { cached = JSON.parse(localStorage.getItem(USER_KEY) || "null"); } catch { cached = null; }
  if (getToken() && cached) {
    state.user = cached;
    applyAuthUI();
    await loadProfile();
  } else {
    state.user = null;
    applyAuthUI();
  }
}

$("tabLogin").addEventListener("click", () => {
  $("tabLogin").classList.add("active");
  $("tabRegister").classList.remove("active");
  $("loginForm").hidden = false;
  $("registerForm").hidden = true;
  setMsg($("authMsg"), "");
});
$("tabRegister").addEventListener("click", () => {
  $("tabRegister").classList.add("active");
  $("tabLogin").classList.remove("active");
  $("registerForm").hidden = false;
  $("loginForm").hidden = true;
  setMsg($("authMsg"), "");
});

$("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector("button[type=submit]");
  btn.disabled = true;
  setMsg($("authMsg"), "جاري تسجيل الدخول…");
  try {
    const res = await api("login", {
      email: $("loginEmail").value.trim(),
      password: $("loginPassword").value
    });
    saveSession(res.access_token, res.user);
    setMsg($("authMsg"), "");
    toast("أهلاً بيك تاني! 👋");
    showView("mining");
  } catch (err) {
    setMsg($("authMsg"), "مش قادرين ندخّلك — اتأكد من الإيميل وكلمة السر وحاول تاني.", "error");
  } finally { btn.disabled = false; }
});

$("registerForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector("button[type=submit]");
  btn.disabled = true;
  setMsg($("authMsg"), "جاري إنشاء حسابك…");
  const payload = {
    name: $("regName").value.trim(),
    email: $("regEmail").value.trim(),
    password: $("regPassword").value,
    device_id: getDeviceId(),
    referral_code: $("regReferral").value.trim().toUpperCase() || undefined
  };
  try {
    await api("register", payload);
    // بعد التسجيل: ندخل بالحساب الجديد (أكشن login بيرجع الـ access_token)
    const res = await api("login", { email: payload.email, password: payload.password });
    saveSession(res.access_token, res.user);
    setMsg($("authMsg"), "");
    toast(res.user && res.user.role === "admin"
      ? "حسابك اتعمل وبقيت أدمن المنصة 🎉 — انت أول حساب، ظبط الإعدادات من لوحة التحكم."
      : "حسابك اتعمل بنجاح 🎉 — يلا ابدأ التعدين!");
    showView("mining");
  } catch (err) {
    if (isDeviceError(err)) {
      setMsg($("authMsg"), "الجهاز ده مسجّل عليه حساب قبل كده — كل جهاز ليه حساب واحد بس.", "error");
    } else if (err && err.message && /كود الإحالة/.test(err.message)) {
      setMsg($("authMsg"), err.message, "error");
    } else if (err && err.message && /already|موجود|مستخدم/i.test(err.message)) {
      setMsg($("authMsg"), "الإيميل ده متسجّل قبل كده — جرّب تسجّل دخول.", "error");
    } else {
      setMsg($("authMsg"), "مقدرناش نعمل الحساب: " + (err.message || "حصلت مشكلة، جرّب تاني."), "error");
    }
  } finally { btn.disabled = false; }
});

$("logoutBtn").addEventListener("click", () => {
  clearSession();
  showView("home");
  toast("خرجت بالسلامة 👋");
});

// ---------- التعدين ----------
function fmtCountdown(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return String(m).padStart(2, "0") + ":" + String(r).padStart(2, "0");
}

function renderMining() {
  const active = !!state.mining;
  $("miningIdle").hidden = active;
  $("miningActive").hidden = !active;
  if (active) {
    $("countdown").textContent = fmtCountdown(state.miningRemaining);
    const done = state.miningRemaining <= 0;
    $("collectMiningBtn").disabled = !done;
    $("collectMiningBtn").textContent = done ? "اجمع النقاط 💰" : "استنى لحد ما الوقت يخلص ⏳";
  }
}

function stopCountdown() {
  if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
}

function startCountdown() {
  stopCountdown();
  countdownTimer = setInterval(() => {
    if (!state.mining) { stopCountdown(); return; }
    state.miningRemaining = Math.max(0, state.miningRemaining - 1);
    renderMining();
    if (state.miningRemaining <= 0) stopCountdown();
  }, 1000);
}

async function loadMining() {
  if (!state.user) { showView("auth"); return; }
  setMsg($("miningMsg"), "جاري تحميل حالة التعدين…");
  try {
    const res = await api("mining-status");
    state.mining = res.session || null;
    state.miningRemaining = Number(res.remaining_seconds || 0);
    setMsg($("miningMsg"), "");
    renderMining();
    if (state.mining && state.miningRemaining > 0) startCountdown();
  } catch (err) {
    setMsg($("miningMsg"), "مقدرناش نحمّل حالة التعدين: " + (err.message || "جرّب تاني."), "error");
  }
}

$("startMiningBtn").addEventListener("click", async () => {
  const btn = $("startMiningBtn");
  btn.disabled = true;
  setMsg($("miningMsg"), "جاري بدء جلسة التعدين…");
  try {
    const res = await api("start-mining");
    state.mining = res;
    state.miningRemaining = Number(res.remaining_seconds || 0);
    setMsg($("miningMsg"), "جلسة التعدين بدأت ⛏️ — ارجع بعد ساعة واجمع " + fmtPoints(res.points_earned) + ".", "ok");
    renderMining();
    startCountdown();
    toast("التعدين بدأ ⛏️ — العداد شغال!");
  } catch (err) {
    setMsg($("miningMsg"), err.message || "مقدرناش نبدأ التعدين، جرّب تاني.", "error");
  } finally { btn.disabled = false; }
});

$("collectMiningBtn").addEventListener("click", async () => {
  const btn = $("collectMiningBtn");
  btn.disabled = true;
  setMsg($("miningMsg"), "جاري تجميع النقاط…");
  try {
    const res = await api("collect-mining");
    state.mining = null;
    state.miningRemaining = 0;
    setMsg($("miningMsg"), "مبروك! 🎉 اتجمع " + fmtPoints(res.points_earned) + " في محفظتك — دوس \"عدّن\" تاني لجلسة جديدة.", "ok");
    renderMining();
    await loadProfile();
    toast("اتجمع " + fmtPoints(res.points_earned) + " 💰");
  } catch (err) {
    if (err.data && typeof err.data.remaining_seconds === "number") {
      state.miningRemaining = err.data.remaining_seconds;
      renderMining();
      startCountdown();
    }
    setMsg($("miningMsg"), err.message || "مقدرناش نجمع النقاط، جرّب تاني.", "error");
    btn.disabled = false;
  }
});

$("dailyBonusBtn").addEventListener("click", async () => {
  const btn = $("dailyBonusBtn");
  btn.disabled = true;
  setMsg($("bonusMsg"), "جاري صرف المكافأة…");
  try {
    const res = await api("daily-bonus");
    setMsg($("bonusMsg"), "مبروك! 🎁 أخدت " + fmtPoints(res.points_earned) + " مكافأة النهاردة — تعال بكرة تاني.", "ok");
    await loadProfile();
  } catch (err) {
    setMsg($("bonusMsg"), err.message || "مقدرناش نصرف المكافأة، جرّب تاني.", "error");
  } finally { btn.disabled = false; }
});

// ---------- المهام ----------
function renderFilters() {
  const box = $("typeFilters");
  box.innerHTML = TASK_TYPES.map((t) =>
    '<button class="chip' + (state.taskFilter === t.value ? " active" : "") +
    '" data-type="' + esc(t.value) + '">' + esc(t.label) + "</button>"
  ).join("");
  box.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      state.taskFilter = chip.dataset.type;
      renderFilters();
      renderTasks();
    });
  });
}

async function loadTasks() {
  renderFilters();
  $("tasksList").innerHTML = "<p class='muted'>جاري تحميل المهام…</p>";
  try {
    const tasks = await api("list-tasks");
    state.tasks = tasks || [];
    renderTasks();
    setMsg($("tasksMsg"), "");
  } catch (err) {
    $("tasksList").innerHTML = "";
    setMsg($("tasksMsg"), "مقدرناش نحمّل المهام دلوقتي — اتأكد من الاتصال وحاول تاني.", "error");
  }
}

function renderTasks() {
  const list = $("tasksList");
  const filtered = state.taskFilter === "all"
    ? state.tasks
    : state.tasks.filter((t) => t.type === state.taskFilter);
  $("tasksCount").textContent = filtered.length
    ? "في " + filtered.length + " مهمة في النوع ده."
    : "";
  $("tasksEmpty").hidden = filtered.length > 0;
  list.innerHTML = filtered.map((t) => {
    const myStatus = t.my_status || null;
    const [label, cls] = myStatus && TASK_STATUS[myStatus] ? TASK_STATUS[myStatus] : ["", ""];
    const blocked = myStatus === "pending" || myStatus === "approved";
    return '<article class="task-card">' +
      '<div class="task-top"><h3>' + esc(t.title) + '</h3>' +
      '<span class="cat-badge">' + esc(t.type_label || t.type) + "</span></div>" +
      '<div class="pay">⭐ ' + fmtPoints(t.points) + "</div>" +
      '<p class="task-desc">' + esc(t.description) + "</p>" +
      (t.url ? '<p><a href="' + esc(t.url) + '" target="_blank" rel="noopener">🔗 افتح الرابط</a></p>' : "") +
      (myStatus
        ? '<div><span class="status ' + cls + '">' + label + "</span></div>"
        : "") +
      (state.user
        ? (blocked
          ? '<p class="muted small">' + (myStatus === "pending" ? "سلّمت المهمة دي وهي في المراجعة دلوقتي." : "المهمة دي اتقبلت واتدفعت نقاطها — تسلم إيدك! 👏") + "</p>"
          : '<div class="submit-box">' +
            '<label>إثبات التنفيذ (اختياري — لينك أو وصف)<input type="text" data-proof="' + esc(t.id) + '" placeholder="مثال: لينك البوست أو اسم الحساب"></label>' +
            '<button class="btn btn-primary btn-block" data-complete-task="' + esc(t.id) + '">سلّمت المهمة ✅</button>' +
            '<p class="form-msg" data-task-msg="' + esc(t.id) + '"></p>' +
            "</div>")
        : '<p class="muted small">سجّل دخولك الأول عشان تقدر تسلّم المهمة دي. <button class="linklike" data-nav="auth">دخول / حساب جديد</button></p>') +
      "</article>";
  }).join("");

  list.querySelectorAll("[data-complete-task]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const taskId = btn.dataset.completeTask;
      const proofInput = list.querySelector('[data-proof="' + taskId + '"]');
      const msgEl = list.querySelector('[data-task-msg="' + taskId + '"]');
      const proof = (proofInput && proofInput.value || "").trim();
      btn.disabled = true;
      setMsg(msgEl, "جاري إرسال التسليم…");
      try {
        await api("complete-task", { task_id: taskId, proof });
        setMsg(msgEl, "تسليمك وصل ✅ — هيتراجع والنقاط هتنزل في محفظتك أول ما يتقبل.", "ok");
        await loadTasks();
      } catch (err) {
        setMsg(msgEl, "مقدرناش نبعت التسليم: " + (err.message || "جرّب تاني."), "error");
        btn.disabled = false;
      }
    });
  });
}

// ---------- الكاش باك ----------
function cashbackPointsPreview(amount, percent) {
  const rate = (state.wallet && state.wallet.points_per_usd) || 1000;
  return Math.floor(Number(amount || 0) * (Number(percent || 0) / 100) * rate);
}

function updateCbPreview() {
  const sel = $("cbOffer");
  const amount = Number($("cbAmount").value || 0);
  const opt = sel && sel.selectedOptions && sel.selectedOptions[0];
  const percent = opt ? Number(opt.dataset.percent || 0) : 0;
  const rate = (state.wallet && state.wallet.points_per_usd) || 1000;
  $("cbPreview").textContent = (amount > 0 && percent > 0)
    ? "هتاخد " + fmtPoints(cashbackPointsPreview(amount, percent)) + " (≈ " + fmtUsd(Math.round((cashbackPointsPreview(amount, percent) / rate) * 100) / 100) + ") — بعد موافقة الأدمن."
    : "";
}

async function loadCashback() {
  if (!state.user) { showView("auth"); return; }
  $("cashbackOffers").innerHTML = "<p class='muted'>جاري تحميل عروض الكاش باك…</p>";
  try {
    const offers = await api("list-cashback-offers");
    state.cashbackOffers = offers || [];
    renderCashbackOffers();
    setMsg($("cashbackMsg"), "");
  } catch (err) {
    $("cashbackOffers").innerHTML = "";
    setMsg($("cashbackMsg"), "مقدرناش نحمّل عروض الكاش باك دلوقتي — اتأكد من الاتصال وحاول تاني.", "error");
  }
  loadMyCashbackClaims();
}

function renderCashbackOffers() {
  const list = $("cashbackOffers");
  $("cashbackOffersEmpty").hidden = state.cashbackOffers.length > 0;
  list.innerHTML = state.cashbackOffers.map((o) =>
    '<article class="task-card">' +
    '<div class="task-top"><h3>' + esc(o.store_name) + '</h3>' +
    '<span class="cat-badge">كاش باك 💸</span></div>' +
    '<div class="pay">💸 ' + esc(String(o.percent)) + "% كاش باك</div>" +
    (o.description ? '<p class="task-desc">' + esc(o.description) + "</p>" : "") +
    '<div class="form-row">' +
    '<a class="btn btn-primary" href="' + esc(o.store_url) + '" target="_blank" rel="noopener">تسوّق الآن 🛒</a>' +
    '<button class="btn btn-secondary" data-cb-claim="' + esc(o.id) + '">اطلب الكاش باك 📝</button>' +
    "</div></article>"
  ).join("");

  // قائمة المتاجر في نموذج الطلب
  const sel = $("cbOffer");
  sel.innerHTML = state.cashbackOffers.map((o) =>
    '<option value="' + esc(o.id) + '" data-percent="' + esc(o.percent) + '">' +
    esc(o.store_name) + " — " + esc(String(o.percent)) + "% كاش باك</option>"
  ).join("");
  updateCbPreview();

  list.querySelectorAll("[data-cb-claim]").forEach((btn) => {
    btn.addEventListener("click", () => {
      sel.value = btn.dataset.cbClaim;
      updateCbPreview();
      $("cashbackClaimForm").scrollIntoView({ behavior: "smooth" });
      $("cbAmount").focus();
    });
  });
}

$("cbOffer").addEventListener("change", updateCbPreview);
$("cbAmount").addEventListener("input", updateCbPreview);

$("cashbackClaimForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const amount = Number($("cbAmount").value);
  const proof = $("cbProof").value.trim();
  if (!amount || amount <= 0) return setMsg($("cbClaimMsg"), "اكتب قيمة مشترياتك بالدولار الأول.", "error");
  if (!proof) return setMsg($("cbClaimMsg"), "الإثبات مطلوب — اكتب رقم الطلب أو لينك الإثبات.", "error");
  const btn = e.target.querySelector("button[type=submit]");
  btn.disabled = true;
  setMsg($("cbClaimMsg"), "جاري إرسال طلب الكاش باك…");
  try {
    const res = await api("submit-cashback-claim", {
      offer_id: Number($("cbOffer").value),
      purchase_amount_usd: amount,
      proof
    });
    setMsg($("cbClaimMsg"), "طلب الكاش باك اتبعت ✅ — " + fmtPoints(res.points_earned) + " هتنزل في محفظتك أول ما الأدمن يوافق (مشتريات " + fmtUsd(res.purchase_amount_usd) + " من " + esc(res.store_name || "") + ").", "ok");
    e.target.reset();
    updateCbPreview();
    await loadMyCashbackClaims();
    await loadProfile();
  } catch (err) {
    setMsg($("cbClaimMsg"), "مقدرناش نبعت الطلب: " + (err.message || "جرّب تاني."), "error");
  } finally { btn.disabled = false; }
});

async function loadMyCashbackClaims() {
  try {
    const claims = await api("my-cashback-claims");
    state.myCashbackClaims = claims || [];
    renderMyCashbackClaims();
  } catch { /* اختياري */ }
}

function renderMyCashbackClaims() {
  const list = $("myCashbackClaims");
  $("myCashbackClaimsEmpty").hidden = state.myCashbackClaims.length > 0;
  list.innerHTML = state.myCashbackClaims.map((c) => {
    const [label, cls] = TASK_STATUS[c.status] || ["", ""];
    return '<div class="queue-item"><div class="meta"><strong>' + esc(c.store_name || "متجر") +
      "</strong> • مشتريات: <strong>" + fmtUsd(c.purchase_amount_usd) + "</strong>" +
      (c.percent !== null && c.percent !== undefined ? " • النسبة: " + esc(String(c.percent)) + "%" : "") +
      ' • النقاط: <strong>' + fmtPoints(c.points_earned) + "</strong>" +
      ' <span class="status ' + cls + '">' + label + "</span><br>" +
      "الإثبات: " + esc(c.proof || "—") + " • " + fmtDate(c.created_at) +
      (c.admin_note ? '<br><span class="admin-note">ملاحظة الأدمن: ' + esc(c.admin_note) + "</span>" : "") +
      "</div></div>";
  }).join("");
}

// ---------- الإحالة ----------
async function loadReferral() {
  if (!state.user) { showView("auth"); return; }
  try {
    const info = await api("referral-info");
    $("refCode").textContent = info.referral_code || "—";
    const base = window.location.origin + window.location.pathname;
    const link = base + "?ref=" + encodeURIComponent(info.referral_code || "");
    $("refLink").textContent = link;
    $("refLink").dataset.link = link;
    $("refCount").textContent = info.referral_count ?? 0;
    $("refPoints").textContent = fmtPoints(info.referral_points_earned || 0);
    setMsg($("refMsg"), "");
  } catch (err) {
    setMsg($("refMsg"), "مقدرناش نحمّل بيانات الإحالة: " + (err.message || ""), "error");
  }
}

$("copyRefBtn").addEventListener("click", async () => {
  const link = $("refLink").dataset.link || $("refLink").textContent || "";
  if (!link || link === "—") return;
  try {
    await navigator.clipboard.writeText(link);
    setMsg($("refMsg"), "اللينك اتنسخ ✅ — ابعته لصحابك!", "ok");
  } catch {
    // احتياطي للمتصفحات القديمة
    const tmp = document.createElement("textarea");
    tmp.value = link;
    document.body.appendChild(tmp);
    tmp.select();
    try { document.execCommand("copy"); setMsg($("refMsg"), "اللينك اتنسخ ✅ — ابعته لصحابك!", "ok"); }
    catch { setMsg($("refMsg"), "انسخ اللينك يدويًا من فوق.", "error"); }
    document.body.removeChild(tmp);
  }
});

// ---------- المحفظة ----------
async function loadWallet() {
  if (!state.user) { showView("auth"); return; }
  try {
    const w = await api("wallet");
    state.wallet = w;
    $("walletPoints").textContent = fmtPoints(w.points_balance);
    $("walletUsd").textContent = "≈ " + fmtUsd(w.balance_usd);
    $("walletHeld").textContent = fmtPoints(w.points_held);
    $("walletHeldUsd").textContent = "≈ " + fmtUsd(w.held_usd);
    $("walletTotal").textContent = fmtPoints(w.total_earned);
    await loadProfile();

    const ledger = $("ledger");
    const txs = w.transactions || [];
    $("ledgerEmpty").hidden = txs.length > 0;
    ledger.innerHTML = txs.map((tx) => {
      const pts = Number(tx.points || 0);
      return '<div class="ledger-row"><div><span class="note">' + esc(TX_LABEL[tx.type] || tx.type) +
        (tx.note ? " — " + esc(tx.note) : "") + '</span><span class="date">' + fmtDate(tx.created_at) + "</span></div>" +
        '<span class="ledger-amount ' + (pts >= 0 ? "pos" : "neg") + '">' +
        (pts >= 0 ? "+" : "−") + fmtPoints(Math.abs(pts)) + "</span></div>";
    }).join("");
    setMsg($("walletMsg"), "");
  } catch (err) {
    setMsg($("walletMsg"), "مقدرناش نحمّل المحفظة: " + (err.message || ""), "error");
  }
}

$("wdPoints").addEventListener("input", () => {
  const pts = Number($("wdPoints").value || 0);
  const rate = (state.wallet && state.wallet.points_per_usd) || 1000;
  $("wdPreview").textContent = pts > 0
    ? pts + " نقطة ≈ " + fmtUsd(Math.round((pts / rate) * 100) / 100)
    : "";
});

$("withdrawForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const points = Number($("wdPoints").value);
  if (!points || points < 1000) return setMsg($("wdMsg"), "أقل مبلغ للسحب 1000 نقطة (= 1 دولار).", "error");
  if (state.wallet && points > Number(state.wallet.points_balance || 0)) {
    return setMsg($("wdMsg"), "النقاط أكبر من رصيدك المتاح (" + fmtPoints(state.wallet.points_balance) + ").", "error");
  }
  const btn = e.target.querySelector("button[type=submit]");
  btn.disabled = true;
  setMsg($("wdMsg"), "جاري إرسال طلب السحب…");
  try {
    const res = await api("request-withdrawal", {
      points,
      method: $("wdMethod").value,
      number: $("wdNumber").value.trim()
    });
    setMsg($("wdMsg"), "طلب السحب اتبعت ✅ — " + fmtPoints(res.points) + " اتحجزت من رصيدك (≈ " + fmtUsd(res.amount_usd) + ")، والأدمن هيحوّل لك ويعلّم إنه اتدفع.", "ok");
    e.target.reset();
    $("wdPreview").textContent = "";
    await loadWallet();
  } catch (err) {
    setMsg($("wdMsg"), "مقدرناش نبعت الطلب: " + (err.message || "جرّب تاني."), "error");
  } finally { btn.disabled = false; }
});

// ---------- لوحة التحكم (أدمن) ----------
function userLabel(row) {
  const u = row.rw_users || row.users || row.user || null;
  if (u) return esc(u.name || u.email || "") + (u.email && u.name ? " (" + esc(u.email) + ")" : "");
  return "مستخدم: " + esc(row.user_id || "");
}

function reviewBlock(itemId, action, approveLabel, rejectLabel, notePlaceholder) {
  return '<div class="review-actions">' +
    '<input type="text" placeholder="' + esc(notePlaceholder || "ملاحظة (اختياري)") + '" data-note-for="' + esc(itemId) + '">' +
    '<button class="btn btn-primary btn-sm" data-review="' + esc(action) + '" data-id="' + esc(itemId) + '" data-decision="approve">' + esc(approveLabel) + "</button>" +
    '<button class="btn btn-danger btn-sm" data-review="' + esc(action) + '" data-id="' + esc(itemId) + '" data-decision="reject">' + esc(rejectLabel) + "</button>" +
    "</div>";
}

async function loadAdmin() {
  if (!state.user) { showView("auth"); return; }
  if (!state.user || state.user.role !== "admin") {
    setMsg($("adminMsg"), "الصفحة دي للأدمن بس.", "error");
    return;
  }
  setMsg($("adminMsg"), "");

  // الإحصائيات
  try {
    const s = await api("admin-stats");
    state.adminStats = s;
    $("statUsers").textContent = s.users_count ?? "—";
    $("statTotalPoints").textContent = Number(s.total_points_distributed ?? 0).toLocaleString("en-US");
    $("statWdPending").textContent = s.pending_withdrawals ?? "—";
    $("statMining").textContent = s.active_mining ?? "—";
    $("statTasksPending").textContent = s.pending_tasks ?? "—";
    $("statCashbackPending").textContent = s.pending_cashback ?? "—";
  } catch { /* الإحصائيات اختيارية */ }

  // طلبات السحب (كل الحالات — المعلقة أولاً)
  try {
    const wds = await api("admin-withdrawals");
    const pending = (wds || []).filter((w) => w.status === "pending");
    $("adminWithdrawalsEmpty").hidden = pending.length > 0;
    $("adminWithdrawals").innerHTML = pending.map((w) =>
      '<div class="queue-item"><div class="meta"><strong>' + fmtPoints(w.points) + " (≈ " + fmtUsd(w.amount_usd) + ")</strong> • " +
      esc(METHOD_LABEL[w.method] || w.method) + " • يتحوّل على: <strong dir='ltr'>" + esc(w.number || "—") + "</strong><br>" +
      userLabel(w) + " • " + fmtDate(w.created_at) + "</div>" +
      reviewBlock(w.id, "withdrawal", "اتدفع ✅", "رفض ❌") + "</div>"
    ).join("");
  } catch (err) {
    setMsg($("adminMsg"), "مقدرناش نحمّل طلبات السحب: " + (err.message || ""), "error");
  }

  // تسليمات المهام المعلقة
  try {
    const subs = await api("admin-task-completions");
    $("adminCompletionsEmpty").hidden = subs.length > 0;
    $("adminCompletions").innerHTML = (subs || []).map((s) => {
      const t = s.rw_tasks || s.tasks || {};
      return '<div class="queue-item"><div class="meta"><strong>' + esc(t.title || ("مهمة #" + s.task_id)) +
        "</strong> • النقاط: " + fmtPoints(t.points || 0) + "<br>" +
        userLabel(s) + " • " + fmtDate(s.created_at) + "</div>" +
        (s.proof ? '<div class="work">الإثبات: ' + esc(s.proof) + "</div>" : "") +
        reviewBlock(s.id, "task", "قبول ودفع النقاط ✅", "رفض ❌", "سبب الرفض (بيظهر للمستخدم)") + "</div>";
    }).join("");
  } catch { /* اختياري */ }

  // إدارة المهام (كل المهام — نشطة ومتوقفة)
  try {
    const tasks = await api("admin-tasks");
    state.adminTasks = tasks || [];
    renderAdminTasks();
  } catch { /* اختياري */ }

  // مطالبات الكاش باك المعلقة
  try {
    const claims = await api("admin-cashback-claims");
    state.adminCashbackClaims = claims || [];
    const pending = state.adminCashbackClaims.filter((c) => c.status === "pending");
    $("adminCashbackClaimsEmpty").hidden = pending.length > 0;
    $("adminCashbackClaims").innerHTML = pending.map((c) =>
      '<div class="queue-item"><div class="meta"><strong>' + esc(c.store_name || "متجر") +
      "</strong> • مشتريات: <strong>" + fmtUsd(c.purchase_amount_usd) + "</strong>" +
      (c.percent !== null && c.percent !== undefined ? " • النسبة: " + esc(String(c.percent)) + "%" : "") +
      ' • النقاط المستحقة: <strong>' + fmtPoints(c.points_earned) + "</strong><br>" +
      userLabel(c) + " • " + fmtDate(c.created_at) + "</div>" +
      (c.proof ? '<div class="work">الإثبات: ' + esc(c.proof) + "</div>" : "") +
      reviewBlock(c.id, "cashback", "قبول ودفع النقاط ✅", "رفض ❌", "سبب الرفض (بيظهر للمستخدم)") + "</div>"
    ).join("");
  } catch { /* اختياري */ }

  // إدارة عروض الكاش باك (كل العروض — نشطة ومتوقفة)
  try {
    const offers = await api("admin-cashback-offers");
    state.adminCashbackOffers = offers || [];
    renderAdminCashbackOffers();
  } catch { /* اختياري */ }

  // المستخدمون
  try {
    const users = await api("admin-users");
    state.adminUsers = users || [];
    $("adminUsersEmpty").hidden = state.adminUsers.length > 0;
    $("adminUsersList").innerHTML = state.adminUsers.map((u) =>
      '<div class="user-row"><div><strong>' + esc(u.name || "بدون اسم") + "</strong> " +
      (u.role === "admin" ? '<span class="role-badge">أدمن</span>' : "") +
      '<br><span class="muted small" dir="ltr">' + esc(u.email || "") + "</span><br>" +
      '<span class="small">النقاط: <strong>' + fmtPoints(u.points_balance) + "</strong> • المحجوز: " + fmtPoints(u.points_held) +
      " • إجمالي الكسب: " + fmtPoints(u.total_earned) + " • كود الإحالة: <strong dir='ltr'>" + esc(u.referral_code || "—") + "</strong></span></div>" +
      '<div class="adjust"><input type="number" step="1" placeholder="تعديل النقاط (+ أو −)" data-adjust-amt="' + esc(u.id) + '">' +
      '<input type="text" placeholder="سبب التعديل (اختياري)" data-adjust-note="' + esc(u.id) + '">' +
      '<button class="btn btn-secondary btn-sm" data-adjust-user="' + esc(u.id) + '">تعديل النقاط</button></div>' +
      '<p class="form-msg" data-adjust-msg="' + esc(u.id) + '"></p></div>'
    ).join("");
  } catch { /* اختياري */ }

  // الإعدادات
  try {
    const settings = await api("admin-settings", { action2: "get" });
    $("setMiningPerHour").value = settings.mining_points_per_hour ?? 100;
    $("setMiningDuration").value = settings.mining_duration_minutes ?? 60;
    $("setDailyBonus").value = settings.daily_bonus_points ?? 50;
    $("setReferral").value = settings.referral_points ?? 100;
    $("setPointsPerUsd").value = settings.points_per_usd ?? 1000;
    $("setCashbackPercent").value = settings.cashback_percent_default ?? 5;
  } catch { /* اختياري */ }

  bindAdminActions();
}

function renderAdminTasks() {
  $("adminTasksList").innerHTML = state.adminTasks.map((t) =>
    '<article class="task-card' + (t.active === false ? " inactive" : "") + '">' +
    '<div class="task-top"><h3>' + esc(t.title) + '</h3><span class="cat-badge">' + esc(t.type_label || t.type) + "</span></div>" +
    '<div class="pay">⭐ ' + fmtPoints(t.points) + (t.active === false ? ' <span class="status status-rejected">متوقفة</span>' : "") + "</div>" +
    '<p class="task-desc">' + esc(t.description) + "</p>" +
    '<div class="form-row">' +
    '<button class="btn btn-secondary btn-sm" data-edit-task="' + esc(t.id) + '">تعديل</button>' +
    (t.active !== false
      ? '<button class="btn btn-ghost btn-sm" data-toggle-task="' + esc(t.id) + '" data-active="false">إيقاف</button>'
      : '<button class="btn btn-primary btn-sm" data-toggle-task="' + esc(t.id) + '" data-active="true">تفعيل</button>') +
    "</div></article>"
  ).join("");

  $("adminTasksList").querySelectorAll("[data-edit-task]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const t = state.adminTasks.find((x) => String(x.id) === String(btn.dataset.editTask));
      if (!t) return;
      $("taskEditId").value = t.id;
      $("taskType").value = t.type || "like";
      $("taskTitle").value = t.title || "";
      $("taskDesc").value = t.description || "";
      $("taskPoints").value = t.points ?? "";
      $("taskUrl").value = t.url || "";
      $("taskSaveBtn").textContent = "احفظ التعديل";
      $("taskCancelEdit").hidden = false;
      $("taskForm").scrollIntoView({ behavior: "smooth" });
    });
  });
  $("adminTasksList").querySelectorAll("[data-toggle-task]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        await api("admin-task", { id: btn.dataset.toggleTask, active: btn.dataset.active === "true" });
        toast(btn.dataset.active === "true" ? "المهمة اتفعّلت ✅" : "المهمة اتوقفت ⏸️");
        await loadAdmin();
      } catch (err) {
        toast("مقدرناش نغيّر حالة المهمة: " + (err.message || ""));
        btn.disabled = false;
      }
    });
  });
}

function renderAdminCashbackOffers() {
  $("adminCashbackOffersList").innerHTML = state.adminCashbackOffers.map((o) =>
    '<article class="task-card' + (o.active === false ? " inactive" : "") + '">' +
    '<div class="task-top"><h3>' + esc(o.store_name) + '</h3><span class="cat-badge">كاش باك 💸</span></div>' +
    '<div class="pay">💸 ' + esc(String(o.percent)) + "% كاش باك" + (o.active === false ? ' <span class="status status-rejected">متوقف</span>' : "") + "</div>" +
    (o.description ? '<p class="task-desc">' + esc(o.description) + "</p>" : "") +
    '<p class="task-desc"><a href="' + esc(o.store_url) + '" target="_blank" rel="noopener" dir="ltr">' + esc(o.store_url) + "</a></p>" +
    '<div class="form-row">' +
    '<button class="btn btn-secondary btn-sm" data-edit-cb-offer="' + esc(o.id) + '">تعديل</button>' +
    (o.active !== false
      ? '<button class="btn btn-ghost btn-sm" data-toggle-cb-offer="' + esc(o.id) + '" data-active="false">إيقاف</button>'
      : '<button class="btn btn-primary btn-sm" data-toggle-cb-offer="' + esc(o.id) + '" data-active="true">تفعيل</button>') +
    '<button class="btn btn-danger btn-sm" data-delete-cb-offer="' + esc(o.id) + '">حذف</button>' +
    "</div></article>"
  ).join("");

  $("adminCashbackOffersList").querySelectorAll("[data-edit-cb-offer]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const o = state.adminCashbackOffers.find((x) => String(x.id) === String(btn.dataset.editCbOffer));
      if (!o) return;
      $("cbOfferEditId").value = o.id;
      $("cbStoreName").value = o.store_name || "";
      $("cbPercent").value = o.percent ?? "";
      $("cbStoreUrl").value = o.store_url || "";
      $("cbOfferDesc").value = o.description || "";
      $("cbOfferSaveBtn").textContent = "احفظ التعديل";
      $("cbOfferCancelEdit").hidden = false;
      $("cbOfferForm").scrollIntoView({ behavior: "smooth" });
    });
  });
  $("adminCashbackOffersList").querySelectorAll("[data-toggle-cb-offer]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        await api("admin-cashback-offer", { id: btn.dataset.toggleCbOffer, active: btn.dataset.active === "true" });
        toast(btn.dataset.active === "true" ? "العرض اتفعّل ✅" : "العرض اتوقف ⏸️");
        await loadAdmin();
      } catch (err) {
        toast("مقدرناش نغيّر حالة العرض: " + (err.message || ""));
        btn.disabled = false;
      }
    });
  });
  $("adminCashbackOffersList").querySelectorAll("[data-delete-cb-offer]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("متأكد إنك عايز تحذف العرض ده؟ (مينفعش حذفه لو عليه مطالبات)")) return;
      btn.disabled = true;
      try {
        await api("admin-cashback-offer", { action2: "delete", id: btn.dataset.deleteCbOffer });
        toast("العرض اتحذف ✅");
        await loadAdmin();
      } catch (err) {
        toast("مقدرناش نحذف العرض: " + (err.message || ""));
        btn.disabled = false;
      }
    });
  });
}

$("cbOfferForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("cbOfferSaveBtn");
  btn.disabled = true;
  setMsg($("cbOfferMsg"), "جاري الحفظ…");
  const payload = {
    store_name: $("cbStoreName").value.trim(),
    percent: Number($("cbPercent").value),
    store_url: $("cbStoreUrl").value.trim(),
    description: $("cbOfferDesc").value.trim() || null,
    active: true
  };
  const editId = $("cbOfferEditId").value;
  if (editId) payload.id = editId;
  try {
    await api("admin-cashback-offer", payload);
    setMsg($("cbOfferMsg"), editId ? "العرض اتعدّل ✅" : "العرض اتضاف ✅", "ok");
    e.target.reset();
    $("cbOfferEditId").value = "";
    $("cbOfferSaveBtn").textContent = "أضف العرض";
    $("cbOfferCancelEdit").hidden = true;
    await loadAdmin();
  } catch (err) {
    setMsg($("cbOfferMsg"), "مقدرناش نحفظ العرض: " + (err.message || ""), "error");
  } finally { btn.disabled = false; }
});

$("cbOfferCancelEdit").addEventListener("click", () => {
  $("cbOfferForm").reset();
  $("cbOfferEditId").value = "";
  $("cbOfferSaveBtn").textContent = "أضف العرض";
  $("cbOfferCancelEdit").hidden = true;
  setMsg($("cbOfferMsg"), "");
});

function bindAdminActions() {
  // أزرار المراجعة (سحب / تسليم مهمة)
  document.querySelectorAll("[data-review]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const action = btn.dataset.review;
      const id = btn.dataset.id;
      const noteInput = document.querySelector('[data-note-for="' + id + '"]');
      const note = noteInput ? noteInput.value.trim() : "";
      const decision = btn.dataset.decision === "approve"
        ? (action === "withdrawal" ? "paid" : "approved")
        : "rejected";
      btn.disabled = true;
      try {
        if (action === "withdrawal") {
          await api("admin-approve-withdrawal", { id, decision, note });
          toast(decision === "paid" ? "اتعلّم إنها اتدفعت ✅" : "طلب السحب اترفض والنقاط رجعت للمستخدم.");
        } else if (action === "cashback") {
          await api("admin-review-cashback-claim", { id, decision, note });
          toast(decision === "approved" ? "اتقبل واتدفعت النقاط ✅" : "مطالبة الكاش باك اترفضت.");
        } else {
          await api("admin-review-task", { id, decision, note });
          toast(decision === "approved" ? "اتقبل واتدفعت النقاط ✅" : "التسليم اترفض.");
        }
        await loadAdmin();
      } catch (err) {
        toast("مقدرناش ننفذ المراجعة: " + (err.message || ""));
        btn.disabled = false;
      }
    });
  });
  // تعديل نقاط المستخدمين
  document.querySelectorAll("[data-adjust-user]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const uid = btn.dataset.adjustUser;
      const amtInput = document.querySelector('[data-adjust-amt="' + uid + '"]');
      const noteInput = document.querySelector('[data-adjust-note="' + uid + '"]');
      const msgEl = document.querySelector('[data-adjust-msg="' + uid + '"]');
      const points = Number(amtInput ? amtInput.value : 0);
      if (!points || !Number.isInteger(points)) return setMsg(msgEl, "اكتب عدد نقاط التعديل الأول (موجب للزيادة وسالب للنقص).", "error");
      btn.disabled = true;
      try {
        await api("admin-user", {
          user_id: uid,
          points,
          note: noteInput ? noteInput.value.trim() : ""
        });
        setMsg(msgEl, "النقاط اتعدّلت ✅", "ok");
        await loadAdmin();
      } catch (err) {
        setMsg(msgEl, "مقدرناش نعدّل النقاط: " + (err.message || ""), "error");
        btn.disabled = false;
      }
    });
  });
}

$("taskForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("taskSaveBtn");
  btn.disabled = true;
  setMsg($("taskMsg"), "جاري الحفظ…");
  const payload = {
    type: $("taskType").value,
    title: $("taskTitle").value.trim(),
    description: $("taskDesc").value.trim(),
    points: Number($("taskPoints").value),
    url: $("taskUrl").value.trim() || null,
    active: true
  };
  const editId = $("taskEditId").value;
  if (editId) payload.id = editId;
  try {
    await api("admin-task", payload);
    setMsg($("taskMsg"), editId ? "المهمة اتعدّلت ✅" : "المهمة اتضافت ✅", "ok");
    e.target.reset();
    $("taskEditId").value = "";
    $("taskSaveBtn").textContent = "أضف المهمة";
    $("taskCancelEdit").hidden = true;
    await loadAdmin();
  } catch (err) {
    setMsg($("taskMsg"), "مقدرناش نحفظ المهمة: " + (err.message || ""), "error");
  } finally { btn.disabled = false; }
});

$("taskCancelEdit").addEventListener("click", () => {
  $("taskForm").reset();
  $("taskEditId").value = "";
  $("taskSaveBtn").textContent = "أضف المهمة";
  $("taskCancelEdit").hidden = true;
  setMsg($("taskMsg"), "");
});

$("settingsForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector("button[type=submit]");
  btn.disabled = true;
  setMsg($("settingsMsg"), "جاري حفظ الإعدادات…");
  try {
    await api("admin-settings", {
      settings: {
        mining_points_per_hour: $("setMiningPerHour").value,
        mining_duration_minutes: $("setMiningDuration").value,
        daily_bonus_points: $("setDailyBonus").value,
        referral_points: $("setReferral").value,
        points_per_usd: $("setPointsPerUsd").value,
        cashback_percent_default: $("setCashbackPercent").value
      }
    });
    setMsg($("settingsMsg"), "الإعدادات اتحفظت ✅", "ok");
  } catch (err) {
    setMsg($("settingsMsg"), "مقدرناش نحفظ الإعدادات: " + (err.message || ""), "error");
  } finally { btn.disabled = false; }
});

// ---------- تشغيل التطبيق ----------
(function init() {
  renderFilters();
  // كود إحالة من رابط الدعوة (?ref=SWXXXXXX) يتعبّى تلقائيًا في نموذج التسجيل
  try {
    const ref = new URLSearchParams(window.location.search).get("ref");
    if (ref) {
      $("regReferral").value = ref.trim().toUpperCase();
      $("tabRegister").click();
    }
  } catch { /* تجاهل */ }
  if (!CONFIG_OK) {
    toast("⚠️ ظبط الأول API_BASE في ملف config.js.");
  }
  refreshSession();
  showView("home");
})();
