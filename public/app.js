// ─── Constants ────────────────────────────────────────────────────────────────
const API = "";

const SENDER_FIELDS = ["name","role","offer","valueProp","proof","cta","tone"];

const APEX_SENDER = {
  name: "Shantanu",
  role: "Founder, Apex Growth Partners",
  offer: "We help founder-led B2B companies between 30–200 crore scale revenue without adding founder dependency.",
  valueProp: "We build the systems, team structures, and sales processes that let a founder step back without the business slowing down.",
  proof: "Helped founder-led manufacturing and services companies unlock the next stage of growth.",
  cta: "15-minute conversation to see if there's a fit",
  tone: "Peer-to-peer — like a smart colleague who genuinely gets it",
};

const ICP_FIELDS = [
  "seedDescription","roleSeniority","companyStageSize","responsibilityScope",
  "empathySayLoud","empathyThinkPrivately","empathyActuallyDo","empathyFeel",
  "pains","fears","frustrations","dreamOutcomes",
];

const APEX_ICP = {
  seedDescription: "Founders of a 50 crore B2B company, typically manufacturing, real estate, or expert-led B2B services like CA firms, architecture firms, and similar businesses.",
  roleSeniority: "Founder and Managing Director.",
  companyStageSize: "Post-survival SME with 50 crore annual turnover, transitioning from owner-led survival to professional management.",
  responsibilityScope: "Accountable for topline growth, major client relationships, high-level bank and investor relations, and capital allocation for expansion.",
  empathySayLoud: "We have the best product and service in the market, but sales is not consistent enough.\nGood talent is hard to find and harder to keep.\nThe way we did things at 5 crore will not get us to 100 crore.",
  empathyThinkPrivately: "If I stop pushing for one week, will the momentum disappear?\nI am paying senior managers well, but am I still doing their work?\nMy competitors are younger and using technology better than I am.",
  empathyActuallyDo: "Intervenes in sales meetings because they do not fully trust the team.\nChecks bank balances and receivables personally.\nManages key projects through WhatsApp groups, verbal instructions, and trusted loyalists.",
  empathyFeel: "Feels the heavy weight of being the sole growth engine.\nFeels proud of the business, but quietly exhausted.\nFeels anxious that the market is changing faster than internal processes can adapt.",
  pains: "Revenue is stuck at a plateau and every new crore feels harder to earn.\nHigh dependency on the founder for major decisions.\nCash flow gaps despite a healthy order book.\nInability to attract and retain high-quality professional leadership.",
  fears: "The business may collapse or shrink if they step away for health or personal reasons.\nA smarter, tech-enabled competitor may steal key accounts.\nThey may be exposed as a small-time player when trying to win enterprise clients.\nTheir reputation for quality may erode as the company scales.",
  frustrations: "Spending most of the day firefighting instead of thinking strategically.\nThe team keeps making the same mistakes despite repeated instructions.\nData is scattered across spreadsheets, paper files, and people's heads.\nSales cycles are lengthening without a clear reason.",
  dreamOutcomes: "A dashboard that shows real-time business health without asking five people for reports.\nA self-managing leadership team that brings solutions, not just problems.\nPredictable month-on-month growth that does not require founder intervention.\nFreedom to spend time on expansion, new ventures, or family while the business grows.",
};

// ─── Utility ──────────────────────────────────────────────────────────────────
const $  = (id) => document.getElementById(id);
function post(path, body) {
  return fetch(API + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => r.json());
}
function get(path) { return fetch(API + path).then((r) => r.json()); }

// ─── API Status ───────────────────────────────────────────────────────────────
async function checkApiStatus() {
  try {
    const s = await get("/api/status");
    const keys = ["openai", "apollo", "perplexity"];
    const missing = [];
    keys.forEach((k) => {
      const pill = $(`sdot-${k}`);
      if (pill) pill.className = "spill" + (s[k] ? " on" : "");
      if (!s[k]) missing.push(k.toUpperCase() + "_API_KEY");
    });
    const missingEl = $("sbMissing");
    if (missingEl) missingEl.textContent = missing.length ? "Missing: " + missing.join(", ") : "";
    updateCounters();
  } catch (e) { console.warn("Status check failed:", e.message); }
}

function updateCounters() {
  const dossiers = parseInt(localStorage.getItem("apex.dossierCount") || "0", 10);
  const drafts   = parseInt(localStorage.getItem("apex.draftCount")   || "0", 10);
  const p = $("ctr-prospects"); if (p) p.textContent = "0 prospects";
  const d = $("ctr-dossiers");  if (d) d.textContent = `${dossiers} dossier${dossiers !== 1 ? "s" : ""}`;
  const r = $("ctr-drafts");    if (r) r.textContent = `${drafts} drafts ready`;
}

// ─── Tab navigation ───────────────────────────────────────────────────────────
function switchTab(tabId) {
  document.querySelectorAll(".nav-item").forEach((b) => {
    b.classList.toggle("active", b.dataset.tab === tabId);
  });
  document.querySelectorAll(".tab-panel").forEach((p) => {
    p.classList.toggle("active", p.id === `tab-${tabId}`);
  });
}
function wireTabs() {
  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });
}

// ─── ICP Builder ──────────────────────────────────────────────────────────────
function loadSavedIcp() {
  try {
    const saved = JSON.parse(localStorage.getItem("apex.icp") || "{}");
    ICP_FIELDS.forEach((f) => {
      const inp = $(`icp-${f}`);
      if (inp && saved[f]) inp.value = saved[f];
    });
  } catch {}
}

