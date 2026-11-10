# Coinsel

> **Counsel for your coins. Never control.**

An AI treasury copilot for NEAR DAOs (Sputnik DAO / Trezu). It reads the treasury and upcoming payouts, finds problems
(shortfalls, low runway, idle funds), explains them privately (NEAR AI Cloud, TEE) and files a real DAO proposal.
The council votes. **The AI holds no keys to funds — its only permission is `add_proposal`.**

Status: **Day 0 scaffold** — app is a placeholder; testnet setup scripts are ready. Full demo steps ("do X → see Y")
will be added here as features land.

## NEAR tech used
Sputnik DAO v2 (testnet) · NEAR testnet RPC · near-api-js · NEAR AI Cloud (private inference + attestation) ·
NEAR Intents 1Click API (dry-run quotes only; Intents has no testnet) · NEAR Wallet Selector (planned)

## Mocked / demo data (labelled in the UI)
The Ethereum USDC balance, the payout list and the NEAR price ($3) are demo data. The NEAR Intents quote is a REAL price quote (dry run, no money moved) but its receiving address is a placeholder. DEMO_MODE votes are signed server-side with testnet keys. Response-signature checking is not done yet (hardware attestation is).
Other-chain balances and the payroll/grant obligations are demo data in `config/demo-treasury.json`. Nothing uses mainnet funds.

## Try it (do X → see Y)
1. Open the app → **see** the real test-network balances (the payroll account pays everyone; the main DAO account is the reserve) and a red "Payroll account — Short by $3,000" alert.
2. Press **Get advice** → **see** plain-English advice plus a **Verified private** panel (real Intel/NVIDIA hardware proofs from NEAR AI Cloud; if the check fails twice you get "Couldn't verify this time" and a **Try again** button — never unverified advice).
   The advice is a two-step plan, with the same numbers everywhere (computed in code; the AI only explains them): **Step 1** (on NEAR, this proposal) moves the gap from the reserve to the payroll account; **Step 2** (another network, quote only) refills the reserve from idle USDC on Ethereum via NEAR Intents.
3. Press **File step 1 for the council** → **see** a real Sputnik proposal on testnet (explorer link). It is filed by the agent account, whose only key can call `add_proposal` on the DAO.
4. Press **Approve as Council 1**, then **Council 2** (DEMO_MODE: the server signs with testnet council keys) → **see** the proposal execute, the alert turn green ("Covered") and the runway grow. In real use each council member signs with their own wallet.
5. Press **Reset demo** (bottom of the page) → **see** the money go back so payroll is short again; you can run the story again. Reset only lets the payroll account send money back to the DAO. If the main reserve is too low, the page says "Demo needs a top-up" instead of failing.
6. Press **Try the trick** → **see** "Blocked: that address isn't yours…" (the guard refuses any address the DAO doesn't own).

## Run locally
```bash
npm install
npm run dev      # http://localhost:3000
npm test         # unit tests
```

## Testnet setup (once)
(`npm run setup:payroll` also creates the DAO-owned payroll account, paid for by `FUNDER_ACCOUNT_ID` / `FUNDER_PRIVATE_KEY`. Its key goes in `PAYROLL_PRIVATE_KEY`, used only by "Reset demo".)
The suggestion moves the whole gap the advice names (3 NEAR = $3,000 at demo scale). About 5.5 NEAR of the DAO's balance is locked for contract storage; keep the DAO at about 10 NEAR and the payroll account at about 8 NEAR at the start. Top the DAO up from the test faucet if "Demo needs a top-up" appears.

Creates 3 council accounts, 1 agent account and a Sputnik DAO (proposal bond 0, 2-of-3 council, agent may only add proposals),
then gives the agent a function-call key limited to `add_proposal` on the DAO.
```bash
npm run setup:accounts   # prints a funder address; fund it from the testnet faucet, re-run
npm run setup:dao
npm run setup:agent-key
npm run setup:check      # prints the live DAO policy
```
Secrets are written to `.secrets/` (gitignored) and never printed in full. Copy them into your environment variables (see `.env.example`).

## License
MIT
