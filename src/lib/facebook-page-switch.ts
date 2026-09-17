import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { chromium, type Browser, type Locator, type Page } from "playwright-core"
import { startAdsPowerBrowser, stopAdsPowerBrowser } from "@/lib/adspower"
import { replaceFacebookFans, type SyncedFan } from "@/lib/facebook-fans"

export type SwitchLogLevel = "info" | "ok" | "error"

export type SwitchLog = {
  level: SwitchLogLevel
  text: string
}

export type SwitchTestResult = {
  ok: boolean
  message: string
}

function pause(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const FACEBOOK_DEBUG_DIR = path.join(process.cwd(), ".debug", "facebook-errors")

const PROFILE_LAYER_RE =
  /your profiles|switch to interact|search profiles|see more profiles|see all profiles|профил|страниц|tw[oó]j profil|profile|przełącz|perfiles|p[aá]ginas|perfis|profili|profilo|profils|seiten/i
const PROFILE_LAYER_RE_SOURCE = PROFILE_LAYER_RE.source
const SEE_ALL_PROFILES_RE =
  /See all profiles|Посмотреть все профили|Показать все профили|Zobacz wszystkie profile|Ver todos los perfiles|Ver todos os perfis|Vedi tutti i profili|Voir tous les profils|Alle Profile ansehen/i
const SEE_MORE_PROFILES_RE =
  /See more profiles|Показать больше профилей|Zobacz więcej|Ver más perfiles|Ver mais perfis|Vedi altri profili|Voir plus de profils|Mehr Profile anzeigen/i
const SEARCH_RE =
  /search|искать|пошук|szukaj|cerca|buscar|pesquisar|rechercher|suchen/i
const COMMENT_RE =
  /comment as|write a comment|write a public comment|напишите комментарий|оставьте комментарий|коммент|написати коментар|skomentuj jako|napisz komentarz|comentar como|escribe un comentario|escrever um comentário|escreva um comentário|commenta come|scrivi un commento|commenter en tant que|écrivez un commentaire|kommentieren als|schreibe einen kommentar/i
const COMMENT_ACTION_RE =
  /^(Comment|Комментарий|Комментировать|Коментар|Skomentuj|Comentar|Commenta|Commenter|Kommentieren)$/i
const COOKIE_ACCEPT_RE =
  /Allow all cookies|Accept all|Allow essential and optional cookies|Разрешить все|Принять все|Zezw[oó]l na wszystkie|Akceptuj wszystkie|Permitir todas|Aceptar todas|Aceitar todos|Consenti tutti|Accetta tutti|Autoriser tous|Tout accepter|Alle Cookies erlauben|Alle akzeptieren/i

type DomFan = {
  name: string
  current: boolean
}

function safeFilePart(value: string) {
  return value.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "facebook"
}

async function saveFailureArtifact(
  page: Page | undefined,
  options: { profileId: string; phase: string; message: string },
  log: (line: SwitchLog) => void,
) {
  if (!page) return
  try {
    await mkdir(FACEBOOK_DEBUG_DIR, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, "-")
    const base = `${stamp}-${safeFilePart(options.profileId)}-${safeFilePart(options.phase)}`
    const screenshotPath = path.join(FACEBOOK_DEBUG_DIR, `${base}.png`)
    const htmlPath = path.join(FACEBOOK_DEBUG_DIR, `${base}.html`)
    await page.screenshot({ path: screenshotPath, fullPage: false, timeout: 6000 }).catch(() => undefined)
    const html = await page.content().catch(() => "")
    if (html) {
      await writeFile(
        htmlPath,
        `<!-- ${options.message.replace(/-->/g, "-- >")} -->\n${html.slice(0, 2_000_000)}`,
      )
    }
    log({ level: "info", text: `Debug сохранён: ${screenshotPath}` })
  } catch {
    // Debug artifacts must never mask the original Facebook error.
  }
}

function fansFromProfilesDialog() {
  return () => {
    const isVisible = (el: Element) => {
      const box = (el as HTMLElement).getBoundingClientRect()
      const style = getComputedStyle(el)
      return (
        box.width > 80 &&
        box.height > 80 &&
        box.bottom > 0 &&
        box.right > 0 &&
        box.top < innerHeight &&
        box.left < innerWidth &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number(style.opacity || "1") > 0
      )
    }
    const noise =
      /^(see more profiles|see all profiles|search profiles and pages|search profiles|your profiles(?:\s*&\s*pages)?|показать больше|посмотреть все|искать|пошук|zobacz więcej|zobacz wszystkie|szukaj|cerca|buscar|pesquisar|rechercher|suchen|zamknij|close|закрыть|cerrar|fechar|chiudi|fermer|schließen|\d+\s+notifications?)$/i

    const profileLayerRe =
      /your profiles|switch to interact|search profiles|see more profiles|see all profiles|профил|страниц|tw[oó]j profil|profile|przełącz|perfiles|p[aá]ginas|perfis|profili|profilo|profils|seiten/i
    const layers = [...document.querySelectorAll('[role="dialog"], [role="menu"], [aria-modal="true"]')]
      .filter(isVisible)
      .filter((node) =>
        profileLayerRe.test(
          `${node.getAttribute("aria-label") || ""} ${(node as HTMLElement).innerText || ""}`,
        ),
      ) as HTMLElement[]
    const dialog = layers
      .map((node) => ({
        node,
        fans: [...node.querySelectorAll("img, image")].filter((img) => {
          const photo = img.getBoundingClientRect()
          return photo.width >= 24 && photo.height >= 24 && photo.width <= 88
        }).length,
      }))
      .sort((left, right) => right.fans - left.fans)[0]?.node
    if (!dialog) return [] as DomFan[]

    const fans: DomFan[] = []
    for (const img of dialog.querySelectorAll("img, image")) {
      const photo = img.getBoundingClientRect()
      if (photo.width < 24 || photo.height < 24 || photo.width > 88) continue
      let node: HTMLElement | null = img.parentElement
      let name = ""
      let current = false
      for (let depth = 0; depth < 8 && node && node !== dialog; depth += 1, node = node.parentElement) {
        if (
          node.getAttribute("aria-checked") === "true" ||
          node.querySelector('[aria-checked="true"]')
        ) {
          current = true
        }
        const lines = (node.innerText || "")
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
        const candidate = lines.find((line) => line.length >= 2 && line.length <= 80 && !noise.test(line))
        if (candidate) {
          name = candidate
          break
        }
      }
      if (!name || noise.test(name) || fans.some((fan) => fan.name === name)) continue
      fans.push({ name, current })
    }
    return fans
  }
}

async function visible(locator: Locator) {
  try {
    return await locator.isVisible()
  } catch {
    return false
  }
}

async function forceClick(locator: Locator, timeoutMs = 4000) {
  const target = locator.first()
  try {
    await target.waitFor({ state: "attached", timeout: timeoutMs })
  } catch {
    return false
  }
  try {
    await target.click({ timeout: Math.min(timeoutMs, 2500) })
    return true
  } catch {
    try {
      await target.click({ force: true, timeout: timeoutMs })
      return true
    } catch {
      return target
        .evaluate((el: HTMLElement) => {
          const clickable = el.closest(
            "a,button,[role='button'],[role='radio'],[role='menuitem'],[tabindex]",
          ) as HTMLElement | null
          ;(clickable || el).click()
        })
        .then(() => true)
        .catch(() => false)
    }
  }
}

async function clickIfVisible(locator: Locator, timeoutMs = 2500) {
  try {
    await locator.first().waitFor({ state: "visible", timeout: timeoutMs })
    return forceClick(locator, timeoutMs)
  } catch {
    return false
  }
}

async function dismissOverlays(page: Page) {
  for (let step = 0; step < 4; step += 1) {
    const open = page.locator('[role="dialog"], [role="menu"]').filter({
      hasText: PROFILE_LAYER_RE,
    })
    if (!(await visible(open.first()))) break
    await page.keyboard.press("Escape").catch(() => undefined)
    await pause(250)
  }
  await page.keyboard.press("Escape").catch(() => undefined)
}

async function dismissCookies(page: Page, log: (line: SwitchLog) => void) {
  const buttons = [
    page.getByRole("button", { name: COOKIE_ACCEPT_RE }),
  ]
  for (const button of buttons) {
    if (await clickIfVisible(button, 1500)) {
      log({ level: "ok", text: "Закрыли cookie-баннер" })
      await pause(800)
      return
    }
  }
}

async function openAccountSwitcher(page: Page, log: (line: SwitchLog) => void) {
  const triggers = [
    page.getByRole("button", { name: /^Your profile$/i }),
    page.getByRole("button", { name: /^Account$/i }),
    page.getByLabel("Your profile"),
    page.getByLabel("Account"),
    page.getByLabel("Ваш профиль"),
    page.getByLabel("Аккаунт"),
    page.locator('[aria-label="Your profile"]'),
    page.locator('[aria-label="Account"]'),
    page.locator('[role="banner"] [aria-haspopup="menu"]').last(),
  ]

  for (const trigger of triggers) {
    if (await clickIfVisible(trigger, 2500)) {
      log({ level: "ok", text: "Открыли меню аккаунта" })
      await pause(900)
      return true
    }
  }

  const bannerButtons = page.locator('[role="banner"] [role="button"]')
  const count = await bannerButtons.count()
  if (count > 0) {
    await bannerButtons.nth(count - 1).click({ timeout: 4000 })
    log({ level: "ok", text: "Открыли меню по аватарке справа" })
    await pause(900)
    return true
  }

  return false
}

function switcherRoot(page: Page) {
  return page
    .locator('[role="dialog"], [role="menu"]')
    .filter({ hasText: SEE_ALL_PROFILES_RE })
    .last()
}

function profilesDialog(page: Page) {
  return page.locator('[role="dialog"]:visible, [role="menu"]:visible, [aria-modal="true"]:visible').filter({
    hasText: PROFILE_LAYER_RE,
  })
}

async function waitForProfilesLayer(page: Page, timeoutMs = 12_000) {
  await page.waitForFunction(
    (source) => {
      const profileLayerRe = new RegExp(source, "i")
      const isVisible = (el: Element) => {
        const box = (el as HTMLElement).getBoundingClientRect()
        const style = getComputedStyle(el)
        return (
          box.width > 80 &&
          box.height > 80 &&
          box.bottom > 0 &&
          box.right > 0 &&
          box.top < innerHeight &&
          box.left < innerWidth &&
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number(style.opacity || "1") > 0
        )
      }
      return [...document.querySelectorAll('[role="dialog"], [role="menu"], [aria-modal="true"]')].some((node) => {
        if (!isVisible(node)) return false
        const text = `${node.getAttribute("aria-label") || ""} ${(node as HTMLElement).innerText || ""}`
        return profileLayerRe.test(text)
      })
    },
    PROFILE_LAYER_RE_SOURCE,
    { timeout: timeoutMs },
  )
}

async function openAllProfilesDialog(page: Page, log: (line: SwitchLog) => void) {
  const opened =
    (await clickIfVisible(
      page.getByRole("button", { name: SEE_ALL_PROFILES_RE }),
      5000,
    )) ||
    (await clickIfVisible(page.getByRole("menuitem", { name: SEE_ALL_PROFILES_RE }), 3000)) ||
    (await clickIfVisible(page.getByText(SEE_ALL_PROFILES_RE), 3000))
  if (!opened) {
    throw new Error("Не нашли кнопку «Показать все профили»")
  }
  log({ level: "ok", text: "Нажали «Показать все профили»" })
  await waitForProfilesLayer(page)
  await pause(800)
}

async function scrollProfilesDialog(page: Page) {
  await scrollOpenLayer(page)
}

async function clickSeeMoreProfiles(page: Page) {
  const more = page.getByRole("button", {
    name: SEE_MORE_PROFILES_RE,
  })
  if (!(await visible(more))) return false
  await more.last().scrollIntoViewIfNeeded().catch(() => undefined)
  return clickIfVisible(more, 4000)
}

async function scrapeFans(page: Page, log: (line: SwitchLog) => void): Promise<SyncedFan[]> {
  await page
    .getByText(SEE_ALL_PROFILES_RE)
    .first()
    .waitFor({ state: "visible", timeout: 8000 })
  await openAllProfilesDialog(page, log)

  const names = new Map<string, DomFan>()
  let stable = 0
  let lastCount = -1
  for (let step = 1; step <= 60; step += 1) {
    const batch = await page.evaluate(fansFromProfilesDialog())
    for (const fan of batch) names.set(fan.name, fan)
    if (names.size !== lastCount) {
      log({ level: "info", text: `В списке ${names.size} фанок` })
      lastCount = names.size
    }

    const clickedMore = await clickSeeMoreProfiles(page)
    if (clickedMore) {
      log({ level: "ok", text: "Ещё порция профилей" })
      await pause(900)
      stable = 0
      continue
    }

    const before = names.size
    await scrollProfilesDialog(page)
    await pause(700)
    const afterBatch = await page.evaluate(fansFromProfilesDialog())
    for (const fan of afterBatch) names.set(fan.name, fan)
    if (names.size === before) {
      stable += 1
      if (stable >= 2) break
    } else {
      stable = 0
    }
  }

  const fans = [...names.values()].map((fan, position) => ({
    name: fan.name,
    position,
    current: fan.current,
  }))
  if (fans.length > 0 && !fans.some((fan) => fan.current)) {
    fans[0].current = true
  }
  log({
    level: fans.length > 0 ? "ok" : "info",
    text: `Собрали ${fans.length} фанок: ${fans.map((fan) => fan.name).slice(0, 12).join(" · ")}${
      fans.length > 12 ? "…" : ""
    }`,
  })
  return fans
}

function identityOverlay(page: Page) {
  return page.locator('[role="dialog"], [role="menu"], [role="listbox"], [aria-modal="true"]').filter({
    hasText: PROFILE_LAYER_RE,
  })
}

function onScreenBox(box: { x: number; y: number; width: number; height: number } | null) {
  if (!box) return false
  return box.width >= 20 && box.height >= 14 && box.x >= 0 && box.y >= 0 && box.y < 1400
}

async function clickAt(page: Page, point: { x: number; y: number } | null | undefined) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return false
  await page.mouse.move(point.x, point.y)
  await pause(160)
  await page.mouse.down()
  await pause(60)
  await page.mouse.up()
  return true
}

