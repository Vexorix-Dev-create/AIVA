
/* ======================== SUPABASE AUTH ======================== */
const SUPABASE_URL      = "https://tkkvdzhidigcrbdwjizh.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_pFOoCKgSPTw3Q_Cb_4F_tw_Q5MyIrF3";
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let authMode = "login"; // "login" | "signup"
let currentAivaUser = null; // Supabase auth user object saat login

function showAuthError(msg){
  const el = document.getElementById("authError");
  if(!el) return;
  el.textContent = msg;
  el.classList.add("show");
}
function clearAuthError(){
  const el = document.getElementById("authError");
  if(!el) return;
  el.textContent = "";
  el.classList.remove("show");
}

function toggleAuthMode(){
  clearAuthError();
  authMode = authMode === "login" ? "signup" : "login";
  const label = document.getElementById("authModeLabel");
  const desc  = document.getElementById("authModeDesc");
  const btn   = document.getElementById("authSubmitBtn");
  const toggle= document.getElementById("authToggleText");
  if(authMode === "signup"){
    label.textContent = "Daftar ke";
    desc.textContent  = "Buat akun baru untuk mulai mengobrol dengan AIVA.";
    btn.textContent   = "Daftar →";
    toggle.innerHTML  = 'Sudah punya akun? <span>Masuk</span>';
  } else {
    label.textContent = "Masuk ke";
    desc.textContent  = "Masuk untuk melanjutkan percakapanmu dengan AIVA.";
    btn.textContent   = "Masuk →";
    toggle.innerHTML  = 'Belum punya akun? <span>Daftar</span>';
  }
}

async function handleAuthSubmit(){
  clearAuthError();
  const email = (document.getElementById("authEmail")?.value || "").trim();
  const password = document.getElementById("authPassword")?.value || "";
  const btn = document.getElementById("authSubmitBtn");

  if(!email || !password){ showAuthError("Isi email dan kata sandi terlebih dahulu."); return; }
  if(password.length < 6){ showAuthError("Kata sandi minimal 6 karakter."); return; }

  btn.disabled = true;
  const originalText = btn.textContent;
  btn.textContent = authMode === "signup" ? "Mendaftarkan…" : "Masuk…";

  try{
    if(authMode === "signup"){
      const { data, error } = await sb.auth.signUp({ email, password });
      if(error) throw error;
      if(data.user && !data.session){
        showAuthError("Akun dibuat! Cek email kamu untuk verifikasi, lalu masuk.");
        authMode = "signup"; toggleAuthMode(); // kembalikan tampilan ke mode login
        btn.disabled = false;
        return;
      }
      if(data.session) await onAuthSuccess(data.user);
    } else {
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      if(error) throw error;
      await onAuthSuccess(data.user);
    }
  }catch(err){
    showAuthError(translateAuthError(err.message));
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

function translateAuthError(msg){
  if(!msg) return "Terjadi kesalahan. Coba lagi.";
  if(msg.includes("Invalid login credentials")) return "Email atau kata sandi salah.";
  if(msg.includes("User already registered")) return "Email ini sudah terdaftar. Coba masuk.";
  if(msg.includes("Email not confirmed")) return "Email belum diverifikasi. Cek inbox kamu.";
  if(msg.includes("Password should be")) return "Kata sandi terlalu pendek (minimal 6 karakter).";
  return msg;
}

async function handleGoogleLogin(){
  clearAuthError();
  try{
    const { error } = await sb.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.href }
    });
    if(error) throw error;
  }catch(err){
    showAuthError(translateAuthError(err.message));
  }
}

async function handleLogout(){
  try{ await sb.auth.signOut(); }catch(e){}
  localStorage.removeItem("aivaUserName");
  localStorage.removeItem("aivaNameSet");
  currentAivaUser = null;
  window.location.reload();
}

// Dipanggil setelah login/signup sukses: ambil profil, sinkron nama, lalu masuk ke app
async function onAuthSuccess(user){
  currentAivaUser = user;
  try{
    const { data: profile } = await sb
      .from("profiles")
      .select("display_name")
      .eq("id", user.id)
      .maybeSingle();
    if(profile && profile.display_name){
      localStorage.setItem("aivaUserName", profile.display_name);
      localStorage.setItem("aivaNameSet", "1");
    }
  }catch(e){}
  hideAuthScreen();
}

function showAuthScreen(){
  const el = document.getElementById("authScreen");
  if(!el) return;
  el.classList.add("auth-show");
}
function hideAuthScreen(){
  const el = document.getElementById("authScreen");
  if(!el) return;
  el.classList.add("auth-out");
  setTimeout(() => {
    el.remove();
    if(!localStorage.getItem('aivaNameSet')) showNameScreen();
  }, 600);
}

// Sinkronkan nama yang diisi user di nameScreen ke tabel profiles (best-effort)
async function syncDisplayNameToSupabase(name){
  if(!currentAivaUser) return;
  try{
    await sb.from("profiles").update({ display_name: name }).eq("id", currentAivaUser.id);
  }catch(e){}
}

/* ======================== CONFIG ======================== */
const DARK_LOGO      = "https://i.ibb.co.com/SD7LZgmv/Picsart-26-04-29-23-27-26-445.jpg";
const LIGHT_LOGO     = "https://i.ibb.co.com/XrH4nnQy/file-0000000005a87208a1ebd9aff2438f5f.png";
const WORM_DARK_LOGO  = "https://i.ibb.co.com/99tJgJhS/file-00000000329c71fa9276e0523e9d3280.png";
const WORM_LIGHT_LOGO = "https://i.ibb.co.com/DfwHjQWQ/file-00000000dd60720b981ce0fea0b8b9b5.png";
const MODEL_LABELS   = { groq:"Qwen (Smart)", qwen:"Aiva", glm:"GLM (z.ai)", gpt:"GPT-OSS 20B" };

// Active models for multi-chat (min 2 selected)
let activeMultiModels = ["groq","qwen","glm","gpt"];

/* ======================== API CALLS (via Vercel API routes) ======================== */

// MultiMind AbortController — di-set baru tiap sendMultiMind, di-abort saat stop
let mmController = null;

async function callGroq(message, history, signal) {
  const resp = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, api: "groq", history, userName: localStorage.getItem("aivaUserName")||"" }),
    signal: signal || undefined
  });
  if (!resp.ok) throw new Error("Server HTTP " + resp.status);
  const d = await resp.json();
  if (d.reply && d.reply.startsWith("Server error:")) throw new Error(d.reply);
  return d.reply;
}

async function callQwen(message, history, signal) {
  const resp = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, api: "qwen", history, userName: localStorage.getItem("aivaUserName")||"" }),
    signal: signal || undefined
  });
  if (!resp.ok) throw new Error("Server HTTP " + resp.status);
  const d = await resp.json();
  if (d.reply && d.reply.startsWith("Server error:")) throw new Error(d.reply);
  return d.reply;
}

async function callGlm(message, history, signal) {
  const resp = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, api: "glm", history, userName: localStorage.getItem("aivaUserName")||"" }),
    signal: signal || undefined
  });
  if (!resp.ok) throw new Error("Server HTTP " + resp.status);
  const d = await resp.json();
  if (d.reply && d.reply.startsWith("Server error:")) throw new Error(d.reply);
  return d.reply;
}

async function callGpt(message, history, signal) {
  const resp = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, api: "gpt", history, userName: localStorage.getItem("aivaUserName")||"" }),
    signal: signal || undefined
  });
  if (!resp.ok) throw new Error("Server HTTP " + resp.status);
  const d = await resp.json();
  if (d.reply && d.reply.startsWith("Server error:")) throw new Error(d.reply);
  return d.reply;
}

// Worm Aiva — backend custom OpetxDy
async function callWorm(message, history, signal) {
  const resp = await fetch("/api/worm-chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, history, userName: localStorage.getItem("aivaUserName")||"" }),
    signal: signal || undefined
  });
  if (!resp.ok) throw new Error("Server HTTP " + resp.status);
  const d = await resp.json();
  if (d.reply && d.reply.startsWith("Server error:")) throw new Error(d.reply);
  return d.reply;
}

// callAPI biasa (single chat — tanpa signal)
async function callAPI(api, message, history) {
  if (api === "groq") return callGroq(message, history);
  if (api === "qwen") return callQwen(message, history);
  if (api === "glm")  return callGlm(message, history);
  if (api === "gpt")  return callGpt(message, history);
  if (api === "worm") return callWorm(message, history);
  throw new Error("Unknown API: " + api);
}

// callAPI dengan signal — dipakai sendMultiMind agar bisa di-abort
async function callAPISignal(api, message, history, signal) {
  if (api === "groq") return callGroq(message, history, signal);
  if (api === "qwen") return callQwen(message, history, signal);
  if (api === "glm")  return callGlm(message, history, signal);
  if (api === "gpt")  return callGpt(message, history, signal);
  if (api === "worm") return callWorm(message, history, signal);
  throw new Error("Unknown API: " + api);
}

async function callMultiAPI(message, models) {
  // Bangun history dari sesi aktif untuk dikirim ke server (Vercel stateless)
  const multiHistory = buildMultiHistory();
  const resp = await fetch("/api/multi-chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, models: models || activeMultiModels, history: multiHistory, userName: localStorage.getItem("aivaUserName")||"" })
  });
  if (!resp.ok) throw new Error("Server HTTP " + resp.status);
  const d = await resp.json();
  if (d.error) throw new Error(d.error);
  return d.replies;
}

/* ======================== STATE ======================== */
let isGenerating = false, stopTyping = false;
let typingTimer = null, controller = null;
let autoScrollEnabled = true;
let currentAPI = "groq";
let chatMode = "single"; // "single" | "multi" | "multimind"
let wormMode = false; // false = Normal, true = Worm (single chat only)
let mmIsGenerating = false; // MultiMind generating flag
let mmStopRequested = false; // MultiMind stop flag
let mmCallId = 0;        // Unique counter per sendMultiMind call — prevents duplicate element IDs
let mmCurrentWrap = null; // Tracks the bubble currently being generated (for stop button)
let sessions = [];
let activeId  = null;

/* ======================== DOM ======================== */
const chatEl    = document.getElementById("chat");
const inputEl   = document.getElementById("text");
const sendBtn   = document.getElementById("sendBtn");
const stopBtn   = document.getElementById("stopBtn");
const panel     = document.getElementById("panel");
const sidebar   = document.getElementById("sidebar");
const overlay   = document.getElementById("overlay");
const sbHist    = document.getElementById("sbHistory");
const inputWrap = document.getElementById("inputWrap");
const modeHint  = document.getElementById("modeHint");

/* ======================== SPLASH ======================== */
window.addEventListener("load", () => {
  const t = localStorage.getItem("theme") || "dark";
  if(t === "light") document.body.classList.add("light");
  wormMode = localStorage.getItem("aivaWormMode") === "1";
  updateWcLogo();
  const api = localStorage.getItem("api") || "groq";
  currentAPI = api;
  const mode = localStorage.getItem("chatMode") || "single";
  chatMode = mode;
  applyModeUI();
  updateModelSwitcherVisibility();
  updateModelDropdownActive();
  loadSessions();
  renderHistory();
  if(chatMode === "multimind") buildMultiMindWelcome();
  else buildWelcome();
  setTimeout(() => {
    const s = document.getElementById("splash");
    if(!s) return;
    s.classList.add("out");
    setTimeout(async () => {
      s.remove();
      const { data: { session } } = await sb.auth.getSession();
      if(session && session.user){
        await onAuthSuccess(session.user);
        const asEl = document.getElementById("authScreen");
        if(asEl) asEl.remove();
      } else {
        showAuthScreen();
      }
    }, 900);
  }, 2200);

  // Jika kembali dari redirect Google OAuth, tangani begitu sesi tersedia
  sb.auth.onAuthStateChange((event, session) => {
    if(event === "SIGNED_IN" && session && session.user && !currentAivaUser){
      onAuthSuccess(session.user);
      const asEl = document.getElementById("authScreen");
      if(asEl) asEl.remove();
    }
  });

  // ── Splash canvas: bintang + meteor ──────────────────────────────────────
  (function(){
    const canvas = document.getElementById('splashCanvas');
    if(!canvas) return;
    const ctx = canvas.getContext('2d');
    const isLight = document.body.classList.contains('light');

    function resize(){
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    // Bintang
    const STAR_COUNT = isLight ? 60 : 160;
    const stars = Array.from({length: STAR_COUNT}, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      r: Math.random() * (isLight ? 1.2 : 1.8) + 0.3,
      a: Math.random(),
      da: (Math.random() * 0.012 + 0.004) * (Math.random() < 0.5 ? 1 : -1),
      color: isLight
        ? `rgba(61,114,246,` 
        : (Math.random() < 0.3 ? `rgba(167,139,245,` : `rgba(180,200,255,`)
    }));

    // Meteor / bintang jatuh
    const meteors = [];
    function spawnMeteor(){
      const fromLeft = Math.random() < 0.5;
      meteors.push({
        x: fromLeft ? -50 : canvas.width + 50,
        y: Math.random() * canvas.height * 0.55,
        vx: fromLeft ? (4 + Math.random() * 5) : -(4 + Math.random() * 5),
        vy: 2 + Math.random() * 3,
        len: 90 + Math.random() * 120,
        alpha: 1,
        width: isLight ? 1.5 : 2,
        color: isLight ? '61,114,246' : (Math.random()<0.5?'167,139,245':'140,180,255')
      });
    }
    // Spawn beberapa langsung
    spawnMeteor(); spawnMeteor();
    let lastMeteor = 0;

    function draw(ts){
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Bintang berkedip
      for(const s of stars){
        s.a += s.da;
        if(s.a > 1 || s.a < 0.1) s.da *= -1;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI*2);
        ctx.fillStyle = s.color + Math.min(1, Math.max(0, s.a)) + ')';
        ctx.fill();
      }

      // Spawn meteor tiap ~700ms
      if(ts - lastMeteor > 700 + Math.random()*400){
        spawnMeteor();
        lastMeteor = ts;
      }

      // Gambar meteor
      for(let i = meteors.length - 1; i >= 0; i--){
        const m = meteors[i];
        m.x += m.vx; m.y += m.vy;
        m.alpha -= 0.018;
        if(m.alpha <= 0){ meteors.splice(i,1); continue; }

        const angle = Math.atan2(m.vy, m.vx);
        const gx = m.x - Math.cos(angle)*m.len;
        const gy = m.y - Math.sin(angle)*m.len;
        const grad = ctx.createLinearGradient(gx, gy, m.x, m.y);
        grad.addColorStop(0, `rgba(${m.color},0)`);
        grad.addColorStop(0.7, `rgba(${m.color},${m.alpha*0.6})`);
        grad.addColorStop(1, `rgba(${m.color},${m.alpha})`);

        ctx.beginPath();
        ctx.moveTo(gx, gy);
        ctx.lineTo(m.x, m.y);
        ctx.strokeStyle = grad;
        ctx.lineWidth = m.width;
        ctx.lineCap = 'round';
        ctx.stroke();

        // Kepala bintang kecil bercahaya
        ctx.beginPath();
        ctx.arc(m.x, m.y, m.width*1.4, 0, Math.PI*2);
        ctx.fillStyle = `rgba(${m.color},${m.alpha})`;
        ctx.fill();
      }

      if(document.getElementById('splash')) requestAnimationFrame(draw);
    }
    requestAnimationFrame(draw);
  })();
});

function updateWcLogo(){
  const el = document.getElementById("welcomeLogo");
  if(!el) return;
  el.src = getCurrentLogo();
  el.classList.toggle("worm-glow", chatMode === "single" && wormMode);
}

/* ======================== MODE ======================== */
function setMode(m){
  chatMode = m;
  localStorage.setItem("chatMode", m);
  applyModeUI();
  updateModelSwitcherVisibility();
  newChat();
}

function applyModeUI(){
  const isSingle = chatMode === "single";
  const isMulti = chatMode === "multi";
  const isMultiMind = chatMode === "multimind";
  // Toggle Gemini glow — only active in single mode
  const glowWrap = document.getElementById("inputGlowWrap");
  if(glowWrap){
    glowWrap.classList.toggle("multi-mode", isMulti);
    glowWrap.classList.toggle("multimind-mode", isMultiMind);
  }
  document.getElementById("btnModeSingle").classList.toggle("active", isSingle);
  document.getElementById("btnModeMulti").classList.toggle("active", isMulti);
  document.getElementById("btnModeMulti").classList.toggle("multi", true);
  // MultiMind button active state
  const mmBtn = document.getElementById("btnModeMultiMind");
  if(mmBtn){
    mmBtn.style.background = isMultiMind ? "rgba(245,158,11,0.18)" : "rgba(245,158,11,0.06)";
    mmBtn.style.color = isMultiMind ? "#f59e0b" : "rgba(245,158,11,0.55)";
    mmBtn.style.borderColor = isMultiMind ? "rgba(245,158,11,0.45)" : "rgba(245,158,11,0.18)";
  }
  const badge = document.getElementById("modeBadgeInner");
  const badgeText = document.getElementById("modeBadgeText");

  // Normal/Worm switch — only shown in single chat
  const switchRow = document.getElementById("modeSwitchRow");
  if(switchRow) switchRow.style.display = isSingle ? "flex" : "none";

  if(isSingle){
    badge.classList.remove("multi","multimind");
    badgeText.textContent = "Single";
    modeHint.textContent = "";
    inputEl.placeholder = "Message AIVA...";
    document.getElementById("inputBox").style.display = "";
    document.getElementById("canvasInputBar").style.display = "none";
    document.getElementById("canvasSpace").classList.remove("active");
    document.getElementById("canvasZoomBar").style.display = "none";
    document.getElementById("chat").style.display = "";
  } else if(isMulti){
    badge.classList.remove("multimind");
    badge.classList.add("multi");
    badgeText.textContent = "Multi";
    document.getElementById("inputBox").style.display = "none";
    document.getElementById("canvasInputBar").style.display = "block";
    document.getElementById("canvasSpace").classList.add("active");
    document.getElementById("canvasZoomBar").style.display = "flex";
    document.getElementById("chat").style.display = "none";
  } else { // multimind
    badge.classList.remove("multi");
    badge.classList.add("multimind");
    badgeText.textContent = "MultiMind";
    document.getElementById("inputBox").style.display = "";
    document.getElementById("canvasInputBar").style.display = "none";
    document.getElementById("canvasSpace").classList.remove("active");
    document.getElementById("canvasZoomBar").style.display = "none";
    document.getElementById("chat").style.display = "";
    inputEl.placeholder = "Tanya MultiMind — 4 AI debat & voting...";
    modeHint.textContent = "4 AI debat & voting jawaban terbaik";
  }

  syncWormUI();
}

/* ======================== WORM MODE ======================== */
// Sub-mode of "single" chat: Normal (biru, model switcher aktif) vs
// Worm (merah, pakai backend Worm Aiva, model switcher disembunyikan).
// Pesan tetap disimpan di sesi single chat yang sama (gabung).
function toggleWormMode(){
  if(chatMode !== "single") return;
  wormMode = !wormMode;
  localStorage.setItem("aivaWormMode", wormMode ? "1" : "0");
  syncWormUI();
}

function getCurrentLogo(){
  const isLight = document.body.classList.contains("light");
  if(chatMode === "single" && wormMode) return isLight ? WORM_LIGHT_LOGO : WORM_DARK_LOGO;
  return isLight ? LIGHT_LOGO : DARK_LOGO;
}

function syncWormUI(){
  const active = chatMode === "single" && wormMode;

  const glowWrap  = document.getElementById("inputGlowWrap");
  const wrap      = document.getElementById("inputWrap");
  const switchEl  = document.getElementById("modeSwitch");
  const optNormal = document.getElementById("modeSwitchNormal");
  const optWorm   = document.getElementById("modeSwitchWorm");

  if(glowWrap)  glowWrap.classList.toggle("worm-mode", active);
  if(wrap)      wrap.classList.toggle("worm-mode", active);
  if(sendBtn)   sendBtn.classList.toggle("worm-mode", active);
  if(switchEl)  switchEl.classList.toggle("worm-active", wormMode);
  if(optNormal) optNormal.classList.toggle("active", !wormMode);
  if(optWorm)   optWorm.classList.toggle("active", wormMode);
  document.body.classList.toggle("worm-active", active);

  if(chatMode === "single"){
    inputEl.placeholder = wormMode ? "Message Worm Aiva..." : "Message AIVA...";
    const badgeTextEl = document.getElementById("modeBadgeText");
    if(badgeTextEl) badgeTextEl.textContent = wormMode ? "Uncensored" : "Single";
  }

  updateModelSwitcherVisibility();
  updateWcLogo();
}

