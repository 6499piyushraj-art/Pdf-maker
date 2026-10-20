import type { VercelRequest, VercelResponse } from "@vercel/node";
import { randomBytes } from "node:crypto";
import { hasValidSession, protectedApiError } from "../src/server/auth";
import { buildQuestionDocument, constantTimeStringEqual, googleOAuthConfigured, googleRedirectUri, sealGoogleTokens, unsealGoogleTokens, type GoogleTokenPayload } from "../src/server/google-docs";

const STATE_COOKIE = "paperpilot_google_state";
const TOKEN_COOKIE = "paperpilot_google_tokens";
const STATE_SECONDS = 10 * 60;
const TOKEN_SECONDS = 30 * 24 * 60 * 60;

function json(res: VercelResponse, status: number, body: unknown) {
  return res.status(status).setHeader("Cache-Control", "no-store").setHeader("X-Content-Type-Options", "nosniff").setHeader("Content-Type", "application/json; charset=utf-8").json(body);
}
function query(req: VercelRequest, key: string): string {
  const value = req.query?.[key];
  return Array.isArray(value) ? String(value[0] || "") : typeof value === "string" ? value : "";
}
function getCookie(req: VercelRequest, name: string): string {
  const header = req.headers.cookie;
  if (!header) return "";
  const cookies = Array.isArray(header) ? header.join(";") : header;
  for (const item of cookies.split(";")) {
    const separator = item.indexOf("=");
    if (separator > -1 && item.slice(0, separator).trim() === name) {
      try { return decodeURIComponent(item.slice(separator + 1).trim()); } catch { return ""; }
    }
  }
  return "";
}
function cookie(req: VercelRequest, name: string, value: string, maxAge: number, sameSite: "Lax" | "Strict" = "Lax"): string {
  const secure = process.env.NODE_ENV === "production" || req.headers["x-forwarded-proto"] === "https";
  const parts = [name + "=" + encodeURIComponent(value), "Path=/", "HttpOnly", "SameSite=" + sameSite, "Max-Age=" + maxAge];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}
function clearCookie(req: VercelRequest, name: string): string { return cookie(req, name, "", 0, "Lax"); }
function redirect(res: VercelResponse, path: string, cookies: string[] = []) {
  res.setHeader("Cache-Control", "no-store");
  if (cookies.length) res.setHeader("Set-Cookie", cookies);
  res.status(302).setHeader("Location", path);
  return res.end();
}
function parsedBody(body: unknown): any {
  if (typeof body === "string") { try { return JSON.parse(body); } catch { return null; } }
  return body && typeof body === "object" ? body : null;
}
function tokenFromRequest(req: VercelRequest): GoogleTokenPayload | null {
  const raw = getCookie(req, TOKEN_COOKIE);
  return raw && process.env.SESSION_SECRET ? unsealGoogleTokens(raw, process.env.SESSION_SECRET) : null;
}
function googleErrorMessage(payload: any, fallback: string): string {
  const message = payload?.error?.message || payload?.error_description;
  return typeof message === "string" ? message.slice(0, 240) : fallback;
}
async function freshTokens(tokens: GoogleTokenPayload): Promise<GoogleTokenPayload> {
  if (tokens.access_token && typeof tokens.expiry_date === "number" && tokens.expiry_date > Date.now() + 60000) return tokens;
  if (!tokens.refresh_token) throw new Error("Reconnect Google Docs to refresh access.");
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID || "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
      refresh_token: tokens.refresh_token,
      grant_type: "refresh_token"
    })
  });
  const payload: any = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) throw new Error("Google authorization expired or was revoked. Reconnect Google Docs.");
  return { ...tokens, access_token: payload.access_token, expiry_date: Date.now() + Number(payload.expires_in || 3600) * 1000, scope: payload.scope || tokens.scope };
}