function isDestroyed(error: unknown) {
  return /Execution context was destroyed|Target closed|frame was detached|navigation/i.test(
    error instanceof Error ? error.message : String(error),
  )
}

async function afterPossibleNav(page: Page, postUrl: string | undefined, log: (line: SwitchLog) => void) {
  await page.waitForLoadState("domcontentloaded", { timeout: 30_000 }).catch(() => undefined)
  await pause(1500)
  if (postUrl && !/\/posts\/|story_fbid|permalink|photo\.php/i.test(page.url())) {
    log({ level: "info", text: "После клика Facebook ушёл со поста — открываем снова" })
    await page.goto(postUrl, { waitUntil: "load", timeout: 60_000 })
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => undefined)
    await pause(1500)
  }
}

async function describeOpenLayers(page: Page) {
  try {
    return await page.evaluate(() => {
      const vis = (el: Element) => {
        const r = (el as HTMLElement).getBoundingClientRect()
        const style = getComputedStyle(el)
        return r.width > 16 && r.height > 16 && style.visibility !== "hidden" && style.display !== "none"
      }
      const sampleOf = (el: Element) =>
        `${el.getAttribute("aria-label") || ""} ${(el as HTMLElement).innerText || ""}`.slice(0, 600)
      const profileLayerRe =
        /your profiles|switch to interact|search profiles|see more profiles|see all profiles|профил|страниц|tw[oó]j profil|profile|przełącz|perfiles|p[aá]ginas|perfis|profili|profilo|profils|seiten/i
      const isIdentity = (el: Element) =>
        profileLayerRe.test(sampleOf(el)) ||
        Boolean(el.querySelector('[role="radio"], [role="menuitemradio"]'))
      const isPostChrome = (el: Element) => {
        if (isIdentity(el)) return false
        const sample = sampleOf(el)
        const r = (el as HTMLElement).getBoundingClientRect()
        return (
          (/'s Post|Most relevant|See details/i.test(sample) && r.height > 240) ||
          (r.width > innerWidth * 0.72 && r.height > innerHeight * 0.45)
        )
      }
      const picked = [
        ...document.querySelectorAll(
          '[role="dialog"], [role="menu"], [role="listbox"], [role="radiogroup"], [aria-modal="true"]',
        ),
      ]
        .filter(vis)
        .filter((el) => {
          const role = el.getAttribute("role")
          return (
            !isPostChrome(el) ||
            role === "menu" ||
            role === "listbox" ||
            role === "radiogroup" ||
            isIdentity(el)
          )
        })
      const extra: Element[] = []
      for (const radio of [...document.querySelectorAll('[role="radio"], [role="menuitemradio"]')].filter(vis)) {
        if (picked.some((layer) => layer.contains(radio))) continue
        const host = (radio.closest(
          '[role="dialog"], [role="menu"], [role="listbox"], [role="group"], [role="radiogroup"]',
        ) || radio.parentElement) as HTMLElement | null
        if (host && vis(host) && !picked.includes(host) && !extra.includes(host)) extra.push(host)
      }
      if (picked.length + extra.length === 0) {
        for (const el of document.querySelectorAll(
          '[data-visualcompletion="ignore-dynamic"], [style*="position: absolute"], [style*="position:absolute"], [style*="position: fixed"]',
        )) {
          if (!vis(el) || extra.includes(el)) continue
          const r = (el as HTMLElement).getBoundingClientRect()
          if (r.width < 180 || r.width > 560 || r.height < 80 || r.height > innerHeight * 0.9) continue
          if (!isIdentity(el)) continue
          extra.push(el)
        }
      }
      return [...picked, ...extra]
        .map((el) => `${el.getAttribute("role") || "layer"}: ${(el as HTMLElement).innerText || ""}`.replace(/\s+/g, " ").trim().slice(0, 220))
        .filter(Boolean)
        .slice(0, 4)
    })
  } catch (error) {
    if (isDestroyed(error)) return ["navigation"]
    throw error
  }
}

async function findComposerCaret(page: Page) {
  return page.evaluate(() => {
    const commentRe =
      /comment as|write a comment|write a public comment|напишите комментарий|оставьте комментарий|коммент|написати коментар|skomentuj jako|napisz komentarz|comentar como|escribe un comentario|escrever um comentário|escreva um comentário|commenta come|scrivi un commento|commenter en tant que|écrivez un commentaire|kommentieren als|schreibe einen kommentar/i
    const box = [...document.querySelectorAll('[role="textbox"], [contenteditable="true"]')].find((el) =>
      commentRe.test(
        `${el.getAttribute("aria-label") || ""} ${el.getAttribute("aria-placeholder") || ""} ${el.getAttribute("placeholder") || ""}`,
      ),
    ) as HTMLElement | undefined
    if (!box) return null
    const boxRect = box.getBoundingClientRect()
    const candidates: Array<{ el: HTMLElement; rect: DOMRect; hasImg: boolean }> = []
    let root: HTMLElement | null = box.parentElement
    for (let depth = 0; depth < 12 && root; depth += 1, root = root.parentElement) {
      const buttons = [...root.querySelectorAll('button, [role="button"], [tabindex="0"]')] as HTMLElement[]
      for (const button of buttons) {
        if (button.contains(box) || box.contains(button)) continue
        if (!button.querySelector("img, image, svg")) continue
        const rect = button.getBoundingClientRect()
        if (rect.width < 10 || rect.height < 10 || rect.width > 96) continue
        const leftOfBox = rect.right <= boxRect.left + 22
        const nearVertically = Math.abs(rect.top - boxRect.top) < 52
        if (!(leftOfBox && nearVertically)) continue
        if (candidates.some((item) => item.el === button)) continue
        candidates.push({
          el: button,
          rect,
          hasImg: Boolean(button.querySelector("img, image")),
        })
      }
    }
    if (candidates.length === 0) return null

    const chevronBtn = candidates.find((item) => item.rect.width <= 28 && !item.hasImg)
    if (chevronBtn) {
      return { x: chevronBtn.rect.x + chevronBtn.rect.width / 2, y: chevronBtn.rect.y + chevronBtn.rect.height / 2 }
    }

    const avatar = candidates.find((item) => item.hasImg) || candidates[0]
    const icons = [...avatar.el.querySelectorAll("svg")]
    for (const icon of icons) {
      const ir = icon.getBoundingClientRect()
      if (ir.width < 6 || ir.height < 6 || ir.width > 22 || ir.height > 22) continue
      if (ir.right > avatar.rect.x + avatar.rect.width * 0.45 && ir.bottom > avatar.rect.y + avatar.rect.height * 0.45) {
        return { x: ir.x + ir.width / 2, y: ir.y + ir.height / 2 }
      }
    }
    return { x: avatar.rect.right - 6, y: avatar.rect.bottom - 6 }
  })
}

async function findNamePoint(page: Page, name: string) {
  try {
    return await page.evaluate((target) => {
      const want = target.toLowerCase().replace(/\s+/g, " ").trim()
      const vis = (el: Element) => {
        const r = (el as HTMLElement).getBoundingClientRect()
        const style = getComputedStyle(el)
        return r.width > 8 && r.height > 8 && style.visibility !== "hidden" && style.display !== "none" && r.bottom > 0 && r.top < innerHeight
      }
      const sampleOf = (el: Element) =>
        `${el.getAttribute("aria-label") || ""} ${(el as HTMLElement).innerText || ""}`.slice(0, 600)
      const profileLayerRe =
        /your profiles|switch to interact|search profiles|see more profiles|see all profiles|профил|страниц|tw[oó]j profil|profile|przełącz|perfiles|p[aá]ginas|perfis|profili|profilo|profils|seiten/i
      const isIdentity = (el: Element) =>
        profileLayerRe.test(sampleOf(el)) ||
        Boolean(el.querySelector('[role="radio"], [role="menuitemradio"]'))
      const isPostChrome = (el: Element) => {
        if (isIdentity(el)) return false
        const sample = sampleOf(el)
        const r = (el as HTMLElement).getBoundingClientRect()
        return (/'s Post|Most relevant|See details/i.test(sample) && r.height > 240) || (r.width > innerWidth * 0.72 && r.height > innerHeight * 0.45)
      }
      const all = [...document.querySelectorAll('[role="dialog"], [role="menu"], [role="listbox"], [role="radiogroup"], [role="grid"], [aria-modal="true"]')].filter(vis)
      const roots: HTMLElement[] = []
      for (const el of all) {
        const role = el.getAttribute("role")
        if (role === "menu" || role === "listbox" || role === "radiogroup" || isIdentity(el)) roots.push(el as HTMLElement)
        else if (!isPostChrome(el)) roots.push(el as HTMLElement)
        else roots.push(...([...el.querySelectorAll('[role="menu"], [role="listbox"], [role="radiogroup"]')].filter(vis) as HTMLElement[]))
      }
      const lineMatches = (text: string) => {
        const value = text.toLowerCase().replace(/\s+/g, " ").trim()
        return value === want || value.startsWith(`${want} `)
      }
      for (const root of [...new Set(roots)]) {
        const labels = [...root.querySelectorAll("span, div, [role='radio'], [role='menuitemradio'], [role='menuitem']")] as HTMLElement[]
        for (const node of labels) {
          const text = (node.innerText || node.textContent || "").replace(/\s+/g, " ").trim()
          if (!lineMatches(text) && !lineMatches((node.getAttribute("aria-label") || "").trim())) continue
          const rect = node.getBoundingClientRect()
          if (rect.width < 20 || rect.height < 12 || rect.top < 0 || rect.top > innerHeight) continue
          return { x: rect.x + Math.min(28, rect.width / 2), y: rect.y + rect.height / 2 }
        }
        for (const img of root.querySelectorAll("img, image")) {
          const photo = img.getBoundingClientRect()
          if (photo.width < 16 || photo.height < 16) continue
          let node: HTMLElement | null = img.parentElement
          for (let depth = 0; depth < 12 && node && node !== root; depth += 1, node = node.parentElement) {
            const lines = (node.innerText || "")
              .split("\n")
              .map((line) => line.trim())
              .filter(Boolean)
            if (lines.length === 0 || lines.length > 8) continue
            if (!lines.some((line) => lineMatches(line))) continue
            const rect = node.getBoundingClientRect()
            if (rect.width < 20 || rect.height < 12 || rect.top < 0 || rect.top > innerHeight) continue
            return { x: rect.x + Math.min(36, rect.width / 2), y: rect.y + rect.height / 2 }
          }
        }
      }
      return null
    }, name)
  } catch (error) {
    if (isDestroyed(error)) return null
    throw error
  }
}

async function findSearchPoint(page: Page) {
  try {
    return await page.evaluate(() => {
      const vis = (el: Element) => {
        const r = (el as HTMLElement).getBoundingClientRect()
        const style = getComputedStyle(el)
        return r.width > 24 && r.height > 16 && style.visibility !== "hidden" && style.display !== "none"
      }
      const sampleOf = (el: Element) =>
        `${el.getAttribute("aria-label") || ""} ${(el as HTMLElement).innerText || ""}`.slice(0, 600)
      const profileLayerRe =
        /your profiles|switch to interact|search profiles|see more profiles|see all profiles|профил|страниц|tw[oó]j profil|profile|przełącz|perfiles|p[aá]ginas|perfis|profili|profilo|profils|seiten/i
      const commentRe =
        /comment as|write a comment|write a public comment|напишите комментарий|оставьте комментарий|коммент|написати коментар|skomentuj jako|napisz komentarz|comentar como|escribe un comentario|escrever um comentário|escreva um comentário|commenta come|scrivi un commento|commenter en tant que|écrivez un commentaire|kommentieren als|schreibe einen kommentar/i
      const searchRe = /search|искать|пошук|szukaj|cerca|buscar|pesquisar|rechercher|suchen/i
      const isIdentity = (el: Element) =>
        profileLayerRe.test(sampleOf(el)) ||
        Boolean(el.querySelector('[role="radio"], [role="menuitemradio"]'))
      const isPostChrome = (el: Element) => {
        if (isIdentity(el)) return false
        const sample = sampleOf(el)
        const r = (el as HTMLElement).getBoundingClientRect()
        return (/'s Post|Most relevant|See details/i.test(sample) && r.height > 240) || (r.width > innerWidth * 0.72 && r.height > innerHeight * 0.45)
      }
      const layers = [
        ...document.querySelectorAll('[role="dialog"], [role="menu"], [role="listbox"], [aria-modal="true"]'),
      ]
        .filter(vis)
        .filter((el) => isIdentity(el) || !isPostChrome(el) || el.getAttribute("role") === "menu" || el.getAttribute("role") === "listbox") as HTMLElement[]
      for (const layer of layers) {
        const candidates = [
          ...layer.querySelectorAll(
            'input, textarea, [role="combobox"], [role="textbox"], [contenteditable="true"]',
          ),
        ] as HTMLElement[]
        for (const input of candidates) {
          const label = `${input.getAttribute("aria-label") || ""} ${input.getAttribute("placeholder") || ""} ${input.getAttribute("aria-placeholder") || ""}`
          const isComment = commentRe.test(label)
          if (isComment) continue
          if (!searchRe.test(label) && input.tagName !== "INPUT" && input.getAttribute("role") !== "combobox") continue
          const box = input.getBoundingClientRect()
          if (box.width < 40 || box.height < 12 || box.top < 0 || box.top > innerHeight) continue
          return { x: box.x + Math.min(40, box.width / 2), y: box.y + box.height / 2 }
        }
      }
      return null
    })
  } catch (error) {
    if (isDestroyed(error)) return null
    throw error
  }
}

async function scrollOpenLayer(page: Page) {
  try {
    await page.evaluate(() => {
      const vis = (el: Element) => {
        const r = (el as HTMLElement).getBoundingClientRect()
        return r.width > 24 && r.height > 24
      }
      const isPostChrome = (el: Element) => {
        const sample = `${el.getAttribute("aria-label") || ""} ${(el as HTMLElement).innerText || ""}`.slice(0, 600)
        const r = (el as HTMLElement).getBoundingClientRect()
        return (/'s Post|Most relevant|See details/i.test(sample) && r.height > 240) || (r.width > innerWidth * 0.72 && r.height > innerHeight * 0.45)
      }
      const layers = [...document.querySelectorAll('[role="dialog"], [role="menu"], [role="listbox"], [aria-modal="true"]')]
        .filter(vis)
        .filter((el) => !isPostChrome(el) || el.getAttribute("role") === "menu" || el.getAttribute("role") === "listbox") as HTMLElement[]
      for (const layer of layers) {
        const scrollable = [...layer.querySelectorAll("div")].find((node) => node.scrollHeight > node.clientHeight + 40)
        const target = scrollable || layer
        target.scrollTop += Math.max(240, Math.min(target.clientHeight, 320))
      }
    })
  } catch (error) {
    if (!isDestroyed(error)) throw error
  }
}

async function typeFanSearch(page: Page, name: string, log: (line: SwitchLog) => void) {
  let point = await findSearchPoint(page)
  if (!point) {
    const overlay = identityOverlay(page).last()
    const search = overlay
      .getByRole("textbox", { name: SEARCH_RE })
      .or(overlay.getByRole("combobox", { name: SEARCH_RE }))
      .or(overlay.getByPlaceholder(SEARCH_RE))
      .or(overlay.locator('input[type="search"], input[type="text"]'))
    if (await visible(search.first())) {
      const box = await search.first().boundingBox()
      if (onScreenBox(box) && box) {
        point = { x: box.x + Math.min(40, box.width / 2), y: box.y + box.height / 2 }
      }
    }
  }
  if (!point) {
    log({ level: "info", text: "В меню нет поля поиска — листаем список" })
    return false
  }
  await clickAt(page, point)
  await pause(200)
  await page.keyboard.press("Meta+A").catch(() => undefined)
  await page.keyboard.press("Control+A").catch(() => undefined)
  await page.keyboard.press("Backspace").catch(() => undefined)
  await page.keyboard.type(name, { delay: 40 })
  await pause(1100)
  log({ level: "info", text: `Ищем «${name}» в списке профилей` })
  return true
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function sameFan(left: string, right: string) {
  const n = (value: string) => value.toLowerCase().replace(/\s+/g, " ").trim()
  const a = n(left)
  const b = n(right)
  if (!a || !b) return false
  return a === b || a.startsWith(`${b} `) || b.startsWith(`${a} `)
}

async function clickFanRow(page: Page, name: string) {
  const point = await findNamePoint(page, name)
  if (point && (await clickAt(page, point))) return true

  const exact = new RegExp(`^${escapeRegex(name)}$`, "i")
  const overlay = identityOverlay(page).last()
  const fallbacks = [
    overlay.getByRole("radio", { name: exact }),
    overlay.getByRole("menuitemradio", { name: exact }),
    overlay.getByRole("menuitem", { name: exact }),
    overlay.getByText(name, { exact: true }),
  ]
  for (const locator of fallbacks) {
    const target = locator.first()
    if (!(await visible(target))) continue
    const box = await target.boundingBox()
    if (!onScreenBox(box) || !box) continue
    if (await clickAt(page, { x: box.x + Math.min(28, box.width / 2), y: box.y + box.height / 2 })) {
      return true
    }
  }
  return false
}

async function clickNamedFan(page: Page, name: string, log: (line: SwitchLog) => void) {
  const searched = await typeFanSearch(page, name, log)
  if (searched && (await clickFanRow(page, name))) return

  for (let step = 0; step < 40; step += 1) {
    if (await clickFanRow(page, name)) return
    const more = await clickSeeMoreProfiles(page)
    await scrollProfilesDialog(page)
    await pause(600)
    if (!more && step > 6) break
  }

  if (await clickFanRow(page, name)) return
  const layers = await describeOpenLayers(page)
  throw new Error(
    `Не удалось кликнуть фанку «${name}»${layers[0] ? ` · меню: ${layers[0]}` : ""}`,
  )
}

async function ensureSwitcherOpen(page: Page, log: (line: SwitchLog) => void) {
  if (await visible(switcherRoot(page))) {
    log({ level: "ok", text: "Меню профилей уже открыто" })
    return
  }
  const opened = await openAccountSwitcher(page, log)
  if (!opened) {
    throw new Error("Не нашли кнопку профиля справа вверху")
  }
}

function disconnectBrowser(browser?: Browser) {
  try {
    void browser?.close().catch(() => undefined)
  } catch {
    // already gone
  }
}

function isAdsPowerStartError(message: string) {
  return /порт отладки|запустить|запустити|Failed to start|не вдалося|не удалось запустить|AdsPower не|100001/i.test(
    message,
  )
}

async function waitForFacebookReady(page: Page, log: (line: SwitchLog) => void) {
  const login = page.locator('#email, input[name="email"], input[name="pass"]')
  const markers = [
    page.getByRole("button", { name: /^Your profile$/i }),
    page.getByRole("button", { name: /^Account$/i }),
    page.getByRole("button", { name: /^Ваш профиль$/i }),
    page.getByRole("button", { name: /^Аккаунт$/i }),
    page.getByRole("button", { name: /^Twój profil$/i }),
    page.getByRole("button", { name: /^Konto$/i }),
    page.getByRole("button", { name: /^Tu perfil$/i }),
    page.getByRole("button", { name: /^Cuenta$/i }),
    page.getByLabel("Your profile"),
    page.getByLabel("Account"),
    page.getByLabel("Ваш профиль"),
    page.getByLabel("Аккаунт"),
    page.getByLabel("Twój profil"),
    page.getByLabel("Konto"),
    page.getByLabel("Tu perfil"),
    page.getByLabel("Cuenta"),
    page.locator('[aria-label="Your profile"]'),
    page.locator('[aria-label="Account"]'),
    page.getByRole("banner"),
    page.getByRole("main"),
    page.getByRole("navigation"),
    page.locator('[role="feed"]'),
  ]

  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (await visible(login.first())) {
      throw new Error("Facebook просит логин — в этом профиле нет сессии")
    }
    for (const marker of markers) {
      if (await visible(marker.first())) return
    }
    await pause(500)
  }

  if (await visible(login.first())) {
    throw new Error("Facebook просит логин — в этом профиле нет сессии")
  }
  if (/facebook\.com|fb\.com/i.test(page.url())) {
    log({
      level: "info",
      text: "Шапка Facebook скрыта, но сессия есть — продолжаем",
    })
    return
  }
  throw new Error("Facebook не загрузился")
}

async function openFacebookPage(profileId: string, log: (line: SwitchLog) => void) {
  log({
    level: "info",
    text: `Запускаем профиль AdsPower ${profileId} без окна`,
  })
  const started = await startAdsPowerBrowser(profileId)
  if (!started.ok) {
    throw new Error(started.message)
  }

  const cdp = started.browserWs || (started.debugPort ? `http://127.0.0.1:${started.debugPort}` : "")
  if (!cdp) {
    throw new Error("Профиль открыт, но AdsPower не отдал порт отладки")
  }

  log({
    level: "ok",
    text: `Запущен без окна${started.debugPort ? `, порт отладки ${started.debugPort}` : ""}`,
  })

  const browser = await chromium.connectOverCDP(cdp, { timeout: 20_000 })
  const context = browser.contexts()[0]
  if (!context) {
    disconnectBrowser(browser)
    throw new Error("В профиле нет browser context")
  }

  const page =
    context.pages().find((item) => /facebook\.com|fb\.com/i.test(item.url())) ||
    context.pages()[0] ||
    (await context.newPage())

  await page.bringToFront()
  log({ level: "info", text: "Открываем Facebook" })
  await page.goto("https://www.facebook.com/", {
    waitUntil: "load",
    timeout: 60_000,
  })
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => undefined)
  await dismissCookies(page, log)
  await waitForFacebookReady(page, log)
  await pause(2000)
  log({ level: "ok", text: `Facebook загрузился: ${page.url()}` })

  return { page, browser }
}

export type CapturedFacebookPost = {
  url: string
  text: string
  hasText: boolean
  hasImage: boolean
  screenshotJpeg?: string
}

export async function captureFacebookPost(
  input: { profileId: string; url: string },
  onLog: (line: SwitchLog) => void,
): Promise<CapturedFacebookPost> {
  let browser: Browser | undefined
  try {
    const opened = await openFacebookPage(input.profileId, onLog)
    browser = opened.browser
    const page = opened.page

    onLog({ level: "info", text: `Открываем пост ${input.url}` })
    await page.goto(input.url, { waitUntil: "load", timeout: 60_000 })
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => undefined)
    await pause(2500)
    await dismissCookies(page, onLog)

    const extracted = await page.evaluate(() => {
      const noise =
        /^(like|love|comment|share|follow|following|see more|see original|log in|sign up|public|nella tua lingua|translate|нравится|комментарий|поделиться|подписаться|ещё)$/i
      const dialogs = [...document.querySelectorAll('[role="dialog"]')] as HTMLElement[]
      const scored = dialogs
        .map((node) => {
          const box = node.getBoundingClientRect()
          const text = node.innerText || ""
          const postLike = /comment as|leave a comment|what's on your mind|post/i.test(text)
          return { node, area: box.width * box.height, postLike }
        })
        .filter((item) => item.area > 40_000)
        .sort((left, right) => Number(right.postLike) - Number(left.postLike) || right.area - left.area)
      const article = document.querySelector('[role="article"]') as HTMLElement | null
      const root = scored[0]?.node || article || document.body
      const lines = (root.innerText || "")
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 1 && line.length < 280 && !noise.test(line))
      const text = [...new Set(lines)].slice(0, 36).join("\n")
      const images = [...root.querySelectorAll("img")].filter((img) => {
        const box = img.getBoundingClientRect()
        return box.width >= 90 && box.height >= 90
      })
      const box = root.getBoundingClientRect()
      return {
        text,
        hasImage: images.length > 0,
        box: { x: box.x, y: box.y, width: box.width, height: box.height },
      }
    })

    const viewport = page.viewportSize() || { width: 1280, height: 900 }
    const raw = extracted.box
    const clip = {
      x: Math.max(0, Math.floor(raw.x)),
      y: Math.max(0, Math.floor(raw.y)),
      width: Math.max(1, Math.min(Math.floor(raw.width), viewport.width)),
      height: Math.max(1, Math.min(Math.floor(raw.height), viewport.height)),
    }
    clip.width = Math.max(1, Math.min(clip.width, viewport.width - clip.x))
    clip.height = Math.max(1, Math.min(clip.height, viewport.height - clip.y))
    if (clip.width < 80 || clip.height < 80) {
      clip.x = 0
      clip.y = 0
      clip.width = viewport.width
      clip.height = viewport.height
    }

    const shot = await page.screenshot({
      type: "jpeg",
      quality: 52,
      clip,
      timeout: 12_000,
    })

    const text = extracted.text.trim()
    onLog({
      level: "ok",
      text: text
        ? `Разобрали пост · ${text.slice(0, 80)}${text.length > 80 ? "…" : ""}`
        : extracted.hasImage
          ? "Текста нет, есть картинка"
          : "Пост открыли, контент пустой",
    })

    return {
      url: input.url,
      text,
      hasText: text.length > 0,
      hasImage: extracted.hasImage || shot.length > 0,
      screenshotJpeg: shot.toString("base64"),
    }
  } finally {
    disconnectBrowser(browser)
    await stopAdsPowerBrowser(input.profileId)
  }
}

async function saveFans(profileId: string, fans: SyncedFan[], log: (line: SwitchLog) => void) {
  if (fans.length === 0) return
  await replaceFacebookFans(profileId, fans)
  log({
    level: "ok",
    text: `Сохранили ${fans.length} ${fans.length === 1 ? "фанку" : "фанок"} в список страниц`,
  })
}

export async function runFacebookFanSync(
  profileId: string,
  onLog: (line: SwitchLog) => void,
): Promise<SwitchTestResult> {
  const id = profileId.trim()
  if (!id) {
    return { ok: false, message: "Выберите профиль" }
  }

  let browser: Browser | undefined
  let page: Page | undefined
  try {
    const opened = await openFacebookPage(id, onLog)
    browser = opened.browser
    page = opened.page
    await ensureSwitcherOpen(page, onLog)
    const fans = await scrapeFans(page, onLog)
    if (fans.length === 0) {
      throw new Error("В меню нет фанок")
    }
    await saveFans(id, fans, onLog)
    await page.keyboard.press("Escape").catch(() => undefined)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Синхронизация не прошла"
    onLog({ level: "error", text: message })
    await saveFailureArtifact(page, { profileId: id, phase: "fan-sync", message }, onLog)
    disconnectBrowser(browser)
    if (isAdsPowerStartError(message)) {
      onLog({ level: "info", text: "Закрываем зависший профиль, чтобы очередь могла идти дальше" })
      await stopAdsPowerBrowser(id)
    } else {
      onLog({ level: "info", text: "Окно оставляем открытым, чтобы было видно, где остановились" })
    }
    return { ok: false, message }
  }

  onLog({ level: "info", text: "Выходим — останавливаем профиль" })
  disconnectBrowser(browser)
  const stopped = await stopAdsPowerBrowser(id)
  if (!stopped.ok) {
    onLog({ level: "error", text: `Окно осталось открытым: ${stopped.message}` })
    return { ok: false, message: stopped.message }
  }

  onLog({ level: "ok", text: "Готово: имена фанок синхронизированы" })
  return { ok: true, message: "Фанки сохранены. Профиль закрыт." }
}

async function commentAsName(page: Page) {
  try {
    return await page.evaluate(() => {
      const parse = (text: string) => {
        const match =
          text.match(/comment as\s+(.+)$/i) ||
          text.match(/комментир\w*\s+как\s+(.+)$/i) ||
          text.match(/комент\w*\s+як\s+(.+)$/i) ||
          text.match(/skomentuj jako\s+(.+)$/i) ||
          text.match(/commenta come\s+(.+)$/i) ||
          text.match(/comentar como\s+(.+)$/i) ||
          text.match(/commenter en tant que\s+(.+)$/i) ||
          text.match(/kommentieren als\s+(.+)$/i)
        return match ? match[1].replace(/\s+/g, " ").trim() : ""
      }
      for (const el of document.querySelectorAll("[aria-label], [aria-placeholder], [placeholder]")) {
        for (const attr of ["aria-label", "aria-placeholder", "placeholder"] as const) {
          const name = parse(el.getAttribute(attr) || "")
          if (name) return name
        }
      }
      return ""
    })
  } catch (error) {
    if (isDestroyed(error)) return ""
    throw error
  }
}

async function revealCommentBox(page: Page, log: (line: SwitchLog) => void) {
  const commentAction = page.getByRole("button", { name: COMMENT_ACTION_RE }).first()
  if (await clickIfVisible(commentAction, 4000)) {
    log({ level: "ok", text: "Нажали «Комментарий» под постом" })
    await pause(700)
  }
  const box = commentBox(page)
  await box.waitFor({ state: "visible", timeout: 15_000 })
  await box.scrollIntoViewIfNeeded()
  return box
}

async function identityMenuOpened(page: Page) {
  const layers = await describeOpenLayers(page)
  if (layers.length > 0) return layers
  const radio = page.locator('[role="radio"]:visible, [role="menuitemradio"]:visible')
  if ((await radio.count()) > 0) return ["radio-list"]
  return []
}

async function pickFanFromComposer(page: Page, name: string, postUrl: string, log: (line: SwitchLog) => void) {
  let layers: string[] = []
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const caret = await findComposerCaret(page)
    if (!caret) {
      if (attempt === 0) log({ level: "info", text: "Не нашли стрелку у «Comment as»" })
      break
    }
    const point =
      attempt === 0
        ? caret
        : attempt === 1
          ? { x: caret.x + 5, y: caret.y + 4 }
          : { x: caret.x - 4, y: caret.y + 2 }
    if (!(await clickAt(page, point))) continue
    log({
      level: "ok",
      text: `Нажали стрелку у аватарки комментария (${Math.round(point.x)},${Math.round(point.y)})`,
    })
    await page
      .locator('[role="radio"], [role="menuitemradio"], [role="menu"], [role="listbox"], [role="radiogroup"]')
      .first()
      .waitFor({ state: "visible", timeout: 2500 })
      .catch(() => undefined)
    await pause(500)
    layers = await identityMenuOpened(page)
    if (layers.length > 0) break
    await page.keyboard.press("Escape").catch(() => undefined)
    await pause(250)
  }

  if (layers.length === 0) {
    log({ level: "info", text: "Меню фанки не открылось (попали в окно поста)" })
    return false
  }
  log({ level: "info", text: `Меню: ${layers[0]}` })

  const seeAll = identityOverlay(page)
    .getByRole("button", { name: SEE_ALL_PROFILES_RE })
    .or(identityOverlay(page).getByRole("menuitem", { name: SEE_ALL_PROFILES_RE }))
    .or(identityOverlay(page).getByText(SEE_ALL_PROFILES_RE))
  if (await visible(seeAll.first())) {
    await clickIfVisible(seeAll, 4000)
    await pause(800)
  }

  try {
    await typeFanSearch(page, name, log)
    if (await clickFanRow(page, name)) {
      await pause(1500)
      return sameFan(await commentAsName(page), name)
    }

    for (let step = 0; step < 25; step += 1) {
      if (await clickFanRow(page, name)) {
        await pause(1500)
        return sameFan(await commentAsName(page), name)
      }
      await clickSeeMoreProfiles(page)
      await scrollOpenLayer(page)
      await pause(500)
    }
  } catch (error) {
    if (isDestroyed(error)) {
      log({ level: "info", text: "Facebook перезагрузил страницу после выбора фанки" })
      await afterPossibleNav(page, postUrl, log)
      await revealCommentBox(page, log)
      return sameFan(await commentAsName(page), name)
    }
    throw error
  }

  await page.keyboard.press("Escape").catch(() => undefined)
  return false
}

