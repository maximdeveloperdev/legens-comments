/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict")
const { readFileSync } = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const { test } = require("node:test")
const ts = require("typescript")
const cache = new Map()
function load(name) {
  if (cache.has(name)) return cache.get(name)
  const file = path.join(__dirname, "../src/lib", `${name}.ts`)
  const exports = {}
  vm.runInNewContext(ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, crypto: require("node:crypto").webcrypto, require: (id) => load(id.split("/").pop()) })
  cache.set(name, exports)
  return exports
}
const { buildFarmTaskCopy, copyDraftFromJobs } = load("farm-task-copy")
const { validateCommentSet } = load("comment-set")
const url = "https://www.facebook.com/1/posts/2/"
const nextUrl = "https://www.facebook.com/1/posts/3/"
const job = (id, patch = {}) => ({ id, action: "comment", profileId: "own", fanName: id, url, message: `Text ${id}`, aiComment: false, photoPath: "", replyToJobId: null, ...patch })
const fans = Array.from({ length: 100 }, (_, index) => ({ id: `${index}`, name: `Fan ${index}`, profileId: "own", gender: "FEMALE", geo: ["GB", "FR", "ES"][index % 3] }))
const build = (jobs, draft = copyDraftFromJobs(jobs), pool = fans, urls = new Map([[url, nextUrl]])) => buildFarmTaskCopy(jobs, draft, pool, urls)

test("five comments, two replies, four likes each keep all 27 actions, text, photos and new parent IDs", () => {
  const source = []
  for (let i = 0; i < 5; i++) {
    source.push(job(`c${i}`, { photoPath: i === 0 ? "/uploads/farm-comments/photo.jpg" : "" }))
    for (let j = 0; j < 4; j++) source.push(job(`l${i}-${j}`, { action: "comment_like", message: "", replyToJobId: `c${i}` }))
    if (i < 2) source.push(job(`r${i}`, { replyToJobId: `c${i}` }))
  }
  const draft = copyDraftFromJobs(source)
  assert.equal(draft.comments.length, 7)
  assert.ok(draft.comments.filter((unit) => !unit.parentId).every((unit) => unit.likes === 4))
  draft.gender = "FEMALE"; draft.geos = ["GB", "FR", "ES"]
  const rows = build(source, draft)
  assert.equal(rows.length, 27)
  assert.equal(new Set(rows.map((row) => row.fanName)).size, 27)
  assert.ok(rows.every((row) => row.url === nextUrl))
  assert.ok(rows.every((row) => !source.some((old) => old.id === row.id)))
  assert.equal(rows.find((row) => row.message === "Text c0").photoPath, "/uploads/farm-comments/photo.jpg")
  const parent = rows.find((row) => row.message === "Text c0")
  assert.equal(rows.find((row) => row.message === "Text r0").replyToJobId, parent.id)
  assert.equal(rows.filter((row) => row.action === "comment_like" && row.replyToJobId === parent.id).length, 4)
})

test("editing text, reply likes and post likes produces exact requested counts", () => {
  const source = [job("c"), job("r", { replyToJobId: "c" })]
  const draft = copyDraftFromJobs(source)
  draft.comments[0].text = "Edited"; draft.comments[0].likes = 2; draft.comments[1].likes = 3; draft.postLikes = 4
  const rows = build(source, draft)
  assert.equal(rows.length, 11)
  assert.equal(rows.filter((row) => row.action === "likeonly").length, 4)
  const reply = rows.find((row) => row.message === "Text r")
  assert.equal(rows.filter((row) => row.action === "comment_like" && row.replyToJobId === reply.id).length, 3)
  draft.comments[0].likes = 0; draft.comments[1].likes = 0; draft.postLikes = 0
  assert.equal(build(source, draft).length, 2)
})

test("individual gender and geo override global targeting for comments and their likes", () => {
  const source = [job("c"), job("r", { replyToJobId: "c" })]
  const draft = copyDraftFromJobs(source)
  draft.gender = "FEMALE"; draft.geos = ["FR"]
  draft.comments[0].gender = "MALE"; draft.comments[0].geos = ["GB"]; draft.comments[0].likes = 1
  const pool = [...fans, { id: "m1", profileId: "own", name: "Man 1", geo: "GB", gender: "MALE" }, { id: "m2", profileId: "own", name: "Man 2", geo: "GB", gender: "MALE" }]
  const rows = build(source, draft, pool)
  assert.equal(rows[0].fanName, "Man 1"); assert.equal(rows[1].fanName, "Man 2")
  assert.equal(pool.find((fan) => fan.name === rows[2].fanName).geo, "FR")
})

