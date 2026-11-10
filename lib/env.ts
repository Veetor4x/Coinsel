// Read an environment variable with stray spaces/newlines removed (a pasted key with a trailing space once broke Reset).
// Empty values count as "not set".
export function env(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v ? v : undefined;
}

/** DEMO_MODE=true switches on the demo-only buttons (demo council votes, Reset). */
export const isDemoMode = () => env("DEMO_MODE")?.toLowerCase() === "true";
