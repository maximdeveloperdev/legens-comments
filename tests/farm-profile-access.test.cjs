/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict")
const { readFileSync } = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const { test } = require("node:test")
const ts = require("typescript")

// Load the actual server actions with isolated DB, AdsPower and queue adapters.
// Tests never create production tasks or start Facebook/AdsPower browsers.
function fixture(options = {}) {
  const calls = { tasks: 0, jobs: [], scheduled: 0, rewrites: 0, files: 0, writes: [], profiles: 0, teams: [] }
  const user = { id: "actor", role: options.role || "USER", name: "Actor" }
  const profiles = options.profiles || [
    { id: "own", name: "[RED][GB] Team profile" },
    { id: "other", name: "[BLUE][FR] Another team" },
    { id: "common", name: "[ all ][ES] Shared" },
    { id: "unmarked", name: "Profile without a team" },
    { id: "misleading", name: "[BLUE][ALL] Not shared" },
  ]
  const db = {
    team: { findMany: async (query) => {
      calls.teams.push(query)
      if (options.dbThrows) throw new Error("DB unavailable")
      return (options.markers || [" red "]).map((marker) => ({ marker }))
    } },
    country: { findMany: async () => [{ code: "GB", nameRu: "Великобритания", flagSvg: "" }, { code: "FR", nameRu: "Франция", flagSvg: "" }, { code: "ES", nameRu: "Испания", flagSvg: "" }] },
    farmTask: {
      findFirst: async () => ({ id: "old-task", name: "Old task", action: "mixed", jobs: options.sourceJobs || (options.sourceProfiles || ["own"]).map((profileId, index) => ({
        id: `old-${index}`, profileId, action: "comment", fanName: "Fan", message: "Existing comment", aiComment: false,
        photoPath: "", url: "https://www.facebook.com/1/posts/2/", replyToJobId: null,
      })) }),
      create: async () => { calls.tasks++; return { id: "new-task" } },
    },
    farmJob: { createMany: async ({ data }) => { calls.jobs.push(...data); return { count: data.length } } },
    $transaction: async (callback) => callback(db),
  }
  const adapters = {
    "@/lib/db": { prisma: db },
    "@/lib/adspower": { listAdsPowerProfiles: async () => {
      calls.profiles++
      if (options.apiThrows) throw new Error("AdsPower unavailable")
      return { ok: options.apiOk !== false, profiles }
    } },
    "@/lib/facebook-fans": { listFacebookFansByProfile: async () => new Map(Object.entries(options.fans || {})) },
    "@/lib/session": { getActiveSession: async () => options.anonymous ? null : user },
    "@/lib/action-log": { writeTrackerLog: async () => {} },
    "@/lib/farm-queue": { kickFarmQueue: () => { throw new Error("Worker must never run in these tests") } },
    "@/lib/farm-queue-access": { getFarmQueueAccess: async () => ({ kind: "all" }), farmTaskAccessWhere: () => undefined },
    "@/lib/farm-comment-auto-rewrite": { rewriteFarmJobsForAntiSpam: async ({ jobs }) => {
      calls.rewrites++; return { ok: true, jobs, rewritten: 0 }
    } },
    "next/cache": { revalidatePath: () => {} },
    "next/server": { after: () => { calls.scheduled++ } },
    "node:fs/promises": { mkdir: async () => {}, writeFile: async (filename, bytes) => { calls.files++; calls.writes.push({ filename, bytes }) } },
  }
  const cache = new Map()
  function load(relative) {
    if (cache.has(relative)) return cache.get(relative)
    const file = path.join(__dirname, "../", relative)
    const compiled = ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 },
    }).outputText
    const sandbox = { exports: {}, Error, process, console, Buffer, File, FormData, URL, crypto: require("node:crypto").webcrypto,
      require: (name) => {
        if (Object.hasOwn(adapters, name)) return adapters[name]
        if (name.startsWith("@/")) return load(`src/${name.slice(2)}.ts`)
        return require(name)
      },
    }
    vm.runInNewContext(compiled, sandbox, { filename: file })
    cache.set(relative, sandbox.exports)
    return sandbox.exports
  }
  return { calls, user, access: load("src/lib/adspower-profile-access.ts"), actions: load("src/app/actions/farm-queue.ts") }
}

