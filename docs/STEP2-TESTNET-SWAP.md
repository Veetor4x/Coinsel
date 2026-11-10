# Step 2 real test swap: one-time setup (all in the app, no computer needed)

Step 2 swaps **10 test USDC** the DAO holds for **test wNEAR**, using Tidepool (a community-run NEAR Intents testnet sandbox). The tokens have no value. You do the setup once per DAO. It works from a phone.

## 1. Switch it on
Set `TIDEPOOL_SWAP_ENABLED=true` in your host's environment (Vercel: Settings → Environment Variables; tick **Preview** to try it on the preview link) and redeploy.

## 2. Prepare the treasury (in the app)
A token contract only lets an account hold its coins after the account is "registered" (a tiny 0.00125 NEAR fee, paid by the DAO).
1. Open the app → **Get advice**. In **Step 2** you will see **One-time setup needed**.
2. Press **Prepare treasury for testnet swaps**. Coinsel's agent files **two** suggestions (one per token contract). The agent can only ask; it signs nothing else.
3. Scroll to **Suggestions**. For each of the two new suggestions press **Approve as Council 1**, then **Approve as Council 2** (same as Step 1).
4. Step 2 updates by itself. It then shows **Ready, waiting for test USDC**.

Only the exact setup call is accepted: `storage_deposit` for the DAO itself, on the Tidepool USDC or wNEAR contract, 0.00125 NEAR. Anything else is refused by the guard and by demo voting.

## 3. Get test USDC into the DAO
1. Open https://app.usetidepool.tech/faucet → **Tokens** tab → chain **NEAR**.
2. Paste the DAO account (`DAO_ACCOUNT_ID`, for example `coinselx69t-treasury.sputnikv2.testnet`) and claim. (One claim per address every 7 days.) You get 100 test USDC and 40 test wNEAR.
3. If the faucet refuses the DAO address, claim to your own testnet wallet and send **at least 10 test USDC** (token `usdc.tidepool-sandbox.testnet`) to the DAO from your wallet.
4. Step 2 changes to the **File step 2 for the council** button on its own once the DAO holds 10 USDC.

## 4. Run the swap
**File step 2 for the council** → in **Suggestions**, approve as Council 1 and 2 → Step 2 goes Approved → Swapping → Done, with links.

---

## Advanced: the same registration from a terminal
Only if you prefer a script (needs Node and a testnet key you control):
```bash
DAO_ACCOUNT_ID=... npm run setup:tidepool -- --check      # only looks
DAO_ACCOUNT_ID=... FUNDER_ACCOUNT_ID=you.testnet FUNDER_PRIVATE_KEY=ed25519:... npm run setup:tidepool
```
Testnet keys only. Never paste a real wallet key anywhere.
