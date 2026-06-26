const http = require("http");
const fs = require("fs");
const path = require("path");

// Load .env file if present (no dotenv dependency needed)
try {
  const envPath = path.join(__dirname, ".env");
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.trim().match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch { /* .env not found — that's fine */ }

const PORT = Number(process.env.PORT || 4173);
const PUBLIC_DIR = path.join(__dirname, "public");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

// ── Apex company context ─────────────────────────────────────────────────────

const apex = {
  company: "Apex Growth Partners",
  founder: "Shantanu",
  category: "AI-enabled outbound and enterprise pipeline generation",
  valueProp:
    "Build predictable revenue pipelines without heavy fixed hiring costs. AI-enabled outbound system that finds high-intent prospects, starts warm conversations, and helps founders win enterprise clients. Small setup fee + performance-based upside.",
  proof:
    "Shantanu was VP and Head of Growth at a publicly listed company. Grew company revenue from ₹200 crore to ₹300 crore in 9 months. Has worked with multiple top B2B companies on enterprise growth.",
  tone:
    "Warm, friendly, trust-building, emotionally intelligent, founder-to-founder. Speaks to both heart and mind. Never corporate. Never pushy.",
  icpSummary:
    "Founders and MDs of 30–80 crore B2B companies in India — manufacturing, real estate, CA firms, architecture firms, and similar expert-led professional service businesses. Post-survival SMEs where the founder is still the primary growth engine."
};

// ── Utilities ────────────────────────────────────────────────────────────────

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body)
  });
  res.end(body);
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", chunk => {
      data += chunk;
      if (data.length > 2_000_000) { reject(new Error("Body too large")); req.destroy(); }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function safeParseJson(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch { /* fall through */ }
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (match) { try { return JSON.parse(match[1]); } catch { /* fall through */ } }
  const braceStart = text.indexOf("{");
  const braceEnd = text.lastIndexOf("}");
  if (braceStart !== -1 && braceEnd > braceStart) {
    try { return JSON.parse(text.slice(braceStart, braceEnd + 1)); } catch { /* fall through */ }
  }
  const arrStart = text.indexOf("[");
  const arrEnd = text.lastIndexOf("]");
  if (arrStart !== -1 && arrEnd > arrStart) {
    try { return JSON.parse(text.slice(arrStart, arrEnd + 1)); } catch { /* fall through */ }
  }
  return null;
}

// ── Apollo API ───────────────────────────────────────────────────────────────

async function apolloPersonMatch(p) {
  const key = process.env.APOLLO_API_KEY;
  if (!key) return null;

  const payload = { reveal_personal_emails: false, reveal_phone_number: false };
  if (p.firstName) payload.first_name = p.firstName;
  if (p.lastName) payload.last_name = p.lastName;
  if (p.company) payload.organization_name = p.company;
  if (p.domain) payload.domain = p.domain;
  if (p.linkedinUrl) payload.linkedin_url = p.linkedinUrl;

  const r = await fetch("https://api.apollo.io/v1/people/match", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "cache-control": "no-cache" },
    body: JSON.stringify(payload)
  });
  if (!r.ok) throw new Error(`Apollo person ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

async function apolloOrgEnrich(domain) {
  const key = process.env.APOLLO_API_KEY;
  if (!key || !domain) return null;

  const r = await fetch(`https://api.apollo.io/v1/organizations/enrich?domain=${encodeURIComponent(domain)}`, {
    headers: { "content-type": "application/json", "x-api-key": key, "cache-control": "no-cache" }
  });
  if (!r.ok) throw new Error(`Apollo org ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

function normalizeEnrichment(personRes, orgRes, input) {
  const person = personRes?.person || {};
  const org = orgRes?.organization || person?.organization || {};

  return {
    person: {
      name: person.name || `${input.firstName || ""} ${input.lastName || ""}`.trim(),
      firstName: person.first_name || input.firstName || "",
      lastName: person.last_name || input.lastName || "",
      title: person.title || input.title || "",
      email: person.email || "",
      emailStatus: person.email_status || "unknown",
      linkedin: person.linkedin_url || input.linkedinUrl || "",
      city: person.city || "",
      state: person.state || "",
      country: person.country || "India",
      seniority: person.seniority || "c_suite",
      departments: person.departments || [],
      employmentHistory: (person.employment_history || []).slice(0, 3)
    },
    company: {
      name: org.name || input.company || "",
      website: org.website_url || (input.domain ? `https://${input.domain}` : ""),
      linkedin: org.linkedin_url || "",
      headcount: org.estimated_num_employees || null,
      industry: org.industry || input.industry || "",
      description: org.short_description || "",
      city: org.city || "",
      state: org.state || "",
      country: org.country || "India",
      fundingTotal: org.funding_total?.value_usd || null,
      latestFundingDate: org.latest_funding_round_date || "",
      latestFundingType: org.latest_funding_round_type || "",
      techStack: (org.technology_names || []).slice(0, 10),
      address: org.raw_address || ""
    },
    source: personRes || orgRes ? "apollo" : "manual",
    enrichedAt: new Date().toISOString()
  };
}

// ── OpenAI API ───────────────────────────────────────────────────────────────

