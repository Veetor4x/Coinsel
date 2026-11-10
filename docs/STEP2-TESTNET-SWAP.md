# Step 2 real test swap: one-time setup

Step 2 swaps **10 test USDC** the DAO holds for **test wNEAR**, using Tidepool (a community-run NEAR Intents testnet sandbox). The tokens have no value. You only do this setup once per DAO (the faucet gives one claim per wallet every 7 days; each swap uses 10 USDC, so one claim covers about 10 swaps).

## 1. Get the test tokens
1. Open https://app.usetidepool.tech/faucet → **Tokens** tab → chain **NEAR**.
2. Paste **your own testnet wallet** (for example `yourname.testnet`) → claim. You receive 100 USDC, 100 USDT, 40 wNEAR and a few others (a wallet can claim once per 7 days; 2 claims per internet connection per day).
3. Optional shortcut: some people paste the DAO account (`DAO_ACCOUNT_ID`) directly in step 2. If the claim works, skip step 4.

## 2. Register the DAO on the two token contracts (one time)
A token contract only lets an account hold its coins after the account is "registered" (a tiny 0.00125 NEAR fee each). Check first:
```bash
DAO_ACCOUNT_ID=your-dao.sputnikv2.testnet npm run setup:tidepool -- --check
```
If it says `NOT registered yet`, register (needs any testnet account with about 0.01 NEAR):
```bash
DAO_ACCOUNT_ID=... FUNDER_ACCOUNT_ID=your-wallet.testnet FUNDER_PRIVATE_KEY=ed25519:... npm run setup:tidepool
```
(testnet key only; never paste a real wallet key anywhere.) Sending tokens from a wallet that offers to "pay storage" for the receiver does the same thing.

## 3. Send 20 test USDC and 1 test wNEAR to the DAO
From your wallet, send the **test USDC** token (`usdc.tidepool-sandbox.testnet`) to the DAO, at least 10 (send 20 so you can run it twice). Send a small amount of **test wNEAR** (`wnear.tidepool-sandbox.testnet`) too; this is optional once step 2 shows both as registered.

## 4. Turn it on and try it
Set `TIDEPOOL_SWAP_ENABLED=true` in the environment, redeploy, then: **Get advice** → the Step 2 card shows a quote → **File step 2 for the council** → **Approve as Council 1** and **Council 2** in Suggestions → watch Step 2 go Approved → Swapping → Done.

If Step 2 says what is missing (for example "needs 10 test USDC (it has 0)"), do that step and press **Get advice** again.
