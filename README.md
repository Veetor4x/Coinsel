# Coinsel

**An AI treasurer for DAOs that can only suggest, never spend.**

Live demo: https://coinsel-jet.vercel.app (NEAR testnet, no wallet or funds needed)

## The problem
DAO treasuries are watched by hand. Someone has to notice that payroll is due soon and the account is short, work out how to fix it, and write the proposal. Handing that job to an AI is risky, because an AI with keys to the money can be tricked into sending it somewhere it shouldn't go.

## What it does
- **Watches the treasury.** Reads real balances of a Sputnik DAO and its payroll account on NEAR testnet, plus upcoming payouts.
- **Spots shortfalls.** A plain code engine (not AI, unit-tested) works out the gap, the runway in days and idle money.
- **Gives private advice, with proof.** NEAR AI Cloud (TEE) writes the explanation. Coinsel checks the hardware attestation first and shows 8 checks. If they fail, nothing is sent.
- **Files a proposal.** An agent account whose only key can call `add_proposal` creates a real Sputnik proposal. Step 2 can be a real test swap on NEAR Intents testnet (Tidepool), or a price quote if that is switched off or down.
- **The council votes.** 2 of 3 council members approve and the transfer runs on-chain.

## How it works
1. **Read.** The server reads the DAO, its payroll account and the open proposals from NEAR testnet. A code engine (not AI) finds the gap.
2. **Advise.** Private AI (checked first, fail-closed) explains a two-step plan in plain English.
3. **Step 1: top up payroll (NEAR testnet, council votes).** The agent files a Sputnik `Transfer` proposal: main reserve → payroll account, both DAO-owned.
4. **Step 2: refill the reserve (real test swap, council votes).** Only when `TIDEPOOL_SWAP_ENABLED=true`:
   - **What it swaps:** test USDC the DAO already holds → test wNEAR, on **NEAR Intents testnet (Tidepool, community sandbox)**. The output lands back in the DAO (main reserve). The amount is a small fixed test amount (`tidepool.swapUsdc` in `config/demo-treasury.json`, default 10), not the demo-scale gap. Tokens have no value.
   - **Quoted.** The screen shows a price-only quote (`POST /v0/quote`, `dry: true`).
   - **Filed.** Pressing **File step 2** asks Tidepool for a fresh real quote (good for ~30 minutes, re-requested once if it would expire in under 10). The quote gives a one-time deposit address, with the DAO as both the output recipient and the refund address. The agent then files one Sputnik `FunctionCall` proposal on the test-USDC contract with two actions: `storage_deposit` (registers that address, 0.00125 NEAR from the DAO) and `ft_transfer` (sends the USDC to it).
   - **Approved.** 2 of 3 council members approve. The DAO itself sends the USDC. The agent never touches the money and holds no Tidepool wallet. We do **not** use Tidepool's `/v1` agent wallets.
   - **Swapping → Done / Refunded / Failed.** The page polls Tidepool (`GET /v0/status`) and shows the result and explorer links. If the quote expired or the swap fails, Tidepool refunds the USDC to the DAO. If the council votes after the quote expired, demo voting refuses to sign and the page offers a fresh quote.
   - **Guard.** The guard only allows this one exact proposal shape, and only if Tidepool itself says both the output and the refund go to the DAO (`checkSwapDeposit` in `lib/guard.ts`).
   - **Fallback.** If Tidepool is off or not answering, Step 2 shows the old real-price mainnet quote, labelled "Quote only".
5. **Reset demo** also closes any open Step 2 suggestion. It cannot undo a swap that already ran (the test USDC is spent, the test wNEAR stays in the DAO).

### One-time setup for the real test swap
Needs the DAO registered on the two Tidepool token contracts and ~10 test USDC in it. The app does the registration for you: **Prepare treasury for testnet swaps** files two council-approved setup suggestions (exact `storage_deposit` calls only). Steps: [docs/STEP2-TESTNET-SWAP.md](docs/STEP2-TESTNET-SWAP.md).

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