async function callOpenAI(messages, { model, temperature = 0.4 } = {}) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;

  const usedModel = model || process.env.OPENAI_AGENT_MODEL || "gpt-5.5";

  const r = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ model: usedModel, input: messages, temperature })
  });

  if (!r.ok) throw new Error(`OpenAI ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const data = await r.json();
  return (
    data.output_text ||
    data.output?.flatMap(i => i.content || [])?.find(p => p.text)?.text ||
    null
  );
}

// ── Agent 1 — ICP Research ───────────────────────────────────────────────────

function buildAgent1Messages(prospect, enrichment, signals, icp) {
  const system = `You are a senior B2B research analyst specialising in founder-led Indian companies with 30–80 crore annual turnover: manufacturing, real estate, CA firms, architecture firms, and expert-led professional services.

You build prospect intelligence dossiers for Apex Growth Partners that a salesperson can act on in under 60 seconds.

ABOUT APEX GROWTH PARTNERS:
${JSON.stringify(apex, null, 2)}

BUYING SIGNAL SCORING RUBRIC (start from 30 for solid ICP fit, add/subtract):
+25 → Company expansion: new plant, new branch, new city, new project announced
+20 → Hiring sales/BD/operations leadership (signal: founder wants to stop carrying growth alone)
+20 → Founder actively posting on LinkedIn about growth, systems, delegation, scaling
+15 → New enterprise client win announced, or industry award received
+15 → PE/institutional investment received
+10 → Tech stack is basic (Tally, WhatsApp, spreadsheets) — signals systems gap
+10 → Company visibly stuck at founder-led sales despite headcount/revenue size
-10 → Company is less than 2 years old (too early for our offer)
-10 → Company is already at enterprise scale (500+ headcount, 200+ crore) — too late
-15 → No meaningful B2B component (pure retail, pure consumer)

REJECT conditions (set score < 30 and explain):
• Prospect is NOT a founder/MD/promoter (must be primary decision-maker)
• Company outside 15–150 crore range
• No B2B component
• Startup under 2 years old

CITATION RULES:
• Every claim: cite a source URL, or mark as "inference" with reasoning
• Missing data: write "unknown" — never fabricate
• Prioritise signals from the last 90 days
• For Indian companies, size/funding data may be limited — inference is fine if labelled

Return ONLY valid JSON matching this exact schema — no prose, no markdown:
{
  "snapshot": {
    "hq": "",
    "headcount": "",
    "revenue": "",
    "funding_stage": "bootstrapped|seed|series_a|pe_backed|unknown",
    "growth_rate": "high|moderate|low|unknown"
  },
  "triggers": [
    { "type": "expansion|hiring|funding|founder_post|client_win|award|exec_change|other", "description": "", "date": "", "source": "" }
  ],
  "stack": [
    { "tool": "", "category": "erp|crm|communication|marketing|sales|other", "source": "" }
  ],
  "pains": [
    { "pain": "", "evidence": "", "confidence": "high|medium|low" }
  ],
  "hooks": [
    { "hook": "", "angle": "", "source": "" }
  ],
  "score": 0,
  "score_reasoning": "",
  "sources": []
}`;

  const user = JSON.stringify({
    prospect: {
      name: `${prospect.firstName || ""} ${prospect.lastName || ""}`.trim(),
      title: prospect.title || "",
      company: prospect.company || "",
      domain: prospect.domain || "",
      linkedin: prospect.linkedinUrl || "",
      industry: prospect.industry || ""
    },
    enrichment_from_apollo: enrichment,
    signal_context_pasted_by_user: signals || "None provided",
    icp_definition: icp || {},
    task: "Build a complete dossier. Synthesise all provided data. Return valid JSON only."
  });

  return [{ role: "system", content: system }, { role: "user", content: user }];
}

function fallbackDossier(prospect, enrichment) {
  const name = `${prospect?.firstName || ""} ${prospect?.lastName || ""}`.trim() || "the founder";
  const company = enrichment?.company?.name || prospect?.company || "the company";
  const industry = enrichment?.company?.industry || prospect?.industry || "B2B services";
  const hc = enrichment?.company?.headcount;

  return {
    source: "local_draft",
    dossier: {
      snapshot: {
        hq: enrichment?.company?.city ? `${enrichment.company.city}, India` : "India",
        headcount: hc ? `~${hc} employees` : "50–150 employees (estimated)",
        revenue: "~50 crore (estimated from headcount and industry benchmarks)",
        funding_stage: "bootstrapped",
        growth_rate: "moderate"
      },
      triggers: [
        {
          type: "hiring",
          description: `${company} appears to be in a growth phase based on company stage and industry positioning`,
          date: "recent",
          source: "inference from Apollo data"
        }
      ],
      stack: [
        { tool: "Tally", category: "erp", source: "inference — standard for Indian SMBs" },
        { tool: "WhatsApp Business", category: "communication", source: "inference" }
      ],
      pains: [
        {
          pain: `${name} likely carries most key enterprise client relationships personally`,
          evidence: "Founder-MD at this stage and size typically handles all major sales conversations directly",
          confidence: "high"
        },
        {
          pain: "Revenue growth is constrained by founder bandwidth — each new crore requires more founder time",
          evidence: "Common pattern at bootstrapped B2B companies in this revenue range without a professional sales team",
          confidence: "medium"
        },
        {
          pain: "No scalable outbound system — new business relies on referrals and the founder's personal network",
          evidence: "inference from company size, industry, and typical growth trajectory for this ICP",
          confidence: "medium"
        }
      ],
      hooks: [
        {
          hook: `${company} has reached a size where the founder's personal network starts becoming the growth ceiling`,
          angle: "Frame the first line around what the NEXT 50 crore requires vs. how the first 50 was built",
          source: "inference"
        },
        {
          hook: `${industry} companies at this stage typically win enterprise clients through relationships, not systems`,
          angle: "Acknowledge what they built, then ask about the systematic pipeline question",
          source: "inference"
        },
        {
          hook: "Connect OPENAI_API_KEY and add signal context for a real, specific third hook",
          angle: "Add LinkedIn posts, news, or recent company announcements to unlock personalised hooks",
          source: "no live data"
        }
      ],
      score: 55,
      score_reasoning:
        "Base ICP fit: 30 (founder-led B2B, estimated 50cr range, B2B industry). No live timing signals available — score is conservative. Add signal context or an OpenAI API key to unlock real research and an accurate score. Connect APOLLO_API_KEY for enriched company data.",
      sources: ["Apollo (partial)", "inference"]
    },
    notes: "Draft only. Connect OPENAI_API_KEY and add signal context for a live dossier."
  };
}

