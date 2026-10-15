/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const os = require("node:os")
const vm = require("node:vm")
const { test, before, after } = require("node:test")
const ts = require("typescript")
const { chromium } = require("playwright-core")
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "comment-media-test-"))
const mediaDir = path.join(tempRoot, "public/uploads/farm-comments")
fs.mkdirSync(mediaDir, { recursive: true })
fs.writeFileSync(path.join(mediaDir, "clip.mp4"), Buffer.from("000000186674797069736f6d", "hex"))
fs.writeFileSync(path.join(mediaDir, "reaction.gif"), Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64"))
const mediaSandbox = { exports: {} }
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, "../src/lib/comment-media.ts"), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, mediaSandbox)
const source = fs.readFileSync(path.join(__dirname, "../src/lib/facebook-page-switch.ts"), "utf8")
const sandbox = { exports: {}, Error, console, process: { ...process, cwd: () => tempRoot }, setTimeout: (callback, ms) => setTimeout(callback, Math.min(ms, 10)),
  require: (name) => name === "@/lib/comment-media" ? mediaSandbox.exports : name.startsWith("@/") ? {} : require(name),
}
vm.runInNewContext(ts.transpileModule(source + "\nexport { attachCommentPhoto, waitForCommentAttachment }", {
  compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 },
}).outputText, sandbox)
const ui = sandbox.exports
let browser
before(async () => { browser = await chromium.launch({ headless: true }) })
after(async () => { await browser?.close(); fs.rmSync(tempRoot, { recursive: true, force: true }) })
async function withPage(html, callback) {
  const page = await browser.newPage()
  await page.route("**/*", (route) => route.fulfill({ contentType: "text/html", body: html }))
  try { await page.goto("https://fixture.test/post"); await callback(page) } finally { await page.close() }
}
const box = '<div contenteditable="true" role="textbox">Comment text</div>'
const preview = '<img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" width="40" height="40">'

for (const filename of ["clip.mp4", "reaction.gif"]) {
  test(`${filename}: upload uses the current composer and waits for an attachment preview`, async () => {
    await withPage(`<input id="background" type="file" accept="image/*,video/*"><form id="composer">${box}<input id="attachment" type="file" accept="image/*,video/*" onchange="this.insertAdjacentHTML('afterend', '${preview.replaceAll('"', '&quot;')}')"></form><input id="avatar" type="file" accept="image/*">`, async (page) => {
      const logs = []
      await ui.attachCommentPhoto(page, page.getByRole("textbox"), `/uploads/farm-comments/${filename}`, (line) => logs.push(line))
      assert.equal(await page.locator("#attachment").evaluate((el) => el.files[0].name), filename)
      assert.equal(await page.locator("#background").evaluate((el) => el.files.length), 0)
      assert.equal(await page.locator("#avatar").evaluate((el) => el.files.length), 0)
      assert.ok(logs.some((line) => line.text.includes("готово к отправке")))
    })
  })
}

test("MP4 is never placed in a photo-only input or an unrelated background uploader", async () => {
  await withPage(`<input id="background" type="file" accept="video/*"><form>${box}<input id="photo" type="file" accept="image/*"></form>`, async (page) => {
    await assert.rejects(ui.attachCommentPhoto(page, page.getByRole("textbox"), "/uploads/farm-comments/clip.mp4", () => {}), /не предлагает подходящую загрузку/)
    assert.equal(await page.locator("#photo").evaluate((el) => el.files.length), 0)
    assert.equal(await page.locator("#background").evaluate((el) => el.files.length), 0)
  })
})

test("a camera file chooser can supply a composer input rendered in a portal", async () => {
  await withPage(`<input id="portal" type="file" accept="image/*,video/*" style="display:none" onchange="document.querySelector('form').insertAdjacentHTML('beforeend', '${preview.replaceAll('"', '&quot;')}')"><form>${box}<button type="button" aria-label="Attach a photo or video" onclick="document.getElementById('portal').click()">Camera</button></form>`, async (page) => {
    await ui.attachCommentPhoto(page, page.getByRole("textbox"), "/uploads/farm-comments/clip.mp4", () => {})
    assert.equal(await page.locator("#portal").evaluate((el) => el.files[0].name), "clip.mp4")
  })
})

test("preparing/uploading must finish even when a preview is already present", async () => {
  await withPage(`<form data-farm-comment-composer="true">${box}${preview}<span id="busy" role="progressbar">Preparing video</span></form>`, async (page) => {
    await page.evaluate(() => setTimeout(() => { document.querySelector("#busy").remove() }, 120))
    await ui.waitForCommentAttachment(page, { timeoutMs: 1000, requirePreview: true })
    assert.equal(await page.locator("#busy").count(), 0)
  })
})

test("an ignored upload, Facebook rejection or a disappeared composer cannot send text alone", async () => {
  for (const [html, error] of [
    [`<form data-farm-comment-composer="true">${box}</form>`, /не загрузилось вовремя/],
    [`<form data-farm-comment-composer="true">${box}<div role="alert">Upload failed</div></form>`, /отклонил/],
    [box, /исчезло/],
  ]) await withPage(html, async (page) => { await assert.rejects(ui.waitForCommentAttachment(page, { timeoutMs: 80, requirePreview: true }), error) })
})

test("a stalled upload times out instead of allowing comment submission", async () => {
  await withPage(`<form data-farm-comment-composer="true">${box}${preview}<span role="progressbar">Processing</span></form>`, async (page) => {
    await assert.rejects(ui.waitForCommentAttachment(page, { timeoutMs: 80, requirePreview: true }), /не загрузилось вовремя/)
  })
})

test("draft text and hidden stale spinners do not become upload errors", async () => {
  await withPage(`<form data-farm-comment-composer="true"><div contenteditable="true">Upload failed while processing yesterday</div>${preview}<span role="progressbar" style="display:none">Uploading</span></form>`, async (page) => {
    await ui.waitForCommentAttachment(page, { timeoutMs: 80, requirePreview: true })
  })
})
