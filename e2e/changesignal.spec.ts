import { expect, test } from "@playwright/test";

test.describe("ChangeSignal default workspace", () => {
  test("exposes production health and browser security headers", async ({ page }) => {
    const navigation = await page.goto("/");
    expect(navigation?.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(navigation?.headers()["x-content-type-options"]).toBe("nosniff");

    const health = await page.request.get("/api/health");
    expect(health.ok()).toBeTruthy();
    await expect(health.json()).resolves.toMatchObject({ status: "ok", service: "changesignal" });

    const missing = await page.goto("/missing-workspace");
    expect(missing?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "This workspace does not exist" })).toBeVisible();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("shows the verified collector snapshot with no credentials", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Bun changelog", level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: /open bun changelog source in a new tab/i })).toHaveAttribute("href", "https://bun.sh/blog");
    await expect(page.getByTestId("collector-id")).toHaveText("c_mt03abix22hd4vf273");
    await expect(page.getByText("176 total")).toBeVisible();
    await expect(page.getByText("Verified snapshot loaded", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Rewriting Bun in Rust" })).toBeVisible();

    // Derived fields are disclosed, never presented as collector output.
    await expect(page.getByText(/Signal and impact are derived locally/)).toBeVisible();
  });

  test("revalidates the snapshot against the contract", async ({ page }) => {
    await page.getByRole("button", { name: "Re-validate snapshot" }).click();
    await expect(page.getByText("Contract passed", { exact: true })).toBeVisible();
    await expect(page.getByText(/176 entries revalidated/)).toBeVisible();

    // macOS emits key="˚" for Option+K, so dispatch the real-world event shape.
    // Playwright's synthetic "Alt+k" sends key="k" and would pass even if the
    // handler compared `event.key` instead of `event.code`.
    await page.evaluate(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "˚", code: "KeyK", altKey: true, bubbles: true }));
    });
    await expect(page.getByLabel("Collector response")).toContainText('"source": "live"');
    await expect(page.getByRole("button", { name: /JSON output Hide · Alt\+K/ })).toBeVisible();
    await page.getByRole("button", { name: "Normalized events" }).click();
    await expect(page.getByLabel("Normalized events")).toContainText('"collectorId": "c_mt03abix22hd4vf273"');
  });

  test("holds the last valid data through the recorded failure replay", async ({ page }) => {
    await page.getByRole("button", { name: "Replay recorded failure" }).click();
    await expect(page.getByText("Contract failed", { exact: true })).toBeVisible();
    await expect(page.getByText(/Contract rejected the replay/)).toBeVisible();

    // The healed data stays on screen while the degraded payload is rejected.
    await expect(page.getByText("176 total")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Rewriting Bun in Rust" })).toBeVisible();
    await page.evaluate(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "˚", code: "KeyK", altKey: true, bubbles: true }));
    });
    await expect(page.getByLabel("Collector response")).toContainText('"summary": "To upgrade:"');

    await page.getByRole("button", { name: "Restore verified snapshot" }).click();
    await expect(page.getByText("Recovery complete", { exact: true })).toBeVisible();
    await expect(page.getByText(/verified snapshot restored/)).toBeVisible();
    await expect(page.getByLabel("Collector response")).not.toContainText('"summary": "To upgrade:"');
  });

  test("filters events by signal kind", async ({ page }) => {
    const filters = page.getByRole("group", { name: "Filter events by signal kind" });
    const rows = page.getByTestId("event-row");

    await expect(page.getByText("176 total")).toBeVisible();
    await expect(rows).toHaveCount(12); // default 12-row cap, unfiltered

    const initialSelectedTitle = await page.locator("h3").textContent();

    await filters.getByRole("button", { name: "Security" }).click();
    await expect(page.getByText("4 of 176")).toBeVisible();
    await expect(rows).toHaveCount(4); // Security has only 4 entries, so the 12-cap never engages
    for (const row of await rows.all()) {
      await expect(row.locator("span").first()).toHaveText("security");
    }

    // The Security-filtered set doesn't include the default first (release) event,
    // so the detail panel must re-target a visible row instead of going blank or
    // staying desynced from a row no longer on screen.
    await expect(page.locator("h3")).toBeVisible();
    await expect(page.locator("h3")).not.toHaveText(initialSelectedTitle ?? "");

    await filters.getByRole("button", { name: "Breaking" }).click();
    await expect(page.getByText("2 of 176")).toBeVisible();
    await expect(rows).toHaveCount(2);

    await filters.getByRole("button", { name: "All" }).click();
    await expect(page.getByText("176 total")).toBeVisible();
    await expect(rows).toHaveCount(12);
  });

  test("shows a quarterly activity timeline with anomaly markers", async ({ page }) => {
    const chart = page.locator('section[aria-labelledby="timeline-title"]');
    await expect(chart.getByRole("heading", { name: "Timeline" })).toBeVisible();

    const bars = chart.getByRole("button");
    expect(await bars.count()).toBeGreaterThan(0);

    // Hovering a bar reveals the exact count in a tooltip — the bar height alone never gates the number.
    await bars.first().hover();
    await expect(chart.getByText(/^Q\d 20\d\d$/)).toBeVisible();

    // At least one quarter is flagged as containing a security or breaking change (known from the verified dataset).
    const anomalyBars = chart.locator('button[aria-label*="security"], button[aria-label*="breaking"]');
    await expect(anomalyBars.first()).toBeVisible();

    // Keyboard focus gets the same tooltip as mouse hover.
    await bars.first().focus();
    await expect(chart.getByText(/^Q\d 20\d\d$/)).toBeVisible();
  });

  test("stays focused and usable on a phone viewport", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

    await expect(page.getByRole("heading", { name: "Bun changelog" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Re-validate snapshot" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Extracted events" })).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Workspace settings");
    await expect(page.locator("body")).not.toContainText("Ramesh Kumar");
    await expect(page.locator("body")).not.toContainText("Astro releases");
  });
});
