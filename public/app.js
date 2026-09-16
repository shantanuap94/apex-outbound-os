// ─── Constants ────────────────────────────────────────────────────────────────
const API = "";  // same origin

const DEFAULT_APOLLO_URL = [
  "https://app.apollo.io/#/people",
  "?sortByField=recommendations&sortAscending=false&page=1",
  "&personTitles[]=Founder",
  "&personTitles[]=Managing+Director",
  "&personTitles[]=MD",
  "&personTitles[]=CEO",
  "&personTitles[]=Chief+Executive+Officer",
  "&personLocations[]=India",
  "&organizationNumEmployeesRanges[]=21,50",
  "&organizationNumEmployeesRanges[]=51,100",
  "&organizationNumEmployeesRanges[]=101,200",
  "&organizationNumEmployeesRanges[]=201,500",
].join("");

const ICP_FIELDS = ["companyName","website","industry","headcount","revenue","location","painPoints","goals","triggers","objections","notes"];
const POLL_INTERVAL_MS = 8000;
const POLL_MAX = 75;  // ~10 min

// ─── Utility ──────────────────────────────────────────────────────────────────
const $  = (id) => document.getElementById(id);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e; };

function post(path, body) {
  return fetch(API + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => r.json());
}

function get(path) {
  return fetch(API + path).then((r) => r.json());
}

// ─── API Status ───────────────────────────────────────────────────────────────
async function checkApiStatus() {
  try {
    const s = await get("/api/status");
    const keys = ["openai", "apollo", "perplexity", "apify"];
    keys.forEach((k) => {
      const dot = $(`sdot-${k}`);
      const card = $(`sc-${k}`);
      const val = $(`sc-${k}-val`);
      if (dot) { dot.className = "sdot " + (s[k] ? "on" : "off"); }
      if (card) { card.className = "status-card " + (s[k] ? "ok" : "err"); }
      if (val)  { val.textContent = s[k] ? "Connected ✓" : "Not set"; }
    });

    const genBtn = $("generateLeadsBtn");
    if (genBtn) genBtn.disabled = !s.apify;
  } catch (e) {
    console.warn("Status check failed:", e.message);
  }
}

// ─── Tab navigation ───────────────────────────────────────────────────────────
function switchTab(tabId) {
  document.querySelectorAll(".tab-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.tab === tabId);
  });
  document.querySelectorAll(".tab-panel").forEach((p) => {
    p.classList.toggle("active", p.id === `tab-${tabId}`);
  });
}