function saveIcp() {
  const data = {};
  ICP_FIELDS.forEach((f) => { const inp = $(`icp-${f}`); if (inp) data[f] = inp.value; });
  localStorage.setItem("apex.icp", JSON.stringify(data));
  const note = $("icpSavedNote");
  note.classList.add("show");
  setTimeout(() => note.classList.remove("show"), 2000);
}

function getIcp() {
  const data = {};
  ICP_FIELDS.forEach((f) => { const inp = $(`icp-${f}`); if (inp) data[f] = inp.value; });
  return data;
}

function fillIcpFromObj(obj) {
  ICP_FIELDS.forEach((f) => {
    const inp = $(`icp-${f}`);
    if (inp && obj[f]) inp.value = obj[f];
  });
}

async function fillSingleField(field, seed) {
  try {
    const { value, error } = await post("/api/icp/fill", { field, description: seed });
    if (error) { alert("Error: " + error); return; }
    const inp = $(`icp-${field}`);
    if (inp && value) inp.value = value;
  } catch (e) { alert("Network error: " + e.message); }
}

function wireIcp() {
  loadSavedIcp();

  $("icpFillBtn").addEventListener("click", async () => {
    const seed = $("icp-seedDescription").value.trim();
    if (!seed) { alert("Enter a Seed Description first, then click Generate all fields."); return; }
    const btn = $("icpFillBtn");
    btn.textContent = "Generating…"; btn.disabled = true;
    try {
      const { icp, error } = await post("/api/icp/fill", { description: seed });
      if (error) { alert("Error: " + error); return; }
      fillIcpFromObj(icp);
    } catch (e) { alert("Network error: " + e.message); }
    finally { btn.textContent = "Generate all fields"; btn.disabled = false; }
  });

  document.querySelectorAll(".btn-ai[data-field]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const field = btn.dataset.field;
      const seed  = $("icp-seedDescription").value.trim();
      if (!seed) { alert("Enter a Seed Description first."); return; }
      const orig = btn.textContent;
      btn.textContent = "…"; btn.disabled = true;
      await fillSingleField(field, seed);
      btn.textContent = orig; btn.disabled = false;
    });
  });

  $("icpSaveBtn").addEventListener("click", saveIcp);
  $("icpClearBtn").addEventListener("click", () => {
    ICP_FIELDS.forEach((f) => { const inp = $(`icp-${f}`); if (inp) inp.value = ""; });
  });
}

// ─── Sender Profile ───────────────────────────────────────────────────────────
function getSender() {
  const data = {};
  SENDER_FIELDS.forEach((f) => { const inp = $(`sender-${f}`); if (inp) data[f] = inp.value || ""; });
  return data;
}

function loadSavedSender() {
  try {
    const saved = JSON.parse(localStorage.getItem("apex.sender") || "{}");
    const src = Object.keys(saved).length ? saved : APEX_SENDER;
    SENDER_FIELDS.forEach((f) => { const inp = $(`sender-${f}`); if (inp && src[f]) inp.value = src[f]; });
  } catch {}
}

function saveSender() {
  localStorage.setItem("apex.sender", JSON.stringify(getSender()));
  const note = $("senderSavedNote");
  note.classList.add("show");
  setTimeout(() => note.classList.remove("show"), 2000);
}

function wireSender() {
  loadSavedSender();
  $("saveSenderBtn").addEventListener("click", saveSender);
  // File picker label
  $("profileFile").addEventListener("change", () => {
    const file = $("profileFile").files[0];
    $("profileFileName").textContent = file ? file.name : "";
  });

  // Extract profile from URL or file
  $("extractProfileBtn").addEventListener("click", async () => {
    const url = $("profileUrl").value.trim();
    const file = $("profileFile").files[0];
    const status = $("extractStatus");

    if (!url && !file) {
      status.textContent = "Paste a URL or select a file first.";
      status.className = "extract-status error";
      status.classList.remove("hidden");
      return;
    }

    status.textContent = "Reading content and extracting profile…";
    status.className = "extract-status loading";
    status.classList.remove("hidden");
    $("extractProfileBtn").disabled = true;

    try {
      let body = {};
      if (file) {
        let text = "";
        const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
        if (isPdf && typeof pdfjsLib !== "undefined") {
          try {
            pdfjsLib.GlobalWorkerOptions.workerSrc =
              "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
            const arrayBuffer = await file.arrayBuffer();
            const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
            const pages = [];
            for (let i = 1; i <= Math.min(pdf.numPages, 30); i++) {
              const page = await pdf.getPage(i);
              const content = await page.getTextContent();
              pages.push(content.items.map((it) => it.str).join(" "));
            }
            text = pages.join("\n");
          } catch (pdfErr) {
            // Fall back to raw text if PDF.js fails
            text = await file.text();
          }
        } else {
          text = await file.text();
        }
        body = { fileContent: text, fileName: file.name };
      } else {
        body = { url };
      }

      const { profile, error } = await post("/api/profile/extract", body);

      if (error) {
        status.textContent = "Could not extract profile: " + error;
        status.className = "extract-status error";
        return;
      }

      // Fill fields — only overwrite if extracted value is non-empty
      const map = { name: "name", role: "role", offer: "offer", valueProp: "valueProp", proof: "proof", cta: "cta", tone: null };
      let filled = 0;
      SENDER_FIELDS.forEach((f) => {
        if (f === "tone") return; // tone is a select — skip auto-fill
        const el = $(`sender-${f}`);
        if (el && profile[f] && profile[f].trim()) { el.value = profile[f].trim(); filled++; }
      });

      status.textContent = filled > 0
        ? `Profile extracted — ${filled} field${filled > 1 ? "s" : ""} filled. Review and save.`
        : "Extracted but no clear profile data found. Try a different URL or file.";
      status.className = filled > 0 ? "extract-status success" : "extract-status error";
    } catch (e) {
      status.textContent = "Network error: " + e.message;
      status.className = "extract-status error";
    } finally {
      $("extractProfileBtn").disabled = false;
    }
  });
}

