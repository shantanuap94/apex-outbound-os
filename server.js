require("dotenv").config();
const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");

const PORT = 4173;

const MIME = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try { resolve(JSON.parse(body)); } catch { resolve({}); }
    });
    req.on("error", reject);
  });
}

function json(res, data, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

// ─── Apify ───────────────────────────────────────────────────────────────────
async function apifyRunActor(actorId, input) {
  const key = process.env.APIFY_API_KEY;
  const safeId = actorId.replace("/", "~");
  const r = await fetch(`https://api.apify.com/v2/acts/${encodeURIComponent(safeId)}/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
    body: JSON.stringify(input),
  });
  const data = await r.json();
  if (!data.data) throw new Error(JSON.stringify(data));
  return { runId: data.data.id, datasetId: data.data.defaultDatasetId };
}

// ─── Quick Score ──────────────────────────────────────────────────────────────
function quickScoreLead(lead) {
  let score = 0;
  const title = (lead.title || lead.job_title || "").toLowerCase();
  const hc = parseInt(lead.num_employees || lead.headcount || lead.employees || 0, 10);
  const ind = (lead.organization_industry || lead.industry || "").toLowerCase();
  const email = lead.email || lead.work_email || "";
  const linkedin = lead.linkedin_url || lead.person_linkedin_url || "";

  if (/\bfounder\b|\bceo\b|chief executive|\bmd\b|managing director/.test(title)) score += 30;
  else if (/\bdirector\b|\bvp\b|vice president|\bhead of\b/.test(title)) score += 15;

  if (hc >= 30 && hc <= 400) score += 25;
  else if (hc > 0 && hc < 30) score += 10;

  if (/manufactur|fabricat|industrial/.test(ind)) score += 15;
  else if (/real estate|property|realt/.test(ind)) score += 15;
  else if (/architect/.test(ind)) score += 15;
  else if (/account|chartered accountant|\bca\b|audit/.test(ind)) score += 15;
  else score += 5;

  if (email) score += 10;
  if (linkedin) score += 5;

  return Math.min(score, 100);
}

// ─── Handlers ────────────────────────────────────────────────────────────────
async function handleStatus(req, res) {
  json(res, {
    openai: !!process.env.OPENAI_API_KEY,
    apollo: !!process.env.APOLLO_API_KEY,
    perplexity: !!process.env.PERPLEXITY_API_KEY,
    apify: !!process.env.APIFY_API_KEY,
  });
}

async function handleIcpFill(req, res) {
  try {
    const body = await readBody(req);
    const { description, field } = body;

    // Single-field fill: return {value: "..."}
    if (field) {
      const fieldDescriptions = {
        roleSeniority: "The seniority level and title of the ideal buyer persona (e.g. Founder, MD, VP Sales)",
        companyStageSize: "The company stage and size that fits this ICP (e.g. post-survival SME with 50 crore turnover)",
        responsibilityScope: "What this person is accountable for day-to-day in their role",
        empathySayLoud: "What they say publicly — to their team, investors, peers. 3 example quotes.",
        empathyThinkPrivately: "What they privately think but won't say out loud. 3 example thoughts.",
        empathyActuallyDo: "How they actually behave under pressure — their real actions, not stated intentions.",
        empathyFeel: "How they feel emotionally about their business situation right now. 3 feelings.",
        pains: "The functional pain points — broken processes, plateaus, failures they experience regularly.",
        fears: "Their deep fears — what failure looks like, what keeps them up at night.",
        frustrations: "Day-to-day frustrations — people, processes, market conditions that grind them down.",
        dreamOutcomes: "What success looks like — the outcomes they dream about for their business and career.",
      };
      const fieldPrompt = fieldDescriptions[field] || `Generate a value for the ICP field: ${field}`;
      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          messages: [
            {
              role: "system",
              content: "You are a B2B sales strategist and psychographic profiler. Return a concise, specific, insight-driven value for the requested ICP field. Be concrete — avoid corporate buzzwords. Return only the value text, no labels or JSON.",
            },
            { role: "user", content: `ICP Seed Description: ${description || ""}\n\nGenerate the value for this field: ${fieldPrompt}` },
          ],
          max_tokens: 300,
        }),
      });
      const data = await r.json();
      const value = data.choices?.[0]?.message?.content?.trim();
      return json(res, { value });
    }

    // Full ICP fill: return {icp: {...}}
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        messages: [
          {
            role: "system",
            content: `You are a B2B sales strategist and psychographic profiler. Given a seed description, generate a full ICP profile as JSON with exactly these fields:
- seedDescription (keep or improve the original)
- roleSeniority
- companyStageSize
- responsibilityScope
- empathySayLoud (3 example quotes they say publicly)
- empathyThinkPrivately (3 private thoughts they won't say)
- empathyActuallyDo (their real behaviours under pressure)
- empathyFeel (3 emotional states they experience)
- pains (functional pain points, 3-5 bullet points)
- fears (deep fears and failure scenarios, 3-5 bullet points)
- frustrations (day-to-day frustrations, 3-5 bullet points)
- dreamOutcomes (success outcomes they desire, 3-5 bullet points)
Be specific, concrete, and insight-driven. Avoid buzzwords. Return only valid JSON.`,
          },
          { role: "user", content: description || "" },
        ],
        response_format: { type: "json_object" },
        max_tokens: 1500,
      }),
    });
    const data = await r.json();
    const content = data.choices?.[0]?.message?.content;
    json(res, { icp: JSON.parse(content) });
  } catch (e) {
    json(res, { error: e.message }, 500);
  }
}

async function handleChainRun(req, res) {
  try {
    const body = await readBody(req);
    const { prospect, icp, step, dossier, signalContext, linkedinPosts, sequenceState, reply } = body;

    const systemPrompt = `You are an expert B2B sales intelligence analyst and outreach strategist.
ICP Context (what the sender sells / their target customer): ${JSON.stringify(icp || {})}
Your job: produce sharp, specific, insight-led sales intelligence and outreach copy. Never be generic. Always tie insights back to why the sender's offering is relevant to this specific prospect.`;

    const p = prospect.name || "this prospect";
    const co = prospect.company || "their company";
    const role = prospect.title || "their role";
    const dossierCtx = dossier ? `\n\nIntelligence Dossier:\n${dossier}` : "";

    const researchPrompt = `Produce a full prospect intelligence brief for:
Prospect: ${JSON.stringify(prospect)}
What the sender offers / ICP: ${JSON.stringify(icp || {})}
${signalContext ? `\nSignal Context (company news, research):\n${signalContext}` : ""}

Respond in exactly these 6 sections:

## 1. Company Intelligence
- What the company does, size, market position, competitive landscape
- Recent signals: expansions, new products/services, leadership changes, funding, awards, press, or industry tailwinds/headwinds
- The 2-3 things leadership is most likely obsessed with right now

## 2. Role & Decision-Making Analysis
- What does a ${role} actually own and care about day-to-day?
- KPIs they are measured on
- Where are they feeling the most pressure or friction right now?
- Decision-maker, influencer, or champion for what the sender offers? Be specific about why.

## 3. Empathy Map
Think like this person. What is their inner world like right now?
- THINK & FEEL: Their private worries, ambitions, and what success looks like to them personally
- HEAR: What their boss, board, peers, or market is telling them
- SEE: What they observe in their industry, competitors, and their own org
- SAY & DO: How they present themselves publicly vs. how they actually behave under pressure

## 4. NDFFO — Psychological Profile
- NEEDS: The functional outcome they need right now (what must get done)
- DESIRES: The deeper aspiration — what they really want for their career or business
- FEARS: What keeps them up at night; what failure looks like for them
- FRUSTRATIONS: The daily friction points, broken processes, or people problems that grind them down
- OBJECTIONS: The exact reasons they will say no or go cold — be brutally honest

## 5. Ice Breaker Bank
Write 3 specific, ready-to-use ice breakers. Each must reference a real signal (company news, role context, or personal inference) and feel like it came from someone who did their homework.
- Ice Breaker 1 (Company Signal): [one sentence]
- Ice Breaker 2 (Role/Pain Signal): [one sentence]
- Ice Breaker 3 (Personal/Aspiration Signal): [one sentence]

## 6. Outreach Strategy
- Sharpest angle: the single most compelling reason this person should care about the sender's offer, right now
- Tone to use: (formal / direct / peer-to-peer / consultative) and why
- Best first channel: email or LinkedIn, and why
- The one thing NOT to say (the generic mistake that will get this person to delete/ignore)`;

    const stepPrompts = {
      research: researchPrompt,
      hook: `Using the research, empathy map, and NDFFO for ${p} at ${co}, write 5 opening hooks for cold outreach.

Each hook must:
- Reference a specific signal, fear, frustration, or desire — not a generic pain
- Feel like it came from someone who understands their world, not a salesperson
- Be under 2 sentences

Format as:
1. [Label — e.g. Fear-led / Signal-led / Desire-led / Frustration-led / Contrarian]:
   [Hook text]

After the 5 hooks, add one line: ★ Recommended: #[N] — [one sentence on why]`,

      email: `Using the research, empathy map, NDFFO, and ice breakers for ${p} at ${co}, write a cold email.

Structure:
Subject: [specific, curiosity-driven, under 8 words — no clickbait]
---
[Opening line: use the strongest ice breaker or fear/frustration hook — 1 sentence]
[Bridge: connect their pain/desire to what the sender offers — 1-2 sentences]
[Proof or specificity: one concrete reason to believe — 1 sentence]
[CTA: low-friction, specific — propose a 15-min call OR ask one smart qualifying question]

Rules:
- Total body: max 100 words
- No "I hope this finds you well", no "we help companies like yours", no buzzwords
- Tone: peer-to-peer — like a smart colleague, not a vendor`,

      linkedin: `Using the ice breakers and personal signals for ${p}, write:${dossierCtx}
${linkedinPosts ? `\nTheir recent LinkedIn posts for context:\n${linkedinPosts}\n` : ""}

1. CONNECTION REQUEST (under 280 characters):
Reference one specific thing about their role, company, or a shared insight. No pitch. Feel like a peer who noticed something interesting about their work.

2. FOLLOW-UP DM — send 3-4 days after connecting (under 400 characters):
Open with a new angle drawn from their NDFFO (a desire or frustration). Ask one smart question or share one sharp insight. Soft CTA — no pressure.

Label each clearly.`,

      sequence: `Using the full research brief, empathy map, NDFFO, and ice breakers for ${p} at ${co}, write a 3-touch sequence:

TOUCH 1 — Day 1 · Email
Subject: [under 8 words]
Body: [max 80 words — open with the sharpest ice breaker, speak to their #1 fear or frustration, end with a soft CTA]

TOUCH 2 — Day 4 · LinkedIn DM
[under 300 chars — new angle, draw from a desire or aspiration, don't reference the email directly]

TOUCH 3 — Day 8 · Email (Break-up)
[max 60 words — acknowledge no response, add one new insight or social proof, final CTA that lowers the bar even further]

Each touch must feel distinct — different angle, different emotional register.`,

      outreach: `Using the intelligence dossier for ${p} at ${co}, write 3 cold email variants. Each must have a distinct angle and emotional register.${dossierCtx}

VARIANT A — Pain-led
Subject: [under 8 words — pain or problem framing]
Body: [max 100 words — open with their biggest frustration or fear, bridge to the sender's solution, one proof point, soft CTA]

VARIANT B — Trigger-led
Subject: [under 8 words — reference a company signal or event]
Body: [max 100 words — open with a specific company/industry signal, show you've done your homework, connect to the relevant outcome, CTA]

VARIANT C — Curiosity-led
Subject: [under 8 words — provocative question or counterintuitive statement]
Body: [max 100 words — open with a sharp insight or question that challenges their assumption, bridge to the sender's angle, CTA]

Rules for all variants:
- No "I hope this finds you well", no "we help companies like yours"
- Tone: peer-to-peer — like a smart colleague, not a vendor
- Subject lines must stand out in a crowded inbox
Label each variant clearly.`,

      followup: `Using the intelligence dossier for ${p} at ${co}, build a follow-up sequence.${dossierCtx}
Current prospect state: ${sequenceState || "No reply to first email"}

Write a 5-touch sequence tailored to this state. Each touch must:
- Use a different angle (rotate through: pain, desire, social proof, insight, break-up)
- Feel like a natural continuation, not a copy-paste follow-up
- Get progressively shorter as the sequence continues

TOUCH 1 — [Day X] · [Channel]
[Content]

TOUCH 2 — [Day X] · [Channel]
[Content]

...continue through 5 touches.

End with a break-up touch that leaves the door open without being needy.`,

      objection: `Analyse this prospect reply from ${p} at ${co} and draft a response.
${dossierCtx}

Their reply:
"${reply || ""}"

1. OBJECTION CLASSIFICATION
Type: [Price / Timing / No need / Competitor / Trust / Gatekeeper / Other]
Root cause: [one sentence — what's really behind this objection]
Urgency level: [Hot / Warm / Cold] — and why

2. RECOMMENDED RESPONSE
[max 100 words — address the root cause, not the surface objection; use an insight or reframe; end with a lower-friction CTA]

3. ALTERNATIVE RESPONSE (if the above feels too direct)
[max 80 words — softer approach, more curious, less pushback]

Be honest: if this is a polite no, say so and recommend a breakup message instead.`,
    };

    const messages = [
      { role: "system", content: systemPrompt },
      ...(body.history || []),
      { role: "user", content: stepPrompts[step] || body.prompt || "" },
    ];

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({ model: "gpt-4o", messages, max_tokens: 2500 }),
    });
    const data = await r.json();
    json(res, { content: data.choices?.[0]?.message?.content, step });
  } catch (e) {
    json(res, { error: e.message }, 500);
  }
}