function wireTabs() {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
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

function wireIcp() {
  loadSavedIcp();

  $("icpFillBtn").addEventListener("click", async () => {
    const desc = $("icpDesc").value.trim();
    if (!desc) return;
    const btn = $("icpFillBtn");
    btn.textContent = "Filling…";
    btn.disabled = true;
    try {
      const { icp, error } = await post("/api/icp/fill", { description: desc });
      if (error) { alert("Error: " + error); return; }
      ICP_FIELDS.forEach((f) => {
        const inp = $(`icp-${f}`);
        if (inp && icp[f]) inp.value = icp[f];
      });
    } catch (e) {
      alert("Network error: " + e.message);
    } finally {
      btn.textContent = "Fill with AI";
      btn.disabled = false;
    }
  });

  $("icpSaveBtn").addEventListener("click", saveIcp);

  $("icpClearBtn").addEventListener("click", () => {
    ICP_FIELDS.forEach((f) => { const inp = $(`icp-${f}`); if (inp) inp.value = ""; });
    $("icpDesc").value = "";
  });
}

// ─── Agent Chain ──────────────────────────────────────────────────────────────
const chainHistory = [];

function loadLeadIntoChain(lead) {
  const name = [lead.first_name, lead.last_name].filter(Boolean).join(" ") || lead.name || "";
  $("prospectName").value     = name;
  $("prospectTitle").value    = lead.title || lead.job_title || "";
  $("prospectCompany").value  = lead.organization_name || lead.company || "";
  $("prospectEmail").value    = lead.email || lead.work_email || "";
  $("prospectLinkedin").value = lead.linkedin_url || lead.person_linkedin_url || "";
  $("prospectIndustry").value = lead.organization_industry || lead.industry || "";
  $("prospectNotes").value    = `Score: ${lead._score}/100. Headcount: ${lead.num_employees || "?"}. Location: ${lead.city || ""} ${lead.country || "India"}.`;

  chainHistory.length = 0;
  $("chainOutput").innerHTML = "";
  $("chainLoadedBadge").classList.remove("hidden");

  switchTab("chain");
}

function getProspect() {
  return {
    name:     $("prospectName").value,
    title:    $("prospectTitle").value,
    company:  $("prospectCompany").value,
    email:    $("prospectEmail").value,
    linkedin: $("prospectLinkedin").value,
    industry: $("prospectIndustry").value,
    notes:    $("prospectNotes").value,
  };
}

function appendChainStep(step, content) {
  const out = $("chainOutput");
  const empty = out.querySelector(".output-empty");
  if (empty) empty.remove();

  const labels = { research: "Research", hook: "Opening Hooks", email: "Cold Email", linkedin: "LinkedIn DM", sequence: "Full Sequence" };
  const block = el("div", "step-block");
  block.appendChild(el("div", "step-label", labels[step] || step));
  block.appendChild(el("div", "step-content", content.replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>")));
  out.appendChild(block);
  out.scrollTop = out.scrollHeight;
}

function wireChain() {
  document.querySelectorAll(".chain-step-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const step = btn.dataset.step;
      const prospect = getProspect();
      if (!prospect.name && !prospect.company) {
        alert("Fill in at least the prospect name or company first.");
        return;
      }

      btn.classList.add("running");
      btn.textContent = btn.textContent.replace("…", "") + "…";
      btn.disabled = true;

      try {
        const { content, error } = await post("/api/chain/run", {
          prospect,
          icp: getIcp(),
          step,
          history: chainHistory.slice(-6),
        });
        if (error) { appendChainStep(step, "Error: " + error); return; }
        appendChainStep(step, content);
        chainHistory.push({ role: "user", content: step });
        chainHistory.push({ role: "assistant", content });
      } catch (e) {
        appendChainStep(step, "Network error: " + e.message);
      } finally {
        btn.classList.remove("running");
        btn.textContent = btn.textContent.replace("…", "");
        btn.disabled = false;
      }
    });
  });

  $("chainClearBtn").addEventListener("click", () => {
    $("chainOutput").innerHTML = '<span class="output-empty">Select a step above to generate content…</span>';
    chainHistory.length = 0;
    $("chainLoadedBadge").classList.add("hidden");
  });
}

// ─── Lead Pipeline ────────────────────────────────────────────────────────────
function scoreBand(score) {
  if (score >= 70) return "hot";
  if (score >= 50) return "warm";
  if (score >= 30) return "watch";
  return "cold";
}

function renderLeadCard(lead) {
  const band = scoreBand(lead._score);
  const name = [lead.first_name, lead.last_name].filter(Boolean).join(" ") || lead.name || "—";
  const title = lead.title || lead.job_title || "";
  const company = lead.organization_name || lead.company || "";
  const hc = lead.num_employees || lead.headcount || "";
  const ind = lead.organization_industry || lead.industry || "";
  const hasEmail = !!(lead.email || lead.work_email);
  const hasLi = !!(lead.linkedin_url || lead.person_linkedin_url);

  const card = el("div", "lead-card");
  card.innerHTML = `
    <div class="lead-card-top">
      <div class="lead-names">
        <div class="ln-name">${name}</div>
        ${title ? `<div class="ln-title">${title}</div>` : ""}
        ${company ? `<div class="ln-company">${company}</div>` : ""}
      </div>
      <div class="lead-score-mini lsm-${band}">${lead._score}</div>
    </div>
    <div class="lead-chips">
      ${hasEmail ? '<span class="lead-chip lc-email">✉ Email</span>' : ""}
      ${hasLi    ? '<span class="lead-chip lc-linkedin">in LinkedIn</span>' : ""}
      ${hc       ? `<span class="lead-chip lc-hc">${hc} emp</span>` : ""}
      ${ind      ? `<span class="lead-chip lc-industry">${ind}</span>` : ""}
    </div>
    <button class="lead-load-btn">Load into Chain →</button>
  `;
  card.querySelector(".lead-load-btn").addEventListener("click", () => loadLeadIntoChain(lead));
  return card;
}

function renderLeadPipeline(leads) {
  const grid = $("leadsGrid");
  grid.innerHTML = "";
  leads.forEach((lead) => grid.appendChild(renderLeadCard(lead)));

  const pipeWrap = $("pipelineWrap");
  pipeWrap.classList.remove("hidden");

  const hot  = leads.filter((l) => l._score >= 70).length;
  const warm = leads.filter((l) => l._score >= 50 && l._score < 70).length;
  $("pipeCount").textContent = `${leads.length} leads — ${hot} hot, ${warm} warm`;
}