// ─── Supabase CRM ─────────────────────────────────────────────────────────────
const MEMORY_KEY = "apex.prospectMemory";
let _sb = null;
let _crmFilter = "all";
let _crmProspects = [];
let _userId = null;
let _appBooted = false;

async function initSupabase() {
  if (typeof supabase === "undefined") { bootApp(); return; }
  try {
    const cfg = await get("/api/config");
    if (!cfg.supabaseUrl || !cfg.supabaseKey) { bootApp(); return; }
    _sb = supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey);

    _sb.auth.onAuthStateChange(async (event, session) => {
      if (event === "SIGNED_IN" && session) {
        await handleAuthSession(session);
      } else if (event === "SIGNED_OUT") {
        _userId = null; _appBooted = false; _crmProspects = [];
        showLoginScreen();
      }
    });

    const { data: { session } } = await _sb.auth.getSession();
    if (session) {
      await handleAuthSession(session);
    } else {
      showLoginScreen();
    }
  } catch { bootApp(); }
}

async function handleAuthSession(session) {
  _userId = session.user.id;
  const email = session.user.email;
  if (email !== "shantanuap@gmail.com") {
    const { data } = await _sb.from("approved_users").select("email").eq("email", email).maybeSingle();
    if (!data) { showNotApprovedScreen(email); return; }
  }
  await crmLoad();
  bootApp(session);
}

function bootApp(session) {
  if (_appBooted) return;
  _appBooted = true;
  document.getElementById("loginOverlay")?.classList.add("hidden");
  if (session) {
    const el = document.getElementById("sbUserEmail");
    if (el) el.textContent = session.user.email;
    const sbUser = document.getElementById("sbUserInfo");
    if (sbUser) sbUser.classList.remove("hidden");
  }
  const signoutBtn = document.getElementById("sbSignOut");
  if (signoutBtn) signoutBtn.addEventListener("click", () => _sb?.auth.signOut());
  wireTabs();
  wireSender();
  wireIcp();
  wireChain();
  wireMemory();
  checkApiStatus();
  setInterval(checkApiStatus, 30000);
  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.dataset.tab === "campaigns") renderMemoryList();
    });
  });
}

function showLoginScreen() {
  const overlay = document.getElementById("loginOverlay");
  if (!overlay) return;
  overlay.className = "login-overlay lp-mode";

  const googleSvg = `<svg width="18" height="18" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
  </svg>`;

  overlay.innerHTML = `
    <div class="lp-page">
      <nav class="lp-nav">
        <div class="lp-nav-brand">
          <div class="lp-logo-icon">P</div>
          <div class="lp-nav-name">Predictable Revenue OS</div>
        </div>
        <button class="btn-google btn-google-nav" id="googleSignInBtn">${googleSvg} Sign in</button>
      </nav>

      <section class="lp-hero">
        <div class="lp-eyebrow">B2B OUTREACH INTELLIGENCE</div>
        <h1 class="lp-h1">Future Proof Your Enterprise.</h1>
        <p class="lp-hero-body">Predictable Revenue helps you acquire high-value customers on demand.<br>10X faster and cheaper.</p>
        <div class="lp-hero-cta">
          <button class="btn-google btn-google-lg" id="googleSignInBtnHero">${googleSvg} Get Access — Sign in with Google</button>
          <p class="lp-hero-note">Invite-only · Access approved by admin</p>
        </div>
      </section>

      <section class="lp-section">
        <div class="lp-section-inner">
          <div class="lp-section-label">THE PROBLEM</div>
          <h2 class="lp-section-h2">Enterprise sales is broken.</h2>
          <div class="lp-cards">
            <div class="lp-card">
              <div class="lp-card-num">01</div>
              <h3>Research takes hours, not minutes</h3>
              <p>Sales teams spend 70% of their time on admin and research. By the time they reach out, the moment has passed.</p>
            </div>
            <div class="lp-card">
              <div class="lp-card-num">02</div>
              <h3>Generic outreach gets ignored</h3>
              <p>"Hi [First Name], I noticed your company…" — enterprise buyers delete 90% of cold outreach before reading line two.</p>
            </div>
            <div class="lp-card">
              <div class="lp-card-num">03</div>
              <h3>Revenue stays unpredictable</h3>
              <p>Without a system, you get feast or famine. Great months followed by pipeline droughts. No compound effect.</p>
            </div>
          </div>
        </div>
      </section>

      <section class="lp-section lp-section-alt">
        <div class="lp-section-inner">
          <div class="lp-section-label">HOW IT WORKS</div>
          <h2 class="lp-section-h2">One system. Predictable results.</h2>
          <div class="lp-steps">
            <div class="lp-step">
              <div class="lp-step-num">1</div>
              <div class="lp-step-body">
                <h3>Deep Prospect Research</h3>
                <p>AI builds a 360° dossier on every target — their products, recent moves, career history, and real pains — in minutes, not hours. Your reps spend time selling, not searching.</p>
              </div>
            </div>
            <div class="lp-step">
              <div class="lp-step-num">2</div>
              <div class="lp-step-body">
                <h3>Hyper-Personalised Outreach</h3>
                <p>Messages that reference their actual product names, company milestones, and specific pains. The kind that stops a senior buyer cold — and makes them reply.</p>
              </div>
            </div>
            <div class="lp-step">
              <div class="lp-step-num">3</div>
              <div class="lp-step-body">
                <h3>Compound Cadences</h3>
                <p>8-touch sequences across email, LinkedIn, and WhatsApp. Each touch gives before it asks. The system compounds — every campaign gets sharper over time.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section class="lp-section lp-final-cta">
        <div class="lp-section-inner lp-cta-center">
          <h2 class="lp-section-h2">Ready to build a predictable revenue engine?</h2>
          <p class="lp-cta-sub">Join the waitlist. Access is approved by invite only.</p>
          <button class="btn-google btn-google-lg" id="googleSignInBtnCta">${googleSvg} Get Access — Sign in with Google</button>
        </div>
      </section>

      <footer class="lp-footer">
        <span>© 2025 Predictable Revenue OS</span>
        <span>Powered by AI · Built for enterprise sales teams</span>
      </footer>
    </div>
    <p id="loginMsg" class="lp-toast"></p>`;

  const handleSignIn = async () => {
    const msg = document.getElementById("loginMsg");
    if (msg) msg.textContent = "Redirecting to Google…";
    await _sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin } });
  };
  document.getElementById("googleSignInBtn").addEventListener("click", handleSignIn);
  document.getElementById("googleSignInBtnHero").addEventListener("click", handleSignIn);
  document.getElementById("googleSignInBtnCta").addEventListener("click", handleSignIn);
}

