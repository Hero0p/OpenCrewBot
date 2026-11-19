// Every request passes through here first (Next.js Proxy). Three checks:
//
// 1. Host: the app answers only on localhost, on the host names in OPENCREWBOT_ALLOWED_HOSTS, and on
//    Render's own name for this service (RENDER_EXTERNAL_HOSTNAME, set by Render). This stops DNS
//    rebinding. The health check (/api/health) is exempt, because hosts call it on internal addresses.
// 2. Browser origin (API only): requests from other websites are refused, so a page you visit can't
//    send messages, approve actions or add servers through your browser.
// 3. Sign-in (access.ts): locally with no password, open as before; with OPENCREWBOT_PASSWORD, a
//    session cookie is needed; on a public host without a password, the app refuses to serve.
//
// Locally, `pnpm dev` / `pnpm start` also listen on 127.0.0.1 only, so other devices can't connect at all.
import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, configuredPassword, decideAccess } from "@/lib/server/access";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function allowedHosts(): Set<string> {
  const extra = [...(process.env.OPENCREWBOT_ALLOWED_HOSTS ?? "").split(","), process.env.RENDER_EXTERNAL_HOSTNAME ?? ""]
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return new Set([...LOCAL_HOSTS, ...extra]);
}

function hostname(hostHeader: string | null): string {
  if (!hostHeader) return "";
  // Strip the port, keeping IPv6 brackets intact.
  return hostHeader.startsWith("[") ? hostHeader.slice(0, hostHeader.indexOf("]") + 1) : hostHeader.split(":")[0];
}

const forbidden = (why: string) => NextResponse.json({ error: `Blocked: ${why}` }, { status: 403 });

/** Same-origin requests (the app itself) and direct navigation only. Browsers label every request; other programs can forge this, which is why sign-in exists. */
function crossSiteProblem(request: NextRequest, host: string | null): string | null {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return "cross-site request.";
  const origin = request.headers.get("origin");
  if (!origin) return null;
  try {
    return new URL(origin).host === host ? null : "cross-origin request.";
  } catch {
    return "bad origin.";
  }
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const host = request.headers.get("host");
  const name = hostname(host).toLowerCase();

  if (pathname !== "/api/health" && !allowedHosts().has(name)) {
    return forbidden("OpenCrewBot only answers on localhost. Set OPENCREWBOT_ALLOWED_HOSTS to serve it on another host name.");
  }
  if (pathname.startsWith("/api/")) {
    const problem = crossSiteProblem(request, host);
    if (problem) return forbidden(problem);
  }

  const decision = decideAccess({ pathname, localHost: LOCAL_HOSTS.has(name), password: configuredPassword(), session: request.cookies.get(SESSION_COOKIE)?.value });
  if (decision.allow) return NextResponse.next();
  if (decision.status === 401 && decision.toLogin) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", pathname);
    return NextResponse.redirect(login);
  }
  return pathname.startsWith("/api/")
    ? NextResponse.json({ error: decision.reason }, { status: decision.status })
    : new NextResponse(decision.reason, { status: decision.status, headers: { "content-type": "text/plain; charset=utf-8" } });
}

export const config = {
  // Everything except Next's static files and the icons, so pages and the API are both covered.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-icon).*)"],
};
