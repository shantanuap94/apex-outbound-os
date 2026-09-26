// ─── Constants ────────────────────────────────────────────────────────────────
const API = "";

const SENDER_FIELDS = [
  "name","role","offer","valueProp","proof","cta","tone","authorityBlock",
  // Advanced Profile
  "offerMechanism","outcomeTimeframe","lowRiskOffer","differentiation",
  "proofCards","voiceSamples","bannedWords","authorityOpinion",
];


const ICP_FIELDS = [
  "seedDescription","roleSeniority","companyStageSize","responsibilityScope",
  "empathySayLoud","empathyThinkPrivately","empathyActuallyDo","empathyFeel",
  "pains","fears","frustrations","dreamOutcomes",
  // Buying Intelligence
  "triggers","currentAlternative","objections","exactWords",
  "disqualifiers","buyingCommittee","seniorityFraming",
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

// ─── SSE chain helper ─────────────────────────────────────────────────────────
// Replaces post() for /api/chain/run — streams tokens to an optional onToken
// callback and resolves with { content, step } when done.
function postStream(path, body, onToken) {
  return new Promise(async (resolve, reject) => {
    try {
      const res = await fetch(API + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) { resolve({ error: `HTTP ${res.status}` }); return; }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let fullContent = "";
      let step = body.step || "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop(); // keep incomplete line in buffer

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const evt = JSON.parse(line.slice(6));
            if (evt.status === "token" && evt.token) {
              fullContent += evt.token;
              if (onToken) onToken(evt.token, fullContent);
            }
            if (evt.status === "done") { step = evt.step || step; fullContent = evt.content || fullContent; }
            if (evt.status === "error") { resolve({ error: evt.error || "Unknown error" }); return; }
          } catch (_) {}
        }
      }
      resolve({ content: fullContent, step });
    } catch (e) { resolve({ error: e.message }); }
  });
}

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
  const pc = _crmProspects?.length || 0;
  const dossiers = _crmProspects?.filter(p => p.dossier?.trim()).length || 0;
  const drafts = _crmProspects?.filter(p => p.emails && (p.emails.e1 || p.emails.sequence)).length || 0;
  const p = $("ctr-prospects"); if (p) p.textContent = `${pc} prospect${pc !== 1 ? "s" : ""}`;
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
async function loadSavedIcp() {
  if (!_sb || !_userId) return;
  try {
    const { data, error } = await _sb
      .from("icp_profiles")
      .select("name, data")
      .eq("user_id", _userId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return;
    const nameInp = $("icpProfileName");
    if (nameInp) nameInp.value = data.name;
    fillIcpFromObj(data.data || {});
  } catch {}
}

async function saveIcp() {
  const data = {};
  ICP_FIELDS.forEach((f) => { const inp = $(`icp-${f}`); if (inp) data[f] = inp.value; });
  const note = $("icpSavedNote");
  if (_sb && _userId) {
    const name = ($("icpProfileName")?.value || "").trim();
    if (!name) {
      note.classList.add("show");
      setTimeout(() => note.classList.remove("show"), 2000);
      return;
    }
    try {
      const { error } = await _sb.from("icp_profiles").upsert(
        { user_id: _userId, name, data, updated_at: new Date().toISOString() },
        { onConflict: "user_id,name" }
      );
      if (error) throw error;
      note.classList.add("show");
      setTimeout(() => note.classList.remove("show"), 2000);
      await loadIcpProfiles();
    } catch (e) {
      const orig = note.textContent;
      note.textContent = "Save failed";
      note.classList.add("show");
      alert(e.message || "Failed to save ICP profile");
      setTimeout(() => { note.classList.remove("show"); note.textContent = orig; }, 2000);
    }
  } else {
    note.classList.add("show");
    setTimeout(() => note.classList.remove("show"), 2000);
  }
}

async function loadIcpProfiles() {
  if (!_sb || !_userId) return;
  try {
    const { data, error } = await _sb
      .from("icp_profiles")
      .select("id, name")
      .order("updated_at", { ascending: false });
    if (error || !data) return;
    const sel = $("icpProfileSelect");
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = '<option value="">— Load saved profile —</option>';
    data.forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.name;
      sel.appendChild(opt);
    });
    if (current) sel.value = current;
  } catch {}
}

async function loadIcpProfile(id) {
  if (!_sb || !id) return;
  try {
    const { data, error } = await _sb
      .from("icp_profiles")
      .select("name, data")
      .eq("id", id)
      .single();
    if (error || !data) return;
    const nameInp = $("icpProfileName");
    if (nameInp) nameInp.value = data.name;
    fillIcpFromObj(data.data || {});
  } catch {}
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

  document.querySelectorAll(".btn-ai[data-field]:not([data-target='sender'])").forEach((btn) => {
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
    const nameInp = $("icpProfileName");
    if (nameInp) nameInp.value = "";
  });
  const icpSel = $("icpProfileSelect");
  if (icpSel) icpSel.addEventListener("change", () => { if (icpSel.value) loadIcpProfile(icpSel.value); });
  loadIcpProfiles();

  // Buying Intelligence collapsible
  const icpAdvToggle = $("icpAdvToggle");
  const icpAdvBody   = $("icpAdvBody");
  if (icpAdvToggle && icpAdvBody) {
    icpAdvToggle.addEventListener("click", () => {
      const open = icpAdvBody.style.display !== "none";
      icpAdvBody.style.display = open ? "none" : "block";
      icpAdvToggle.querySelector(".adv-arrow").textContent = open ? "▼" : "▲";
    });
  }
}

// ─── Sender Profile ───────────────────────────────────────────────────────────
function getSender() {
  const data = {};
  SENDER_FIELDS.forEach((f) => { const inp = $(`sender-${f}`); if (inp) data[f] = inp.value || ""; });
  return data;
}

async function loadSavedSender() {
  if (!_sb || !_userId) return;
  try {
    const { data, error } = await _sb
      .from("sender_profiles")
      .select("data")
      .eq("user_id", _userId)
      .maybeSingle();
    if (error || !data?.data) return;
    SENDER_FIELDS.forEach((f) => { const inp = $(`sender-${f}`); if (inp && data.data[f]) inp.value = data.data[f]; });
  } catch {}
}

async function saveSender() {
  const note = $("senderSavedNote");
  if (!_sb || !_userId) {
    note.textContent = "Sign in to save";
    note.classList.add("show");
    setTimeout(() => { note.textContent = "Saved ✓"; note.classList.remove("show"); }, 2000);
    return;
  }
  try {
    const { error } = await _sb.from("sender_profiles").upsert(
      { user_id: _userId, data: getSender(), updated_at: new Date().toISOString() },
      { onConflict: "user_id" }
    );
    if (error) throw error;
    note.classList.add("show");
    setTimeout(() => note.classList.remove("show"), 2000);
  } catch (e) {
    const orig = note.textContent;
    note.textContent = "Save failed";
    note.classList.add("show");
    setTimeout(() => { note.textContent = orig; note.classList.remove("show"); }, 2500);
  }
}

