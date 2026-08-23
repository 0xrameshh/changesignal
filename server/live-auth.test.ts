import { afterEach, describe, expect, it, vi } from "vitest";
import { getOperatorSecurity, isLiveActionAuthorized, isSameOriginRequest } from "./live-auth";

const originalKey = process.env.CHANGESIGNAL_OPERATOR_KEY;
const originalAllow = process.env.CHANGESIGNAL_ALLOW_UNAUTHENTICATED_LIVE_ACTIONS;

afterEach(() => {
  if (originalKey === undefined) delete process.env.CHANGESIGNAL_OPERATOR_KEY;
  else process.env.CHANGESIGNAL_OPERATOR_KEY = originalKey;
  if (originalAllow === undefined) delete process.env.CHANGESIGNAL_ALLOW_UNAUTHENTICATED_LIVE_ACTIONS;
  else process.env.CHANGESIGNAL_ALLOW_UNAUTHENTICATED_LIVE_ACTIONS = originalAllow;
  vi.unstubAllEnvs();
});

describe("live action authorization", () => {
  it("fails closed when no valid operator protection is configured", () => {
    delete process.env.CHANGESIGNAL_OPERATOR_KEY;
    delete process.env.CHANGESIGNAL_ALLOW_UNAUTHENTICATED_LIVE_ACTIONS;
    expect(getOperatorSecurity().keyConfigured).toBe(false);
    expect(isLiveActionAuthorized(new Request("http://localhost/api/live/run"))).toBe(false);
    process.env.CHANGESIGNAL_OPERATOR_KEY = "replace_with_a_random_operator_key";
    expect(getOperatorSecurity().keyConfigured).toBe(false);
  });

  it("accepts only the configured bearer key", () => {
    process.env.CHANGESIGNAL_OPERATOR_KEY = "operator-key-at-least-16-chars";
    expect(isLiveActionAuthorized(new Request("http://localhost/api/live/run", { headers: { authorization: "Bearer wrong-key-value" } }))).toBe(false);
    expect(isLiveActionAuthorized(new Request("http://localhost/api/live/run", { headers: { authorization: "Bearer operator-key-at-least-16-chars" } }))).toBe(true);
  });

  it("never permits the unauthenticated development escape hatch in production", () => {
    delete process.env.CHANGESIGNAL_OPERATOR_KEY;
    process.env.CHANGESIGNAL_ALLOW_UNAUTHENTICATED_LIVE_ACTIONS = "true";
    vi.stubEnv("NODE_ENV", "development");
    expect(isLiveActionAuthorized(new Request("http://localhost/api/live/run"))).toBe(true);
    vi.stubEnv("NODE_ENV", "production");
    expect(isLiveActionAuthorized(new Request("http://localhost/api/live/run"))).toBe(false);
  });

  it("rejects cross-site browser requests", () => {
    expect(isSameOriginRequest(new Request("https://app.example/api/live/run", { headers: { origin: "https://attacker.example", "sec-fetch-site": "cross-site" } }))).toBe(false);
    expect(isSameOriginRequest(new Request("https://app.example/api/live/run", { headers: { origin: "https://app.example", "sec-fetch-site": "same-origin" } }))).toBe(true);
    expect(isSameOriginRequest(new Request("http://0.0.0.0/api/live/run", { headers: { origin: "https://app.example", "x-forwarded-host": "app.example", "sec-fetch-site": "same-origin" } }))).toBe(true);
  });
});