async function switchToFan(page: Page, name: string, log: (line: SwitchLog) => void) {
  await ensureSwitcherOpen(page, log)
  try {
    await openAllProfilesDialog(page, log)
  } catch {
    log({ level: "info", text: "Пишем из компактного меню профилей" })
  }

  await clickNamedFan(page, name, log)
  log({ level: "info", text: `Ждём, пока Facebook переключит фанку «${name}»` })
  const closed = await profilesDialog(page)
    .first()
    .waitFor({ state: "hidden", timeout: 20_000 })
    .then(() => true)
    .catch(() => false)
  if (!closed) {
    log({ level: "info", text: "Список профилей не закрылся — жмём Enter" })
    await page.keyboard.press("Enter").catch(() => undefined)
    await profilesDialog(page).first().waitFor({ state: "hidden", timeout: 12_000 }).catch(() => undefined)
  }
  await switcherRoot(page).waitFor({ state: "hidden", timeout: 8_000 }).catch(() => undefined)
  await page.waitForLoadState("load", { timeout: 45_000 }).catch(() => undefined)
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => undefined)
  await pause(2500)
  await dismissOverlays(page)
}

async function ensureActingAs(page: Page, name: string, postUrl: string, log: (line: SwitchLog) => void) {
  await revealCommentBox(page, log)
  let who = await commentAsName(page)
  if (sameFan(who, name)) {
    log({ level: "ok", text: `Действуем как «${name}»` })
    return
  }
  log({
    level: "info",
    text: `Сейчас «${who || "неизвестно"}», нужно «${name}»`,
  })

  if (await pickFanFromComposer(page, name, postUrl, log)) {
    who = await commentAsName(page)
    if (sameFan(who, name)) {
      log({ level: "ok", text: `Переключили на «${name}»` })
      return
    }
  }

  await switchToFan(page, name, log)
  if (!/\/posts\/|story_fbid|permalink/i.test(page.url())) {
    log({ level: "info", text: `Снова открываем пост ${postUrl}` })
    await page.goto(postUrl, { waitUntil: "load", timeout: 60_000 })
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => undefined)
    await pause(2000)
  }
  await revealCommentBox(page, log)
  who = await commentAsName(page)
  if (!sameFan(who, name)) {
    throw new Error(`Фанка не переключилась: сейчас «${who || "?"}», нужно «${name}»`)
  }
  log({ level: "ok", text: `Действуем как «${name}»` })
}