function wireSender() {
  $("saveSenderBtn").addEventListener("click", saveSender);

  const genAuthBtn = $("genAuthorityBtn");
  if (genAuthBtn) {
    genAuthBtn.addEventListener("click", async () => {
      const textarea = $("sender-authorityBlock");
      const orig = genAuthBtn.textContent;
      genAuthBtn.textContent = "…"; genAuthBtn.disabled = true;
      try {
        const { authorityBlock, error } = await post("/api/profile/authority", { senderProfile: getSender() });
        if (error) { alert("Error: " + error); return; }
        if (textarea) { textarea.value = authorityBlock; saveSender(); }
      } catch (e) { alert("Network error: " + e.message); }
      finally { genAuthBtn.textContent = orig; genAuthBtn.disabled = false; }
    });
  }
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

      // Auto-expand Advanced Profile if any advanced fields were filled
      const advFields = ["offerMechanism","outcomeTimeframe","lowRiskOffer","differentiation","proofCards","authorityOpinion"];
      const advFilled = advFields.some(f => profile[f]?.trim());
      if (advFilled) {
        const body = $("senderAdvBody");
        const toggle = $("senderAdvToggle");
        if (body) body.style.display = "block";
        if (toggle) { const arrow = toggle.querySelector(".adv-arrow"); if (arrow) arrow.textContent = "▲"; }
      }

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

  // Advanced Profile AI fill buttons
  document.querySelectorAll(".btn-ai[data-target='sender']").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const field = btn.dataset.field;
      const seed  = getSender().offer || $("sender-offer")?.value?.trim() || "";
      if (!seed) { alert("Fill in your Offer field first."); return; }
      const orig = btn.textContent;
      btn.textContent = "…"; btn.disabled = true;
      try {
        const { value, error } = await post("/api/icp/fill", { field, description: seed, context: "sender" });
        if (error) { alert("Error: " + error); return; }
        const el = $(`sender-${field}`);
        if (el && value) { el.value = value; saveSender(); }
      } catch (e) { alert("Network error: " + e.message); }
      finally { btn.textContent = orig; btn.disabled = false; }
    });
  });

  // Advanced Profile collapsible
  const senderAdvToggle = $("senderAdvToggle");
  const senderAdvBody   = $("senderAdvBody");
  if (senderAdvToggle && senderAdvBody) {
    senderAdvToggle.addEventListener("click", () => {
      const open = senderAdvBody.style.display !== "none";
      senderAdvBody.style.display = open ? "none" : "block";
      senderAdvToggle.querySelector(".adv-arrow").textContent = open ? "▼" : "▲";
    });
  }
}

