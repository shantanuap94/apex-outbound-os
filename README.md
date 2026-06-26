# Apex Growth Partners Outbound Dashboard

Local webapp for building the Apex AI outbound sales stack, starting with the ICP definition module.

## Run

```bash
npm start
```

Open `http://localhost:4173`.

## AI Assist

The app works without an API key by returning local Apex ICP drafts. To use live AI generation, set:

```bash
OPENAI_API_KEY=your_key
OPENAI_MODEL=gpt-4.1-mini
```

Then run `npm start`.

## Current Scope

- Dashboard shell
- ICP definition workspace
- Empathy map fields
- Pains, fears, frustrations, dream outcomes
- AI fill endpoint for each ICP field
- Local browser persistence

Next modules:

- Signal strategy and scoring
- Agent 1 dossier schema
- Agent 2-5 prompt chain
- Campaign and reply workflow
