import express from "express";
import { resolve } from "node:path";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import authHandler from "./api/auth.ts";
import extractHandler from "./api/extract.ts";
import auditHandler from "./api/audit.ts";

const app = express();
const port = Number.parseInt(process.env.PORT || "10000", 10);
const distPath = resolve(process.cwd(), "dist");

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(express.json({ limit: "5mb", strict: true }));
app.use(express.urlencoded({ extended: false, limit: "5mb" }));

app.get("/healthz", (_req, res) => {
  res.status(200).setHeader("Cache-Control", "no-store").json({ ok: true });
});

const route = (handler: (req: VercelRequest, res: VercelResponse) => unknown) =>
  (req: express.Request, res: express.Response, next: express.NextFunction) => {
    Promise.resolve(handler(req as unknown as VercelRequest, res as unknown as VercelResponse)).catch(next);
  };

app.all("/api/auth", route(authHandler));
app.all("/api/extract", route(extractHandler));
app.all("/api/audit", route(auditHandler));

app.use(express.static(distPath, {
  index: "index.html",
  etag: true,
  maxAge: "1h",
  setHeaders(res, path) {
    if (path.endsWith("index.html")) res.setHeader("Cache-Control", "no-cache");
  }
}));

app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ error: "API endpoint not found." });
  if (req.accepts("html")) return res.sendFile(resolve(distPath, "index.html"));
  return next();
});

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = typeof err === "object" && err !== null && "status" in err && typeof err.status === "number"
    ? err.status : 500;
  if (res.headersSent) return;
  res.status(status).setHeader("Cache-Control", "no-store").json({
    error: status === 413 ? "Request is too large. Reduce PDF page image resolution and try again." : "The server could not process this request."
  });
});

app.listen(port, "0.0.0.0", () => {
  console.log(`PaperPilot listening on 0.0.0.0:${port}`);
});