// ─── Supabase CRM ─────────────────────────────────────────────────────────────
const MEMORY_KEY = "apex.prospectMemory";
let _sb = null;
let _crmFilter = "all";
let _crmProspects = [];
let _suppressionList = [];
let _userId = null;
let _currentDossier = "";
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
  loadSavedSender();
  loadSavedIcp();
  wireChain();
  wireMemory();
  wireProspectSearch();
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

      <!-- NAV -->
      <nav class="lp-nav">
        <div class="lp-nav-brand">
          <div class="lp-logo-icon">P</div>
          <div class="lp-nav-name">Predictable Revenue OS</div>
        </div>
        <button class="btn-google btn-google-nav" id="googleSignInBtn">${googleSvg} Sign in</button>
      </nav>

      <!-- HERO -->
      <section class="lp-hero">
        <div class="lp-eyebrow">FOR B2B FOUNDERS &amp; SALES LEADERS</div>
        <h1 class="lp-h1">The Future of B2B Revenue.</h1>
        <p class="lp-hero-deck">Enterprise clients acquired on demand.</p>
        <p class="lp-hero-proof">10&times; faster and cheaper.</p>
        <p class="lp-hero-body">Predictable Revenue OS works alongside your sales team to research prospects, write outreach that gets replies, and run cadences that compound — using an AI-Native approach built around your exact ICP and voice.</p>
        <div class="lp-hero-cta">
          <button class="btn-google btn-google-lg" id="googleSignInBtnHero">${googleSvg}&nbsp; Get Early Access — Sign in with Google</button>
          <p class="lp-hero-note">Invite-only &middot; Access reviewed personally by admin</p>
        </div>
      </section>

      <!-- STATS BAR -->
      <div class="lp-stats-bar">
        <div class="lp-stat">
          <span class="lp-stat-num">&lt;&nbsp;8 min</span>
          <span class="lp-stat-label">Full 360° dossier per prospect</span>
        </div>
        <div class="lp-stat-div"></div>
        <div class="lp-stat">
          <span class="lp-stat-num">8 touches</span>
          <span class="lp-stat-label">Email + LinkedIn + WhatsApp</span>
        </div>
        <div class="lp-stat-div"></div>
        <div class="lp-stat">
          <span class="lp-stat-num">10/10</span>
          <span class="lp-stat-label">Personalisation — product-level specificity</span>
        </div>
        <div class="lp-stat-div"></div>
        <div class="lp-stat">
          <span class="lp-stat-num">0</span>
          <span class="lp-stat-label">Generic templates. Ever.</span>
        </div>
      </div>

      <!-- OFFERING -->
      <section class="lp-section lp-offering-section">
        <div class="lp-section-inner">

          <div class="lp-offering-top">
            <div class="lp-offering-lede">
              <div class="lp-section-label">01 / OFFERING</div>
              <h2 class="lp-offering-h2">10&times; output from your sales team</h2>
              <p class="lp-offering-p">Predictable Revenue OS takes your existing outbound motion — your ICP, your targets, your voice — and runs it through an AI-Native engine that researches faster, writes better, and follows up longer than any human team could.</p>
              <p class="lp-offering-p">10&times; takes different shapes. On some programs it shows up as speed — dossiers in minutes instead of hours. On others it shows up as reach — ten prospects worked in parallel instead of one. Often it's both. The system configures around what matters most to your business.</p>
            </div>
            <div class="lp-why-now">
              <div class="lp-why-label">Why now</div>
              <p class="lp-why-p">With agentic AI, the cost of prospect research and personalised outreach is falling toward zero. For years, most of the labour in outbound was manual — research, writing, follow-up. AI now does that work, which means enterprise-grade outbound is within reach for a single founder or a lean sales team.</p>
            </div>
          </div>

          <div class="lp-offering-stats">
            <div class="lp-off-stat">
              <span class="lp-off-num">4 hrs &rarr; 8 min</span>
              <span class="lp-off-label">Prospect research time</span>
            </div>
            <div class="lp-off-stat-div"></div>
            <div class="lp-off-stat">
              <span class="lp-off-num">8 touches</span>
              <span class="lp-off-label">Across email, LinkedIn + WhatsApp</span>
            </div>
            <div class="lp-off-stat-div"></div>
            <div class="lp-off-stat">
              <span class="lp-off-num">10/10</span>
              <span class="lp-off-label">Personalisation — product-level specificity</span>
            </div>
          </div>

          <div class="lp-where-time">
            <div class="lp-wt-label">Where the time goes</div>
            <p class="lp-wt-sub">When AI writes the research and the outreach, manual work collapses. The time that comes back goes straight into conversations.</p>
            <div class="lp-wt-rows">
              <div class="lp-wt-row">
                <span class="lp-wt-row-label">Before</span>
                <div class="lp-wt-bars">
                  <div class="lp-wt-bar lp-wt-research" style="width:38%"><span>Research</span></div>
                  <div class="lp-wt-bar lp-wt-writing" style="width:28%"><span>Writing</span></div>
                  <div class="lp-wt-bar lp-wt-followup" style="width:20%"><span>Follow-up</span></div>
                  <div class="lp-wt-bar lp-wt-convo" style="width:14%"><span>Conversations</span></div>
                </div>
              </div>
              <div class="lp-wt-row">
                <span class="lp-wt-row-label">After</span>
                <div class="lp-wt-bars">
                  <div class="lp-wt-bar lp-wt-research" style="width:5%"></div>
                  <div class="lp-wt-bar lp-wt-writing" style="width:5%"></div>
                  <div class="lp-wt-bar lp-wt-followup" style="width:8%"></div>
                  <div class="lp-wt-bar lp-wt-convo" style="width:82%"><span>Conversations &amp; Closing</span></div>
                </div>
              </div>
            </div>
            <p class="lp-wt-note">Bar widths are illustrative.</p>
          </div>

          <div class="lp-delivery">
            <div class="lp-wt-label">How it's built</div>
            <div class="lp-delivery-grid">
              <div class="lp-delivery-item">
                <div class="lp-delivery-title">System</div>
                <p>One platform — ICP definition, prospect research, outreach generation, and 8-touch cadence — all connected. Set it up once. It runs your outbound forever.</p>
              </div>
              <div class="lp-delivery-item">
                <div class="lp-delivery-title">Intelligence</div>
                <p>AI-Native research agents that build 360° dossiers on every prospect and write every message in your exact voice — not a generic AI voice.</p>
              </div>
              <div class="lp-delivery-item">
                <div class="lp-delivery-title">Simplicity</div>
                <p>One tool, not five. No stitching together a prospecting stack. Research, write, send, follow up — the whole motion runs from a single screen.</p>
              </div>
            </div>
          </div>

        </div>
      </section>

      <!-- PLATFORM -->
      <section class="lp-section lp-platform-section">
        <div class="lp-section-inner">

          <div class="lp-platform-header">
            <div class="lp-platform-name-block">
              <div class="lp-section-label">02 / PLATFORM</div>
              <h2 class="lp-platform-h2">Predictable Revenue OS</h2>
              <p class="lp-platform-tagline">The AI-Native outbound engine.</p>
            </div>
            <p class="lp-platform-intro">Five layers profile your buyer, research every prospect, compose every message, run every cadence, and remember every interaction — all built around your exact ICP and voice. Every layer reads from the one above it. Every output traces back to a real data source.</p>
          </div>

          <div class="lp-layers-label">One platform, five layers</div>
          <div class="lp-layers">
            <div class="lp-layer">
              <div class="lp-layer-left">
                <div class="lp-layer-name">ICP Core</div>
                <div class="lp-layer-role">Your buyer foundation</div>
              </div>
              <p class="lp-layer-desc">The profile you build once: who you are, who you sell to, your offer, your proof, your tone. Every research brief, every message, every cadence touch is shaped by this layer. Change it once — everything downstream updates.</p>
            </div>
            <div class="lp-layer">
              <div class="lp-layer-left">
                <div class="lp-layer-name">Scout</div>
                <div class="lp-layer-role">Research agent</div>
              </div>
              <p class="lp-layer-desc">Reads your prospect's company, their products by name, their career history, recent moves, and likely pains. Builds a 360° dossier in under 8 minutes. The research a senior SDR takes half a day to do — done before your next meeting.</p>
            </div>
            <div class="lp-layer">
              <div class="lp-layer-left">
                <div class="lp-layer-name">Composer</div>
                <div class="lp-layer-role">Outreach engine</div>
              </div>
              <p class="lp-layer-desc">Writes from the dossier, not from a template. References their actual products, their specific situation, their career arc. Outputs cold email, LinkedIn connection request, LinkedIn DM, and follow-ups — all in your voice, not a generic AI voice.</p>
            </div>
            <div class="lp-layer">
              <div class="lp-layer-left">
                <div class="lp-layer-name">Cadence</div>
                <div class="lp-layer-role">Multi-touch sequencer</div>
              </div>
              <p class="lp-layer-desc">8 touches across email, LinkedIn, and WhatsApp. Each touch gives before it asks. Touch 4 is where most replies come in. Touch 7 converts silence into a shared email. Touch 8 converts goodwill into a meeting.</p>
            </div>
            <div class="lp-layer">
              <div class="lp-layer-left">
                <div class="lp-layer-name">Pulse</div>
                <div class="lp-layer-role">CRM memory</div>
              </div>
              <p class="lp-layer-desc">Tracks every prospect's status, every touch sent, every reply received, and every next action due. Built-in pipeline filters, notes, and cadence manager. Your entire outbound operation — visible in one screen.</p>
            </div>
          </div>

          <div class="lp-apart">
            <div class="lp-layers-label">What sets it apart</div>
            <div class="lp-apart-grid">
              <div class="lp-apart-item">
                <div class="lp-apart-title">Product-level personalisation</div>
                <p>Not company-level. Not headline-level. Messages reference their actual product names, recent launches, and business moves — the kind that makes a buyer stop mid-scroll.</p>
              </div>
              <div class="lp-apart-item">
                <div class="lp-apart-title">Writes in your voice</div>
                <p>Every message sounds like it came from you. Your tone, your proof, your offer, your style — not a generic AI voice that every other SDR is also using.</p>
              </div>
              <div class="lp-apart-item">
                <div class="lp-apart-title">Sequences that give first</div>
                <p>Every touch delivers value before it asks. The system is designed to earn the reply — not beg for it. Buyers feel the difference.</p>
              </div>
              <div class="lp-apart-item">
                <div class="lp-apart-title">Built-in multi-channel cadence</div>
                <p>Email, LinkedIn, and WhatsApp — managed in one place. No stitching together three separate tools, a spreadsheet, and a VA to run follow-ups.</p>
              </div>
              <div class="lp-apart-item">
                <div class="lp-apart-title">Compound memory</div>
                <p>Every prospect interaction is stored and tracked. The system gets sharper with every campaign — context carries forward, nothing resets to zero.</p>
              </div>
              <div class="lp-apart-item">
                <div class="lp-apart-title">One screen, zero stack</div>
                <p>Research, write, send, track. The whole outbound motion in a single tool — not spread across Apollo, ChatGPT, a sequencing tool, and a CRM.</p>
              </div>
            </div>
          </div>

        </div>
      </section>

      <!-- PROBLEM -->
      <section class="lp-section">
        <div class="lp-section-inner">
          <div class="lp-section-label">WHY YOUR OUTBOUND IS FAILING</div>
          <h2 class="lp-section-h2">The enterprise buyer gets 200+ cold emails a week.<br>Yours looks like the other 199.</h2>
          <div class="lp-cards">
            <div class="lp-card">
              <div class="lp-card-accent"></div>
              <div class="lp-card-num">01</div>
              <h3>Your team researches. They don't sell.</h3>
              <p>3–4 hours per prospect. By the time the email goes out, the insight is stale — and they still sent a template. That's 70% of your payroll spent on work that doesn't close deals.</p>
            </div>
            <div class="lp-card">
              <div class="lp-card-accent"></div>
              <div class="lp-card-num">02</div>
              <h3>Your "personalisation" is a merge tag.</h3>
              <p>Using their first name and job title isn't personalisation. Enterprise buyers recognise a template in line one. Real personalisation means their specific products, recent company moves, career history.</p>
            </div>
            <div class="lp-card">
              <div class="lp-card-accent"></div>
              <div class="lp-card-num">03</div>
              <h3>No system = no predictable pipeline.</h3>
              <p>Good week, dead month. Founder-dependent deals. Random revenue. The problem isn't your product or your people — it's the absence of a repeatable, compounding outbound system.</p>
            </div>
          </div>
        </div>
      </section>

      <!-- HOW IT WORKS -->
      <section class="lp-section lp-section-alt">
        <div class="lp-section-inner">
          <div class="lp-section-label">HOW IT WORKS</div>
          <h2 class="lp-section-h2">Four steps. Compounding results.<br>Zero guesswork.</h2>
          <div class="lp-steps">
            <div class="lp-step">
              <div class="lp-step-num">1</div>
              <div class="lp-step-body">
                <h3>Define your ICP and voice — once</h3>
                <p>Tell the system who you are, who you sell to, and what you offer. Every research brief, every message, every cadence touch is written from your voice — not a generic AI voice. Set it once. It runs forever.</p>
              </div>
            </div>
            <div class="lp-step">
              <div class="lp-step-num">2</div>
              <div class="lp-step-body">
                <h3>AI builds a 360° dossier in under 8 minutes</h3>
                <p>Enter a prospect's name and company. The system researches their actual products by name, company history, role trajectory, recent moves, and likely pains. What a senior SDR takes half a day to do — done before your next meeting.</p>
              </div>
            </div>
            <div class="lp-step">
              <div class="lp-step-num">3</div>
              <div class="lp-step-body">
                <h3>Outreach written from the dossier — not a template</h3>
                <p>Messages that reference their real product names, specific situation, and actual frustrations. The kind that makes a senior buyer stop mid-scroll and think "this person actually did their homework." That's the only message worth sending.</p>
              </div>
            </div>
            <div class="lp-step">
              <div class="lp-step-num">4</div>
              <div class="lp-step-body">
                <h3>8-touch cadence across email, LinkedIn + WhatsApp</h3>
                <p>Every touch gives before it asks. Touch 4 is where most replies come in. Touch 7 is where silent prospects finally engage. Touch 8 converts months of goodwill into a meeting. The system tracks it all — you just show up for the conversation.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- WHO IT'S FOR -->
      <section class="lp-section">
        <div class="lp-section-inner">
          <div class="lp-section-label">WHO THIS IS BUILT FOR</div>
          <h2 class="lp-section-h2">Built for the people doing<br>the hard work of B2B growth.</h2>
          <div class="lp-for-grid">
            <div class="lp-for-card">
              <div class="lp-for-role">B2B Founders</div>
              <ul class="lp-for-list">
                <li>You are the sales team — and you cannot scale yourself</li>
                <li>Your best relationships came from persistence, not from systems. You now need the system.</li>
                <li>You're losing enterprise deals to competitors who out-research and out-follow-up you</li>
                <li>Revenue is tied to your calendar. Your calendar is full. Pipeline suffers.</li>
              </ul>
            </div>
            <div class="lp-for-card">
              <div class="lp-for-role">Sales Leaders &amp; SDR Teams</div>
              <ul class="lp-for-list">
                <li>Your reps spend 70% of their day on research and admin, not conversations</li>
                <li>Your sequences are running but your reply rates say they shouldn't be</li>
                <li>You need to show the board a system, not just effort and headcount</li>
                <li>One great rep shouldn't be carrying the whole team's number</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <!-- FINAL CTA -->
      <section class="lp-section lp-final-cta">
        <div class="lp-section-inner lp-cta-center">
          <div class="lp-eyebrow">GET STARTED</div>
          <h2 class="lp-cta-h2">The system your competitors<br>don't have yet.</h2>
          <p class="lp-cta-sub">Early access is limited. Each user gets a personal onboarding session to configure the system around their exact ICP and voice.</p>
          <button class="btn-google btn-google-lg" id="googleSignInBtnCta">${googleSvg}&nbsp; Get Early Access — Sign in with Google</button>
          <p class="lp-hero-note" style="margin-top:16px">Invite-only &middot; Access reviewed personally</p>
        </div>
      </section>

      <footer class="lp-footer">
        <span>&copy; 2025 Predictable Revenue OS</span>
        <span>Powered by AI &middot; Built for serious B2B revenue teams</span>
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
    const [prospectsResult] = await Promise.all([
      _sb.from("prospects").select("*").order("updated_at", { ascending: false }),
      loadSuppressionList(),
    ]);
    const { data, error } = prospectsResult;
    if (!error && data) { _crmProspects = data; updateCounters(); return; }
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
  updateCounters();
}