/* ======================== SESSIONS ======================== */
function saveSessions(){
  try{ localStorage.setItem("aiva_sessions", JSON.stringify(sessions)); }catch(e){}
}
function loadSessions(){
  try{
    const r = localStorage.getItem("aiva_sessions");
    sessions = r ? JSON.parse(r) : [];
  }catch(e){ sessions = []; }
}

function renderHistory(){
  sbHist.innerHTML = "";
  if(!sessions.length){
    sbHist.innerHTML = '<div class="sb-empty">Belum ada chat</div>';
    return;
  }
  [...sessions].reverse().forEach(s => {
    const el = document.createElement("div");
    const isMulti = s.type === "multi";
    const isMultiMind = s.type === "multimind";
    el.className = "sb-item " + (isMulti ? "multi-session" : isMultiMind ? "multimind-session" : "single-session") + (s.id === activeId ? " active" : "");
    el.innerHTML = `
      <div class="sb-item-icon">
        ${isMulti
          ? '<svg viewBox="0 0 24 24" fill="none" stroke-width="2"><circle cx="8" cy="12" r="2" fill="currentColor"/><circle cx="16" cy="12" r="2" fill="currentColor"/><circle cx="12" cy="8" r="2" fill="currentColor"/></svg>'
          : isMultiMind
          ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.46 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.44-4.14z"/><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.46 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.44-4.14z"/></svg>'
          : '<svg viewBox="0 0 24 24" fill="none"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" stroke="currentColor" stroke-width="1.8"/></svg>'
        }
      </div>
      <div class="sb-item-label" id="label-${s.id}">${escHtml(s.title)}</div>
      <div class="sb-item-actions" style="display:none;align-items:center;gap:2px;margin-right:4px;">
        <div class="sb-item-edit" onclick="event.stopPropagation();startEditSession('${s.id}')" title="Edit judul" style="width:24px;height:24px;border-radius:6px;display:flex;align-items:center;justify-content:center;cursor:pointer;opacity:0.6;transition:opacity 0.15s;" onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.6'">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </div>
        <div class="sb-item-del" onclick="event.stopPropagation();deleteSession('${s.id}')" style="width:24px;height:24px;border-radius:6px;display:flex;align-items:center;justify-content:center;cursor:pointer;">
          <svg viewBox="0 0 24 24" fill="none"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
        </div>
      </div>`;
    el.querySelector('.sb-item-actions').style.display = 'none';
    el.addEventListener("mouseenter", () => { el.querySelector('.sb-item-actions').style.display = 'flex'; });
    el.addEventListener("mouseleave", () => { el.querySelector('.sb-item-actions').style.display = 'none'; });
    el.addEventListener("click", () => { loadSession(s.id); closeSidebar(); });
    sbHist.appendChild(el);
  });
}

function startEditSession(id){
  const sess = sessions.find(s => s.id === id);
  if(!sess) return;
  const labelEl = document.getElementById("label-" + id);
  if(!labelEl) return;
  const input = document.createElement("input");
  input.value = sess.title;
  input.style.cssText = "background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.2);border-radius:5px;color:#fff;font-size:12px;padding:2px 6px;width:100%;outline:none;font-family:inherit;";
  labelEl.replaceWith(input);
  input.focus();
  input.select();
  const save = () => {
    const newTitle = input.value.trim() || sess.title;
    sess.title = newTitle;
    saveSessions();
    renderHistory();
  };
  input.addEventListener("blur", save);
  input.addEventListener("keydown", e => { if(e.key==="Enter") input.blur(); if(e.key==="Escape"){ input.value=sess.title; input.blur(); } });
  input.addEventListener("click", e => e.stopPropagation());
}

function newSession(type){
  const id = "s" + Date.now();
  sessions.push({ id, title: "New Chat", type: type || chatMode, messages: [] });
  activeId = id;
  saveSessions();
  renderHistory();
  return id;
}

function loadSession(id){
  activeId = id;
  const sess = sessions.find(s => s.id === id);
  if(!sess) return;
  // Switch mode to match session type
  if(sess.type && sess.type !== chatMode){
    chatMode = sess.type;
    localStorage.setItem("chatMode", chatMode);
    applyModeUI();
    updateModelSwitcherVisibility();
  }

  if(chatMode === "multi"){
    // Canvas restore
    cvRestoreSession(sess);
  } else if(chatMode === "multimind"){
    chatEl.innerHTML = "";
    // Tampilkan welcome hanya jika belum ada pesan
    if(!sess.messages || sess.messages.length === 0){ buildMultiMindWelcome(); }
    sess.messages.forEach(m => {
      if(m.role === "user"){
        const d = document.createElement("div");
        d.className = "msg user";
        d.innerHTML = escHtml(m.text) + `<span class="msg-time">${m.time}</span>`;
        chatEl.appendChild(d);
      } else if(m.role === "multimind-result"){
        const d = buildMultiMindResultEl(m);
        chatEl.appendChild(d);
      }
    });
  } else {
    chatEl.innerHTML = "";
    sess.messages.forEach(m => {
      if(m.role === "user" || m.role === "ai"){
        const d = document.createElement("div");
        d.className = "msg " + m.role;

        // Rebuild file preview HTML for user messages that had attachments
        let extraHtml = "";
        if(m.role === "user" && m.files && m.files.length){
          const imgFiles = m.files.filter(f => f.isImage && f.dataUrl);
          const otherFiles = m.files.filter(f => !f.isImage);
          const hasBelow = otherFiles.length || m.text;

          if(imgFiles.length){
            const n = imgFiles.length;
            const mbBot = hasBelow ? "10px" : "0px";
            const brBot = hasBelow ? "0 0" : "4px 14px";
            if(n === 1){
              const f = imgFiles[0];
              extraHtml += '<div style="margin:-12px -16px ' + mbBot + ' -16px;overflow:hidden;border-radius:14px 14px ' + brBot + ';">'
                + '<img src="' + f.dataUrl + '" style="width:100%;height:210px;object-fit:cover;display:block;" alt="' + escHtml(f.name) + '">'
                + '<div style="background:rgba(0,0,0,0.35);padding:5px 11px;display:flex;align-items:center;gap:4px;min-width:0;">'
                + '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.55)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>'
                + '<span style="font-size:10px;color:rgba(255,255,255,0.65);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;line-height:1.2;">' + escHtml(f.name) + '</span>'
                + '</div></div>' + (hasBelow ? '<div style="height:10px"></div>' : "");
            } else {
              extraHtml += '<div style="margin:-12px -16px ' + mbBot + ' -16px;overflow-x:auto;overflow-y:hidden;display:flex;flex-direction:row;gap:2px;background:rgba(0,0,0,0.18);border-radius:14px 14px ' + brBot + ';scrollbar-width:none;-ms-overflow-style:none;">' +
                imgFiles.map(function(f, idx){
                  var tl = idx===0?"14px":"0";
                  var bl = idx===0&&!hasBelow?"4px":"0";
                  var tr = idx===n-1?"14px":"0";
                  var br = idx===n-1&&!hasBelow?"14px":"0";
                  return '<div style="flex:0 0 90px;overflow:hidden;border-radius:' + tl + ' ' + tr + ' ' + br + ' ' + bl + ';">'
                    + '<img src="' + f.dataUrl + '" style="width:90px;height:90px;object-fit:cover;display:block;" alt="' + escHtml(f.name) + '">'
                    + '</div>';
                }).join("") + '</div>' + (hasBelow ? '<div style="height:10px"></div>' : "");
            }
          }
          if(otherFiles.length){
            extraHtml += otherFiles.map(function(f){
              var ext = f.name.split(".").pop().toUpperCase().slice(0,5);
              var svg = getFileIconSVG(f.name, f.type || "");
              return '<div style="display:flex;align-items:center;gap:8px;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.15);border-radius:8px;padding:6px 10px 6px 7px;margin-bottom:3px;width:100%;box-sizing:border-box;">'
                + '<div style="width:28px;height:28px;min-width:28px;border-radius:6px;background:rgba(255,255,255,0.18);display:flex;align-items:center;justify-content:center;flex-shrink:0;color:#fff;padding:5px;box-sizing:border-box;">' + svg + '</div>'
                + '<div style="min-width:0;flex:1;display:flex;flex-direction:column;justify-content:center;">'
                + '<div style="font-size:11px;font-weight:600;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.3;">' + escHtml(f.name) + '</div>'
                + '<div style="font-size:9.5px;color:rgba(255,255,255,0.5);margin-top:1px;white-space:nowrap;line-height:1;">' + ext + (f.size ? ' · ' + formatSize(f.size) : '') + '</div>'
                + '</div></div>';
            }).join("");
          }
        }

        d.innerHTML = extraHtml + renderMessage(m.text) + '<div class="msg-time">' + m.time + '</div>';
        chatEl.appendChild(d);
      }
    });
    setTimeout(() => { chatEl.scrollTop = chatEl.scrollHeight; }, 50);
  }
  renderHistory();
}

function deleteSession(id){
  sessions = sessions.filter(s => s.id !== id);
  saveSessions();
  if(activeId === id){
    activeId = null;
    chatEl.innerHTML = "";
    if(chatMode === "multimind") buildMultiMindWelcome();
    else buildWelcome();
  }
  renderHistory();
}

function newChat(){
  activeId = null;
  chatEl.innerHTML = "";
  buildWelcome();
  renderHistory();
  closeSidebar();
}

function addMsgToSession(msgObj){
  const sess = sessions.find(s => s.id === activeId);
  if(!sess) return;
  sess.messages.push(msgObj);
  // Set title from first user message
  const firstUser = sess.messages.find(m => m.role === "user" || m.role === "multi-user");
  if(firstUser && sess.title === "New Chat"){
    let title = firstUser.text ? firstUser.text.slice(0, 38) + (firstUser.text.length > 38 ? "…" : "") : "";
    if(!title && firstUser.files && firstUser.files.length){
      // Auto-generate descriptive title (bukan nama file)
      const imgs = firstUser.files.filter(f => f.isImage);
      const docs = firstUser.files.filter(f => !f.isImage);
      if(imgs.length && !docs.length){
        title = imgs.length === 1 ? "Foto" : imgs.length + " Foto";
      } else if(docs.length && !imgs.length){
        title = docs.length === 1 ? docs[0].name.split('.').pop().toUpperCase() + " · " + docs[0].name.replace(/\.[^.]+$/, '') : docs.length + " Dokumen";
        if(title.length > 38) title = title.slice(0, 38) + "…";
      } else if(imgs.length && docs.length){
        title = imgs.length + " Foto + " + docs.length + " File";
      }
    }
    if(title) sess.title = title;
  }
  saveSessions();
  renderHistory();
}

/* ======================== WELCOME ======================== */
function buildWelcome(){
  const wc = document.createElement("div");
  wc.id = "welcomeChat";
  if(chatMode === "multi") wc.classList.add("multi-mode");
  wc.innerHTML = `
    <div class="wc-logo-wrap" id="wcLogoWrap">
      <img id="welcomeLogo" class="wc-img" src="${getCurrentLogo()}" alt="">
    </div>
    <div class="wc-title">AIVA</div>
    <div class="wc-sub">${chatMode === "multi" ? "Bandingkan 2 AI sekaligus" : "Ask me anything"}</div>
    <div class="chips">
      <div class="chip" onclick="suggest('Apa itu AI?')">Apa itu AI?</div>
      <div class="chip" onclick="suggest('Bantu coding Python')">Bantu coding Python</div>
      <div class="chip" onclick="suggest('Tulis email profesional')">Tulis email</div>
      <div class="chip" onclick="suggest('Jelaskan machine learning')">Machine learning</div>
    </div>`;
  chatEl.appendChild(wc);
  updateWcLogo();
}

/* ======================== SIDEBAR ======================== */
function toggleSidebar(){ sidebar.classList.toggle("active"); overlay.classList.toggle("show"); }
function closeSidebar(){ sidebar.classList.remove("active"); overlay.classList.remove("show"); }
let swX = 0;
sidebar.addEventListener("touchstart", e => { swX = e.touches[0].clientX; sidebar.style.transition = "none"; });
sidebar.addEventListener("touchmove", e => {
  if(!sidebar.classList.contains("active")) return;
  const dx = e.touches[0].clientX - swX;
  if(dx < 0) sidebar.style.left = dx + "px";
});
sidebar.addEventListener("touchend", () => {
  sidebar.style.transition = "";
  if(parseInt(sidebar.style.left||0) < -80) closeSidebar();
  sidebar.style.left = "";
});

/* ======================== PANEL ======================== */
function togglePanel(){ panel.style.display = panel.style.display === "block" ? "none" : "block"; }
document.addEventListener("click", e => {
  if(!panel.contains(e.target) && !e.target.closest(".settings-btn")) panel.style.display = "none";
});

/* ======================== THEME ======================== */
function setTheme(t){
  if(t === "light") document.body.classList.add("light");
  else document.body.classList.remove("light");
  updateWcLogo();
  panel.style.display = "none";
  localStorage.setItem("theme", t);
}

/* ======================== API ======================== */
function setAPI(api){
  currentAPI = api;
  localStorage.setItem("api", api);
  panel.style.display = "none";
}

/* ====== MODEL SWITCHER DROPDOWN (hamburger area) ====== */
function updateModelSwitcherVisibility(){
  const btn = document.getElementById("modelSwitcherBtn");
  if(!btn) return;
  const show = chatMode === "single" && !wormMode;
  btn.style.display = show ? "flex" : "none";
  if(!show) closeModelDropdown();
}

const GPT_SVG = `<svg viewBox="0 0 24 24" style="width:15px;height:15px" fill="currentColor"><path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08-4.778 2.758a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z" fill="#10a37f"/></svg>`;

const MODEL_PILL = {
  groq: { label:"Qwen",  icon:"https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/qwen.svg" },
  qwen: { label:"Aiva",  icon:"https://i.ibb.co.com/dw9zhBFG/Picsart-26-05-03-07-15-14-213.png" },
  glm:  { label:"GLM",   icon:"https://logo.svgcdn.com/token-branded/glm.png" },
  gpt:  { label:"Gpt",   icon:null }
};

function updateModelDropdownActive(){
  document.querySelectorAll(".mdrop-item").forEach(el => {
    el.classList.toggle("active-model", el.dataset.api === currentAPI);
  });
  const pill = MODEL_PILL[currentAPI] || MODEL_PILL.groq;
  const wrap = document.getElementById("msb-icon-wrap");
  const labelEl = document.getElementById("msb-label");
  if(wrap){
    if(currentAPI === "gpt"){
      wrap.innerHTML = GPT_SVG;
    } else if(pill.icon){
      wrap.innerHTML = `<img src="${pill.icon}" style="width:15px;height:15px;border-radius:4px;object-fit:cover" onerror="this.style.opacity=0">`;
    } else {
      wrap.innerHTML = "";
    }
  }
  if(labelEl) labelEl.textContent = pill.label;
}

function toggleModelDropdown(e){
  e.stopPropagation();
  const btn = document.getElementById("modelSwitcherBtn");
  const drop = document.getElementById("modelDropdown");
  const isOpen = drop.classList.contains("show");
  if(isOpen){
    closeModelDropdown();
  } else {
    drop.classList.add("show");
    btn.classList.add("open");
    updateModelDropdownActive();
  }
}

function closeModelDropdown(){
  const drop = document.getElementById("modelDropdown");
  const btn = document.getElementById("modelSwitcherBtn");
  if(drop) drop.classList.remove("show");
  if(btn) btn.classList.remove("open");
}

function setAPIFromDropdown(api){
  setAPI(api);
  currentAPI = api;
  updateModelDropdownActive();
  closeModelDropdown();
}

document.addEventListener("click", function(e){
  const area = document.getElementById("menuArea");
  if(area && !area.contains(e.target)) closeModelDropdown();
});

/* ======================== MULTI MODEL SELECT ======================== */
function toggleMultiModel(api){
  const isActive = activeMultiModels.includes(api);
  if(isActive && activeMultiModels.length <= 2){
    // Can't go below 2 — flash the tag
    const tag = document.querySelector(`.cib-tag[data-model="${api}"]`);
    if(tag){ tag.style.animation="none"; tag.style.outline="2px solid rgba(240,68,68,0.6)"; setTimeout(()=>{ tag.style.outline=""; },600); }
    return;
  }
  if(isActive){
    activeMultiModels = activeMultiModels.filter(m => m !== api);
  } else {
    activeMultiModels.push(api);
  }
  updateMultiModelUI();
}

function updateMultiModelUI(){
  const allModels = ["groq","qwen","glm","gpt"];
  allModels.forEach(api => {
    const tag = document.querySelector(`.cib-tag[data-model="${api}"]`);
    const chip = document.getElementById("chip-" + api);
    const isActive = activeMultiModels.includes(api);
    if(tag){
      tag.classList.toggle("active-tag", isActive);
      tag.classList.toggle("inactive", !isActive);
    }
    if(chip) chip.style.opacity = isActive ? "1" : "0.25";
  });
  // Update dividers visibility
  const dividers = ["cdiv1","cdiv2","cdiv3"];
  dividers.forEach(d => {
    const el = document.getElementById(d);
    if(el) el.style.display = "";
  });
  // Update placeholder
  const ta = document.getElementById("canvasText");
  if(ta) ta.placeholder = `Tanya ke ${activeMultiModels.length} model sekaligus...`;
}

/* ======================== ABOUT / SUPPORT ======================== */
function openAbout(){ const p=document.getElementById("aboutPage"); p.style.display="block"; p.classList.remove("out"); p.classList.add("show"); }
function closeAbout(){ const p=document.getElementById("aboutPage"); p.classList.add("out"); setTimeout(()=>{ p.style.display="none"; p.classList.remove("show","out"); },260); }
function openSupport(){ const p=document.getElementById("supportPage"); p.style.display="block"; p.classList.remove("out"); p.classList.add("show"); }
function closeSupport(){ const p=document.getElementById("supportPage"); p.classList.add("out"); setTimeout(()=>{ p.style.display="none"; p.classList.remove("show","out"); },260); }

/* ======================== FILE UPLOAD — ENHANCED ======================== */
// Attached files store: [{name, size, type, content, dataUrl (images)}]
let attachedFiles = [];
// Upload history (persisted in localStorage)
let uploadHistory = JSON.parse(localStorage.getItem("aiva_upload_history") || "[]");