function commentBox(page: Page) {
  return page
    .getByRole("textbox", {
      name: COMMENT_RE,
    })
    .or(
      page.locator(
        '[contenteditable="true"][role="textbox"][aria-label*="comment" i], [contenteditable="true"][role="textbox"][aria-label*="коммент" i], [contenteditable="true"][role="textbox"][aria-label*="komentarz" i], [contenteditable="true"][role="textbox"][aria-label*="comentar" i], [contenteditable="true"][role="textbox"][aria-label*="commenta" i], [contenteditable="true"][role="textbox"][aria-label*="commenter" i], [contenteditable="true"][aria-placeholder*="comment" i], [contenteditable="true"][aria-placeholder*="коммент" i], [contenteditable="true"][aria-placeholder*="komentarz" i], [contenteditable="true"][aria-placeholder*="comentar" i]',
      ),
    )
    .first()
}

async function commentAppearsOnPage(page: Page, text: string) {
  const sample = text.replace(/\s+/g, " ").trim().slice(0, 160)
  if (sample.length < 8) return true
  const deadline = Date.now() + 6000
  while (Date.now() < deadline) {
    const found = await page
      .evaluate((needle) => {
        const normalize = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase()
        return normalize(document.body.innerText || "").includes(normalize(needle))
      }, sample)
      .catch(() => false)
    if (found) return true
    await pause(700)
  }
  return false
}

