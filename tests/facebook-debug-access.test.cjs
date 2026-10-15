/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict")
const { readFileSync } = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const { test } = require("node:test")
const ts = require("typescript")

function fixture(options = {}) {
  const actor = options.anonymous ? null : { id: "actor", name: "Duplicate name", role: options.role || "USER" }
  const calls = { reads: [], artifactQueries: [], records: [], writes: [], logs: [], teams: 0 }
  const owners = new Map([["own.png", "actor"], ["team.png", "member"], ["other.png", "outsider"],
    ["same-name.png", "outsider"], ["inactive.png", "inactive"], ["orphan.png", null]])
  const files = new Set([...owners.keys(), "unregistered.png"])
  const db = {
    team: { findMany: async ({ where }) => {
      calls.teams++
      assert.equal(where.teamLeadId, "actor")
      return [{ buyers: [{ user: { id: "member", name: "Member", active: true } },
        { user: { id: "inactive", name: "Inactive", active: false } }] }]
    } },
    facebookDebugArtifact: {
      findFirst: async ({ where }) => {
        calls.artifactQueries.push(where)
        if (options.dbFails) throw new Error("DB unavailable")
        const ids = where.farmJob.is.task.createdByUserId.in
        const owner = owners.get(where.filename)
        return owner && ids.includes(owner) ? { filename: where.filename } : null
      },
      create: async ({ data }) => {
        if (options.dbFails) throw new Error("DB unavailable")
        calls.records.push(data)
        return data
      },
    },
  }
  const adapters = {
    "@/lib/db": { prisma: db },
    "@/lib/session": { getActiveSession: async () => actor },
    "node:fs/promises": {
      readFile: async (file) => {
        calls.reads.push(file)
        if (!files.has(path.basename(file))) throw new Error("ENOENT")
        return Buffer.from("test-png-bytes")
      },
      mkdir: async () => {},
      writeFile: async (file) => { calls.writes.push(file) },
    },
  }
  const cache = new Map()
  function load(relative, suffix = "") {
    if (cache.has(relative)) return cache.get(relative)
    const filename = path.join(__dirname, "../", relative)
    const compiled = ts.transpileModule(readFileSync(filename, "utf8") + suffix, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 },
    }).outputText
    const sandbox = { exports: {}, process, Buffer, console,
      require: (name) => {
        if (Object.hasOwn(adapters, name)) return adapters[name]
        if (name === "@/lib/farm-queue-access") return load("src/lib/farm-queue-access.ts")
        if (name.startsWith("@/")) return {}
        return require(name)
      },
    }
    vm.runInNewContext(compiled, sandbox, { filename })
    cache.set(relative, sandbox.exports)
    return sandbox.exports
  }
  return { calls, route: load("src/app/api/facebook-debug/[filename]/route.ts"),
    writer: () => load("src/lib/facebook-page-switch.ts", "\nexport { saveFailureArtifact }") }
}

async function request(route, method, filename) {
  return route[method](new Request("http://localhost/api/facebook-debug/" + encodeURIComponent(filename)), { params: Promise.resolve({ filename }) })
}