async function handlePerplexitySearch(req, res) {
  try {
    const body = await readBody(req);
    const r = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.PERPLEXITY_API_KEY}`,
      },
      body: JSON.stringify({
        model: "sonar-pro",
        messages: body.messages || [],
        max_tokens: 1024,
      }),
    });
    const data = await r.json();
    json(res, data);
  } catch (e) {
    json(res, { error: e.message }, 500);
  }
}

async function handleApolloMatch(req, res) {
  try {
    const body = await readBody(req);
    const r = await fetch("https://api.apollo.io/v1/people/match", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.APOLLO_API_KEY,
      },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    json(res, data);
  } catch (e) {
    json(res, { error: e.message }, 500);
  }
}

async function handleLeadsGenerate(req, res) {
  try {
    const body = await readBody(req);
    const { searchUrl, maxLeads = 50, actorId = "curious_coder~apollo-io-scraper" } = body;

    if (!process.env.APIFY_API_KEY) {
      return json(res, { error: "APIFY_API_KEY not set" }, 400);
    }
    if (!searchUrl) {
      return json(res, { error: "searchUrl is required" }, 400);
    }

    const result = await apifyRunActor(actorId, {
      startUrls: [{ url: searchUrl }],
      searchUrl,
      maxLeadsCount: maxLeads,
      maxResults: maxLeads,
      count: maxLeads,
    });

    json(res, result);
  } catch (e) {
    json(res, { error: e.message }, 500);
  }
}

async function handleLeadsRunStatus(req, res, runId) {
  try {
    const r = await fetch(`https://api.apify.com/v2/actor-runs/${runId}`, {
      headers: { "Authorization": `Bearer ${process.env.APIFY_API_KEY}` },
    });
    const data = await r.json();
    json(res, {
      status: data.data?.status,
      datasetId: data.data?.defaultDatasetId,
    });
  } catch (e) {
    json(res, { error: e.message }, 500);
  }
}