function getFileIconSVG(name, type) {
  const ext = (name.split(".").pop() || "").toLowerCase();
  const isImg = type.startsWith("image/");

  const icons = {
    img:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`,
    pdf:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="15" y2="17"/></svg>`,
    zip:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>`,
    code: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`,
    json: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="10" y2="13"/><line x1="14" y1="13" x2="16" y2="13"/></svg>`,
    csv:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/></svg>`,
    doc:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="15" y2="17"/><line x1="12" y1="9" x2="15" y2="9"/></svg>`,
    txt:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`,
    file: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>`,
  };

  if (isImg) return icons.img;
  if (ext === "pdf") return icons.pdf;
  if (["zip","tar","gz","bz2","xz","7z","rar"].includes(ext)) return icons.zip;
  if (["js","ts","py","html","css","sh","bat","java","cpp","c","php","rb","go","rs","dart","swift"].includes(ext)) return icons.code;
  if (["json","jsonl","xml","yaml","yml"].includes(ext)) return icons.json;
  if (["csv","xlsx","xls","ods"].includes(ext)) return icons.csv;
  if (["docx","doc","odt","rtf","pptx","ppt"].includes(ext)) return icons.doc;
  if (["txt","md","log","env"].includes(ext)) return icons.txt;
  return icons.file;
}

// Keep legacy text version for any remaining callers
function getFileIcon(name, type) { return ""; }

function getFileIconBg(name, type) {
  if (type.startsWith("image/")) return "rgba(61,114,246,0.15)";
  const ext = name.split(".").pop().toLowerCase();
  if (ext === "pdf") return "rgba(240,68,68,0.15)";
  if (["zip","tar","gz"].includes(ext)) return "rgba(255,160,0,0.15)";
  if (["js","ts","py","html","css"].includes(ext)) return "rgba(16,185,129,0.15)";
  if (["json","xml","yaml"].includes(ext)) return "rgba(114,72,245,0.15)";
  if (["csv","xlsx"].includes(ext)) return "rgba(16,163,127,0.15)";
  return "rgba(61,114,246,0.1)";
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024*1024) return (bytes/1024).toFixed(1) + " KB";
  return (bytes/(1024*1024)).toFixed(1) + " MB";
}

function renderUploadPanel() {
  const panel = document.getElementById("uploadPreviewPanel");
  const grid = document.getElementById("uplFilesGrid");
  if (!grid || !panel) return;

  if (attachedFiles.length === 0) {
    panel.classList.remove("visible");
    grid.innerHTML = "";
    return;
  }

  panel.classList.add("visible");
  grid.innerHTML = "";

  attachedFiles.forEach((f, i) => {
    const card = document.createElement("div");

    if (f.isImage && f.dataUrl) {
      card.className = "upl-card is-image";
      card.innerHTML = `
        <img src="${f.dataUrl}" alt="${f.name}">
        <div class="upl-card-overlay">
          <div class="upl-card-name">${f.name}</div>
        </div>
        <div class="upl-card-remove" onclick="removeFile(${i})" title="Remove">
          <svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </div>`;
    } else {
      card.className = "upl-card is-file" + (f.processing ? " chip-processing" : "");
      const ext = f.name.split(".").pop().toUpperCase().slice(0,5);
      const iconSVG = getFileIconSVG(f.name, f.type);
      const iconBg = getFileIconBg(f.name, f.type);
      card.innerHTML = `
        <div class="upl-file-icon" style="background:${iconBg}">${iconSVG}</div>
        <div class="upl-file-info">
          <div class="upl-file-name" title="${f.name}">${f.name}</div>
          <div class="upl-file-meta">${ext} · ${formatSize(f.size)}${f.processing ? " · Loading…" : ""}</div>
        </div>
        <div class="upl-card-remove" onclick="removeFile(${i})" title="Remove">
          <svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </div>`;
    }
    grid.appendChild(card);
  });
  updateSend();
}

function removeFile(i) {
  attachedFiles.splice(i, 1);
  renderUploadPanel();
  if (attachedFiles.length === 0) document.getElementById("fileInput").value = "";
}

function clearAllFiles() {
  attachedFiles = [];
  document.getElementById("fileInput").value = "";
  renderUploadPanel();
}

// Legacy compat
function clearFiles() { clearAllFiles(); }
function renderFileChips() { renderUploadPanel(); }

function saveToUploadHistory(fileObj) {
  // File disimpan ke dalam session aktif saja, tidak ada history terpisah
  const sess = sessions.find(s => s.id === activeId);
  if(sess){
    if(!sess.files) sess.files = [];
    if(!sess.files.find(f => f.name === fileObj.name && f.size === fileObj.size)){
      sess.files.push({ name: fileObj.name, size: fileObj.size, type: fileObj.type, isImage: fileObj.isImage });
    }
    saveSessions();
  }
}

function renderUploadHistory() { /* tidak digunakan, upload sudah masuk session */ }

async function readZipContents(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const buf = e.target.result;
        const arr = new Uint8Array(buf);
        const entries = [];
        for (let i = 0; i < arr.length - 30; i++) {
          if (arr[i]===0x50 && arr[i+1]===0x4B && arr[i+2]===0x03 && arr[i+3]===0x04) {
            const fnLen = arr[i+26] | (arr[i+27]<<8);
            const extraLen = arr[i+28] | (arr[i+29]<<8);
            if (fnLen > 0 && fnLen < 300) {
              let name = "";
              for (let j = 0; j < fnLen; j++) name += String.fromCharCode(arr[i+30+j]);
              if (!name.endsWith("/")) entries.push(name);
              i += 29 + fnLen + extraLen;
            }
          }
        }
        resolve(entries.length > 0 ? entries : ["(Tidak bisa baca isi ZIP)"]);
      } catch(err) { resolve(["(Error membaca ZIP: " + err.message + ")"]); }
    };
    reader.readAsArrayBuffer(file);
  });
}

async function processFile(file) {
  const type = file.type || "";
  const name = file.name || "";
  const ext = name.split(".").pop().toLowerCase();
  const isImage = type.startsWith("image/");

  const fileObj = { name, size: file.size, type, isImage, processing: true, content: "" };
  attachedFiles.push(fileObj);
  renderUploadPanel();

  try {
    if (isImage) {
      const dataUrl = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = e => res(e.target.result);
        r.onerror = () => rej(new Error("Gagal baca gambar"));
        r.readAsDataURL(file);
      });
      fileObj.dataUrl = dataUrl;
      fileObj.content = `[GAMBAR: ${name} (${formatSize(file.size)})] — gambar telah dilampirkan. Format: ${type.split("/")[1].toUpperCase()}.`;
      fileObj.isImage = true;
    } else if (["zip","tar","gz","bz2"].includes(ext)) {
      let entries;
      if (ext === "zip") {
        entries = await readZipContents(file);
      } else {
        entries = [`(File arsip ${ext.toUpperCase()} — listing membutuhkan server-side)`];
      }
      const preview = entries.slice(0, 80).join("\n");
      const more = entries.length > 80 ? `\n... dan ${entries.length - 80} file lagi` : "";
      fileObj.content = `[ARSIP ZIP: ${name} (${formatSize(file.size)})]\nIsi (${entries.length} file):\n${preview}${more}`;
    } else if (file.size > 500 * 1024) {
      const chunk = await new Promise((res) => {
        const r = new FileReader();
        r.onload = e => res(e.target.result);
        r.readAsText(file.slice(0, 50*1024));
      });
      fileObj.content = `[FILE: ${name} (${formatSize(file.size)}) — hanya 50KB pertama]\n\n${chunk}\n\n[... dipotong ...]`;
    } else {
      const text = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = e => res(e.target.result);
        r.onerror = () => rej(new Error("Gagal baca file"));
        r.readAsText(file);
      });
      const nullCount = (text.match(/\0/g) || []).length;
      if (nullCount > 50) {
        fileObj.content = `[FILE BINARY: ${name} (${formatSize(file.size)}) — tidak bisa dibaca sebagai teks. Format: ${ext.toUpperCase()}]`;
      } else {
        fileObj.content = `[FILE: ${name} (${formatSize(file.size)})]\n\`\`\`\n${text}\n\`\`\``;
      }
    }
  } catch(err) {
    fileObj.content = `[FILE: ${name} — error: ${err.message}]`;
  }

  fileObj.processing = false;
  saveToUploadHistory(fileObj); // Save to history
  renderUploadPanel();
}

async function handleFileSelect(files) {
  if (!files || files.length === 0) return;
  const MAX_FILES = 5;
  const toAdd = Math.min(files.length, MAX_FILES - attachedFiles.length);
  if (toAdd <= 0) { alert("Maksimal 5 file sekaligus."); return; }
  const promises = [];
  for (let i = 0; i < toAdd; i++) promises.push(processFile(files[i]));
  await Promise.all(promises);
  updateSend();
}

// Drag & drop on input area
document.addEventListener("DOMContentLoaded", () => {
  const box = document.getElementById("inputBox");
  if (!box) return;
  box.addEventListener("dragover", e => { e.preventDefault(); box.classList.add("drag-over"); });
  box.addEventListener("dragleave", e => { if(!box.contains(e.relatedTarget)) box.classList.remove("drag-over"); });
  box.addEventListener("drop", e => {
    e.preventDefault(); box.classList.remove("drag-over");
    if (e.dataTransfer.files.length) handleFileSelect(e.dataTransfer.files);
  });
  renderHistory();
  initSbProfile();
});

function buildFileContext() {
  if (attachedFiles.length === 0) return "";
  const parts = attachedFiles.map(f => f.content || `[FILE: ${f.name}]`);
  return "\n\n---\n**File yang dilampirkan:**\n" + parts.join("\n\n---\n") + "\n---";
}

/* ======================== INPUT ======================== */
function updateSend(){ sendBtn.disabled = inputEl.value.trim() === "" || isGenerating; }
inputEl.addEventListener("input", () => {
  inputEl.style.height = "auto";
  inputEl.style.height = Math.min(inputEl.scrollHeight, 130) + "px";
  updateSend();
});
inputEl.addEventListener("keydown", e => {
  if(e.key === "Enter" && !e.shiftKey){ e.preventDefault(); send(); }
});
function suggest(t){ inputEl.value = t; inputEl.style.height = "auto"; updateSend(); send(); }

/* ======================== SCROLL ======================== */
chatEl.addEventListener("scroll", () => {
  autoScrollEnabled = chatEl.scrollHeight - chatEl.scrollTop - chatEl.clientHeight < 80;
});
function autoScroll(){ if(autoScrollEnabled) chatEl.scrollTop = chatEl.scrollHeight; }

/* ======================== REMOVE WELCOME ======================== */
function removeWelcome(){
  const wc = document.getElementById("welcomeChat");
  if(!wc || wc._gone) return;
  wc._gone = true;
  wc.classList.add("out");
  setTimeout(() => wc.remove(), 420);
}