function showNotApprovedScreen(email) {
  const overlay = document.getElementById("loginOverlay");
  if (!overlay) return;
  overlay.className = "login-overlay";
  overlay.innerHTML = `
    <div class="login-card">
      <div class="login-logo">P</div>
      <div class="login-brand">Predictable Revenue OS</div>
      <p class="login-sub">Access pending approval</p>
      <p class="login-msg" style="margin-top:12px">Signed in as <strong>${email}</strong>.<br>Your account hasn't been approved yet.<br>Contact Shantanu to get access.</p>
      <button id="signOutBtn" class="btn btn-outline btn-sm" style="margin-top:20px">Sign out</button>
    </div>`;
  document.getElementById("signOutBtn").addEventListener("click", () => _sb.auth.signOut());
}

async function crmLoad() {
  if (_sb) {
    const { data, error } = await _sb
      .from("prospects")
      .select("*")
      .order("updated_at", { ascending: false });
    if (!error && data) { _crmProspects = data; return; }
  }
  // localStorage fallback — map old format to flat CRM shape
  const legacy = JSON.parse(localStorage.getItem(MEMORY_KEY) || "[]");
  _crmProspects = legacy.map((e) => ({
    id: e.id,
    created_at: e.savedAt,
    updated_at: e.updatedAt || e.savedAt,
    name: e.prospect?.name || "",
    company: e.prospect?.company || "",
    title: e.prospect?.title || "",
    email: e.prospect?.email || "",
    phone: e.prospect?.phone || "",
    linkedin_url: e.prospect?.linkedin || "",
    domain: e.prospect?.domain || "",
    status: e.status || "active",
    current_touch: e.currentTouch || 0,
    notes: e.notes || "",
    next_action: e.nextAction || "",
    next_action_date: e.nextActionDate || null,
    snapshot: e.snapshot || "",
    dossier: e.dossier || "",
    emails: e.emails || null,
    linkedin_messages: e.linkedin || "",
    cadence: e.followup || "",
    objection_response: e.objection || "",
  }));
}

async function saveProspectToMemory(prospect, update) {
  const patch = {};
  if (update.snapshot !== undefined)  patch.snapshot = update.snapshot;
  if (update.dossier  !== undefined)  patch.dossier  = update.dossier;
  if (update.emails   !== undefined)  patch.emails   = update.emails;
  if (update.linkedin !== undefined)  patch.linkedin_messages = update.linkedin;
  if (update.followup !== undefined)  patch.cadence  = update.followup;
  if (update.objection !== undefined) patch.objection_response = update.objection;

  const base = {
    name: prospect.name || "", company: prospect.company || "",
    title: prospect.title || "", email: prospect.email || "",
    phone: prospect.phone || "", linkedin_url: prospect.linkedin || "",
    domain: prospect.domain || "",
    ...(_userId ? { user_id: _userId } : {}),
    ...patch,
  };

  const existing = _crmProspects.find((p) =>
    (prospect.domain && p.domain === prospect.domain) ||
    (p.name === prospect.name && p.company === prospect.company)
  );

  if (_sb) {
    if (existing) {
      const { data } = await _sb.from("prospects")
        .update({ ...base, updated_at: new Date().toISOString() })
        .eq("id", existing.id).select().single();
      if (data) { const i = _crmProspects.findIndex((p) => p.id === existing.id); if (i >= 0) _crmProspects[i] = data; }
      return existing.id;
    } else {
      const { data } = await _sb.from("prospects")
        .insert({ ...base, status: "active", current_touch: 0 }).select().single();
      if (data) _crmProspects.unshift(data);
      return data?.id;
    }
  }

  // localStorage fallback
  const all = JSON.parse(localStorage.getItem(MEMORY_KEY) || "[]");
  if (existing) {
    const i = all.findIndex((e) => e.id === existing.id);
    if (i >= 0) {
      if (update.emails)    all[i].emails    = update.emails;
      if (update.linkedin)  all[i].linkedin  = update.linkedin;
      if (update.followup)  all[i].followup  = update.followup;
      if (update.objection) all[i].objection = update.objection;
      if (update.snapshot)  all[i].snapshot  = update.snapshot;
      if (update.dossier)   all[i].dossier   = update.dossier;
      all[i].updatedAt = new Date().toISOString();
      const ci = _crmProspects.findIndex((p) => p.id === existing.id);
      if (ci >= 0) Object.assign(_crmProspects[ci], patch, { updated_at: all[i].updatedAt });
    }
  } else {
    const entry = { id: Date.now().toString(), savedAt: new Date().toISOString(), status: "active", prospect, ...update };
    all.unshift(entry);
    _crmProspects.unshift({
      id: entry.id, created_at: entry.savedAt, updated_at: entry.savedAt,
      name: prospect.name || "", company: prospect.company || "", title: prospect.title || "",
      email: prospect.email || "", phone: prospect.phone || "", linkedin_url: prospect.linkedin || "",
      domain: prospect.domain || "", status: "active", current_touch: 0,
      notes: "", next_action: "", next_action_date: null, ...patch,
    });
  }
  try { localStorage.setItem(MEMORY_KEY, JSON.stringify(all.slice(0, 100))); } catch {}
  return _crmProspects[0]?.id;
}

