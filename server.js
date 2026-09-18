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
    const { prospect, icp, senderProfile, step, dossier, signalContext, linkedinPosts, sequenceState, reply } = body;

    const sender = senderProfile || {};
    const senderName    = sender.name    || "the sender";
    const senderRole    = sender.role    || "";
    const senderOffer   = sender.offer   || "";
    const senderValueProp = sender.valueProp || "";
    const senderProof   = sender.proof   || "";
    const senderCta     = sender.cta     || "a 15-minute conversation";
    const senderTone    = sender.tone    || "peer-to-peer";
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

      linkedin: `Write a LinkedIn CONNECTION REQUEST and a FOLLOW-UP DM for ${p} at ${co}, from ${senderName}.${dossierCtx}
${linkedinPosts ? `\nTheir recent LinkedIn posts:\n${linkedinPosts}\n` : ""}

Emotional context for ${p}:
- They feel: ${icpFeel}
- They privately think: ${icpThinkPriv}
- Their desires: ${icpDesires}
- Their frustrations: ${icpFrustrations}

## CONNECTION REQUEST (under 280 characters):
- Reference ONE specific, real thing about their work, a company signal, or something genuinely interesting about their role
- Sound like a peer who noticed something interesting — not a vendor who wants to sell
- No pitch. No "I'd love to connect." No "love your work."
- Write as if only ${p} could receive this message

## FOLLOW-UP DM — send 3-4 days after connecting (under 400 characters):
- Open with something warm and specific — a genuine observation about their world, not a pitch opener
- Tap into a desire or aspiration from their NDFFO (what they privately want but rarely say): ${icpDesires}
- Ask ONE thoughtful question that shows you understand their world — or share one real insight that earns trust
- Introduce ${senderName} and what ${senderName} does in one natural line — only if it fits organically
- End with the softest possible CTA: ${senderCta}
- Tone: ${senderTone} — warm, human, no pressure

Label each clearly: CONNECTION REQUEST and FOLLOW-UP DM.`,

      sequence: `Using the intelligence dossier for ${p} at ${co}, write a 3-touch outreach sequence FROM ${senderName}.${dossierCtx}

TOUCH 1 — Day 1 · Email
Subject: [under 8 words — specific to this prospect]
Body: [max 80 words — open with sharpest ice breaker, introduce ${senderName} naturally, speak to their #1 fear or frustration, soft CTA]

TOUCH 2 — Day 4 · LinkedIn DM
[under 300 chars — new angle, draw from a desire or aspiration: ${icpDesires}]

TOUCH 3 — Day 8 · Email (Break-up)
[max 60 words — acknowledge no response, add one new insight or reference a real signal, final CTA with even lower bar]

Each touch: different angle, different emotional register. No invented statistics.`,

      outreach: `Write 3 cold email variants FROM ${senderName} to ${p} at ${co}. Each has a distinct angle and emotional register.${dossierCtx}

THE SENDER:
- ${senderName}, ${senderRole}
- Offer: ${senderOffer}
- Value: ${senderValueProp}
${senderProof ? `- Social proof (use only if relevant): ${senderProof}` : ""}

ICP emotional profile to draw from:
- Pains: ${icpPains}
- Fears: ${icpFears}
- Frustrations: ${icpFrustrations}
- Dream outcomes: ${icpDesires}
- They say out loud: ${icpSayLoud}

VARIANT A — Pain-led
Subject: [under 8 words — pain or problem framing, specific to ${p}'s world]
Body:
- Line 1: Open with a specific pain or frustration from the dossier — make ${p} feel understood
- Line 2: Introduce ${senderName} naturally — one sentence on who they are and what they do (not salesy)
- Line 3: Bridge: why this pain is exactly what ${senderName} works on
- CTA: ${senderCta}
Max 90 words. No invented statistics.

VARIANT B — Trigger-led
Subject: [under 8 words — reference the specific signal or event from the dossier]
Body:
- Line 1: Open with the specific company or market signal (cite something real from the dossier)
- Line 2: ${senderName} from [company] — natural, one-line intro
- Line 3: Connect signal → relevant outcome ${senderName} helps with
- CTA: ${senderCta}
Max 90 words. No invented statistics.

VARIANT C — Curiosity-led
Subject: [under 8 words — provocative question tied to their desires or fears]
Body:
- Line 1: A sharp question or insight that connects to ${p}'s desires (${icpDesires}) — makes them stop and think
- Line 2: Brief intro on who ${senderName} is
- Line 3: Connect insight to ${senderOffer}
- CTA: ${senderCta}
Max 90 words. No invented statistics.

RULES FOR ALL VARIANTS:
- No "I hope this finds you well" · No "we help companies like yours" · No made-up percentages or data
- Tone: ${senderTone}
- Introduce ${senderName} naturally in every email — never be abrupt
- Subject lines: specific, not clickbait
Label each variant clearly: VARIANT A, VARIANT B, VARIANT C.`,

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

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({ model: "gpt-4o", messages, max_tokens: step === "followup" ? 5000 : step === "research" ? 3500 : 2500 }),
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

async function handleProfileExtract(req, res) {
  try {
    const body = await readBody(req);
    const { url: targetUrl, fileContent, fileName } = body;

    let sourceText = "";

    if (fileContent) {
      sourceText = fileContent.substring(0, 12000);
    } else if (targetUrl) {
      const r = await fetch(targetUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; ApexOutboundOS/1.0)",
          "Accept": "text/html,application/xhtml+xml,text/plain,*/*",
        },
        redirect: "follow",
      });
      const raw = await r.text();
      sourceText = raw
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
        .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
        .replace(/\s+/g, " ")
        .trim()
        .substring(0, 10000);
    }

    if (!sourceText) return json(res, { error: "No content found at that URL." }, 400);

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: `You are extracting a sender profile from a company website, LinkedIn profile, or sales document. Extract exactly these fields as a JSON object. If a field isn't clearly stated, infer the most accurate version from the content. Never fabricate — if something truly can't be inferred, leave it as an empty string.

Fields:
- name: The sender's personal name (if a personal profile) OR company name (if a company page)
- role: Their job title and company, e.g. "Founder, Apex Growth Partners"
- offer: What they offer — one concise sentence describing their product or service
- valueProp: The specific outcome their buyers get — why it matters to the customer
- proof: A specific proof point — client name, years in business, result, award, or credential
- cta: What they want the prospect to do next — their preferred call to action
- tone: How they communicate — infer from the writing style (e.g. "Warm and consultative", "Direct and data-driven", "Peer-to-peer, no jargon")

Return only valid JSON with these exact field names.`,
          },
          { role: "user", content: `Extract the sender profile from this content${fileName ? ` (file: ${fileName})` : ""}:\n\n${sourceText}` },
        ],
        response_format: { type: "json_object" },
        max_tokens: 800,
      }),
    });
    const data = await r.json();
    const profile = JSON.parse(data.choices?.[0]?.message?.content || "{}");
    json(res, { profile });
  } catch (e) {
    json(res, { error: e.message }, 500);
  }
}

// ─── Router ───────────────────────────────────────────────────────────────────
const POST_ROUTES = {
  "/api/icp/fill": handleIcpFill,
  "/api/chain/run": handleChainRun,
  "/api/apollo/match": handleApolloMatch,
  "/api/perplexity/search": handlePerplexitySearch,
  "/api/leads/generate": handleLeadsGenerate,
  "/api/profile/extract": handleProfileExtract,
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