for (const method of ["GET", "HEAD"]) {
  for (const role of ["USER", "FARMER", "TEAM_LEAD"]) {
    test(`${method}: ${role} can read its own screenshot`, async () => {
      const { route, calls } = fixture({ role })
      const response = await request(route, method, "own.png")
      assert.equal(response.status, 200)
      assert.equal(response.headers.get("content-type"), "image/png")
      assert.equal(response.headers.get("cache-control"), "private, no-store")
      assert.equal(await response.text(), method === "HEAD" ? "" : "test-png-bytes")
      assert.equal(calls.reads.length, 1)
    })
  }

  test(`${method}: team lead can read a current member's screenshot`, async () => {
    const { route, calls } = fixture({ role: "TEAM_LEAD" })
    assert.equal((await request(route, method, "team.png")).status, 200)
    assert.equal(calls.teams, 1)
  })

  test(`${method}: a regular user cannot read another team member's screenshot`, async () => {
    const { route, calls } = fixture()
    const response = await request(route, method, "team.png")
    assert.equal(response.status, 404)
    assert.equal(calls.reads.length, 0)
    assert.equal(response.headers.get("content-length"), null)
  })

  test(`${method}: outsiders, duplicate names, orphaned and unregistered artifacts stay private`, async () => {
    for (const role of ["USER", "TEAM_LEAD"]) {
      const { route, calls } = fixture({ role })
      for (const filename of ["other.png", "same-name.png", "inactive.png", "orphan.png", "unregistered.png", "missing.png"]) {
        const response = await request(route, method, filename)
        assert.equal(response.status, 404)
        assert.equal(response.headers.get("content-length"), null)
        assert.equal(response.headers.get("cache-control"), "private, no-store")
      }
      assert.equal(calls.reads.length, 0)
    }
  })

  test(`${method}: admin can read all existing files, including unassigned legacy files`, async () => {
    const { route, calls } = fixture({ role: "ADMIN" })
    for (const filename of ["own.png", "other.png", "orphan.png", "unregistered.png"]) {
      assert.equal((await request(route, method, filename)).status, 200)
    }
    assert.equal((await request(route, method, "missing.png")).status, 404)
    assert.equal(calls.artifactQueries.length, 0)
  })

  test(`${method}: anonymous requests do not query artifacts or read files`, async () => {
    const { route, calls } = fixture({ anonymous: true })
    const response = await request(route, method, "own.png")
    assert.equal(response.status, 401)
    assert.equal(response.headers.get("cache-control"), "private, no-store")
    assert.equal(calls.reads.length, 0)
    assert.equal(calls.artifactQueries.length, 0)
  })

  test(`${method}: invalid paths and HTML never reach the filesystem`, async () => {
    const { route, calls } = fixture({ role: "ADMIN" })
    for (const filename of ["../own.png", "/own.png", "own.png/other.png", "own.html", "own.png?file=other.png"]) {
      assert.equal((await request(route, method, filename)).status, 404)
    }
    assert.equal(calls.reads.length, 0)
  })

  test(`${method}: authorization lookup failures never expose image bytes`, async () => {
    const { route, calls } = fixture({ dbFails: true })
    await assert.rejects(request(route, method, "own.png"), /DB unavailable/)
    assert.equal(calls.reads.length, 0)
  })
}

test("failure artifacts persist the originating job before publishing the screenshot link", async () => {
  const { writer, calls } = fixture()
  const page = { screenshot: async () => Buffer.from("png"), content: async () => "<html>failure</html>" }
  await writer().saveFailureArtifact(page, { profileId: "shared-ALL", phase: "job", message: "Failure", jobId: "own-job" }, (line) => {
    assert.equal(calls.records.length, 1)
    calls.logs.push(line)
  })
  assert.equal(calls.records[0].farmJobId, "own-job")
  assert.equal(path.basename(calls.writes[0]), calls.records[0].filename)
  assert.match(calls.logs[0].text, /Debug сохранён:/)
})

test("manual debug screenshots have no task owner, and filenames cannot collide between runs", async () => {
  const { writer, calls } = fixture()
  const page = { screenshot: async () => Buffer.from("png"), content: async () => "" }
  for (let i = 0; i < 2; i++) await writer().saveFailureArtifact(page, { profileId: "same", phase: "job", message: "Failure" }, () => {})
  assert.equal(calls.records.length, 2)
  assert.equal(calls.records[0].farmJobId, null)
  assert.notEqual(calls.records[0].filename, calls.records[1].filename)
})

test("a failed metadata write never masks the job error or publishes an unowned image link", async () => {
  const { writer, calls } = fixture({ dbFails: true })
  const page = { screenshot: async () => Buffer.from("png"), content: async () => "" }
  await writer().saveFailureArtifact(page, { profileId: "same", phase: "job", message: "Original error", jobId: "job" }, (line) => calls.logs.push(line))
  assert.equal(calls.records.length, 0)
  assert.equal(calls.logs.length, 0)
})