// ─── Suppression List ─────────────────────────────────────────────────────────
async function loadSuppressionList() {
  if (!_sb || !_userId) return;
  const { data, error } = await _sb
    .from("suppression_list")
    .select("id, email, reason, created_at")
    .order("created_at", { ascending: false });
  if (!error && data) _suppressionList = data;
  renderSuppressionPanel();
}

function isSuppressed(email) {
  if (!email) return false;
  return _suppressionList.some((s) => s.email.toLowerCase() === email.toLowerCase());
}

async function suppressEmail(email, reason = "manual", prospectId = null) {
  if (!email || !_sb || !_userId) return;
  const record = { user_id: _userId, email: email.toLowerCase(), reason };
  if (prospectId) record.prospect_id = prospectId;
  const { data, error } = await _sb
    .from("suppression_list")
    .upsert(record, { onConflict: "user_id,email" })
    .select("id, email, reason, created_at")
    .single();
  if (!error && data) {
    const existing = _suppressionList.findIndex((s) => s.email === data.email);
    if (existing >= 0) _suppressionList[existing] = data;
    else _suppressionList.unshift(data);
  }
  renderSuppressionPanel();
  renderMemoryList();
}

async function unsuppressEmail(email) {
  if (!email || !_sb || !_userId) return;
  await _sb.from("suppression_list")
    .delete()
    .eq("user_id", _userId)
    .eq("email", email.toLowerCase());
  _suppressionList = _suppressionList.filter((s) => s.email !== email.toLowerCase());
  renderSuppressionPanel();
  renderMemoryList();
}

