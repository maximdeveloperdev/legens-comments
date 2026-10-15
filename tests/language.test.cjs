/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const { test } = require("node:test")
const ts = require("typescript")
const root = path.join(__dirname, "..")
const catalog = require("../src/lib/messages/uk.json")

function fixture({ language, cookie, anonymous = false } = {}) {
  const updates = [], cookies = []
  const adapters = {
    react: { cache: (fn) => fn },
    "next/headers": { cookies: async () => ({ get: () => cookie ? { value: cookie } : undefined, set: (...args) => cookies.push(args) }) },
    "@/lib/session": { getActiveSession: async () => anonymous ? null : { id: "actor", language } },
    "@/lib/db": { prisma: { user: { update: async (query) => updates.push(query) } } },
  }
  const cache = new Map()
  function load(file) {
    if (cache.has(file)) return cache.get(file)
    if (file.endsWith(".json")) return JSON.parse(fs.readFileSync(path.join(root, file), "utf8"))
    const sandbox = { exports: {}, Request, Response, URL, Intl, Date, process: { env: { NODE_ENV: "production" } },
      require: (name) => adapters[name] || (name.startsWith("@/") ? load(`src/${name.slice(2)}${path.extname(name) ? "" : ".ts"}`) : require(name)),
    }
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, file), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 } }).outputText, sandbox)
    cache.set(file, sandbox.exports)
    return sandbox.exports
  }
  return { updates, cookies, i18n: load("src/lib/i18n.ts"), server: load("src/lib/i18n-server.ts"), route: load("src/app/api/preferences/language/route.ts"), zones: load("src/lib/time-zones.ts") }
}
function request(body, origin = "https://comments.legd.team") {
  return new Request("https://comments.legd.team/api/preferences/language", { method: "PUT", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body) })
}

test("language preferences update only the signed-in account and set a secure lasting cookie", async () => {
  const f = fixture()
  const response = await f.route.PUT(request({ language: "uk", userId: "victim", role: "ADMIN" }))
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { language: "uk" })
  assert.equal(f.updates.length, 1)
  assert.equal(f.updates[0].where.id, "actor")
  assert.equal(f.updates[0].data.language, "uk")
  assert.equal(f.cookies[0][0], "legends-language")
  assert.equal(f.cookies[0][1], "uk")
  assert.equal(f.cookies[0][2].httpOnly, true)
  assert.equal(f.cookies[0][2].secure, true)
  assert.equal(f.cookies[0][2].sameSite, "lax")
})

test("anonymous visitors can change the login language without creating or changing accounts", async () => {
  const f = fixture({ anonymous: true })
  assert.equal((await f.route.PUT(request({ language: "uk" }))).status, 200)
  assert.equal(f.updates.length, 0)
  assert.equal(f.cookies[0][1], "uk")
})

test("invalid languages and cross-site requests change neither account nor cookie", async () => {
  for (const [body, origin, status] of [[{ language: "ukr" }, undefined, 400], [{ language: "en" }, undefined, 400], [{}, undefined, 400], [{ language: "uk" }, "https://outside.invalid", 403]]) {
    const f = fixture()
    assert.equal((await f.route.PUT(request(body, origin))).status, status)
    assert.equal(f.updates.length, 0); assert.equal(f.cookies.length, 0)
  }
})

test("account preference wins over the browser; login uses the cookie; existing accounts default to Russian", async () => {
  assert.equal(await fixture({ language: "uk", cookie: "ru" }).server.getLanguage(), "uk")
  assert.equal(await fixture({ anonymous: true, cookie: "uk" }).server.getLanguage(), "uk")
  assert.equal(await fixture({ anonymous: true, cookie: "invalid" }).server.getLanguage(), "ru")
  assert.equal(await fixture({ language: "ru", cookie: "uk" }).server.getLanguage(), "ru")
})

test("translations interpolate content literally and keep unknown or Russian content intact", () => {
  const { i18n } = fixture()
  assert.equal(i18n.translate("uk", "Создать задачу"), "Створити завдання")
  assert.equal(i18n.translate("ru", "Создать задачу"), "Создать задачу")
  assert.equal(i18n.translate("uk", "Выбрать {0}", "Ошибка {1} <script>"), "Вибрати Ошибка {1} <script>")
  assert.equal(i18n.translate("uk", " Комментарий "), " Коментар ")
  assert.equal(i18n.translate("uk", "Мой текст: test"), "Мой текст: test")
  assert.equal(i18n.translate("uk", "constructor"), "constructor")
})

test("Ukrainian dates use the selected timezone and Ukrainian month names", () => {
  const { zones } = fixture()
  const options = { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }
  const date = "2026-10-15T12:00:00Z"
  const output = zones.formatDateTime(date, "Europe/Kyiv", options, "uk-UA")
  assert.match(output, /жовтня/); assert.match(output, /15:00/)
})

test("every translation keeps interpolation parameters and every explicit UI message has a translation", () => {
  const parameters = (text) => [...text.matchAll(/\{\d+\}/g)].map((match) => match[0]).sort()
  for (const [source, translated] of Object.entries(catalog)) assert.deepEqual(parameters(translated), parameters(source), source)
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(file)
      else if (file.endsWith(".tsx")) {
        const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
        function visit(node) {
          if (ts.isCallExpression(node) && node.expression.getText(source) === "t" && ts.isStringLiteral(node.arguments[0])) {
            const key = node.arguments[0].text.trim()
            assert.ok(catalog[key], `${file}: ${key}`)
          }
          ts.forEachChild(node, visit)
        }
        visit(source)
      }
    }
  }
  walk(path.join(root, "src"))
})
