# Apex Outbound OS — Project Documentation

## What This Is

An AI-powered outbound sales stack for Apex Growth Partners. Replaces manual SDR work from prospect research to cold email, LinkedIn outreach, follow-up sequences, and objection handling. Built as a Node.js webapp with no framework dependencies.

**Live URL:** https://apex-outbound-os-production.up.railway.app  
**Custom Domain:** https://app.apexrevenuepartners.in (DNS propagating)  
**GitHub:** https://github.com/shantanuap94/apex-outbound-os  
**Local:** http://localhost:4173

---

## Tech Stack

- **Backend:** Node.js HTTP server (no framework — pure `http` module)
- **Frontend:** Vanilla HTML/CSS/JS (no React, no build step)
- **AI Agents:** OpenAI Responses API (`gpt-5.5` for all 5 agents, `gpt-4.1-mini` for ICP fill)
- **Prospect Enrichment:** Apollo.io REST API (person match + org enrich)
- **Web Research:** Perplexity API (`sonar-pro` model for live signal research)
- **Hosting:** Railway (auto-deploys from GitHub main branch)
- **Prospecting:** Vibe Prospecting MCP (runs inside Claude chat session only)

---

## File Structure

```
shantanu project/
├── server.js          # Full backend — API routes, agent prompts, enrichment
├── public/
│   ├── index.html     # Single-page app — all 4 views
│   ├── app.js         # All frontend logic, state, rendering
│   └── styles.css     # All styles
├── .env               # API keys (never committed)
├── .gitignore         # Excludes .env and tmp/
├── package.json       # npm start → node server.js
├── README.md
└── PROJECT.md         # This file
```

---

## Environment Variables (.env)

```
OPENAI_API_KEY=sk-proj-...          # Powers all 5 agents
APOLLO_API_KEY=...                  # Prospect enrichment (email, LinkedIn, company data)
PERPLEXITY_API_KEY=pplx-...        # Live web research (sonar-pro)
OPENAI_AGENT_MODEL=gpt-5.5         # Optional override (default: gpt-5.5)
OPENAI_MODEL=gpt-4.1-mini          # Optional override for ICP fill (default: gpt-4.1-mini)
PORT=4173                           # Optional override (Railway sets this automatically)
```

In Railway: add all keys under **Service → Variables** tab. Railway injects them as environment variables at runtime. Do NOT use Shared Variables — paste actual key values directly.

---

## API Endpoints

### GET /api/status
Returns which services are connected.
```json
{ "apollo": true, "openai": true, "perplexity": true, "agentModel": "gpt-5.5", "pid": 123 }
```

### POST /api/prospect/enrich
Apollo enrichment — person match + org enrich.
```json
// Request
{ "firstName": "Rajesh", "lastName": "Mehta", "company": "Mehta Industries", "domain": "mehtaindustries.com", "linkedinUrl": "..." }
// Response
{ "source": "apollo", "person": {...}, "company": {...}, "enrichedAt": "..." }
```

### POST /api/prospect/research
Perplexity web research — live signals about person and company.
```json
// Request
{ "firstName": "Rajesh", "lastName": "Mehta", "company": "Mehta Industries", "domain": "mehtaindustries.com" }
// Response
{ "source": "perplexity", "person": {...}, "company": {...}, "signals": [...], "painIndicators": [...], "growthSignals": [...], "suggestedContext": "..." }
```

### POST /api/agent/1-research
Builds a scored prospect dossier.
```json
// Request
{ "prospect": {...}, "enrichment": {...}, "signals": "signal context text", "icp": {...} }
// Response
{ "source": "openai", "dossier": { "score": 75, "snapshot": {...}, "triggers": [...], "pains": [...], "hooks": [...], "score_reasoning": "..." } }
```

### POST /api/agent/2-cold-email
Generates 3 cold email variants (pain-led, trigger-led, curiosity-led).
```json
// Request
{ "dossier": {...}, "prospect": {...} }
// Response — array of 3
[{ "type": "pain-led", "subject": "...", "body": "...", "cta": "...", "word_count": 72 }]
```

### POST /api/agent/3-linkedin
Generates LinkedIn connection note + Day 3 DM + Day 7 DM.
```json
// Request
{ "dossier": {...}, "prospect": {...}, "linkedinPosts": "..." }
// Response
{ "connectionNote": "...", "day3Dm": "...", "day7Dm": "..." }
```

### POST /api/agent/4-sequence
Builds a 6-touch follow-up sequence over 14–21 days.
```json
// Request
{ "dossier": {...}, "prospect": {...}, "state": "no_reply|positive|negative" }
// Response
{ "sequence": [{ "touch": 1, "day": 1, "channel": "email", "angle": "...", "subject": "...", "body": "...", "branching": "..." }] }
```

### POST /api/agent/5-objection
Classifies a reply and generates a response.
```json
// Request
{ "reply": "Not interested right now", "dossier": {...}, "prospect": {...} }
// Response
{ "classification": "timing", "action": "nurture", "response": "..." }
```

### POST /api/ai/icp-section
AI-fills one section of the ICP definition module.
```json
// Request
{ "section": "pains", "icp": {...} }
// Response
{ "source": "openai", "section": "pains", "suggestion": "..." }
```

---

## The 5-Agent Chain

| # | Agent | Input | Output |
|---|-------|-------|--------|
| 1 | Research & Scoring | Prospect + Enrichment + Signals + ICP | Scored dossier (0–100), triggers, pains, hooks |
| 2 | Cold Email | Dossier + Prospect | 3 email variants — pain-led, trigger-led, curiosity-led |
| 3 | LinkedIn | Dossier + Prospect | Connection note (280 chars) + Day 3 DM + Day 7 DM |
| 4 | Follow-up Sequence | Dossier + State | 6-touch sequence, 14–21 days, alternating channels |
| 5 | Objection Handler | Reply + Dossier | Classification + response draft |

