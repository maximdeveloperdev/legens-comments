/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict")
const { readFileSync } = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const { test } = require("node:test")
const ts = require("typescript")

function fixture(user = { id: "user-a", role: "USER" }) {
  const calls = []
  const stored = [
    { id: "a", userId: "user-a", name: "My set", draft: validDraft() },
    { id: "b", userId: "user-b", name: "Other set", draft: validDraft() },
  ]
  const prisma = { commentSet: {
    findMany: async (query) => { calls.push(query); return stored.filter((set) => set.userId === query.where.userId) },
    upsert: async (query) => {
      calls.push(query)
      const { userId, name } = query.where.userId_name
      let set = stored.find((set) => set.userId === userId && set.name === name)
      if (set) set.draft = query.update.draft
      else { set = { id: `set-${stored.length}`, ...query.create }; stored.push(set) }
      return set
    },
    deleteMany: async (query) => { calls.push(query); const index = stored.findIndex((set) => set.id === query.where.id && set.userId === query.where.userId); if (index >= 0) stored.splice(index, 1) },
  } }
  const cache = new Map()
  function load(file) {
    if (cache.has(file)) return cache.get(file)
    const exports = {}
    const adapters = { "@/lib/db": { prisma }, "@/lib/session": { getActiveSession: async () => user } }
    vm.runInNewContext(ts.transpileModule(readFileSync(path.join(__dirname, "../src", file), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText, { exports, Error, require: (id) => adapters[id] || load(`${id.slice(2)}.ts`) })
    cache.set(file, exports)
    return exports
  }
  return { actions: load("app/actions/comment-sets.ts"), calls, stored }
}
function validDraft() { return {
  gender: "FEMALE", geos: ["GB", "FR"], postLikes: 2,
  comments: [
    { id: "c", parentId: null, text: "Comment", aiComment: false, likes: 4, gender: "ANY", geos: [] },
    { id: "r", parentId: "c", text: "Reply", aiComment: false, likes: 1, gender: "MALE", geos: ["ES"] },
  ],
} }
for (const role of ["USER", "TEAM_LEAD", "ADMIN"]) {
  test(`${role}: list and delete are scoped to the current account`, async () => {
    const { actions, calls, stored } = fixture({ id: "user-a", role })
    const result = await actions.listCommentSets()
    assert.equal(result.sets.length, 1); assert.equal(result.sets[0].id, "a")
    assert.equal(calls[0].where.userId, "user-a")
    await actions.deleteCommentSet("b")
    assert.ok(stored.some((set) => set.id === "b"))
    await actions.deleteCommentSet("a")
    assert.equal(stored.length, 1)
  })
}

test("save restores texts, replies and targeting on a later read and never trusts a client owner", async () => {
  const { actions, stored } = fixture()
  const draft = validDraft(); draft.userId = "user-b"; draft.sources = { c: "foreign" }
  const result = await actions.saveCommentSet({ name: "New set", draft, userId: "user-b" })
  assert.ok(result.id)
  const saved = stored.find((set) => set.id === result.id)
  assert.equal(saved.userId, "user-a"); assert.equal(saved.draft.sources, undefined)
  const loaded = (await actions.listCommentSets()).sets.find((set) => set.id === result.id)
  assert.equal(loaded.draft.comments[1].parentId, "c")
  assert.equal(loaded.draft.comments[0].likes, 4)
  assert.equal(loaded.draft.gender, "FEMALE")
  assert.deepEqual([...loaded.draft.geos], ["GB", "FR"])
})

test("saving the same name updates only this user's set", async () => {
  const { actions, stored } = fixture()
  const draft = validDraft(); draft.comments[0].text = "Changed"
  await actions.saveCommentSet({ name: "My set", draft })
  assert.equal(stored.length, 2); assert.equal(stored[0].draft.comments[0].text, "Changed")
  assert.equal(stored[1].draft.comments[0].text, "Comment")
})

test("anonymous calls cannot list, save or delete sets", async () => {
  const { actions, calls } = fixture(null)
  assert.match((await actions.listCommentSets()).error, /войти/)
  assert.match((await actions.saveCommentSet({ name: "New", draft: validDraft() })).error, /войти/)
  assert.match((await actions.deleteCommentSet("a")).error, /войти/)
  assert.equal(calls.length, 0)
})

test("invalid or empty sets are rejected before database writes", async () => {
  const { actions, calls } = fixture()
  for (const patch of [ { name: "" }, { name: "x".repeat(121) }, { draft: { ...validDraft(), comments: [] } }, { draft: { ...validDraft(), gender: "invalid" } } ]) {
    assert.ok((await actions.saveCommentSet({ name: "New", draft: validDraft(), ...patch })).error)
  }
  assert.equal(calls.length, 0)
})