/* ======================== UTILS ======================== */
function escHtml(t){ return String(t).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
function getTime(){ return new Date().toLocaleTimeString("id-ID",{hour:"2-digit",minute:"2-digit"}); }

/* ======================== LANGUAGE ICON MAP ======================== */
const LANG_ICONS = {
  html:    { bg:"icon-bg-html", svg:`<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" style="width:13px;height:13px"><path fill="#fff" d="M5.902 27.201L3.655 2h24.69l-2.25 25.197L15.985 30 5.902 27.201z"/><path fill="#ebebeb" d="M16 27.858l8.17-2.265 1.922-21.532H16v23.797z"/><path fill="#e44d26" d="M5.902 27.201L3.655 2h24.69l-2.25 25.197L15.985 30 5.902 27.201z" opacity=".5"/><path fill="none" d="M16 4.204h8.033l-1.666 18.682L16 24.934V4.204z"/><path fill="#fff" d="M16 13.544h-3.978l-.277-3.101H16V7.164H8.699l.073.813.745 8.366H16v-2.8zm0 6.46l-.013.004-3.34-.902-.214-2.393H9.156l.42 4.701 6.411 1.78.013-.004v-3.186z"/><path fill="#ebebeb" d="M16 13.544v2.799h3.701l-.348 3.89-3.353.905v3.186l6.415-1.779.047-.527.736-8.244.076-.85H16zm0-6.38v3.279h7.129l.059-.664.135-1.503.074-.813H16z"/></svg>` },
  css:     { bg:"icon-bg-css", svg:`<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" style="width:13px;height:13px"><path fill="#fff" d="M5.902 27.201L3.655 2h24.69l-2.25 25.197L15.985 30 5.902 27.201z"/><path fill="#ebebeb" d="M16 27.858l8.17-2.265 1.922-21.532H16v23.797z"/><path fill="#264de4" d="M5.902 27.201L3.655 2h24.69l-2.25 25.197L15.985 30 5.902 27.201z" opacity=".5"/><path fill="#fff" d="M16 13.123h3.932l-.259 3.045H16v2.8h3.464l-.35 3.863-3.114.842v2.916l.013-.004 5.733-1.589 1.383-15.527H16v3.654z"/><path fill="#ebebeb" d="M16 13.123v-3.654H8.7l1.363 15.346 5.937 1.65v-2.916l-3.109-.84-.35-3.876H16v-2.8h-3.537l-.195-2.91H16z"/></svg>` },
  javascript: { bg:"icon-bg-js", svg:`<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" style="width:13px;height:13px"><path fill="#f0db4f" d="M0 0h32v32H0V0z"/><path d="M21.852 23.294c.534.87 1.228 1.508 2.456 1.508 1.032 0 1.69-.516 1.69-1.228 0-.852-.676-1.154-1.812-1.65l-.622-.268c-1.796-.766-2.99-1.724-2.99-3.748 0-1.866 1.42-3.288 3.638-3.288 1.578 0 2.714.548 3.53 1.984l-1.934 1.242c-.426-.762-.886-1.062-1.596-1.062-.728 0-1.19.462-1.19 1.062 0 .744.462 1.044 1.53 1.506l.622.266c2.116.908 3.312 1.836 3.312 3.916 0 2.244-1.762 3.466-4.126 3.466-2.312 0-3.804-1.1-4.534-2.542l2.026-1.164zm-10.37.224c.39.692.744 1.278 1.596 1.278.816 0 1.332-.32 1.332-1.562v-8.438h2.402v8.472c0 2.574-1.508 3.742-3.712 3.742-1.988 0-3.142-1.03-3.728-2.268l2.11-1.224z" fill="#323330"/></svg>` },
  js:      { bg:"icon-bg-js", svg:`<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" style="width:13px;height:13px"><path fill="#f0db4f" d="M0 0h32v32H0V0z"/><path d="M21.852 23.294c.534.87 1.228 1.508 2.456 1.508 1.032 0 1.69-.516 1.69-1.228 0-.852-.676-1.154-1.812-1.65l-.622-.268c-1.796-.766-2.99-1.724-2.99-3.748 0-1.866 1.42-3.288 3.638-3.288 1.578 0 2.714.548 3.53 1.984l-1.934 1.242c-.426-.762-.886-1.062-1.596-1.062-.728 0-1.19.462-1.19 1.062 0 .744.462 1.044 1.53 1.506l.622.266c2.116.908 3.312 1.836 3.312 3.916 0 2.244-1.762 3.466-4.126 3.466-2.312 0-3.804-1.1-4.534-2.542l2.026-1.164zm-10.37.224c.39.692.744 1.278 1.596 1.278.816 0 1.332-.32 1.332-1.562v-8.438h2.402v8.472c0 2.574-1.508 3.742-3.712 3.742-1.988 0-3.142-1.03-3.728-2.268l2.11-1.224z" fill="#323330"/></svg>` },
  typescript: { bg:"icon-bg-ts", svg:`<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" style="width:13px;height:13px"><path fill="#3178c6" d="M0 0h32v32H0z"/><path d="M17.284 17.297V19a5.6 5.6 0 0 0 1.06.545 6.3 6.3 0 0 0 2.085.33 6.5 6.5 0 0 0 1.97-.28 4.4 4.4 0 0 0 1.51-.79 3.3 3.3 0 0 0 .95-1.23 4 4 0 0 0 .33-1.65 3.7 3.7 0 0 0-.21-1.28 3.2 3.2 0 0 0-.63-1.01 4.6 4.6 0 0 0-1.04-.81 11 11 0 0 0-1.42-.67 12 12 0 0 1-.97-.43 3.4 3.4 0 0 1-.64-.41 1.5 1.5 0 0 1-.35-.44 1.1 1.1 0 0 1-.11-.51 1 1 0 0 1 .14-.52 1.2 1.2 0 0 1 .38-.4 1.8 1.8 0 0 1 .58-.25 3.3 3.3 0 0 1 .75-.08 4.5 4.5 0 0 1 .79.07 4.8 4.8 0 0 1 .81.22 4.7 4.7 0 0 1 .76.38 3.8 3.8 0 0 1 .63.53v-1.83a6 6 0 0 0-.97-.33 7 7 0 0 0-1.73-.19 6.4 6.4 0 0 0-1.94.28 4.5 4.5 0 0 0-1.51.8 3.6 3.6 0 0 0-.98 1.25 3.8 3.8 0 0 0-.35 1.67 3.6 3.6 0 0 0 .77 2.34 5.7 5.7 0 0 0 2.37 1.53 13 13 0 0 1 1.05.47 4 4 0 0 1 .7.44 1.5 1.5 0 0 1 .39.48 1.2 1.2 0 0 1 .12.55 1.1 1.1 0 0 1-.16.57 1.3 1.3 0 0 1-.43.43 2.2 2.2 0 0 1-.67.27 4.1 4.1 0 0 1-.88.09 4.7 4.7 0 0 1-1.69-.31 4.5 4.5 0 0 1-1.43-.92zm-4.95-5.65h3.38V10h-8.9v1.64h3.37V22h2.15V11.63z" fill="#fff"/></svg>` },
  ts:      { bg:"icon-bg-ts", svg:`<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" style="width:13px;height:13px"><path fill="#3178c6" d="M0 0h32v32H0z"/><path d="M17.284 17.297V19a5.6 5.6 0 0 0 1.06.545 6.3 6.3 0 0 0 2.085.33 6.5 6.5 0 0 0 1.97-.28 4.4 4.4 0 0 0 1.51-.79 3.3 3.3 0 0 0 .95-1.23 4 4 0 0 0 .33-1.65 3.7 3.7 0 0 0-.21-1.28 3.2 3.2 0 0 0-.63-1.01 4.6 4.6 0 0 0-1.04-.81 11 11 0 0 0-1.42-.67 12 12 0 0 1-.97-.43 3.4 3.4 0 0 1-.64-.41 1.5 1.5 0 0 1-.35-.44 1.1 1.1 0 0 1-.11-.51 1 1 0 0 1 .14-.52 1.2 1.2 0 0 1 .38-.4 1.8 1.8 0 0 1 .58-.25 3.3 3.3 0 0 1 .75-.08 4.5 4.5 0 0 1 .79.07 4.8 4.8 0 0 1 .81.22 4.7 4.7 0 0 1 .76.38 3.8 3.8 0 0 1 .63.53v-1.83a6 6 0 0 0-.97-.33 7 7 0 0 0-1.73-.19 6.4 6.4 0 0 0-1.94.28 4.5 4.5 0 0 0-1.51.8 3.6 3.6 0 0 0-.98 1.25 3.8 3.8 0 0 0-.35 1.67 3.6 3.6 0 0 0 .77 2.34 5.7 5.7 0 0 0 2.37 1.53 13 13 0 0 1 1.05.47 4 4 0 0 1 .7.44 1.5 1.5 0 0 1 .39.48 1.2 1.2 0 0 1 .12.55 1.1 1.1 0 0 1-.16.57 1.3 1.3 0 0 1-.43.43 2.2 2.2 0 0 1-.67.27 4.1 4.1 0 0 1-.88.09 4.7 4.7 0 0 1-1.69-.31 4.5 4.5 0 0 1-1.43-.92zm-4.95-5.65h3.38V10h-8.9v1.64h3.37V22h2.15V11.63z" fill="#fff"/></svg>` },
  python:  { bg:"icon-bg-py", svg:`<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" style="width:13px;height:13px"><path d="M15.885 2.1c-7.1 0-6.651 3.07-6.651 3.07l.008 3.18h6.77v.95H6.545S2 8.8 2 16c0 7.2 3.988 6.95 3.988 6.95h2.38v-3.3s-.13-3.99 3.93-3.99h6.77s3.8.06 3.8-3.67V5.8s.577-3.7-6.983-3.7zM12.3 4.4a1.237 1.237 0 1 1 0 2.472A1.237 1.237 0 0 1 12.3 4.4z" fill="url(#a)"/><path d="M16.115 29.9c7.1 0 6.651-3.07 6.651-3.07l-.008-3.18h-6.77v-.95h9.467S29.999 23.2 30 16c0-7.2-3.988-6.95-3.988-6.95h-2.38v3.3s.13 3.99-3.93 3.99H13.93s-3.8-.06-3.8 3.67v6.18s-.577 3.7 6.983 3.7zM19.7 27.6a1.237 1.237 0 1 1 0-2.472A1.237 1.237 0 0 1 19.7 27.6z" fill="url(#b)"/><defs><linearGradient id="a" x1="15.885" y1="2.1" x2="15.885" y2="16" gradientUnits="userSpaceOnUse"><stop stop-color="#387EB8"/><stop offset="1" stop-color="#366994"/></linearGradient><linearGradient id="b" x1="16.115" y1="16" x2="16.115" y2="29.9" gradientUnits="userSpaceOnUse"><stop stop-color="#FFE052"/><stop offset="1" stop-color="#FFC331"/></linearGradient></defs></svg>` },
  py:      { bg:"icon-bg-py", svg:`<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" style="width:13px;height:13px"><path d="M15.885 2.1c-7.1 0-6.651 3.07-6.651 3.07l.008 3.18h6.77v.95H6.545S2 8.8 2 16c0 7.2 3.988 6.95 3.988 6.95h2.38v-3.3s-.13-3.99 3.93-3.99h6.77s3.8.06 3.8-3.67V5.8s.577-3.7-6.983-3.7zM12.3 4.4a1.237 1.237 0 1 1 0 2.472A1.237 1.237 0 0 1 12.3 4.4z" fill="url(#a)"/><path d="M16.115 29.9c7.1 0 6.651-3.07 6.651-3.07l-.008-3.18h-6.77v-.95h9.467S29.999 23.2 30 16c0-7.2-3.988-6.95-3.988-6.95h-2.38v3.3s.13 3.99-3.93 3.99H13.93s-3.8-.06-3.8 3.67v6.18s-.577 3.7 6.983 3.7zM19.7 27.6a1.237 1.237 0 1 1 0-2.472A1.237 1.237 0 0 1 19.7 27.6z" fill="url(#b)"/><defs><linearGradient id="a" x1="15.885" y1="2.1" x2="15.885" y2="16" gradientUnits="userSpaceOnUse"><stop stop-color="#387EB8"/><stop offset="1" stop-color="#366994"/></linearGradient><linearGradient id="b" x1="16.115" y1="16" x2="16.115" y2="29.9" gradientUnits="userSpaceOnUse"><stop stop-color="#FFE052"/><stop offset="1" stop-color="#FFC331"/></linearGradient></defs></svg>` },
  "c++":   { bg:"icon-bg-cpp", svg:`<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" style="width:13px;height:13px"><path fill="#004482" d="M16.4 3 1.6 11.4v17L16.4 37l14.8-8.6v-17z"/><path fill="#659AD2" d="M16.4 6.5 4.6 13.3V26.9l11.8 6.8 11.8-6.8V13.3z"/><path fill="#fff" d="M16.4 11.7a8.5 8.5 0 0 0-8.5 8.5c0 4.7 3.8 8.5 8.5 8.5a8.5 8.5 0 0 0 7.4-4.3l-3.7-2.1a4.3 4.3 0 0 1-3.7 2.1 4.3 4.3 0 0 1-4.3-4.3 4.3 4.3 0 0 1 4.3-4.3c1.6 0 3 .9 3.7 2.2l3.7-2.1a8.5 8.5 0 0 0-7.4-4.2zm9.2 7.3h-1.3v-1.3h-1.3V19h-1.3v1.3h1.3v1.4h1.3V20.3h1.3V19zm4.6 0h-1.3v-1.3h-1.4V19h-1.3v1.3h1.3v1.4h1.4V20.3h1.3V19z"/></svg>` },
  cpp:     { bg:"icon-bg-cpp", svg:`<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" style="width:13px;height:13px"><path fill="#004482" d="M16.4 3 1.6 11.4v17L16.4 37l14.8-8.6v-17z"/><path fill="#659AD2" d="M16.4 6.5 4.6 13.3V26.9l11.8 6.8 11.8-6.8V13.3z"/><path fill="#fff" d="M16.4 11.7a8.5 8.5 0 0 0-8.5 8.5c0 4.7 3.8 8.5 8.5 8.5a8.5 8.5 0 0 0 7.4-4.3l-3.7-2.1a4.3 4.3 0 0 1-3.7 2.1 4.3 4.3 0 0 1-4.3-4.3 4.3 4.3 0 0 1 4.3-4.3c1.6 0 3 .9 3.7 2.2l3.7-2.1a8.5 8.5 0 0 0-7.4-4.2zm9.2 7.3h-1.3v-1.3h-1.3V19h-1.3v1.3h1.3v1.4h1.3V20.3h1.3V19zm4.6 0h-1.3v-1.3h-1.4V19h-1.3v1.3h1.3v1.4h1.4V20.3h1.3V19z"/></svg>` },
  "c#":    { bg:"icon-bg-cs", svg:`<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" style="width:13px;height:13px"><path fill="#9B4F96" d="M16 2L2 10v12l14 8 14-8V10z"/><path fill="#fff" d="M16 7a9 9 0 1 0 7.8 4.5l-2.2 1.3A6.5 6.5 0 1 1 16 9.5V7zm7.5 9h-1v-1h-1.5v1h-1v1.5h1v1h1.5v-1h1V16zm4 0h-1v-1h-1.5v1h-1v1.5h1v1h1.5v-1h1V16z"/></svg>` },
  csharp:  { bg:"icon-bg-cs", svg:`<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" style="width:13px;height:13px"><path fill="#9B4F96" d="M16 2L2 10v12l14 8 14-8V10z"/><path fill="#fff" d="M16 7a9 9 0 1 0 7.8 4.5l-2.2 1.3A6.5 6.5 0 1 1 16 9.5V7zm7.5 9h-1v-1h-1.5v1h-1v1.5h1v1h1.5v-1h1V16zm4 0h-1v-1h-1.5v1h-1v1.5h1v1h1.5v-1h1V16z"/></svg>` },
  java:    { bg:"icon-bg-java", svg:`<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" style="width:13px;height:13px"><path fill="#f89820" d="M12.1 21.3s-1 .6.7.8c2 .2 3 .2 5.3-.2 0 0 .6.4 1.4.7-4.9 2.1-11.1-.1-7.4-1.3zm-.6-2.8s-1.2.9.6 1c2.2.1 4 .2 7-.3 0 0 .4.4 1 .6-6.2 1.8-13.1.2-8.6-1.3z"/><path fill="#ea2d2e" d="M17.5 13.4c1.3 1.5-.3 2.8-.3 2.8s3.1-1.6 1.7-3.6c-1.3-1.9-2.3-2.8 3.1-6.1 0 .1-8.4 2.1-4.5 6.9z"/><path fill="#f89820" d="M23.7 23.9s.7.6-.8.9c-3 .9-12.3 1.2-14.9 0-.9-.4.8-1 1.4-1.1.5-.1.8-.1.8-.1-.9-.7-6.2 1.3-2.7 1.9 9.7 1.5 17.7-.7 16.2-1.6zM12.8 15.2s-4.4 1-1.6 1.4c1.2.2 3.5.1 5.7-.1 1.8-.2 3.5-.5 3.5-.5s-.6.3-1 .5c-4.2 1.1-12.4.6-10-.5 2-1 3.4-.8 3.4-.8zm7.7 4.3c4.3-2.2 2.3-4.4 1-4.1-.3.1-.5.2-.5.2s.1-.2.4-.3c2.8-1 5 2.9-1 4.4 0 0 .1-.1.1-.2z"/><path fill="#ea2d2e" d="M19 3S21.4 5.3 16.5 8.8c-3.9 3-1 4.7 0 6.7-2.2-2-3.8-3.7-2.7-5.3C15.4 8 20 6.9 19 3z"/><path fill="#f89820" d="M13.4 28.5c4.1.3 10.5-.2 10.6-2.2 0 0-.3.7-3.4 1.3-3.5.7-7.9.6-10.5.2 0 0 .5.4 3.3.7z"/></svg>` },
  php:     { bg:"icon-bg-php", svg:`<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" style="width:13px;height:13px"><ellipse cx="16" cy="16" rx="14" ry="7" fill="#8892be"/><path fill="#fff" d="M7.7 13h1.6l-.3 1.6h1.3c.8 0 1.3.2 1.6.5.3.3.4.8.2 1.5l-.5 2.5H10l.5-2.3c.1-.4 0-.7-.1-.8-.2-.1-.4-.2-.8-.2H8.5L7.7 20H6.4l1.3-7zm5.8 0h3.3c1.5 0 2.3.9 1.9 2.6-.3 1.7-1.5 2.6-3 2.6h-1.6L13.7 20h-1.4l1.2-7zm1.2 1.2-.6 2.8h1.4c.8 0 1.4-.5 1.6-1.4.2-.9-.2-1.4-1-1.4h-1.4zm4.6-1.2h1.6l-.3 1.6h1.3c.8 0 1.3.2 1.6.5.3.3.4.8.2 1.5l-.5 2.5h-1.5l.5-2.3c.1-.4 0-.7-.1-.8-.2-.1-.4-.2-.8-.2h-1.1L21 20h-1.4l1.3-7z"/></svg>` },
  ruby:    { bg:"icon-bg-rb", svg:`<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" style="width:13px;height:13px"><path fill="#cc342d" d="M27 5.5L6 9.5l-3.5 16.5L24 28.5 29 11.5z"/><path fill="#fff" d="M20.5 9.5L14 11l1 5 5-1zm-2 9l-5 2 2 5.5 6-3.5z"/><path fill="#fff" opacity=".5" d="M14 11l-5 7 5 1z"/></svg>` },
  rb:      { bg:"icon-bg-rb", svg:`<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" style="width:13px;height:13px"><path fill="#cc342d" d="M27 5.5L6 9.5l-3.5 16.5L24 28.5 29 11.5z"/><path fill="#fff" d="M20.5 9.5L14 11l1 5 5-1zm-2 9l-5 2 2 5.5 6-3.5z"/><path fill="#fff" opacity=".5" d="M14 11l-5 7 5 1z"/></svg>` },
  rust:    { bg:"icon-bg-rs", svg:`<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" style="width:13px;height:13px"><circle cx="16" cy="16" r="13" fill="#b94700"/><path fill="#fff" d="M8 14.5h2.5V11H22v2.5h-3V19h2v2.5H11V19h2v-3h-2.5l-1 2.5H8v-4z"/></svg>` },
  rs:      { bg:"icon-bg-rs", svg:`<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" style="width:13px;height:13px"><circle cx="16" cy="16" r="13" fill="#b94700"/><path fill="#fff" d="M8 14.5h2.5V11H22v2.5h-3V19h2v2.5H11V19h2v-3h-2.5l-1 2.5H8v-4z"/></svg>` },
  go:      { bg:"icon-bg-go", svg:`<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" style="width:13px;height:13px"><path fill="#00acd7" d="M3 13.5h26v5H3z"/><circle cx="7" cy="16" r="3" fill="#fff"/><circle cx="25" cy="16" r="3" fill="#fff"/><circle cx="7" cy="15" r="1.5" fill="#222"/><circle cx="25" cy="15" r="1.5" fill="#222"/><path fill="#fff" d="M22 13v6h3.5a3 3 0 0 0 0-6z"/></svg>` },
  kotlin:  { bg:"icon-bg-kt", svg:`<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" style="width:13px;height:13px"><path fill="url(#kg)" d="M3 3h13l-13 13V3zm0 13L16 3h13L3 29V16zm13 0l13-13v13l-13 13V16z"/><defs><linearGradient id="kg" x1="3" y1="3" x2="29" y2="29" gradientUnits="userSpaceOnUse"><stop stop-color="#e44857"/><stop offset=".5" stop-color="#c711e1"/><stop offset="1" stop-color="#7f52ff"/></linearGradient></defs></svg>` },
  kt:      { bg:"icon-bg-kt", svg:`<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" style="width:13px;height:13px"><path fill="url(#kg2)" d="M3 3h13l-13 13V3zm0 13L16 3h13L3 29V16zm13 0l13-13v13l-13 13V16z"/><defs><linearGradient id="kg2" x1="3" y1="3" x2="29" y2="29" gradientUnits="userSpaceOnUse"><stop stop-color="#e44857"/><stop offset=".5" stop-color="#c711e1"/><stop offset="1" stop-color="#7f52ff"/></linearGradient></defs></svg>` },
  bash:    { bg:"icon-bg-sh", svg:`<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" style="width:13px;height:13px"><path fill="#2e3436" d="M2 4h28v24H2z"/><path fill="#4e9a06" d="M5 8h2l6 6-6 6H5l6-6z"/><path fill="#fff" d="M14 20h12v2H14z"/></svg>` },
  sh:      { bg:"icon-bg-sh", svg:`<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" style="width:13px;height:13px"><path fill="#2e3436" d="M2 4h28v24H2z"/><path fill="#4e9a06" d="M5 8h2l6 6-6 6H5l6-6z"/><path fill="#fff" d="M14 20h12v2H14z"/></svg>` },
  sql:     { bg:"icon-bg-sql", svg:`<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" style="width:13px;height:13px"><ellipse cx="16" cy="9" rx="11" ry="4" fill="#336791"/><path fill="#336791" d="M5 9v5c0 2.2 4.9 4 11 4s11-1.8 11-4V9c0 2.2-4.9 4-11 4S5 11.2 5 9z"/><path fill="#336791" d="M5 14v5c0 2.2 4.9 4 11 4s11-1.8 11-4v-5c0 2.2-4.9 4-11 4S5 16.2 5 14z"/><ellipse cx="16" cy="9" rx="11" ry="4" fill="none" stroke="#fff" stroke-width=".5" opacity=".4"/></svg>` },
  json:    { bg:"icon-bg-json", svg:`<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" style="width:13px;height:13px"><path fill="#292929" d="M3 5h26v22H3z"/><path fill="#f0db4f" d="M8 11c-1.7 0-3 1.3-3 3v4c0 1.7 1.3 3 3 3h3v-2H8c-.6 0-1-.4-1-1v-4c0-.6.4-1 1-1h3v-2H8zm9 0v2h3c.6 0 1 .4 1 1v4c0 .6-.4 1-1 1h-3v2h3c1.7 0 3-1.3 3-3v-4c0-1.7-1.3-3-3-3h-3z"/></svg>` },
  markdown:{ bg:"icon-bg-md", svg:`<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" style="width:13px;height:13px"><rect x="2" y="6" width="28" height="20" rx="2" fill="#083fa1"/><path fill="#fff" d="M5 22V10h3l3 4 3-4h3v12h-3v-7.5l-3 4-3-4V22H5zm19-6l-4 4V10h3v6.5l3-4-2 5.5z"/></svg>` },
  md:      { bg:"icon-bg-md", svg:`<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" style="width:13px;height:13px"><rect x="2" y="6" width="28" height="20" rx="2" fill="#083fa1"/><path fill="#fff" d="M5 22V10h3l3 4 3-4h3v12h-3v-7.5l-3 4-3-4V22H5zm19-6l-4 4V10h3v6.5l3-4-2 5.5z"/></svg>` },
  dart:    { bg:"icon-bg-dart", svg:`<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" style="width:13px;height:13px"><path fill="#0175c2" d="M7 7l4-4 13.5.5.5 13.5-4 4L7 7z"/><path fill="#13b9fd" d="M7 25l-4-4V7.5L21 7l4 4L7 25z"/><path fill="#01579b" d="M21 7l4 4v13.5L11 25l-4-4L21 7z"/><path fill="#0175c2" d="M25 21v-4H11v4z"/></svg>` },
  swift:   { bg:"icon-bg-swift", svg:`<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" style="width:13px;height:13px"><path fill="#f05138" d="M22 4c3.3 0 6 2.7 6 6v12c0 3.3-2.7 6-6 6H10c-3.3 0-6-2.7-6-6V10c0-3.3 2.7-6 6-6h12z"/><path fill="#fff" d="M22.5 17.5c.3-2.8-1.6-5.7-4.5-7.2 1.6 2.3 2.2 5 1.2 7.2-.3.8-1 1.6-1.7 2l-.1.1C15 21.2 11 21 8 19c3.3 3.5 8.3 4.5 11.9 2.5.5-.3 1-.7 1.4-1.1.8-.4 1.1-1.6 1.2-2.9z"/></svg>` },
  c:       { bg:"icon-bg-cpp", svg:`<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" style="width:13px;height:13px"><path fill="#004482" d="M16 3L2 11v10l14 8 14-8V11z"/><path fill="#fff" d="M16 9a7 7 0 1 0 6.1 3.5l-2.6 1.5A4 4 0 1 1 16 11V9z"/></svg>` },
};

function getLangIcon(lang) {
  const key = lang.toLowerCase().replace(/\s/g,'');
  const info = LANG_ICONS[key];
  if(!info) return `<span class="code-lang-icon" style="display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;background:rgba(255,255,255,0.08);border-radius:5px"><svg viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" stroke-width="2" style="width:13px;height:13px"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg></span>`;
  return `<span class="code-lang-icon ${info.bg}">${info.svg}</span>`;
}

/* ======================== SYNTAX HIGHLIGHTER (VS Code style) ======================== */
function syntaxHighlight(raw, lang){
  const l = (lang||"").toLowerCase();

  // Escape HTML special chars
  function h(s){ return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
  // Wrap span
  function sp(cls,s){ return '<span class="tok-'+cls+'">'+s+'</span>'; }

  /* ==== HTML / XML ==== */
  if(l==="html"||l==="xml"||l==="svg"){
    let out = "";
    // Token types: comment, doctype, tag, text
    const re = /<!--[\s\S]*?-->|<!\w[^>]*>|<\/?[\w:-]+(?:\s+[\w:-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*\s*\/?>|[^<]+/g;
    let m;
    while((m = re.exec(raw)) !== null){
      const tok = m[0];
      if(tok.startsWith("<!--")){
        out += sp("cmt", h(tok));
      } else if(tok.startsWith("<!")){
        out += sp("tag", h(tok));
      } else if(tok.startsWith("<")){
        // parse tag
        const tagRe = /^(<\/?)([:\w-]+)([\s\S]*?)(\s*\/?>)$/;
        const tm = tok.match(tagRe);
        if(!tm){ out += h(tok); continue; }
        const open=tm[1], name=tm[2], attrs=tm[3], close=tm[4];
        // parse attributes
        let attrOut = "";
        const attrRe = /\s+([\w:-]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g;
        let am, alast=0;
        while((am = attrRe.exec(attrs)) !== null){
          attrOut += h(attrs.slice(alast, am.index));
          attrOut += " " + sp("attr", h(am[1]));
          if(am[2]) attrOut += "=" + sp("str", h(am[2]));
          alast = am.index + am[0].length;
        }
        attrOut += h(attrs.slice(alast));
        out += sp("tag", h(open)) + sp("cls", h(name)) + attrOut + sp("tag", h(close));
      } else {
        out += h(tok);
      }
    }
    return out;
  }

  /* ==== CSS / SCSS ==== */
  if(l==="css"||l==="scss"||l==="less"){
    let out="", last=0;
    const re = /\/\*[\s\S]*?\*\/|\/\/[^\n]*|"[^"]*"|'[^']*'|([\w-]+)\s*(?=\s*:(?!:))|(#[0-9a-fA-F]{3,8}(?!\w))|(\b\d+\.?\d*(?:px|em|rem|%|vh|vw|vmin|vmax|s|ms|deg|fr|ch|ex)?\b)/g;
    let m;
    while((m=re.exec(raw))!==null){
      out += h(raw.slice(last, m.index));
      const tok=m[0];
      if(tok.startsWith("/*")||tok.startsWith("//")) out+=sp("cmt",h(tok));
      else if(tok.startsWith('"')||tok.startsWith("'")) out+=sp("str",h(tok));
      else if(m[1]) out+=sp("prop",h(m[1]));
      else if(m[2]) out+=sp("num",h(m[2]));
      else if(m[3]) out+=sp("num",h(m[3]));
      else out+=h(tok);
      last=m.index+tok.length;
    }
    out+=h(raw.slice(last));
    return out;
  }

  /* ==== JSON ==== */
  if(l==="json"){
    let out="", last=0;
    const re = /"(?:[^"\\]|\\.)*"\s*(?=:)|(?<=:\s*)"(?:[^"\\]|\\.)*"|(?<=:\s*)(?:true|false|null)|(?<=:\s*)-?\d+\.?\d*(?:[eE][+-]?\d+)?/g;
    let m;
    while((m=re.exec(raw))!==null){
      out+=h(raw.slice(last,m.index));
      const tok=m[0], full=raw.slice(0,m.index).trimEnd();
      // key if followed by colon
      if(raw.slice(m.index+tok.length).trimStart().startsWith(":")){
        out+=sp("attr",h(tok));
      } else if(tok==="true"||tok==="false"||tok==="null"){
        out+=sp("bool",h(tok));
      } else if(/^-?\d/.test(tok)){
        out+=sp("num",h(tok));
      } else {
        out+=sp("str",h(tok));
      }
      last=m.index+tok.length;
    }
    out+=h(raw.slice(last));
    return out;
  }

  /* ==== JS / TS / Python / Java / C++ / generic ==== */
  const KW = new Set(["abstract","arguments","as","async","await","boolean","break","byte","case","catch","char","class","const","continue","debugger","default","delete","do","double","else","enum","eval","export","extends","false","final","finally","float","for","from","function","get","goto","if","implements","import","in","instanceof","int","interface","is","lambda","let","long","native","new","null","of","package","pass","print","private","protected","public","return","self","set","short","static","super","switch","synchronized","this","throw","throws","transient","true","try","type","typeof","undefined","var","void","volatile","while","with","yield","def","elif","except","and","or","not","None","True","False"]);

  let out="", last=0;
  // Order matters: comments first, then strings, then tokens
  const re = /\/\/[^\n]*|#[^\n]*(?=\n|$)|\/\*[\s\S]*?\*\/|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|(\b\d+\.?\d*(?:[eE][+-]?\d+)?\b)|([A-Za-z_$][\w$]*)/g;
  let m;
  while((m=re.exec(raw))!==null){
    out+=h(raw.slice(last,m.index));
    const tok=m[0];
    if(tok.startsWith("//")||tok.startsWith("/*")||tok.startsWith("#")){
      out+=sp("cmt",h(tok));
    } else if(tok[0]==='"'||tok[0]==="'"||tok[0]==="`"){
      out+=sp("str",h(tok));
    } else if(m[1]!==undefined){
      out+=sp("num",h(tok));
    } else if(m[2]!==undefined){
      const word=m[2];
      if(KW.has(word)){
        out+=sp("kw",h(word));
      } else {
        const after=raw.slice(m.index+word.length).match(/^\s*\(/);
        if(after) out+=sp("fn",h(word));
        else if(/^[A-Z]/.test(word)) out+=sp("cls",h(word));
        else out+=sp("var",h(word));
      }
    } else {
      out+=h(tok);
    }
    last=m.index+tok.length;
  }
  out+=h(raw.slice(last));
  return out;
}

/* ======================== RENDER MESSAGE ======================== */

function mdToHtml(raw){
  if(!raw) return '';
  let s = raw;

  // Escape HTML
  s = s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  // Inline code FIRST (before bold/italic mess it up)
  s = s.replace(/`([^`\n]+)`/g,'<code class="md-ic">$1</code>');

  // Headers — no ## shown
  s = s.replace(/^#{4} (.+)$/gm,'<div class="md-h4">$1</div>');
  s = s.replace(/^#{3} (.+)$/gm,'<div class="md-h3">$1</div>');
  s = s.replace(/^#{2} (.+)$/gm,'<div class="md-h2">$1</div>');
  s = s.replace(/^# (.+)$/gm,   '<div class="md-h1">$1</div>');

  // Bold + Italic
  s = s.replace(/\*\*\*(.+?)\*\*\*/g,'<strong><em>$1</em></strong>');
  s = s.replace(/\*\*(.+?)\*\*/g,      '<strong>$1</strong>');
  s = s.replace(/\*([^\*\n]+)\*/g,      '<em>$1</em>');
  s = s.replace(/__(.+?)__/g,              '<strong>$1</strong>');
  s = s.replace(/_([^_\n]+)_/g,           '<em>$1</em>');

  // Blockquote
  s = s.replace(/^> (.+)$/gm,'<div class="md-blockquote">$1</div>');

  // Horizontal rule
  s = s.replace(/^(-{3,}|_{3,}|\*{3,})$/gm,'<div class="md-hr"></div>');

  // Tables — simple
  s = s.replace(/^(\|.+\|\s*\n)(\|[-| :]+\|\s*\n)((\|.+\|\s*\n?)+)/gm, (match)=>{
    const rows = match.trim().split('\n').filter(r=>r.trim());
    const hdr  = rows[0].split('|').filter((_,i,a)=>i>0&&i<a.length-1).map(c=>`<th>${c.trim()}</th>`).join('');
    const body = rows.slice(2).map(r=>{
      const tds = r.split('|').filter((_,i,a)=>i>0&&i<a.length-1).map(c=>`<td>${c.trim()}</td>`).join('');
      return `<tr>${tds}</tr>`;
    }).join('');
    return `<div class="md-table-wrap"><table class="md-table"><thead><tr>${hdr}</tr></thead><tbody>${body}</tbody></table></div>`;
  });

  // Lists — line by line grouping
  const lines = s.split('\n');
  const out = [];
  let inUL=false, inOL=false;
  for(const ln of lines){
    const ulM = ln.match(/^[\-\*\+] (.+)$/);
    const olM = ln.match(/^\d+\. (.+)$/);
    if(ulM){
      if(inOL){ out.push('</ol>'); inOL=false; }
      if(!inUL){ out.push('<ul class="md-ul">'); inUL=true; }
      out.push(`<li>${ulM[1]}</li>`);
    } else if(olM){
      if(inUL){ out.push('</ul>'); inUL=false; }
      if(!inOL){ out.push('<ol class="md-ol">'); inOL=true; }
      out.push(`<li>${olM[1]}</li>`);
    } else {
      if(inUL){ out.push('</ul>'); inUL=false; }
      if(inOL){ out.push('</ol>'); inOL=false; }
      out.push(ln);
    }
  }
  if(inUL) out.push('</ul>');
  if(inOL) out.push('</ol>');
  s = out.join('');

  // Paragraphs — split on blank lines
  const STRUCT = /^<(div|ul|ol|table)/;
  const blocks = s.split(/\n{2,}/);
  s = blocks.map(b=>{
    b = b.trim(); if(!b) return '';
    if(STRUCT.test(b)) return b;
    b = b.replace(/\n/g,'<br>');
    return `<div class="md-p">${b}</div>`;
  }).join('');

  return s;
}

function renderMessage(text){
  const parts = text.split("```");
  let html = "";
  for(let i=0;i<parts.length;i++){
    if(i%2===0){
      const rendered = mdToHtml(parts[i]);
      if(rendered.trim()) html += `<div class="md-body">${rendered}</div>`;
    } else {
      let raw = parts[i], lang = "";
      const nl = raw.indexOf("\n");
      if(nl > 0 && nl < 20){ lang = raw.slice(0,nl).trim(); raw = raw.slice(nl+1); }
      const code = syntaxHighlight(raw, lang);
      const cid = "c"+Math.random().toString(36).substr(2,8);
      const pid = "p"+Math.random().toString(36).substr(2,8);
      const isHtml = lang.toLowerCase() === "html";
      const iconHtml = getLangIcon(lang) || "";
      const displayLang = lang || "code";
      const tabBtns = isHtml ? `
        <button class="code-tab-btn active" id="tab-code-${cid}" onclick="switchCodeTab('${cid}','${pid}','code')">Code</button>
        <button class="code-tab-btn" id="tab-prev-${cid}" onclick="switchCodeTab('${cid}','${pid}','preview')">Preview</button>
      ` : "";
      setTimeout(()=>{
        const btn = document.getElementById(cid);
        if(btn) btn.onclick = ()=>{ navigator.clipboard.writeText(raw); btn.textContent="Copied!"; setTimeout(()=>btn.textContent="Copy",1500); };
        if(isHtml){
          const iframe = document.getElementById(pid);
          if(iframe){
            iframe.setAttribute("data-src-raw", raw);
            const doc = iframe.contentDocument || iframe.contentWindow.document;
            doc.open(); doc.write(raw); doc.close();
          }
        }
      },80);
      html += `<div class="code-box"><div class="code-lang-bar">${iconHtml}<span class="code-lang-name">${displayLang}</span></div>
        <div class="code-hdr">
          <div class="code-hdr-actions">${tabBtns}<button class="copy-btn" id="${cid}">Copy</button></div>
        </div>
        <div class="code-pre-wrap" id="pre-${cid}"><pre>${code}</pre></div><div class="code-footer"></div>
        ${isHtml ? `<iframe id="${pid}" style="display:none" sandbox="allow-scripts allow-same-origin"></iframe>` : ""}
      </div>`;
    }
  }
  return html;
}

function switchCodeTab(cid, pid, tab){
  const preWrap = document.getElementById("pre-"+cid);
  const btnCode = document.getElementById("tab-code-"+cid);
  const btnPrev = document.getElementById("tab-prev-"+cid);
  if(tab === "preview"){
    // Open fullscreen overlay
    openPreviewOverlay(pid);
    // Keep code tab active visually (overlay is separate)
  } else {
    preWrap && preWrap.classList.remove("hidden");
    btnCode && btnCode.classList.add("active");
    btnPrev && btnPrev.classList.remove("active");
  }
}

function openPreviewOverlay(pid){
  const srcIframe = document.getElementById(pid);
  const overlay = document.getElementById("previewOverlay");
  const destFrame = document.getElementById("previewOverlayFrame");
  if(!srcIframe || !overlay || !destFrame) return;
  // Copy content from source iframe
  try{
    const srcDoc = srcIframe.contentDocument || srcIframe.contentWindow.document;
    const html = srcDoc.documentElement.outerHTML;
    const doc = destFrame.contentDocument || destFrame.contentWindow.document;
    doc.open(); doc.write(html); doc.close();
  } catch(e){
    // fallback: re-write from data attribute
    const raw = srcIframe.getAttribute("data-src-raw") || "";
    const doc = destFrame.contentDocument || destFrame.contentWindow.document;
    doc.open(); doc.write(raw); doc.close();
  }
  overlay.classList.add("active");
  document.body.style.overflow = "hidden";
}

function closePreviewOverlay(){
  const overlay = document.getElementById("previewOverlay");
  if(overlay) overlay.classList.remove("active");
  document.body.style.overflow = "";
}

/* ======================== ADD NORMAL MSG ======================== */
function addMsg(text, role, extraHtml){
  const d = document.createElement("div");
  d.className = "msg " + role;
  const t = getTime();
  const textHtml = text ? renderMessage(text) : "";
  d.innerHTML = (extraHtml || "") + textHtml + `<div class="msg-time">${t}</div>`;
  chatEl.appendChild(d);
  autoScroll();
  return { el:d, time:t };
}

/* ======================== TYPING BUBBLE ======================== */
function showThinking(){
  const d = document.createElement("div");
  d.className = "typing-bubble";
  d.innerHTML = `<div class="td"></div><div class="td"></div><div class="td"></div>`;
  chatEl.appendChild(d); autoScroll();
  return d;
}

/* ======================== TYPE TEXT ======================== */
function typeText(el, text, i=0, done){
  if(stopTyping || !isGenerating){ if(done) done(); return; }
  if(i === 0) el.innerHTML = "";
  typingTimer = setTimeout(()=>{
    if(stopTyping || !isGenerating){ if(done) done(); return; }
    if(i < text.length){
      el.innerHTML = renderMessage(text.substring(0,i)) + `<div class="msg-time">${getTime()}</div>`;
      autoScroll(); typeText(el, text, i+2, done);
    } else {
      el.innerHTML = renderMessage(text) + `<div class="msg-time">${getTime()}</div>`;
      autoScroll(); if(done) done();
    }
  }, 7);
}

/* ======================== FINISH ======================== */
function finishAI(){
  isGenerating = false; stopTyping = false; controller = null;
  stopBtn.style.display = "none"; updateSend(); autoScroll();
}

/* ======================== STOP ======================== */
function stopAI(){
  // Jika MultiMind sedang berjalan — hapus DOM langsung, abort semua fetch
  if(mmIsGenerating){
    mmIsGenerating = false;
    mmStopRequested = true;
    if(mmController){ mmController.abort(); mmController = null; }
    // Hapus HANYA gelembung yang sedang diproses — bukan semua
    if(mmCurrentWrap && mmCurrentWrap.parentNode) mmCurrentWrap.parentNode.removeChild(mmCurrentWrap);
    mmCurrentWrap = null;
    document.querySelectorAll(".mm-typing-entry").forEach(function(el){ el.remove(); });
    stopBtn.style.display = "none";
    sendBtn.disabled = false;
    updateSend();
    return;
  }
  if(!isGenerating) return;
  stopTyping = true; isGenerating = false;
  clearTimeout(typingTimer); typingTimer = null;
  if(controller){ controller.abort(); controller = null; }
  document.querySelectorAll(".typing-bubble").forEach(b => b.remove());
  stopBtn.style.display = "none";
  const { time } = addMsg("Dihentikan.", "ai");
  addMsgToSession({ role:"ai", text:"Dihentikan.", time });
  updateSend();
}

/* ======================== SEND ======================== */
function send(){
  if(chatMode === "multi"){ cvSend(); return; }
  if(chatMode === "multimind"){ sendMultiMind(); return; }
  if(isGenerating) return;
  const rawMsg = inputEl.value.trim();
  if(!rawMsg) return;

  if(!activeId) newSession(chatMode);
  removeWelcome();

  inputEl.value = ""; inputEl.style.height = "auto";
  isGenerating = true; stopTyping = false;
  stopBtn.style.display = "flex"; sendBtn.disabled = true;
  controller = new AbortController();

  sendSingle(rawMsg, rawMsg, []);
}

/* ======================== SINGLE CHAT ======================== */
// Build conversation history for API (last 12 messages)
function buildHistory(){
  const sess = sessions.find(s => s.id === activeId);
  if(!sess) return [];
  return sess.messages
    .filter(m => m.role === "user" || m.role === "ai")
    .slice(-12)
    .map(m => ({ role: m.role === "ai" ? "assistant" : "user", content: m.text }));
}

// History untuk multi-chat — ambil dari pesan multi-user & multi-answer sesi aktif
// Pakai jawaban model pertama yang ada sebagai "assistant" untuk context
function buildMultiHistory(){
  const sess = sessions.find(s => s.id === activeId);
  if(!sess) return [];
  const hist = [];
  sess.messages.forEach(m => {
    if(m.role === "multi-user"){
      hist.push({ role: "user", content: m.text });
    } else if(m.role === "multi-answer"){
      // Ambil jawaban pertama yang tersedia sebagai context
      const models = m.models || ["groq","qwen","glm"];
      const firstReply = models.map(api => m[api]).find(r => r && !r.startsWith("Gagal:"));
      if(firstReply) hist.push({ role: "assistant", content: firstReply });
    }
  });
  return hist.slice(-12);
}

function sendSingle(msg, displayMsg, filesSnap){
  displayMsg = displayMsg || msg;
  filesSnap = filesSnap || [];

  // Build display HTML for user bubble — Claude-like file previews
  let extraHtml = "";
  const imgFiles = filesSnap.filter(f => f.isImage && f.dataUrl);
  const otherFiles = filesSnap.filter(f => !f.isImage);

  if (imgFiles.length) {
    const hasBelow = otherFiles.length || (displayMsg && displayMsg !== "(File dilampirkan — tolong baca dan analisis)");
    const n = imgFiles.length;
    const mbBot = hasBelow ? "10px" : "0px";
    if (n === 1) {
      const f = imgFiles[0];
      const brBot = hasBelow ? "0 0" : "4px 14px";
      extraHtml += `<div style="margin:-12px -16px ${mbBot} -16px;overflow:hidden;border-radius:14px 14px ${brBot};">
        <img src="${f.dataUrl}" style="width:100%;height:210px;object-fit:cover;display:block;" alt="${f.name}">
        <div style="background:rgba(0,0,0,0.35);padding:5px 11px;display:flex;align-items:center;gap:4px;min-width:0;">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.55)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
          <span style="font-size:10px;color:rgba(255,255,255,0.65);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;line-height:1.2;">${f.name}</span>
        </div>
      </div>` + (hasBelow ? `<div style="height:10px"></div>` : "");
    } else {
      // Multiple images: horizontal scrollable strip, all same row
      const brBot = hasBelow ? "0 0" : "4px 14px";
      extraHtml += `<div style="margin:-12px -16px ${mbBot} -16px;overflow-x:auto;overflow-y:hidden;display:flex;flex-direction:row;gap:2px;background:rgba(0,0,0,0.18);border-radius:14px 14px ${brBot};scrollbar-width:none;-ms-overflow-style:none;">` +
        imgFiles.map((f, idx) => {
          const tl = idx===0?"14px":"0";
          const bl = idx===0&&!hasBelow?"4px":"0";
          const tr = idx===n-1?"14px":"0";
          const br = idx===n-1&&!hasBelow?"14px":"0";
          return `<div style="flex:0 0 90px;display:flex;flex-direction:column;overflow:hidden;border-radius:${tl} ${tr} ${br} ${bl};">
            <img src="${f.dataUrl}" style="width:90px;height:90px;object-fit:cover;display:block;" alt="${f.name}">
          </div>`;
        }).join("") + `</div>` + (hasBelow ? `<div style="height:10px"></div>` : "");
    }
  }
  if (otherFiles.length) {
    extraHtml += otherFiles.map(f => {
      const ext = f.name.split(".").pop().toUpperCase().slice(0,5);
      const svg = getFileIconSVG(f.name, f.type);
      return `<div style="display:flex;align-items:center;gap:8px;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.15);border-radius:8px;padding:6px 10px 6px 7px;margin-bottom:3px;width:100%;box-sizing:border-box;">
        <div style="width:28px;height:28px;min-width:28px;border-radius:6px;background:rgba(255,255,255,0.18);display:flex;align-items:center;justify-content:center;flex-shrink:0;color:#fff;padding:5px;box-sizing:border-box;">${svg}</div>
        <div style="min-width:0;flex:1;display:flex;flex-direction:column;justify-content:center;">
          <div style="font-size:11px;font-weight:600;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.3;">${f.name}</div>
          <div style="font-size:9.5px;color:rgba(255,255,255,0.5);margin-top:1px;white-space:nowrap;line-height:1;">${ext} · ${formatSize(f.size)}</div>
        </div>
      </div>`;
    }).join("");
  }

  // Suppress auto caption jika user tidak ketik apapun
  const autoCaption = "(File dilampirkan — tolong baca dan analisis)";
  if (displayMsg === autoCaption) displayMsg = "";

  const { time:ut } = addMsg(displayMsg, "user", extraHtml);
  addMsgToSession({ role:"user", text:displayMsg, time:ut, files:filesSnap });

  const loader = showThinking();
  const history = buildHistory();
  const apiToUse = wormMode ? "worm" : currentAPI;

  callAPI(apiToUse, msg, history)
  .then(reply => {
    loader.remove();
    if(!isGenerating) return; // stopped
    const dEl = document.createElement("div");
    dEl.className = "msg ai";
    chatEl.appendChild(dEl);
    typeText(dEl, reply, 0, ()=>{
      const t = getTime();
      addMsgToSession({ role:"ai", text:reply, time:t });
      finishAI();
    });
  })
  .catch(err => {
    loader.remove();
    if(!isGenerating) return;
    const errMsg = "Error: " + err.message;
    const { time:et } = addMsg(errMsg, "ai");
    addMsgToSession({ role:"ai", text:errMsg, time:et });
    finishAI();
  });
}

/* ======================== CANVAS ENGINE ======================== */
const canvas = {
  world: null, svg: null,
  scale: 1, ox: 0, oy: 0,         // offset (pan)
  isPanning: false, panSX: 0, panSY: 0, panOX: 0, panOY: 0,
  nodes: [],         // {id, el, x, y, w, h, type} 
  edges: [],         // {from, to, cls, el}
  isDragging: false, dragNode: null, dragSX: 0, dragSY: 0, dragNX: 0, dragNY: 0,
  nextX: 0, nextY: 0,  // layout cursor
};

function cvInit(){
  canvas.world = document.getElementById("canvasWorld");
  canvas.svg   = document.getElementById("canvasSVG");

  // Continuous edge redraw loop — keeps edges in sync with any transform/scroll/zoom
  (function edgeLoop(){
    cvRedrawEdges();
    requestAnimationFrame(edgeLoop);
  })();

  // Pan events on the space background
  const space = document.getElementById("canvasSpace");
  space.addEventListener("mousedown",  cvPanStart);
  space.addEventListener("mousemove",  cvPanMove);
  space.addEventListener("mouseup",    cvPanEnd);
  space.addEventListener("mouseleave", cvPanEnd);
  space.addEventListener("wheel",      cvWheel, {passive:false});

  // Touch pan
  space.addEventListener("touchstart", cvTouchStart, {passive:false});
  space.addEventListener("touchmove",  cvTouchMove,  {passive:false});
  space.addEventListener("touchend",   cvTouchEnd);
  space.addEventListener("touchcancel",cvTouchEnd);

  // Canvas text input
  const ta = document.getElementById("canvasText");
  const sb = document.getElementById("cibSend");
  ta.addEventListener("input", ()=>{
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 130) + "px";
    sb.disabled = ta.value.trim() === "" || isGenerating;
  });
  ta.addEventListener("keydown", e => {
    if(e.key === "Enter" && !e.shiftKey){ e.preventDefault(); cvSend(); }
  });
  sb.addEventListener("click", cvSend);
}

/* ---- Pan ---- */
function cvPanStart(e){
  if(e.target !== document.getElementById("canvasSpace") &&
     e.target !== document.getElementById("canvasWorld") &&
     e.target !== document.getElementById("canvasSVG") &&
     !e.target.closest("#canvasWelcome")) return;
  canvas.isPanning = true;
  canvas.panSX = e.clientX; canvas.panSY = e.clientY;
  canvas.panOX = canvas.ox;  canvas.panOY = canvas.oy;
  canvas.world.classList.add("panning");
}
function cvPanMove(e){
  if(!canvas.isPanning) return;
  canvas.ox = canvas.panOX + (e.clientX - canvas.panSX);
  canvas.oy = canvas.panOY + (e.clientY - canvas.panSY);
  cvApplyTransform();
}
function cvPanEnd(){ canvas.isPanning = false; canvas.world.classList.remove("panning"); }

let cvTouchLast = null;
let cvPinchDist = null;
let cvPinchScale = null;
let cvPinchOX = null, cvPinchOY = null;
let cvPinchMidX = null, cvPinchMidY = null;

function getTouchDist(t){ return Math.hypot(t[0].clientX-t[1].clientX, t[0].clientY-t[1].clientY); }
function getTouchMid(t){ return {x:(t[0].clientX+t[1].clientX)/2, y:(t[0].clientY+t[1].clientY)/2}; }

function cvTouchStart(e){
  if(e.touches.length === 1){
    // Only pan if touch is on canvas background (not a node)
    const tgt = e.target;
    const isBackground = tgt === document.getElementById("canvasSpace") ||
                         tgt === document.getElementById("canvasWorld") ||
                         tgt === document.getElementById("canvasSVG") ||
                         tgt.closest("#canvasWelcome");
    if(!isBackground) { cvTouchLast = null; return; }
    cvTouchLast = {x:e.touches[0].clientX, y:e.touches[0].clientY};
    canvas.panOX = canvas.ox; canvas.panOY = canvas.oy;
    cvPinchDist = null;
  } else if(e.touches.length === 2){
    // Start pinch
    cvTouchLast = null;
    cvPinchDist = getTouchDist(e.touches);
    cvPinchScale = canvas.scale;
    cvPinchOX = canvas.ox; cvPinchOY = canvas.oy;
    const mid = getTouchMid(e.touches);
    const space = document.getElementById("canvasSpace");
    const rect = space.getBoundingClientRect();
    cvPinchMidX = mid.x - rect.left;
    cvPinchMidY = mid.y - rect.top;
    e.preventDefault();
  }
}
function cvTouchMove(e){
  if(e.touches.length === 2 && cvPinchDist !== null){
    // Pinch zoom
    e.preventDefault();
    const newDist = getTouchDist(e.touches);
    const ratio = newDist / cvPinchDist;
    const newScale = Math.min(2, Math.max(0.25, cvPinchScale * ratio));
    // Zoom centered on pinch midpoint
    canvas.ox = cvPinchMidX - (cvPinchMidX - cvPinchOX) * (newScale / cvPinchScale);
    canvas.oy = cvPinchMidY - (cvPinchMidY - cvPinchOY) * (newScale / cvPinchScale);
    canvas.scale = newScale;
    cvApplyTransform();
    document.getElementById("zoomLabel").textContent = Math.round(canvas.scale*100) + "%";
  } else if(e.touches.length === 1 && cvTouchLast){
    // Pan
    const dx = e.touches[0].clientX - cvTouchLast.x;
    const dy = e.touches[0].clientY - cvTouchLast.y;
    canvas.ox = canvas.panOX + dx;
    canvas.oy = canvas.panOY + dy;
    cvApplyTransform();
    e.preventDefault();
  }
}
function cvTouchEnd(e){
  if(e.touches.length < 2){ cvPinchDist = null; }
  if(e.touches.length === 0){ cvTouchLast = null; canvas.world.classList.remove("panning"); }
}

/* ---- Zoom ---- */
function cvWheel(e){
  e.preventDefault();
  const delta = e.deltaY < 0 ? 0.1 : -0.1;
  canvasZoom(delta, e.clientX, e.clientY);
}
function canvasZoom(delta, cx, cy){
  const space = document.getElementById("canvasSpace");
  const rect = space.getBoundingClientRect();
  cx = cx ?? rect.width/2;
  cy = cy ?? rect.height/2;
  const oldScale = canvas.scale;
  canvas.scale = Math.min(2, Math.max(0.25, canvas.scale + delta));
  // Zoom around cursor point
  canvas.ox = cx - (cx - canvas.ox) * (canvas.scale / oldScale);
  canvas.oy = cy - (cy - canvas.oy) * (canvas.scale / oldScale);
  cvApplyTransform();
  document.getElementById("zoomLabel").textContent = Math.round(canvas.scale*100) + "%";
}
function cvApplyTransform(){
  canvas.world.style.transform = `translate(${canvas.ox}px,${canvas.oy}px) scale(${canvas.scale})`;
  cvRedrawEdges();
}

/* ---- Fit view ---- */
function canvasFitView(){
  if(!canvas.nodes.length) return;
  const space = document.getElementById("canvasSpace");
  const vw = space.clientWidth, vh = space.clientHeight;
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  canvas.nodes.forEach(n=>{
    minX=Math.min(minX,n.x); minY=Math.min(minY,n.y);
    maxX=Math.max(maxX,n.x+n.w); maxY=Math.max(maxY,n.y+n.h);
  });
  const pw=maxX-minX+80, ph=maxY-minY+80;
  canvas.scale = Math.min(2,Math.max(0.3, Math.min(vw/pw,vh/ph)*0.9));
  canvas.ox = (vw - pw*canvas.scale)/2 - minX*canvas.scale + 40*canvas.scale;
  canvas.oy = (vh - ph*canvas.scale)/2 - minY*canvas.scale + 40*canvas.scale;
  cvApplyTransform();
  document.getElementById("zoomLabel").textContent = Math.round(canvas.scale*100) + "%";
}

/* ---- Node drag (mouse + touch, edges stay connected) ---- */
function cvMakeDraggable(el, nodeRef){
  let isDrag = false, startX, startY, origX, origY;

  function onStart(cx, cy){
    isDrag = false;
    startX = cx; startY = cy;
    origX = nodeRef.x; origY = nodeRef.y;
    el.style.zIndex = 999;
    el.style.transition = 'none';
  }
  function onMove(cx, cy){
    const dx = (cx - startX) / canvas.scale;
    const dy = (cy - startY) / canvas.scale;
    if(!isDrag && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) isDrag = true;
    if(!isDrag) return;
    nodeRef.x = origX + dx;
    nodeRef.y = origY + dy;
    el.style.left = nodeRef.x + "px";
    el.style.top  = nodeRef.y + "px";
    cvRedrawEdges();
  }
  function onEnd(){
    el.style.zIndex = '';
    el.style.transition = '';
    isDrag = false;
  }

  // Mouse
  el.addEventListener("mousedown", e=>{
    if(e.button !== 0) return;
    if(e.target.closest(".cn-node-body,button,a,textarea")) return;
    e.stopPropagation(); e.preventDefault();
    onStart(e.clientX, e.clientY);
    function mm(e){ onMove(e.clientX, e.clientY); }
    function mu(){ onEnd(); window.removeEventListener("mousemove",mm); window.removeEventListener("mouseup",mu); }
    window.addEventListener("mousemove", mm);
    window.addEventListener("mouseup", mu);
  });

  // Touch
  el.addEventListener("touchstart", e=>{
    // Only drag from header, not body (body should scroll)
    if(e.target.closest(".cn-node-body,button,a,textarea")) return;
    e.stopPropagation();
    const t = e.touches[0];
    onStart(t.clientX, t.clientY);
  }, {passive:true});

  el.addEventListener("touchmove", e=>{
    // Don't intercept if touching body (let it scroll)
    if(e.target.closest(".cn-node-body")) return;
    const t = e.touches[0];
    const dx = (t.clientX - startX) / canvas.scale;
    const dy = (t.clientY - startY) / canvas.scale;
    if(Math.abs(dx) > 5 || Math.abs(dy) > 5){
      // It's a drag, prevent canvas pan
      e.stopPropagation();
      e.preventDefault();
      onMove(t.clientX, t.clientY);
    }
  }, {passive:false});

  el.addEventListener("touchend", e=>{
    onEnd();
    e.stopPropagation();
  }, {passive:true});
}
/* ---- Place a node on canvas ---- */
function cvPlaceNode(el, x, y, type){
  el.style.position = "absolute";
  el.style.left = x + "px";
  el.style.top  = y + "px";
  canvas.world.appendChild(el);
  const rect = {w: el.offsetWidth||290, h: el.offsetHeight||160};
  const ref = {id: el.id||("n"+Date.now()), el, x, y, w:rect.w, h:rect.h, type};
  canvas.nodes.push(ref);
  cvMakeDraggable(el, ref);
  return ref;
}

/* ---- Draw edges (SVG bezier curves, vertical: prompt bottom → node top) ---- */
function cvDrawEdge(fromRef, toRef, cls){
  const svg = canvas.svg;
  const path = document.createElementNS("http://www.w3.org/2000/svg","path");
  path.classList.add("cv-edge", cls);
  svg.appendChild(path);

  const dotFrom = document.createElementNS("http://www.w3.org/2000/svg","circle");
  dotFrom.classList.add("cv-edge-dot", cls);
  dotFrom.setAttribute("r","3");
  svg.appendChild(dotFrom);

  const dotTo = document.createElementNS("http://www.w3.org/2000/svg","circle");
  dotTo.classList.add("cv-edge-dot", cls);
  dotTo.setAttribute("r","4");
  dotTo.style.animationDelay = (cls==="qwen"?"0.15s":"0s");
  svg.appendChild(dotTo);

  const edge = {fromRef, toRef, cls, path, dotFrom, dotTo};
  canvas.edges.push(edge);
  cvUpdateEdge(edge);
  return edge;
}

function cvUpdateEdge(edge){
  const {fromRef, toRef, path, dotFrom, dotTo} = edge;
  const spaceEl = document.getElementById("canvasSpace");
  const spaceRect = spaceEl.getBoundingClientRect();

  // Get actual screen positions of the DOM elements
  const fromRect = fromRef.el.getBoundingClientRect();
  const toRect   = toRef.el.getBoundingClientRect();

  // Convert to SVG coordinate space (relative to canvasSpace)
  const fx = fromRect.left - spaceRect.left + fromRect.width / 2;
  const fy = fromRect.bottom - spaceRect.top;
  const tx = toRect.left - spaceRect.left + toRect.width / 2;
  const ty = toRect.top - spaceRect.top;

  const dist = Math.abs(ty - fy);
  const cp = Math.max(dist * 0.5, 40);
  const d = `M ${fx} ${fy} C ${fx} ${fy+cp}, ${tx} ${ty-cp}, ${tx} ${ty}`;
  path.setAttribute("d", d);
  dotFrom.setAttribute("cx", fx);
  dotFrom.setAttribute("cy", fy);
  dotTo.setAttribute("cx", tx);
  dotTo.setAttribute("cy", ty);
}

function cvRedrawEdges(){
  canvas.edges.forEach(e => cvUpdateEdge(e));
}

/* ---- Layout helpers ---- */
function cvNextLayout(isPrompt){
  const space = document.getElementById("canvasSpace");
  const vw = space.clientWidth, vh = space.clientHeight;
  const headerH = 60;

  if(isPrompt){
    // Center-top of visible area
    const cx = (vw/2 - canvas.ox) / canvas.scale;
    const cy = (80 - canvas.oy) / canvas.scale + canvas.nextY;
    return {x: cx - 150, y: cy};
  }
}

let canvasLayoutY = 80;
let _cvMsgId = 0; // always-unique counter per send

/* ======================== CANVAS SEND ======================== */
function cvSend(){
  if(isGenerating) return;
  const ta = document.getElementById("canvasText");
  const msg = ta.value.trim();
  if(!msg) return;

  if(!activeId) newSession("multi");
  cvHideWelcome();

  ta.value = ""; ta.style.height = "auto";
  document.getElementById("cibSend").disabled = true;
  document.getElementById("cibStop").style.display = "flex";
  isGenerating = true; stopTyping = false;
  controller = new AbortController();

  const ut = getTime();
  const msgId = "cv" + (++_cvMsgId);
  addMsgToSession({ role:"multi-user", text:msg, time:ut });

  const space = document.getElementById("canvasSpace");
  const vw = space.clientWidth;

  // Dynamic columns based on selected models count
  const numModels = activeMultiModels.length;
  const maxNodeW = Math.min(360, Math.max(240, (vw - 20 - (numModels-1)*10) / numModels));
  const nodeSpacing = 10;
  const totalNodesW = maxNodeW * numModels + nodeSpacing * (numModels - 1);
  const canvasCenterX = vw / 2;

  const promptW = Math.min(360, vw - 40);
  const promptX = canvasCenterX - promptW / 2;
  const promptY = canvasLayoutY;

  const promptEl = document.createElement("div");
  promptEl.className = "cn-prompt";
  promptEl.style.maxWidth = promptW + "px";
  promptEl.style.minWidth = "120px";
  promptEl.innerHTML = `<div class="cn-prompt-label">Kamu</div><div class="cn-prompt-text">${escHtml(msg)}</div><div class="cn-prompt-time">${ut}</div>`;
  const promptRef = cvPlaceNode(promptEl, promptX, promptY, "prompt");

  requestAnimationFrame(()=>{
    promptRef.w = promptEl.offsetWidth || promptW;
    promptRef.h = promptEl.offsetHeight || 50;
    cvRedrawEdges();
  });

  const nodeY = promptY + 80;
  const startX = canvasCenterX - totalNodesW / 2;

  // Model config map
  const MODEL_CONFIG = {
    groq: { label:"QWEN", badge:"Smart" },
    qwen: { label:"AIVA", badge:"4o-mini" },
    glm:  { label:"GLM",  badge:"GLM-4.5" },
    gpt:  { label:"GPT-OSS", badge:"20B" },
  };

  const selectedModels = [...activeMultiModels];

  selectedModels.forEach((api, idx) => {
    const cfg = MODEL_CONFIG[api] || { label: api.toUpperCase(), badge: api };
    const x = startX + idx * (maxNodeW + nodeSpacing);
    const delay = 60 + idx * 80;
    setTimeout(()=>{
      const nodeEl = document.createElement("div");
      nodeEl.className = `cn-node ${api} loading`;
      nodeEl.style.width = maxNodeW + "px";
      nodeEl.id = `cvnode_${api}_${msgId}`;
      nodeEl.innerHTML = `
        <div class="cn-node-hdr">
          <div class="cn-node-grip">${'<span></span>'.repeat(6)}</div>
          <div class="cn-node-dot"></div>
          <div class="cn-node-label">${cfg.label}</div>
          <div class="cn-node-badge">${cfg.badge}</div>
          <button class="cn-node-minimize" onclick="toggleNodeMinimize(this)" title="Minimize/Expand">
            <svg viewBox="0 0 24 24"><polyline points="18 15 12 9 6 15"/></svg>
          </button>
        </div>
        <div class="cn-node-body">
          <div class="cn-loading">
            <div class="td"></div><div class="td"></div><div class="td"></div>
          </div>
        </div>`;
      const nRef = cvPlaceNode(nodeEl, x, nodeY, api);
      requestAnimationFrame(()=>{
        nRef.w = nodeEl.offsetWidth || maxNodeW;
        nRef.h = nodeEl.offsetHeight || 100;
        promptRef.w = promptEl.offsetWidth || promptW;
        promptRef.h = promptEl.offsetHeight || 50;
        cvDrawEdge(promptRef, nRef, api);
        cvRedrawEdges();
      });
    }, delay);
  });

  canvasLayoutY += 480;

  const apiPromise = callMultiAPI(msg, selectedModels);

  setTimeout(()=>{
    canvas.scale = 1;
    canvas.ox = -(promptX - (vw/2 - promptW/2));
    canvas.oy = -(promptY - 40);
    cvApplyTransform();
    document.getElementById("zoomLabel").textContent = "100%";
  }, 80);

  apiPromise
  .then(replies => {
    selectedModels.forEach(api => {
      const reply = replies[api] || "Tidak ada respons";
      const nodeEl = document.getElementById(`cvnode_${api}_${msgId}`);
      if(nodeEl){
        nodeEl.classList.remove("loading");
        const body = nodeEl.querySelector(".cn-node-body");
        if(body) body.innerHTML = renderMessage(reply) + `<div class="cn-node-time">${getTime()}</div>`;
        [50, 150, 350].forEach(delay => {
          setTimeout(()=>{
            const ref = canvas.nodes.find(n=>n.el===nodeEl);
            if(ref){
              ref.w = nodeEl.offsetWidth || ref.w;
              ref.h = nodeEl.offsetHeight || ref.h;
            }
            cvRedrawEdges();
          }, delay);
        });
      }
    });
    const t = getTime();
    const answerObj = { role:"multi-answer", time:t, models: selectedModels };
    selectedModels.forEach(api => { answerObj[api] = replies[api] || ""; });
    addMsgToSession(answerObj);
    cvFinish();
  })
  .catch(err=>{
    selectedModels.forEach(api=>{
      const nodeEl = document.getElementById(`cvnode_${api}_${msgId}`);
      if(nodeEl){
        nodeEl.classList.remove("loading");
        const body = nodeEl.querySelector(".cn-node-body");
        if(body) body.innerHTML = `<div class="text">Gagal: ${escHtml(err.message)}</div>`;
      }
    });
    cvFinish();
  });
}

function toggleNodeMinimize(btn){
  const node = btn.closest(".cn-node");
  if(!node) return;
  node.classList.toggle("minimized");
  setTimeout(()=>{ cvRedrawEdges(); }, 50);
}

function cvFinish(){
  isGenerating = false; stopTyping = false; controller = null;
  document.getElementById("cibStop").style.display = "none";
  document.getElementById("cibSend").disabled = false;
  cvRedrawEdges();
}

function stopCanvas(){
  if(!isGenerating) return;
  isGenerating = false; stopTyping = false;
  if(controller){ controller.abort(); controller = null; }
  document.getElementById("cibStop").style.display = "none";
  document.getElementById("cibSend").disabled = false;
}

function cvHideWelcome(){
  const wc = document.getElementById("canvasWelcome");
  if(!wc || wc._gone) return;
  wc._gone = true;
  wc.style.transition = "opacity 0.45s ease, transform 0.45s var(--ease), filter 0.45s ease";
  wc.classList.add("hiding");
  setTimeout(()=>{ wc.style.display = "none"; }, 480);
}

/* ======================== CANVAS RESTORE SESSION ======================== */
function cvClearCanvas(){
  _cvMsgId = 0; // reset counter on new canvas
  // Clear edges from SVG (keep defs)
  canvas.nodes = []; canvas.edges = [];
  const svg = canvas.svg;
  const defs = svg.querySelector("defs");
  while(svg.lastChild && svg.lastChild !== defs) svg.removeChild(svg.lastChild);
  // Remove all node elements from world
  Array.from(canvas.world.children).forEach(c => c.remove());
  canvasLayoutY = 80;
  canvas.ox = 0; canvas.oy = 0; canvas.scale = 1;
  if(canvas.world) cvApplyTransform();
}

function cvRestoreSession(sess){
  cvClearCanvas();

  let hasContent = false;
  const vw = document.getElementById("canvasSpace").clientWidth;
  const nodeW = Math.min(260, (vw - 56) / 2);
  const nodeSpacing = 16;
  const totalNodesW = nodeW * 2 + nodeSpacing;

  sess.messages.forEach(m=>{
    if(m.role==="multi-user"){
      hasContent = true;
      const promptW = Math.min(360, vw - 40);
      const promptX = vw/2 - promptW/2;
      const promptY = canvasLayoutY;
      const promptEl = document.createElement("div");
      promptEl.className = "cn-prompt";
      promptEl.style.maxWidth = promptW + "px";
      promptEl.style.minWidth = "120px";
      promptEl.innerHTML = `<div class="cn-prompt-label">Kamu</div><div class="cn-prompt-text">${escHtml(m.text)}</div><div class="cn-prompt-time">${m.time}</div>`;
      cvPlaceNode(promptEl, promptX, promptY, "prompt");
    }
    if(m.role==="multi-answer"){
      hasContent = true;
      const lastPrompt = canvas.nodes.filter(n=>n.type==="prompt").slice(-1)[0];
      if(!lastPrompt) return;
      const nodeY = lastPrompt.y + 80;

      // Support both old format (groq/qwen/glm keys) and new format (models array)
      const sessionModels = m.models || ["groq","qwen","glm"];
      const numModels = sessionModels.length;
      const nodeW2 = Math.min(360, Math.max(240, (vw - 20 - (numModels-1)*10) / numModels));
      const nodeSpacing2 = 10;
      const totalNodesW2 = nodeW2 * numModels + nodeSpacing2 * (numModels - 1);

      const MODEL_CONFIG2 = {
        groq: { label:"QWEN",    badge:"Smart" },
        qwen: { label:"AIVA",    badge:"4o-mini" },
        glm:  { label:"GLM",     badge:"GLM-4.5" },
        gpt:  { label:"GPT-OSS", badge:"20B" },
      };

      sessionModels.forEach((api, idx) => {
        const cfg = MODEL_CONFIG2[api] || { label: api.toUpperCase(), badge: api };
        const x = vw/2 - totalNodesW2/2 + idx * (nodeW2 + nodeSpacing2);
        const reply = m[api] || "";
        const nodeEl = document.createElement("div");
        nodeEl.className = `cn-node ${api}`;
        nodeEl.style.width = nodeW2 + "px";
        nodeEl.innerHTML = `
          <div class="cn-node-hdr">
            <div class="cn-node-grip">${'<span></span>'.repeat(6)}</div>
            <div class="cn-node-dot"></div>
            <div class="cn-node-label">${cfg.label}</div>
            <div class="cn-node-badge">${cfg.badge}</div>
            <button class="cn-node-minimize" onclick="toggleNodeMinimize(this)" title="Minimize/Expand">
              <svg viewBox="0 0 24 24"><polyline points="18 15 12 9 6 15"/></svg>
            </button>
          </div>
          <div class="cn-node-body">
            ${renderMessage(reply||"")}
            <div class="cn-node-time">${m.time}</div>
          </div>`;
        const nRef = cvPlaceNode(nodeEl, x, nodeY, api);
        setTimeout(()=>{
          lastPrompt.w = lastPrompt.el.offsetWidth || 280;
          lastPrompt.h = lastPrompt.el.offsetHeight || 50;
          nRef.w = nodeEl.offsetWidth || nodeW2;
          nRef.h = nodeEl.offsetHeight || 120;
          cvDrawEdge(lastPrompt, nRef, api);
          cvRedrawEdges();
        }, 60);
      });
      canvasLayoutY += 480;
    }
  });

  if(hasContent){
    cvHideWelcome();
    setTimeout(()=>{ canvasFitView(); }, 150);
  }
}

/* ======================== MULTI CHAT (old API — now redirects to canvas) ======================== */
function makeMultiSkeleton(){ return document.createElement("div"); } // stub
function fillMultiNode(){} // stub
function sendMulti(msg){ /* handled by cvSend */ }
function buildMultiAnswerEl(groqR, qwenR, t){ return document.createElement("div"); }

/* ======================== MULTIMIND ======================== */
const MM_MODELS = ["groq","qwen","glm","gpt"];
const MM_LABELS = { groq:"QWEN", qwen:"AIVA", glm:"GLM", gpt:"GPT-OSS" };
const MM_COLORS = { groq:"#7aa8f7", qwen:"#c4a8ff", glm:"#6ee7b7", gpt:"#5eead4" };

function buildMultiMindWelcome(){
  if(document.getElementById("welcomeChat") || document.getElementById("welcomeMultiMind")) return;
  const wc = document.createElement("div");
  wc.id = "welcomeMultiMind";
  wc.innerHTML = `
    <div class="wmm-icon">
      <svg viewBox="0 0 24 24"><path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.46 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.44-4.14z"/><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.46 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.44-4.14z"/></svg>
    </div>
    <div class="wmm-title">MULTIMIND</div>
    <div class="wmm-sub">4 model AI saling debat, voting, dan memilih jawaban terbaik untuk kamu</div>
    <div class="wmm-chips">
      <div class="wmm-chip" onclick="suggest('Apa itu kecerdasan buatan?')">Apa itu AI?</div>
      <div class="wmm-chip" onclick="suggest('Jelaskan cara kerja blockchain')">Blockchain</div>
      <div class="wmm-chip" onclick="suggest('Apa bahasa pemrograman terbaik 2025?')">Best language?</div>
      <div class="wmm-chip" onclick="suggest('Bagaimana cara belajar machine learning?')">ML Learning</div>
    </div>`;
  chatEl.appendChild(wc);
}

function removeMultiMindWelcome(){
  const wc = document.getElementById("welcomeMultiMind");
  if(wc){ wc.style.transition="opacity 0.4s ease"; wc.style.opacity="0"; setTimeout(()=>wc.remove(),400); }
}

function buildMultiMindResultEl(saved){
  // Rebuild from saved session data
  const wrap = document.createElement("div");
  wrap.className = "mm-debate-wrap";
  const models = saved.models || MM_MODELS;
  const votes = saved.votes || {};
  const winner = saved.winner || models[0];
  const answers = saved.answers || {};
  const debates = saved.debates || [];

  let cardsHtml = models.map(api => {
    const v = votes[api] || 0;
    const stars = "★".repeat(Math.max(0,v)) + "☆".repeat(Math.max(0,3-v));
    const isWinner = api === winner;
    return `<div class="mm-model-card ${api}${isWinner?" winner":""}">
      <div class="mm-card-hdr"><div class="mm-cdot"></div>${MM_LABELS[api]}${isWinner?'<span class="mm-winner-badge">🏆 WINNER</span>':''}</div>
      <div class="mm-card-body">${renderMessage(answers[api]||"")}</div>
      <div class="mm-card-vote"><span class="mm-vote-stars">${stars}</span> ${v}/3 votes</div>
    </div>`;
  }).join("");

  let debateHtml = debates.slice(0,8).map(d=>`
    <div class="mm-debate-entry ${d.model}">
      <div class="mm-de-meta">
        <span class="mm-de-label">${MM_LABELS[d.model]||d.model}</span>
        <span class="mm-de-round" style="background:rgba(245,158,11,0.09);color:rgba(245,158,11,0.8);border-color:rgba(245,158,11,0.22);">ARGUMEN</span>
      </div>
      <div class="mm-de-text">${escHtml(d.comment)}</div>
    </div>`).join("");

  const totalVotes = Object.values(votes).reduce((a,b)=>a+b,0)||1;
  let voteBarHtml = models.map(api=>{
    const v = votes[api]||0;
    const pct = Math.round(v/totalVotes*100);
    return `<div class="mm-vote-bar-row ${api}">
      <div class="mm-vote-bar-label">${MM_LABELS[api]}</div>
      <div class="mm-vote-bar-track"><div class="mm-vote-bar-fill" style="width:${pct}%"></div></div>
      <div class="mm-vote-score">${v}</div>
    </div>`;
  }).join("");

  wrap.innerHTML = `
    <div class="mm-debate-header">
      <svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
      MULTIMIND — SELESAI
    </div>
    <div class="mm-cards-row">${cardsHtml}</div>
    ${debates.length?`<div class="mm-debate-log">${debateHtml}</div>`:""}
    <div class="mm-voting-section"><div class="mm-voting-title">📊 Hasil Voting</div><div class="mm-voting-bars">${voteBarHtml}</div></div>
    <div class="mm-final-wrap">
      <div class="mm-final-label">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
        Jawaban Terpilih
      </div>
      <div class="mm-final-content">${renderMessage(answers[winner]||"")}</div>
      <div class="mm-final-meta">
        <span class="mm-winner-tag ${winner}">${MM_LABELS[winner]} — ${votes[winner]||0} votes</span>
        <span style="color:var(--muted)">${saved.time||""}</span>
      </div>
      <div style="margin-top:10px;padding:10px 14px;background:rgba(245,158,11,0.05);border:1px solid rgba(245,158,11,0.15);border-radius:10px;font-size:11px;color:rgba(221,227,242,0.5);line-height:1.65;display:flex;align-items:flex-start;gap:8px;">
        <span style="font-size:14px;flex-shrink:0;margin-top:1px">❕</span>
        <span><span style="color:rgba(245,158,11,0.7);font-weight:700;letter-spacing:0.3px;">Catatan Voting:</span> Hasil voting di atas adalah preferensi dari model-model AI itu sendiri — bukan penilaian mutlak. Kamu tetap bebas membaca semua jawaban dan menentukan mana yang paling tepat menurutmu.</span>
      </div>
    </div>`;
  return wrap;
}

// ── Helper: append a debate entry live into the log ──
function mmAppendDebateEntry(debateLog, api, text, roundLabel){
  const entry = document.createElement("div");
  entry.className = `mm-debate-entry ${api}`;
  entry.innerHTML = `
    <div class="mm-de-meta">
      <span class="mm-de-label">${MM_LABELS[api]}</span>
      <span class="mm-de-round" style="background:rgba(245,158,11,0.09);color:rgba(245,158,11,0.8);border-color:rgba(245,158,11,0.22);">ARGUMEN</span>
    </div>
    <div class="mm-de-text">${escHtml(text)}</div>`;
  debateLog.appendChild(entry);
  autoScroll();
}

// ── Helper: show typing indicator for a model in debate log ──
function mmShowTyping(debateLog, api){
  const el = document.createElement("div");
  el.className = `mm-debate-entry ${api} mm-typing-entry`;
  el.id = "mm-typing-" + api;
  el.innerHTML = `
    <div class="mm-de-meta"><span class="mm-de-label">${MM_LABELS[api]}</span><span class="mm-de-round">sedang mengetik...</span></div>
    <div class="mm-de-text" style="display:flex;gap:4px;align-items:center;opacity:0.5">
      <div class="td" style="width:5px;height:5px;border-radius:50%;background:currentColor;animation:tdA 1.3s ease-in-out infinite"></div>
      <div class="td" style="width:5px;height:5px;border-radius:50%;background:currentColor;animation:tdA 1.3s ease-in-out infinite;animation-delay:0.15s"></div>
      <div class="td" style="width:5px;height:5px;border-radius:50%;background:currentColor;animation:tdA 1.3s ease-in-out infinite;animation-delay:0.3s"></div>
    </div>`;
  debateLog.appendChild(el);
  autoScroll();
  return el;
}

async function sendMultiMind(){
  if(mmIsGenerating) return;
  const rawMsg = inputEl.value.trim();
  if(!rawMsg) return;
  if(!activeId) newSession("multimind");
  removeMultiMindWelcome();

  inputEl.value = ""; inputEl.style.height = "auto";
  mmIsGenerating = true;
  mmStopRequested = false;

  // AbortController baru tiap sesi — abort = batalkan semua fetch seketika
  const uid = ++mmCallId; // unique per call, used in all element IDs below
  mmController = new AbortController();
  const sig = mmController.signal;

  sendBtn.disabled = true;
  stopBtn.style.display = "flex";

  const t = getTime();

  // User bubble
  const userEl = document.createElement("div");
  userEl.className = "msg user";
  userEl.innerHTML = escHtml(rawMsg) + `<span class="msg-time">${t}</span>`;
  chatEl.appendChild(userEl);
  addMsgToSession({ role:"user", text:rawMsg, time:t });
  autoScroll();

  // Wrapper bubble AI — langsung masuk DOM
  const wrap = document.createElement("div");
  wrap.className = "mm-debate-wrap";
  chatEl.appendChild(wrap);
  mmCurrentWrap = wrap; // so stopAI() knows which bubble to remove
  autoScroll();

  // ── Helper stop: abort semua fetch, hapus wrap, reset state ──
  function mmDoStop(){
    mmIsGenerating = false;
    mmStopRequested = false;
    if(mmController){ mmController.abort(); mmController = null; }
    // Hapus hanya gelembung saat ini
    if(wrap && wrap.parentNode) wrap.parentNode.removeChild(wrap);
    mmCurrentWrap = null;
    document.querySelectorAll(".mm-typing-entry").forEach(e => e.remove());
    stopBtn.style.display = "none";
    sendBtn.disabled = false;
    updateSend();
  }

  if(sig.aborted){ mmDoStop(); return; }

  // ── Header ──
  const hdr = document.createElement("div");
  hdr.className = "mm-debate-header";
  hdr.innerHTML = `<div class="mm-spinner"></div> MULTIMIND — Mengumpulkan Jawaban Awal...`;
  wrap.appendChild(hdr);

  // ── Phase chips ──
  const phasesEl = document.createElement("div");
  phasesEl.className = "mm-phases";
  phasesEl.innerHTML = `
    <span class="mm-phase-chip active"  id="mmph0_${uid}">Jawaban Awal</span>
    <span class="mm-phase-chip pending" id="mmph1_${uid}">Argumen</span>
    <span class="mm-phase-chip pending" id="mmph2_${uid}">Voting</span>
    <span class="mm-phase-chip pending" id="mmph3_${uid}">Hasil</span>`;
  wrap.appendChild(phasesEl);

  // ── Cards row ──
  const cardsRow = document.createElement("div");
  cardsRow.className = "mm-cards-row";
  const cardEls = {};
  MM_MODELS.forEach(api => {
    const card = document.createElement("div");
    card.className = `mm-model-card ${api}`;
    card.innerHTML = `
      <div class="mm-card-hdr"><div class="mm-cdot"></div>${MM_LABELS[api]}</div>
      <div class="mm-card-body" id="mmcard-${api}-${uid}">
        <div style="display:flex;gap:4px;align-items:center;padding:4px 0;opacity:0.5">
          <div class="td" style="width:5px;height:5px;border-radius:50%;background:currentColor;animation:tdA 1.3s ease-in-out infinite"></div>
          <div class="td" style="width:5px;height:5px;border-radius:50%;background:currentColor;animation:tdA 1.3s ease-in-out infinite;animation-delay:0.15s"></div>
          <div class="td" style="width:5px;height:5px;border-radius:50%;background:currentColor;animation:tdA 1.3s ease-in-out infinite;animation-delay:0.3s"></div>
        </div>
      </div>
      <div class="mm-card-vote" id="mmvote-${api}-${uid}" style="opacity:0"></div>`;
    cardsRow.appendChild(card);
    cardEls[api] = card;
  });
  wrap.appendChild(cardsRow);
  autoScroll();

  // ════════════════════════════════════════════
  // PHASE 1 — JAWABAN AWAL
  // Semua model fetch PARALEL bersamaan.
  // Tiap kartu LANGSUNG muncul begitu model-nya selesai — tidak nunggu semua.
  // Debat baru dimulai setelah SEMUA kartu selesai dirender.
  // ════════════════════════════════════════════
  const answers = {};

  // Fetch paralel — tiap model update kartunya sendiri segera setelah selesai
  await Promise.all(MM_MODELS.map(async api => {
    try {
      const r = await callAPISignal(api, rawMsg, [], sig);
      if(sig.aborted) return;
      const text = (r || "").trim();
      answers[api] = text;
      const body = document.getElementById(`mmcard-${api}-${uid}`);
      if(body){
        if(text){
          body.innerHTML = renderMessage(text);
        } else {
          body.innerHTML = `<div class="text" style="color:rgba(240,68,68,0.75)">Tidak ada respons</div>`;
        }
        autoScroll();
      }
    } catch(e) {
      if(sig.aborted) return;
      answers[api] = "";
      const body = document.getElementById("mmcard-" + api);
      if(body){
        body.innerHTML = `<div class="text" style="color:rgba(240,68,68,0.75)">Gagal: ${escHtml(e.message || "error")}</div>`;
        autoScroll();
      }
    }
  }));

  // Cek abort setelah semua fetch selesai
  if(sig.aborted){ mmDoStop(); return; }

  // Minimal 2 model harus berhasil sebelum lanjut
  const okCount = MM_MODELS.filter(a => answers[a] && answers[a].length > 0).length;
  if(okCount < 2){
    hdr.innerHTML = `⚠️ Tidak cukup model merespons untuk melanjutkan.`;
    mmIsGenerating = false;
    stopBtn.style.display = "none";
    sendBtn.disabled = false;
    updateSend();
    return;
  }

  // ════════════════════════════════════════════
  // PHASE 2 — DEBAT (1 putaran, tiap model 1 giliran)
  // Tidak ada ronde 1 / ronde 2 — cukup 1x tiap model
  // ════════════════════════════════════════════
  document.getElementById(`mmph0_${uid}`).className = "mm-phase-chip done";
  document.getElementById(`mmph1_${uid}`).className = "mm-phase-chip active";
  hdr.innerHTML = `<div class="mm-spinner"></div> MULTIMIND — Argumen...`;

  const debateLog = document.createElement("div");
  debateLog.className = "mm-debate-log";
  wrap.appendChild(debateLog);
  autoScroll();

  const allDebates = [];

  for(const api of MM_MODELS){
    if(sig.aborted){ mmDoStop(); return; }

    const typingEl = mmShowTyping(debateLog, api);

    const otherAnswers = MM_MODELS.filter(a => a !== api)
      .map(a => `- ${MM_LABELS[a]}: "${(answers[a]||"").substring(0,800)}"`)
      .join("\n");

    const debatePrompt =
      `Kamu adalah ${MM_LABELS[api]}, peserta debat AI.` +
      `\nPertanyaan user: "${rawMsg}"` +
      `\nJawabanmu: "${(answers[api]||"").substring(0,800)}"` +
      `\nJawaban model lain:\n${otherAnswers}` +
      `\n\nBerikan argumen mengapa jawabanmu lebih baik dari model lain. Kritik spesifik, sebut nama model. Maks 3 kalimat, langsung ke poin.`;

    try {
      const reply = await callAPISignal(api, debatePrompt, [], sig);
      if(sig.aborted){ typingEl.remove(); mmDoStop(); return; }
      typingEl.remove();
      const text = (reply||"").substring(0,600);
      mmAppendDebateEntry(debateLog, api, text, "");
      allDebates.push({ model:api, comment:text });
    } catch(e){
      typingEl.remove();
      if(sig.aborted){ mmDoStop(); return; }
      allDebates.push({ model:api, comment:"" });
    }
  }

  if(sig.aborted){ mmDoStop(); return; }

  // ════════════════════════════════════════════
  // PHASE 3 — VOTING
  // ════════════════════════════════════════════
  document.getElementById(`mmph1_${uid}`).className = "mm-phase-chip done";
  document.getElementById(`mmph2_${uid}`).className = "mm-phase-chip active";
  hdr.innerHTML = `<div class="mm-spinner"></div> MULTIMIND — Voting...`;

  const votingSection = document.createElement("div");
  votingSection.className = "mm-voting-section";
  votingSection.innerHTML = `
    <div class="mm-voting-title">Voting berlangsung...</div>
    <div class="mm-voting-bars" id="mmVoteBars_${uid}"></div>
    <div id="mmVoteLog_${uid}" style="margin-top:8px;display:flex;flex-direction:column;gap:5px"></div>`;
  wrap.appendChild(votingSection);
  autoScroll();

  const votes = { groq:0, qwen:0, glm:0, gpt:0 };
  const voteLog = document.getElementById(`mmVoteLog_${uid}`);
  const debateSummary = allDebates.map(d => `${MM_LABELS[d.model]}: "${(d.comment||"").substring(0,150)}"`).join("\n");

  for(const api of MM_MODELS){
    if(sig.aborted){ mmDoStop(); return; }

    const votePrompt =
      `Kamu adalah ${MM_LABELS[api]}. Pilih jawaban terbaik.` +
      `\nPertanyaan: "${rawMsg}"` +
      `\nJawaban:\n${MM_MODELS.map(a => `- ${MM_LABELS[a]}: "${(answers[a]||"").substring(0,500)}"`).join("\n")}` +
      `\nDebat:\n${debateSummary}` +
      `\n\nFormat WAJIB:\nVOTE: [NAMA MODEL]\nALASAN: [1 kalimat]\n\nPilihan: VOTE: QWEN / VOTE: AIVA / VOTE: GLM / VOTE: GPT-OSS`;

    try {
      const voteReply = await callAPISignal(api, votePrompt, [], sig);
      if(sig.aborted){ mmDoStop(); return; }

      const vUpper = (voteReply||"").toUpperCase();
      let picked = null;
      const vm = vUpper.match(/VOTE:\s*(QWEN|AIVA|GLM|GPT-OSS|GPT)/);
      if(vm){
        if(vm[1]==="QWEN") picked="groq";
        else if(vm[1]==="AIVA") picked="qwen";
        else if(vm[1]==="GLM") picked="glm";
        else if(vm[1]==="GPT-OSS"||vm[1]==="GPT") picked="gpt";
      }
      if(!picked){
        if(vUpper.includes("QWEN")) picked="groq";
        else if(vUpper.includes("AIVA")) picked="qwen";
        else if(vUpper.includes("GLM")) picked="glm";
        else if(vUpper.includes("GPT")) picked="gpt";
      }
      if(picked) votes[picked]++;

      const alasanM = (voteReply||"").match(/ALASAN:\s*(.+)/i);
      const alasan = alasanM ? alasanM[1].substring(0,120) : (voteReply||"").substring(0,100);

      const vEntry = document.createElement("div");
      vEntry.className = `mm-debate-entry ${api}`;
      vEntry.innerHTML = `
        <div class="mm-de-meta">
          <span class="mm-de-label">${MM_LABELS[api]}</span>
          <span class="mm-de-round" style="background:rgba(245,158,11,0.15);color:#f59e0b;border-color:rgba(245,158,11,0.3)">${picked ? "→ "+MM_LABELS[picked] : "?"}</span>
        </div>
        <div class="mm-de-text">${escHtml(alasan)}</div>`;
      voteLog.appendChild(vEntry);

      const totalNow = Object.values(votes).reduce((a,b)=>a+b,0)||1;
      const vbars = document.getElementById(`mmVoteBars_${uid}`);
      if(vbars){
        vbars.innerHTML = MM_MODELS.map(a => {
          const v=votes[a]; const pct=Math.round(v/totalNow*100);
          return `<div class="mm-vote-bar-row ${a}">
            <div class="mm-vote-bar-label">${MM_LABELS[a]}</div>
            <div class="mm-vote-bar-track"><div class="mm-vote-bar-fill" style="width:${pct}%"></div></div>
            <div class="mm-vote-score">${v}</div>
          </div>`;
        }).join("");
      }
      autoScroll();
    } catch(e){
      if(sig.aborted){ mmDoStop(); return; }
    }
  }

  if(sig.aborted){ mmDoStop(); return; }
  votingSection.querySelector(".mm-voting-title").textContent = "Hasil Voting";

  // ════════════════════════════════════════════
  // PHASE 4 — HASIL FINAL
  // ════════════════════════════════════════════
  document.getElementById(`mmph2_${uid}`).className = "mm-phase-chip done";
  document.getElementById(`mmph3_${uid}`).className = "mm-phase-chip active";

  const winner = MM_MODELS.reduce((a,b) => votes[a] >= votes[b] ? a : b);
  hdr.innerHTML = `MULTIMIND — Selesai! Pemenang: ${MM_LABELS[winner]}`;
  document.getElementById(`mmph3_${uid}`).className = "mm-phase-chip done";

  MM_MODELS.forEach(api => {
    const card = cardEls[api];
    if(!card) return;
    const voteEl = document.getElementById(`mmvote-${api}-${uid}`);
    const stars = "★".repeat(votes[api]) + "☆".repeat(Math.max(0,4-votes[api]));
    if(voteEl){ voteEl.style.opacity="1"; voteEl.innerHTML=`<span class="mm-vote-stars">${stars}</span> ${votes[api]} vote`; }
    if(api===winner){
      card.classList.add("winner");
      const cardHdr = card.querySelector(".mm-card-hdr");
      if(cardHdr && !cardHdr.querySelector(".mm-winner-badge"))
        cardHdr.innerHTML += `<span class="mm-winner-badge">WINNER</span>`;
    }
  });

  // Final content — pakai createElement agar renderMessage bisa sisipkan code box dengan benar
  const finalWrap = document.createElement("div");
  finalWrap.className = "mm-final-wrap";

  const finalLabel = document.createElement("div");
  finalLabel.className = "mm-final-label";
  finalLabel.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg> Jawaban Terpilih`;

  const finalContent = document.createElement("div");
  finalContent.className = "mm-final-content";
  finalContent.innerHTML = renderMessage(answers[winner] || "");

  const finalMeta = document.createElement("div");
  finalMeta.className = "mm-final-meta";
  finalMeta.innerHTML = `<span class="mm-winner-tag ${winner}">${MM_LABELS[winner]} — ${votes[winner]} votes</span><span style="color:var(--muted)">${getTime()}</span>`;

  finalWrap.appendChild(finalLabel);
  finalWrap.appendChild(finalContent);
  finalWrap.appendChild(finalMeta);

  // Disclaimer catatan voting
  const voteNote = document.createElement("div");
  voteNote.style.cssText = "margin-top:10px;padding:10px 14px;background:rgba(245,158,11,0.05);border:1px solid rgba(245,158,11,0.15);border-radius:10px;font-size:11px;color:rgba(221,227,242,0.5);line-height:1.65;display:flex;align-items:flex-start;gap:8px;";
  voteNote.innerHTML = `<span style="font-size:14px;flex-shrink:0;margin-top:1px">ℹ️</span><span><span style="color:rgba(245,158,11,0.7);font-weight:700;letter-spacing:0.3px;">Catatan Voting:</span> Hasil voting di atas adalah preferensi dari model-model AI itu sendiri — bukan penilaian mutlak. Kamu tetap bebas membaca semua jawaban dan menentukan mana yang paling tepat menurutmu.</span>`;
  finalWrap.appendChild(voteNote);

  wrap.appendChild(finalWrap);
  autoScroll();

  addMsgToSession({ role:"multimind-result", models:MM_MODELS, answers, votes, winner, debates:allDebates, time:getTime() });

  mmIsGenerating = false;
  mmController = null;
  stopBtn.style.display = "none";
  sendBtn.disabled = false;
  updateSend();
}


/* ======================== BOOT ======================== */
document.addEventListener("DOMContentLoaded", ()=>{
  sendBtn.addEventListener("click", send);
  updateSend();
  cvInit();
  updateMultiModelUI();
  updateModelSwitcherVisibility();
  updateModelDropdownActive();
});

// Also patch newChat to reset canvas when switching
const _origNewChat = newChat;
function newChat(){
  activeId = null;
  renderHistory();
  closeSidebar();
  if(chatMode === "multi"){
    if(canvas.world) cvClearCanvas();
    const wc = document.getElementById("canvasWelcome");
    if(wc){ wc.style.display = ""; wc.classList.remove("hiding"); wc._gone = false; }
    if(canvas.world) cvApplyTransform();
  } else if(chatMode === "multimind"){
    chatEl.innerHTML = "";
    buildMultiMindWelcome();
  } else {
    chatEl.innerHTML = "";
    buildWelcome();
  }
}

/* ════════════════════════════════════════════════════════
   NAME ONBOARDING
   ════════════════════════════════════════════════════════ */
function getAivaUserName(){ return localStorage.getItem("aivaUserName") || ""; }

/* ── Sidebar Profile ─────────────────────────────── */
const AVATAR_PALETTES = [
  {a:"#3d72f6",b:"#7248f5"},  // blue-purple
  {a:"#f05d23",b:"#f5485a"},  // orange-red
  {a:"#0fba81",b:"#0d8cf0"},  // teal-blue
  {a:"#c840e9",b:"#7248f5"},  // pink-purple
  {a:"#f5a623",b:"#f56323"},  // amber-orange
  {a:"#00c6ff",b:"#3d52f6"},  // cyan-blue
  {a:"#43e97b",b:"#38b2ac"},  // green-teal
  {a:"#f857a6",b:"#ff5858"},  // pink-red
];

function getAvatarPalette(name){
  if(!name) return AVATAR_PALETTES[0];
  const hash = name.split("").reduce((a,c)=>a+c.charCodeAt(0),0);
  return AVATAR_PALETTES[Math.abs(hash) % AVATAR_PALETTES.length];
}

function renderAvatar(name){
  const bgEl = document.getElementById("sbProfileAvatarBg");
  const initEl = document.getElementById("sbProfileInitials");
  if(!bgEl || !initEl) return;

  if(!name){ initEl.textContent = "?"; bgEl.style.background = "linear-gradient(135deg,#3d72f6,#7248f5)"; return; }

  const words = name.trim().split(/\s+/);
  let initials;
  if(words.length >= 2){
    initials = (words[0][0] + words[words.length-1][0]).toUpperCase();
  } else {
    initials = name.slice(0,2).toUpperCase();
  }
  initEl.textContent = initials;

  const {a,b} = getAvatarPalette(name);
  bgEl.style.background = `linear-gradient(145deg,${a},${b})`;

  // Glow warna sesuai palette
  const avatarEl = document.getElementById("sbProfileAvatar");
  if(avatarEl) avatarEl.style.boxShadow = `0 3px 16px ${a}55,0 0 0 1px ${a}33`;
}

let _lastSyncedName = null;
function initSbProfile(){
  const name = getAivaUserName();
  const nameEl = document.getElementById("sbProfileName");
  if(nameEl) nameEl.textContent = name || "Belum diset";
  renderAvatar(name);
  if(name && name !== _lastSyncedName){
    _lastSyncedName = name;
    syncDisplayNameToSupabase(name);
  }
}

let _sbAutoSaveTimer = null;

function toggleProfileEdit(e){
  if(e) e.stopPropagation();
  const section = document.getElementById("sbProfileSection");
  if(!section) return;
  const existing = section.querySelector(".sb-profile-edit-modal");
  if(existing){ existing.remove(); return; }

  const currentName = getAivaUserName();
  const modal = document.createElement("div");
  modal.className = "sb-profile-edit-modal";
  modal.innerHTML = `
    <div class="sb-profile-edit-header">
      <div class="sb-profile-edit-headleft">
        <div class="sb-profile-edit-dot"></div>
        <div class="sb-profile-edit-title">Ganti Nama</div>
      </div>
      <div class="sb-profile-edit-autosave" id="sbAutoSaveLabel">auto-save</div>
    </div>
    <input class="sb-profile-edit-input" id="sbProfileEditInput" type="text"
      placeholder="Ketik nama kamu…" value="${currentName.replace(/"/g,'&quot;')}" maxlength="32" autocomplete="off" spellcheck="false">
    <div class="sb-profile-edit-hint">Tekan <span>Enter</span> untuk simpan · <span>Esc</span> untuk tutup</div>`;
  section.appendChild(modal);

  const input = modal.querySelector("#sbProfileEditInput");
  setTimeout(()=>{ if(input){ input.focus(); input.select(); } }, 60);

  // Auto-save saat ngetik (debounce 500ms)
  input.addEventListener("input", ()=>{
    const label = document.getElementById("sbAutoSaveLabel");
    if(label){ label.textContent = "menyimpan…"; label.classList.remove("saved"); }
    clearTimeout(_sbAutoSaveTimer);
    _sbAutoSaveTimer = setTimeout(()=>{
      const val = input.value.trim();
      if(val){
        localStorage.setItem("aivaUserName", val);
        localStorage.setItem("aivaNameSet","1");
        initSbProfile();
        if(label){ label.textContent = "✓ tersimpan"; label.classList.add("saved"); }
        setTimeout(()=>{ if(label){ label.textContent="auto-save"; label.classList.remove("saved"); } }, 1800);
      }
    }, 500);
  });

  input.addEventListener("keydown", e2=>{
    if(e2.key==="Enter"){
      const val = input.value.trim();
      if(val){
        clearTimeout(_sbAutoSaveTimer);
        localStorage.setItem("aivaUserName", val);
        localStorage.setItem("aivaNameSet","1");
        initSbProfile();
      }
      closeSbProfileEdit();
    }
    if(e2.key==="Escape") closeSbProfileEdit();
  });

  setTimeout(()=>{
    document.addEventListener("click", function outsideHandler(ev){
      if(!section.contains(ev.target)){
        // Auto-save sisa input sebelum tutup
        const inp = document.getElementById("sbProfileEditInput");
        if(inp){ const v=inp.value.trim(); if(v){ clearTimeout(_sbAutoSaveTimer); localStorage.setItem("aivaUserName",v); localStorage.setItem("aivaNameSet","1"); initSbProfile(); } }
        closeSbProfileEdit();
        document.removeEventListener("click", outsideHandler);
      }
    });
  }, 120);
}

function saveSbProfileName(){
  const input = document.getElementById("sbProfileEditInput");
  if(!input) return;
  const name = input.value.trim();
  if(!name) return;
  clearTimeout(_sbAutoSaveTimer);
  localStorage.setItem("aivaUserName", name);
  localStorage.setItem("aivaNameSet", "1");
  closeSbProfileEdit();
  initSbProfile();
}

function closeSbProfileEdit(){
  clearTimeout(_sbAutoSaveTimer);
  const section = document.getElementById("sbProfileSection");
  if(!section) return;
  const modal = section.querySelector(".sb-profile-edit-modal");
  if(modal) modal.remove();
}

function showNameScreen(){
  const ns = document.getElementById("nameScreen");
  if(!ns) return;

  // Buat flash overlay untuk transisi keluar nanti
  if(!document.getElementById("nsFlash")){
    const fl=document.createElement("div"); fl.id="nsFlash";
    document.body.appendChild(fl);
  }

  requestAnimationFrame(()=>requestAnimationFrame(()=>{
    ns.classList.add("ns-show");
    startNameCanvas();

    // Sweep beam — efek cahaya menyapu saat name screen muncul
    const sweep=document.createElement("div"); sweep.className="ns-sweep";
    ns.appendChild(sweep);
    setTimeout(()=>{ if(sweep.parentNode) sweep.remove(); }, 1300);

    setTimeout(()=>{ const i=document.getElementById("nameInput"); if(i) i.focus(); }, 700);
  }));

  const btn=document.getElementById("nameBtn"), inp=document.getElementById("nameInput");
  if(btn) btn.addEventListener("click", submitName);
  if(inp) inp.addEventListener("keydown", e=>{ if(e.key==="Enter") submitName(); });
}

function submitName(){
  const inp=document.getElementById("nameInput");
  const name=(inp?inp.value:"").trim();
  if(!name){
    if(inp){
      inp.classList.remove("ns-shake"); void inp.offsetWidth;
      inp.classList.add("ns-shake");
      const prev=inp.placeholder;
      inp.placeholder="Nama tidak boleh kosong!";
      setTimeout(()=>{ inp.classList.remove("ns-shake"); inp.placeholder=prev; }, 500);
    }
    return;
  }
  localStorage.setItem("aivaUserName", name);
  localStorage.setItem("aivaNameSet", "1");
  const btn=document.getElementById("nameBtn");
  if(btn){ btn.disabled=true; btn.textContent="Masuk ke AIVA…"; }
  initSbProfile();
  exitNameScreen();
}

function exitNameScreen(){
  const ns=document.getElementById("nameScreen");
  const ripple=document.getElementById("nsRipple");
  const flash=document.getElementById("nsFlash");
  if(!ns) return;

  // 1. Ripple meluas dari tombol
  const btn=document.getElementById("nameBtn");
  if(btn && ripple){
    const r=btn.getBoundingClientRect();
    ripple.style.left=(r.left+r.width/2)+"px";
    ripple.style.top=(r.top+r.height/2)+"px";
    ripple.classList.add("ns-ripple-go");
  }

  // 2. Konten fade out
  const cont=ns.querySelector(".ns-content");
  if(cont){
    cont.style.transition="opacity 0.22s ease, transform 0.22s ease";
    cont.style.opacity="0"; cont.style.transform="scale(1.06) translateY(-12px)";
  }

  // 3. Flash bright ke seluruh layar — portal effect
  setTimeout(()=>{
    if(flash){ flash.classList.add("on"); }
    setTimeout(()=>{
      ns.classList.add("ns-out");
      if(flash){ flash.classList.remove("on"); flash.classList.add("off"); }
      setTimeout(()=>{
        ns.remove();
        if(ripple) ripple.remove();
        if(flash) flash.remove();
      }, 750);
    }, 220);
  }, 200);
}

function startNameCanvas(){
  const canvas=document.getElementById("nameCanvas"); if(!canvas) return;
  const ctx=canvas.getContext("2d");
  let W,H;
  function resize(){ W=canvas.width=window.innerWidth; H=canvas.height=window.innerHeight; }
  resize(); window.addEventListener("resize", resize);

  // Aurora wave layers — each is a flowing horizontal band
  const layers=[
    {yF:.26,aF:.10,spd:.00037,frq:.0024,ph:0.0, hue:258,sat:80,al:.21,thF:.20},
    {yF:.43,aF:.12,spd:.00049,frq:.0030,ph:2.1, hue:192,sat:85,al:.17,thF:.18},
    {yF:.58,aF:.09,spd:.00041,frq:.0020,ph:4.2, hue:283,sat:75,al:.14,thF:.15},
    {yF:.73,aF:.11,spd:.00064,frq:.0035,ph:1.4, hue:167,sat:80,al:.11,thF:.13},
  ];

  // Rising glow particles
  const PTS=78, pts=Array.from({length:PTS},()=>({
    x:Math.random()*(W||800), y:Math.random()*(H||600),
    r:Math.random()*1.7+.4,
    vy:-(Math.random()*.45+.15), vx:(Math.random()-.5)*.14,
    hue:180+Math.random()*120,
    alpha:Math.random()*.3, maxA:Math.random()*.5+.2,
    wob:Math.random()*Math.PI*2,
  }));

  let t=0;
  function drawLayer(l){
    const yB=H*l.yF, amp=H*l.aF, th=H*l.thF;
    ctx.beginPath();
    for(let x=0;x<=W+3;x+=3){
      const y=yB+Math.sin(x*l.frq+t*l.spd+l.ph)*amp
               +Math.cos(x*l.frq*.65+t*l.spd*1.4+l.ph*.5)*amp*.35;
      x===0?ctx.moveTo(x,y):ctx.lineTo(x,y);
    }
    for(let x=W;x>=0;x-=3){
      const y=yB+th+Math.sin(x*l.frq+t*l.spd+l.ph+.45)*amp*.55
               +Math.cos(x*l.frq*.65+t*l.spd*1.4+l.ph*.5+.22)*amp*.25;
      ctx.lineTo(x,y);
    }
    ctx.closePath();
    const g=ctx.createLinearGradient(0,yB-amp,0,yB+th+amp);
    g.addColorStop(0,   `hsla(${l.hue},${l.sat}%,68%,0)`);
    g.addColorStop(.22, `hsla(${l.hue},${l.sat}%,68%,${l.al})`);
    g.addColorStop(.58, `hsla(${l.hue},${l.sat}%,68%,${l.al*.82})`);
    g.addColorStop(1,   `hsla(${l.hue},${l.sat}%,68%,0)`);
    ctx.fillStyle=g; ctx.fill();
  }

  function drawNC(){
    ctx.clearRect(0,0,W,H); t++;
    for(const l of layers) drawLayer(l);
    for(const p of pts){
      p.x+=p.vx+Math.sin(t*.015+p.wob)*.18; p.y+=p.vy;
      if(p.y/H<.12) p.alpha-=.014;
      else p.alpha=Math.min(p.maxA,p.alpha+.009);
      if(p.y<-8){p.y=H+5;p.x=Math.random()*W;p.alpha=0;p.hue=180+Math.random()*120;}
      if(p.alpha>0){
        ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2);
        ctx.fillStyle=`hsla(${p.hue},80%,78%,${p.alpha})`; ctx.fill();
      }
    }
    if(document.getElementById("nameScreen")) requestAnimationFrame(drawNC);
  }
  requestAnimationFrame(drawNC);
}

/* ════════════════════════════════════════════════════════
   ANTI SCRAPE / ANTI DEVTOOLS PROTECTION
   ════════════════════════════════════════════════════════ */
(function(){
  // ── Disable right click ──────────────────────────────
  document.addEventListener('contextmenu', function(e){ e.preventDefault(); return false; });

  // ── Block keyboard shortcuts ─────────────────────────
  document.addEventListener('keydown', function(e){
    // F12
    if(e.key === 'F12'){ e.preventDefault(); return false; }
    // Ctrl+Shift+I / J / C / K (DevTools)
    if(e.ctrlKey && e.shiftKey && ['I','i','J','j','C','c','K','k'].includes(e.key)){
      e.preventDefault(); return false;
    }
    // Ctrl+U (View Source)
    if(e.ctrlKey && (e.key === 'u' || e.key === 'U')){ e.preventDefault(); return false; }
    // Ctrl+S (Save page)
    if(e.ctrlKey && (e.key === 's' || e.key === 'S')){ e.preventDefault(); return false; }
  });

  // ── Console warning + clear ──────────────────────────
  var _consoleWarn = function(){
    console.clear();
    console.log(
      '%cSTOP!',
      'color:#ef4444;font-size:52px;font-weight:900;text-shadow:0 2px 8px rgba(0,0,0,0.3)'
    );
    console.log(
      '%cFitur ini untuk developer. Jika seseorang menyuruhmu paste sesuatu di sini, itu scam.',
      'font-size:15px;color:#fbbf24;font-weight:600'
    );
    console.log(
      '%cAIVA by OpetxDy — © 2025',
      'font-size:12px;color:#6b7280;margin-top:4px'
    );
  };
  _consoleWarn();
  setInterval(_consoleWarn, 2000);

  // ── DevTools size detection ──────────────────────────
  var _devCheck = function(){
    var threshold = 160;
    var widthDiff  = window.outerWidth  - window.innerWidth;
    var heightDiff = window.outerHeight - window.innerHeight;
    if(widthDiff > threshold || heightDiff > threshold){
      // Blur content when devtools open
      document.body.style.filter = 'blur(8px)';
      document.body.style.pointerEvents = 'none';
      var _warn = document.getElementById('_devWarnOverlay');
      if(!_warn){
        _warn = document.createElement('div');
        _warn.id = '_devWarnOverlay';
        _warn.style.cssText = 'position:fixed;inset:0;z-index:9999999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.85);backdrop-filter:blur(4px);';
        _warn.innerHTML = '<div style="text-align:center;color:#fff;padding:40px;"><div style="font-size:48px;margin-bottom:16px">⚠️</div><div style="font-size:22px;font-weight:800;margin-bottom:8px;">DevTools Terdeteksi</div><div style="font-size:14px;opacity:0.7;">Tutup DevTools untuk melanjutkan</div></div>';
        document.body.appendChild(_warn);
      }
      _warn.style.display = 'flex';
    } else {
      document.body.style.filter = '';
      document.body.style.pointerEvents = '';
      var _warn = document.getElementById('_devWarnOverlay');
      if(_warn) _warn.style.display = 'none';
    }
  };
  setInterval(_devCheck, 800);

  // ── Disable drag/select on UI ────────────────────────
  document.addEventListener('dragstart', function(e){ e.preventDefault(); });
  document.addEventListener('selectstart', function(e){
    // Allow select inside input/textarea
    if(e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    e.preventDefault();
  });
})();
