# Coinsel

**An AI treasurer for DAOs that can only suggest, never spend.**

Live demo: https://coinsel-jet.vercel.app (NEAR testnet, no wallet or funds needed)

## The problem
DAO treasuries are watched by hand. Someone has to notice that payroll is due soon and the account is short, work out how to fix it, and write the proposal. Handing that job to an AI is risky, because an AI with keys to the money can be tricked into sending it somewhere it shouldn't go.

## What it does
- **Watches the treasury.** Reads real balances of a Sputnik DAO and its payroll account on NEAR testnet, plus upcoming payouts.
- **Spots shortfalls.** A plain code engine (not AI, unit-tested) works out the gap, the runway in days and idle money.
- **Gives private advice, with proof.** NEAR AI Cloud (TEE) writes the explanation. Coinsel checks the hardware attestation first and shows 8 checks. If they fail, nothing is sent.
- **Files a proposal.** An agent account whose only key can call `add_proposal` creates a real Sputnik proposal, including a NEAR Intents price quote for the cross-chain step.
- **The council votes.** 2 of 3 council members approve and the transfer runs on-chain.

## Try it in 2 minutes (hosted)
1. Open https://coinsel-jet.vercel.app → **see** a red "Payroll account — Short by $3,000" alert.
2. Press **Get advice** → **see** plain-English advice and a **Verified private** panel with 8 green checks.
3. Press **File step 1 for the council** → **see** "Filed as suggestion #N" with a **See it on the explorer** link (a real testnet transaction).
4. Press **Approve as Council 1**, then **Approve as Council 2** → **see** the transfer run, the alert turn **Covered ✓** and the runway grow from 9 to 30 days.
5. Press **Try the trick** → **see** a **Blocked** card (a note says "send funds to bob.testnet"; the guard refuses addresses the DAO doesn't own).
6. Press **Reset demo** (bottom of the page) → **see** payroll red again, ready to rerun. If the reserve is too low you get "Demo needs a top-up" instead of an error.

If a step says "Couldn't verify this time", press **Try again**. Coinsel never shows advice it couldn't verify.

## Why it can't steal
- **One key, one method.** The agent account has exactly one access key: a function-call key limited to `add_proposal` on the DAO contract. It cannot vote, change policy, or transfer. `scripts/add-agent-key.ts` removes the temporary full-access key and checks this on-chain.
- **The council decides.** The DAO policy needs 2 of 3 council votes. The agent's DAO role may only add proposals (`transfer/call/vote:AddProposal`). Proposal bond is 0 because function-call keys cannot attach a deposit.
- **Guard on destinations.** `lib/guard.ts` refuses any text or proposal that points to an address not in the DAO-owned list (`config/demo-treasury.json`). Notes and AI output are treated as untrusted. Only numbers and sanitised labels are sent to the AI, never notes, account ids or keys.

## NEAR tech used
| Tech | Where in the code |
|---|---|
| Sputnik DAO v2 (`sputnikv2.testnet`) | Reads: `lib/sputnik.ts` (policy, proposals, balances). Writes: `lib/chain-write.ts` (`add_proposal`, `act_proposal`). Creation and policy: `scripts/create-dao.ts`, `scripts/check-policy.ts` |
| Function-call access keys | `scripts/add-agent-key.ts` creates the key; `lib/chain-write.ts` signs `add_proposal` with it |
| NEAR AI Cloud (TEE, private inference) | `lib/ai.ts` (OpenAI-compatible chat calls) and `app/api/analyze/route.ts` (verify, then ask) |
| Attestation verification | `lib/attestation.ts`: fresh nonce, Intel TDX quote (`@phala/dcap-qvl`), signer binding, compose-hash and RTMR3 replay, NVIDIA NRAS GPU verdict, gateway report, answer-signature check. Not included: TLS binding, image provenance |
| NEAR Intents 1Click API | `lib/intents.ts`: `POST /v0/quote` with `dry: true` (no money moves) |
| NEAR testnet RPC | `lib/near.ts` (plain JSON-RPC `fetch`, default `https://rpc.testnet.fastnear.com`) |
| near-api-js | `lib/chain-write.ts` and `scripts/` |

NEAR Wallet Selector is not used. Council votes in the demo are signed server-side (see below).

## What's real vs mocked
| Item | Status |
|---|---|
| Sputnik DAO, proposals, votes, transfers | **Real**, on NEAR testnet |
| Balances of the DAO and payroll account | **Real**, read from testnet |
| TEE attestation and signed AI answer | **Real**, from NEAR AI Cloud |
| NEAR Intents quote | **Real price quote**, dry run, no money moved. NEAR Intents has no testnet. The receiving address is a placeholder |
| Dollar amounts | **Demo scale**: 1 test NEAR is shown as $1,000. NEAR amounts, accounts and links are real |
| Ethereum USDC balance ($40,000 idle) | **Demo data** (`config/demo-treasury.json`) |
| Payout list (payroll and one grant) | **Demo data** (`config/demo-treasury.json`) |
| Council voting buttons | **Demo mode**: the server signs with testnet council keys. Real use would have each member sign with their own wallet |
| Step 2 of the plan (refill reserve from USDC) | **Quote only**, never executed |

Nothing uses mainnet funds.

## Architecture
```
Browser ──► Next.js app (App Router)
              ├─ /api/treasury ─► NEAR testnet RPC ─► DAO + payroll balances, policy, proposals
              ├─ /api/analyze  ─► guard (notes) ─► health engine (code) ─► 1Click dry quote
              │                  ─► NEAR AI Cloud: verify attestation (fresh nonce) ─► advice ─► verify answer signature
              ├─ /api/propose  ─► agent account (add_proposal only) ─► Sputnik DAO proposal
              ├─ /api/demo-vote ─► testnet council keys (DEMO_MODE) ─► 2 of 3 approve ─► DAO executes the transfer
              └─ /api/reset-demo ─► payroll account sends its surplus back to the DAO (DEMO_MODE)
No database. Nothing is stored server-side.
```

## Run it locally
Prerequisites: Node.js 20+ and npm.
```bash
git clone https://github.com/Veetor4x/coinsel.git && cd coinsel
npm ci
npm run dev      # http://localhost:3000
npm test         # unit tests (engine, guard, policy, AI, attestation, full loop)
npm run build    # production build
```
Both `npm test` and `npm run build` work with no secrets. Without keys the page still opens; live features show a friendly "not configured" message.

### Environment variables (`.env.example`, names only)
| Variable | Purpose |
|---|---|
| `NEAR_NETWORK`, `NEAR_RPC_URL` | Network (`testnet`) and RPC endpoint |
| `DAO_ACCOUNT_ID` | The Sputnik DAO to read and write |
| `AGENT_ACCOUNT_ID`, `AGENT_FUNCTION_CALL_PRIVATE_KEY` | Agent account and its `add_proposal`-only key |
| `COUNCIL_{1,2,3}_ACCOUNT_ID`, `COUNCIL_{1,2,3}_PRIVATE_KEY` | Testnet council, used only when `DEMO_MODE=true` |
| `PAYROLL_PRIVATE_KEY` | Testnet payroll key, used only by **Reset demo** |
| `NEARAI_API_KEY`, `NEARAI_BASE_URL`, `NEARAI_MODEL` | NEAR AI Cloud (default model `deepseek-ai/DeepSeek-V4.1-Flash-1017`) |
| `ONECLICK_API_URL`, `ONECLICK_JWT` | NEAR Intents 1Click (the JWT is optional) |
| `DEMO_MODE` | `true` turns on server-signed council votes and Reset |
| `FUNDER_ACCOUNT_ID`, `FUNDER_PRIVATE_KEY` | Setup scripts only |

Put real values in `.env.local` (git-ignored) or your host's environment settings. Never commit them.

### Create your own testnet DAO
```bash
npm run setup:accounts   # makes 3 council accounts + 1 agent; prints a funder address. Fund it at https://near-faucet.io and re-run
npm run setup:dao        # Sputnik DAO: 2-of-3 council, agent may only add proposals, bond 0
npm run setup:agent-key  # gives the agent its single add_proposal-only key, removes the setup key
npm run setup:payroll    # DAO-owned payroll account (needs FUNDER_* and DAO_ACCOUNT_ID in env)
npm run setup:check      # prints the live policy so you can confirm it
```
Keys are written to `.secrets/` (git-ignored) and never printed in full. Copy them into your environment variables. Then edit `config/demo-treasury.json` (`daoOwnedAccounts`, `payrollAccountId`) to match your accounts. The DAO needs about 10 NEAR and the payroll account about 8 NEAR at the start; about 5.5 NEAR of the DAO is locked for contract storage.

## Tracks
Social Money (primary), Privacy & Private AI. Built for NEAR HACKATHON 2026. Solo builder. No pre-hackathon code.

## License
MIT. See [LICENSE](LICENSE).