async function crmUpdateFields(id, fields) {
  const i = _crmProspects.findIndex((p) => p.id === id);
  if (i >= 0) Object.assign(_crmProspects[i], fields);
  if (_sb) { await _sb.from("prospects").update(fields).eq("id", id); return; }
  const all = JSON.parse(localStorage.getItem(MEMORY_KEY) || "[]");
  const li = all.findIndex((e) => e.id === id);
  if (li >= 0) {
    all[li].status = fields.status ?? all[li].status;
    all[li].notes = fields.notes ?? all[li].notes;
    all[li].nextAction = fields.next_action ?? all[li].nextAction;
    all[li].nextActionDate = fields.next_action_date ?? all[li].nextActionDate;
    all[li].currentTouch = fields.current_touch ?? all[li].currentTouch;
    all[li].updatedAt = fields.updated_at ?? all[li].updatedAt;
    try { localStorage.setItem(MEMORY_KEY, JSON.stringify(all)); } catch {}
  }
}

function statusLabel(s) {
  return { active: "Active", replied: "Replied ✓", meeting: "Meeting", closed: "Closed", cold: "Cold" }[s] || s;
}
function statusClass(s) {
  return { active: "ms-active", replied: "ms-replied", meeting: "ms-meeting", closed: "ms-closed", cold: "ms-cold" }[s] || "ms-active";
}

let _currentDrawerId = null;

