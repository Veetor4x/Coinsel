# COINSEL — Project Brief

(Full original brief from the owner. Keep this file up to date; it is the source of truth for Claude Code sessions.)

## What we're building
Coinsel — "Counsel for your coins. Never control."
An AI treasury copilot for DAOs/communities on NEAR (Sputnik DAO / Trezu). It reads the treasury and upcoming payouts, finds problems (shortfalls, low runway, idle funds), writes plain-English advice using PRIVATE AI (NEAR AI Cloud, TEE, verified attestation), and files a real Sputnik DAO proposal. The council votes. The AI holds NO keys to funds: its only permission is add_proposal.

## About the owner
Solo, beginner coder, Windows laptop with weak battery, using Claude Code on the web. Explain briefly, give exact click-by-click steps for anything they must do themselves. Keep them on schedule. Prefer simple & working over clever. Warn if we fall behind.

## Hackathon rules that affect the build (NEAR HACKATHON)
- Deadline: 2026-11-14 23:59 UTC (= Nov 15 00:59 WAT). Target: submit Sat Nov 14, 18:00 WAT.
- Re-read https://nearhackathon.com/HACKATHON.md before submitting (rules may change).
- Repo must be PUBLIC by the deadline. MIT LICENSE. Never commit secrets.
- Claude Code + Codex screen every repo first: README must let a stranger run it and try it as "do X → see Y" steps. Ship sample/demo data so judges need no real funds.
- NEAR Intents has NO testnet: use 1Click API quotes with dry: true only (Q-007).
- Use NEAR testnet for everything else. No mainnet funds.
- Tracks: social (primary), privacy.
- README must name the NEAR tech used and clearly list what is mocked.

