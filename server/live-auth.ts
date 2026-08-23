import { timingSafeEqual } from "node:crypto";

const MIN_OPERATOR_KEY_LENGTH = 16;

function readBearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice(7).trim();
  return token || null;
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function getOperatorSecurity() {
  const configuredKey = process.env.CHANGESIGNAL_OPERATOR_KEY?.trim() ?? "";
  const allowUnauthenticated = process.env.NODE_ENV !== "production"
    && process.env.CHANGESIGNAL_ALLOW_UNAUTHENTICATED_LIVE_ACTIONS === "true";
  const looksLikePlaceholder = /^(replace|change[-_ ]?me|example)/i.test(configuredKey);
  const keyConfigured = configuredKey.length >= MIN_OPERATOR_KEY_LENGTH && !looksLikePlaceholder;
  return { configuredKey, allowUnauthenticated, keyConfigured };
}

export function isLiveActionAuthorized(request: Request): boolean {
  const security = getOperatorSecurity();
  if (security.allowUnauthenticated) return true;
  if (!security.keyConfigured) return false;
  const suppliedKey = readBearerToken(request);
  return suppliedKey ? safeEqual(suppliedKey, security.configuredKey) : false;
}

export function isSameOriginRequest(request: Request): boolean {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") return false;

  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const requestHost = request.headers.get("x-forwarded-host")?.split(",", 1)[0].trim()
      || request.headers.get("host")
      || new URL(request.url).host;
    return new URL(origin).host === requestHost;
  } catch {
    return false;
  }
}
