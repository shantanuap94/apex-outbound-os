require("dotenv").config();
const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");
const pdfParse = require("pdf-parse");

function normalizeExtractUrl(inputUrl) {
  let u = (inputUrl || "").trim();
  // Google Drive file view → direct download
  const driveFile = u.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (driveFile) return `https://drive.google.com/uc?export=download&id=${driveFile[1]}`;
  // Google Docs → plain text export
  const gDoc = u.match(/docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/);
  if (gDoc) return `https://docs.google.com/document/d/${gDoc[1]}/export?format=txt`;
  // Google Sheets → CSV export
  const gSheet = u.match(/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (gSheet) return `https://docs.google.com/spreadsheets/d/${gSheet[1]}/export?format=csv`;
  // Add https:// if protocol missing
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  return u;
}

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

// ─── AI Endpoint Router ───────────────────────────────────────────────────────
const OPENAI_MODELS = new Set(["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"]);

function getAIEndpoint(model) {
  const m = model || "gpt-4o";
  // Native OpenAI model + key available → use OpenAI directly
  if (OPENAI_MODELS.has(m) && process.env.OPENAI_API_KEY) {
    return { url: "https://api.openai.com/v1/chat/completions", key: process.env.OPENAI_API_KEY, model: m };
  }
  // Everything else → OpenRouter
  if (process.env.OPENROUTER_API_KEY) {
    return { url: "https://openrouter.ai/api/v1/chat/completions", key: process.env.OPENROUTER_API_KEY, model: m };
  }
  // Fallback to OpenAI with whatever model was requested
  return { url: "https://api.openai.com/v1/chat/completions", key: process.env.OPENAI_API_KEY || "", model: m };
}

function aiHeaders(endpoint) {
  return {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${endpoint.key}`,
    ...(endpoint.url.includes("openrouter") ? {
      "HTTP-Referer": "https://intelligentoutbound.com",
      "X-Title": "Intelligent Outbound OS",
    } : {}),
  };
}

// Strip markdown code fences that some models (Claude) wrap around JSON
function parseAIJson(content) {
  const s = (content || "{}").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  return JSON.parse(s);
}

// ─── Handlers ────────────────────────────────────────────────────────────────
async function handleStatus(req, res) {
  json(res, {
    openai: !!(process.env.OPENAI_API_KEY || process.env.OPENROUTER_API_KEY),
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
      const ep1 = getAIEndpoint(body.model || "gpt-4o");
      const r = await fetch(ep1.url, {
        method: "POST",
        headers: aiHeaders(ep1),
        body: JSON.stringify({
          model: ep1.model,
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
    const ep2 = getAIEndpoint(body.model || "gpt-4o");
    const r = await fetch(ep2.url, {
      method: "POST",
      headers: aiHeaders(ep2),
      body: JSON.stringify({
        model: ep2.model,
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
        ...(ep2.url.includes("openai") ? { response_format: { type: "json_object" } } : {}),
        max_tokens: 2500,
      }),
    });
    const data = await r.json();
    const content = data.choices?.[0]?.message?.content;
    json(res, { icp: parseAIJson(content) });
  } catch (e) {
    json(res, { error: e.message }, 500);
  }
}

// ─── Context Compression ─────────────────────────────────────────────────────
function compressContext(apolloData, perplexityText, manualSignals) {
  const signals = [];
  if (manualSignals) signals.push(...manualSignals.split('\n').map(s => s.trim()).filter(Boolean).slice(0, 8));
  if (perplexityText) {
    // Pull first 600 chars of Perplexity output as the key intel
    signals.push(perplexityText.trim().substring(0, 600));
  }
  return {
    company:   apolloData?.organization?.name || apolloData?.company || 'Unknown',
    headcount: apolloData?.organization?.estimated_num_employees || apolloData?.headcount || 'Unknown',
    location:  apolloData?.organization?.city || apolloData?.location || 'Unknown',
    title:     apolloData?.title || apolloData?.job_title || 'Unknown',
    email:     apolloData?.email || apolloData?.work_email || null,
    confidence: apolloData ? 'high' : 'none',
    signals:   signals.filter(Boolean),
  };
}

// ─── Chain Run (SSE streaming) ─────────────────────────────────────────────────
async function handleChainRun(req, res) {
  // Set SSE headers immediately — keeps connection alive past any proxy timeout
  res.writeHead(200, {
    'Content-Type':      'text/event-stream',
    'Cache-Control':     'no-cache',
    'Connection':        'keep-alive',
    'X-Accel-Buffering': 'no',
    'Access-Control-Allow-Origin': '*',
  });

  const sendEvent = (payload) => {
    try { res.write(`data: ${JSON.stringify(payload)}\n\n`); } catch (_) {}
  };

  try {
    const body = await readBody(req);
    const { prospect, icp, senderProfile, step, dossier, signalContext, linkedinPosts, sequenceState, reply, fewShotExamples, emailNumber, previousEmails } = body;

    const sender = senderProfile || {};
    const senderName    = sender.name    || "the sender";
    const senderRole    = sender.role    || "";
    const senderOffer   = sender.offer   || "";
    const senderValueProp = sender.valueProp || "";
    const senderProof          = sender.proof          || "";
    const senderCta            = sender.cta            || "a 15-minute conversation";
    const senderTone           = sender.tone           || "peer-to-peer";
    const senderAuthorityBlock  = sender.authorityBlock  || "";
    // Advanced Profile fields
    const senderOfferMechanism  = sender.offerMechanism  || "";
    const senderOutcomeTimeframe = sender.outcomeTimeframe || "";
    const senderLowRiskOffer    = sender.lowRiskOffer    || "";
    const senderDifferentiation = sender.differentiation || "";
    const senderProofCards      = sender.proofCards      || "";
    const senderVoiceSamples    = sender.voiceSamples    || "";
    const senderBannedWords     = sender.bannedWords     || "";
    const senderAuthorityOpinion = sender.authorityOpinion || "";
    const currentYear   = new Date().getFullYear();

    const systemPrompt = `You are a B2B outreach strategist writing on behalf of ${senderName}${senderRole ? ", " + senderRole : ""}.

THE SENDER:
- Name: ${senderName}
- Role: ${senderRole}
- What they offer: ${senderOffer}
- Why it matters to their ICP: ${senderValueProp}
${senderProof ? `- Social proof: ${senderProof}` : ""}
- Preferred tone: ${senderTone}
- CTA preference: ${senderCta}

ICP — WHO THEY SELL TO:
${JSON.stringify(icp || {})}

CRITICAL RULES:
1. Every message is written FROM ${senderName} — always introduce them naturally in emails (never be abrupt, never skip who you are)
2. NEVER fabricate statistics, percentages, or data. Only use numbers that appear in the dossier or signal context
3. Current year is ${currentYear}. Never reference any other year for "goals" or "priorities"
4. Use the ICP's Empathy Map (think, feel, hear, see, say & do) and NDFFO (needs, desires, fears, frustrations, objections) to frame every message
5. Be specific — every message must feel like it was written only for this person, not a template
6. Tone: ${senderTone}`;

    const p = prospect?.name || "this prospect";
    const co = prospect?.company || "their company";
    const role = prospect?.title || "their role";
    const prospectEmail = prospect?.email ? `\nEmail: ${prospect.email}` : "";
    const prospectPhone = prospect?.phone ? `\nPhone/WhatsApp: ${prospect.phone}` : "";
    const dossierCtx = dossier ? `\n\nIntelligence Dossier:\n${dossier}` : "";

    // ── ICP emotional shortcuts for prompt injection ──
    const icpPains        = icp?.pains || "";
    const icpFears        = icp?.fears || "";
    const icpFrustrations = icp?.frustrations || "";
    const icpDesires      = icp?.dreamOutcomes || "";
    const icpSayLoud      = icp?.empathySayLoud || "";
    const icpThinkPriv    = icp?.empathyThinkPrivately || "";
    const icpFeel         = icp?.empathyFeel || "";
    const icpActuallyDo   = icp?.empathyActuallyDo || "";
    // Buying Intelligence fields
    const icpTriggers          = icp?.triggers          || "";
    const icpCurrentAlt        = icp?.currentAlternative || "";
    const icpObjections        = icp?.objections        || "";
    const icpExactWords        = icp?.exactWords        || "";
    const icpDisqualifiers     = icp?.disqualifiers     || "";
    const icpBuyingCommittee   = icp?.buyingCommittee   || "";
    const icpSeniorityFraming  = icp?.seniorityFraming  || "";

    const researchPrompt = `Produce a full prospect intelligence brief for ${senderName} to send to:
Prospect: ${JSON.stringify(prospect)}
What ${senderName} offers: ${senderOffer}
${signalContext ? `\nSignal Context (company news, research):\n${signalContext}` : ""}
ICP psychological profile for reference: ${JSON.stringify(icp || {})}

Respond in exactly these 7 sections:

## 0. 10/10 Research Layer — Specific Signals
These are the details that make outreach feel personally researched, not mass-mailed. Extract from the signal context above. These feed directly into Touch 5, 6, and 7 messages.

- **Company founding year + origin story:** [year founded, city/region, what they originally made or did]
- **Exact product / brand / project names:** [list the actual names — not "their product range". e.g. "Yummy Bowls, Rings, Mix, Noodles" not "snack products"]
- **Recent launches with dates:** [product name + month + year — last 12 months only. e.g. "Hula Hoops Smoky Bacon, March 2025"]
- **Prospect career history:** [past companies → past roles → approximate years, going back 3-5 positions. e.g. "DHL Supply Chain Consultant → Demand Planning at Reckitt Benckiser Ireland → KP Snacks"]
- **Their customer / end-user:** [who ${co} sells to — industry, company type, or end consumer]
- **Compliance / audit context:** [certifications or regulations they live with — BRC, ISO, RERA, FSSAI, SONCAP, FDA, HACCP, etc.]
- **Geography + logistics context:** [where they ship, ports or routes they use, freight/supply chain considerations]
- **A coincidence or connection:** [anything that creates a human moment — a shared location, a market they both serve, an unusual parallel]

If any field is not available in the signal context: mark it "Not found — research manually." Do not invent.

## 1. Company Intelligence
- What the company does, size, market position, competitive landscape
- Recent signals: expansions, new products/services, leadership changes, awards, press, or industry tailwinds/headwinds (cite only what is in the signal context — do not invent figures)
- The 2-3 things leadership is most likely obsessed with right now

## 2. Role & Decision-Making Analysis
- What does a ${role} actually own and care about day-to-day?
- KPIs they are measured on
- Where are they feeling the most pressure or friction right now?
- Decision-maker, influencer, or champion for ${senderName}'s offer? Be specific.

## 3. Empathy Map (tailored to this prospect and their company)
- THINK & FEEL: Private worries and ambitions — what does success look like for them personally?
- HEAR: What their boss, board, peers, or market is telling them right now
- SEE: What they observe in their industry and their own org
- SAY & DO: How they present themselves publicly vs. how they actually behave under pressure

## 4. NDFFO — Psychological Profile (this prospect specifically)
- NEEDS: The functional outcome they need right now
- DESIRES: The deeper career or business aspiration
- FEARS: What keeps them up at night; what failure looks like
- FRUSTRATIONS: Daily friction — people, processes, or market conditions
- OBJECTIONS: The exact reasons they will say no or go cold to ${senderName}'s outreach

## 5. Ice Breaker Bank
Write 3 specific, ready-to-use ice breakers. Each must reference a real signal from Section 0 or the role context — nothing invented.
- Ice Breaker 1 (Company / Product Signal): [one sentence — names an exact product, launch, or company fact from Section 0]
- Ice Breaker 2 (Role / Pain Signal): [one sentence — ties to their job pressure or a frustration]
- Ice Breaker 3 (Personal / Career Signal): [one sentence — ties to their career history or aspiration from Section 0]

## 6. Outreach Strategy for ${senderName}
- Sharpest angle: the single most compelling reason ${p} should care about ${senderOffer} right now
- Tone to use: [per sender preference: ${senderTone}]
- Best first channel: email or LinkedIn, and why
- The one thing NOT to say (the generic line that will make ${p} delete/ignore it)

## Intelligence Score: [N] / 100
Brief note on confidence level and what is confirmed from research vs. inferred.`;

    const stepPrompts = {
      research: researchPrompt,

      hook: `Using the research, empathy map, and NDFFO for ${p} at ${co}, write 5 opening hooks for ${senderName}'s cold outreach.

Each hook must:
- Reference a specific signal, fear, frustration, or desire from the dossier — not a generic pain
- Feel like it came from someone who understands their world
- Be under 2 sentences

Empathy context:
- They feel: ${icpFeel}
- They privately think: ${icpThinkPriv}
- Their frustrations: ${icpFrustrations}
- Their desires: ${icpDesires}

Format as:
1. [Label — e.g. Fear-led / Signal-led / Desire-led / Frustration-led / Contrarian]:
   [Hook text]

After 5 hooks: ★ Recommended: #[N] — [one sentence on why]`,

      email: `Using the research, empathy map, NDFFO, and ice breakers for ${p} at ${co}, write a cold email FROM ${senderName}.${dossierCtx}

Structure:
Subject: [specific, curiosity-driven, under 8 words — no clickbait]
---
[Opening line: use the strongest ice breaker or a fear/frustration hook — 1 sentence]
[Introduce yourself: one natural sentence on who ${senderName} is and what ${senderName} does — not salesy]
[Bridge: connect their specific pain/desire to what ${senderName} offers — 1-2 sentences]
[Proof: one grounded, specific reason to believe — no invented percentages — 1 sentence]
[CTA: ${senderCta} — low friction, no pressure]

Rules:
- Total body: max 100 words
- No "I hope this finds you well", no "we help companies like yours", no buzzwords, no invented statistics
- Tone: ${senderTone}`,

      linkedin: `Write a LinkedIn CONNECTION REQUEST and a FOLLOW-UP DM for ${p} (${role}) at ${co}, from ${senderName}.${dossierCtx}
${linkedinPosts ? `\nTheir recent LinkedIn posts:\n${linkedinPosts}\n` : ""}

THE SENDER (${p} does not know them):
- ${senderName}, ${senderRole}
- Company: ${senderOffer}

Emotional context for ${p}:
- They feel: ${icpFeel}
- They privately think: ${icpThinkPriv}
- Their desires: ${icpDesires}
- Their frustrations: ${icpFrustrations}

---

## CONNECTION REQUEST (under 280 characters — strict):

Formula: "Hi [Name], [ONE specific signal from dossier — name the actual product/launch/fact/career move]. I'm [${senderName}] from [company], [1 short line on what the company does]. Would love to connect."

BAD (do not write this): "Vivek, your emphasis on seamless efficiency and compliance deeply resonates. I'm Shantanu from TBI Corn. Would love to connect."
WHY BAD: sycophantic, vague, no real signal, sounds like a bot.

GOOD (write this): "Hi Vivek, noticed Cremica just added 6 extruded snack SKUs to the Crunch range. I'm Shantanu from TBI Corn — BSE-listed corn processor, supplying to ITC and Haldiram's. Would love to connect."
WHY GOOD: names the actual product/signal, introduces the sender with a credibility hook, sounds like a peer.

Rules:
- The signal MUST name something REAL and SPECIFIC — a product name, a launch, an expansion. NOT "your work in food manufacturing" or "your focus on supply chain efficiency."
- Introduce ${senderName} with one authority hook — company name + one credential (listed status, named client)
- No sycophancy: no "deeply resonates", "love your work", "great profile", "inspiring journey"
- Under 280 characters strictly

---

## FOLLOW-UP DM — send 3-4 days after connecting (write as long as needed — DO NOT compress):

CRITICAL OUTPUT RULE: Write a single flowing message with NO section labels, NO "Part 1 / Part 2 / Part 3" markers, NO structural headers of any kind. The message should read exactly as if a real person typed it on their phone. Do not output any meta-commentary about the structure.

Write the DM working through these points in order — invisibly, without labelling them:

Open with genuine warmth — 2 sentences max. The ONLY prior contact was the connection request. There was no prior exchange, no call, no earlier conversation. Do NOT write "during our initial exchange" or "from our earlier chat." Start: "Hi [Name], appreciate the connection — really glad to have you in my network." Follow with one specific, human sentence acknowledging their role or company (specific, not flattering). Example: "I have followed Britannia's expansion for a while and your role sits right at the centre of where product innovation meets procurement reality."

Continue with "I was thinking about your world..." — then describe ${p}'s specific situation using named facts from the dossier. Name their actual products, their company's position, a recent expansion, their role pressure. Make them feel you actually looked. Not "the food industry" — name the company, name specific products, name the move. Use only what the dossier gives you.

Name the specific operational headache — not the category. The actual mechanism: inconsistent particle size affecting yield on the extruder, OTIF pressure from a large retail account, supplier consolidation risk, seasonal volume spikes with long lead times. Draw from: ${icpFrustrations}${icpExactWords ? `\nMirror their language where possible — these are phrases real buyers use: ${icpExactWords}` : ""}

Add one sentence of company context — positioned as background, not a pitch. "For context, I'm ${senderName} from [company] — [one specific, factual line on credentials and why it's relevant to their situation]." Use only what's in the sender profile.

Offer something specific for their file — a COA, spec sheet, market note, or landed cost comparison. Use the phrase "no strings attached, even if you're not looking to switch." This is value delivery, not a pitch.${senderLowRiskOffer ? `\nPreferred offer: ${senderLowRiskOffer}` : ""}

Close warmly — no meeting ask in this message. The goal is to build the human connection first. Something like: "Would love to get to know you properly. If it ever makes sense, I'd be glad to share a sample or find some way I can genuinely add value to this connection. No rush at all — just good to be connected." Then sign off: Best, ${senderName}

Rules:
- Simple, human language — short sentences, no corporate phrases
- Warm and personal, not transactional
- No meeting request — only a soft offer of value and a genuine human close
- No "I hope this message finds you well", no "I wanted to reach out"
- Write like a real person sent it from their phone

Tone: ${senderTone} — conversational, warm, peer-to-peer.

---

Label each clearly: CONNECTION REQUEST and FOLLOW-UP DM.`,

      sequence: `Using the intelligence dossier for ${p} at ${co}, write a 3-touch outreach sequence FROM ${senderName}.${dossierCtx}

CONTEXT: This is high-ticket B2B outreach with a long sales cycle. The goal of this sequence is to start a relationship, not close a deal. Each touch adds value — gives something real — and never repeats the same angle twice. No word count restrictions: write as much as the message needs to be specific and credible.

THE SENDER: ${senderName}, ${senderRole} — ${senderOffer}
${senderProof ? `Proof (use named, never invent): ${senderProof}` : ""}

TOUCH 1 — Day 1 · Email
Subject: [specific to this prospect — reference a product, launch, or company signal]
Body:
- Line 1: ICEBREAKER — one specific, named, researched signal about ${p} or ${co} from the dossier
- Line 2: Sender intro with authority — name, role, company, credentials (named clients, years operating, certifications)
- Lines 3-4: Bridge — connect their specific situation to what ${senderName} offers. Technical and specific — name the ingredient, the mechanism, the outcome. Do NOT position as a replacement for their current supplier — position as a second source that improves supply chain reliability. Most procurement managers have a primary supplier and won't switch, but they will add a second qualified source to de-risk their line. Make this feel like an upgrade to their supply chain, not a disruption.
- Line 5: Proof — named client or credential. Never invent.
- Line 6: CTA — ask them to share their current spec so you can send a matched sample. "If you could share your current spec, I'd be happy to send a matched sample — no commitment at all."
- Full signature: name · role · company · contact

TOUCH 2 — Day 4 · LinkedIn DM
- Different angle from Touch 1 — draw from a desire or aspiration: ${icpDesires}
- Conversational, warm, peer tone — not a follow-up reminder
- Offer something new (a market insight, a specific document, a relevant question about their process)
- Soft ask for their official email to continue properly

TOUCH 3 — Day 8 · Email (Break-up)
- Acknowledge no response — warmly, not passive-aggressively
- Add one new piece of genuine value: a market note, a technical insight, or a specific piece of information relevant to their product line
- Final CTA with the lowest possible bar: "even if timing isn't right, happy to keep this for when it is"
- Leave the door open — this is a long-cycle business

Each touch: different angle, different emotional register. No invented statistics.`,

      outreach: (() => {
        const emailNum = emailNumber || 1;
        const prevE1 = previousEmails?.e1 || "";
        const prevE2 = previousEmails?.e2 || "";
        const prevE3 = previousEmails?.e3 || "";

        const sharedRules = `
CRITICAL RULES — READ BEFORE WRITING ANYTHING:
- The sender's name is ${senderName}. Use EXACTLY this name. Never substitute, shorten, or replace.
- SIGNATURE FORMAT — exact, nothing else: ${senderName} · ${senderRole}. No taglines. No invented text.
- PRODUCT CATEGORIES — only what is in the offer field. Never add, infer, or invent categories.
- YEARS/NUMBERS — use exact phrasing from offer field verbatim. Never calculate or convert.

THE SENDER:
- Name: ${senderName}
- Role: ${senderRole}
- Offer: ${senderOffer}
- Why it matters to ${p}: ${senderValueProp}
- Proof (verbatim only): ${senderProof || "Use company credentials factually — years operating, listed status, plant count."}

SENDER ADVANCED PROFILE:${senderOfferMechanism ? `\n- How it works: ${senderOfferMechanism}` : ""}${senderOutcomeTimeframe ? `\n- Outcome + timeframe: ${senderOutcomeTimeframe}` : ""}${senderLowRiskOffer ? `\n- Low-risk first offer: ${senderLowRiskOffer}` : ""}${senderDifferentiation ? `\n- Differentiation: ${senderDifferentiation}` : ""}${senderProofCards ? `\n- Proof cards:\n${senderProofCards}` : ""}${senderAuthorityOpinion ? `\n- Authority opinion (use sparingly for credibility): ${senderAuthorityOpinion}` : ""}${senderBannedWords ? `\n- ADDITIONAL BANNED WORDS (never use these): ${senderBannedWords}` : ""}${senderVoiceSamples ? `\n\nVOICE SAMPLES — match this tone and writing style exactly:\n${senderVoiceSamples}` : ""}

PROSPECT CONTACT DATA:
- Name: ${p}
- Title: ${role}
- Company: ${co}${prospectEmail}${prospectPhone}${prospect?.linkedin ? `\n- LinkedIn: ${prospect.linkedin}` : ""}

ICP EMOTIONAL PROFILE of ${p} (${role}) at ${co}:
- Pains: ${icpPains}
- Fears: ${icpFears}
- Frustrations: ${icpFrustrations}
- Dream outcomes: ${icpDesires}
- Says out loud: ${icpSayLoud}
- Privately thinks: ${icpThinkPriv}${icpTriggers ? `\n- Buying triggers: ${icpTriggers}` : ""}${icpCurrentAlt ? `\n- What they use today instead: ${icpCurrentAlt}` : ""}${icpObjections ? `\n- Key objections + responses: ${icpObjections}` : ""}${icpExactWords ? `\n- Their exact words (mirror this language): ${icpExactWords}` : ""}${icpSeniorityFraming ? `\n- Seniority framing: ${icpSeniorityFraming}` : ""}

POSITIONING RULE:
Do NOT position as a replacement. Position as a SECOND SOURCE. Most procurement managers have a primary supplier and won't switch. But they will add a second qualified source to de-risk their line. Every email should feel like a supply chain upgrade, not a disruption.

WORD COUNT:
- India/MENA/West Africa: 180–250 words. Relationship markets. They read.
- UK/US/Europe: 100–140 words. They skim.
Long and credible beats short and vague. Long and fluffy loses.

SENTENCE STRUCTURE:
Max 15 words per sentence. One idea per sentence. Full stop instead of comma when in doubt.
BAD: "The ingredients you source, particularly when running multiple SKUs at scale, require consistency beyond what the spec sheet alone can guarantee."
GOOD: "The spec sheet looks fine. The COA matches. But batch 47 behaves differently from batch 3. At this volume, that's not a line note — that's a stoppage."

USE CONTRACTIONS — always: you're / we've / it's / don't / that's / I'm / we're / they've / you'll

BANNED PHRASES:
"Hope this finds you well" / "Just following up" / "Circling back" / "As per my last email"
"We help companies like yours" / "Leverage synergies" / "seamless efficiency" / "value proposition"
"A testament to your growth / market leadership" / "innovative" / "premium" / "industry-leading"
"Leader in [X] Industry" — never in signature or anywhere else
Any fabricated statistic or trend not directly from the dossier
Any company tagline you invented for the sender

TONE: ${senderTone} — warm, peer-to-peer, expert but not arrogant.
Subject line: specific, under 8 words, references a real thing from the dossier.${dossierCtx}${fewShotExamples && fewShotExamples.length > 0 ? `

REAL EXAMPLES THAT GOT REPLIES — study tone, length, specificity. Do not copy:
${fewShotExamples.map((ex, i) => `--- Example ${i+1} ---\nSubject: ${ex.subject || "(no subject)"}\n${ex.body}`).join("\n\n")}` : ""}`;

        if (emailNum === 1) return `Write EMAIL 1 of a 4-email cold outreach sequence FROM ${senderName} TO ${p} (${role}) at ${co}. This is the FIRST email. ${p} does not know ${senderName} at all. Goal: intrigue, build credibility, and earn a reply.
${sharedRules}

CRITICAL OUTPUT RULE: Write the email exactly as it would be sent — no structural labels, no LINE markers, no section annotations in the output. Clean email only.

Use this exact subject line (do not change it): Subject: Corn ingredients for ${co} | TBI Corn

EMAIL BODY — write in this order, no labels or markers in your output:

1. ICEBREAKER (opening line): One specific, researched observation about ${p} or ${co}. Must name an ACTUAL PRODUCT, BRAND, LAUNCH, or SPECIFIC FACT from the dossier. Not a generic compliment. This line must make ${p} feel you did your homework on them specifically.
BANNED: "I've been following [company]'s impressive move to..." / "A testament to your growth" / "Congrats on [generic achievement]"
GOOD: "Gopal Snacks is rolling out 26 new products by November — that kind of push across Gathiya, Bhujia, and extruded lines puts real pressure on corn grit consistency run to run."
BAD: "I've been following Gopal Snacks' impressive move to add 26 new products — a testament to your market growth."

2. SENDER INTRO: Who the sender is — natural, not salesy. 1-2 sentences. ${p} is a stranger who needs enough context to keep reading.
${senderAuthorityBlock
  ? `Use this pre-approved authority block VERBATIM — do not rewrite, shorten, or paraphrase:\n"${senderAuthorityBlock}"`
  : `Include: full name and role, company name (BSE/NSE status if applicable), exact product categories (named), years in operation, plant count, named clients, certifications. Earn the right to keep reading.\nExample: "I'm Shantanu — I head Growth at TBI Corn Limited, a BSE/NSE-listed corn processing company with 4 plants across Miraj, Mumbai, Delhi, and Malkapur, milling since 1999. We supply corn grits and fine corn flour to ITC, Pratap Snacks, and Balaji Wafers — ingredients where particle size uniformity, consistent expansion, and controlled oil uptake drive line efficiency and OTIF reliability at scale. ISO 22000:2018, ISO 9001, Halal, APEDA, and Kosher certified."`}
ONLY USE WHAT THE SENDER PROFILE PROVIDES. Never invent plant names, certifications, clients, or categories.

3. TECHNICAL BRIDGE: Connect their specific product category to the exact corn ingredient and the operational mechanism. Not "supply chain challenges" — the actual headache: inconsistent particle size, batch deviations, QA escalations, OTIF pressure. Name their specific products. Make ${p} feel understood.

4. SOFT CTA: "Would love to understand ${co}'s current sourcing setup and share our spec sheets / COA for your review — no commitment at all. Happy to arrange a sample for your NPD / QC team if there's a potential fit. If the dossier mentions a specific destination port or city, add: ', and we can work on a competitive landed cost to [city].'"

Then add: "Would a quick 20-min call next week be useful?"

SIGN OFF: Warm regards, ${senderName} · ${senderRole}

Output only the final email, ready to send. Subject line at the top, then the body, then sign-off.`;

        if (emailNum === 2) return `Write EMAIL 2 of a 4-email cold outreach sequence FROM ${senderName} TO ${p} (${role}) at ${co}. ${p} received Email 1 but has not replied.
${sharedRules}

CONTEXT — Email 1 that was already sent (do not repeat its content or approach):
${prevE1 ? prevE1 : "[Email 1 was the pain-led intro with full authority block]"}

EMAIL 2 RULES:
- Different emotional register from Email 1. Do NOT reference Email 1 or say "following up."
- Lead with a SPECIFIC TRIGGER from the dossier — a company launch, expansion, investment, new product line, market move. Frame it as an opportunity, not a problem.
- Bridge: connect this trigger to why having a second qualified source matters RIGHT NOW because of this trigger — not someday.
- No full authority block — they've seen it. One short credibility reminder only: "[Company name], [one credential]."
- CTA: Reoffer the sample/spec exchange OR offer something specific for their file — a COA, a grade comparison, a market note. Name it precisely. "No strings attached."
- End: a soft question tied to the trigger that makes them answer yes or no, not ignore.
SIGN OFF: ${senderName} · ${senderRole}

Output only the final email, ready to send. Include the subject line at the top.`;

        if (emailNum === 3) return `Write EMAIL 3 of a 4-email cold outreach sequence FROM ${senderName} TO ${p} (${role}) at ${co}. ${p} has not replied to Emails 1 or 2.
${sharedRules}

CONTEXT — Emails already sent (do not repeat or reference them):
Email 1: ${prevE1 ? "[Pain-led intro with authority block and spec/sample offer]" : "[Pain-led intro]"}
Email 2: ${prevE2 ? "[Trigger-led with specific company trigger]" : "[Trigger-led]"}

EMAIL 3 RULES:
- Lead with a sharp MARKET INSIGHT or OPERATIONAL TRUTH that is useful to ${p} regardless of whether they buy. Give something they can use in their job: a benchmark, a trend, a data point about ingredient quality standards, a procurement practice observation.
- Make them think: "this person actually knows this space."
- Do NOT ask for the spec or the sample in this email. Earn credibility through genuine usefulness.
- No reference to previous emails. This should feel like a new, standalone value add.
- Soft meeting mention at end — not a hard ask. "Happy to walk through how we've approached this with [client type] if 20 minutes ever makes sense — no deck, just a conversation."
- End: a question that opens a door — curious about their current process or a specific challenge they face.
SIGN OFF: ${senderName} · ${senderRole}

Output only the final email, ready to send. Include the subject line at the top.`;

        if (emailNum === 4) return `Write EMAIL 4 of a 4-email cold outreach sequence FROM ${senderName} TO ${p} (${role}) at ${co}. This is the FINAL email. ${p} has not replied to any of the previous three emails.
${sharedRules}

CONTEXT — Emails already sent (do not repeat or reference them):
Email 1: Pain-led intro with full authority block
Email 2: Trigger-led — specific company trigger + second source opportunity
Email 3: Insight-led — market truth + soft meeting mention
${prevE3 ? `Summary of Email 3 tone/angle: [insight-led, no hard ask]` : ""}

EMAIL 4 RULES — THE HIGHEST-CONVERTING EMAIL IN A B2B PROCUREMENT SEQUENCE:
- Open by naming the elephant in the room DIRECTLY: "You almost certainly already have a corn supplier. Most procurement leads I talk to do."
- Flip it immediately: that's exactly why 20 minutes is worth it. Not to replace anyone — but to have a qualified second source ready BEFORE they need one. A batch deviation, a capacity shortfall, a supplier quality issue — these don't announce themselves. The procurement managers who handle them best are the ones who already have a second source qualified and on file.
- Name one specific, realistic scenario where a second source would have saved them: a batch rejection during a peak production run, a supplier missing spec on a large order. Real scenario, no invented statistics.
- DIRECT ASK for a 20-minute call. Suggest 2 specific time windows. Frame it as: "Enough time to share our spec and COA, you tell me if it's even worth running a sample trial. That's it."
- Easy out: "If timing isn't right, just say park it for Q2 — no hard feelings. I'll keep the door open."
- This email earns permission to be direct because 3 previous value-adds have been made.
SIGN OFF: ${senderName} · ${senderRole}

Output only the final email, ready to send. Include the subject line at the top.`;

        return `Write a cold outreach email FROM ${senderName} TO ${p} at ${co}.${sharedRules}`;
      })(),

      followup: `Using the full intelligence dossier for ${p} at ${co}, build a complete 8-TOUCH RELATIONSHIP CADENCE from ${senderName}.${dossierCtx}

THE SENDER: ${senderName}, ${senderRole}
Offer: ${senderOffer}
Value proposition: ${senderValueProp}
${senderProof ? `Proof: ${senderProof}` : ""}

ICP EMOTIONAL PROFILE:
- Needs / pains: ${icpPains}
- Desires: ${icpDesires}
- Fears: ${icpFears}
- Frustrations: ${icpFrustrations}
- Say out loud: ${icpSayLoud}
- Privately feel: ${icpFeel}
- Privately think: ${icpThinkPriv}

MASTER RULE: Every touch GIVES, never asks. The ask (meeting, call, order) is always the lightest possible thing after the heaviest possible giving. Use exact product / project / brand names from the dossier — never write "your products" or "your range". No invented statistics or percentages.

---

TOUCH 1 — Day 1 · 💼 LinkedIn Connection Request (under 300 characters)
Signal-led hook. Reference ONE specific real thing about ${p}'s work — a company launch, a role milestone, a recent post, or a market signal from the dossier. Write as a peer who noticed something interesting, not a vendor. No pitch. No "I'd love to connect." No "love your work." Must feel like only ${p} could receive this.

TOUCH 2 — Day 3-4 · 💼 LinkedIn DM (under 400 characters)
Post-accept warmth. Open with a genuine observation about their world — draw from NDFFO desires: ${icpDesires}. Offer a useful document for their file — name it specifically (COA / spec / market note / case study), never say "our brochure". Ask for official email to send it on. ONE soft question. No pitch.

TOUCH 3 — Day 7-8 · 💼 LinkedIn DM (180-250 words for India/MENA; 100-140 for UK/US)
"Last message from my side for now — don't want to crowd your inbox." Then: tell a story of a SIMILAR BUYER with a SIMILAR PAIN and a SPECIFIC OUTCOME. Name the exact mechanism of the problem and what changed when it was fixed — use real situations, not invented stats. Bridge to ${p}'s situation with one sentence. Reoffer the specific document for their file. Exit offer: "If not now, just say park it for Q2, no hard feelings." NO invented data.

TOUCH 4 — Day 10-12 · 📧 Email (120 words max) + 💬 WhatsApp nudge (same day)
EMAIL: Subject line — "For your file — [specific document name] / ${co}"
6-part structure: (1) "Following up from LinkedIn — as promised..." (2) One sentence on ${p}'s specific situation — name their exact challenge by name (3) Bulleted list of 2-3 named attachments — name each document precisely (4) "Even if you never buy from us, it's a useful benchmark" — this line is non-negotiable (5) Soft CTA: 15-20 min chat, no deck, work around their timezone (6) Signature with certifications relevant to their market
WHATSAPP (9am same day): "Hi ${p}, sent you [specific doc] on email for your ${co} file — from our LinkedIn chat. Sharing here in case email goes to spam. Let me know if you got it — ${senderName}"

TOUCH 5 — Day 16-18 · 💬 WhatsApp or 💼 LinkedIn (People/Team Story — 120-160 words)
"Was at [location] yesterday — reminded me of our conversation." Share a REAL SCENE from your ground team doing a routine quality/process/dispatch check. Name the person doing the check. Name what they were doing and why it matters for consistency. "Not for marketing — just [person] doing [routine task]." Attach: a real candid photo/30-sec video, not a brochure. Use exact product names from dossier in the story. End with ONE human question about their work. NO ASK. Only give.

TOUCH 6 — Day 25-30 · 📧 Email (Market Intelligence — 100-130 words)
"Thought this might be useful for your [their role/planning cycle] — no ask attached." Share REAL market data relevant to THEIR function — numbers they can use in their job even when evaluating other suppliers. Name 2-3 similar buyers and what they are doing in response to this data. Offer a weekly/monthly tracker on their official work email: "Would you like me to add you to our Monday [industry] tracker? Three lines, every Monday, no sales talk." This positions ${senderName} as a partner, not a salesperson.

TOUCH 7 — Day 40-45 · 📧 Email or 💼 LinkedIn (Partnership Invite — 130-170 words)
Open: "It's been [X weeks] since we connected — I've been sharing a few notes for your file." State clearly and warmly that ${senderName} is NOT looking for a one-time order. Reference a specific client tenure: "[Client type] has been with us for [X years] — that's the kind of relationship we build." Name a specific reason why a long-term fit makes sense for THIS prospect's company and role — use dossier details. Offer: plant/site visit, chai, virtual walkthrough — NOT a sales meeting. Bury the email list ask at the end as the smallest possible yes. "No rush at all — happy to stay connected and keep sharing [tracker name]."

TOUCH 8 — Day 50+ · 💬 WhatsApp or 📧 Email (Festival/Human Greeting — 80-100 words)
Choose the right festival: Diwali for India, Christmas/New Year for UK/Europe, Eid for MENA/West Africa, or relevant regional festival. Attach a REAL candid team photo — not a corporate poster, not a brochure. "These are the people who actually [hold the spec / check the COA / pack the documents]." One personal line referencing something from your earlier exchanges. NO product mention. NO CTA. Pure warmth. This is the touch that gets: "Thanks ${senderName}, let's catch up next week."

---

AFTER TOUCH 8 — Ongoing: Monthly tracker + next festival greeting. You never close the loop. You stay.

For EACH touch, format your output as:

TOUCH [N] — Day [X] · [Channel]
[Full copy-ready message — write it out completely, ready to send]
📎 Suggested attachment: [name it specifically, or "none"]
[Word count in brackets]

No placeholders. No [INSERT X HERE]. Write every message completely. If you need a specific detail not in the dossier, infer the most plausible version from the industry and prospect context.`,

      objection: `Analyse this prospect reply from ${p} at ${co} and draft a response FROM ${senderName}.
${dossierCtx}

Their reply:
"${reply || ""}"

1. OBJECTION CLASSIFICATION
Type: [Price / Timing / No need / Competitor / Trust / Gatekeeper / Other]
Root cause: [one sentence — what's really behind this objection]
Urgency level: [Hot / Warm / Cold] — and why

2. RECOMMENDED RESPONSE (from ${senderName})
[max 100 words — address the root cause, not the surface objection; use an insight or reframe; end with ${senderCta}. No invented statistics. Reference current year ${currentYear} if relevant, not past years.]

3. ALTERNATIVE RESPONSE (softer approach)
[max 80 words — more curious, less pushback, still from ${senderName}]

Be honest: if this is a polite no, say so and recommend a graceful break-up message instead.`,
    };

    const messages = [
      { role: "system", content: systemPrompt },
      ...(body.history || []),
      { role: "user", content: stepPrompts[step] || body.prompt || "" },
    ];

    const maxTokens = step === "followup" ? 5000 : step === "research" ? 3500 : 2500;

    sendEvent({ step, status: 'processing' });

    const epChain = getAIEndpoint(body.model || "gpt-4o");
    const r = await fetch(epChain.url, {
      method: "POST",
      headers: aiHeaders(epChain),
      body: JSON.stringify({ model: epChain.model, messages, max_tokens: maxTokens, stream: true }),
    });

    if (!r.ok) {
      const errText = await r.text();
      sendEvent({ step, status: 'error', error: `AI ${r.status}: ${errText.substring(0, 200)}` });
      res.end();
      return;
    }

    // Stream tokens to the client as they arrive
    let fullContent = '';
    const reader = r.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n').filter(l => l.startsWith('data: '));

      for (const line of lines) {
        const payload = line.slice(6).trim();
        if (payload === '[DONE]') continue;
        try {
          const parsed = JSON.parse(payload);
          const token = parsed.choices?.[0]?.delta?.content;
          if (token) {
            fullContent += token;
            sendEvent({ step, status: 'token', token });
          }
        } catch (_) {}
      }
    }

    sendEvent({ step, status: 'done', content: fullContent });
    res.end();
  } catch (e) {
    try {
      sendEvent({ step: step || 'unknown', status: 'error', error: e.message });
      res.end();
    } catch (_) {}
  }
}

