// ── Utilities ────────────────────────────────────────────────────────────────

function esc(str) {
  return String(str ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function toast(msg, duration = 2800) {
  const node = document.getElementById("toast");
  node.textContent = msg;
  node.classList.add("show");
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => node.classList.remove("show"), duration);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast("Copied to clipboard.");
  } catch {
    toast("Copy failed — please select and copy manually.");
  }
}

function setLoading(btnId, loading) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.disabled = loading;
  btn.dataset.orig = btn.dataset.orig || btn.textContent;
  btn.textContent = loading ? "Working…" : btn.dataset.orig;
}

async function post(url, body) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.detail || data.error || `Request failed (${r.status})`);
  return data;
}

// ── Navigation ────────────────────────────────────────────────────────────────

function wireNavigation() {
  document.querySelectorAll(".nav-item").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".nav-item").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(`view-${btn.dataset.view}`).classList.add("active");
    });
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// MODULE 1 — ICP DEFINITION
// ═══════════════════════════════════════════════════════════════════════════════

const ICP_FIELDS = [
  "seedDescription", "roleSeniority", "companyStageSize", "responsibilityScope",
  "says", "thinks", "does", "feels",
  "pains", "fears", "frustrations", "dreamOutcomes"
];

const DEFAULT_ICP = {
  seedDescription: "Founders of a 50 crore B2B company, typically manufacturing, real estate, or expert-led B2B services like CA firms, architecture firms, and similar businesses.",
  roleSeniority: "Founder and Managing Director.",
  companyStageSize: "Post-survival SME with 50 crore annual turnover, transitioning from owner-led survival to professional management.",
  responsibilityScope: "Accountable for topline growth, major client relationships, high-level bank and investor relations, and capital allocation for expansion.",
  says: "We have the best product and service in the market, but sales is not consistent enough.\nGood talent is hard to find and harder to keep.\nThe way we did things at 5 crore will not get us to 100 crore.",
  thinks: "If I stop pushing for one week, will the momentum disappear?\nI am paying senior managers well, but am I still doing their work?\nMy competitors are younger and using technology better than I am.",
  does: "Intervenes in sales meetings because they do not fully trust the team.\nChecks bank balances and receivables personally.\nManages key projects through WhatsApp groups, verbal instructions, and trusted loyalists.",
  feels: "Feels the heavy weight of being the sole growth engine.\nFeels proud of the business, but quietly exhausted.\nFeels anxious that the market is changing faster than internal processes can adapt.",
  pains: "Revenue is stuck at a plateau and every new crore feels harder to earn.\nHigh dependency on the founder for major decisions.\nCash flow gaps despite a healthy order book.\nInability to attract and retain high-quality professional leadership.",
  fears: "The business may collapse or shrink if they step away for health or personal reasons.\nA smarter, tech-enabled competitor may steal key accounts.\nThey may be exposed as a small-time player when trying to win enterprise clients.\nTheir reputation for quality may erode as the company scales.",
  frustrations: "Spending most of the day firefighting instead of thinking strategically.\nThe team keeps making the same mistakes despite repeated instructions.\nData is scattered across spreadsheets, paper files, and people's heads.\nSales cycles are lengthening without a clear reason.",
  dreamOutcomes: "A dashboard that shows real-time business health without asking five people for reports.\nA self-managing leadership team that brings solutions, not just problems.\nPredictable month-on-month growth that does not require founder intervention.\nFreedom to spend time on expansion, new ventures, or family while the business grows."
};

function getIcp() {
  return Object.fromEntries(ICP_FIELDS.map(id => [id, document.getElementById(id)?.value?.trim() ?? ""]));
}

function setIcp(icp) {
  ICP_FIELDS.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = icp[id] || "";
  });
  persistIcp();
}

function persistIcp() {
  localStorage.setItem("apex.icp", JSON.stringify(getIcp()));
}

function loadIcp() {
  const saved = localStorage.getItem("apex.icp");
  try { setIcp({ ...DEFAULT_ICP, ...JSON.parse(saved || "{}") }); }
  catch { setIcp(DEFAULT_ICP); }
}