async function fillCommentText(page: Page, box: Locator, text: string) {
  const target = box.first()
  await target.click({ timeout: 8_000 })
  await pause(250)

  try {
    await target.fill(text, { timeout: 8_000 })
    return
  } catch {
    // Facebook rich text boxes sometimes reject fill(); insertText keeps newlines as content
    // instead of pressing Enter for every line.
  }

  await page.keyboard.insertText(text)
}

async function writePostComment(page: Page, text: string, log: (line: SwitchLog) => void) {
  const box = await revealCommentBox(page, log)
  await fillCommentText(page, box, text)
  log({ level: "ok", text: "Поле комментария открыто" })
  await pause(400)

  const send = page
    .locator(
      [
        '[aria-label="Comment"][role="button"]',
        '[aria-label="Post"][role="button"]',
        '[aria-label="Опубликовать"][role="button"]',
        '[aria-label="Отправить"][role="button"]',
        '[aria-label="Opublikuj"][role="button"]',
        '[aria-label="Wyślij"][role="button"]',
        '[aria-label="Publicar"][role="button"]',
        '[aria-label="Enviar"][role="button"]',
        '[aria-label="Pubblica"][role="button"]',
        '[aria-label="Invia"][role="button"]',
        '[aria-label="Publier"][role="button"]',
        '[aria-label="Envoyer"][role="button"]',
        '[aria-label="Posten"][role="button"]',
        '[aria-label="Senden"][role="button"]',
      ].join(", "),
    )
    .last()
  if (await visible(send)) {
    await send.click({ timeout: 5_000 })
  } else {
    await page.keyboard.press("Enter")
  }
  await pause(1600)
  if (await commentAppearsOnPage(page, text)) {
    log({ level: "ok", text: "Комментарий отправлен" })
  } else {
    log({ level: "info", text: "Комментарий отправили, но DOM не подтвердил появление текста" })
  }
}