## Safety checks
What stops a duplicate, padded or poisoned suggestion (all in code, all tested in `tests/hardening.test.ts` and `tests/guard.test.ts`):
- **Receiver is fixed.** A Step 1 top-up always goes to the DAO-owned payroll account from `config/demo-treasury.json`. The browser, the AI, labels and notes can't change it. Demo voting refuses any transfer to another account.
- **Amount is recomputed, never trusted.** The amount is the gap worked out on the server from on-chain balances plus the payout list. Before every demo vote it is recomputed again and refused if the suggestion asks for more than the real gap, or if payroll is already covered. There is also a hard ceiling per top-up (`limits.maxTopUpNear`).
- **No duplicates.** An identical top-up (same kind, receiver, amount) is not filed while one is waiting for votes ("Already filed as #X"), nor if the same transfer was already sent this pay cycle and its money is still in effect. Step 2 allows one open swap at a time. Filing is serialised per server so two quick requests can't both slip through.
- **Near-identical top-ups can't stack.** Any open top-up the agent filed to the payroll account counts toward the current gap, whatever its amount. A new suggestion asks only for the real gap (recomputed from chain + payout list) minus what is already pending; if nothing meaningful is left you get "Already covered by pending #X (and #Y)" and nothing is filed. All pending top-ups together can never exceed the real gap, the reserve's spendable NEAR, or the 20 NEAR ceiling, checked when filing and again before every demo vote. Reset still closes all pending top-ups so the demo can rerun. Found by Clearance (Selliks), replayed in `tests/hardening.test.ts`.
- **Safety checks see every proposal, not just the latest 20.** Pending top-ups, the duplicate check, demo-vote checks, the open-swap check and Reset all page through the DAO's full proposal list (`get_last_proposal_id` + `get_proposals` in batches of 100, one scan per request, cached for 3 seconds and cleared whenever Coinsel files or votes). So a pending top-up can't fall out of a window when 20+ newer proposals land after it and be filed again in full. The suggestion list in the UI still shows only the latest ones. Found by Clearance (Selliks), replayed in `tests/proposal-window.test.ts`.
- **Approvers are warned.** A suggestion card shows "Same transfer already sent in #X at <time>" (or "Already filed as #X") before anyone votes, and demo voting refuses to approve it.
- **Payout list is sanity-checked.** At most 20 payouts, each 0 to 1,000 NEAR, due within 365 days; negative, huge, non-numeric and oversized requests are refused. Notes and labels are data only: they never reach the receiver or the amount, they are scanned for outside addresses ("send funds to bob.testnet" is blocked), and the AI's own answer is scanned too.
- **A swapped list can't justify a vote.** The suggestion text carries a fingerprint of the payout list it was written for; a vote with a different list is refused.
- **The agent can only ask.** Its one key can only call `add_proposal`; the council (2 of 3) decides.

Known limits: the payout list lives in the browser (no database), so a hand-made request can submit its own list; the hard ceiling, the reserve balance and the 2-of-3 vote are the backstop. The filing lock is per server instance. Public endpoints have no rate limit beyond these checks.

## NEAR tech used
| Tech | Where in the code |
|---|---|
| Sputnik DAO v2 (`sputnikv2.testnet`) | Reads: `lib/sputnik.ts` (policy, proposals, balances). Writes: `lib/chain-write.ts` (`add_proposal`, `act_proposal`). Creation and policy: `scripts/create-dao.ts`, `scripts/check-policy.ts` |
| Function-call access keys | `scripts/add-agent-key.ts` creates the key; `lib/chain-write.ts` signs `add_proposal` with it |
| NEAR AI Cloud (TEE, private inference) | `lib/ai.ts` (OpenAI-compatible chat calls) and `app/api/analyze/route.ts` (verify, then ask) |
| Attestation verification | `lib/attestation.ts`: fresh nonce, Intel TDX quote (`@phala/dcap-qvl`), signer binding, compose-hash and RTMR3 replay, NVIDIA NRAS GPU verdict, gateway report, answer-signature check. Not included: TLS binding, image provenance |
| NEAR Intents 1Click API (mainnet, price only) | `lib/intents.ts`: `POST /v0/quote` with `dry: true` (no money moves). Fallback "quote only" card |
| NEAR Intents testnet via **Tidepool** (community sandbox, 1Click-compatible `/v0`) | `lib/tidepool.ts` (quote, status), `lib/swap-proposal.ts` (the exact `FunctionCall` proposal), `app/api/propose-swap`, `app/api/propose-register`, `app/api/swap-readiness`, `app/api/swap-status`, `app/SwapStep.tsx` |
| NEAR testnet RPC | `lib/near.ts` (plain JSON-RPC `fetch`, default `https://rpc.testnet.fastnear.com`) |
| near-api-js | `lib/chain-write.ts` and `scripts/` |

