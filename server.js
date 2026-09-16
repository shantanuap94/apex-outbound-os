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
            content: "You are a B2B sales expert. Given a company description, return a detailed ICP profile as JSON with these fields: companyName, website, industry, headcount, revenue, location, painPoints, goals, triggers, objections, notes. Return only valid JSON.",
          },
          { role: "user", content: body.description || "" },
        ],
        response_format: { type: "json_object" },
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
    const { prospect, icp, step } = body;

    const systemPrompt = `You are an expert B2B revenue strategist and sales copywriter for Apex Growth Partners.
ICP Context: ${JSON.stringify(icp || {})}
Your job is to help craft highly personalized, insight-led outreach for Indian SMB founders/CXOs in manufacturing, real estate, architecture, and CA firms with ₹30-80cr revenue.`;

    const stepPrompts = {
      research: `Research this prospect and their company. Identify their likely pain points, recent business challenges, and growth ambitions based on their role and industry. Prospect: ${JSON.stringify(prospect)}`,
      hook: `Based on the research, write 3 alternative opening hooks for a cold email. Each hook must be specific, insight-led, and avoid generic phrases. Format as numbered list.`,
      email: `Write a complete cold email (subject line + body). Max 120 words. End with a clear, low-friction CTA. Must feel hand-written, not templated.`,
      linkedin: `Write a LinkedIn connection request message (under 300 chars) and a follow-up DM (under 500 chars) for this prospect.`,
      sequence: `Draft a 3-touch outreach sequence (Day 1 email, Day 4 LinkedIn, Day 8 follow-up email). Be concise and specific.`,
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
      body: JSON.stringify({ model: "gpt-4o", messages, max_tokens: 1500 }),
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