// ── Agent 2 — Cold Email ─────────────────────────────────────────────────────

function buildAgent2Messages(dossier, prospect) {
  const fn = prospect?.firstName || "there";
  const system = `You are a world-class cold email copywriter for Apex Growth Partners. You write emails that sound like they came from a sharp founder, not a salesperson.

WHO WE ARE (Apex Growth Partners):
- We build AI-enabled outbound sales systems for B2B founders in India
- We replaced a client's manual SDR team and grew their listed company from ₹200cr to ₹300cr revenue in 9 months
- Small fixed setup fee + performance-based pricing (we only win when you win)
- ICP: founders/MDs of ₹30–80cr B2B companies (manufacturing, real estate, CA firms, architecture)
- We deliver: predictable enterprise pipeline, not just "leads"

WHO YOU ARE WRITING TO:
- First name: ${fn}
- Their signals, pains, hooks, and triggers are in the dossier below
- IMPORTANT: The dossier describes THEIR company and THEIR situation — not ours
- DO NOT attribute Apex's proof points (₹200cr→₹300cr) to the prospect

ABSOLUTE RULES — violating any one requires a full rewrite:
1. Start with "Hi ${fn}," on its own line, then a blank line, then the body
2. Under 90 words total (body + CTA; greeting and subject NOT counted)
3. Subject: max 6 words, all lowercase, punchy — no generic phrases like "quick question" or "following up"
4. Line 1 after greeting: ONE hyper-specific observation from the dossier (their company, their trigger, their post, their industry move) — must feel researched, not templated
5. ONE clear pain hypothesis tied to their exact stage and role
6. CTA: soft reaction-ask only ("curious if this is relevant?", "worth a look?", "does this resonate?") — NEVER ask for a call, demo, or calendar slot
7. Proof point rule: ONLY mention ₹200cr→₹300cr if it directly mirrors their specific pain — and when you do, say "we did this for a client" not "you did this"
8. Banned openings: "hope this finds you well", "I wanted to reach out", "just following up", "I came across your profile", "I noticed you"
9. No emojis. No buzzwords: synergy, leverage, unlock, disrupt, game-changing, innovative, cutting-edge, seamless
10. No passive voice. Write like a founder texting from their phone — short sentences, direct
11. Do NOT mention "AI" in the subject line
12. Do NOT name Apex Growth Partners in the subject line
13. Each variant must use a DIFFERENT hook from the dossier — no repeating the same opening across variants

THREE VARIANTS (each must feel completely different in angle and opener):
A) PAIN-LED: Opens with their most acute pain signal from dossier. Body hypothesises the bottleneck at their current stage. CTA is empathetic and direct.
B) TRIGGER-LED: Opens with a specific recent event/trigger from dossier (funding, hiring, expansion, post, award). Body connects that trigger to a pipeline/sales question. CTA shows curiosity.
C) CURIOSITY-LED: Opens with a sharp, counterintuitive observation about founders at their exact stage. Body explains the pattern without selling. CTA asks if this is their current challenge.

OUTPUT FORMAT — return ONLY a valid JSON array, no prose before or after:
[{ "type": "pain-led", "subject": "", "body": "", "cta": "", "word_count": 0 }, ...]
word_count = count of words in body + cta only (exclude greeting and subject).`;

  const user = JSON.stringify({
    dossier,
    prospect: { firstName: fn, title: prospect?.title || "", company: prospect?.company || "" },
    task: "Write 3 cold email variants for this prospect using their dossier. Return valid JSON array only. No markdown, no explanation."
  });

  return [{ role: "system", content: system }, { role: "user", content: user }];
}

function fallbackColdEmail(dossier, prospect) {
  const fn = prospect?.firstName || dossier?.snapshot?.hq ? "" : "there";
  const company = dossier?.snapshot?.hq || "your company";
  const pain = dossier?.pains?.[0]?.pain || "revenue growth is still founder-dependent";
  const hook = dossier?.hooks?.[0]?.hook || "your company has reached a growth inflection point";
  const trigger = dossier?.triggers?.[0]?.description || "your recent growth activity";

  const greeting = fn ? `${fn},` : "Hi,";

  return {
    source: "local_draft",
    emails: [
      {
        type: "pain-led",
        subject: "the next 50 crore problem",
        body: `${greeting}\n\n${hook.charAt(0).toUpperCase() + hook.slice(1)}.\n\nAt this stage, ${pain.toLowerCase()}.\n\nWe build enterprise pipeline systems for founders who want predictable revenue growth without carrying every deal personally. Small setup fee, rest is performance.`,
        cta: "Worth 10 minutes to see if this is relevant to where you are right now?",
        word_count: 72
      },
      {
        type: "trigger-led",
        subject: "pipeline question re your growth",
        body: `${greeting}\n\nNoticed ${trigger.toLowerCase()} — that kind of momentum usually raises one question: does your pipeline scale as fast as everything else?\n\nWe help B2B founders build outbound systems that generate enterprise conversations without the founder needing to be in every room.`,
        cta: "Happy to share how this worked for a similar company. Relevant?",
        word_count: 63
      },
      {
        type: "curiosity-led",
        subject: "50 crore founder, then what",
        body: `${greeting}\n\nMost founders I speak to at your stage built to where they are on relationships and reputation. Which is genuinely hard.\n\nThe ones who get to the next 50 crore without burning out usually do one thing differently — they stop being the best salesperson in the room.`,
        cta: "Curious if that's the challenge you're actively working on?",
        word_count: 62
      }
    ],
    notes: "Draft only. Connect OPENAI_API_KEY for personalised emails using the dossier."
  };
}