async function handleQualify(req, res) {
  try {
    const body = await readBody(req);
    const { company, domain, senderOffer } = body;
    if (!company && !domain) return json(res, { error: "Company name or domain required" }, 400);

    // Step 1: Perplexity — what does this company make?
    let productInfo = "";
    if (process.env.PERPLEXITY_API_KEY) {
      try {
        const pr = await fetch("https://api.perplexity.ai/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${process.env.PERPLEXITY_API_KEY}`,
          },
          body: JSON.stringify({
            model: "sonar-pro",
            messages: [{
              role: "user",
              content: `What food or consumer products does ${company} manufacture or sell? List their specific product brands, product lines, and SKUs. What raw materials or ingredients do they likely purchase for manufacturing? Company domain: ${domain || "not provided"}.`,
            }],
            max_tokens: 600,
          }),
        });
        if (pr.ok) {
          const pData = await pr.json();
          productInfo = pData.choices?.[0]?.message?.content || "";
        }
      } catch (_) {}
    }

    // Step 2: AI fit assessment
    const ep = getAIEndpoint(body.model || "gpt-4o-mini");
    const qr = await fetch(ep.url, {
      method: "POST",
      headers: aiHeaders(ep),
      body: JSON.stringify({
        model: ep.model,
        messages: [{
          role: "user",
          content: `You are qualifying whether a company is a genuine buyer for a B2B seller's products.

SELLER'S OFFER:
${senderOffer || "food ingredients"}

COMPANY BEING EVALUATED: ${company}${domain ? ` (${domain})` : ""}

PRODUCT RESEARCH:
${productInfo || "(no research found — assess from company name only)"}

QUALIFICATION TASK:
Determine if ${company} is a genuine buyer for the seller's specific products. Be accurate — a company using a related but different ingredient is NOT a fit.

Key distinction: if the seller offers DRY-MILLED corn products (corn grits, fine corn flour, corn meal), the right buyers are companies making extruded snacks, puffed snacks, corn chips, corn flakes, brewing products, or batter/coating applications where corn FLOUR or GRITS are used. Companies that primarily use CORN STARCH (a wet-milled product used as a thickener/binder in nuggets, sauces, biscuits) are NOT a fit for dry-milled corn products.

Respond ONLY in this JSON format:
{
  "fit": "high" or "medium" or "low" or "none",
  "score": 1 to 5,
  "reasoning": "2-3 sentences — what they make and why they do or don't need the seller's specific product",
  "products_found": ["specific", "product", "names", "found"],
  "flag": "key mismatch or concern to surface (e.g. 'Uses corn STARCH not corn grits — wet mill product'), or null",
  "recommendation": "one sentence — proceed, approach carefully, or skip and explain why"
}`,
        }],
        max_tokens: 500,
        ...(ep.url.includes("openai") ? { response_format: { type: "json_object" } } : {}),
      }),
    });

    if (!qr.ok) {
      const errText = await qr.text();
      return json(res, { fit: "unknown", error: `AI error: ${errText.substring(0, 100)}` }, 500);
    }

    const qData = await qr.json();
    const raw = qData.choices?.[0]?.message?.content || "{}";
    const result = parseAIJson(raw);
    json(res, { ...result, company, productSummary: productInfo.substring(0, 500) });

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

    if (!r.ok) {
      const errText = await r.text();
      console.warn(`Perplexity ${r.status}:`, errText.substring(0, 200));
      // Graceful degradation — return empty result with confidence flag
      return json(res, {
        confidence: 'none',
        choices: [{ message: { content: '' } }],
        _degraded: true,
        _reason: `Perplexity returned ${r.status}`,
      });
    }

    const data = await r.json();
    json(res, { ...data, confidence: 'high' });
  } catch (e) {
    console.error('Perplexity search failed:', e.message);
    json(res, {
      confidence: 'none',
      choices: [{ message: { content: '' } }],
      _degraded: true,
      _reason: e.message,
    });
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

    if (r.status === 429) {
      console.warn('Apollo rate limit hit — returning degraded result');
      return json(res, {
        confidence: 'none',
        _degraded: true,
        _reason: 'Apollo rate limit (429) — enrichment unavailable',
        person: null,
        organization: null,
      });
    }

    if (!r.ok) {
      const errText = await r.text();
      console.warn(`Apollo ${r.status}:`, errText.substring(0, 200));
      return json(res, {
        confidence: 'none',
        _degraded: true,
        _reason: `Apollo returned ${r.status}`,
        person: null,
        organization: null,
      });
    }

    const data = await r.json();
    json(res, { ...data, confidence: 'high' });
  } catch (e) {
    console.error('Apollo match failed:', e.message);
    json(res, {
      confidence: 'none',
      _degraded: true,
      _reason: e.message,
      person: null,
      organization: null,
    });
  }
}