const POST_LIKE_SELECTOR = [
  '[aria-label="Like"]',
  '[aria-label="Нравится"]',
  '[aria-label="Подобається"]',
  '[aria-label="Lubię to"]',
  '[aria-label="Mi piace"]',
  '[aria-label="Me gusta"]',
  '[aria-label="Curtir"]',
  '[aria-label="J’aime"]',
  '[aria-label="J\\\'aime"]',
  '[aria-label="Gefällt mir"]',
].join(", ")

const POST_LIKED_SELECTOR = [
  '[aria-label="Remove Like"]',
  '[aria-label="Unlike"]',
  '[aria-label="Liked"]',
  '[aria-label="Remove Reaction"]',
  '[aria-label="Больше не нравится"]',
  '[aria-label="Вподобано"]',
  '[aria-label="Nie lubię"]',
  '[aria-label="Ya no me gusta"]',
  '[aria-label="Não curtir"]',
  '[aria-label="Je n’aime plus"]',
  '[aria-label="Remove Love"]',
  '[aria-label="Loved"]',
].join(", ")

async function classifyLikeButton(locator: Locator) {
  return locator.evaluate((el) => {
    const labelsOf = (node: Element) =>
      [...node.querySelectorAll("[aria-label]")].map((item) => item.getAttribute("aria-label") || "")

    let node: HTMLElement | null = el.parentElement
    for (let depth = 0; depth < 8 && node; depth += 1, node = node.parentElement) {
      const labels = labelsOf(node)
      if (labels.some((label) => /^(Dislike|Не нравится|Не подобається|Não gostei|No me gusta)$/i.test(label))) return "comment"
      const hasShare = labels.some((label) => /^(Share|Поделиться|Поширити|Udostępnij|Invia|Compartir|Compartilhar|Partager|Teilen|Send this to friends)/i.test(label))
      const hasComment = labels.some((label) =>
        /^(Comment|Комментарий|Коментар|Leave a comment|Skomentuj|Commenta|Comentar|Commenter|Kommentieren)/i.test(label),
      )
      if (hasShare || (hasComment && labels.some((label) => /^(Like|Нравится|Подобається|Lubię to|Mi piace|Me gusta|Curtir|J’aime|Gefällt mir)/i.test(label)))) {
        return "post"
      }
    }
    return "unknown"
  })
}

async function findPostLikeButton(page: Page) {
  const scopes = [
    page.locator('[role="dialog"]').last(),
    page.locator('[role="complementary"]').last(),
    page.locator('[role="article"]').first(),
    page.locator("body"),
  ]

  for (const scope of scopes) {
    const liked = scope.locator(POST_LIKED_SELECTOR)
    const likedCount = await liked.count()
    for (let index = 0; index < Math.min(likedCount, 8); index += 1) {
      const candidate = liked.nth(index)
      if (!(await visible(candidate))) continue
      if ((await classifyLikeButton(candidate)) === "comment") continue
      return { button: candidate, already: true as const }
    }

    const buttons = scope.locator(POST_LIKE_SELECTOR)
    const count = await buttons.count()
    for (let index = 0; index < Math.min(count, 12); index += 1) {
      const candidate = buttons.nth(index)
      if (!(await visible(candidate))) continue
      if ((await classifyLikeButton(candidate)) === "comment") continue
      return { button: candidate, already: false as const }
    }
  }

  return null
}

async function likePost(page: Page, log: (line: SwitchLog) => void) {
  const found = await findPostLikeButton(page)
  if (!found) {
    throw new Error("Не нашли кнопку лайка у поста — не путать с лайком под комментарием")
  }
  if (found.already) {
    log({ level: "ok", text: "Лайк уже стоит" })
    return
  }

  const likeButton = found.button
  await likeButton.scrollIntoViewIfNeeded()
  const box = await likeButton.boundingBox()
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  } else {
    await likeButton.hover({ force: true }).catch(() => undefined)
  }
  await pause(1400)

  const useLove = Math.random() < 0.5
  const picker = page.locator('[role="toolbar"]').filter({
    has: page.locator(
      [
        '[aria-label="Love"]',
        '[aria-label="Супер"]',
        '[aria-label="Сердечко"]',
        '[aria-label="Uwielbiam"]',
        '[aria-label="Me encanta"]',
        '[aria-label="Amei"]',
        '[aria-label="Adoro"]',
        '[aria-label="J’adore"]',
        '[aria-label="Like"]',
      ].join(", "),
    ),
  })
  const love = picker
    .locator(
      [
        '[aria-label="Love"]',
        '[aria-label="Супер"]',
        '[aria-label="Сердечко"]',
        '[aria-label="Uwielbiam"]',
        '[aria-label="Me encanta"]',
        '[aria-label="Amei"]',
        '[aria-label="Adoro"]',
        '[aria-label="J’adore"]',
      ].join(", "),
    )
    .first()
  const likeInPicker = picker
    .locator(
      [
        '[aria-label="Like"]',
        '[aria-label="Нравится"]',
        '[aria-label="Подобається"]',
        '[aria-label="Lubię to"]',
        '[aria-label="Me gusta"]',
        '[aria-label="Curtir"]',
        '[aria-label="Mi piace"]',
        '[aria-label="J’aime"]',
        '[aria-label="Gefällt mir"]',
      ].join(", "),
    )
    .first()

  if (useLove && (await visible(love)) && (await forceClick(love, 4000))) {
    log({ level: "ok", text: "Реакция: Love" })
    await pause(700)
    return
  }

  if ((await visible(likeInPicker)) && (await forceClick(likeInPicker, 4000))) {
    log({ level: "ok", text: "Реакция: Like" })
    await pause(700)
    return
  }

  if ((await visible(love)) && (await forceClick(love, 4000))) {
    log({ level: "ok", text: "Реакция: Love" })
    await pause(700)
    return
  }

  await page.keyboard.press("Escape").catch(() => undefined)
  await pause(200)
  if (await forceClick(likeButton, 8000)) {
    log({ level: "ok", text: "Реакция: Like" })
    await pause(700)
    return
  }

  throw new Error("Не удалось поставить лайк: поверх кнопки другой слой")
}