// ── Agent 3 — LinkedIn ───────────────────────────────────────────────────────

function buildAgent3Messages(dossier, prospect, linkedinPosts) {
  const system = `You write LinkedIn outreach for Apex Growth Partners that gets accepted and replied to by Indian B2B founders.

ABOUT APEX:
${JSON.stringify(apex, null, 2)}

THREE-MESSAGE STRUCTURE:

[CONNECTION NOTE] — max 280 characters
• Reference ONE specific thing from their hooks or company activity
• Zero pitch. Zero ask. Pure observation or genuine curiosity.
• Must feel like a peer who noticed something interesting — not a salesperson who found a target
• Never: "I'd love to connect", "I noticed you're scaling", "looking to expand my network"

[DAY 3 DM] — max 400 characters (after they accept)
• Open with a specific reference to their business or a recent post — never "thanks for connecting"
• Share one useful observation genuinely relevant to their situation
• End with a question they can answer in 2 sentences max

[DAY 7 VALUE DM] — max 500 characters
• Lead with something genuinely useful: a framework, a stat, a case study, a reframing question
• Tie it to a pain from the dossier
• Soft CTA: "want me to walk you through how we'd apply this?" or similar
• Never pitch a product or service directly

HARD RULES:
• Sound like a peer, never a vendor
• No "I'd love to", "looking to connect", "let me know if you're interested"
• Day 7 must give value BEFORE any ask
• Match the prospect's posting style if known (brief/direct or thoughtful/long)

OUTPUT: Return valid JSON only:
{ "connection": { "text": "", "char_count": 0 }, "day3_dm": { "text": "", "char_count": 0 }, "day7_dm": { "text": "", "char_count": 0 } }`;

  const user = JSON.stringify({
    dossier,
    prospect_first_name: prospect?.firstName || "",
    prospect_company: prospect?.company || "",
    prospect_linkedin_posts: linkedinPosts || "None provided",
    task: "Write the 3-message LinkedIn sequence. Return valid JSON only."
  });

  return [{ role: "system", content: system }, { role: "user", content: user }];
}

function fallbackLinkedIn(dossier, prospect) {
  const fn = prospect?.firstName || "";
  const company = prospect?.company || "your company";
  const hook = dossier?.hooks?.[0]?.hook || `${company}'s growth trajectory`;
  const pain = dossier?.pains?.[0]?.pain || "scaling beyond founder-led sales";

  const conn = `Came across your profile while researching B2B founders in your space. ${hook.charAt(0).toUpperCase() + hook.slice(1).replace(/\.$/, "")}. Thought it would be worth connecting.`;
  const day3 = `${fn ? fn + ", your" : "Your"} company's growth arc is interesting — especially given where you are now. One thing I keep seeing at this stage: the jump to the next revenue level usually needs a completely different approach to pipeline. What's been the biggest constraint on growth lately?`;
  const day7 = `${fn || "Hey"}, sharing something relevant — mapped how 3 B2B manufacturers in India built enterprise pipelines without adding a large sales headcount. Common thread: systematising the outreach that currently sits in the founder's head. Would it be useful if I walked you through the framework?`;

  return {
    source: "local_draft",
    messages: {
      connection: { text: conn, char_count: conn.length },
      day3_dm: { text: day3, char_count: day3.length },
      day7_dm: { text: day7, char_count: day7.length }
    },
    notes: "Draft only. Connect OPENAI_API_KEY for personalised LinkedIn sequences."
  };
}

// ── Agent 4 — Follow-up Sequence ─────────────────────────────────────────────

function buildAgent4Messages(dossier, prospect, state) {
  const system = `You design multi-touch outbound follow-up sequences for Apex Growth Partners.

ABOUT APEX:
${JSON.stringify(apex, null, 2)}

SEQUENCE RULES:
• 5–7 touches total over 14–21 days (this tool generates touches 2–7; touch 1 already sent)
• Alternate channels: email → LinkedIn → email → LinkedIn → email → LinkedIn → email
• Each touch adds NEW value or a completely different angle — never repeat the same point
• Reference prior touches by their content, not "as I mentioned in my last email"
• Final touch (7) is ALWAYS a warm, professional breakup — leave the door open, no guilt-trip

TOUCH ANGLES:
Touch 2: New value asset — a specific case study, stat, or insight from a similar company
Touch 3: Pattern interrupt — a contrarian take, prediction, or question they haven't considered
Touch 4: Peer social proof — a story from a company in their specific industry (manufacturing/real estate/CA/architecture)
Touch 5: Direct ask — "is this just not a priority right now?" — short, honest, zero pressure
Touch 6: Resource drop — something useful with absolutely no ask attached
Touch 7: Warm breakup — acknowledge their time, leave door open for 90 days

PER-TOUCH RULES:
• Under 100 words per touch (email or LinkedIn DM)
• Each touch should stand alone — someone who missed prior ones still finds value
• Tone stays warm and peer-level throughout — never frustrated, never needy

BRANCHING NOTES (include in JSON):
• Positive reply → "STOP — hand off to human immediately"
• "Not now" reply → "PAUSE 60 days, restart at Touch 6"
• "Wrong person" reply → "STOP — run Agent 1 on the referred contact"
• Full ghost through Touch 7 → "ARCHIVE — re-surface in 90 days"

OUTPUT: Return valid JSON only:
{ "state": "", "touches": [{ "touch": 2, "channel": "email|linkedin", "angle": "", "subject": "", "body": "", "send_day": 0, "branching_note": "" }] }
subject is for email touches only; leave empty for LinkedIn.`;

  const user = JSON.stringify({
    dossier,
    prospect_first_name: prospect?.firstName || "",
    prospect_company: prospect?.company || "",
    current_state: state,
    task: "Build the follow-up sequence for touches 2–7 based on current state. Return valid JSON only."
  });

  return [{ role: "system", content: system }, { role: "user", content: user }];
}