async function handleProfileAuthority(req, res) {
  try {
    const body = await readBody(req);
    const { senderProfile } = body;
    const s = senderProfile || {};

    const userPrompt = `Write a B2B cold email authority intro paragraph for ${s.name || "the sender"}.

This is LINE 2 of a cold email — appears right after a specific icebreaker about the prospect's product or news. It introduces the sender to a complete stranger and earns the right to keep reading.

Rules:
- One paragraph, 3–5 sentences. No bullet points. No intro line like "Here's your paragraph."
- Include: full name, role and company, exact product names (never generic), scale (years in operation, plant count, capacity if provided), named clients, certifications
- End with one sentence connecting the offer to the prospect's buying context
- Use ONLY the details below — do not invent clients, certifications, plant names, or product categories

SENDER DETAILS:
Name: ${s.name || ""}
Role: ${s.role || ""}
What they offer: ${s.offer || ""}
Why it matters to their ICP: ${s.valueProp || ""}
Social proof: ${s.proof || ""}`;

    const epAuth = getAIEndpoint(body.model || "gpt-4o");
    const r = await fetch(epAuth.url, {
      method: "POST",
      headers: aiHeaders(epAuth),
      body: JSON.stringify({ model: epAuth.model, messages: [{ role: "user", content: userPrompt }], temperature: 0.4, max_tokens: 350 }),
    });
    if (!r.ok) return json(res, { error: `AI returned ${r.status}` }, r.status);
    const data = await r.json();
    const block = data.choices?.[0]?.message?.content?.trim() || "";
    json(res, { authorityBlock: block });
  } catch (e) {
    console.error("Authority block generation failed:", e.message);
    json(res, { error: e.message }, 500);
  }
}