async function handleLeadsResults(req, res, datasetId) {
  try {
    const r = await fetch(
      `https://api.apify.com/v2/datasets/${datasetId}/items?format=json&clean=true`,
      { headers: { "Authorization": `Bearer ${process.env.APIFY_API_KEY}` } }
    );
    const items = await r.json();
    const scored = (Array.isArray(items) ? items : [])
      .map((lead) => ({ ...lead, _score: quickScoreLead(lead) }))
      .sort((a, b) => b._score - a._score);
    json(res, { leads: scored });
  } catch (e) {
    json(res, { error: e.message }, 500);
  }
}

// ─── Static files ─────────────────────────────────────────────────────────────
function serveStatic(req, res) {
  const safePath = req.url.split("?")[0].replace(/\.\./g, "");
  const filePath = path.join(__dirname, "public", safePath === "/" ? "index.html" : safePath);
  const ext = path.extname(filePath);
  const mime = MIME[ext] || "text/plain";

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": mime });
    res.end(data);
  });
}

// ─── Router ───────────────────────────────────────────────────────────────────
const POST_ROUTES = {
  "/api/icp/fill": handleIcpFill,
  "/api/chain/run": handleChainRun,
  "/api/apollo/match": handleApolloMatch,
  "/api/perplexity/search": handlePerplexitySearch,
  "/api/leads/generate": handleLeadsGenerate,
};

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const pathname = url.parse(req.url).pathname;

  if (req.method === "GET" && pathname === "/api/status") return handleStatus(req, res);

  const runMatch = pathname.match(/^\/api\/leads\/run\/(.+)$/);
  if (req.method === "GET" && runMatch) return handleLeadsRunStatus(req, res, runMatch[1]);

  const resultsMatch = pathname.match(/^\/api\/leads\/results\/(.+)$/);
  if (req.method === "GET" && resultsMatch) return handleLeadsResults(req, res, resultsMatch[1]);

  if (req.method === "POST" && POST_ROUTES[pathname]) return POST_ROUTES[pathname](req, res);

  if (req.method === "GET") return serveStatic(req, res);

  res.writeHead(404);
  res.end("Not found");
});

server.listen(PORT, () => {
  const k = (v) => (v ? "connected" : "not set");
  console.log(`\n  Apex Outbound OS  →  http://localhost:${PORT}\n`);
  console.log(`  OpenAI:     ${k(process.env.OPENAI_API_KEY)}`);
  console.log(`  Apollo:     ${k(process.env.APOLLO_API_KEY)}`);
  console.log(`  Perplexity: ${k(process.env.PERPLEXITY_API_KEY)}`);
  console.log(`  Apify:      ${k(process.env.APIFY_API_KEY)}\n`);
});
