/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const os = require("node:os")
const vm = require("node:vm")
const { test, after } = require("node:test")
const ts = require("typescript")
const root = fs.mkdtempSync(path.join(os.tmpdir(), "comment-media-serving-"))
const directory = path.join(root, "public/uploads/farm-comments")
fs.mkdirSync(directory, { recursive: true })
const sandbox = { exports: {}, Request, Response, process: { ...process, cwd: () => root }, require }
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, "../src/app/uploads/farm-comments/[filename]/route.ts"), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 },
}).outputText, sandbox)
const route = sandbox.exports
after(() => fs.rmSync(root, { recursive: true, force: true }))
async function request(filename, range, method = "GET", extras = {}) {
  return route[method](new Request("https://fixture.test/uploads/farm-comments/file", { method, headers: { ...(range ? { Range: range } : {}), ...extras } }), { params: Promise.resolve({ filename }) })
}

test("new media files are served immediately after route startup with the right MIME", async () => {
  for (const [ext, mime] of [["mp4", "video/mp4"], ["gif", "image/gif"], ["jpg", "image/jpeg"], ["png", "image/png"], ["webp", "image/webp"]]) {
    fs.writeFileSync(path.join(directory, `new.${ext}`), "0123456789")
    const response = await request(`new.${ext}`)
    assert.equal(response.status, 200); assert.equal(response.headers.get("Content-Type"), mime)
    assert.equal(response.headers.get("Accept-Ranges"), "bytes"); assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff")
    assert.equal(await response.text(), "0123456789")
  }
})

test("video byte ranges support seeking, open ends and suffixes", async () => {
  fs.writeFileSync(path.join(directory, "seek.mp4"), "0123456789")
  for (const [range, body, contentRange] of [["bytes=2-5", "2345", "bytes 2-5/10"], ["bytes=7-", "789", "bytes 7-9/10"], ["bytes=-3", "789", "bytes 7-9/10"], ["bytes=7-99", "789", "bytes 7-9/10"], ["bytes=-99", "0123456789", "bytes 0-9/10"]]) {
    const response = await request("seek.mp4", range)
    assert.equal(response.status, 206); assert.equal(response.headers.get("Content-Range"), contentRange)
    assert.equal(response.headers.get("Content-Length"), String(body.length)); assert.equal(await response.text(), body)
  }
})

test("invalid and unsatisfiable ranges return 416 without a file body", async () => {
  fs.writeFileSync(path.join(directory, "bad-range.mp4"), "0123456789")
  for (const range of ["bytes=10-", "bytes=4-2", "bytes=-0", "bytes=-", "bytes=1-2,4-5", "bytes=999999999999999999999-"]) {
    const response = await request("bad-range.mp4", range)
    assert.equal(response.status, 416); assert.equal(response.headers.get("Content-Range"), "bytes */10")
    assert.equal((await response.arrayBuffer()).byteLength, 0)
  }
})

test("HEAD reports media metadata without opening a stream; If-Range falls back to full content", async () => {
  fs.writeFileSync(path.join(directory, "head.mp4"), "0123456789")
  const head = await request("head.mp4", "bytes=2-4", "HEAD")
  assert.equal(head.status, 200); assert.equal(head.headers.get("Content-Length"), "10")
  assert.equal((await head.arrayBuffer()).byteLength, 0)
  const full = await request("head.mp4", "bytes=2-4", "GET", { "If-Range": '"old-file"' })
  assert.equal(full.status, 200); assert.equal(await full.text(), "0123456789")
})

test("missing files, directories and traversal requests stay inaccessible", async () => {
  fs.mkdirSync(path.join(directory, "folder.mp4"))
  for (const filename of ["missing.mp4", "folder.mp4", "../secret.mp4", "../../.env", "x.html", "%2e%2e%2fsecret.mp4"]) {
    assert.equal((await request(filename)).status, 404)
  }
})