async function handleApolloSearch(req, res) {
  try {
    if (!process.env.APOLLO_API_KEY) return json(res, { error: "Apollo API key not configured" }, 400);
    const body = await readBody(req);
    const { titles = [], locations = [], sizeRanges = [], keywords = "", page = 1, perPage = 25 } = body;

    const payload = { page, per_page: Math.min(perPage, 50) };
    if (titles.length)     payload.person_titles = titles;
    if (locations.length)  payload.person_locations = locations;
    if (sizeRanges.length) payload.organization_num_employees_ranges = sizeRanges;
    if (keywords.trim())   payload.q_keywords = keywords.trim();

    const r = await fetch("https://api.apollo.io/v1/mixed_people/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": process.env.APOLLO_API_KEY },
      body: JSON.stringify(payload),
    });

    if (r.status === 429) return json(res, { error: "Apollo rate limit — wait a moment and try again" }, 429);
    if (!r.ok) {
      const errText = await r.text();
      console.warn(`Apollo search ${r.status}:`, errText.substring(0, 200));
      return json(res, { error: `Apollo returned ${r.status}` }, r.status);
    }

    const data = await r.json();
    json(res, { people: data.people || [], pagination: data.pagination || {} });
  } catch (e) {
    console.error("Apollo search failed:", e.message);
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

async function handleProfileExtract(req, res) {
  try {
    const body = await readBody(req);
    const { url: targetUrl, fileContent, fileName } = body;

    const sources = [];

    // Collect file content
    if (fileContent) {
      sources.push(`--- FILE: ${fileName || "uploaded document"} ---\n${fileContent.substring(0, 14000)}`);
    }

    // Collect URL content (always fetch if provided, even if file is also present)
    if (targetUrl) {
      try {
        const normalizedUrl = normalizeExtractUrl(targetUrl);
        const r = await fetch(normalizedUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; ApexOutboundOS/1.0)",
            "Accept": "text/html,application/xhtml+xml,application/pdf,text/plain,*/*",
          },
          redirect: "follow",
        });
        const contentType = r.headers.get("content-type") || "";
        let urlText = "";
        if (contentType.includes("application/pdf")) {
          const buffer = Buffer.from(await r.arrayBuffer());
          const pdfData = await pdfParse(buffer);
          urlText = pdfData.text.substring(0, 8000);
        } else {
          const raw = await r.text();
          if (raw.startsWith("%PDF")) {
            const buffer = Buffer.from(raw, "binary");
            const pdfData = await pdfParse(buffer);
            urlText = pdfData.text.substring(0, 8000);
          } else {
            urlText = raw
              .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
              .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
              .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
              .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
              .replace(/<[^>]+>/g, " ")
              .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
              .replace(/\s+/g, " ")
              .trim()
              .substring(0, 8000);
          }
        }
        if (urlText) sources.push(`--- URL: ${targetUrl} ---\n${urlText}`);
      } catch (_) {} // don't fail if URL fetch errors — file content is still usable
    }

    if (!sources.length) return json(res, { error: "No content found. Try a different URL or file." }, 400);

    const sourceText = sources.join("\n\n");

    const epExtract = getAIEndpoint(body.model || "gpt-4o");
    const r = await fetch(epExtract.url, {
      method: "POST",
      headers: aiHeaders(epExtract),
      body: JSON.stringify({
        model: epExtract.model,
        messages: [
          {
            role: "system",
            content: `You are building a B2B outreach intelligence profile. This profile will be fed directly into an AI agent that writes cold emails and LinkedIn messages on behalf of the sender. Every field you write will be used verbatim in real outreach.

Your job is NOT extraction — it is SYNTHESIS. Read the source material deeply, understand the business, and write each field in the exact form the email agent needs it. The agent cannot paraphrase or improve what you write. If you write vague copy, the emails will be vague.

QUALITY STANDARD for every field:
- Use EXACT product names, client names, certifications, numbers, and plant/location details from the source
- Write as if a senior sales consultant who deeply understands this business is briefing a copywriter
- Never use: "premium", "industry-leading", "world-class", "innovative", "seamless", "leverage", "synergy", "value-added", "cutting-edge", "state-of-the-art"
- If you cannot fill a field specifically from the source, return ""  — do not fabricate

FIELDS — return as a JSON object with these exact keys:

name
  The sender's full personal name (not company name). If not in the source, return "".

role
  Exact job title + company. e.g. "VP Growth, TBI Corn Limited"

offer
  What they sell — written for a cold email opening line. Name the actual products/grades/specs, not categories.
  BAD: "We offer quality corn products"
  GOOD: "TBI Corn supplies corn flour, corn grits, fine broken corn, and maize starch — milled to food-grade spec at our FSSAI-approved plant"

valueProp
  The specific operational outcome the buyer gets. Written from the buyer's perspective.
  BAD: "customers receive consistent products that help them succeed"
  GOOD: "Snack manufacturers get consistent particle size and moisture across batches — the kind of spec consistency that keeps extruder yields stable and avoids line stoppages"

proof
  The single strongest credibility statement — exact client names, years in business, certifications, BSE listing, capacity numbers, named awards. One dense sentence.
  e.g. "BSE-listed since 2008; supplying ITC Limited, DFM Foods, and Haldiram's for over 23 years; ISO 22000 and FSSAI certified"

cta
  Their preferred first step — specific and easy. e.g. "Share your current corn spec and we'll send a matched free sample within 7 days"

tone
  Infer from the writing style in the source. e.g. "Warm, credible, peer-to-peer — expert without being formal"

authorityBlock
  A 2-sentence cold email intro the sender would use as LINE 2 of an outreach email. Must include: sender name, company, years operating, named clients or listed status, one key credential. Must be immediately usable.
  e.g. "I'm Shantanu Phansalkar from TBI Corn Limited — we've been milling corn for 23 years and currently supply ITC Limited and DFM Foods. We're BSE-listed, FSSAI certified, and run a food-grade dry milling plant in Maharashtra."

offerMechanism
  How they deliver — the actual process, plant, technology, or method. Specific.
  e.g. "Dry milling plant in Akola, Maharashtra — 150 MT/day capacity, advanced sieving for uniform particle size, ISO 22000 certified line"

outcomeTimeframe
  A specific promise with a timeframe, if the source supports one.
  e.g. "Matched sample against your COA delivered within 7 working days" or "" if not inferable

lowRiskOffer
  Their easiest yes — samples, trials, plant visits, free audits. One sentence.
  e.g. "Free sample matched to your current corn spec — no commitment, no minimum order to start"

differentiation
  What makes them different. Write three short angles: vs doing nothing, vs current supplier, vs competing mills. Be specific to this company.

proofCards
  Up to 5 proof cards. One per line. Format exactly:
  [Buyer type] | [Sector] | [Outcome] | [Specific credential or named detail]
  Only use real information from the source. Leave empty if nothing specific is available.

authorityOpinion
  One strong, slightly contrarian opinion this company holds about their industry — infer from their messaging tone and positioning. e.g. "Most snack manufacturers treat corn ingredient spec as a commodity decision — it isn't. Batch-to-batch consistency at the mill level is what decides whether your extruder runs at 94% or 87% yield."`,
          },
          {
            role: "user",
            content: `Build the outreach profile from this source material:\n\n${sourceText}`,
          },
        ],
        ...(epExtract.url.includes("openai") ? { response_format: { type: "json_object" } } : {}),
        max_tokens: 4096,
      }),
    });
    const data = await r.json();
    const profile = parseAIJson(data.choices?.[0]?.message?.content);
    json(res, { profile });
  } catch (e) {
    json(res, { error: e.message }, 500);
  }
}