function fallbackSequence(dossier, prospect, state) {
  const fn = prospect?.firstName || "";
  const company = prospect?.company || "your company";
  const pain = dossier?.pains?.[0]?.pain || "founder-led sales bottleneck";

  return {
    source: "local_draft",
    sequence: {
      state,
      touches: [
        { touch: 2, channel: "email", angle: "new_value", subject: "one number worth knowing", body: `${fn || "Hi"},\n\nQuick stat: manufacturers who build a dedicated outbound system before 100 crore grow 40% faster in the following 3 years than those who wait.\n\nThe difference is usually 18 months of runway, not a better product.\n\nMight be relevant given where you are.`, send_day: 3, branching_note: "" },
        { touch: 3, channel: "linkedin", angle: "pattern_interrupt", subject: "", body: `${fn || "Hey"}, one thing I'd push back on with most growth advice for companies at your stage: "hire a sales team" is usually the wrong first step. What actually works is building the system before the headcount. Curious what your current thinking is on this?`, send_day: 6, branching_note: "" },
        { touch: 4, channel: "email", angle: "social_proof", subject: "how a Pune manufacturer did it", body: `${fn || "Hi"},\n\nWorked with a manufacturing founder in Pune last year — 55 crore turnover, founder closing every deal personally. Built them a signal-based outbound system. In 6 months they had a pipeline that ran without the founder in the first 3 meetings.\n\nNot for everyone, but worth knowing it's possible.`, send_day: 10, branching_note: "" },
        { touch: 5, channel: "email", angle: "direct_ask", subject: "honest question", body: `${fn || "Hi"},\n\nIs building a predictable pipeline system just not a priority right now — or does the timing not work?\n\nEither is a completely fair answer. Just want to make sure I'm not sending things that aren't useful.`, send_day: 14, branching_note: "Positive reply → STOP, hand off to human. 'Not now' → PAUSE 60 days, restart at Touch 6." },
        { touch: 6, channel: "linkedin", angle: "resource_drop", subject: "", body: `${fn || "Hey"}, leaving this here with no agenda — it's a 5-question diagnostic we use to identify where founder-led sales is actually the bottleneck vs. where it's working fine. Might be useful even if Apex isn't the right fit right now.`, send_day: 17, branching_note: "" },
        { touch: 7, channel: "email", angle: "breakup", subject: "closing the loop", body: `${fn || "Hi"},\n\nI'll stop reaching out — you've clearly got a full plate and this isn't the right moment.\n\nIf things shift in the next quarter and building a predictable enterprise pipeline becomes a priority, I'm easy to find.\n\nWishing ${company} a strong rest of the year.`, send_day: 21, branching_note: "ARCHIVE — re-surface in 90 days." }
      ]
    },
    notes: "Draft only. Connect OPENAI_API_KEY for personalised sequences."
  };
}

// ── Agent 5 — Objection Handler ──────────────────────────────────────────────

function buildAgent5Messages(reply, dossier, prospect) {
  const system = `You handle inbound replies to outbound emails and LinkedIn messages sent by Apex Growth Partners.

ABOUT APEX:
${JSON.stringify(apex, null, 2)}

YOUR TWO JOBS:
1. CLASSIFY the reply into exactly one of:
   positive_interest | soft_no | hard_no | wrong_person | send_info | unsubscribe | ambiguous

2. DRAFT a response appropriate to that classification

CLASSIFICATION DEFINITIONS:
• positive_interest: Genuine engagement — wants to talk, know more, or has asked a question
• soft_no: "Not right now", "too busy", "maybe later", "next quarter" — door is open
• hard_no: Clear, unambiguous disinterest with no opening for follow-up
• wrong_person: They've directed you elsewhere or confirmed they're not the decision-maker
• send_info: They want to see something specific before committing to a conversation
• unsubscribe: Explicitly asked to be removed or stopped
• ambiguous: Unclear intent — could be positive or negative; need one clarifying question

RESPONSE RULES:
• Never argue. Never sell harder when they've said no.
• Never guilt-trip. Never passive-aggressive.
• hard_no → Thank them sincerely and close the loop. Done. Never follow up again.
• soft_no → Keep door open lightly. Offer a specific check-in timeframe.
• wrong_person → Ask for the right name/team, then exit that thread.
• send_info → Send ONE specific, relevant thing — not a brochure, not a generic deck. A case study or a specific framework. Always include a gentle CTA for a short call.
• unsubscribe → Acknowledge immediately, confirm removal, NEVER respond again.
• ambiguous → Ask ONE clarifying question. Then wait.
• Always match their energy and length. 2-line reply → 2-line response.
• Tone stays warm throughout — never cold, never corporate.

OUTPUT: Return valid JSON only:
{ "classification": "", "confidence": "high|medium|low", "reasoning": "", "draft_response": "", "action": "continue|stop|pause_60|find_new_contact|archive", "notes": "" }`;

  const user = JSON.stringify({
    reply_text: reply,
    dossier_context: {
      company: prospect?.company || "",
      prospect_name: `${prospect?.firstName || ""} ${prospect?.lastName || ""}`.trim(),
      pains: dossier?.pains || [],
      score: dossier?.score || 0
    },
    task: "Classify the reply and draft an appropriate response. Return valid JSON only."
  });

  return [{ role: "system", content: system }, { role: "user", content: user }];
}