test("insufficient matching fans rejects whole copy without lowering counts or relaxing filters", () => {
  const source = [job("c")]; const draft = copyDraftFromJobs(source)
  draft.gender = "MALE"; assert.throws(() => build(source, draft), /Недостаточно/)
  draft.gender = "FEMALE"; draft.comments[0].likes = 100
  assert.throws(() => build(source, draft), /Недостаточно/)
})

test("preferred original fans are retained when available and match the filter", () => {
  const source = [job("c", { fanName: "Fan 9" })]
  assert.equal(build(source)[0].fanName, "Fan 9")
})

test("multiple post mapping and reply URLs are preserved", () => {
  const second = `${url}?post=second`; const secondNext = `${nextUrl}?post=second`
  const source = [job("a"), job("b", { url: second }), job("r", { replyToJobId: "b", url: second })]
  const rows = build(source, undefined, fans, new Map([[url, nextUrl], [second, secondNext]]))
  assert.equal(rows[0].url, nextUrl); assert.equal(rows[1].url, secondNext); assert.equal(rows[2].url, secondNext)
})

test("sets can replace old texts with a different number of comments and replies", () => {
  const source = [job("c", { photoPath: "/uploads/farm-comments/old.jpg" })]
  const draft = copyDraftFromJobs([job("new"), job("reply", { replyToJobId: "new" }), job("extra")])
  draft.sources = {}
  const rows = build(source, draft)
  assert.equal(rows.length, 3); assert.ok(rows.every((row) => row.photoPath === ""))
  assert.equal(rows[1].replyToJobId, rows[0].id)
})

test("AI comments and like-only tasks survive copying", () => {
  const rows = build([job("ai", { message: "", aiComment: true })])
  assert.equal(rows[0].aiComment, true)
  const onlyLikes = build([job("like", { action: "likeonly", message: "" })])
  assert.equal(onlyLikes.length, 1); assert.equal(onlyLikes[0].action, "likeonly")
})

test("orphaned parents, cycles, duplicate IDs, forged sources and invalid counts are rejected", () => {
  const source = [job("c"), job("r", { replyToJobId: "c" })]
  const mutations = [
    (d) => { d.comments[1].parentId = "missing" },
    (d) => { d.comments[0].parentId = "r" },
    (d) => { d.comments[1].id = "c" },
    (d) => { d.sources.c = "foreign-task-job" },
    (d) => { d.comments[0].likes = -1 },
    (d) => { d.comments[0].likes = 1.5 },
    (d) => { d.comments[0].likes = 2000 },
    (d) => { d.comments[0].text = "" },
    (d) => { d.comments[0].text = "x".repeat(8001) },
    (d) => { d.geos = ["GB\nALL"] },
    (d) => { d.gender = "ADMIN" },
  ]
  for (const mutate of mutations) { const draft = copyDraftFromJobs(source); mutate(draft); assert.throws(() => build(source, draft)) }
})

test("stored sets strip source profiles, attachments and extra client fields", () => {
  const draft = copyDraftFromJobs([job("c")]); draft.profileId = "foreign"; draft.comments[0].photoPath = "/secret"
  const validated = validateCommentSet(draft)
  assert.equal(validated.sources, undefined); assert.equal(validated.profileId, undefined); assert.equal(validated.comments[0].photoPath, undefined)
})

test("a broad filter cannot consume the only actor suitable for a narrower comment", () => {
  const source = [job("broad", { fanName: "Woman" }), job("narrow")]
  const draft = copyDraftFromJobs(source); draft.comments[1].gender = "FEMALE"
  const pool = [
    { id: "f", profileId: "own", name: "Woman", gender: "FEMALE", geo: "GB" },
    { id: "m", profileId: "own", name: "Man", gender: "MALE", geo: "GB" },
  ]
  const rows = build(source, draft, pool)
  assert.equal(rows[0].fanName, "Man"); assert.equal(rows[1].fanName, "Woman")
})
