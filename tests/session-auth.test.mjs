import test from "node:test";
import assert from "node:assert/strict";
import { authConfigured, clearSessionCookie, hasValidSession, setSessionCookie, verifyAppPassword } from "../src/server/auth.ts";

const originalPassword = process.env.APP_PASSWORD;
const originalSecret = process.env.SESSION_SECRET;
const originalNodeEnv = process.env.NODE_ENV;
const originalGeminiKey = process.env.GEMINI_API_KEY;

function fakeResponse() {
  const headers = {};
  return { headers, setHeader(name, value) { headers[name] = value; return this; } };
}
function fakeRequest(cookie = "", forwardedProto = "http") {
  return { headers: { cookie, "x-forwarded-proto": forwardedProto, host: "localhost:3000" } };
}
function configure() {
  process.env.APP_PASSWORD = "this-is-a-long-private-password";
  process.env.SESSION_SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef";
  process.env.GEMINI_API_KEY = "test-only-key";
  process.env.NODE_ENV = "development";
}
function restore() {
  if (originalPassword === undefined) delete process.env.APP_PASSWORD; else process.env.APP_PASSWORD = originalPassword;
  if (originalSecret === undefined) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = originalSecret;
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = originalNodeEnv;
  if (originalGeminiKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = originalGeminiKey;
}

test("requires a long password and a 32-character session secret", () => {
  configure();
  assert.equal(authConfigured(), true);
  process.env.APP_PASSWORD = "short";
  assert.equal(authConfigured(), false);
  process.env.APP_PASSWORD = "this-is-a-long-private-password";
  process.env.SESSION_SECRET = "short";
  assert.equal(authConfigured(), false);
  restore();
});

test("verifies the configured password and rejects incorrect credentials", () => {
  configure();
  assert.equal(verifyAppPassword("this-is-a-long-private-password"), true);
  assert.equal(verifyAppPassword("not-the-password"), false);
  assert.equal(verifyAppPassword(""), false);
  restore();
});

test("creates a signed session cookie accepted by the session checker", () => {
  configure();
  const response = fakeResponse();
  setSessionCookie(fakeRequest(), response);
  const header = response.headers["Set-Cookie"];
  assert.match(header, /^paperpilot_session=/);
  assert.match(header, /HttpOnly/);
  assert.match(header, /SameSite=Strict/);
  assert.match(header, /Max-Age=604800/);
  const cookiePair = header.split(";")[0];
  assert.equal(hasValidSession(fakeRequest(cookiePair)), true);
  assert.equal(hasValidSession(fakeRequest("paperpilot_session=1.invalid")), false);
  restore();
});

test("clears the session cookie on sign-out", () => {
  configure();
  const response = fakeResponse();
  clearSessionCookie(fakeRequest(), response);
  assert.match(response.headers["Set-Cookie"], /Max-Age=0/);
  restore();
});

test("requires an explicit matching origin for browser state-changing requests", async () => {
  const { requestIsSameOrigin, workspaceConfigured } = await import("../src/server/auth.ts");
  assert.equal(requestIsSameOrigin({ headers: { origin: "https://paperpilot.example", host: "paperpilot.example" } }), true);
  assert.equal(requestIsSameOrigin({ headers: { origin: "https://attacker.example", host: "paperpilot.example" } }), false);
  assert.equal(requestIsSameOrigin({ headers: { host: "paperpilot.example" } }), false);
  assert.equal(requestIsSameOrigin({ headers: { origin: "not a URL", host: "paperpilot.example" } }), false);
  configure();
  assert.equal(workspaceConfigured(), true);
  delete process.env.GEMINI_API_KEY;
  assert.equal(workspaceConfigured(), false);
  restore();
});