function renderSuppressionPanel() {
  const panel = $("suppressionList");
  const count = $("suppressionCount");
  if (count) count.textContent = _suppressionList.length;
  if (!panel) return;
  if (!_suppressionList.length) {
    panel.innerHTML = '<p class="supp-empty">No suppressed emails. Bounces, unsubscribes, and manually suppressed contacts appear here.</p>';
    return;
  }
  panel.innerHTML = _suppressionList.map((s) => `
    <div class="supp-row">
      <span class="supp-email">${s.email}</span>
      <span class="supp-reason">${s.reason}</span>
      <button class="btn btn-ghost btn-xs supp-remove" data-email="${s.email}">Remove</button>
    </div>`).join("");
  panel.querySelectorAll(".supp-remove").forEach((btn) => {
    btn.addEventListener("click", () => unsuppressEmail(btn.dataset.email));
  });
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

  if (_sb && _userId) {
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
      if (update.emails   !== undefined) all[i].emails    = update.emails;
      if (update.linkedin !== undefined) all[i].linkedin  = update.linkedin;
      if (update.followup !== undefined) all[i].followup  = update.followup;
      if (update.objection !== undefined) all[i].objection = update.objection;
      if (update.snapshot !== undefined) all[i].snapshot  = update.snapshot;
      if (update.dossier  !== undefined) all[i].dossier   = update.dossier;
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

function parseReplyClassification(text) {
  const t = text.toLowerCase();
  if (/meeting.booked|confirmed.*meeting|booked.*call|agreed.*meet|we.re on|let.s do it/i.test(t)) return 'meeting_booked';
  if (/positive.interest|interested|open to|happy to|would love|love to|keen to|sounds good|let.s connect|let.s talk|send.*spec|send.*sample/i.test(t)) return 'positive_interest';
  if (/opt.out|unsubscribe|remove.*list|not interested|don.t contact|stop emailing|please remove/i.test(t)) return 'opt_out';
  return 'objection';
}

async function getSuccessfulPatterns(limit = 2) {
  if (!_sb) return [];
  try {
    const { data, error } = await _sb
      .from('outreach_sends')
      .select('body, subject')
      .in('reply_classification', ['positive_interest', 'meeting_booked'])
      .not('body', 'is', null)
      .order('replied_at', { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return data;
  } catch (_) { return []; }
}

async function logReplyToMemory(prospectId, replyText, classification) {
  if (!_sb || !prospectId) return;
  const now = new Date().toISOString();
  const { error: iErr } = await _sb.from('outreach_sends').insert({
    prospect_id: prospectId,
    channel: 'email',
    body: replyText,
    reply_text: replyText,
    reply_classification: classification,
    replied_at: now,
  });
  if (iErr) throw iErr;
  const cached = _crmProspects.find((p) => p.id === prospectId);
  const newCount = (cached?.reply_count || 0) + 1;
  const patch = { last_reply_at: now, reply_count: newCount, active_email_idx: 0 };
  if (classification === 'meeting_booked') patch.meeting_booked = true;
  const { error: pErr } = await _sb.from('prospects').update(patch).eq('id', prospectId);
  if (pErr) throw pErr;
  if (cached) Object.assign(cached, patch);
}

async function crmUpdateFields(id, fields) {
  const i = _crmProspects.findIndex((p) => p.id === id);
  if (i >= 0) Object.assign(_crmProspects[i], fields);
  if (_sb && _userId) {
    const { error } = await _sb.from("prospects").update(fields).eq("id", id);
    if (error) throw error;
    return;
  }
  if (_sb && !_userId) throw new Error("Session expired — please sign in again");
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
const EMAIL_GAPS_DAYS = { 2: 3, 3: 5, 4: 6 };

function getEmailDueStatus(p) {
  const idx = p.active_email_idx;
  if (!idx || idx <= 0 || idx > 4) return null;
  if (idx === 1 || !p.last_email_sent_at) return { status: 'due', daysUntil: 0 };
  const gapMs = (EMAIL_GAPS_DAYS[idx] || 3) * 86400000;
  const dueAt = new Date(new Date(p.last_email_sent_at).getTime() + gapMs);
  const daysUntil = Math.ceil((dueAt - Date.now()) / 86400000);
  if (daysUntil <= 0) return { status: daysUntil < -1 ? 'overdue' : 'due', daysUntil };
  return { status: 'pending', daysUntil };
}

function getSequenceBadge(p) {
  if (p.meeting_booked) return '';
  if (p.status && p.status !== 'active') return '';
  const idx = p.active_email_idx;
  if (idx === null || idx === undefined) return '';
  if (idx === 0) return '<span class="seq-badge seq-paused">Replied</span>';
  const due = getEmailDueStatus(p);
  if (!due) return '<span class="seq-badge seq-done">Seq Done</span>';
  if (due.status === 'overdue') return `<span class="seq-badge seq-overdue">E${idx} Overdue</span>`;
  if (due.status === 'due')     return `<span class="seq-badge seq-${idx}">E${idx} Due</span>`;
  return `<span class="seq-badge seq-pending">E${idx} in ${due.daysUntil}d</span>`;
}

let _currentDrawerId = null;

function renderMemoryList() {
  const empty = $("memoryEmpty");
  const list  = $("memoryList");
  if (!list) return;

  const isDueProspect = (p) => {
    if (p.status !== 'active') return false;
    const due = getEmailDueStatus(p);
    return due && (due.status === 'due' || due.status === 'overdue');
  };
  const isSuppressedProspect = (p) => isSuppressed(p.email);

  const filtered = _crmFilter === 'all'        ? _crmProspects
    : _crmFilter === 'due'                      ? _crmProspects.filter(isDueProspect)
    : _crmFilter === 'suppressed'               ? _crmProspects.filter(isSuppressedProspect)
    : _crmProspects.filter((p) => p.status === _crmFilter);

  // Update filter pill counts
  document.querySelectorAll(".crm-filter").forEach((pill) => {
    const f = pill.dataset.filter;
    const count = f === 'all'        ? _crmProspects.length
      : f === 'due'                  ? _crmProspects.filter(isDueProspect).length
      : f === 'suppressed'           ? _crmProspects.filter(isSuppressedProspect).length
      : _crmProspects.filter((p) => p.status === f).length;
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
    const seqBadge   = getSequenceBadge(p);
    const suppBadge  = isSuppressed(p.email) ? `<span class="seq-badge seq-supp" title="Suppressed — no outreach">⊘</span>` : "";
    const nextLine   = p.next_action ? `<div class="mr-next-action">→ ${p.next_action}${p.next_action_date ? " · " + p.next_action_date : ""}</div>` : "";
    return `<div class="memory-row${isSuppressed(p.email) ? ' row-suppressed' : ''}" data-id="${p.id}">
      <div class="mr-main">
        <div class="mr-name">${p.name || "Unknown"} ${touchBadge}${seqBadge}${suppBadge}</div>
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
  updateDrawerSuppressBtn(entry);
  $("memoryDrawer").classList.remove("hidden");
  $("memoryDrawer").scrollIntoView({ behavior: "smooth", block: "start" });
}

function updateDrawerSuppressBtn(p) {
  const btn = $("drawerSuppressBtn");
  if (!btn || !p) return;
  const suppressed = isSuppressed(p.email);
  btn.textContent = suppressed ? "⊘ Unsuppress" : "⊘ Suppress Email";
  btn.classList.toggle("btn-suppress-active", suppressed);
  btn.disabled = false;
}

async function markEmailSent(prospectId) {
  const p = _crmProspects.find((x) => x.id === prospectId);
  if (!p) return;
  const currentIdx = p.active_email_idx || 1;
  const nextIdx = currentIdx >= 4 ? 5 : currentIdx + 1;
  await crmUpdateFields(prospectId, {
    last_email_sent_at: new Date().toISOString(),
    active_email_idx: nextIdx,
    updated_at: new Date().toISOString(),
  });
  renderMemoryList();
  const updated = _crmProspects.find((x) => x.id === prospectId);
  if (updated) renderDrawerTab('emails', updated);
}

// Returns the text for a single email (supports old sequence format + new e1-e4 format)
function getEmailText(emails, idx) {
  if (!emails) return "";
  // New per-email format
  if (emails[`e${idx}`]) return emails[`e${idx}`];
  // Old all-in-one format — return full sequence for E1 only
  if (idx === 1) return emails.sequence || emails.a || "";
  return "";
}

// Returns true if the prospect has any emails in new per-email format
function isNewEmailFormat(emails) {
  return !!(emails?.e1 || emails?.e2 || emails?.e3 || emails?.e4);
}

async function generateNextEmail(prospectId, emailNum) {
  const entry = _crmProspects.find((x) => x.id === prospectId);
  if (!entry) return;

  const content = $("drawerContent");
  const btn = $(`#genEmail${emailNum}Btn`);
  if (btn) { btn.textContent = `Generating E${emailNum}…`; btn.disabled = true; }

  const streamBox = $("drawerEmailStream");
  if (streamBox) { streamBox.textContent = ""; streamBox.style.display = "block"; }

  const icp  = getIcp();
  const sender = getSender();
  const previousEmails = {
    e1: entry.emails?.e1 || "",
    e2: entry.emails?.e2 || "",
    e3: entry.emails?.e3 || "",
  };

  try {
    const text = await postStream(
      "/api/chain/run",
      {
        prospect: { name: entry.name, title: entry.title, company: entry.company,
                    domain: entry.domain, email: entry.email },
        icp,
        senderProfile: sender,
        step: "outreach",
        emailNumber: emailNum,
        dossier: entry.dossier || "",
        previousEmails,
      },
      (_, full) => { if (streamBox) streamBox.textContent = full; }
    );

    const emailContent = (typeof text === "string" ? text : text?.content) || "";
    if (!emailContent) { if (btn) { btn.textContent = `Generate E${emailNum}`; btn.disabled = false; } return; }

    // Merge new email into existing emails object
    const updatedEmails = { ...(entry.emails || {}), [`e${emailNum}`]: emailContent };
    await crmUpdateFields(prospectId, { emails: updatedEmails, updated_at: new Date().toISOString() });
    if (streamBox) streamBox.style.display = "none";
    const updated = _crmProspects.find((x) => x.id === prospectId);
    if (updated) renderDrawerTab("emails", updated);
  } catch (e) {
    if (streamBox) streamBox.textContent = "Error: " + e.message;
    if (btn) { btn.textContent = `Generate E${emailNum}`; btn.disabled = false; }
  }
}

function renderDrawerTab(tab, entry) {
  const content = $("drawerContent");
  document.querySelectorAll(".dtab").forEach((t) => t.classList.toggle("active", t.dataset.dtab === tab));
  const clearBtn = $("drawerClearContent");
  if (clearBtn) clearBtn.style.display = (tab === "emails" || tab === "linkedin") ? "inline-flex" : "none";

  if (tab === "dossier") {
    content.innerHTML = `<pre class="drawer-pre">${entry.dossier || "No dossier yet — run the Agent Chain first."}</pre>`;
  } else if (tab === "emails") {
    const idx  = entry.active_email_idx || 1;
    const due  = getEmailDueStatus(entry);
    const newFmt = isNewEmailFormat(entry.emails);
    const EMAIL_NAMES = { 1: 'E1 · Pain-led', 2: 'E2 · Trigger-led', 3: 'E3 · Curiosity', 4: 'E4 · Objection Pre-empt' };

    // Status bar (same logic as before)
    let statusBar = '';
    if (idx > 0 && idx <= 4) {
      const name = EMAIL_NAMES[idx] || `E${idx}`;
      let statusText, markLabel;
      if (!due) {
        statusText = 'Sequence complete — all 4 emails sent.';
      } else if (due.status === 'overdue') {
        statusText = `<span style="color:var(--err,#ff3b30)"><strong>${name}</strong> overdue by ${Math.abs(due.daysUntil)}d</span>`;
        markLabel = `✓ Mark E${idx} Sent →`;
      } else if (due.status === 'due') {
        statusText = `<strong>${name}</strong> — due now`;
        markLabel = `✓ Mark E${idx} Sent →`;
      } else {
        statusText = `<strong>${name}</strong> — due in ${due.daysUntil}d`;
        markLabel = `Mark E${idx} Sent`;
      }
      statusBar = `<div class="seq-status-bar">
        <span class="ssb-text">${statusText}</span>
        ${markLabel ? `<button class="btn btn-dark btn-sm" id="drawerMarkSent">${markLabel}</button>` : ''}
      </div>`;
    }

    if (newFmt) {
      // Per-email view with progress + generate buttons
      const progressPills = [1,2,3,4].map((n) => {
        const exists = !!getEmailText(entry.emails, n);
        const active = n === idx;
        return `<span class="email-prog-pill${exists ? ' prog-done' : ''}${active ? ' prog-active' : ''}">${EMAIL_NAMES[n] || `E${n}`}</span>`;
      }).join("");

      const currentEmailText = getEmailText(entry.emails, idx) || "";

      // Generate button for the NEXT email (only if current email exists and next doesn't)
      let genBtn = '';
      const nextIdx = idx <= 4 ? idx : null;
      if (nextIdx && nextIdx <= 4 && !getEmailText(entry.emails, nextIdx) && (nextIdx === 1 || getEmailText(entry.emails, nextIdx - 1))) {
        genBtn = `<button class="btn btn-dark btn-sm" id="genEmail${nextIdx}Btn">✦ Generate E${nextIdx}</button>`;
      }

      content.innerHTML = `
        ${statusBar}
        <div class="email-progress-bar">${progressPills}${genBtn ? `<div style="margin-left:auto">${genBtn}</div>` : ''}</div>
        <div id="drawerEmailStream" class="drawer-pre stream-box" style="display:none"></div>
        <pre class="drawer-pre">${currentEmailText || `E${idx} not yet generated — click "Generate E${idx}" above.`}</pre>`;
    } else {
      // Old format — show full sequence text
      const seq = entry.emails?.sequence || entry.emails?.a || "";
      content.innerHTML = `${statusBar}<pre class="drawer-pre">${seq || "No emails yet — run Generate Outreach."}</pre>`;
    }
  } else if (tab === "linkedin") {
    content.innerHTML = `<pre class="drawer-pre">${entry.linkedin_messages || "No LinkedIn copy yet."}</pre>`;
  } else if (tab === "cadence") {
    content.innerHTML = `<pre class="drawer-pre">${entry.cadence || "No 8-touch cadence yet — run Step 7."}</pre>`;
  } else if (tab === "objection") {
    content.innerHTML = `<pre class="drawer-pre">${entry.objection_response || "No objection handler yet."}</pre>`;
  }
}

// ─── Prospect Search ──────────────────────────────────────────────────────────
function wireProspectSearch() {
  const header = $("toggleProspectSearch");
  const body   = $("prospectSearchBody");
  if (header && body) {
    header.addEventListener("click", () => {
      const open = body.style.display !== "none";
      body.style.display = open ? "none" : "block";
      const arrow = header.querySelector(".ps-toggle-arrow");
      if (arrow) arrow.textContent = open ? "▼" : "▲";
    });
  }
  const btn = $("psSearchBtn");
  if (btn) btn.addEventListener("click", runProspectSearch);
}

async function runProspectSearch() {
  const btn      = $("psSearchBtn");
  const countEl  = $("psResultCount");
  const resultsEl = $("psResults");

  const titlesRaw  = ($("psTitle")?.value   || "").trim();
  const locRaw     = ($("psLocation")?.value || "").trim();
  const size       = $("psSize")?.value   || "";
  const keywords   = ($("psKeywords")?.value || "").trim();

  if (!titlesRaw && !locRaw && !keywords) {
    alert("Enter at least a job title, location, or keyword to search.");
    return;
  }

  const titles     = titlesRaw ? titlesRaw.split(",").map(t => t.trim()).filter(Boolean) : [];
  const locations  = locRaw    ? locRaw.split(",").map(l => l.trim()).filter(Boolean)    : [];
  const sizeRanges = size      ? [size] : [];

  btn.textContent = "Searching…"; btn.disabled = true;
  countEl.textContent = "";
  resultsEl.innerHTML = "";

  try {
    const res = await post("/api/apollo/search", { titles, locations, sizeRanges, keywords });
    if (res.error) { alert("Search failed: " + res.error); return; }

    const people = res.people || [];
    const total  = res.pagination?.total_entries;
    countEl.textContent = people.length
      ? `Showing ${people.length}${total ? " of " + total.toLocaleString() : ""} results`
      : "No results found.";

    if (!people.length) return;

    resultsEl.innerHTML = renderProspectResults(people);

    resultsEl.querySelectorAll(".ps-add-btn").forEach((addBtn) => {
      addBtn.addEventListener("click", async () => {
        const p = people[parseInt(addBtn.dataset.idx, 10)];
        addBtn.textContent = "Adding…"; addBtn.disabled = true;
        await saveProspectToMemory({
          name:     p.name             || "",
          title:    p.title            || "",
          company:  p.organization?.name || p.company || "",
          email:    p.email            || "",
          linkedin: p.linkedin_url     || "",
          location: [p.city, p.state, p.country].filter(Boolean).join(", "),
          domain:   p.organization?.website_url || "",
        }, {});
        addBtn.textContent = "Added ✓"; addBtn.disabled = true;
        renderMemoryList();
      });
    });
  } catch (e) {
    alert("Network error: " + e.message);
  } finally {
    btn.textContent = "Find Prospects"; btn.disabled = false;
  }
}

function renderProspectResults(people) {
  return people.map((p, i) => {
    const name     = p.name || "—";
    const title    = p.title || "";
    const company  = p.organization?.name || p.company || "—";
    const loc      = [p.city, p.state, p.country].filter(Boolean).join(", ");
    const emp      = p.organization?.estimated_num_employees;
    const email    = p.email || p.work_email || "";
    return `
      <div class="ps-result-row">
        <div class="ps-result-info">
          <div class="ps-result-name">${name}</div>
          <div class="ps-result-role">${title}${title && company ? " · " : ""}${company}</div>
          ${loc || emp ? `<div class="ps-result-loc">${loc}${loc && emp ? " · " : ""}${emp ? emp.toLocaleString() + " employees" : ""}</div>` : ""}
          ${email ? `<div class="ps-result-email">${email}</div>` : ""}
        </div>
        <button class="btn btn-outline btn-sm ps-add-btn" data-idx="${i}">+ CRM</button>
      </div>`;
  }).join("");
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

  const drawerClearBtn = $("drawerClearContent");
  if (drawerClearBtn) {
    drawerClearBtn.addEventListener("click", async () => {
      if (!_currentDrawerId) return;
      const activeTab = document.querySelector(".dtab.active")?.dataset.dtab;
      if (!confirm(`Clear stored ${activeTab} for this prospect? This cannot be undone.`)) return;
      const field = activeTab === "emails" ? { emails: null } : { linkedin_messages: null };
      drawerClearBtn.textContent = "Clearing…";
      await crmUpdateFields(_currentDrawerId, field);
      drawerClearBtn.textContent = "Clear";
      const entry = _crmProspects.find((p) => p.id === _currentDrawerId);
      if (entry) renderDrawerTab(activeTab, entry);
    });
  }

  const saveCrm = $("drawerSaveCrm");
  if (saveCrm) {
    saveCrm.addEventListener("click", async () => {
      if (!_currentDrawerId) return;
      const prevStatus = _crmProspects.find((p) => p.id === _currentDrawerId)?.status;
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
      try {
        await crmUpdateFields(_currentDrawerId, fields);
        const newStatus = fields.status;
        if (['replied', 'meeting', 'closed'].includes(newStatus) && newStatus !== prevStatus) {
          const classification = newStatus === 'meeting' ? 'meeting_booked'
                               : newStatus === 'closed'  ? 'opt_out'
                               : 'positive_interest';
          await logReplyToMemory(_currentDrawerId, fields.notes || '', classification);
          // Auto-suppress on opt-out / closed
          if (newStatus === 'closed') {
            const p = _crmProspects.find((x) => x.id === _currentDrawerId);
            if (p?.email) await suppressEmail(p.email, 'opt_out', p.id);
          }
        }
        saveCrm.textContent = "Saved ✓";
        setTimeout(() => { saveCrm.textContent = orig; saveCrm.disabled = false; }, 1500);
        renderMemoryList();
      } catch (e) {
        console.error("CRM save error:", e);
        saveCrm.textContent = "Save failed";
        saveCrm.disabled = false;
        alert(e.message || "Save failed — check console for details");
      }
    });
  }

  const drawerContent = $("drawerContent");
  if (drawerContent) {
    drawerContent.addEventListener("click", async (e) => {
      if (!_currentDrawerId) return;
      const markBtn = e.target.closest("#drawerMarkSent");
      if (markBtn) { markBtn.textContent = "Saving…"; markBtn.disabled = true; await markEmailSent(_currentDrawerId); return; }
      const genBtn = e.target.closest("[id^='genEmail'][id$='Btn']");
      if (genBtn) {
        const num = parseInt(genBtn.id.replace("genEmail", "").replace("Btn", ""), 10);
        if (num >= 1 && num <= 4) await generateNextEmail(_currentDrawerId, num);
      }
    });
  }

  // Suppress / Unsuppress button in drawer footer
  const drawerFooter = $("drawerFooterArea");
  if (drawerFooter) {
    drawerFooter.addEventListener("click", async (e) => {
      const btn = e.target.closest("#drawerSuppressBtn");
      if (!btn || !_currentDrawerId) return;
      const p = _crmProspects.find((x) => x.id === _currentDrawerId);
      if (!p?.email) return;
      const already = isSuppressed(p.email);
      btn.textContent = "…"; btn.disabled = true;
      if (already) {
        await unsuppressEmail(p.email);
      } else {
        await suppressEmail(p.email, 'manual', p.id);
      }
      updateDrawerSuppressBtn(p);
    });
  }

  // Suppression panel — manual add
  const suppAddBtn = $("suppAddBtn");
  if (suppAddBtn) {
    suppAddBtn.addEventListener("click", async () => {
      const inp = $("suppAddEmail");
      const email = (inp?.value || "").trim().toLowerCase();
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        alert("Enter a valid email address"); return;
      }
      suppAddBtn.textContent = "…"; suppAddBtn.disabled = true;
      await suppressEmail(email, 'manual');
      if (inp) inp.value = "";
      suppAddBtn.textContent = "Add"; suppAddBtn.disabled = false;
    });
  }

  // Toggle suppression panel
  const suppToggle = $("suppPanelToggle");
  const suppBody   = $("suppPanelBody");
  if (suppToggle && suppBody) {
    suppToggle.addEventListener("click", () => {
      const open = suppBody.style.display !== "none";
      suppBody.style.display = open ? "none" : "block";
      suppToggle.querySelector(".supp-toggle-arrow").textContent = open ? "▼" : "▲";
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
    _currentDossier = "";
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

        // Verify the returned company matches what was searched
        const searchedDomain = (p.domain || "").toLowerCase().replace(/^www\./, "");
        const searchedCompany = (p.company || "").toLowerCase();
        const returnedDomain = (org.primary_domain || "").toLowerCase().replace(/^www\./, "");
        const returnedCompany = (org.name || "").toLowerCase();

        const domainMatch = searchedDomain && returnedDomain && (
          returnedDomain === searchedDomain ||
          returnedDomain.includes(searchedDomain) ||
          searchedDomain.includes(returnedDomain)
        );
        const companyMatch = searchedCompany && returnedCompany && (
          returnedCompany.includes(searchedCompany.split(" ")[0]) ||
          searchedCompany.includes(returnedCompany.split(" ")[0])
        );
        const isCompanyMismatch = (searchedDomain || searchedCompany) && !domainMatch && !companyMatch;

        const snap = [
          isCompanyMismatch ? `⚠️ COMPANY MISMATCH — searched for "${p.company || p.domain}" but Apollo returned "${org.name || returnedDomain}". Verify before proceeding.` : "",
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
        if (!isCompanyMismatch) setStepDone(2);
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
      const { content, error } = await postStream("/api/chain/run", {
        prospect: p,
        icp: getIcp(),
        senderProfile: getSender(),
        step: "research",
        signalContext: $("signalContext").value,
      }, (_, full) => { $("dossierOut").textContent = full; });
      if (error) { $("dossierOut").textContent = "Error: " + error; return; }
      $("dossierOut").textContent = content;
      _currentDossier = content;

      // Save to prospect memory — clear stale emails so memory shows fresh state
      await saveProspectToMemory(p, {
        snapshot: $("snapshotOut").textContent,
        dossier: content,
        emails: null,
        linkedin: null,
      });
      if (document.getElementById("tab-campaigns")?.classList.contains("active")) renderMemoryList();

      // Extract score
      const scoreMatch = content.match(/Intelligence Score[:\s]*(\d+)/i);
      if (scoreMatch) $("dossierScore").textContent = scoreMatch[1] + " / 100";
      else $("dossierScore").textContent = "— / 100";

      setStepDone(3); setStepDone(4);

      updateCounters();
    } catch (e) { $("dossierOut").textContent = "Network error: " + e.message; }
    resetBtn(btn, "Run Agent 1 — Research →");
  });

  // Generate Outreach (emails + LinkedIn simultaneously)
  $("genOutreachBtn").addEventListener("click", async () => {
    const p = getProspect();
    const dossier = _currentDossier || $("dossierOut").textContent;
    const btn = $("genOutreachBtn");
    setRunning(btn, "Generate Outreach");

    ["a","b","c"].forEach((v) => {
      const e = $(`emailOut-${v}`);
      if (e) e.innerHTML = '<span class="email-empty">Generating…</span>';
    });
    $("liOut").innerHTML = '<span style="color:var(--text-3);font-style:italic">Generating…</span>';

    try {
      const sender = getSender();
      const fewShotExamples = await getSuccessfulPatterns(2);
      // Run cold emails + LinkedIn in parallel — both use SSE streaming
      const emailOutEl = $("emailOut-a");
      const liOutEl = $("liOut");
      const [emailRes, liRes] = await Promise.all([
        postStream("/api/chain/run", { prospect: p, icp: getIcp(), senderProfile: sender, step: "outreach", emailNumber: 1, dossier, fewShotExamples },
          (_, full) => { if (emailOutEl) emailOutEl.textContent = full; }),
        postStream("/api/chain/run", { prospect: p, icp: getIcp(), senderProfile: sender, step: "linkedin", dossier, linkedinPosts: $("linkedinPosts").value },
          (_, full) => { if (liOutEl) liOutEl.textContent = full; }),
      ]);

      const emailContent = emailRes.content || "";
      const liContent    = liRes.content   || "";

      if (emailContent) {
        $("emailOut-a").textContent = emailContent;
        updateCounters();
      }
      if (liContent) $("liOut").textContent = liContent;

      // Save E1 + LinkedIn to prospect memory
      await saveProspectToMemory(p, {
        emails: { e1: emailContent },
        linkedin: liContent,
      });
      if (document.getElementById("tab-campaigns")?.classList.contains("active")) renderMemoryList();

      setStepDone(5); setStepDone(6);
    } catch (e) {
      $("emailOut-a").textContent = "Network error: " + e.message;
    }
    resetBtn(btn, "Generate Outreach →");
  });


  // Build Follow-up Sequence
  $("buildSequenceBtn").addEventListener("click", async () => {
    const p = getProspect();
    const dossier = _currentDossier || "";
    const state   = $("sequenceState").value;
    const btn = $("buildSequenceBtn");
    btn.textContent = "Building…"; btn.disabled = true;
    $("followupOut").textContent = "Building 8-touch cadence — this takes 30–40 seconds…";
    $("followupOut").classList.remove("hidden");
    try {
      const { content, error } = await postStream("/api/chain/run", {
        prospect: p, icp: getIcp(), senderProfile: getSender(), step: "followup",
        dossier, sequenceState: state,
      }, (_, full) => { $("followupOut").textContent = full; });
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
      const { content, error } = await postStream("/api/chain/run", {
        prospect: getProspect(), icp: getIcp(), senderProfile: getSender(),
        step: "objection", reply,
      }, (_, full) => { $("objectionOut").textContent = full; });
      $("objectionOut").textContent = error ? "Error: " + error : content;
      if (!error) {
        setStepDone(8);
        const prospectId = await saveProspectToMemory(getProspect(), { objection: content });
        const classification = parseReplyClassification(content);
        await logReplyToMemory(prospectId, reply, classification);
      }
    } catch (e) { $("objectionOut").textContent = "Network error: " + e.message; }
    btn.textContent = "Classify & Draft Response"; btn.disabled = false;
  });
}

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  await initSupabase();
});
