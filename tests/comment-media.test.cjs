/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict")
const { readFileSync } = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const { test } = require("node:test")
const ts = require("typescript")
const sandbox = { exports: {} }
vm.runInNewContext(ts.transpileModule(readFileSync(path.join(__dirname, "../src/lib/comment-media.ts"), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, sandbox)
const media = sandbox.exports

test("supported formats have canonical extensions, including files with no browser MIME", () => {
  for (const [name, type, expected] of [["a.mp4", "video/mp4", "mp4"], ["a.gif", "image/gif", "gif"], ["A.MP4", "", "mp4"], ["A.GIF", "application/octet-stream", "gif"], ["a.jpeg", "image/jpeg", "jpg"]]) {
    assert.equal(media.commentMediaExtension({ name, type }), expected)
    assert.equal(media.commentMediaError({ name, type, size: 1024 }), null)
  }
})

test("GIFs and images are limited to 10 MB; videos to 50 MB", () => {
  const image = { name: "a.gif", type: "image/gif", size: 10 * 1024 * 1024 }
  const video = { name: "a.mp4", type: "video/mp4", size: 50_000_000 }
  assert.ok(media.MAX_COMMENT_VIDEO_SIZE < 50 * 1024 * 1024)
  assert.equal(media.commentMediaError(image), null); assert.equal(media.commentMediaError(video), null)
  assert.match(media.commentMediaError({ ...image, size: image.size + 1 }), /10 МБ/)
  assert.match(media.commentMediaError({ ...video, size: video.size + 1 }), /50 МБ/)
  assert.match(media.commentMediaError({ ...video, size: 0 }), /пустой/)
})

test("unsupported videos, SVGs and disguised documents are rejected", () => {
  for (const [name, type] of [["movie.mov", "video/quicktime"], ["movie.webm", "video/webm"], ["image.svg", "image/svg+xml"], ["document.mp4", "text/html"]]) {
    assert.ok(media.commentMediaError({ name, type, size: 200 }))
  }
})

test("file signatures must match the selected media format", () => {
  for (const [bytes, ext] of [[Buffer.from("000000186674797069736f6d", "hex"), "mp4"], [Buffer.from("GIF89a"), "gif"], [Buffer.from("GIF87a"), "gif"], [Buffer.from("89504e470d0a1a0a", "hex"), "png"], [Buffer.from("ffd8ff", "hex"), "jpg"], [Buffer.from("RIFF1234WEBP"), "webp"]]) {
    assert.equal(media.hasCommentMediaSignature(bytes, ext), true)
    assert.equal(media.hasCommentMediaSignature(Buffer.from("fake media file"), ext), false)
  }
})

test("the Facebook uploader must accept the actual media kind", () => {
  assert.equal(media.acceptsCommentMedia("image/*", "clip.mp4"), false)
  assert.equal(media.acceptsCommentMedia("video/*", "image.gif"), false)
  for (const accept of ["video/*", "video/mp4", "image/*,video/*", ".mp4", ""]) assert.equal(media.acceptsCommentMedia(accept, "clip.mp4"), true)
  assert.equal(media.acceptsCommentMedia("image/*", "image.gif"), true)
  assert.equal(media.commentMediaLabel("/uploads/a.mp4?test=1"), "Видео MP4")
  assert.equal(media.commentMediaLabel("/uploads/a.GIF"), "GIF")
})