const FOLLOW_RE =
  /^(Follow(\s+Page)?|Obserwuj|Segui|Seguir|Suivre|Folgen|Подписаться|Підписатися|Sundan)(\s|$)/i
const FOLLOWING_RE =
  /^(Following|Followed|Unfollow|Obserwujesz|Przestań obserwować|Segui già|Non seguire|Siguiendo|Dejar de seguir|Seguindo|Deixar de seguir|Abonné|Ne plus suivre|Du folgst|Nicht mehr folgen|Вы подписаны|Подписки|Ви підписані|Sundan na|Requested|Pending|Liked)\b/i

async function controlName(locator: Locator): Promise<string> {
  return (locator.evaluate(
      `el => (el.getAttribute("aria-label") || el.innerText || "").trim().split("\\n")[0]`,
    ) as Promise<string>).catch(() => "")
}

function followCandidates(page: Page) {
  return page
    .getByRole("button", { name: FOLLOW_RE })
    .or(page.getByRole("button", { name: FOLLOWING_RE }))
    .or(page.getByRole("menuitem", { name: FOLLOW_RE }))
    .or(page.getByRole("menuitem", { name: FOLLOWING_RE }))
    .or(
      page.locator(
        [
          '[role="button"][aria-label*="Follow" i]',
          '[role="button"][aria-label*="Obserwuj" i]',
          '[role="button"][aria-label*="Segui" i]',
          '[role="button"][aria-label*="Подписаться" i]',
          '[role="button"][aria-label*="Підписатися" i]',
          '[role="button"][aria-label*="Suivre" i]',
          '[role="button"][aria-label*="Seguir" i]',
          '[role="button"][aria-label*="Seguindo" i]',
          '[role="button"][aria-label*="Sundan" i]',
          '[role="button"][aria-label*="Following" i]',
          '[role="menuitem"][aria-label*="Follow" i]',
        ].join(", "),
      ),
    )
}

async function clearUiChrome(page: Page) {
  for (let step = 0; step < 3; step += 1) {
    await page.keyboard.press("Escape").catch(() => undefined)
    await pause(200)
  }
  await dismissOverlays(page)
  await page.evaluate("window.scrollTo(0, 0)").catch(() => undefined)
  await pause(300)
}

async function clickAtBox(page: Page, locator: Locator) {
  const box = await locator.boundingBox()
  if (!box || box.width < 4 || box.height < 4) return false
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await pause(80)
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  return true
}

