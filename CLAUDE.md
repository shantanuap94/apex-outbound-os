# Apex Outbound OS — Project Context

## What this is
AI-powered outbound sales webapp for Apex Growth Partners. Helps Shantanu generate, score, and work ICP-matched leads through an Agent Chain to produce personalized outreach.

## Running locally
```
cd "C:\Users\shant\OneDrive\Documents\shantanu project"
npm install        # first time only
node server.js
# → open http://localhost:4173
```

## Live / deployment
- Railway: https://apex-outbound-os-production.up.railway.app (deploy via Railway dashboard or GitHub auto-deploy)
- Custom domain: https://app.apexrevenuepartners.in

## SECURITY CONSTRAINT
API keys must NEVER be printed, logged, echoed, committed, or included in any output.
- Keys live in local `.env` only (gitignored)
- Railway: add keys in Variables tab (Service Variables, not Shared)

## File structure
```
shantanu project/
├── server.js          ← Node HTTP server, port 4173
├── package.json
├── .env               ← gitignored, keys here
├── CLAUDE.md          ← this file
└── public/
    ├── index.html     ← 4-tab UI
    ├── app.js         ← client-side logic
    └── styles.css     ← dark theme
```

## Environment variables
- `OPENAI_API_KEY` — gpt-4o (agent chain) + gpt-4.1-mini (ICP fill)
- `APOLLO_API_KEY` — enrichment API
- `PERPLEXITY_API_KEY` — sonar-pro for research
- `APIFY_API_KEY` — Apollo scraper actor

## API endpoints
| Method | Path | Purpose |
|--------|------|---------|
| GET | /api/status | Check which API keys are set |
| POST | /api/icp/fill | AI-fill ICP form (gpt-4.1-mini) |
| POST | /api/chain/run | Agent Chain step (gpt-4o) |
| POST | /api/apollo/match | Apollo people match |
| POST | /api/perplexity/search | Perplexity sonar-pro |
| POST | /api/leads/generate | Start Apify actor run |
| GET | /api/leads/run/:runId | Poll run status |
| GET | /api/leads/results/:datasetId | Fetch scored leads |

## 4 Tabs
1. **ICP Builder** — fill/save your Ideal Customer Profile (AI-fill with OpenAI)
2. **Agent Chain** — enter a prospect, run Research/Hooks/Email/LinkedIn/Sequence steps
3. **Status** — live API connection status + env var instructions
4. **Lead Pipeline** — scrape Apollo via Apify, score leads, load into chain

## ICP definition (Apex target market)
- Geography: India
- Company size: ₹30–80 crore revenue (proxy: 21–500 employees)
- Industries: Manufacturing, Real Estate, Architecture, CA / Accounting firms
- Titles: Founder, MD, Managing Director, CEO

## Quick score logic (rule-based, no AI cost)
- +30 if title = Founder/CEO/MD/Managing Director
- +15 if title = Director/VP/Head of
- +25 if headcount 30–400
- +10 if headcount 1–29
- +15 if industry matches manufacturing/real estate/architecture/CA
- +5 otherwise (unknown industry)
- +10 if email present
- +5 if LinkedIn present
- Score bands: Hot 70+ / Warm 50–69 / Watch 30–49 / Cold <30

## State management
- `localStorage("apex.icp")` — saved ICP profile
- `localStorage("apex.leads")` — last pipeline results (persist across reload)
- Lead polling: 8s interval, max 75 polls (~10 min timeout)

## Key client functions (app.js)
- `checkApiStatus()` — polls /api/status every 30s, updates dots + enables/disables Generate button
- `switchTab(tabId)` — switches active tab
- `loadLeadIntoChain(lead)` — fills all 7 prospect fields, clears chain history, switches to tab 2
- `renderLeadPipeline(leads)` — renders scored lead cards in 3-column grid
- `leadsToCSV(leads)` — client-side CSV export
- `wireCampaigns()` — orchestrates pipeline: default URL, generate, poll, results, export, clear

## Railway deployment
1. Push code to GitHub
2. Railway detects changes → auto-deploys
3. Add env vars in Railway → Variables tab (Service Variables for each key)
4. Known issue: use Service Variable for PERPLEXITY_API_KEY, not Shared Variable

## Known Apify actor
Actor ID: `curious_coder~apollo-io-scraper`
Input fields sent: `startUrls`, `searchUrl`, `maxLeadsCount`, `maxResults`, `count`