function fallbackObjection(reply) {
  const lower = (reply || "").toLowerCase();
  let classification = "ambiguous";
  let action = "continue";
  let draft = "Thanks for getting back to me — can you help me understand what you mean by that? Happy to adjust.";
  let notes = "";

  if (/not interested|no thanks|not for us|pass|stop|remove|unsubscribe/i.test(lower)) {
    classification = lower.includes("unsubscribe") || lower.includes("remove") ? "unsubscribe" : "hard_no";
    action = "stop";
    draft = "Completely understood — I'll close the loop on my end. Thanks for your time, and all the best with the business.";
    notes = "Do not follow up. Archive this contact.";
  } else if (/not now|right time|next quarter|later|busy|maybe/i.test(lower)) {
    classification = "soft_no";
    action = "pause_60";
    draft = "Totally fair — timing matters more than anything. Would it be ok if I checked back in around [Q+1]? I'll have something more specific to share by then.";
    notes = "Pause sequence 60 days. Restart at Touch 6.";
  } else if (/wrong person|not my area|speak to|contact/i.test(lower)) {
    classification = "wrong_person";
    action = "find_new_contact";
    draft = "Thanks for the heads-up. Who would be the right person to speak to about building an enterprise pipeline at your company?";
    notes = "Find new contact. Run Agent 1 on them.";
  } else if (/send|more info|deck|details|tell me more|case study/i.test(lower)) {
    classification = "send_info";
    action = "continue";
    draft = "Of course — here's the most relevant thing for your situation: [one specific case study or framework link]. It covers how a similar company solved [specific pain]. Worth 10 minutes next week to see if it applies?";
    notes = "Send ONE specific, relevant piece. Not a generic deck.";
  } else if (/interested|sounds good|open to|yes|love to|let's|tell me|curious/i.test(lower)) {
    classification = "positive_interest";
    action = "continue";
    draft = "Great to hear — what's the best way to set up a brief call? I can work around your schedule.";
    notes = "STOP automation. Hand off to human immediately. Book a call.";
  }

  return {
    source: "local_draft",
    result: { classification, confidence: "medium", reasoning: "Keyword pattern match — connect OPENAI_API_KEY for nuanced classification.", draft_response: draft, action, notes },
    notes: "Draft only. Connect OPENAI_API_KEY for accurate classification and personalised response."
  };
}

// ── ICP Section handler (existing) ───────────────────────────────────────────

function fallbackIcpSuggestion(section, currentIcp) {
  const seed = currentIcp?.seedDescription || "Founders of 50 crore B2B companies in manufacturing, real estate, CA, architecture.";
  const suggestions = {
    seedDescription: "Founder-led B2B companies around 50 crore turnover, usually in manufacturing, real estate, CA, architecture, or expert-led service businesses. They have product-market proof and reputation, but growth still depends too heavily on the founder.",
    roleSeniority: "Founder, Managing Director, promoter, or owner-operator who still personally drives large deals, key relationships, hiring decisions, banking conversations, and major growth bets.",
    companyStageSize: "Post-survival SME with roughly 50 crore annual turnover, moving from founder-led hustle to professional management. Large enough to need systems, not large enough to waste money on bloated sales teams.",
    responsibilityScope: "Accountable for topline growth, enterprise client relationships, expansion decisions, capital allocation, senior hiring, bank or investor confidence, and protecting the company reputation built over years.",
    says: "We have a strong product, but sales is not consistent enough.\nGood people are hard to find and harder to retain.\nI want growth, but I do not want unnecessary overhead.",
    thinks: "If I stop pushing, will growth slow down?\nAm I building a real company or just a high-paying job for myself?\nYounger competitors are using technology faster than us.",
    does: "Steps into sales conversations when deals matter.\nChecks cash flow, orders, and receivables personally.\nUses WhatsApp, spreadsheets, and trusted old employees to manage critical work.",
    feels: "Responsible for everyone and everything.\nProud of what has been built, but tired of carrying growth alone.\nAnxious that the market is changing faster than the organisation.",
    pains: "Revenue has plateaued and each new crore feels harder.\nThe founder remains the bottleneck for major sales decisions.\nSales cycles are getting longer without clear visibility.",
    fears: "The company may shrink if the founder steps back.\nA smarter, tech-enabled competitor may win their best accounts.\nConsultants or software may waste money without real execution.",
    frustrations: "The team repeats mistakes despite instructions.\nData is scattered across spreadsheets, WhatsApp, and people's heads.\nMost agencies talk strategy but do not own results.",
    dreamOutcomes: "Predictable month-on-month enterprise pipeline.\nA growth system that works without daily founder intervention.\nFreedom to focus on expansion, family, or new ventures while the business keeps growing."
  };
  return { source: "local_draft", section, seed, suggestion: suggestions[section] || suggestions.seedDescription, notes: "Drafted from Apex ICP. Connect OPENAI_API_KEY for live AI refinement." };
}

