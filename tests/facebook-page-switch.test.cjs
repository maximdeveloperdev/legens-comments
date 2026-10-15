/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict")
const { readFileSync } = require("node:fs")
const path = require("node:path")
const { test, before, after } = require("node:test")
const vm = require("node:vm")
const ts = require("typescript")
const { chromium } = require("playwright-core")

// Exercise the real private browser helpers without loading AdsPower or the DB.
// No requests reach Facebook: every page is fulfilled from a local fixture.
const sourcePath = process.env.FACEBOOK_TEST_SOURCE || path.join(__dirname, "../src/lib/facebook-page-switch.ts")
const source = readFileSync(sourcePath, "utf8")
const helpers = [
  "ensurePostStillOpen", "ensureActingAs", "clickFanRow", "commentAsName",
  "scrollFacebookPostComments", "resetFacebookPostCommentSearch",
  "markReplyButtonForComment", "markCommentLikeButtonForText", "clickVisibleCommentExpansion",
  "preferNewestComments",
]
const compiled = ts.transpileModule(`${source}\nexport { ${helpers.join(", ")} }`, {
  compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const sandbox = {
  exports: {}, process, console,
  setTimeout: (callback, ms) => setTimeout(callback, Math.min(ms, 10)),
  require: (name) => name.startsWith("@/") ? {} : require(name),
}
vm.runInNewContext(compiled, sandbox, { filename: sourcePath })
const ui = sandbox.exports
const postUrl = "https://www.facebook.com/100094647666827/posts/935699659594948/"
const modal = (content) => `<div role="dialog" style="position:fixed;inset:60px 40px;background:white;overflow:hidden"><h2>Camille Bouchard's Post</h2>${content}</div>`
const composer = (name) => `<div role="textbox" contenteditable="true" aria-label="Comment as ${name}" style="height:40px;width:550px"> </div>`
let browser
before(async () => { browser = await chromium.launch({ headless: true }) })
after(async () => { await browser?.close() })

async function withPage(html, callback, url = postUrl) {
  const page = await browser.newPage({ viewport: { width: 780, height: 490 } })
  await page.route("**/*", (route) => route.fulfill({ contentType: "text/html; charset=utf-8", body: html }))
  try {
    await page.goto(url)
    await callback(page)
  } finally { await page.close() }
}

test("keeps the post open above a background feed and media viewer", async () => {
  await withPage(`<main>What's on your mind? Create story This video is from a post <a href="#">View post</a></main>${modal(composer("Maya Wheeler"))}`, async (page) => {
    const navigation = []
    page.on("framenavigated", () => navigation.push(page.url()))
    for (let i = 0; i < 3; i++) await ui.ensurePostStillOpen(page, postUrl, () => {})
    assert.deepEqual(navigation, [], "a valid post must not reload and reset comment search")
  })
})

test("reopens the original post when another post is displayed", async () => {
  await withPage(modal(composer("Maya Wheeler")), async (page) => {
    await ui.ensurePostStillOpen(page, postUrl, () => {})
    assert.equal(page.url(), postUrl)
  }, "https://www.facebook.com/100094647666827/posts/111/")
})

test("accepts the equivalent story_fbid permalink", async () => {
  await withPage(modal(composer("Maya Wheeler")), async (page) => {
    const original = page.url()
    await ui.ensurePostStillOpen(page, postUrl, () => {})
    assert.equal(page.url(), original)
  }, "https://www.facebook.com/permalink.php?story_fbid=935699659594948&id=100094647666827")
})

test("recovers from a feed or media viewer even when the URL still names the original post", async () => {
  await withPage(modal(composer("Maya Wheeler")), async (page) => {
    for (const screen of ["What's on your mind? Create story", "This video is from a post"]) {
      await page.setContent(`<main>${screen}</main>`)
      await ui.ensurePostStillOpen(page, postUrl, () => {})
      assert.equal(await ui.commentAsName(page), "Maya Wheeler")
    }
  })
})

test("detects that a composer selection succeeded before retrying the account switch", async () => {
  const html = modal(`<div style="display:flex;align-items:center"><button style="width:30px;height:30px" onclick="document.getElementById('profiles').style.display='block'"><svg width="16" height="16"></svg></button>${composer("Izabella Kopylova")}</div>`) +
    `<div id="profiles" role="dialog" style="display:none;position:fixed;inset:80px;background:white"><h2>Your profiles & Pages</h2><button onclick="history.pushState({},'', '/reel/123/');document.body.innerHTML='Reels'">Chloé Sebastian</button></div>`
  await withPage(html, async (page) => {
    await page.route(postUrl, (route) => route.fulfill({ contentType: "text/html; charset=utf-8", body: modal(composer("Chloé Sebastian")) }))
    await ui.ensureActingAs(page, "Chloé Sebastian", postUrl, () => {})
    assert.equal(await ui.commentAsName(page), "Chloé Sebastian")
    assert.equal(page.url(), postUrl)
  })
})

test("does not mistake an ordinary post dialog for a profile picker", async () => {
  await withPage(modal('<button onclick="window.wrongClick=true">Chloé Sebastian</button>'), async (page) => {
    assert.equal(await ui.clickFanRow(page, "Chloé Sebastian"), false)
    assert.equal(await page.evaluate(() => Boolean(window.wrongClick)), false)
  })
})

test("selects the requested profile row in the picker", async () => {
  await withPage('<div role="dialog"><h2>Your profiles & Pages</h2><button style="width:700px" onclick="window.selected=true"><span>Chloé Sebastian</span></button></div>', async (page) => {
    assert.equal(await ui.clickFanRow(page, "Chloé Sebastian"), true)
    assert.equal(await page.evaluate(() => window.selected), true)
  })
})

test("does not click through an overlay covering a profile row", async () => {
  await withPage('<div role="dialog"><h2>Your profiles & Pages</h2><button onclick="window.selected=true">Chloé Sebastian</button></div><div style="position:fixed;inset:0;background:white;z-index:20"></div>', async (page) => {
    assert.equal(await ui.clickFanRow(page, "Chloé Sebastian"), false)
    assert.equal(await page.evaluate(() => Boolean(window.selected)), false)
  })
})

test("ignores a hidden stale Comment as label", async () => {
  await withPage(`<div hidden aria-label="Comment as Izabella Kopylova"></div>${composer("Chloé Sebastian")}`, async (page) => {
    assert.equal(await ui.commentAsName(page), "Chloé Sebastian")
  })
})

test("scrolls one comment container by the requested amount without moving the background", async () => {
  const html = '<main style="height:2000px">Feed</main>' + modal('<div id="comments" style="height:260px;overflow-y:auto"><div style="height:3000px">Comments</div></div>')
  await withPage(html, async (page) => {
    await ui.scrollFacebookPostComments(page, 300)
    assert.equal(await page.locator("#comments").evaluate((node) => node.scrollTop), 300)
    assert.equal(await page.evaluate(() => window.scrollY), 0)
    await ui.resetFacebookPostCommentSearch(page)
    assert.equal(await page.locator("#comments").evaluate((node) => node.scrollTop), 0)
  })
})

test("matches Reply and Like when aria-label duplicates the visible text", async () => {
  await withPage(modal('<div><span>Unique parent comment to find</span><div><button aria-label="Like">Like</button><button aria-label="Reply">Reply</button></div></div>'), async (page) => {
    assert.equal(await ui.markReplyButtonForComment(page, "Unique parent comment to find"), true)
    assert.equal(await ui.markCommentLikeButtonForText(page, "Unique parent comment to find"), "ready")
  })
})

test("expands comments instead of clicking an enclosing post or opening sorting", async () => {
  await withPage(modal('<div onclick="if(event.target===this)window.wrongClick=true"><button>Most relevant</button><button onclick="window.expanded=true">View more comments</button></div>'), async (page) => {
    assert.equal(await ui.clickVisibleCommentExpansion(page), true)
    assert.equal(await page.evaluate(() => window.expanded), true)
    assert.equal(await page.evaluate(() => Boolean(window.wrongClick)), false)
  })
})

test("does not dismiss the post when a sorting click fails to open its menu", async () => {
  const html = modal('<div style="margin-top:100px"><button>Most relevant</button></div>') +
    '<script>document.addEventListener("keydown", e => { if(e.key === "Escape") document.querySelector("[role=dialog]")?.remove() })</script>'
  await withPage(html, async (page) => {
    await ui.preferNewestComments(page, () => {})
    assert.equal(await page.locator('[role="dialog"]').count(), 1)
  })
})
