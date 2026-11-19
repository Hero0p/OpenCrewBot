// Step 17: what a deployment needs. Sign-in on a public address (and refusing to serve without a
// password), hosted databases, and the data folder's files surviving a wiped disk.
import { readFileSync, rmSync } from "node:fs";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { SESSION_COOKIE, decideAccess, passwordMatches, sessionToken, validSession } from "@/lib/server/access";
import { resolveDatabases } from "@/lib/server/config";
import { flushDataMirror, restoreDataFiles } from "@/lib/server/data-mirror";
import { deleteWorkspace, memoryPath, writeMemory } from "@/lib/server/memory-files";
import { getSetting, listDataFiles } from "@/lib/server/db";
import { boot } from "@/lib/server/service";
import { proxy } from "@/proxy";
import { describeError } from "@/lib/server/errors";
import { fetchWithReconnect, isClosedConnection, openDatabaseClient } from "@/lib/server/database-client";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

beforeAll(async () => {
  await boot();
});

describe("who may use the app", () => {
  it("is open on localhost without a password, as before", () => {
    expect(decideAccess({ pathname: "/", localHost: true })).toEqual({ allow: true });
  });

  it("refuses to serve a public address without a password, and says what to set", () => {
    const decision = decideAccess({ pathname: "/api/bots", localHost: false });
    expect(decision).toMatchObject({ allow: false, status: 503 });
    expect(decision.allow ? "" : decision.reason).toContain("OPENCREWBOT_PASSWORD");
  });

  it("with a password: pages go to sign-in, the API says 401, a valid session gets through", () => {
    expect(decideAccess({ pathname: "/", localHost: false, password: "pw" })).toMatchObject({ status: 401, toLogin: true });
    expect(decideAccess({ pathname: "/api/bots", localHost: true, password: "pw" })).toMatchObject({ status: 401, toLogin: false });
    expect(decideAccess({ pathname: "/api/bots", localHost: false, password: "pw", session: sessionToken("pw") })).toEqual({ allow: true });
    expect(decideAccess({ pathname: "/login", localHost: false, password: "pw" })).toEqual({ allow: true });
    expect(decideAccess({ pathname: "/api/health", localHost: false })).toEqual({ allow: true });
  });

  it("compares passwords and sessions safely, and a new password ends old sessions", () => {
    expect(passwordMatches("open sesame", "open sesame")).toBe(true);
    expect(passwordMatches("open", "open sesame")).toBe(false);
    expect(validSession(sessionToken("old"), "new")).toBe(false);
    expect(validSession(undefined, "pw")).toBe(false);
  });
});

describe("the proxy, end to end", () => {
  const saved = { password: process.env.OPENCREWBOT_PASSWORD, hosts: process.env.OPENCREWBOT_ALLOWED_HOSTS };
  afterEach(() => {
    process.env.OPENCREWBOT_PASSWORD = saved.password;
    process.env.OPENCREWBOT_ALLOWED_HOSTS = saved.hosts;
  });
  const request = (url: string, cookie?: string) => new NextRequest(url, { headers: { host: new URL(url).host, ...(cookie ? { cookie: `${SESSION_COOKIE}=${cookie}` } : {}) } });

  it("blocks unknown hosts, serves allowed ones only with a password, and leaves the health check open", () => {
    process.env.OPENCREWBOT_ALLOWED_HOSTS = "crew.onrender.com";
    delete process.env.OPENCREWBOT_PASSWORD;
    expect(proxy(request("https://evil.example/api/bots")).status).toBe(403);
    expect(proxy(request("https://crew.onrender.com/")).status).toBe(503);
    expect(proxy(request("https://crew.onrender.com/api/health")).status).toBe(200);

    process.env.OPENCREWBOT_PASSWORD = "s3cret";
    const page = proxy(request("https://crew.onrender.com/"));
    expect(page.status).toBe(307);
    expect(page.headers.get("location")).toContain("/login?next=%2F");
    expect(proxy(request("https://crew.onrender.com/api/bots")).status).toBe(401);
    expect(proxy(request("https://crew.onrender.com/api/bots", sessionToken("s3cret"))).status).toBe(200);
  });
});

describe("where the databases are", () => {
  it("uses local files by default, and a hosted database (with its token) when OPENCREWBOT_DB_URL is set", () => {
    expect(resolveDatabases({}).hosted).toBe(false);
    expect(resolveDatabases({}).app.url).toMatch(/^file:/);
    const hosted = resolveDatabases({ OPENCREWBOT_DB_URL: "libsql://crew-me.turso.io", OPENCREWBOT_DB_AUTH_TOKEN: "t" });
    expect(hosted).toMatchObject({ hosted: true, app: { url: "libsql://crew-me.turso.io", authToken: "t" } });
    // One hosted database holds both the app's tables and Mastra's ("mastra_…").
    expect(hosted.mastra).toEqual(hosted.app);
    expect(() => resolveDatabases({ OPENCREWBOT_DB_URL: "libsql://crew-me.turso.io" })).toThrow(/OPENCREWBOT_DB_AUTH_TOKEN/);
  });
});