async function handleCallback(req: VercelRequest, res: VercelResponse) {
  const supplied = query(req, "state");
  const saved = getCookie(req, STATE_COOKIE);
  const clearState = clearCookie(req, STATE_COOKIE);
  if (!supplied || !saved || !constantTimeStringEqual(supplied, saved)) return redirect(res, "/?google=error", [clearState]);
  if (query(req, "error")) return redirect(res, "/?google=error", [clearState]);
  const code = query(req, "code");
  if (!code || !googleOAuthConfigured()) return redirect(res, "/?google=error", [clearState]);
  try {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID || "",
        client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
        redirect_uri: googleRedirectUri(),
        grant_type: "authorization_code"
      })
    });
    const payload: any = await response.json().catch(() => ({}));
    if (!response.ok || !payload.access_token || !payload.refresh_token) return redirect(res, "/?google=error", [clearState]);
    const tokens: GoogleTokenPayload = {
      access_token: payload.access_token,
      refresh_token: payload.refresh_token,
      expiry_date: Date.now() + Number(payload.expires_in || 3600) * 1000,
      token_type: payload.token_type,
      scope: payload.scope
    };
    const sealed = sealGoogleTokens(tokens, process.env.SESSION_SECRET!);
    return redirect(res, "/?google=connected", [clearState, cookie(req, TOKEN_COOKIE, sealed, TOKEN_SECONDS)]);
  } catch {
    return redirect(res, "/?google=error", [clearState]);
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const action = query(req, "action");
  if (action === "callback") {
    if (req.method !== "GET") { res.setHeader("Allow", "GET"); return json(res, 405, { error: "Use GET." }); }
    return handleCallback(req, res);
  }
  if (action === "login") {
    if (req.method !== "GET") { res.setHeader("Allow", "GET"); return json(res, 405, { error: "Use GET." }); }
    if (!hasValidSession(req)) return json(res, 401, { error: "Sign in to PaperPilot before connecting Google Docs." });
    if (!googleOAuthConfigured()) return json(res, 503, { error: "Configure GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Render first." });
    const state = randomBytes(32).toString("base64url");
    const params = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      redirect_uri: googleRedirectUri(),
      response_type: "code",
      scope: "https://www.googleapis.com/auth/documents",
      access_type: "offline",
      prompt: "consent select_account",
      include_granted_scopes: "true",
      state
    });
    return redirect(res, "https://accounts.google.com/o/oauth2/v2/auth?" + params.toString(), [cookie(req, STATE_COOKIE, state, STATE_SECONDS)]);
  }
  if (action === "status") {
    if (req.method !== "GET") { res.setHeader("Allow", "GET"); return json(res, 405, { error: "Use GET." }); }
    if (!hasValidSession(req)) return json(res, 401, { error: "Sign in to PaperPilot." });
    const tokens = tokenFromRequest(req);
    return json(res, 200, { configured: googleOAuthConfigured(), connected: Boolean(tokens?.refresh_token) });
  }
  if (action === "disconnect") {
    if (req.method !== "POST") { res.setHeader("Allow", "POST"); return json(res, 405, { error: "Use POST." }); }
    if (protectedApiError(req, res)) return;
    res.setHeader("Set-Cookie", clearCookie(req, TOKEN_COOKIE));
    return json(res, 200, { connected: false });
  }
  if (action === "export") {
    if (req.method !== "POST") { res.setHeader("Allow", "POST"); return json(res, 405, { error: "Use POST." }); }
    if (protectedApiError(req, res)) return;
    if (!googleOAuthConfigured()) return json(res, 503, { error: "Google Docs is not configured yet. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Render." });
    const tokens = tokenFromRequest(req);
    if (!tokens?.refresh_token) return json(res, 401, { error: "Connect your Google account before creating a Google Doc." });
    const body = parsedBody(req.body);
    if (!body || !Array.isArray(body.questions)) return json(res, 400, { error: "Send an array of extracted questions." });
    let document;
    try {
      const title = typeof body.title === "string" ? body.title : "PaperPilot Question Bank";
      document = buildQuestionDocument(body.questions, title);
    } catch (error) {
      return json(res, 400, { error: error instanceof Error ? error.message : "Question data could not be prepared." });
    }
    try {
      const currentTokens = await freshTokens(tokens);
      const headers = { Authorization: "Bearer " + currentTokens.access_token, "Content-Type": "application/json" };
      const createdResponse = await fetch("https://docs.googleapis.com/v1/documents", {
        method: "POST", headers, body: JSON.stringify({ title: document.title })
      });
      const created: any = await createdResponse.json().catch(() => ({}));
      if (!createdResponse.ok || typeof created.documentId !== "string") {
        return json(res, createdResponse.status >= 400 && createdResponse.status < 500 ? 400 : 502,
          { error: googleErrorMessage(created, "Google Docs could not create the document. Check that the Google Docs API is enabled.") });
      }
      const updateResponse = await fetch("https://docs.googleapis.com/v1/documents/" + encodeURIComponent(created.documentId) + ":batchUpdate", {
        method: "POST", headers, body: JSON.stringify({ requests: document.requests })
      });
      const update: any = await updateResponse.json().catch(() => ({}));
      if (!updateResponse.ok) {
        return json(res, 502, { error: googleErrorMessage(update, "The Google Doc was created, but questions could not be inserted.") });
      }
      res.setHeader("Set-Cookie", cookie(req, TOKEN_COOKIE, sealGoogleTokens(currentTokens, process.env.SESSION_SECRET!), TOKEN_SECONDS));
      return json(res, 200, {
        connected: true, questionCount: document.questionCount, title: document.title,
        url: "https://docs.google.com/document/d/" + created.documentId + "/edit"
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Google Docs export failed.";
      return json(res, 502, { error: message.slice(0, 260) });
    }
  }
  res.setHeader("Allow", "GET, POST");
  return json(res, 400, { error: "Unknown Google Docs action." });
}
