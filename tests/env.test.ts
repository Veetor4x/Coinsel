import { afterEach, describe, expect, it } from "vitest";
import { env, isDemoMode } from "@/lib/env";

afterEach(() => { delete process.env.TEST_KEY; delete process.env.DEMO_MODE; });

describe("env()", () => {
  it("trims stray spaces and newlines", () => {
    process.env.TEST_KEY = "  ed25519:abc \n";
    expect(env("TEST_KEY")).toBe("ed25519:abc");
  });
  it("treats empty or blank values as not set", () => {
    process.env.TEST_KEY = "   ";
    expect(env("TEST_KEY")).toBeUndefined();
    expect(env("NOT_THERE_AT_ALL")).toBeUndefined();
  });
  it("reads DEMO_MODE even with spaces around it", () => {
    process.env.DEMO_MODE = " true ";
    expect(isDemoMode()).toBe(true);
    process.env.DEMO_MODE = "false";
    expect(isDemoMode()).toBe(false);
  });
});