function input(profileIds) {
  return { name: "Access test", action: "mixed", jobs: profileIds.map((profileId, index) => ({
    profileId, clientKey: `job-${index}`, action: index ? "comment_like" : "comment", message: index ? "" : "Test comment",
    replyToKey: index ? "job-0" : undefined, url: "https://www.facebook.com/1/posts/2/",
  })) }
}

function noSideEffects(calls) {
  assert.equal(calls.tasks, 0)
  assert.equal(calls.jobs.length, 0)
  assert.equal(calls.scheduled, 0)
  assert.equal(calls.rewrites, 0)
  assert.equal(calls.files, 0)
}

for (const role of ["USER", "TEAM_LEAD", "FARMER"]) {
  test(`${role}: own team and ALL can create a task with parent dependencies`, async () => {
    const { actions, calls } = fixture({ role })
    const result = await actions.enqueueFarmTask(input(["own", "common"]))
    assert.equal(result.total, 2)
    assert.equal(calls.tasks, 1)
    assert.equal(calls.scheduled, 1)
    assert.equal(calls.jobs[1].replyToJobId, calls.jobs[0].id)
    assert.equal(calls.teams[0].where.OR[0].teamLeadId, "actor")
    assert.equal(calls.teams[0].where.OR[1].buyers.some.userId, "actor")
  })

  test(`${role}: one foreign reply/like profile rejects the whole batch before any side effects`, async () => {
    const { actions, calls } = fixture({ role })
    const result = await actions.enqueueFarmTask(input(["own", "other"]))
    assert.match(result.error, /Нет доступа/)
    noSideEffects(calls)
  })

  test(`${role}: duplicating an accessible old task rechecks its current profiles`, async () => {
    const { actions, calls } = fixture({ role, sourceProfiles: ["own", "other"] })
    const result = await actions.duplicateFarmTask({ taskId: "old-task", urls: ["https://www.facebook.com/1/posts/3/"] })
    assert.match(result.error, /Нет доступа/)
    noSideEffects(calls)
  })
}

test("unknown, unmarked and misleading ALL-in-second-bracket profiles are denied", async () => {
  for (const id of ["unknown", "unmarked", "misleading"]) {
    const { actions, calls } = fixture()
    assert.match((await actions.enqueueFarmTask(input([id]))).error, /Нет доступа/)
    noSideEffects(calls)
  }
})

test("users without a team can use only common ALL profiles", async () => {
  const { access, user } = fixture({ markers: [] })
  assert.equal(await access.getFarmProfileAccessError(user, ["common"]), null)
  assert.match(await access.getFarmProfileAccessError(user, ["own"]), /Нет доступа/)
})

test("multiple assigned teams are allowed and profile IDs are deduplicated", async () => {
  const { access, user, calls } = fixture({ role: "TEAM_LEAD", markers: ["RED", "BLUE"] })
  assert.equal(await access.getFarmProfileAccessError(user, ["own", "other", "common", "own"]), null)
  assert.equal(calls.profiles, 1)
})

test("lookup failures, including partial AdsPower responses, fail closed", async () => {
  for (const options of [{ apiOk: false }, { apiThrows: true }, { dbThrows: true }]) {
    const { actions, calls } = fixture(options)
    assert.match((await actions.enqueueFarmTask(input(["own"]))).error, /Не удалось проверить доступ/)
    noSideEffects(calls)
  }
})

test("a forged client profile name or team does not authorize a foreign profile ID", async () => {
  const { actions, calls } = fixture()
  const payload = input(["other"])
  Object.assign(payload.jobs[0], { name: "[ALL] Shared", team: "RED", role: "ADMIN" })
  assert.match((await actions.enqueueFarmTask(payload)).error, /Нет доступа/)
  noSideEffects(calls)
})

test("multipart requests authorize profiles before uploading any photos", async () => {
  const { actions, calls } = fixture()
  const form = new FormData()
  form.set("payload", JSON.stringify(input(["other"])))
  form.set("photo", new File([Buffer.from("89504e470d0a1a0a", "hex")], "test.png", { type: "image/png" }))
  assert.match((await actions.enqueueFarmTaskForm(form)).error, /Нет доступа/)
  noSideEffects(calls)
})