// ─── Config ───────────────────────────────────────────────────────────────────
async function handleConfig(req, res) {
  json(res, {
    supabaseUrl: process.env.SUPABASE_URL || "",
    supabaseKey: process.env.SUPABASE_KEY || "",
  });
}

// ─── Health ───────────────────────────────────────────────────────────────────
async function handleHealth(req, res) {
  const start = Date.now();
  try {
    // Lightweight smoke test — one token confirms the AI key and network are live
    const epHealth = getAIEndpoint("gpt-4o-mini");
    const r = await fetch(epHealth.url, {
      method: "POST",
      headers: aiHeaders(epHealth),
      body: JSON.stringify({ model: epHealth.model, messages: [{ role: "user", content: "ping" }], max_tokens: 1 }),
    });
    const ok = r.ok;
    json(res, {
      status: ok ? "ok" : "degraded",
      latency_ms: Date.now() - start,
      openai: ok ? "connected" : `error ${r.status}`,
      apollo: process.env.APOLLO_API_KEY ? "key_set" : "missing",
      perplexity: process.env.PERPLEXITY_API_KEY ? "key_set" : "missing",
      supabase: process.env.SUPABASE_URL ? "key_set" : "missing",
    }, ok ? 200 : 503);
  } catch (e) {
    json(res, { status: "error", error: e.message, latency_ms: Date.now() - start }, 503);
  }
}

