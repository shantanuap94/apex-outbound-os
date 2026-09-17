// ─── Constants ────────────────────────────────────────────────────────────────
const API = "";

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

  $("restoreIcpBtn").addEventListener("click", () => fillIcpFromObj(APEX_ICP));

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
      const query = `Latest news about ${p.company}${p.domain ? " (" + p.domain + ")" : ""}: recent expansions, hiring announcements, awards, new clients, or leadership changes in the last 90 days.`;
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
        step: "research",
        signalContext: $("signalContext").value,
      });
      if (error) { $("dossierOut").textContent = "Error: " + error; return; }
      $("dossierOut").textContent = content;
      localStorage.setItem("apex.currentDossier", content);

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
      // Run cold emails + LinkedIn in parallel
      const [emailRes, liRes] = await Promise.all([
        post("/api/chain/run", { prospect: p, icp: getIcp(), step: "outreach", dossier }),
        post("/api/chain/run", { prospect: p, icp: getIcp(), step: "linkedin", dossier, linkedinPosts: $("linkedinPosts").value }),
      ]);

      // Parse 3 email variants from response
      if (emailRes.content) {
        const raw = emailRes.content;
        const aMatch = raw.match(/VARIANT A[\s\S]*?(?=VARIANT B|$)/i)?.[0] || "";
        const bMatch = raw.match(/VARIANT B[\s\S]*?(?=VARIANT C|$)/i)?.[0] || "";
        const cMatch = raw.match(/VARIANT C[\s\S]*/i)?.[0] || "";
        $("emailOut-a").textContent = aMatch.trim() || raw;
        $("emailOut-b").textContent = bMatch.trim() || "See Variant A";
        $("emailOut-c").textContent = cMatch.trim() || "See Variant A";

        const count = parseInt(localStorage.getItem("apex.draftCount") || "0", 10) + 3;
        localStorage.setItem("apex.draftCount", count);
        updateCounters();
      }

      if (liRes.content) {
        $("liOut").textContent = liRes.content;
      }

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
    $("followupOut").textContent = "Generating sequence…";
    $("followupOut").classList.remove("hidden");
    try {
      const { content, error } = await post("/api/chain/run", {
        prospect: p, icp: getIcp(), step: "followup",
        dossier, sequenceState: state,
      });
      $("followupOut").textContent = error ? "Error: " + error : content;
      if (!error) setStepDone(7);
    } catch (e) { $("followupOut").textContent = "Network error: " + e.message; }
    btn.textContent = "Build Sequence"; btn.disabled = false;
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
        prospect: getProspect(), icp: getIcp(),
        step: "objection", reply,
      });
      $("objectionOut").textContent = error ? "Error: " + error : content;
      if (!error) setStepDone(8);
    } catch (e) { $("objectionOut").textContent = "Network error: " + e.message; }
    btn.textContent = "Classify & Draft Response"; btn.disabled = false;
  });
}

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  wireTabs();
  wireIcp();
  wireChain();
  checkApiStatus();
  setInterval(checkApiStatus, 30000);
});