function buildIcpPrompt(section, currentIcp) {
  return [
    { role: "system", content: "You are a senior B2B growth strategist helping define an ICP for an AI outbound sales stack. Write with warmth, founder empathy, commercial sharpness, and zero jargon. Return valid JSON only." },
    { role: "user", content: JSON.stringify({ task: "Improve or fill one ICP definition field for an outbound dashboard.", companyContext: apex, section, currentIcp, outputShape: { source: "openai", section, suggestion: "string", notes: "short explanation" } }) }
  ];
}

// ── Request Handlers ─────────────────────────────────────────────────────────

async function handleAiIcp(req, res) {
  try {
    const body = await readRequestBody(req);
    const { section = "seedDescription", icp: currentIcp = {} } = body ? JSON.parse(body) : {};
    if (!process.env.OPENAI_API_KEY) { sendJson(res, 200, fallbackIcpSuggestion(section, currentIcp)); return; }
    const text = await callOpenAI(buildIcpPrompt(section, currentIcp), { model: process.env.OPENAI_MODEL || "gpt-4.1-mini" });
    const parsed = safeParseJson(text);
    sendJson(res, 200, parsed || { source: "openai", section, suggestion: text?.trim() || "", notes: "" });
  } catch (err) {
    sendJson(res, 500, { error: "AI assist failed", detail: err.message });
  }
}

// ── Perplexity Research ───────────────────────────────────────────────────────

