export type ChangeKind = "release" | "fix" | "breaking" | "security";

export interface ChangeEvent {
  id: string;
  sourceId: string;
  title: string;
  summary: string;
  url: string;
  publishedAt: string;
  kind: ChangeKind;
  impact: "low" | "medium" | "high";
  fields: Array<{ label: string; value: string }>;
}

export interface RunRecord {
  id: string;
  sourceId: string;
  time: string;
  status: "success" | "healed" | "replay" | "watch";
  detail: string;
  /** Measured wall-clock duration. Omitted when nothing was actually timed. */
  duration?: string;
}
