/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const { test } = require("node:test")
const ts = require("typescript")
function fixture(options = {}) {
  const calls = { created: 0, updated: [], hashed: 0, auth: 0 }
  const user = options.anonymous ? null : { id: "actor", role: options.role || "ADMIN", name: "Admin", timeZone: "Europe/Kyiv" }
  const db = { user: {
    findUnique: async ({ where }) => options.duplicate ? { id: "existing" } : where.id ? { id: where.id, role: "USER", active: true } : null,
    findFirst: async () => null, count: async () => 1,
    create: async ({ data }) => { if (options.raceDuplicate) throw { code: "P2002" }; if (options.dbError) throw { code: "P1001" }; calls.created++; return { id: "new", ...data } },
    update: async (query) => { calls.updated.push(query); return query.data },
  } }
  const adapters = {
    "@/lib/db": { prisma: db },
    "@/lib/session": { getActiveSession: async () => user, requireAdminSession: async () => { calls.auth++; return user?.role === "ADMIN" ? user : null } },
    "bcryptjs": { hash: async () => { calls.hashed++; return "hash" } },
    "@/lib/action-log": { writeTrackerLog: async () => {} },
    "@/lib/avatar": { validateAvatarFile: () => null, saveUserAvatar: async () => ({}), deleteUserAvatarFiles: async () => {} },
    "next/cache": { revalidatePath: () => {} },
  }
  const cache = new Map()
  function load(file) {
    if (cache.has(file)) return cache.get(file)
    const sandbox = { exports: {}, Error, Date, Intl, Request, Response, FormData, File, URL, console: { ...console, error: () => {} },
      require: (name) => adapters[name] || (name.startsWith("@/") ? load(`src/${name.slice(2)}.ts`) : require(name)),
    }
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, "../", file), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 },
    }).outputText, sandbox)
    cache.set(file, sandbox.exports); return sandbox.exports
  }
  return { calls, zones: load("src/lib/time-zones.ts"), preferences: load("src/app/api/preferences/time-zone/route.ts"), users: load("src/app/api/users/route.ts") }
}
function userForm() { const form = new FormData(); for (const [key, value] of Object.entries({ name: "New user", email: "new@example.invalid", password: "validpassword", role: "USER", active: "false" })) form.set(key, value); return form }
function request(url, body, method = "PUT", origin = "https://comments.legd.team") { return new Request("https://comments.legd.team" + url, { method, headers: { Origin: origin, ...(typeof body === "string" ? { "Content-Type": "application/json" } : {}) }, body }) }

test("Ukraine and supported European IANA zones except Moscow are represented; every listed zone formats dates", () => {
  const { zones } = fixture()
  const canonical = (zone) => new Intl.DateTimeFormat("en", { timeZone: zone }).resolvedOptions().timeZone
  const offered = new Set(zones.TIME_ZONES.map(([zone]) => canonical(zone)))
  for (const zone of Intl.supportedValuesOf("timeZone").filter((zone) => zone.startsWith("Europe/") && zone !== "Europe/Moscow")) assert.ok(offered.has(canonical(zone)), zone)
  assert.equal(zones.DEFAULT_TIME_ZONE, "Europe/Kyiv")
  assert.equal(zones.normalizeTimeZone("Europe/Kiev"), "Europe/Kyiv")
  assert.equal(zones.isAllowedTimeZone("Europe/Moscow"), false)
  assert.equal(zones.normalizeTimeZone("Europe/Moscow"), "Europe/Kyiv")
  for (const [zone] of zones.TIME_ZONES) assert.notEqual(zones.formatDateTime("2026-10-15T12:00:00Z", zone), "—")
})

test("date formatting uses the selected zone, handles DST and does not change the instant", () => {
  const { zones } = fixture()
  const options = { hour: "2-digit", minute: "2-digit" }
  assert.equal(zones.formatDateTime("2026-01-15T12:00:00Z", "Europe/Kyiv", options), "14:00")
  assert.equal(zones.formatDateTime("2026-07-15T12:00:00Z", "Europe/Kyiv", options), "15:00")
  assert.equal(zones.formatDateTime("2026-07-15T12:00:00Z", "Europe/London", options), "13:00")
  assert.equal(zones.formatDateTime("not-a-date", "Europe/Kyiv"), "—")
})

for (const role of ["USER", "TEAM_LEAD", "ADMIN"]) {
  test(`${role}: a time zone preference updates only the current user`, async () => {
    const { preferences, calls } = fixture({ role })
    const response = await preferences.PUT(request("/api/preferences/time-zone", JSON.stringify({ timeZone: "Europe/Warsaw", userId: "victim" })))
    assert.equal(response.status, 200); assert.equal(calls.updated.length, 1)
    assert.equal(calls.updated[0].where.id, "actor"); assert.equal(calls.updated[0].data.timeZone, "Europe/Warsaw")
  })
}

test("anonymous, invalid-zone and cross-site preferences never mutate accounts", async () => {
  for (const [options, zone, origin, status] of [[{ anonymous: true }, "Europe/Kyiv", undefined, 401], [{}, "invalid", undefined, 400], [{}, "Asia/Tokyo", undefined, 400], [{}, "Europe/Moscow", undefined, 400], [{}, "Europe/Kyiv", "https://outside.invalid", 403]]) {
    const { preferences, calls } = fixture(options)
    const response = await preferences.PUT(request("/api/preferences/time-zone", JSON.stringify({ timeZone: zone }), "PUT", origin))
    assert.equal(response.status, status); assert.equal(calls.updated.length, 0)
  }
})

for (const role of ["USER", "TEAM_LEAD", "FARMER"]) {
  test(`${role}: stable user API still forbids creating or editing accounts`, async () => {
    const { users, calls } = fixture({ role })
    assert.equal((await users.POST(request("/api/users", userForm(), "POST"))).status, 403)
    assert.equal((await users.PUT(request("/api/users", userForm()))).status, 403)
    assert.equal(calls.created, 0); assert.equal(calls.updated.length, 0); assert.equal(calls.hashed, 0)
  })
}

test("admin user creation returns compact success and hashes passwords", async () => {
  const { users, calls } = fixture()
  const response = await users.POST(request("/api/users", userForm(), "POST"))
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), {})
  assert.equal(calls.created, 1); assert.equal(calls.hashed, 1)
})

test("duplicate emails, database exceptions and cross-site requests return actionable errors", async () => {
  for (const [options, status] of [[{ duplicate: true }, 400], [{ raceDuplicate: true }, 409], [{ dbError: true }, 500]]) {
    const { users } = fixture(options)
    const response = await users.POST(request("/api/users", userForm(), "POST"))
    assert.equal(response.status, status); assert.ok((await response.json()).error)
  }
  const { users, calls } = fixture()
  assert.equal((await users.POST(request("/api/users", userForm(), "POST", "https://outside.invalid"))).status, 403)
  assert.equal(calls.auth, 0); assert.equal(calls.created, 0)
})

test("legitimate forwarded hosts work behind the production proxy", async () => {
  const { preferences, calls } = fixture()
  const response = await preferences.PUT(new Request("http://localhost:3000/api/preferences/time-zone", {
    method: "PUT", headers: { Origin: "https://comments.legd.team", Host: "localhost:3000", "X-Forwarded-Host": "comments.legd.team", "Content-Type": "application/json" },
    body: JSON.stringify({ timeZone: "Europe/London" }),
  }))
  assert.equal(response.status, 200); assert.equal(calls.updated[0].where.id, "actor")
})