function profileUrlFromHref(href: string) {
  try {
    const url = new URL(href, "https://www.facebook.com")
    const people = url.pathname.match(/\/people\/[^/]+\/(\d+)/)
    if (people?.[1]) return `https://www.facebook.com/${people[1]}`
    if (url.pathname.includes("profile.php")) {
      const id = url.searchParams.get("id")
      return id ? `https://www.facebook.com/profile.php?id=${id}` : ""
    }
    const path = url.pathname.replace(/\/+$/, "")
    if (!path || path === "/") return ""
    if (/\/posts\/|\/photos?\/|\/reel\/|\/videos\/|\/watch\//i.test(path)) return ""
    return `https://www.facebook.com${path}`
  } catch {
    return ""
  }
}

function authorProfileFromPostUrl(postUrl: string) {
  try {
    const url = new URL(postUrl)
    const parts = url.pathname.split("/").filter(Boolean)
    const idParam = url.searchParams.get("id")
    if (parts[0] === "groups") return ""
    if (["permalink.php", "story.php", "photo.php", "watch"].includes(parts[0] || "")) {
      return idParam ? `https://www.facebook.com/profile.php?id=${idParam}` : ""
    }
    if (parts[0] === "profile.php") {
      return idParam ? `https://www.facebook.com/profile.php?id=${idParam}` : ""
    }
    const postsAt = parts.indexOf("posts")
    if (postsAt >= 1) {
      const owner = parts.slice(0, postsAt).join("/")
      const people = owner.match(/people\/[^/]+\/(\d+)/)
      if (people?.[1]) return `https://www.facebook.com/${people[1]}`
      return owner ? `https://www.facebook.com/${owner}` : ""
    }
    return ""
  } catch {
    return ""
  }
}

async function markPostAuthor(page: Page) {
  // String body avoids tsx/esbuild injecting `__name` into Playwright evaluate.
  return page.evaluate(`(() => {
    document.querySelectorAll("[data-farm-author]").forEach((node) => node.removeAttribute("data-farm-author"))

    const roots = []
    const dialogs = [...document.querySelectorAll('[role="dialog"]')]
    const lastDialog = dialogs[dialogs.length - 1]
    const complementary = document.querySelector('[role="complementary"]')
    const article = document.querySelector('[role="article"]')
    const main = document.querySelector('[role="main"]')
    for (const node of [lastDialog, complementary, article, main]) {
      if (node) roots.push(node)
    }
    if (roots.length === 0) roots.push(document.body)

    const isProfileHref = (href) => {
      if (!href) return false
      if (/comment_id/i.test(href)) return false
      if (/\\/posts\\/|\\/photos?\\/|\\/reel\\/|\\/videos\\/|\\/watch\\/|\\/groups\\/|\\/events\\//i.test(href.split("?")[0])) {
        return false
      }
      return true
    }

    const hits = []

    const pushLink = (link, nameLink, name, top, left) => {
      const href = link.href || link.getAttribute("href") || ""
      if (!isProfileHref(href)) return
      hits.push({ link, nameLink, name, top, left })
    }

    for (const root of roots) {
      for (const img of root.querySelectorAll("image, img")) {
        const rect = img.getBoundingClientRect()
        const size = Math.max(rect.width, rect.height)
        if (size < 16 || size > 180) continue
        const link = img.closest("a[href]") || img.closest('[role="link"]')
        if (!link) continue
        const attr = link.getAttribute("href") || ""
        const same = attr
          ? [...root.querySelectorAll("a[href]")].filter((node) => (node.getAttribute("href") || "") === attr)
          : []
        const nameLink =
          same.find((node) => {
            const text = (node.textContent || "").trim()
            return text.length >= 2 && text.length <= 80 && !node.querySelector("image, img")
          }) || null
        const name = ((nameLink && nameLink.textContent) || "").trim().split("\\n")[0].trim()
        pushLink(link, nameLink, name, rect.top, rect.left)
      }

      for (const heading of root.querySelectorAll("h1 a[href], h2 a[href], h3 a[href], strong a[href]")) {
        const link = heading
        const text = (link.textContent || "").trim().split("\\n")[0]
        if (text.length < 2 || text.length > 80) continue
        const rect = link.getBoundingClientRect()
        if (rect.width < 8 || rect.height < 8) continue
        pushLink(link, link, text, rect.top, rect.left)
      }
    }

    if (hits.length === 0) return null
    const topY = Math.min(...hits.map((hit) => hit.top))
    const nearTop = hits.filter((hit) => hit.top <= topY + 120)
    nearTop.sort((a, b) => {
      const aScore = (a.name ? 2 : 0) + (a.link.querySelector("image, img") ? 1 : 0)
      const bScore = (b.name ? 2 : 0) + (b.link.querySelector("image, img") ? 1 : 0)
      return bScore - aScore || a.top - b.top || a.left - b.left
    })
    const best = nearTop[0] || hits[0]
    best.link.setAttribute("data-farm-author", best.link.querySelector("image, img") ? "avatar" : "name")
    if (best.nameLink) best.nameLink.setAttribute("data-farm-author", "name")
    return { href: best.link.href || best.link.getAttribute("href") || "", name: best.name }
  })()`) as Promise<{ href: string; name: string } | null>
}

async function pickVisibleFollow(page: Page, want: "follow" | "already") {
  const buttons = followCandidates(page)
  const count = await buttons.count()
  let best: { button: Locator; y: number } | null = null

  for (let index = 0; index < Math.min(count, 24); index += 1) {
    const button = buttons.nth(index)
    if (!(await visible(button))) continue
    const name = await controlName(button)
    if (
      /followers|подписчик|підписник|obserwują|seguidores|abonnés|following this|people you may know|see all|приглас/i.test(name) &&
      !FOLLOW_RE.test(name) &&
      !FOLLOWING_RE.test(name)
    ) {
      continue
    }
    const inNav = await button
      .evaluate(
        `el => Boolean(el.closest('[role="tablist"], [role="navigation"], [role="tab"], [role="search"]'))`,
      )
      .catch(() => false)
    if (inNav) continue
    const already = FOLLOWING_RE.test(name) || /^(Following|Following Page|Вы подписаны)\b/i.test(name)
    const isFollow =
      FOLLOW_RE.test(name) ||
      /^(Follow(\s+Page)?|Подписаться|Підписатися|Obserwuj|Segui|Seguir|Suivre|Folgen|Sundan)\b/i.test(name)
    if (want === "already" ? !already : already || !isFollow) continue
    const box = await button.boundingBox()
    if (!box || box.width < 8 || box.height < 8) continue
    // Prefer Follow near the top of the viewport (profile header / hover card).
    if (!best || box.y < best.y) best = { button, y: box.y }
  }

  return best?.button ?? null
}

async function followViaDom(page: Page, want: "follow" | "already") {
  return page.evaluate(`(() => {
    const followRe = /^(Follow(\\s+Page)?|Obserwuj|Segui|Seguir|Suivre|Folgen|Подписаться|Підписатися|Sundan)(\\s|$)/i
    const followingRe = /^(Following|Followed|Unfollow|Obserwujesz|Przestań obserwować|Segui già|Non seguire|Siguiendo|Dejar de seguir|Seguindo|Deixar de seguir|Abonné|Ne plus suivre|Du folgst|Nicht mehr folgen|Вы подписаны|Подписки|Ви підписані|Sundan na|Requested|Pending|Liked)\\b/i
    const skipRe = /followers|подписчик|підписник|obserwują|seguidores|abonnés|following this|people you may know|see all|приглас/i
    const nodes = [...document.querySelectorAll('[role="button"], [role="menuitem"], button')]
    let best = null
    for (const el of nodes) {
      const name = ((el.getAttribute("aria-label") || el.innerText || "").trim().split("\\n")[0] || "").trim()
      if (!name) continue
      if (skipRe.test(name) && !followRe.test(name) && !followingRe.test(name)) continue
      if (el.closest('[role="tablist"], [role="navigation"], [role="tab"], [role="search"]')) continue
      const rect = el.getBoundingClientRect()
      if (rect.width < 8 || rect.height < 8) continue
      if (rect.bottom < 0 || rect.top > (window.innerHeight || 800)) continue
      const already = followingRe.test(name)
      const isFollow = followRe.test(name)
      if (${want === "already" ? "true" : "false"} ? !already : already || !isFollow) continue
      if (!best || rect.top < best.top) best = { el, top: rect.top, name }
    }
    if (!best) return null
    if (${want === "already" ? "true" : "false"}) return { name: best.name, clicked: false }
    best.el.scrollIntoView({ block: "center", inline: "center" })
    best.el.click()
    return { name: best.name, clicked: true }
  })()`) as Promise<{ name: string; clicked: boolean } | null>
}

async function confirmFollowDialog(page: Page) {
  const confirm = page.getByRole("button", {
    name: /^(Follow|Confirm|Подтвердить|Подписаться|Підписатися|Obserwuj|Potwierdź|Segui|Seguir|Confirmar|Suivre|Confirmer|Folgen|Bestätigen)$/i,
  })
  if (await visible(confirm.last())) {
    await forceClick(confirm.last(), 3000)
    await pause(400)
  }
}

async function tryFollow(page: Page, log: (line: SwitchLog) => void, where: string) {
  const already = await pickVisibleFollow(page, "already")
  if (already) {
    log({ level: "ok", text: `Уже подписаны (${where})` })
    return true
  }
  const alreadyDom = await followViaDom(page, "already")
  if (alreadyDom) {
    log({ level: "ok", text: `Уже подписаны (${where})` })
    return true
  }

  const follow = await pickVisibleFollow(page, "follow")
  let clicked = false
  if (follow) {
    clicked = (await forceClick(follow, 5000)) || (await clickAtBox(page, follow))
  }
  if (!clicked) {
    const viaDom = await followViaDom(page, "follow")
    clicked = Boolean(viaDom?.clicked)
  }
  if (!clicked) return false

  await pause(500)
  await confirmFollowDialog(page)

  const nowFollowing =
    (await pickVisibleFollow(page, "already")) || (await followViaDom(page, "already"))
  if (nowFollowing || (await pickVisibleFollow(page, "follow")) === null) {
    log({ level: "ok", text: `Нажали Follow ${where}` })
    await pause(500)
    return true
  }

  log({ level: "info", text: `Follow ${where} нажали, но статус не подтвердился` })
  return true
}

async function hoverAuthor(page: Page, kind: "avatar" | "name") {
  const target = page.locator(`a[data-farm-author="${kind}"]`).first()
  if (!(await visible(target))) return false
  await target.scrollIntoViewIfNeeded().catch(() => undefined)
  await pause(250)
  const box = await target.boundingBox()
  if (!box) return false
  // Stay on hover — do not click (comment toast / fan name overlays steal the click).
  await page.mouse.move(box.x + box.width / 2, box.y + Math.min(box.height / 2, 18))
  await pause(700)
  return true
}

async function openAuthorProfile(page: Page, profileUrl: string, log: (line: SwitchLog) => void) {
  log({ level: "info", text: `Открываем профиль ${profileUrl}` })
  await clearUiChrome(page)
  await page.goto(profileUrl, { waitUntil: "load", timeout: 60_000 })
  await page.waitForLoadState("domcontentloaded", { timeout: 30_000 }).catch(() => undefined)
  await page.evaluate("window.scrollTo(0, 0)").catch(() => undefined)
  await pause(2200)
}

async function subscribeAuthor(page: Page, log: (line: SwitchLog) => void, postUrl: string) {
  await clearUiChrome(page)

  if (await tryFollow(page, log, "у поста")) return

  const author = await markPostAuthor(page)
  if (author?.name || author?.href) {
    log({
      level: "info",
      text: author.name ? `Автор поста: ${author.name}` : "Нашли ссылку автора",
    })
  }

  const profileUrl =
    authorProfileFromPostUrl(postUrl) ||
    (author?.href ? profileUrlFromHref(author.href) : "")

  // Prefer direct profile URL from the post — hover cards are flaky under comment toasts.
  if (profileUrl) {
    await openAuthorProfile(page, profileUrl, log)
    for (let step = 0; step < 16; step += 1) {
      if (await tryFollow(page, log, "на профиле")) return
      if (step === 3 || step === 8 || step === 12) {
        await page.evaluate("window.scrollTo(0, 220)").catch(() => undefined)
        await pause(400)
        await page.evaluate("window.scrollTo(0, 0)").catch(() => undefined)
        await clearUiChrome(page)
      }
      await pause(350)
    }
  }

  // Fallback: hover author on the post for a Follow card.
  await page.goto(postUrl, { waitUntil: "load", timeout: 60_000 }).catch(() => undefined)
  await pause(1800)
  await clearUiChrome(page)
  await markPostAuthor(page)

  for (const kind of ["avatar", "name"] as const) {
    if (!(await hoverAuthor(page, kind))) continue
    log({
      level: "info",
      text: kind === "avatar" ? "Навели на фото автора" : "Навели на имя автора",
    })
    for (let step = 0; step < 10; step += 1) {
      if (await tryFollow(page, log, "в карточке профиля")) return
      await pause(250)
    }
    await page.keyboard.press("Escape").catch(() => undefined)
    await pause(200)
  }

  throw new Error(profileUrl ? "Не нашли кнопку Follow" : "Не нашли профиль автора")
}

export async function runFacebookComment(
  input: {
    profileId: string
    url: string
    message: string
    fanName?: string
    likeOnly?: boolean
    likeWithComment?: boolean
    subscribePage?: boolean
  },
  onLog: (line: SwitchLog) => void,
): Promise<SwitchTestResult> {
  const id = input.profileId.trim()
  if (!id) {
    return { ok: false, message: "Выберите профиль" }
  }

  let browser: Browser | undefined
  let page: Page | undefined
  try {
    const opened = await openFacebookPage(id, onLog)
    browser = opened.browser
    page = opened.page

    onLog({ level: "info", text: `Открываем пост ${input.url}` })
    await page.goto(input.url, { waitUntil: "load", timeout: 60_000 })
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => undefined)
    await pause(2500)
    await dismissCookies(page, onLog)
    onLog({ level: "ok", text: `Страница: ${page.url()}` })

    if (input.fanName) {
      await ensureActingAs(page, input.fanName, input.url, onLog)
    }

    if (!input.likeOnly) {
      await writePostComment(page, input.message, onLog)
    }

    if (input.likeOnly || input.likeWithComment) {
      try {
        await likePost(page, onLog)
      } catch (error) {
        const text = error instanceof Error ? error.message : "Лайк не поставился"
        if (input.likeOnly) throw error
        onLog({ level: "error", text })
      }
    }

    if (input.subscribePage) {
      try {
        await subscribeAuthor(page, onLog, input.url)
      } catch (error) {
        onLog({
          level: "error",
          text: error instanceof Error ? error.message : "Подписка не прошла",
        })
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : input.likeOnly ? "Лайк не поставился" : "Комментарий не отправился"
    onLog({ level: "error", text: message })
    await saveFailureArtifact(page, { profileId: id, phase: "job", message }, onLog)
    disconnectBrowser(browser)
    if (isAdsPowerStartError(message)) {
      onLog({ level: "info", text: "Закрываем зависший профиль, чтобы очередь могла идти дальше" })
      await stopAdsPowerBrowser(id)
    } else {
      onLog({ level: "info", text: "Окно оставляем открытым, чтобы было видно, где остановились" })
    }
    return { ok: false, message }
  }

  const waitMs = Math.round(7_000 * (1 + Math.random() * 0.13))
  onLog({
    level: "info",
    text: `Ждём ${Math.round(waitMs / 1000)} сек и закрываем окно`,
  })
  await pause(waitMs)

  onLog({ level: "info", text: "Закрываем профиль" })
  disconnectBrowser(browser)
  const stopped = await stopAdsPowerBrowser(id)
  if (!stopped.ok) {
    onLog({ level: "error", text: `Окно осталось открытым: ${stopped.message}` })
    return { ok: false, message: stopped.message }
  }

  onLog({ level: "ok", text: "Готово. Профиль закрыт" })
  return { ok: true, message: input.likeOnly ? "Лайк поставлен. Профиль закрыт." : "Комментарий отправлен. Профиль закрыт." }
}