function renderMemoryList() {
  const empty = $("memoryEmpty");
  const list  = $("memoryList");
  if (!list) return;

  const filtered = _crmFilter === "all"
    ? _crmProspects
    : _crmProspects.filter((p) => p.status === _crmFilter);

  // Update filter pill counts
  document.querySelectorAll(".crm-filter").forEach((pill) => {
    const f = pill.dataset.filter;
    const count = f === "all" ? _crmProspects.length : _crmProspects.filter((p) => p.status === f).length;
    const badge = pill.querySelector(".filter-count");
    if (badge) badge.textContent = count > 0 ? count : "";
  });

  if (!filtered.length) {
    if (empty) empty.style.display = "";
    list.innerHTML = "";
    return;
  }
  if (empty) empty.style.display = "none";

  list.innerHTML = filtered.map((p) => {
    const date = new Date(p.updated_at || p.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
    const touchBadge = p.current_touch > 0 ? `<span class="touch-badge">T${p.current_touch}</span>` : "";
    const nextLine   = p.next_action ? `<div class="mr-next-action">→ ${p.next_action}${p.next_action_date ? " · " + p.next_action_date : ""}</div>` : "";
    return `<div class="memory-row" data-id="${p.id}">
      <div class="mr-main">
        <div class="mr-name">${p.name || "Unknown"} ${touchBadge}</div>
        <div class="mr-meta">${[p.title, p.company].filter(Boolean).join(" · ")}</div>
        ${nextLine}
      </div>
      <div class="mr-right">
        <span class="memory-status ${statusClass(p.status)}">${statusLabel(p.status)}</span>
        <span class="mr-date">${date}</span>
        <button class="btn btn-ghost btn-sm mr-open" data-id="${p.id}">View →</button>
      </div>
    </div>`;
  }).join("");

  list.querySelectorAll(".mr-open").forEach((btn) => {
    btn.addEventListener("click", () => openMemoryDrawer(btn.dataset.id));
  });
  list.querySelectorAll(".memory-row").forEach((row) => {
    row.addEventListener("click", (e) => {
      if (!e.target.closest("button")) openMemoryDrawer(row.dataset.id);
    });
  });
}

function openMemoryDrawer(id) {
  const entry = _crmProspects.find((p) => p.id === id);
  if (!entry) return;
  _currentDrawerId = id;

  $("drawerName").textContent = entry.name || "Unknown";
  $("drawerMeta").textContent = [entry.title, entry.company].filter(Boolean).join(" · ");

  if ($("drawerStatus"))     $("drawerStatus").value     = entry.status || "active";
  if ($("drawerTouch"))      $("drawerTouch").value      = entry.current_touch || 0;
  if ($("drawerNotes"))      $("drawerNotes").value      = entry.notes || "";
  if ($("drawerNextAction")) $("drawerNextAction").value = entry.next_action || "";
  if ($("drawerNextDate"))   $("drawerNextDate").value   = entry.next_action_date || "";

  renderDrawerTab("dossier", entry);
  $("memoryDrawer").classList.remove("hidden");
  $("memoryDrawer").scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderDrawerTab(tab, entry) {
  const content = $("drawerContent");
  document.querySelectorAll(".dtab").forEach((t) => t.classList.toggle("active", t.dataset.dtab === tab));

  if (tab === "dossier") {
    content.innerHTML = `<pre class="drawer-pre">${entry.dossier || "No dossier yet — run the Agent Chain first."}</pre>`;
  } else if (tab === "emails") {
    const a = entry.emails?.a || ""; const b = entry.emails?.b || ""; const c = entry.emails?.c || "";
    content.innerHTML = `
      <div class="drawer-email-tabs">
        <button class="detab active" data-v="a">Variant A</button>
        <button class="detab" data-v="b">Variant B</button>
        <button class="detab" data-v="c">Variant C</button>
      </div>
      <pre class="drawer-pre detab-a">${a || "No emails yet."}</pre>
      <pre class="drawer-pre detab-b hidden">${b}</pre>
      <pre class="drawer-pre detab-c hidden">${c}</pre>`;
    content.querySelectorAll(".detab").forEach((t) => {
      t.addEventListener("click", () => {
        content.querySelectorAll(".detab").forEach((x) => x.classList.remove("active"));
        t.classList.add("active");
        ["a","b","c"].forEach((v) => {
          content.querySelector(`.detab-${v}`)?.classList.toggle("hidden", v !== t.dataset.v);
        });
      });
    });
  } else if (tab === "linkedin") {
    content.innerHTML = `<pre class="drawer-pre">${entry.linkedin_messages || "No LinkedIn copy yet."}</pre>`;
  } else if (tab === "cadence") {
    content.innerHTML = `<pre class="drawer-pre">${entry.cadence || "No 8-touch cadence yet — run Step 7."}</pre>`;
  } else if (tab === "objection") {
    content.innerHTML = `<pre class="drawer-pre">${entry.objection_response || "No objection handler yet."}</pre>`;
  }
}

function wireMemory() {
  renderMemoryList();

  // Filter pills
  document.querySelectorAll(".crm-filter").forEach((pill) => {
    pill.addEventListener("click", () => {
      document.querySelectorAll(".crm-filter").forEach((p) => p.classList.remove("active"));
      pill.classList.add("active");
      _crmFilter = pill.dataset.filter;
      renderMemoryList();
    });
  });

  const clearBtn = $("clearMemoryBtn");
  if (clearBtn) {
    clearBtn.addEventListener("click", async () => {
      if (!confirm("Clear all prospects? This cannot be undone.")) return;
      if (_sb) {
        const ids = _crmProspects.map((p) => p.id);
        if (ids.length) await _sb.from("prospects").delete().in("id", ids);
      }
      localStorage.removeItem(MEMORY_KEY);
      _crmProspects = [];
      renderMemoryList();
      $("memoryDrawer").classList.add("hidden");
    });
  }

  const drawerClose = $("drawerClose");
  if (drawerClose) drawerClose.addEventListener("click", () => $("memoryDrawer").classList.add("hidden"));

  const saveCrm = $("drawerSaveCrm");
  if (saveCrm) {
    saveCrm.addEventListener("click", async () => {
      if (!_currentDrawerId) return;
      const fields = {
        status:           $("drawerStatus").value,
        current_touch:    parseInt($("drawerTouch").value, 10) || 0,
        notes:            $("drawerNotes").value,
        next_action:      $("drawerNextAction").value,
        next_action_date: $("drawerNextDate").value || null,
        updated_at:       new Date().toISOString(),
      };
      const orig = saveCrm.textContent;
      saveCrm.textContent = "Saving…"; saveCrm.disabled = true;
      await crmUpdateFields(_currentDrawerId, fields);
      saveCrm.textContent = "Saved ✓";
      setTimeout(() => { saveCrm.textContent = orig; saveCrm.disabled = false; }, 1500);
      renderMemoryList();
    });
  }

  document.querySelectorAll(".dtab").forEach((tab) => {
    tab.addEventListener("click", () => {
      if (!_currentDrawerId) return;
      const entry = _crmProspects.find((p) => p.id === _currentDrawerId);
      if (entry) renderDrawerTab(tab.dataset.dtab, entry);
    });
  });
}

// ─── Agent Chain ──────────────────────────────────────────────────────────────
function getProspect() {
  return {
    name:    [($("pFirstName").value || ""), ($("pLastName").value || "")].filter(Boolean).join(" "),
    firstName: $("pFirstName").value,
    lastName:  $("pLastName").value,
    title:   $("pTitle").value,
    company: $("pCompany").value,
    domain:  $("pDomain").value,
    linkedin: $("pLinkedin").value,
    industry: $("pIndustry").value,
  };
}

function setStepDone(n) {
  const b = $(`badge-${n}`);
  if (b) { b.className = "step-badge done"; b.textContent = "✓"; }
}

function setRunning(btn, label) {
  btn.textContent = label + "…"; btn.disabled = true;
}
function resetBtn(btn, label) {
  btn.textContent = label; btn.disabled = false;
}

function wireChain() {
  $("clearProspectBtn").addEventListener("click", () => {
    ["pFirstName","pLastName","pTitle","pCompany","pDomain","pLinkedin"].forEach((id) => $(`${id}`).value = "");
    $("pIndustry").value = "";
    $("signalContext").value = "";
    $("linkedinPosts").value = "";
    $("objectionReply").value = "";
    $("snapshotOut").innerHTML = '<span style="color:var(--text-3);font-style:italic">Enrich with Apollo or paste company notes manually…</span>';
    $("dossierOut").innerHTML  = '<span class="dossier-empty">Run Agent 1 to generate the intelligence dossier…</span>';
    $("dossierScore").textContent = "— / 100";
    ["a","b","c"].forEach((v) => { const e = $(`emailOut-${v}`); if (e) { e.textContent = ""; } });
    $("emailOut-a").innerHTML = '<span class="email-empty">Generate outreach to see email variants…</span>';
    $("liOut").innerHTML = '<span style="color:var(--text-3);font-style:italic">Generate outreach to see LinkedIn sequence…</span>';
    $("followupOut").textContent = ""; $("followupOut").classList.add("hidden");
    $("objectionOut").textContent = ""; $("objectionOut").classList.add("hidden");
    for (let i = 1; i <= 8; i++) {
      const b = $(`badge-${i}`);
      if (b) { b.className = "step-badge" + (i === 1 ? " active" : ""); b.textContent = i; }
    }
    localStorage.removeItem("apex.currentDossier");
  });

  // Enrich with Apollo
  $("enrichApolloBtn").addEventListener("click", async () => {
    const p = getProspect();
    if (!p.company && !p.domain) { alert("Enter at least Company Name or Domain first."); return; }
    const btn = $("enrichApolloBtn");
    setRunning(btn, "Enrich with Apollo");
    try {
      const res = await post("/api/apollo/match", {
        first_name: p.firstName, last_name: p.lastName,
        organization_name: p.company, domain: p.domain,
        linkedin_url: p.linkedin,
      });
      if (res.error) {
        $("snapshotOut").textContent = "Apollo: " + res.error;
      } else {
        const person = res.person || {};
        const org = person.organization || {};
        const snap = [
          org.name ? `Company: ${org.name}` : "",
          org.estimated_num_employees ? `Headcount: ~${org.estimated_num_employees}` : "",
          org.industry ? `Industry: ${org.industry}` : "",
          org.primary_domain ? `Domain: ${org.primary_domain}` : "",
          org.city ? `Location: ${org.city}${org.country ? ", " + org.country : ""}` : "",
          org.organization_revenue_printed ? `Revenue: ${org.organization_revenue_printed}` : "",
          org.technology_names?.length ? `Tech stack: ${org.technology_names.slice(0, 6).join(", ")}` : "",
          person.title ? `Title (Apollo): ${person.title}` : "",
          person.seniority ? `Seniority: ${person.seniority}` : "",
          person.email ? `Email: ${person.email}` : "",
          person.match_confidence ? `Match confidence: ${person.match_confidence}` : "",
        ].filter(Boolean).join("\n");
        $("snapshotOut").textContent = snap || "Apollo enrichment returned no data.";
        setStepDone(2);
        if (person.email && !$("pFirstName").value) {
          const nameParts = (person.name || "").split(" ");
          $("pFirstName").value = nameParts[0] || "";
          $("pLastName").value  = nameParts.slice(1).join(" ") || "";
        }
      }
    } catch (e) {
      $("snapshotOut").textContent = "Apollo API not connected. Add APOLLO_API_KEY to your environment.";
    }
    resetBtn(btn, "Enrich with Apollo →");
  });

  // Research with Perplexity
  $("researchPerplexityBtn").addEventListener("click", async () => {
    const p = getProspect();
    if (!p.company) { alert("Enter the Company Name first."); return; }
    const btn = $("researchPerplexityBtn");
    setRunning(btn, "Research with Perplexity");
    try {
      const query = `Research ${p.name ? p.name + " at " : ""}${p.company}${p.domain ? " (" + p.domain + ")" : ""}. I need these 6 specific things:

1. FOUNDING: When was ${p.company} founded? Where did they start? What did they originally make or do?
2. EXACT PRODUCTS: List the exact product names, brand names, SKUs, or project lines that ${p.company} sells — not categories, actual names.
3. RECENT LAUNCHES: Any new products, projects, campaigns, or expansions in the last 12 months — include specific month and year if available.
4. PROSPECT CAREER: ${p.name ? p.name + "'s" : "The prospect's"} LinkedIn career history — past companies, past roles, years at each. Go back at least 3-5 roles.
5. THEIR CUSTOMER: Who does ${p.company} sell to? What industries, company types, or end-users buy from them?
6. COMPLIANCE / AUDIT: What certifications, regulations, or audits does ${p.company} live with (e.g. ISO, BRC, RERA, FSSAI, SONCAP, FDA, HACCP)?

Also include any recent news, leadership changes, or awards from the last 90 days.`;
      const res = await post("/api/perplexity/search", {
        messages: [{ role: "user", content: query }],
      });
      const content = res.choices?.[0]?.message?.content || res.error || "No results.";
      const current = $("signalContext").value;
      $("signalContext").value = (current ? current + "\n\n---\nPerplexity Research:\n" : "Perplexity Research:\n") + content;
      setStepDone(2);
    } catch (e) {
      alert("Perplexity API not connected. Add PERPLEXITY_API_KEY to your environment.");
    }
    resetBtn(btn, "Research with Perplexity →");
  });

  // Run Agent 1 — Research
  $("runResearchBtn").addEventListener("click", async () => {
    const p = getProspect();
    if (!p.name && !p.company) { alert("Fill in the prospect name or company first."); return; }
    const btn = $("runResearchBtn");
    setRunning(btn, "Run Agent 1 — Research");
    $("dossierOut").innerHTML = '<span class="dossier-empty">Researching…</span>';
    try {
      const { content, error } = await post("/api/chain/run", {
        prospect: p,
        icp: getIcp(),
        senderProfile: getSender(),
        step: "research",
        signalContext: $("signalContext").value,
      });
      if (error) { $("dossierOut").textContent = "Error: " + error; return; }
      $("dossierOut").textContent = content;
      localStorage.setItem("apex.currentDossier", content);

      // Save to prospect memory
      await saveProspectToMemory(p, {
        snapshot: $("snapshotOut").textContent,
        dossier: content,
      });
      if (document.getElementById("tab-campaigns")?.classList.contains("active")) renderMemoryList();

      // Extract score
      const scoreMatch = content.match(/Intelligence Score[:\s]*(\d+)/i);
      if (scoreMatch) $("dossierScore").textContent = scoreMatch[1] + " / 100";
      else $("dossierScore").textContent = "— / 100";

      setStepDone(3); setStepDone(4);

      // Update dossier counter
      const count = parseInt(localStorage.getItem("apex.dossierCount") || "0", 10) + 1;
      localStorage.setItem("apex.dossierCount", count);
      updateCounters();
    } catch (e) { $("dossierOut").textContent = "Network error: " + e.message; }
    resetBtn(btn, "Run Agent 1 — Research →");
  });

  // Generate Outreach (emails + LinkedIn simultaneously)
  $("genOutreachBtn").addEventListener("click", async () => {
    const p = getProspect();
    const dossier = localStorage.getItem("apex.currentDossier") || $("dossierOut").textContent;
    const btn = $("genOutreachBtn");
    setRunning(btn, "Generate Outreach");

    ["a","b","c"].forEach((v) => {
      const e = $(`emailOut-${v}`);
      if (e) e.innerHTML = '<span class="email-empty">Generating…</span>';
    });
    $("liOut").innerHTML = '<span style="color:var(--text-3);font-style:italic">Generating…</span>';

    try {
      const sender = getSender();
      // Run cold emails + LinkedIn in parallel
      const [emailRes, liRes] = await Promise.all([
        post("/api/chain/run", { prospect: p, icp: getIcp(), senderProfile: sender, step: "outreach", dossier }),
        post("/api/chain/run", { prospect: p, icp: getIcp(), senderProfile: sender, step: "linkedin", dossier, linkedinPosts: $("linkedinPosts").value }),
      ]);

      // Parse 3 email variants from response
      let emailA = "", emailB = "", emailC = "";
      if (emailRes.content) {
        const raw = emailRes.content;
        const aMatch = raw.match(/VARIANT A[\s\S]*?(?=VARIANT B|$)/i)?.[0] || "";
        const bMatch = raw.match(/VARIANT B[\s\S]*?(?=VARIANT C|$)/i)?.[0] || "";
        const cMatch = raw.match(/VARIANT C[\s\S]*/i)?.[0] || "";
        emailA = aMatch.trim() || raw; emailB = bMatch.trim() || ""; emailC = cMatch.trim() || "";
        $("emailOut-a").textContent = emailA;
        $("emailOut-b").textContent = emailB || "See Variant A";
        $("emailOut-c").textContent = emailC || "See Variant A";

        const count = parseInt(localStorage.getItem("apex.draftCount") || "0", 10) + 3;
        localStorage.setItem("apex.draftCount", count);
        updateCounters();
      }

      if (liRes.content) {
        $("liOut").textContent = liRes.content;
      }

      // Save emails + LinkedIn to prospect memory
      await saveProspectToMemory(p, {
        emails: { a: emailA, b: emailB, c: emailC },
        linkedin: liRes.content || "",
      });
      if (document.getElementById("tab-campaigns")?.classList.contains("active")) renderMemoryList();

      setStepDone(5); setStepDone(6);
    } catch (e) {
      $("emailOut-a").textContent = "Network error: " + e.message;
    }
    resetBtn(btn, "Generate Outreach →");
  });

  // Email variant tabs
  document.querySelectorAll(".etab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".etab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      const v = tab.dataset.variant;
      ["a","b","c"].forEach((x) => {
        const el = $(`emailOut-${x}`);
        if (el) el.classList.toggle("hidden", x !== v);
      });
    });
  });

  // Build Follow-up Sequence
  $("buildSequenceBtn").addEventListener("click", async () => {
    const p = getProspect();
    const dossier = localStorage.getItem("apex.currentDossier") || "";
    const state   = $("sequenceState").value;
    const btn = $("buildSequenceBtn");
    btn.textContent = "Building…"; btn.disabled = true;
    $("followupOut").textContent = "Building 8-touch cadence — this takes 30–40 seconds…";
    $("followupOut").classList.remove("hidden");
    try {
      const { content, error } = await post("/api/chain/run", {
        prospect: p, icp: getIcp(), senderProfile: getSender(), step: "followup",
        dossier, sequenceState: state,
      });
      $("followupOut").textContent = error ? "Error: " + error : content;
      if (!error) {
        setStepDone(7);
        await saveProspectToMemory(p, { followup: content });
      }
    } catch (e) { $("followupOut").textContent = "Network error: " + e.message; }
    btn.textContent = "Build 8-Touch Cadence"; btn.disabled = false;
  });

  // Objection Handler
  $("classifyBtn").addEventListener("click", async () => {
    const reply = $("objectionReply").value.trim();
    if (!reply) { alert("Paste their reply first."); return; }
    const btn = $("classifyBtn");
    btn.textContent = "Classifying…"; btn.disabled = true;
    $("objectionOut").textContent = "Analysing reply…";
    $("objectionOut").classList.remove("hidden");
    try {
      const { content, error } = await post("/api/chain/run", {
        prospect: getProspect(), icp: getIcp(), senderProfile: getSender(),
        step: "objection", reply,
      });
      $("objectionOut").textContent = error ? "Error: " + error : content;
      if (!error) {
        setStepDone(8);
        await saveProspectToMemory(getProspect(), { objection: content });
      }
    } catch (e) { $("objectionOut").textContent = "Network error: " + e.message; }
    btn.textContent = "Classify & Draft Response"; btn.disabled = false;
  });
}

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  await initSupabase();
});