test("authorized multipart requests retain the global photo on comments", async () => {
  const { actions, calls } = fixture()
  const form = new FormData()
  form.set("payload", JSON.stringify(input(["own", "common"])))
  form.set("photo", new File([Buffer.from("89504e470d0a1a0a", "hex")], "test.png", { type: "image/png" }))
  assert.equal((await actions.enqueueFarmTaskForm(form)).total, 2)
  assert.equal(calls.files, 1)
  assert.match(calls.jobs[0].photoPath, /^\/uploads\/farm-comments\//)
  assert.equal(calls.jobs[1].photoPath, "")
})

test("copying permitted profiles still creates the task", async () => {
  const { actions, calls } = fixture({ sourceProfiles: ["own", "common"] })
  const result = await actions.duplicateFarmTask({ taskId: "old-task", urls: ["https://www.facebook.com/1/posts/3/"] })
  assert.equal(result.total, 2)
  assert.equal(calls.tasks, 1)
  assert.equal(calls.scheduled, 1)
})

test("admin access remains unrestricted and does not depend on team or profile lookup", async () => {
  const { actions, calls } = fixture({ role: "ADMIN", apiThrows: true, dbThrows: true })
  assert.equal((await actions.enqueueFarmTask(input(["other", "common"]))).total, 2)
  assert.equal(calls.profiles, 0)
  assert.equal(calls.teams.length, 0)
})

test("anonymous multipart submissions cannot write files or create tasks", async () => {
  const { actions, calls } = fixture({ anonymous: true })
  const form = new FormData()
  form.set("payload", JSON.stringify(input(["own"])))
  form.set("photo", new File([Buffer.from("89504e470d0a1a0a", "hex")], "test.png", { type: "image/png" }))
  assert.match((await actions.enqueueFarmTaskForm(form)).error, /войти/)
  noSideEffects(calls)
})

for (const role of ["USER", "TEAM_LEAD", "ADMIN"]) {
  test(`${role}: configured copies select gender/geo on the server and keep dependency links`, async () => {
    const { actions, calls } = fixture({ role, fans: {
      own: [{ id: "a", name: "Alice", gender: "FEMALE" }, { id: "b", name: "Bea", gender: "FEMALE" }, { id: "male", name: "Bob", gender: "MALE" }],
      other: [{ id: "foreign", name: "Foreign", gender: "FEMALE" }],
    } })
    const result = await actions.duplicateFarmTask({ taskId: "old-task", urls: ["https://www.facebook.com/1/posts/3/"], draft: {
      gender: "FEMALE", geos: ["GB"], postLikes: 0, sources: { c: "old-0" },
      comments: [{ id: "c", parentId: null, text: "Edited text", aiComment: false, likes: 1, gender: "ANY", geos: [] }],
    } })
    assert.equal(result.total, 2)
    assert.equal(calls.jobs.length, 2)
    assert.ok(calls.jobs.every((job) => job.profileId === "own"))
    assert.ok(calls.jobs.every((job) => job.fanName !== "Bob"))
    assert.equal(calls.jobs[1].replyToJobId, calls.jobs[0].id)
    assert.equal(calls.jobs[0].message, "Edited text")
  })
}

test("configured copy cannot use foreign team fans even if no matching own fans remain", async () => {
  const { actions, calls } = fixture({ fans: {
    other: [{ id: "foreign", name: "Foreign", gender: "FEMALE" }],
  } })
  const result = await actions.duplicateFarmTask({ taskId: "old-task", urls: ["https://www.facebook.com/1/posts/3/"], draft: {
    gender: "FEMALE", geos: ["FR"], postLikes: 0, sources: { c: "old-0" },
    comments: [{ id: "c", parentId: null, text: "Edited", aiComment: false, likes: 0, gender: "ANY", geos: [] }],
  } })
  assert.match(result.error, /Недостаточно/)
  noSideEffects(calls)
})

test("configured copy supports shared ALL fans", async () => {
  const { actions, calls } = fixture({ fans: { common: [{ id: "shared", name: "Shared", gender: "FEMALE" }] } })
  const result = await actions.duplicateFarmTask({ taskId: "old-task", urls: ["https://www.facebook.com/1/posts/3/"], draft: {
    gender: "FEMALE", geos: ["ES"], postLikes: 0, sources: {},
    comments: [{ id: "c", parentId: null, text: "From a set", aiComment: false, likes: 0, gender: "ANY", geos: [] }],
  } })
  assert.equal(result.total, 1)
  assert.equal(calls.jobs[0].profileId, "common")
})

for (const format of ["mp4", "gif"]) {
  test(`multipart supports ${format} attachments and retains them when copying`, async () => {
    const { actions, calls } = fixture()
    const form = new FormData()
    form.set("payload", JSON.stringify(input(["own"])))
    const bytes = format === "mp4" ? Buffer.from("000000186674797069736f6d0000000069736f6d", "hex") : Buffer.from("GIF89a-test")
    form.set("photo", new File([bytes], `comment.${format}`, { type: format === "mp4" ? "video/mp4" : "image/gif" }))
    const result = await actions.enqueueFarmTaskForm(form)
    assert.equal(result.total, 1); assert.equal(calls.files, 1)
    assert.ok(calls.jobs[0].photoPath.endsWith(`.${format}`))
    assert.deepEqual(calls.writes[0].bytes, bytes)
    const copied = fixture({ sourceJobs: [{ id: "old", profileId: "own", action: "comment", fanName: "Fan", message: "Comment", aiComment: false, photoPath: calls.jobs[0].photoPath, url: "https://www.facebook.com/1/posts/2/", replyToJobId: null }] })
    assert.equal((await copied.actions.duplicateFarmTask({ taskId: "old-task", urls: ["https://www.facebook.com/1/posts/3/"] })).total, 1)
    assert.equal(copied.calls.jobs[0].photoPath, calls.jobs[0].photoPath)
  })
}

test("a reply can have its own MP4 independently from the parent's GIF", async () => {
  const { actions, calls } = fixture()
  const payload = input(["own", "common"])
  Object.assign(payload.jobs[0], { photoKey: "parent" })
  Object.assign(payload.jobs[1], { action: "comment", message: "Reply", photoKey: "reply" })
  const form = new FormData(); form.set("payload", JSON.stringify(payload))
  form.set("photo:parent", new File(["GIF89a-test"], "parent.gif", { type: "image/gif" }))
  form.set("photo:reply", new File([Buffer.from("000000186674797069736f6d", "hex")], "reply.mp4", { type: "video/mp4" }))
  assert.equal((await actions.enqueueFarmTaskForm(form)).total, 2)
  assert.ok(calls.jobs[0].photoPath.endsWith(".gif")); assert.ok(calls.jobs[1].photoPath.endsWith(".mp4"))
  assert.equal(calls.jobs[1].replyToJobId, calls.jobs[0].id)
})

test("a renamed or corrupt media file fails before any uploads or task creation", async () => {
  const { actions, calls } = fixture()
  const payload = input(["own", "common"]); payload.jobs[0].photoKey = "valid"; payload.jobs[1].photoKey = "bad"
  const form = new FormData(); form.set("payload", JSON.stringify(payload))
  form.set("photo:valid", new File(["GIF89a-test"], "valid.gif", { type: "image/gif" }))
  form.set("photo:bad", new File(["not a video"], "fake.mp4", { type: "video/mp4" }))
  assert.match((await actions.enqueueFarmTaskForm(form)).error, /Содержимое/)
  noSideEffects(calls)
})

test("oversized media batches fail before reading file contents", async () => {
  const { actions, calls } = fixture()
  const payload = input(["own", "common"]); payload.jobs[0].photoKey = "a"; payload.jobs[1].photoKey = "b"
  const form = new FormData(); form.set("payload", JSON.stringify(payload))
  for (const key of ["a", "b"]) {
    const file = new File(["test"], `${key}.mp4`, { type: "video/mp4" })
    Object.defineProperty(file, "size", { value: 36 * 1024 * 1024 })
    file.arrayBuffer = async () => { throw new Error("Must not read an oversized batch") }
    form.set(`photo:${key}`, file)
  }
  assert.match((await actions.enqueueFarmTaskForm(form)).error, /70 МБ/)
  noSideEffects(calls)
})

test("foreign profiles cannot upload a video before authorization", async () => {
  const { actions, calls } = fixture()
  const form = new FormData(); form.set("payload", JSON.stringify(input(["other"])))
  form.set("photo", new File([Buffer.from("000000186674797069736f6d", "hex")], "reply.mp4", { type: "video/mp4" }))
  assert.match((await actions.enqueueFarmTaskForm(form)).error, /Нет доступа/)
  noSideEffects(calls)
})
