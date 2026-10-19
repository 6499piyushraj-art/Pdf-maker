import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const COOKIE_NAME = "paperpilot_session";
const SESSION_SECONDS = 7 * 24 * 60 * 60;

export function authConfigured(): boolean {
  return Boolean(process.env.APP_PASSWORD && process.env.APP_PASSWORD.length >= 12 && process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 32);
}

export function workspaceConfigured(): boolean {
  return authConfigured() && Boolean(process.env.GEMINI_API_KEY?.trim());
}

export function verifyAppPassword(candidate: string): boolean {
  const expected = process.env.APP_PASSWORD;
  if (!expected || !candidate || candidate.length > 1024) return false;
  const expectedDigest = createHash("sha256").update(expected).digest();
  const candidateDigest = createHash("sha256").update(candidate).digest();
  return timingSafeEqual(expectedDigest, candidateDigest);
}

function signature(expiresAt: string): string {
  return createHmac("sha256", process.env.SESSION_SECRET!)
    .update(`paperpilot-session:${expiresAt}`)
    .digest("hex");
}

function cookieValue(req: VercelRequest): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  const cookies = Array.isArray(header) ? header.join(";") : header;
  for (const item of cookies.split(";")) {
    const separator = item.indexOf("=");
    if (separator < 0) continue;
    if (item.slice(0, separator).trim() === COOKIE_NAME) {
      try { return decodeURIComponent(item.slice(separator + 1).trim()); }
      catch { return undefined; }
    }
  }
  return undefined;
}

export function hasValidSession(req: VercelRequest): boolean {
  if (!authConfigured()) return false;
  const token = cookieValue(req);
  if (!token) return false;
  const separator = token.indexOf(".");
  if (separator < 1) return false;
  const expiresAt = token.slice(0, separator);
  const supplied = token.slice(separator + 1);
  if (!/^\d{13}$/.test(expiresAt) || Number(expiresAt) <= Date.now() || !/^[a-f0-9]{64}$/.test(supplied)) return false;
  const expected = signature(expiresAt);
  const suppliedBuffer = Buffer.from(supplied, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  return suppliedBuffer.length === expectedBuffer.length && timingSafeEqual(suppliedBuffer, expectedBuffer);
}

export function setSessionCookie(req: VercelRequest, res: VercelResponse): void {
  const expiresAt = String(Date.now() + SESSION_SECONDS * 1000);
  const secure = process.env.NODE_ENV === "production" || req.headers["x-forwarded-proto"] === "https";
  const parts = [`${COOKIE_NAME}=${encodeURIComponent(`${expiresAt}.${signature(expiresAt)}`)}`, "Path=/", "HttpOnly", "SameSite=Strict", `Max-Age=${SESSION_SECONDS}`];
  if (secure) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

export function clearSessionCookie(req: VercelRequest, res: VercelResponse): void {
  const secure = process.env.NODE_ENV === "production" || req.headers["x-forwarded-proto"] === "https";
  const parts = [`${COOKIE_NAME}=`, "Path=/", "HttpOnly", "SameSite=Strict", "Max-Age=0"];
  if (secure) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

export function requestIsSameOrigin(req: VercelRequest): boolean {
  const origin = req.headers.origin;
  if (typeof origin !== "string" || !origin) return false;
  const hostHeader = req.headers["x-forwarded-host"] ?? req.headers.host;
  const host = Array.isArray(hostHeader) ? hostHeader[0] : hostHeader;
  if (!host) return false;
  try { return new URL(origin).host.toLowerCase() === host.toLowerCase(); }
  catch { return false; }
}

export function protectedApiError(req: VercelRequest, res: VercelResponse): boolean {
  if (!authConfigured()) {
    res.status(503).setHeader("Cache-Control", "no-store").json({ error: "Set an APP_PASSWORD of at least 12 characters and a SESSION_SECRET of at least 32 characters." });
    return true;
  }
  if (!requestIsSameOrigin(req)) {
    res.status(403).setHeader("Cache-Control", "no-store").json({ error: "Cross-origin requests are not allowed." });
    return true;
  }
  if (!hasValidSession(req)) {
    res.status(401).setHeader("Cache-Control", "no-store").json({ error: "Please sign in to use PaperPilot." });
    return true;
  }
  return false;
}
