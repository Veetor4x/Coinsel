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
1. Open the app → **see** the DAO's real test-network balance and "Payouts are short in 9 days".
2. Press **Get advice** → **see** plain-English advice plus a **Verified private** panel (real Intel/NVIDIA hardware proofs from NEAR AI Cloud; if the check fails twice you get "Couldn't verify this time" and a **Try again** button — never unverified advice).
3. Press **File this suggestion** → **see** a real Sputnik proposal on testnet (explorer link). It is filed by the agent account, whose only key can call `add_proposal` on the DAO.
4. Press **Approve as Council 1**, then **Council 2** (DEMO_MODE: the server signs with testnet council keys) → **see** the proposal execute and balances update. In real use each council member signs with their own wallet.
5. Press **Try the trick** → **see** "Blocked: that address isn't yours…" (the guard refuses any address the DAO doesn't own).

## Run locally
```bash
npm install
npm run dev      # http://localhost:3000
npm test         # unit tests
```

## Testnet setup (once)
(`npm run setup:payroll` also creates the DAO-owned payroll account, paid for by `FUNDER_ACCOUNT_ID` / `FUNDER_PRIVATE_KEY`.)
The suggestion moves the whole gap the advice names (e.g. 3 NEAR = $3,000 at demo scale). About 5.5 NEAR of the DAO's balance is locked for contract storage, so after a run the main account may be too low for the next one: top it up from the test faucet if "can't spare" appears.

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
