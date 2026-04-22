import type { SinceOption } from "@/types/monitor";

export const apiBase =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8081";

export const WORKLOADS_PER_PAGE = 8;
export const MAX_SINCE_MINUTES = 90 * 24 * 60;
export const LOG_PREVIEW_CHARS = 240;
export const PLAIN_LOG_PREVIEW_CHARS = 140;

export const sinceOptions: SinceOption[] = [
  { label: "15 minutes", value: 15 },
  { label: "30 minutes", value: 30 },
  { label: "1 hour", value: 60 },
  { label: "3 hours", value: 180 },
  { label: "6 hours", value: 360 },
  { label: "12 hours", value: 720 },
  { label: "1 day", value: 1440 },
  { label: "3 days", value: 4320 },
  { label: "7 days", value: 10080 },
  { label: "14 days", value: 20160 },
  { label: "30 days", value: 43200 },
  { label: "60 days", value: 86400 },
  { label: "90 days", value: 129600 },
];