function leadsToCSV(leads) {
  const cols = ["name", "title", "company", "email", "linkedin_url", "industry", "num_employees", "city", "country", "_score"];
  const header = cols.join(",");
  const rows = leads.map((l) =>
    cols.map((c) => {
      const val = [l.first_name, l.last_name].filter(Boolean).join(" ") && c === "name"
        ? [l.first_name, l.last_name].filter(Boolean).join(" ")
        : (l[c] || "");
      return `"${String(val).replace(/"/g, '""')}"`;
    }).join(",")
  );
  return [header, ...rows].join("\n");
}

function wireCampaigns() {
  $("useDefaultUrlBtn").addEventListener("click", () => {
    $("apolloSearchUrl").value = DEFAULT_APOLLO_URL;
  });

  let pollTimer = null;
  let pollCount = 0;
  let currentLeads = JSON.parse(localStorage.getItem("apex.leads") || "null");

  if (currentLeads && currentLeads.length) {
    renderLeadPipeline(currentLeads);
  }

  $("generateLeadsBtn").addEventListener("click", async () => {
    const searchUrl = $("apolloSearchUrl").value.trim();
    if (!searchUrl) { alert("Paste an Apollo search URL first."); return; }

    const maxLeads = parseInt($("maxLeads").value || "50", 10);
    const actorId  = $("apifyActorId").value.trim() || "curious_coder~apollo-io-scraper";

    $("generateLeadsBtn").disabled = true;
    $("genProgress").classList.remove("hidden");
    $("genProgressText").textContent = "Starting Apify actor…";
    pollCount = 0;

    let runId, datasetId;
    try {
      const result = await post("/api/leads/generate", { searchUrl, maxLeads, actorId });
      if (result.error) { alert("Error: " + result.error); return; }
      runId = result.runId;
      datasetId = result.datasetId;
    } catch (e) {
      alert("Network error: " + e.message);
      $("generateLeadsBtn").disabled = false;
      $("genProgress").classList.add("hidden");
      return;
    }

    $("genProgressText").textContent = `Run started (${runId.slice(0,8)}…). Polling for results…`;

    clearInterval(pollTimer);
    pollTimer = setInterval(async () => {
      pollCount++;
      if (pollCount > POLL_MAX) {
        clearInterval(pollTimer);
        $("genProgressText").textContent = "Timeout — run may still be processing in Apify.";
        $("generateLeadsBtn").disabled = false;
        return;
      }

      try {
        const status = await get(`/api/leads/run/${runId}`);
        $("genProgressText").textContent = `Status: ${status.status} (poll ${pollCount}/${POLL_MAX})…`;

        if (status.status === "SUCCEEDED") {
          clearInterval(pollTimer);
          $("genProgressText").textContent = "Fetching results…";
          const { leads, error } = await get(`/api/leads/results/${status.datasetId || datasetId}`);
          if (error) { $("genProgressText").textContent = "Error: " + error; return; }

          localStorage.setItem("apex.leads", JSON.stringify(leads));
          renderLeadPipeline(leads);
          $("genProgress").classList.add("hidden");
          $("generateLeadsBtn").disabled = false;
        }

        if (status.status === "FAILED" || status.status === "ABORTED") {
          clearInterval(pollTimer);
          $("genProgressText").textContent = `Run ${status.status}. Check Apify console.`;
          $("generateLeadsBtn").disabled = false;
        }
      } catch (e) {
        $("genProgressText").textContent = `Poll error: ${e.message}`;
      }
    }, POLL_INTERVAL_MS);
  });

  $("exportCsvBtn").addEventListener("click", () => {
    const leads = JSON.parse(localStorage.getItem("apex.leads") || "[]");
    if (!leads.length) return;
    const blob = new Blob([leadsToCSV(leads)], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `apex-leads-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
  });

  $("clearLeadsBtn").addEventListener("click", () => {
    localStorage.removeItem("apex.leads");
    $("leadsGrid").innerHTML = "";
    $("pipelineWrap").classList.add("hidden");
  });
}

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  wireTabs();
  wireIcp();
  wireChain();
  wireCampaigns();
  checkApiStatus();
  setInterval(checkApiStatus, 30000);
});