async function aiFill(section) {
  const el = document.getElementById(section);
  if (!el) return;
  const orig = el.value;
  el.value = "Generating…";
  el.disabled = true;
  try {
    const data = await post("/api/ai/icp-section", { section, icp: getIcp() });
    el.value = data.suggestion || orig;
    persistIcp();
    toast(data.source === "openai" ? "Field updated by AI." : "Draft field generated.");
  } catch (err) {
    el.value = orig;
    toast(err.message);
  } finally {
    el.disabled = false;
  }
}

function wireIcp() {
  ICP_FIELDS.forEach(id => {
    document.getElementById(id)?.addEventListener("input", persistIcp);
  });

  document.querySelectorAll("[data-ai]").forEach(btn => {
    btn.addEventListener("click", () => aiFill(btn.dataset.ai));
  });

  document.getElementById("restoreDefaults")?.addEventListener("click", () => {
    setIcp(DEFAULT_ICP);
    toast("Apex ICP restored.");
  });

  document.getElementById("generateAll")?.addEventListener("click", async () => {
    for (const f of ICP_FIELDS) await aiFill(f);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// MODULE 3 — AGENT CHAIN STATE
// ═══════════════════════════════════════════════════════════════════════════════

const CHAIN_KEY = "apex.chain";

function getChain() {
  try { return JSON.parse(localStorage.getItem(CHAIN_KEY) || "{}"); } catch { return {}; }
}

function saveChain(patch) {
  const chain = { ...getChain(), ...patch };
  localStorage.setItem(CHAIN_KEY, JSON.stringify(chain));
  return chain;
}

function clearChain() {
  localStorage.removeItem(CHAIN_KEY);
}

// ── Step unlock helper ────────────────────────────────────────────────────────

function unlock(stepId) {
  document.getElementById(stepId)?.classList.remove("locked");
}

function setStepStatus(id, text, type = "") {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.className = "step-status" + (type ? ` status-${type}` : "");
}

// ── Prospect input ────────────────────────────────────────────────────────────

function getProspectInputs() {
  return {
    firstName: document.getElementById("p-firstName")?.value.trim() || "",
    lastName: document.getElementById("p-lastName")?.value.trim() || "",
    title: document.getElementById("p-title")?.value.trim() || "",
    company: document.getElementById("p-company")?.value.trim() || "",
    domain: document.getElementById("p-domain")?.value.trim() || "",
    linkedinUrl: document.getElementById("p-linkedin")?.value.trim() || "",
    industry: document.getElementById("p-industry")?.value || ""
  };
}

function restoreProspectInputs(p) {
  if (!p) return;
  const m = {
    "p-firstName": p.firstName, "p-lastName": p.lastName, "p-title": p.title,
    "p-company": p.company, "p-domain": p.domain,
    "p-linkedin": p.linkedinUrl, "p-industry": p.industry
  };
  Object.entries(m).forEach(([id, val]) => {
    const el = document.getElementById(id);
    if (el && val) el.value = val;
  });
}

// ── Enrichment display ────────────────────────────────────────────────────────

function renderEnrichment(enrichment) {
  const p = enrichment.person || {};
  const c = enrichment.company || {};
  const src = enrichment.source === "apollo"
    ? '<span class="source-badge apollo">Apollo</span>'
    : '<span class="source-badge manual">Manual</span>';

  const rows = [
    { label: "Name", value: p.name || "—" },
    { label: "Title", value: p.title || "—" },
    { label: "Email", value: p.email ? `<span class="email-val">${esc(p.email)}</span> <span class="email-status ${p.emailStatus}">${p.emailStatus || ""}</span>` : "—" },
    { label: "Location", value: [p.city, p.country].filter(Boolean).join(", ") || "—" },
    { label: "Company", value: c.name || "—" },
    { label: "Industry", value: c.industry || "—" },
    { label: "Headcount", value: c.headcount ? `~${c.headcount.toLocaleString()} employees` : "unknown" },
    { label: "Website", value: c.website ? `<a href="${esc(c.website)}" target="_blank" rel="noopener">${esc(c.website)}</a>` : "—" },
    {
      label: "Tech Stack",
      value: c.techStack?.length
        ? c.techStack.map(t => `<span class="tech-pill">${esc(t)}</span>`).join("")
        : "unknown"
    },
    { label: "Funding", value: c.fundingTotal ? `$${(c.fundingTotal / 1_000_000).toFixed(1)}M (${c.latestFundingType || "unknown type"}, ${c.latestFundingDate?.split("-")[0] || "unknown year"})` : "bootstrapped / unknown" },
    { label: "Address", value: c.address || [c.city, c.state, c.country].filter(Boolean).join(", ") || "—" }
  ];

  const grid = document.getElementById("enrichmentGrid");
  grid.innerHTML = `
    <div class="enrichment-header">${src} <span class="enriched-at">Enriched ${new Date(enrichment.enrichedAt).toLocaleTimeString()}</span></div>
    <div class="e-rows">
      ${rows.map(r => `<div class="e-row"><span class="e-label">${r.label}</span><span class="e-val">${r.value}</span></div>`).join("")}
    </div>
  `;

  const emp = (p.employmentHistory || []).filter(e => e && e.organization_name);
  if (emp.length) {
    grid.innerHTML += `
      <div class="emp-history">
        <h4>Employment history</h4>
        ${emp.map(e => `<div class="emp-item"><strong>${esc(e.title || "")}</strong> at ${esc(e.organization_name || "")} <span class="muted">${e.start_date ? e.start_date.split("T")[0].slice(0, 7) : ""}${e.current ? " → present" : e.end_date ? ` → ${e.end_date.split("T")[0].slice(0, 7)}` : ""}</span></div>`).join("")}
      </div>
    `;
  }
}

// ── Dossier display ───────────────────────────────────────────────────────────

function renderDossier(dossier) {
  const score = dossier.score ?? 0;
  const badge = document.getElementById("scoreBadge");
  const val = document.getElementById("scoreValue");
  val.textContent = score;
  badge.className = "score-badge " + (score >= 80 ? "score-hot" : score >= 60 ? "score-warm" : score >= 40 ? "score-watch" : "score-cold");

  const qa = [
    { label: "3+ hooks", pass: (dossier.hooks || []).length >= 3 },
    { label: "Score reasoning", pass: !!(dossier.score_reasoning) },
    { label: "Cited pains", pass: (dossier.pains || []).every(p => p?.evidence) },
    { label: "Triggers found", pass: (dossier.triggers || []).length > 0 },
    { label: "Sources listed", pass: (dossier.sources || []).length > 0 }
  ];
  document.getElementById("qaStrip").innerHTML = qa.map(q =>
    `<span class="qa-badge ${q.pass ? "qa-pass" : "qa-fail"}">${q.pass ? "✓" : "✗"} ${q.label}</span>`
  ).join("");

  const snap = dossier.snapshot || {};
  const triggerHtml = (dossier.triggers || []).map(t => `
    <div class="trigger-item trigger-${esc(t.type || "other")}">
      <span class="trigger-type-pill">${esc(t.type || "other")}</span>
      <p>${esc(t.description)}</p>
      <small>${esc(t.date || "")} · ${esc(t.source || "")}</small>
    </div>
  `).join("") || "<p class='muted'>No triggers found — add signal context and re-run.</p>";

  const painHtml = (dossier.pains || []).map(p => `
    <div class="pain-item">
      <strong>${esc(p.pain)}</strong>
      <p>${esc(p.evidence)}</p>
      <span class="conf-badge conf-${esc(p.confidence)}">${esc(p.confidence)} confidence</span>
    </div>
  `).join("") || "<p class='muted'>No pains identified.</p>";

  const hookHtml = (dossier.hooks || []).map((h, i) => `
    <div class="hook-item">
      <div class="hook-row">
        <strong>Hook ${i + 1}</strong>
        <button class="mini-ai" data-copy="${esc(h.hook + "\n\nAngle: " + h.angle)}">Copy</button>
      </div>
      <p>${esc(h.hook)}</p>
      <p class="hook-angle">Angle: ${esc(h.angle)}</p>
      <small class="muted">Source: ${esc(h.source || "")}</small>
    </div>
  `).join("") || "<p class='muted'>No hooks generated.</p>";

  const stackHtml = (dossier.stack || []).map(s =>
    `<span class="tech-pill">${esc(s.tool)}</span>`
  ).join("") || "<span class='muted'>Unknown</span>";

  document.getElementById("dossierGrid").innerHTML = `
    <div class="dossier-card">
      <h4>Snapshot</h4>
      <dl class="snap-dl">
        <dt>HQ</dt><dd>${esc(snap.hq || "unknown")}</dd>
        <dt>Headcount</dt><dd>${esc(snap.headcount || "unknown")}</dd>
        <dt>Revenue</dt><dd>${esc(snap.revenue || "unknown")}</dd>
        <dt>Funding</dt><dd>${esc(snap.funding_stage || "unknown")}</dd>
        <dt>Growth</dt><dd>${esc(snap.growth_rate || "unknown")}</dd>
      </dl>
      <div style="margin-top:10px"><h4 style="margin-bottom:6px">Tech Stack</h4>${stackHtml}</div>
    </div>

    <div class="dossier-card">
      <h4>Triggers (${(dossier.triggers || []).length})</h4>
      ${triggerHtml}
    </div>

    <div class="dossier-card">
      <h4>Pain Points</h4>
      ${painHtml}
    </div>

    <div class="dossier-card">
      <h4>Personalization Hooks</h4>
      ${hookHtml}
    </div>

    <div class="dossier-card wide-dossier-card">
      <h4>Score Reasoning</h4>
      <p>${esc(dossier.score_reasoning || "")}</p>
      ${(dossier.sources || []).length ? `<p class="muted" style="margin-top:8px">Sources: ${dossier.sources.map(s => esc(s)).join(" · ")}</p>` : ""}
    </div>
  `;

  // Wire copy buttons in hooks
  document.querySelectorAll("#dossierGrid [data-copy]").forEach(btn => {
    btn.addEventListener("click", () => copyText(btn.dataset.copy));
  });

  // Gate for Generate Outreach button
  const genBtn = document.getElementById("generateOutreachBtn");
  const note = document.getElementById("gateNote");
  if (score >= 60) {
    genBtn.disabled = false;
    note.textContent = "";
  } else {
    genBtn.disabled = true;
    note.textContent = `Score ${score}/100 is below the 60 threshold. Add signal context and re-run Agent 1.`;
  }
}

// ── Email display ─────────────────────────────────────────────────────────────

let _emails = [];

function renderEmails(emails) {
  _emails = emails;
  const tabs = document.getElementById("emailTabs");

  function showEmail(type) {
    tabs.querySelectorAll(".vtab").forEach(t => t.classList.toggle("active", t.dataset.variant === type));
    const email = emails.find(e => e.type === type) || emails[0];
    if (!email) return;

    const fullText = `Subject: ${email.subject}\n\n${email.body}\n\n${email.cta}`;
    document.getElementById("emailPanel").innerHTML = `
      <div class="email-card">
        <div class="email-meta">
          <span class="email-type-badge">${esc(email.type)}</span>
          <span class="word-count">${email.word_count ?? "?"} words</span>
        </div>
        <div class="email-field">
          <label>Subject</label>
          <div class="email-subject-text">${esc(email.subject)}</div>
          <button class="mini-ai copy-inline" data-text="${esc(email.subject)}">Copy</button>
        </div>
        <div class="email-field">
          <label>Body</label>
          <div class="email-body-text">${esc(email.body).replace(/\n/g, "<br>")}</div>
        </div>
        <div class="email-field">
          <label>CTA</label>
          <div class="email-cta-text">${esc(email.cta)}</div>
        </div>
        <button class="primary-btn copy-email-full" data-text="${esc(fullText)}">Copy full email</button>
      </div>
    `;

    document.querySelectorAll("#emailPanel [data-text]").forEach(btn => {
      btn.addEventListener("click", () => copyText(btn.dataset.text));
    });
  }

  tabs.querySelectorAll(".vtab").forEach(tab => {
    tab.addEventListener("click", () => showEmail(tab.dataset.variant));
  });

  showEmail("pain-led");
}

// ── LinkedIn display ──────────────────────────────────────────────────────────

function renderLinkedIn(messages) {
  const { connection, day3_dm, day7_dm } = messages;
  const items = [
    { label: "Connection Note", key: "connection", limit: 280, data: connection },
    { label: "Day 3 DM", key: "day3", limit: 400, data: day3_dm },
    { label: "Day 7 Value DM", key: "day7", limit: 500, data: day7_dm }
  ];

  document.getElementById("linkedinGrid").innerHTML = items.map(item => {
    if (!item.data) return "";
    const text = item.data.text || "";
    const charCount = text.length;
    const overLimit = charCount > item.limit;
    return `
      <div class="li-card">
        <div class="li-card-hd">
          <strong>${item.label}</strong>
          <span class="char-count ${overLimit ? "over-limit" : ""}">${charCount}/${item.limit} chars</span>
        </div>
        <p class="li-text">${esc(text).replace(/\n/g, "<br>")}</p>
        <button class="mini-ai" data-text="${esc(text)}">Copy</button>
      </div>
    `;
  }).join("");

  document.querySelectorAll("#linkedinGrid [data-text]").forEach(btn => {
    btn.addEventListener("click", () => copyText(btn.dataset.text));
  });
}

// ── Sequence display ──────────────────────────────────────────────────────────

function renderSequence(sequence) {
  const touches = sequence.touches || [];
  if (!touches.length) {
    document.getElementById("sequenceList").innerHTML = "<p class='muted'>No sequence generated.</p>";
    return;
  }

  const channelLabel = { email: "Email", linkedin: "LinkedIn DM" };
  const angleLabel = {
    new_value: "New value", pattern_interrupt: "Pattern interrupt",
    social_proof: "Social proof", direct_ask: "Direct ask",
    resource_drop: "Resource drop", breakup: "Warm breakup"
  };

  document.getElementById("sequenceList").innerHTML = touches.map(t => {
    const fullText = t.channel === "email"
      ? (t.subject ? `Subject: ${t.subject}\n\n` : "") + t.body
      : t.body;

    return `
      <div class="touch-card">
        <div class="touch-hd">
          <span class="touch-num">Touch ${t.touch}</span>
          <span class="touch-channel channel-${t.channel}">${channelLabel[t.channel] || t.channel}</span>
          <span class="touch-angle">${angleLabel[t.angle] || t.angle || ""}</span>
          <span class="touch-day">Day ${t.send_day}</span>
        </div>
        ${t.subject ? `<div class="touch-subject">Subject: ${esc(t.subject)}</div>` : ""}
        <p class="touch-body">${esc(t.body || "").replace(/\n/g, "<br>")}</p>
        ${t.branching_note ? `<div class="branching-note">${esc(t.branching_note)}</div>` : ""}
        <button class="mini-ai" data-text="${esc(fullText)}">Copy</button>
      </div>
    `;
  }).join("");

  document.querySelectorAll("#sequenceList [data-text]").forEach(btn => {
    btn.addEventListener("click", () => copyText(btn.dataset.text));
  });
}

// ── Objection display ─────────────────────────────────────────────────────────

function renderObjection(result) {
  const classColor = {
    positive_interest: "green", soft_no: "yellow", hard_no: "red",
    wrong_person: "orange", send_info: "blue", unsubscribe: "red", ambiguous: "gray"
  };

  const actionLabel = {
    continue: "Continue sequence", stop: "Stop — do not follow up",
    pause_60: "Pause 60 days", find_new_contact: "Find right contact",
    archive: "Archive — re-surface in 90 days"
  };

  const color = classColor[result.classification] || "gray";
  document.getElementById("objectionOutput").innerHTML = `
    <div class="objection-result">
      <div class="obj-hd">
        <span class="class-badge class-${color}">${esc(result.classification?.replace(/_/g, " ") || "")}</span>
        <span class="conf-badge conf-${esc(result.confidence)}">${esc(result.confidence)} confidence</span>
        <span class="action-tag">${actionLabel[result.action] || result.action || ""}</span>
      </div>
      <div class="obj-reasoning">${esc(result.reasoning || "")}</div>
      <div class="obj-draft">
        <label>Suggested response</label>
        <div class="draft-text">${esc(result.draft_response || "").replace(/\n/g, "<br>")}</div>
        <button class="primary-btn" data-text="${esc(result.draft_response || "")}">Copy response</button>
      </div>
      ${result.notes ? `<div class="obj-notes muted">${esc(result.notes)}</div>` : ""}
    </div>
  `;

  document.querySelectorAll("#objectionOutput [data-text]").forEach(btn => {
    btn.addEventListener("click", () => copyText(btn.dataset.text));
  });
}

// ── Stats counter ─────────────────────────────────────────────────────────────

function updateStats() {
  const chain = getChain();
  document.getElementById("statProspects").textContent = chain.prospect?.company ? 1 : 0;
  document.getElementById("statDossiers").textContent = chain.dossier ? 1 : 0;
  document.getElementById("statDrafts").textContent = chain.emails ? 1 : 0;
}

// ── Restore chain from localStorage ──────────────────────────────────────────

function restoreChain() {
  const chain = getChain();
  if (!chain.prospect) return;

  restoreProspectInputs(chain.prospect);
  setStepStatus("status-prospect", "saved", "done");

  if (chain.enrichment) {
    renderEnrichment(chain.enrichment);
    unlock("step-enrichment");
    unlock("step-signals-input");
    setStepStatus("status-enrichment", "enriched", "done");
  }

  if (chain.signalContext) {
    const sc = document.getElementById("signalContext");
    if (sc) sc.value = chain.signalContext;
  }

  if (chain.dossier) {
    renderDossier(chain.dossier);
    unlock("step-dossier");
    setStepStatus("status-prospect", "ready", "done");
  }

  if (chain.emails) {
    renderEmails(chain.emails);
    unlock("step-email");
    setStepStatus("status-email", "generated", "done");
  }

  if (chain.linkedin) {
    const lip = document.getElementById("linkedinPostsInput");
    if (lip && chain.linkedinPosts) lip.value = chain.linkedinPosts;
    renderLinkedIn(chain.linkedin);
    unlock("step-linkedin");
    setStepStatus("status-linkedin", "generated", "done");
  }

  if (chain.sequence) {
    if (chain.sequenceState) {
      const ss = document.getElementById("sequenceState");
      if (ss) ss.value = chain.sequenceState;
    }
    renderSequence(chain.sequence);
  }

  if (chain.objection) {
    const rt = document.getElementById("replyText");
    if (rt && chain.replyText) rt.value = chain.replyText;
    renderObjection(chain.objection);
  }
}

// ── Wire Agent Chain ──────────────────────────────────────────────────────────

function wireAgentChain() {
  // Clear prospect
  document.getElementById("clearChain")?.addEventListener("click", () => {
    if (!confirm("Clear this prospect and all generated output?")) return;
    clearChain();
    location.reload();
  });

  // Step 1 → Enrich
  document.getElementById("enrichBtn")?.addEventListener("click", async () => {
    const prospect = getProspectInputs();
    if (!prospect.firstName && !prospect.lastName) { toast("Enter at least a first or last name."); return; }
    if (!prospect.company && !prospect.domain) { toast("Enter a company name or domain."); return; }

    setLoading("enrichBtn", true);
    try {
      const enrichment = await post("/api/prospect/enrich", prospect);
      saveChain({ prospect, enrichment });

      renderEnrichment(enrichment);
      unlock("step-enrichment");
      unlock("step-signals-input");
      setStepStatus("status-enrichment",
        enrichment.source === "apollo" ? "enriched via Apollo" : "manual data",
        "done");
      toast(enrichment.source === "apollo" ? "Apollo enrichment complete." : "Manual data ready — connect APOLLO_API_KEY for live enrichment.");
      updateStats();
    } catch (err) {
      toast(err.message);
    } finally {
      setLoading("enrichBtn", false);
    }
  });

  // Step 1 → Research with Perplexity
  document.getElementById("researchBtn")?.addEventListener("click", async () => {
    const prospect = getProspectInputs();
    if (!prospect.firstName && !prospect.lastName) { toast("Enter at least a first or last name."); return; }
    if (!prospect.company && !prospect.domain) { toast("Enter a company name or domain."); return; }

    setLoading("researchBtn", true);
    try {
      const research = await post("/api/prospect/research", prospect);
      if (research.source === "no_key") {
        toast("Add PERPLEXITY_API_KEY to your .env file to enable web research.");
        return;
      }
      // Convert Perplexity research into enrichment format so downstream agents work
      const enrichment = {
        source: "perplexity",
        enrichedAt: research.enrichedAt,
        person: {
          name: research.person?.name || `${prospect.firstName} ${prospect.lastName}`.trim(),
          title: research.person?.title || prospect.title,
          linkedin: prospect.linkedinUrl,
          background: research.person?.background,
          recentActivity: research.person?.recentActivity
        },
        company: {
          name: research.company?.name || prospect.company,
          domain: prospect.domain,
          industry: prospect.industry,
          size: research.company?.size,
          revenue: research.company?.revenue,
          products: research.company?.products,
          clients: research.company?.clients,
          recentNews: research.company?.recentNews
        },
        signals: research.signals || [],
        painIndicators: research.painIndicators || [],
        growthSignals: research.growthSignals || []
      };

      // Pre-fill signal context with Perplexity's suggested context
      if (research.suggestedContext) {
        const sigCtx = document.getElementById("signalContext");
        if (sigCtx && !sigCtx.value) sigCtx.value = research.suggestedContext;
      }

      saveChain({ prospect, enrichment });
      renderEnrichment(enrichment);
      unlock("step-enrichment");
      unlock("step-signals-input");
      toast("Perplexity research complete — signals pre-filled");
    } catch (err) {
      toast(err.message);
    } finally {
      setLoading("researchBtn", false);
    }
  });

  // Step 3 → Agent 1
  document.getElementById("agent1Btn")?.addEventListener("click", async () => {
    const chain = getChain();
    if (!chain.prospect) { toast("Enrich a prospect first."); return; }

    const signals = document.getElementById("signalContext")?.value.trim() || "";
    saveChain({ signalContext: signals });

    setLoading("agent1Btn", true);
    try {
      const icp = getIcp();
      const res = await post("/api/agent/1-research", {
        prospect: chain.prospect,
        enrichment: chain.enrichment || {},
        signals,
        icp
      });

      const dossier = res.dossier;
      saveChain({ dossier });

      renderDossier(dossier);
      unlock("step-dossier");
      toast(res.source === "openai" ? "Dossier generated." : "Draft dossier ready — connect OPENAI_API_KEY for live research.");
      updateStats();

      // Scroll dossier into view
      document.getElementById("step-dossier")?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (err) {
      toast(err.message);
    } finally {
      setLoading("agent1Btn", false);
    }
  });

  // Step 4 → Generate Outreach (Agents 2 + 3 in parallel)
  document.getElementById("generateOutreachBtn")?.addEventListener("click", async () => {
    const chain = getChain();
    if (!chain.dossier) { toast("Run Agent 1 first."); return; }

    const btn = document.getElementById("generateOutreachBtn");
    btn.disabled = true;
    btn.textContent = "Generating emails and LinkedIn…";

    try {
      const [emailRes, liRes] = await Promise.allSettled([
        post("/api/agent/2-cold-email", { dossier: chain.dossier, prospect: chain.prospect }),
        post("/api/agent/3-linkedin", {
          dossier: chain.dossier,
          prospect: chain.prospect,
          linkedinPosts: document.getElementById("linkedinPostsInput")?.value.trim() || ""
        })
      ]);

      if (emailRes.status === "fulfilled") {
        const emails = emailRes.value.emails;
        saveChain({ emails });
        renderEmails(emails);
        unlock("step-email");
        setStepStatus("status-email", "generated", "done");
      } else {
        toast("Email generation failed: " + emailRes.reason?.message);
      }

      if (liRes.status === "fulfilled") {
        const li = liRes.value.messages || liRes.value;
        const linkedinPosts = document.getElementById("linkedinPostsInput")?.value.trim() || "";
        saveChain({ linkedin: li, linkedinPosts });
        renderLinkedIn(li);
        unlock("step-linkedin");
        setStepStatus("status-linkedin", "generated", "done");
      } else {
        toast("LinkedIn generation failed: " + liRes.reason?.message);
      }

      toast("Outreach generated. Review and copy.");
      updateStats();
      document.getElementById("step-email")?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (err) {
      toast(err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = "Generate Outreach →";
    }
  });

  // LinkedIn posts input triggers re-render note
  document.getElementById("linkedinPostsInput")?.addEventListener("input", () => {
    // Just save — user can re-generate if they add posts after the first run
  });

  // Step 7 → Agent 4 (follow-up sequence)
  document.getElementById("agent4Btn")?.addEventListener("click", async () => {
    const chain = getChain();
    if (!chain.dossier && !chain.prospect?.company) { toast("Enrich a prospect and run Agent 1 first."); return; }

    const state = document.getElementById("sequenceState")?.value || "no_open";
    setLoading("agent4Btn", true);
    try {
      const res = await post("/api/agent/4-sequence", {
        dossier: chain.dossier || {},
        prospect: chain.prospect || {},
        state
      });
      const sequence = res.sequence;
      saveChain({ sequence, sequenceState: state });
      renderSequence(sequence);
      toast(res.source === "openai" ? "Sequence generated." : "Draft sequence ready — connect OPENAI_API_KEY for personalised touches.");
    } catch (err) {
      toast(err.message);
    } finally {
      setLoading("agent4Btn", false);
    }
  });

  // Step 8 → Agent 5 (objection handler)
  document.getElementById("agent5Btn")?.addEventListener("click", async () => {
    const replyText = document.getElementById("replyText")?.value.trim();
    if (!replyText) { toast("Paste a reply to classify."); return; }

    const chain = getChain();
    setLoading("agent5Btn", true);
    try {
      const res = await post("/api/agent/5-objection", {
        reply: replyText,
        dossier: chain.dossier || {},
        prospect: chain.prospect || {}
      });
      const result = res.result;
      saveChain({ objection: result, replyText });
      renderObjection(result);
      toast(res.source === "openai" ? "Reply classified." : "Draft classification — connect OPENAI_API_KEY for accurate results.");
    } catch (err) {
      toast(err.message);
    } finally {
      setLoading("agent5Btn", false);
    }
  });
}

// ── Sidebar API status ────────────────────────────────────────────────────────

async function checkApiStatus() {
  try {
    const status = await fetch("/api/status").then(r => r.json());
    document.getElementById("sdot-apollo").className = "sdot " + (status.apollo ? "sdot-on" : "sdot-off");
    document.getElementById("sdot-openai").className = "sdot " + (status.openai ? "sdot-on" : "sdot-off");
    const pDot = document.getElementById("sdot-perplexity");
    if (pDot) pDot.className = "sdot " + (status.perplexity ? "sdot-on" : "sdot-off");
    if (status.apollo && status.openai) {
      document.getElementById("sidebarHint").textContent = `All systems live · ${status.agentModel}`;
    } else {
      const missing = [!status.apollo && "APOLLO_API_KEY", !status.openai && "OPENAI_API_KEY"].filter(Boolean);
      document.getElementById("sidebarHint").textContent = `Missing: ${missing.join(", ")}`;
    }
  } catch {
    document.getElementById("sidebarHint").textContent = "Could not reach server.";
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────

loadIcp();
wireNavigation();
wireIcp();
wireAgentChain();
restoreChain();
updateStats();
checkApiStatus();
