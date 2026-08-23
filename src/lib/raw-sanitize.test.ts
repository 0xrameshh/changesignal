import { describe, expect, it } from "vitest";
import { sanitizeHealOutput } from "./raw-sanitize";

describe("heal response sanitizer", () => {
  it("returns only the allowlisted repair status", () => {
    const result = sanitizeHealOutput({
      status: "pending",
      approval_url: "https://brightdata.example/control/secret-job",
      job_id: "internal-job-id",
      account: { email: "operator@example.com" },
    }, "summary-contract-v1");

    expect(result).toEqual({ status: "pending", requiresApproval: true, repairId: "summary-contract-v1" });
    expect(JSON.stringify(result)).not.toContain("brightdata.example");
    expect(JSON.stringify(result)).not.toContain("internal-job-id");
  });

  it("normalizes unknown vendor statuses without reflecting vendor fields", () => {
    expect(sanitizeHealOutput({ status: "approval_required", url: "https://example.test" }, "summary-contract-v1"))
      .toEqual({ status: "review", requiresApproval: true, repairId: "summary-contract-v1" });
  });
});