// ─── Webhook: Email Events ────────────────────────────────────────────────────
// Normalise bounce / unsubscribe / spam events from SendGrid, Mailgun, Postmark.
// Requires SUPABASE_URL + SUPABASE_SERVICE_KEY env vars (service role key).
function normalizeEmailEvents(body) {
  const events = [];
  // SendGrid: array of event objects
  if (Array.isArray(body)) {
    for (const ev of body) {
      const type = { bounce: "bounce", unsubscribe: "unsubscribe",
                     spamreport: "spam", deferred: null, delivered: null }[ev.event];
      if (type && ev.email) events.push({ email: ev.email.toLowerCase(), type });
    }
    return events;
  }
  // Mailgun: single object with event field
  if (body.event && body.recipient) {
    const type = { bounced: "bounce", unsubscribed: "unsubscribe",
                   complained: "spam" }[body.event];
    if (type) events.push({ email: body.recipient.toLowerCase(), type });
    return events;
  }
  // Postmark: single object with RecordType
  if (body.RecordType && body.Email) {
    const type = { Bounce: "bounce", SpamComplaint: "spam",
                   SubscriptionChange: "unsubscribe" }[body.RecordType];
    if (type) events.push({ email: body.Email.toLowerCase(), type });
    return events;
  }
  return events;
}

