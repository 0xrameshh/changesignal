import { expect, test } from "@playwright/test";

test.use({ baseURL: "http://127.0.0.1:4174" });

test("fails closed for unauthorized, cross-site, and unapproved healing requests", async ({ request }) => {
  const unauthorized = await request.post("/api/live/run", { data: {} });
  expect(unauthorized.status()).toBe(401);
  expect(unauthorized.headers()["www-authenticate"]).toBe("Bearer");

  const crossSite = await request.post("/api/live/run", {
    data: {},
    headers: {
      authorization: "Bearer test-operator-key-12345",
      origin: "https://attacker.example",
      "sec-fetch-site": "cross-site",
    },
  });
  expect(crossSite.status()).toBe(403);

  const invalidContentType = await request.post("/api/live/run", {
    data: "{}",
    headers: { authorization: "Bearer test-operator-key-12345", "content-type": "text/plain" },
  });
  expect(invalidContentType.status()).toBe(415);

  const unknownField = await request.post("/api/live/run", {
    data: { prompt: "not allowed for a run" },
    headers: { authorization: "Bearer test-operator-key-12345" },
  });
  expect(unknownField.status()).toBe(400);

  const disabledHeal = await request.post("/api/live/heal", {
    data: { prompt: "Restore the required summary field." },
    headers: { authorization: "Bearer test-operator-key-12345" },
  });
  expect(disabledHeal.status()).toBe(403);
  await expect(disabledHeal.json()).resolves.toMatchObject({ error: "Web healing is disabled." });
});

test("renders the verified live artifact without fake product chrome", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByText("Verified snapshot", { exact: true })).toBeVisible();
  await expect(page.getByText("Verified snapshot loaded", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Same-collector recovery" })).toBeVisible();
  await expect(page.getByText("176 total")).toBeVisible();
  await expect(page.getByTestId("collector-id")).toHaveText("c_mt03abix22hd4vf273");
  await page.getByRole("button", { name: "Unlock live actions" }).click();
  await page.getByLabel("Operator key").fill("incorrect-key-value");
  await page.getByRole("button", { name: "Unlock", exact: true }).click();
  await expect(page.locator("#operator-key-error")).toHaveText("That operator key was not accepted.");
  await page.getByLabel("Operator key").fill("test-operator-key-12345");
  await page.getByRole("button", { name: "Unlock", exact: true }).click();
  await expect(page.getByRole("button", { name: "Run collector" })).toBeEnabled();
  await expect(page.getByText("Live", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Rewriting Bun in Rust" })).toBeVisible();

  // The recovery chain is always visible; it is the workspace centerpiece, not a disclosure.
  await expect(page.getByText("50 weak summaries", { exact: true })).toBeVisible();
  const rejectedEvidence = page.getByRole("link", { name: /live-heal-rejected\.json/ });
  await expect(rejectedEvidence).toHaveAttribute("href", "/api/evidence/live-heal-rejected");
  const evidenceResponse = await page.request.get("/api/evidence/live-heal-rejected");
  expect(evidenceResponse.ok()).toBeTruthy();
  expect(await evidenceResponse.text()).toContain("c_mt03abix22hd4vf273");
  const manifestLink = page.getByRole("link", { name: /manifest\.json/ });
  await expect(manifestLink).toHaveAttribute("href", "/api/evidence/manifest");
  const manifestResponse = await page.request.get("/api/evidence/manifest");
  expect(manifestResponse.ok()).toBeTruthy();
  await expect(manifestResponse.json()).resolves.toMatchObject({ collectorId: "c_mt03abix22hd4vf273", schemaVersion: 1 });
  await expect(page.locator("body")).not.toContainText("Workspace settings");
  await expect(page.locator("body")).not.toContainText("API key");
});
