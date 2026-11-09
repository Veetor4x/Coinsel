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

## Mocked / demo data (will be labelled in the UI)
Other-chain balances and the payroll/grant obligations are demo data in `config/demo-treasury.json`. Nothing uses mainnet funds.

## Run locally
```bash
npm install
npm run dev      # http://localhost:3000
npm test         # unit tests
```

## Testnet setup (once)
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