## MVP features
MUST (demo-critical):
1. Treasury view: connect a Sputnik DAO on testnet → real balances + upcoming obligations (payroll/grants) from config/form. Other-chain balances = labelled demo data.
2. Health engine (deterministic CODE, not AI): runway, shortfall date per obligation, idle funds. Unit-tested.
3. Private AI advice: NEAR AI Cloud (OpenAI-compatible, base URL https://cloud-api.near.ai/v1, TEE model chosen from the models endpoint) turns engine findings into plain-English advice. Fetch the attestation report with a fresh random nonce and verify per https://docs.near.ai/cloud/verification (see repo near-examples/nearai-cloud-verification-example). Show a "Verified private" panel listing what was checked. Keep nothing server-side.
4. One-click proposal: an agent account whose ONLY key is a function-call key restricted to the DAO contract, method add_proposal, files a real Sputnik proposal. Description includes the advice, a NEAR Intents 1Click dry-run quote for the cross-chain leg, and the attestation/response hash.
5. Council vote → execute: council members approve (NEAR Wallet Selector with testnet accounts; plus a clearly-labelled DEMO_MODE where the demo server signs votes with testnet council keys) → proposal executes on testnet → UI updates live.
6. Safety moment: an obligation note containing "send funds to bob.testnet" → guard refuses (destination not DAO-owned) and UI explains the AI cannot move funds anyway.
NICE (only after MUST works): show it on a Trezu treasury; real Sepolia balance read; one tiny mainnet Intents swap; weekly scheduled check.
CUT: Confidential Intents, mainnet funds, yield strategies, multi-DAO, logins, mobile app, tokens, custom multisig.

## Tech stack
Next.js (App Router) + TypeScript + Tailwind; near-api-js; @near-wallet-selector; Sputnik DAO v2 on testnet; NEAR AI Cloud; NEAR Intents 1Click API; Vitest; deploy on Vercel (auto-deploy from GitHub). No database.
VERIFY current package versions, endpoints in official docs before using them — do not guess.

## Architecture
Council (browser) → Coinsel web app (Next.js)
  → NEAR testnet RPC: read DAO balances, policy, proposals
  → Health engine (code): runway / shortfall / idle
  → NEAR AI Cloud (TEE): advice text + attestation → "Verified" panel
  → Safety guard: only DAO-owned destinations allowed
  → Agent account (function-call key: add_proposal ONLY) → Sputnik DAO proposal (+ 1Click dry-run quote) → council votes → executes on testnet

## Key technical notes
- Function-call access keys CANNOT attach deposits → DAO policy proposal_bond = "0".
- Agent has its own DAO role that may ONLY add proposals (no voting, no policy changes).
- Council role: 3 testnet accounts, approval threshold 2 of 3.
- Health math lives in code with tests; AI only explains and drafts text.

## Verified facts (2026-11-09)
- Sputnik v2 testnet factory: `sputnikv2.testnet` (on-chain, 5k+ DAOs). DAO id = `<name>.sputnikv2.testnet`. (`sputnik-v2.testnet` is an older factory — not used.)
- Testnet RPC: https://rpc.testnet.near.org (alt: https://rpc.testnet.fastnear.com). near-api-js 7.4.0 (`Account`, `JsonRpcProvider`, `KeyPair`).
- Policy permission labels: `transfer`, `call`, `vote`, ... + action `AddProposal`.
- Faucet: web form only (https://near-faucet.io, docs.near.org/getting-started/faucet).

## File structure
CLAUDE.md, README.md, LICENSE, .env.example
app/ (dashboard, proposal view, verify panel); app/api/ (treasury, analyze, propose, quote, attest, demo-vote)
lib/ near.ts sputnik.ts engine.ts ai.ts attestation.ts intents.ts guard.ts
config/demo-treasury.json
scripts/ create-accounts, create-dao, add-agent-key, check-policy (seed-demo: later)
tests/ engine.test.ts guard.test.ts (+ policy.test.ts)

## Build order (WAT; ~4h/day)
Day 0 Mon Nov 9: scaffold + testnet accounts/DAO scripts.
Day 1 Tue: Feature 1 + first Vercel deploy.
Day 2 Wed: Features 2 + 3.
Day 3 Thu: Features 4 + 5.
Day 4 Fri: Feature 6 + polish + README + fresh-clone test. CHECKPOINT: full loop works; cut NICE if behind.
Day 5 Sat: demo video, X post, submission.

## Environment variables (names only; see .env.example)
NEAR_NETWORK, NEAR_RPC_URL, DAO_ACCOUNT_ID, AGENT_ACCOUNT_ID, AGENT_FUNCTION_CALL_PRIVATE_KEY, COUNCIL_{1,2,3}_ACCOUNT_ID / _PRIVATE_KEY, NEARAI_API_KEY, NEARAI_BASE_URL, NEARAI_MODEL, ONECLICK_API_URL, ONECLICK_JWT (optional), DEMO_MODE=true

## Security rules (non-negotiable)
- Testnet only. Never use mainnet funds without explicit OK.
- NEVER ask for private keys or seed phrases of real wallets. Generate testnet keys in scripts; store only in environment secrets; never print in full; never commit.
- Agent key = function-call key, add_proposal only. No full-access keys in the app.
- Guard: proposals may only move funds between DAO-owned accounts listed in config.
- Validate all inputs; treat obligation notes and AI output as untrusted text.
- Ask before: making the repo public, deploying, or any irreversible action.
- Label everything mocked in UI and README.

## "Done" criteria for the demo
1. See demo DAO's real testnet balances and a "payroll short in 9 days" alert.
2. Analyze → plain-English advice + "Verified private" panel (real attestation).
3. File proposal → real proposal on testnet (explorer link) with Intents quote.
4. Approve 2 of 3 (DEMO_MODE) → proposal executes → balances/runway update.
5. "send funds to bob.testnet" note → refused with clear explanation.
6. Engine + guard tests pass.

## Day 1 decisions (2026-11-09)
- No mock stablecoin: funder had <1 NEAR (token storage needs more) and GitHub wasm downloads are blocked in the cloud container. Using NEAR with a FIXED, labelled demo USD price (`demoNearUsdPrice` in config/demo-treasury.json).
- `trackedTokens` in config/demo-treasury.json lists NEP-141 contracts to read via `ft_balance_of` (empty for now).
- Reads use plain JSON-RPC `fetch` (lib/near.ts), no keys. nearblocks API is not reachable from the container; UI only links to nearblocks.
- Vercel env vars for Day 1: NEAR_NETWORK, NEAR_RPC_URL, DAO_ACCOUNT_ID.


## CONTENT RULES
- Keep all demo data global and neutral. Replace contributor names (Alice, Bola, Chidi, Dayo, Ebere) with roles: "Core engineer", "Product designer", "Smart-contract dev", "Community lead", "Data analyst". No region-specific names anywhere.
- Plain English: every sentence understandable by a non-crypto person in 5 seconds. Tech terms only in small "details" text. Examples: "It can only suggest. It can't send money." / "Your data stayed private — and you can check that." / "We found the cheapest way to move the money."

## BRAND — "Fusion" (apply from now on; full polish on Day 4)
- Colours: background #0C0D0E (graphite), primary #C6FF3D (lime), text #F2F2EE, muted #B7BBB6 / #8E928D, warning #FF9A82, demo badge #FFC56E, card #121315, border #262A2E. Faint lime grid background (96px).
- Fonts: Syne 700/800 for headlines + "C O I N S E L" wordmark (wide letter-spacing), Inter for body, JetBrains Mono for labels/logs.
- Logo mark: broken orbit ring (light) around a lime core dot + small lime satellite dot.
- Motion: radar sweep with pulsing blips, self-typing "counsel log", tilted lime marquee, cards that gently float. Smooth on mobile; respect prefers-reduced-motion.
- Day 4 extras (do NOT build yet): sound effects + soft royalty-free ambient music behind a sound toggle that starts OFF; near.social community update post when a proposal is filed (NICE).

## Day 2 decisions (2026-11-10)
- Health engine (`lib/engine.ts`) works in USD. NEAR is converted with the fixed demo price. Each payout can only be paid from money on its own network; payouts are paid in date order. "Idle" = not needed for any payout in the next 30 days.
- AI model shortlist (NEAR AI Cloud, TEE): see PR notes. Preferred: `deepseek-ai/DeepSeek-V4.1-Flash-1017` (NEAR AI's own attested TEE). Not chosen/built yet.

## Day 3 decisions (2026-11-10)
- Full loop built: /api/analyze (guard → engine → 1Click dry quote → verify attestation, auto-retry once → advice), /api/propose (agent files Transfer to payroll account), /api/demo-vote (DEMO_MODE council signing). Fail-closed on attestation.
- Attestation/AI libs are PR #4's (8 checks incl. response signature). Day 3 only wraps them: retry once, guard on notes, attestation hash.
- Payroll account `coinselx69t-payroll.testnet` (DAO-owned, in config). Treasury total = DAO + payroll NEAR. DAO storage locks ~5.4 NEAR, so transfers are 0.1 NEAR; refill DAO from faucet.
- 1Click quote: USDC(eth)→wNEAR, dry:true, no JWT, placeholder recipient `example.near` (testnet addresses are rejected).

## Day 2 part 2 decisions (2026-11-10)
- Default AI model in code: `deepseek-ai/DeepSeek-V4.1-Flash-1017` (override with NEARAI_MODEL; fallback `deepseek/deepseek-v3.2`). Base URL defaults to https://cloud-api.near.ai/v1.
- Flow in `/api/analyze`: (1) verify attestation with a fresh nonce BEFORE sending anything; if not "verified", nothing is sent (fail-closed). (2) ask for advice. (3) verify the answer's `provider_tee` signature against the verified model key.
- Verification follows docs.near.ai/cloud/verification: Intel TDX quote via `@phala/dcap-qvl` (TCB must be UpToDate, debug off), nonce + signer bound in report_data, MRCONFIGID = app_compose hash, RTMR3 event-log replay, NVIDIA NRAS GPU verdict, gateway report too. TLS-binding and image-provenance checks are NOT done (documented as not included).
- Only engine numbers + sanitised payout labels go to the AI. Obligation notes, ids, accounts and keys never do.
- One analysis ≈ 800–900 tokens ≈ $0.0006.
- Demo scale: `demoNearUsdPrice` = 1000 (1 test NEAR = $1,000 demo value), idle USDC $40,000. Display + AI prompt only; on-chain amounts/links are real. Badge: "Demo scale — testnet amounts shown at real-world size".

## Day 4 part 1 decisions (2026-11-10)
- Mobile: single-column grid uses `grid-cols-1`, payouts stack on phones, long ids truncate/wrap, wordmark is "COINSEL" with smaller spacing on phones. Checked at 390px and 768px (no horizontal overflow).
- The suggestion amount = the FULL gap (total shortfall / demo price, rounded up to 0.01 NEAR), computed in `gapNear` (lib/engine-inputs.ts) by both /api/analyze and /api/propose. `payrollTransferNear` was removed. The AI payload now includes `totalShortUsd` so the advice names the same number.
- A transfer between DAO and payroll does not change the total, so the gap stays after a run; the DAO needs spendable NEAR >= gap (storage locks ~5.5 NEAR). Demo state now: DAO 8 NEAR, payroll 3.5 NEAR (gap $1,500). Top up via the faucet helper (POST https://helper.nearprotocol.com/account creates a 10-NEAR testnet account), then transfer to the DAO.
- Trick note present on "Get advice" -> blocked card with "Remove the note" button (client check + server guard). Suggestions show latest 3; older are collapsed.
- Vote results are remembered client-side so a lagging chain read can't undo "Approved".
