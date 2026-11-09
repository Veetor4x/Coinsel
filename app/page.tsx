export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-6 px-6">
      <h1 className="text-5xl font-bold tracking-tight">Coinsel</h1>
      <p className="text-xl text-zinc-400">Counsel for your coins. Never control.</p>
      <p className="text-zinc-500">
        AI treasury copilot for NEAR DAOs. It reads the treasury, finds problems, explains them
        privately (NEAR AI Cloud, TEE) and files a proposal. The council votes. The AI holds no keys to funds.
      </p>
      <span className="w-fit rounded-full border border-amber-500/40 px-3 py-1 text-sm text-amber-400">
        Day 0 placeholder — treasury view coming next
      </span>
    </main>
  );
}