async function perplexityResearch(prospect) {
  const key = process.env.PERPLEXITY_API_KEY;
  if (!key) return null;

  const name = `${prospect.firstName || ""} ${prospect.lastName || ""}`.trim();
  const prompt = `Research this B2B prospect for a sales team in India. Return ONLY valid JSON, no markdown, no prose.

Prospect: ${name}, ${prospect.title || "founder"} at ${prospect.company || "unknown company"} (${prospect.domain || ""})
LinkedIn: ${prospect.linkedinUrl || "not provided"}
Industry: ${prospect.industry || "B2B"}

Find and return structured intelligence as this exact JSON shape:
{
  "person": {
    "name": "${name}",
    "title": "current verified title",
    "background": "2-3 sentences: career history, education, notable roles",
    "recentActivity": "any recent LinkedIn posts, interviews, quotes, or public statements in the last 6 months"
  },
  "company": {
    "name": "${prospect.company || ""}",
    "founded": "year if known",
    "size": "headcount estimate",
    "revenue": "estimated revenue in crore if known",
    "products": "what they sell or make",
    "clients": "any known enterprise clients or sectors served",
    "recentNews": "latest news: expansions, awards, new offices, fundraising, new products, hiring sprees, media coverage"
  },
  "signals": [
    { "type": "growth|pain|trigger|hiring|expansion|award|funding", "description": "specific finding", "date": "month/year if known", "weight": "high|medium|low" }
  ],
  "painIndicators": ["observed pain points based on company stage, industry, and news"],
  "growthSignals": ["positive growth indicators that make them a good prospect"],
  "suggestedContext": "3-4 sentences summarising the most important intelligence for a sales rep reaching out to this person — what angle to use, what pain to address, what trigger to reference"
}`;

  const r = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "sonar-pro",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
      max_tokens: 2000
    })
  });

  if (!r.ok) throw new Error(`Perplexity ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const data = await r.json();
  const text = data?.choices?.[0]?.message?.content || "";
  const parsed = safeParseJson(text);
  if (!parsed) throw new Error("Perplexity did not return valid JSON");
  parsed.source = "perplexity";
  parsed.enrichedAt = new Date().toISOString();
  return parsed;
}

async function handleProspectResearch(req, res) {
  try {
    const body = await readRequestBody(req);
    const input = body ? JSON.parse(body) : {};
    if (!process.env.PERPLEXITY_API_KEY) {
      sendJson(res, 200, { source: "no_key", message: "Add PERPLEXITY_API_KEY to your .env to enable web research." });
      return;
    }
    const result = await perplexityResearch(input);
    sendJson(res, 200, result);
  } catch (err) {
    sendJson(res, 500, { error: "Perplexity research failed", detail: err.message });
  }
}

async function handleProspectEnrich(req, res) {
  try {
    const body = await readRequestBody(req);
    const input = body ? JSON.parse(body) : {};

    let personRes = null;
    let orgRes = null;

    if (process.env.APOLLO_API_KEY) {
      const [p, o] = await Promise.allSettled([
        apolloPersonMatch(input),
        input.domain ? apolloOrgEnrich(input.domain) : Promise.resolve(null)
      ]);
      if (p.status === "fulfilled") personRes = p.value;
      if (o.status === "fulfilled") orgRes = o.value;
    }

    sendJson(res, 200, normalizeEnrichment(personRes, orgRes, input));
  } catch (err) {
    sendJson(res, 500, { error: "Enrichment failed", detail: err.message });
  }
}

async function handleAgent1(req, res) {
  try {
    const body = await readRequestBody(req);
    const { prospect = {}, enrichment = {}, signals = "", icp = {} } = body ? JSON.parse(body) : {};

    if (!process.env.OPENAI_API_KEY) {
      sendJson(res, 200, fallbackDossier(prospect, enrichment));
      return;
    }

    const text = await callOpenAI(buildAgent1Messages(prospect, enrichment, signals, icp));
    const parsed = safeParseJson(text);
    if (!parsed) throw new Error("Model did not return valid JSON");

    sendJson(res, 200, { source: "openai", dossier: parsed });
  } catch (err) {
    sendJson(res, 500, { error: "Agent 1 failed", detail: err.message });
  }
}

async function handleAgent2(req, res) {
  try {
    const body = await readRequestBody(req);
    const { dossier = {}, prospect = {} } = body ? JSON.parse(body) : {};

    if (!process.env.OPENAI_API_KEY) {
      sendJson(res, 200, fallbackColdEmail(dossier, prospect));
      return;
    }

    const text = await callOpenAI(buildAgent2Messages(dossier, prospect));
    const parsed = safeParseJson(text);
    if (!Array.isArray(parsed)) throw new Error("Model did not return JSON array");

    sendJson(res, 200, { source: "openai", emails: parsed });
  } catch (err) {
    sendJson(res, 500, { error: "Agent 2 failed", detail: err.message });
  }
}

async function handleAgent3(req, res) {
  try {
    const body = await readRequestBody(req);
    const { dossier = {}, prospect = {}, linkedinPosts = "" } = body ? JSON.parse(body) : {};

    if (!process.env.OPENAI_API_KEY) {
      sendJson(res, 200, fallbackLinkedIn(dossier, prospect));
      return;
    }

    const text = await callOpenAI(buildAgent3Messages(dossier, prospect, linkedinPosts));
    const parsed = safeParseJson(text);
    if (!parsed?.connection) throw new Error("Model did not return expected LinkedIn JSON");

    sendJson(res, 200, { source: "openai", messages: parsed });
  } catch (err) {
    sendJson(res, 500, { error: "Agent 3 failed", detail: err.message });
  }
}

async function handleAgent4(req, res) {
  try {
    const body = await readRequestBody(req);
    const { dossier = {}, prospect = {}, state = "no_open" } = body ? JSON.parse(body) : {};

    if (!process.env.OPENAI_API_KEY) {
      sendJson(res, 200, fallbackSequence(dossier, prospect, state));
      return;
    }

    const text = await callOpenAI(buildAgent4Messages(dossier, prospect, state));
    const parsed = safeParseJson(text);
    if (!parsed) throw new Error("Model did not return valid JSON");

    sendJson(res, 200, { source: "openai", sequence: parsed });
  } catch (err) {
    sendJson(res, 500, { error: "Agent 4 failed", detail: err.message });
  }
}

async function handleAgent5(req, res) {
  try {
    const body = await readRequestBody(req);
    const { reply = "", dossier = {}, prospect = {} } = body ? JSON.parse(body) : {};

    if (!process.env.OPENAI_API_KEY) {
      sendJson(res, 200, fallbackObjection(reply));
      return;
    }

    const text = await callOpenAI(buildAgent5Messages(reply, dossier, prospect));
    const parsed = safeParseJson(text);
    if (!parsed?.classification) throw new Error("Model did not return expected classification JSON");

    sendJson(res, 200, { source: "openai", result: parsed });
  } catch (err) {
    sendJson(res, 500, { error: "Agent 5 failed", detail: err.message });
  }
}

function serveStatic(req, res) {
  const reqPath = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);
  const rel = reqPath === "/" ? "/index.html" : reqPath;
  const safe = path.normalize(rel).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, safe);
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end("Forbidden"); return; }
  fs.readFile(filePath, (err, content) => {
    if (err) { res.writeHead(404); res.end("Not found"); return; }
    res.writeHead(200, { "content-type": MIME[path.extname(filePath)] || "application/octet-stream" });
    res.end(content);
  });
}

// ── Router ───────────────────────────────────────────────────────────────────

const POST_ROUTES = {
  "/api/ai/icp-section": handleAiIcp,
  "/api/prospect/enrich": handleProspectEnrich,
  "/api/prospect/research": handleProspectResearch,
  "/api/agent/1-research": handleAgent1,
  "/api/agent/2-cold-email": handleAgent2,
  "/api/agent/3-linkedin": handleAgent3,
  "/api/agent/4-sequence": handleAgent4,
  "/api/agent/5-objection": handleAgent5
};

const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && pathname === "/api/status") {
    sendJson(res, 200, {
      apollo: !!process.env.APOLLO_API_KEY,
      openai: !!process.env.OPENAI_API_KEY,
      perplexity: !!process.env.PERPLEXITY_API_KEY,
      agentModel: process.env.OPENAI_AGENT_MODEL || "gpt-5.5"
    });
    return;
  }

  if (req.method === "POST") {
    const handler = POST_ROUTES[pathname];
    if (handler) { handler(req, res); return; }
  }

  if (req.method === "GET") { serveStatic(req, res); return; }

  res.writeHead(405);
  res.end("Method not allowed");
});

server.listen(PORT, () => {
  const hasApollo = !!process.env.APOLLO_API_KEY;
  const hasOpenAI = !!process.env.OPENAI_API_KEY;
  const hasPerplexity = !!process.env.PERPLEXITY_API_KEY;
  console.log(`Apex outbound dashboard → http://localhost:${PORT}`);
  console.log(`Apollo: ${hasApollo ? "connected" : "not set — enrichment will use manual data"}`);
  console.log(`OpenAI: ${hasOpenAI ? "connected" : "not set — agents will use local drafts"}`);
  console.log(`Perplexity: ${hasPerplexity ? "connected (key prefix: " + process.env.PERPLEXITY_API_KEY.slice(0,8) + "...)" : "not set — web research unavailable"}`);
  if (hasOpenAI) console.log(`Agent model: ${process.env.OPENAI_AGENT_MODEL || "gpt-5.5"}`);
});