**Score gate:** Agents 2 + 3 only unlock when Agent 1 score ≥ 60.  
**Parallel execution:** Agents 2 + 3 run in parallel via `Promise.allSettled`.  
**Fallbacks:** Every agent has a local fallback that fires when OpenAI key is not set.

---

## Agent 1 Scoring Rubric

| Signal | Weight |
|--------|--------|
| Geographic expansion / new office | +25 |
| Hiring surge (5+ roles in 90 days) | +20 |
| Founder posted about growth/sales challenge | +20 |
| Listed company / PE-backed | +15 |
| Client logo from target ICP sector | +15 |
| Industry award / press mention | +10 |
| Recent funding round | +10 |
| Tech stack signals (CRM, sales tools) | +5 |

**Rejection rules (auto-score 0):** company < ₹15cr revenue, B2C, company > 500 employees, prospect not decision-maker.

---

## Frontend Architecture

### Views (tabs in nav)
1. **ICP Definition** — Define and AI-fill the Ideal Customer Profile
2. **Signal Strategy** — Reference table of signals, weights, sources, score bands
3. **Agent Chain** — Main workflow: prospect input → enrichment → agents → output
4. **Campaigns** — Placeholder for future campaign tracking

### State Management
- `localStorage` key `apex.chain` — full chain state (prospect, enrichment, dossier, emails, LinkedIn, sequence)
- `localStorage` key `apex.icp` — ICP definition fields
- `restoreChain()` — restores all state on page load
- `saveChain(patch)` — merges patch into existing chain state

### Step Unlock Flow
```
Prospect input → Enrich (Apollo or Perplexity)
  → unlocks: Enrichment Snapshot + Signal Context
  → Run Agent 1
  → unlocks: Dossier (if score ≥ 60: Generate Outreach button enabled)
  → Generate Outreach (runs Agent 2 + 3 in parallel)
  → unlocks: Cold Email tabs + LinkedIn Sequence
Steps 7 (Follow-up) and 8 (Objection) always unlocked — can run independently
```

### Key Functions in app.js
- `renderEnrichment(enrichment)` — renders enrichment grid + VP fallback banner
- `renderDossier(dossier)` — score badge, QA strip, dossier cards
- `renderEmails(emails)` — 3-tab variant picker with copy buttons
- `renderLinkedIn(messages)` — 3 cards with character counters
- `renderSequence(sequence)` — touch cards with channel badges
- `renderObjection(result)` — classification badge + response draft
- `copyText(text)` — clipboard copy with toast
- `checkApiStatus()` — updates sidebar dots (Apollo, OpenAI, Perplexity)

---

## Prospect Enrichment Flow

### Apollo (structured contact data)
1. `POST /v1/people/match` — matches person by name + company + domain + LinkedIn
2. `GET /v1/organizations/enrich?domain=...` — enriches company by domain
3. Returns: email, email status, LinkedIn URL, phone, location, employment history, headcount, tech stack, funding

### Perplexity (live web research)
1. Calls `sonar-pro` model with a structured research prompt
2. Returns: person background, recent activity, company news, growth signals, pain indicators, suggested signal context
3. Auto-fills the Signal Context textarea for Agent 1

### Vibe Prospecting (fallback for missing email/LinkedIn)
- Runs inside Claude chat session only (MCP tool — not callable from server.js)
- Banner appears in UI when Apollo returns no email or LinkedIn
- "Search Vibe Prospecting →" button reveals a pre-built query
- User copies query → pastes in Claude chat → Claude runs VP search → user fills results into form

---

## Apex Growth Partners Context (hardcoded in server.js)

```javascript
const apex = {
  company: "Apex Growth Partners",
  value_prop: "We build AI-enabled outbound sales systems for B2B founders in India",
  proof_point: "Grew a listed client from ₹200cr to ₹300cr revenue in 9 months",
  pricing: "Small fixed setup fee + performance-based (we win when you win)",
  icp: "Founders/MDs of ₹30–80cr B2B companies in manufacturing, real estate, CA, architecture",
  tone: "Founder-to-founder. Sharp, direct, no jargon. Empathetic to the burden of carrying growth alone."
}
```

---

## Deployment (Railway)

1. Code pushed to GitHub `main` branch → Railway auto-deploys
2. Railway reads `package.json` → runs `npm start` → runs `node server.js`
3. Port is injected via `process.env.PORT` (server falls back to 4173)
4. Variables tab in Railway = equivalent of `.env` for production

**To update production:** just push to GitHub. Railway deploys in ~90 seconds.

**Railway variables needed:**
- `OPENAI_API_KEY`
- `PERPLEXITY_API_KEY`
- (Apollo is optional — app works without it)

---

## Known Issues / TODOs

- **Railway Perplexity key**: The `PERPLEXITY_API_KEY` in Railway shows connected in startup logs but the `/api/status` endpoint returns false. Suspected Railway variable scope issue. Workaround: use local server for now.
- **Campaigns tab**: Placeholder only — not built yet. Intended for tracking prospect pipeline across multiple prospects.
- **Apollo key**: Working locally. Add to Railway Variables when ready.
- **gpt-5.5 model**: Verify exact model ID on OpenAI platform if calls fail — override via `OPENAI_AGENT_MODEL` Railway variable.

---

## How to Run Locally

```bash
# 1. Navigate to project folder
cd "C:\Users\shant\OneDrive\Documents\shantanu project"

# 2. Fill in your API keys in .env (already done)

# 3. Start the server
node server.js

# 4. Open browser
# http://localhost:4173
```

Or via Claude Code — the preview tool manages the server automatically.