NEAR Wallet Selector is not used. Council votes in the demo are signed server-side (see below).

## What's real vs mocked
| Item | Status |
|---|---|
| Sputnik DAO, proposals, votes, transfers | **Real**, on NEAR testnet |
| Balances of the DAO and payroll account | **Real**, read from testnet |
| TEE attestation and signed AI answer | **Real**, from NEAR AI Cloud |
| NEAR Intents (mainnet) quote | **Real price quote**, dry run, no money moved. Used only as the fallback. The receiving address is a placeholder |
| Step 2 swap (when `TIDEPOOL_SWAP_ENABLED=true`) | **Real transactions on NEAR testnet** with **test tokens that have no value**, through Tidepool, a community-run sandbox (not run by NEAR; it is the only market maker). It swaps a small test amount of test USDC for test wNEAR, not the $-scale demo gap |
| Dollar amounts | **Demo scale**: 1 test NEAR is shown as $1,000. NEAR amounts, accounts and links are real |
| Ethereum USDC balance ($40,000 idle) | **Demo data** (`config/demo-treasury.json`) |
| Payout list (payroll and one grant) | **Demo data** (`config/demo-treasury.json`) |
| Council voting buttons | **Demo mode**: the server signs with testnet council keys. Real use would have each member sign with their own wallet |
| Ethereum "idle USDC" in Step 2 | **Not used for the real swap** (the DAO can't hold Ethereum coins). The real swap uses test USDC held by the DAO on NEAR testnet. With the swap switched off, Step 2 is **quote only** |
| Test wNEAR received | A **test token**, not the DAO's native NEAR. It is shown in Step 2, not added to the NEAR balance or the health numbers |

Nothing uses mainnet funds.

## Architecture
```
Browser ──► Next.js app (App Router)
              ├─ /api/treasury ─► NEAR testnet RPC ─► DAO + payroll balances, policy, proposals
              ├─ /api/analyze  ─► guard (notes) ─► health engine (code) ─► 1Click dry quote
              │                  ─► NEAR AI Cloud: verify attestation (fresh nonce) ─► advice ─► verify answer signature
              ├─ /api/propose  ─► agent account (add_proposal only) ─► Sputnik DAO proposal (step 1)
              ├─ /api/propose-swap ─► Tidepool live quote ─► guard ─► agent (add_proposal only) ─► Sputnik proposal (step 2)
              ├─ /api/swap-status  ─► DAO proposal + Tidepool status ─► Quoted/Filed/Approved/Swapping/Done
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
| `TIDEPOOL_SWAP_ENABLED` | `true` turns on the real Step 2 test swap. Default off (Step 2 stays quote-only) |
| `TIDEPOOL_API_URL`, `TIDEPOOL_API_KEY` | Optional. Tidepool base URL (default `https://www.usetidepool.tech`) and an optional key (any value works; it only lowers the fee tier). Server-side only |
| `DEMO_MODE` | `true` turns on server-signed council votes and Reset |
| `FUNDER_ACCOUNT_ID`, `FUNDER_PRIVATE_KEY` | Setup scripts only |

Put real values in `.env.local` (git-ignored) or your host's environment settings. Never commit them.

### Create your own testnet DAO
```bash
npm run setup:accounts   # makes 3 council accounts + 1 agent; prints a funder address. Fund it at https://near-faucet.io and re-run
npm run setup:dao        # Sputnik DAO: 2-of-3 council, agent may only add proposals, bond 0
npm run setup:agent-key  # gives the agent its single add_proposal-only key, removes the setup key
npm run setup:payroll    # DAO-owned payroll account (needs FUNDER_* and DAO_ACCOUNT_ID in env)
npm run setup:tidepool   # optional, advanced (the app can do this itself): registers the DAO on the Tidepool test tokens (real Step 2 swap); add --check to only look
npm run setup:check      # prints the live policy so you can confirm it
```
Keys are written to `.secrets/` (git-ignored) and never printed in full. Copy them into your environment variables. Then edit `config/demo-treasury.json` (`daoOwnedAccounts`, `payrollAccountId`) to match your accounts. The DAO needs about 10 NEAR and the payroll account about 8 NEAR at the start; about 5.5 NEAR of the DAO is locked for contract storage.

## Tracks
Social Money (primary), Privacy & Private AI. Built for NEAR HACKATHON 2026. Solo builder. No pre-hackathon code.

## License
MIT. See [LICENSE](LICENSE).
