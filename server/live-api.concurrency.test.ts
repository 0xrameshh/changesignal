import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const environmentNames = ["BRIGHTDATA_COLLECTOR_ID", "BRIGHTDATA_TARGET_URL", "CHANGESIGNAL_OPERATOR_KEY", "CHANGESIGNAL_ALLOW_UNAUTHENTICATED_LIVE_ACTIONS"] as const;
const originalEnvironment = Object.fromEntries(environmentNames.map((name) => [name, process.env[name]]));

beforeEach(() => {
  process.env.BRIGHTDATA_COLLECTOR_ID = "c_concurrency123";
  process.env.BRIGHTDATA_TARGET_URL = "https://bun.sh/blog";
  process.env.CHANGESIGNAL_OPERATOR_KEY = "concurrency-operator-key";
  delete process.env.CHANGESIGNAL_ALLOW_UNAUTHENTICATED_LIVE_ACTIONS;
});

afterEach(() => {
  for (const name of environmentNames) {
    const value = originalEnvironment[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("live action lease", () => {
  it("is acquired before asynchronous body parsing", async () => {
    const { executeLiveAction } = await import("./live-api");
    let bodyController!: ReadableStreamDefaultController<Uint8Array>;
    const delayedBody = new ReadableStream<Uint8Array>({
      start(controller) { bodyController = controller; },
    });
    const headers = {
      authorization: "Bearer concurrency-operator-key",
      "content-type": "application/json",
    };
    const firstRequest = new Request("https://app.example/api/live/run", {
      method: "POST",
      headers,
      body: delayedBody,
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    const firstAction = executeLiveAction("run", firstRequest);
    await Promise.resolve();

    const secondAction = executeLiveAction("run", new Request("https://app.example/api/live/run", {
      method: "POST",
      headers,
      body: "{}",
    }));
    await expect(secondAction).rejects.toMatchObject({ status: 409 });

    bodyController.enqueue(new TextEncoder().encode('{"unexpected":true}'));
    bodyController.close();
    await expect(firstAction).rejects.toMatchObject({ status: 400 });
  });
});