async function sbServiceFetch(path, opts = {}) {
  const base = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const key  = process.env.SUPABASE_SERVICE_KEY;
  if (!base || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_KEY not set");
  const res = await fetch(`${base}/rest/v1${path}`, {
    ...opts,
    headers: {
      "apikey": key,
      "Authorization": `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

async function handleWebhookEmailEvent(req, res) {
  try {
    const body   = await readBody(req);
    const events = normalizeEmailEvents(body);
    if (!events.length) return json(res, { processed: 0, skipped: "no actionable events" });

    let processed = 0;
    for (const ev of events) {
      // Find prospect(s) by email
      const prospects = await sbServiceFetch(
        `/prospects?email=eq.${encodeURIComponent(ev.email)}&select=id,user_id`
      );
      if (!prospects?.length) continue;

      for (const p of prospects) {
        // Upsert into suppression_list (ignore duplicate)
        await sbServiceFetch("/suppression_list", {
          method: "POST",
          headers: { "Prefer": "resolution=ignore-duplicates,return=minimal" },
          body: JSON.stringify({
            user_id: p.user_id,
            email: ev.email,
            reason: ev.type,
            prospect_id: p.id,
          }),
        });

        // Update prospect: pause sequence, mark cold
        await sbServiceFetch(`/prospects?id=eq.${p.id}`, {
          method: "PATCH",
          headers: { "Prefer": "return=minimal" },
          body: JSON.stringify({
            status: "cold",
            active_email_idx: 0,
            updated_at: new Date().toISOString(),
          }),
        });
        processed++;
      }
    }
    return json(res, { processed });
  } catch (e) {
    console.error("Webhook error:", e.message);
    json(res, { error: e.message }, 500);
  }
}

// ─── Router ───────────────────────────────────────────────────────────────────
const POST_ROUTES = {
  "/api/qualify": handleQualify,
  "/api/icp/fill": handleIcpFill,
  "/api/chain/run": handleChainRun,
  "/api/profile/authority": handleProfileAuthority,
  "/api/apollo/match": handleApolloMatch,
  "/api/apollo/search": handleApolloSearch,
  "/api/perplexity/search": handlePerplexitySearch,
  "/api/leads/generate": handleLeadsGenerate,
  "/api/profile/extract": handleProfileExtract,
  "/api/webhook/email-event": handleWebhookEmailEvent,
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
  if (req.method === "GET" && pathname === "/api/config") return handleConfig(req, res);
  if (req.method === "GET" && pathname === "/api/health") return handleHealth(req, res);

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
  console.log(`  Apify:      ${k(process.env.APIFY_API_KEY)}`);
  console.log(`  Supabase:   ${k(process.env.SUPABASE_URL)}\n`);
});

// ─── Graceful shutdown ────────────────────────────────────────────────────────
// Render sends SIGTERM before killing the old instance on every deploy.
// This gives in-flight SSE streams up to 25s to complete before the process exits.
process.on("SIGTERM", () => {
  console.log("SIGTERM received — draining in-flight requests (max 25s)...");
  server.close(() => {
    console.log("All connections closed. Exiting cleanly.");
    process.exit(0);
  });
  setTimeout(() => {
    console.error("Drain timeout exceeded — forcing exit.");
    process.exit(1);
  }, 25000);
});
