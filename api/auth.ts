import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authConfigured, clearSessionCookie, hasValidSession, requestIsSameOrigin, setSessionCookie, verifyAppPassword, workspaceConfigured } from "../src/server/auth";

function json(res: VercelResponse, status: number, payload: unknown) {
  return res.status(status).setHeader("Cache-Control", "no-store").setHeader("Content-Type", "application/json; charset=utf-8").setHeader("X-Content-Type-Options", "nosniff").json(payload);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "GET") {
    const configured = workspaceConfigured();
    return json(res, 200, { configured, authenticated: configured && hasValidSession(req) });
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return json(res, 405, { error: "Use GET to check sign-in or POST to sign in/out." });
  }
  if (!requestIsSameOrigin(req)) return json(res, 403, { error: "Cross-origin requests are not allowed." });
  if (!authConfigured()) return json(res, 503, { error: "Set APP_PASSWORD and a SESSION_SECRET of at least 32 characters in the hosting environment first." });

  let body = req.body as { password?: unknown; action?: unknown } | string | undefined;
  if (typeof body === "string") {
    try { body = JSON.parse(body) as { password?: unknown; action?: unknown }; }
    catch { return json(res, 400, { error: "Invalid request body." }); }
  }
  const action = body && typeof body === "object" ? body.action : undefined;
  if (action === "logout") {
    clearSessionCookie(req, res);
    return json(res, 200, { authenticated: false });
  }

  if (!process.env.GEMINI_API_KEY?.trim()) return json(res, 503, { error: "Set GEMINI_API_KEY in the hosting environment before signing in." });

  const password = body && typeof body === "object" && typeof body.password === "string" ? body.password : "";
  if (!verifyAppPassword(password)) return json(res, 401, { error: "Incorrect password." });
  setSessionCookie(req, res);
  return json(res, 200, { authenticated: true });
}