describe("the data folder's files survive a wiped disk", () => {
  afterEach(() => {
    delete process.env.OPENCREWBOT_MIRROR_FILES;
  });

  it("copies memory writes into the database and writes them back when the disk is empty", async () => {
    process.env.OPENCREWBOT_MIRROR_FILES = "true";
    writeMemory("mirror-bot", "# Mirror bot\n\n- Prefers short answers.\n");
    await flushDataMirror();
    expect((await listDataFiles()).some((f) => f.path === "workspaces/mirror-bot/MEMORY.md")).toBe(true);

    // The host restarts with an empty disk: the file is gone, then boot restores it.
    rmSync(memoryPath("mirror-bot"));
    expect(await restoreDataFiles()).toBeGreaterThanOrEqual(1);
    expect(readFileSync(memoryPath("mirror-bot"), "utf8")).toContain("Prefers short answers.");

    // Deleting the bot removes its copy too.
    deleteWorkspace("mirror-bot");
    await flushDataMirror();
    expect((await listDataFiles()).some((f) => f.path.startsWith("workspaces/mirror-bot/"))).toBe(false);
  });

  it("does nothing locally unless asked", async () => {
    writeMemory("local-bot", "# Local\n");
    await flushDataMirror();
    expect((await listDataFiles()).some((f) => f.path.startsWith("workspaces/local-bot/"))).toBe(false);
  });

  it("remembers that the original bots were created in the database, not in a file a wiped disk would lose", async () => {
    expect(await getSetting<boolean>("seed.original.v1")).toBe(true);
  });
});

describe("errors say why", () => {
  it("adds the reason a bare 'fetch failed' hides (seen on Render)", () => {
    const network = Object.assign(new Error("connect ETIMEDOUT 142.250.1.95:443"), { code: "ETIMEDOUT" });
    const fetchFailed = new TypeError("fetch failed", { cause: network });
    expect(describeError(fetchFailed)).toBe("fetch failed ← connect ETIMEDOUT 142.250.1.95:443");
    const dns = Object.assign(new Error("getaddrinfo"), { code: "ENOTFOUND" });
    expect(describeError(new TypeError("fetch failed", { cause: new AggregateError([dns], "") }))).toBe("fetch failed ← getaddrinfo (ENOTFOUND)");
    expect(describeError("plain")).toBe("plain");
  });
});

describe("the hosted database survives a closed connection", () => {
  // A stand-in for Turso: it hangs up on the first request without answering (what a closed
  // keep-alive connection looks like to Node's fetch) and echoes the body of the next one.
  let server: Server;
  let url = "";
  let requests = 0;
  beforeAll(async () => {
    server = createServer((req, res) => {
      requests++;
      if (requests === 1) {
        req.socket.destroy();
        return;
      }
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => res.end(`got: ${body}`));
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v3/pipeline`;
  });
  afterEach(() => {
    requests = 0;
  });

  it("sends a request again, body and all, when the server closed the connection (seen on Render)", async () => {
    // Plain fetch fails the way the plan's final task did on Render.
    const plain = await fetch(url, { method: "POST", body: "SELECT 1" }).catch((error: unknown) => error);
    expect(describeError(plain)).toContain("other side closed");
    expect(isClosedConnection(plain)).toBe(true);

    requests = 0;
    const res = await fetchWithReconnect(new Request(url, { method: "POST", body: "SELECT 1" }));
    expect(await res.text()).toBe("got: SELECT 1");
    expect(requests).toBe(2);
  });

  it("doesn't retry a database that can't be reached at all", async () => {
    const closed = createServer();
    await new Promise<void>((done) => closed.listen(0, "127.0.0.1", done));
    const port = (closed.address() as AddressInfo).port;
    await new Promise<void>((done) => closed.close(() => done()));
    const refused = await fetchWithReconnect(new Request(`http://127.0.0.1:${port}/`)).catch((error: unknown) => error);
    expect(describeError(refused)).toContain("ECONNREFUSED");
    expect(isClosedConnection(refused)).toBe(false);
    const dns = new TypeError("fetch failed", { cause: Object.assign(new Error("getaddrinfo"), { code: "ENOTFOUND" }) });
    expect(isClosedConnection(dns)).toBe(false);
  });

  it("is what the hosted database client uses", async () => {
    // libSQL's own client, pointed at a server that always hangs up: each query is tried twice.
    const hangUp = createServer((req) => req.socket.destroy());
    await new Promise<void>((done) => hangUp.listen(0, "127.0.0.1", done));
    let tries = 0;
    hangUp.on("request", () => tries++);
    const client = openDatabaseClient({ url: `http://127.0.0.1:${(hangUp.address() as AddressInfo).port}` });
    const error = await client.execute("SELECT 1").catch((e: unknown) => e);
    client.close();
    await new Promise<void>((done) => hangUp.close(() => done()));
    expect(isClosedConnection(error)).toBe(true);
    expect(tries).toBe(2);
  });

  it("stops after one more try", async () => {
    // Every request hangs up: the second failure is thrown, not retried forever.
    const hangUp = createServer((req) => req.socket.destroy());
    await new Promise<void>((done) => hangUp.listen(0, "127.0.0.1", done));
    let tries = 0;
    hangUp.on("request", () => tries++);
    const error = await fetchWithReconnect(new Request(`http://127.0.0.1:${(hangUp.address() as AddressInfo).port}/`, { method: "POST", body: "x" })).catch((e: unknown) => e);
    await new Promise<void>((done) => hangUp.close(() => done()));
    expect(isClosedConnection(error)).toBe(true);
    expect(tries).toBe(2);
  });
});
