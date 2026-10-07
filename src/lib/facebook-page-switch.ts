import { access, mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { chromium, type Browser, type Frame, type Locator, type Page } from "playwright-core"
import {
  checkAdsPowerProfileProxy,
  getAdsPowerFacebookCredentials,
  getAdsPowerFacebookPassword,
  markAdsPowerProfileBanned,
  startAdsPowerBrowser,
  stopAdsPowerBrowser,
} from "@/lib/adspower"
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

export type FanFormatInput = {
  currentName: string
  firstName: string
  lastName: string
  newName: string
  gender?: "male" | "female"
  avatarPath?: string
  coverPath?: string
  coverTheme?: string
  avatarPrompt?: string
  coverPrompt?: string
}

export type FanFormatResult = SwitchTestResult & {
  formatted?: Array<{ currentName: string; newName: string; gender?: "male" | "female"; nameApplied?: boolean }>
  pending?: Array<{ currentName: string; newName: string; message: string }>
  failed?: Array<{ currentName: string; newName?: string; message: string }>
}

export type FanFormatJob = {
  currentName: string
}

function pause(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const FACEBOOK_DEBUG_DIR = path.join(process.cwd(), ".debug", "facebook-errors")
const COMMENT_PHOTO_DIR = path.join(process.cwd(), "public", "uploads", "farm-comments")

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
const COMMENT_PHOTO_RE =
  /photo|фото|зображ|прикреп|прикріп|zdj[eę]cie|imagen|imagem|foto|media|attach|add|camera|камера/i
const SUSPENDED_PAGE_RE =
  /we suspended your page|page has been suspended|мы приостановили.*страниц|сторінк.*призупин|страниц.*заблок|page.*suspended/i
const CONTENT_UNAVAILABLE_RE =
  /this content isn['’]?t available right now|this content isn['’]?t available|this page isn['’]?t available|content isn['’]?t available|this post is unavailable|content unavailable|контент.*недоступ|содержим.*недоступ|публикац.*недоступ|страниц.*недоступ|цей вміст.*недоступ|ten materiał.*niedostęp|este contenido no está disponible|este conteúdo não está disponível|contenuto.*non.*disponibile|ce contenu.*n['’]?est pas disponible/i
const COOKIE_ACCEPT_RE =
  /Allow all cookies|Accept all|Allow essential and optional cookies|Разрешить все|Принять все|Zezw[oó]l na wszystkie|Akceptuj wszystkie|Permitir todas|Aceptar todas|Aceitar todos|Consenti tutti|Accetta tutti|Autoriser tous|Tout accepter|Alle Cookies erlauben|Alle akzeptieren/i
const SAVE_RE =
  /^(Save|Save changes|Save change|Request Change|Done|Continue|Review change|Submit|Log in|Login|Сохранить|Готово|Продолжить|Сохранить изменения|Войти|Увійти|Зберегти|Готово|Weiter|Speichern|Anmelden|Änderung überprüfen|Fertig|Zapisz|Gotowe|Zaloguj się)$/i
const NAME_CONFIRM_SUBMIT_RE =
  /^(Request Change|Save changes|Save change|Submit|Continue|Продолжить|Сохранить изменения|Зберегти|Продовжити|Weiter|Speichern|Änderung beantragen|Enviar|Enviar solicitud|Soumettre|Envoyer)$/i
const PROFILE_PHOTO_RE =
  /profile picture|profile photo|update picture|edit picture|change picture|add picture|фото профиля|аватар|зображення профілю|profilbild|zdj[eę]cie profilowe|foto de perfil|photo de profil/i
const COVER_PHOTO_RE =
  /cover photo|edit cover photo|add cover photo|change cover|обложк|фото обкладинки|titelbild|zdj[eę]cie w tle|foto de portada|photo de couverture/i
const CHOOSE_PROFILE_PICTURE_RE =
  /choose profile picture|select profile picture|выбрать фото профиля|обрати фото профілю|profilbild auswählen|wybierz zdjęcie profilowe|elegir foto de perfil|choisir une photo de profil/i
const UPLOAD_PHOTO_RE =
  /upload photo|add photo|choose photo|загрузить фото|добавить фото|обрати фото|завантажити фото|foto hochladen|bild hochladen|dodaj zdjęcie|subir foto|téléverser une photo/i
const PROFILE_PHOTO_DIALOG_RE =
  /choose profile picture|select profile picture|profile picture|profile photo|upload photo|фото профиля|аватар|зображення профілю|profilbild|zdj[eę]cie profilowe|foto de perfil|photo de profil/i
const USE_PAGE_RE =
  /^(Use Page|Switch now|Get started|Continue|Использовать страницу|Перейти|Начать|Продолжить|Використати сторінку|Продовжити|Seite verwenden|Weiter)$/i
const SETTINGS_PRIVACY_RE =
  /settings\s*&\s*privacy|settings and privacy|настройки и конфиденциальность|налаштування.*конфіденційність|einstellungen.*privatsphäre|ustawienia.*prywatność|configuración.*privacidad|paramètres.*confidentialité/i
const SETTINGS_RE =
  /^(Settings|Настройки|Налаштування|Einstellungen|Ustawienia|Configuración|Paramètres)$/i
const NOTE_DIALOG_RE =
  /new note|share a thought|anyone can see your note|заметк|нотатк/i
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
    const screenshot = await page.screenshot({ fullPage: false, timeout: 6000 }).catch(() => null)
    if (screenshot) {
      await writeFile(screenshotPath, screenshot)
    }
    const html = await page.content().catch(() => "")
    let htmlSaved = false
    if (html) {
      await writeFile(
        htmlPath,
        `<!-- ${options.message.replace(/-->/g, "-- >")} -->\n${html.slice(0, 2_000_000)}`,
      )
      htmlSaved = true
    }
    if (screenshot) {
      log({ level: "info", text: `Debug сохранён: ${screenshotPath}` })
    } else if (htmlSaved) {
      log({ level: "info", text: `Debug HTML сохранён: ${htmlPath}` })
    }
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

async function dismissPageWelcome(page: Page, log: (line: SwitchLog) => void) {
  const dialog = page.locator('[role="dialog"]:visible, [aria-modal="true"]:visible').filter({
    hasText: /welcome to your new page|your page activity is now separate|new page experience|добро пожаловать|willkommen/i,
  })
  if (!(await visible(dialog.first()))) return false
  const button = dialog
    .getByRole("button", { name: USE_PAGE_RE })
    .or(dialog.getByText(USE_PAGE_RE))
    .last()
  if (await clickIfVisible(button, 4000)) {
    log({ level: "ok", text: "Закрыли welcome-модал страницы" })
    await page.waitForLoadState("networkidle", { timeout: 12_000 }).catch(() => undefined)
    await pause(1500)
    return true
  }
  await page.keyboard.press("Escape").catch(() => undefined)
  await pause(700)
  return true
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

function isEvaluateRuntimeHelperError(error: unknown) {
  return /ReferenceError:\s*__name is not defined|__name is not defined/i.test(
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
    if (isEvaluateRuntimeHelperError(error)) return []
    throw error
  }
}

async function dismissSuspendedPageDialog(page: Page, log: (line: SwitchLog) => void) {
  const found = await page
    .evaluate((source) => {
      const re = new RegExp(source, "i")
      const vis = (el: Element) => {
        const r = (el as HTMLElement).getBoundingClientRect()
        const style = getComputedStyle(el)
        return (
          r.width > 80 &&
          r.height > 80 &&
          r.bottom > 0 &&
          r.right > 0 &&
          r.top < innerHeight &&
          r.left < innerWidth &&
          style.display !== "none" &&
          style.visibility !== "hidden"
        )
      }
      const dialogs = [...document.querySelectorAll('[role="dialog"], [aria-modal="true"]')]
        .filter(vis) as HTMLElement[]
      const dialog = dialogs.find((node) => re.test(node.innerText || ""))
      if (!dialog) return null
      const lines = (dialog.innerText || "")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
      const suspendedAt = lines.findIndex((line) => /page has been suspended/i.test(line))
      const pageName =
        suspendedAt > 0
          ? lines[suspendedAt - 1]
          : lines.find((line) => line.length >= 2 && line.length <= 80 && !/what happened|see why|facebook|sep|page/i.test(line))
      return { pageName: pageName || "", text: lines.slice(0, 6).join(" ") }
    }, SUSPENDED_PAGE_RE.source)
    .catch(() => null)

  if (!found) return false

  log({
    level: "error",
    text: found.pageName
      ? `Facebook показал заблокированную страницу «${found.pageName}»`
      : "Facebook показал окно заблокированной страницы",
  })

  const dialog = page.locator('[role="dialog"], [aria-modal="true"]').filter({
    hasText: SUSPENDED_PAGE_RE,
  }).last()
  const close = dialog
    .getByRole("button", { name: /close|закрыть|закрити|cerrar|fechar|chiudi|fermer|schließen/i })
    .or(dialog.locator('[aria-label="Close"], [aria-label="Закрыть"], [aria-label="Закрити"]'))
    .last()

  if ((await visible(close)) && (await forceClick(close, 2500))) {
    await pause(700)
  } else {
    await page.keyboard.press("Escape").catch(() => undefined)
    await pause(700)
  }
  return true
}

async function assertFacebookContentAvailable(
  page: Page,
  log: (line: SwitchLog) => void,
  subject = "Пост",
) {
  const found = await page
    .evaluate((source) => {
      const re = new RegExp(source, "i")
      const text = `${document.title || ""}\n${document.body?.innerText || ""}`.replace(/\s+/g, " ").trim()
      if (!re.test(text)) return null
      const lines = (document.body?.innerText || "")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
      const headline =
        lines.find((line) => re.test(line)) ||
        lines.find((line) => /available|недоступ|niedostęp|disponible/i.test(line)) ||
        "This content isn't available right now"
      return { headline }
    }, CONTENT_UNAVAILABLE_RE.source)
    .catch(() => null)

  if (!found) return

  const message = `${subject} недоступен: Facebook показывает «${found.headline}»`
  log({ level: "error", text: message })
  throw new Error(message)
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
  }).catch((error) => {
    if (isDestroyed(error) || isEvaluateRuntimeHelperError(error)) return null
    throw error
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
    if (isDestroyed(error) || isEvaluateRuntimeHelperError(error)) return null
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
    if (isDestroyed(error) || isEvaluateRuntimeHelperError(error)) return null
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
    if (!isDestroyed(error) && !isEvaluateRuntimeHelperError(error)) throw error
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

async function visibleProfileFans(page: Page): Promise<DomFan[]> {
  const fans = await page.evaluate(fansFromProfilesDialog()).catch(() => [] as DomFan[])
  const seen = new Set<string>()
  return fans.filter((fan) => {
    const key = fan.name.toLowerCase().replace(/\s+/g, " ").trim()
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

async function clickOnlyVisibleProfileFallback(page: Page, requestedName: string, log: (line: SwitchLog) => void) {
  const fans = await visibleProfileFans(page)
  if (fans.length !== 1) return ""
  const fan = fans[0]
  if (!fan?.name || sameFan(fan.name, requestedName)) return ""
  log({
    level: "info",
    text: `Не нашли «${requestedName}», но Facebook показывает единственную фанку «${fan.name}» — используем её`,
  })
  if (await clickFanRow(page, fan.name)) return fan.name
  if (fan.current) {
    await page.keyboard.press("Escape").catch(() => undefined)
    await pause(700)
    return fan.name
  }
  return ""
}

async function clickNamedFan(page: Page, name: string, log: (line: SwitchLog) => void) {
  await dismissSuspendedPageDialog(page, log)
  const searched = await typeFanSearch(page, name, log)
  if (searched && (await clickFanRow(page, name))) return name
  if (searched) {
    const fallbackName = await clickOnlyVisibleProfileFallback(page, name, log)
    if (fallbackName) return fallbackName
  }

  for (let step = 0; step < 40; step += 1) {
    await dismissSuspendedPageDialog(page, log)
    if (await clickFanRow(page, name)) return name
    const more = await clickSeeMoreProfiles(page)
    await scrollProfilesDialog(page)
    await pause(600)
    if (!more && step > 6) break
  }

  await dismissSuspendedPageDialog(page, log)
  if (await clickFanRow(page, name)) return name
  const fallbackName = await clickOnlyVisibleProfileFallback(page, name, log)
  if (fallbackName) return fallbackName
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

async function fillFacebookCredentialsIfAsked(
  page: Page,
  profileId: string,
  log: (line: SwitchLog) => void,
  mode: "login" | "meta-setup",
) {
  const credentials = await getAdsPowerFacebookCredentials(profileId)
  if (!credentials.ok || !credentials.password || !credentials.loginUser) {
    throw new Error(credentials.message || "В AdsPower нет login_user/password Facebook")
  }

  const bodyText = await page.locator("body").innerText({ timeout: 4000 }).catch(() => "")
  if (/I already have an account|У меня уже есть аккаунт|Ya tengo una cuenta/i.test(bodyText)) {
    const clickedExisting = await clickFirstVisible(
      [
        page.getByRole("button", { name: /I already have an account|У меня уже есть аккаунт|Ya tengo una cuenta/i }),
        page.getByText(/I already have an account|У меня уже есть аккаунт|Ya tengo una cuenta/i),
      ],
      5000,
    )
    if (clickedExisting) {
      log({ level: "info", text: "Facebook открыл создание аккаунта — выбрали вход в существующий аккаунт" })
      await page.waitForLoadState("load", { timeout: 20_000 }).catch(() => undefined)
      await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined)
      await pause(2000)
    }
  }

  const emailInput = page
    .locator(
      '#email, input[name="email"], input[name="reg_email__"], input[type="email"], input[autocomplete="username"], input[placeholder*="email" i], input[aria-label*="email" i], input[placeholder*="mobile" i], input[aria-label*="mobile" i]',
    )
    .first()
  const passwordInput = page
    .locator('#pass, input[name="pass"], input[name="reg_passwd__"], input[type="password"], input[autocomplete="current-password"], input[autocomplete="new-password"]')
    .first()

  await passwordInput.waitFor({ state: "visible", timeout: 12_000 }).catch(() => undefined)
  if (await visible(emailInput)) {
    await emailInput.click({ timeout: 4000 }).catch(() => undefined)
    await page.keyboard.press("Meta+A").catch(() => undefined)
    await page.keyboard.press("Control+A").catch(() => undefined)
    await page.keyboard.type(credentials.loginUser, { delay: 20 })
  }
  if (await visible(passwordInput)) {
    await passwordInput.click({ timeout: 4000 }).catch(() => undefined)
    await page.keyboard.press("Meta+A").catch(() => undefined)
    await page.keyboard.press("Control+A").catch(() => undefined)
    await page.keyboard.type(credentials.password, { delay: 20 })
  } else {
    throw new Error("Facebook просит данные, но поле пароля не видно")
  }

  log({
    level: "ok",
    text: mode === "login" ? "Ввели Facebook login/password из AdsPower" : "Ввели email/password в Meta Account setup из AdsPower",
  })
  const clicked = await clickFirstVisible(
    [
      page.getByRole("button", { name: /^(Log in|Login|Submit|Continue|Next|Войти|Продолжить|Далее)$/i }),
      page.getByText(/^(Log in|Login|Submit|Continue|Next|Войти|Продолжить|Далее)$/i),
      page.locator('button[type="submit"], input[type="submit"]'),
    ],
    5000,
  )
  if (!clicked) throw new Error("Не нашли кнопку отправки Facebook credentials")
  await page.waitForLoadState("load", { timeout: 30_000 }).catch(() => undefined)
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined)
  await pause(2500)
}

async function waitForFacebookReady(page: Page, profileId: string, log: (line: SwitchLog) => void) {
  const login = page.locator('#email, input[name="email"], input[name="pass"]')
  const metaAccountSetupRe =
    /get started on facebook with a meta account|by tapping submit, you agree to create an account|create new account/i
  const securityBlockRe =
    /checkpoint|hacked-protection|two_factor|recover|security|confirm your identity|secure your account|we noticed unusual activity|проверк.*безопас|подтверд.*личност/i
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
    page.locator('[role="banner"] [aria-haspopup="menu"]').last(),
  ]

  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const currentUrl = page.url()
    const bodyText = await page.locator("body").innerText({ timeout: 1500 }).catch(() => "")
    if (/\/hacked-protection\//i.test(currentUrl)) {
      const marked = await markAdsPowerProfileBanned(profileId)
      log({ level: marked.ok ? "ok" : "error", text: marked.message })
      throw new Error(`Facebook открыл hacked-protection для профиля ${profileId}. Аккаунт требует проверки/восстановления сессии: ${currentUrl}`)
    }
    if (/\/checkpoint\//i.test(currentUrl) || /\/recover\//i.test(currentUrl) || securityBlockRe.test(`${currentUrl}\n${bodyText}`)) {
      const marked = await markAdsPowerProfileBanned(profileId)
      log({ level: marked.ok ? "ok" : "error", text: marked.message })
      throw new Error(`Facebook открыл security/checkpoint экран для профиля ${profileId}: ${currentUrl}`)
    }
    if (metaAccountSetupRe.test(bodyText)) {
      log({ level: "info", text: "Facebook открыл Meta Account setup — заполняем email/password из AdsPower" })
      await fillFacebookCredentialsIfAsked(page, profileId, log, "meta-setup")
      await page.goto("https://www.facebook.com/", { waitUntil: "load", timeout: 30_000 }).catch(() => undefined)
      await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined)
      continue
    }
    if (await visible(login.first())) {
      log({ level: "info", text: "Facebook просит login/password — вводим данные из AdsPower" })
      await fillFacebookCredentialsIfAsked(page, profileId, log, "login")
      await page.goto("https://www.facebook.com/", { waitUntil: "load", timeout: 30_000 }).catch(() => undefined)
      await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined)
      continue
    }
    for (const marker of markers) {
      if (await visible(marker.first())) return
    }
    await pause(500)
  }

  if (await visible(login.first())) {
    throw new Error("Facebook просит логин — не удалось войти данными AdsPower")
  }
  const currentUrl = page.url()
  const bodyText = await page.locator("body").innerText({ timeout: 1500 }).catch(() => "")
  throw new Error(`Facebook не загрузился: ${currentUrl}${bodyText ? ` · ${bodyText.slice(0, 160).replace(/\s+/g, " ")}` : ""}`)
}

async function openFacebookPage(profileId: string, log: (line: SwitchLog) => void) {
  log({
    level: "info",
    text: `Проверяем прокси AdsPower ${profileId}`,
  })
  const proxyCheck = await checkAdsPowerProfileProxy(profileId)
  if (!proxyCheck.ok) {
    log({ level: "error", text: proxyCheck.message })
    throw new Error(proxyCheck.message)
  }
  if (proxyCheck.checked) {
    log({ level: "ok", text: proxyCheck.message })
  } else {
    log({ level: "info", text: proxyCheck.message })
  }

  log({
    level: "info",
    text: `Запускаем профиль AdsPower ${profileId} без окна`,
  })
  const started = await startAdsPowerBrowser(profileId, { skipProxyCheck: true })
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
  try {
    await waitForFacebookReady(page, profileId, log)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Facebook не загрузился"
    await saveFailureArtifact(page, { profileId, phase: "facebook-ready", message }, log)
    disconnectBrowser(browser)
    throw error
  }
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

async function clickFirstVisible(locators: Locator[], timeoutMs = 2500) {
  for (const locator of locators) {
    if (await clickIfVisible(locator, timeoutMs)) return true
  }
  return false
}

async function gotoCurrentFanProfile(page: Page, fanName: string, log: (line: SwitchLog) => void) {
  await page.goto("https://www.facebook.com/me", { waitUntil: "load", timeout: 60_000 })
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => undefined)
  await pause(2200)
  await dismissCookies(page, log)
  await dismissPageWelcome(page, log)
  await dismissOverlays(page)
  log({ level: "ok", text: `Открыли профиль фанки «${fanName}»: ${page.url()}` })
}

async function setAnyFileInput(page: Page, filePath: string) {
  const inputs = page.locator('input[type="file"]')
  const count = await inputs.count().catch(() => 0)
  for (let index = 0; index < count; index += 1) {
    const input = inputs.nth(index)
    try {
      await input.setInputFiles(filePath, { timeout: 3000 })
      return true
    } catch {
      // Try the next hidden Facebook uploader.
    }
  }
  return false
}

async function visibleProfilePhotoDialog(page: Page) {
  const dialog = page.locator('[role="dialog"]:visible, [aria-modal="true"]:visible').filter({
    hasText: PROFILE_PHOTO_DIALOG_RE,
  }).last()
  return (await visible(dialog)) ? dialog : null
}

async function topVisibleDialog(page: Page) {
  const dialog = page.locator('[role="dialog"]:visible, [aria-modal="true"]:visible').last()
  return (await visible(dialog)) ? dialog : null
}

async function setFileInputInScope(scope: Locator, filePath: string) {
  const inputs = scope.locator('input[type="file"]')
  const count = await inputs.count().catch(() => 0)
  for (let index = count - 1; index >= 0; index -= 1) {
    const input = inputs.nth(index)
    try {
      await input.setInputFiles(filePath, { timeout: 3000 })
      return true
    } catch {
      // Try the next uploader in the same modal/scope.
    }
  }
  return false
}

async function clickUploadAndSetFile(
  page: Page,
  filePath: string,
  log: (line: SwitchLog) => void,
  options: { profilePhotoOnly?: boolean } = {},
) {
  const profileDialog = options.profilePhotoOnly ? await visibleProfilePhotoDialog(page) : null
  if (options.profilePhotoOnly && !profileDialog) {
    log({ level: "info", text: "Не нашли активную модалку выбора фото профиля" })
    return false
  }

  if (!options.profilePhotoOnly && await setAnyFileInput(page, filePath)) {
    log({ level: "ok", text: "Загрузили новое фото" })
    return true
  }

  const root = profileDialog || page
  const triggers = [
    root.getByRole("button", { name: UPLOAD_PHOTO_RE }),
    root.getByRole("menuitem", { name: UPLOAD_PHOTO_RE }),
    root.getByText(UPLOAD_PHOTO_RE),
  ]

  for (const trigger of triggers) {
    const target = trigger.first()
    await target.waitFor({ state: "visible", timeout: 10_000 }).catch(() => undefined)
    if (!(await visible(target))) continue
    const chooser = page.waitForEvent("filechooser", { timeout: 3500 }).catch(() => null)
    await target.click({ timeout: 3500 }).catch(() => forceClick(target, 3500))
    const fileChooser = await chooser
    if (fileChooser) {
      await fileChooser.setFiles(filePath)
      log({ level: "ok", text: "Загрузили новое фото" })
      return true
    }
    const uploadedViaInput = profileDialog
      ? await setFileInputInScope(profileDialog, filePath)
      : await setAnyFileInput(page, filePath)
    if (uploadedViaInput) {
      log({ level: "ok", text: "Загрузили новое фото" })
      return true
    }
  }

  return false
}

async function saveProfilePhotoDialog(page: Page, log: (line: SwitchLog) => void) {
  for (let step = 0; step < 5; step += 1) {
    const dialog = (await visibleProfilePhotoDialog(page)) || (await topVisibleDialog(page))
    if (!dialog) return step > 0
    const clicked = await clickFirstVisible(
      [
        dialog.getByRole("button", { name: SAVE_RE }),
        dialog.getByRole("menuitem", { name: SAVE_RE }),
        dialog.getByText(SAVE_RE),
      ],
      4000,
    )
    if (!clicked) return step > 0
    log({ level: "info", text: "Нажали кнопку сохранения аватарки" })
    await page.waitForLoadState("networkidle", { timeout: 12_000 }).catch(() => undefined)
    await pause(1800)
  }
  return true
}

async function saveFacebookDialog(page: Page, log: (line: SwitchLog) => void) {
  for (let step = 0; step < 5; step += 1) {
    const clicked = await clickFirstVisible(
      [
        page.getByRole("button", { name: SAVE_RE }),
        page.getByRole("menuitem", { name: SAVE_RE }),
        page.getByText(SAVE_RE),
      ],
      4000,
    )
    if (!clicked) return step > 0
    log({ level: "info", text: "Нажали кнопку сохранения/продолжения" })
    await page.waitForLoadState("networkidle", { timeout: 12_000 }).catch(() => undefined)
    await pause(1800)
    const dialog = page.locator('[role="dialog"]:visible, [aria-modal="true"]:visible')
    if (!(await visible(dialog.first()))) return true
  }
  return true
}

async function dismissNewNoteDialog(page: Page, log: (line: SwitchLog) => void) {
  const dialog = page.locator('[role="dialog"]:visible, [aria-modal="true"]:visible').filter({
    hasText: NOTE_DIALOG_RE,
  })
  if (!(await visible(dialog.first()))) return false

  const closed =
    (await clickIfVisible(
      dialog
        .getByRole("button", { name: /^(Close|Закрыть|Закрити|Cerrar|Fermer|Schließen)$/i })
        .or(dialog.locator('[aria-label="Close"], [aria-label="Закрыть"], [aria-label="Закрити"]'))
        .last(),
      2500,
    )) ||
    (await page.keyboard.press("Escape").then(() => true).catch(() => false))
  await pause(700)
  if (closed) {
    log({ level: "info", text: "Закрыли модалку New note возле аватарки" })
  }
  return true
}

async function profilePhotoUploadControlsVisible(page: Page) {
  if (await visible(page.getByRole("button", { name: UPLOAD_PHOTO_RE }).first())) return true
  if (await visible(page.getByRole("menuitem", { name: UPLOAD_PHOTO_RE }).first())) return true
  if (await visible(page.getByText(UPLOAD_PHOTO_RE).first())) return true
  if (await visible(page.getByRole("button", { name: CHOOSE_PROFILE_PICTURE_RE }).first())) return true
  if (await visible(page.getByRole("menuitem", { name: CHOOSE_PROFILE_PICTURE_RE }).first())) return true
  return false
}

async function clickProfilePhotoCameraByGeometry(page: Page) {
  const point = await page
    .evaluate(() => {
      const visible = (el: Element) => {
        const box = (el as HTMLElement).getBoundingClientRect()
        const style = getComputedStyle(el)
        return (
          box.width >= 70 &&
          box.height >= 70 &&
          box.bottom > 0 &&
          box.right > 0 &&
          box.top < Math.min(650, innerHeight) &&
          box.left < innerWidth &&
          style.display !== "none" &&
          style.visibility !== "hidden"
        )
      }
      const images = [...document.querySelectorAll("img, image")]
        .filter(visible)
        .map((node) => {
          const box = (node as HTMLElement).getBoundingClientRect()
          const label = `${node.getAttribute("alt") || ""} ${node.getAttribute("aria-label") || ""}`
          const area = box.width * box.height
          const centerPenalty = Math.abs(box.left + box.width / 2 - innerWidth / 2)
          const topScore = box.top < 180 ? 200 : 0
          const avatarScore = /profile|avatar|foto|photo|picture|bild/i.test(label) ? 300 : 0
          return { box, score: avatarScore + area / 100 - centerPenalty - topScore }
        })
        .sort((left, right) => right.score - left.score)
      const picked = images[0]?.box
      if (!picked) return null
      return {
        x: Math.min(picked.right - 8, picked.left + picked.width * 0.86),
        y: Math.min(picked.bottom - 8, picked.top + picked.height * 0.86),
      }
    })
    .catch(() => null)
  if (!point) return false
  await page.mouse.click(point.x, point.y).catch(() => undefined)
  await pause(1200)
  return true
}

async function clickProfilePhotoEditControl(page: Page) {
  const clicked = await page
    .evaluate(() => {
      const visible = (el: Element) => {
        const box = (el as HTMLElement).getBoundingClientRect()
        const style = getComputedStyle(el)
        return (
          box.width >= 18 &&
          box.height >= 18 &&
          box.bottom > 0 &&
          box.right > 0 &&
          box.top < Math.min(650, innerHeight) &&
          box.left < innerWidth &&
          style.display !== "none" &&
          style.visibility !== "hidden"
        )
      }
      const buttons = [...document.querySelectorAll('button, [role="button"], [aria-label], a')]
        .filter(visible) as HTMLElement[]
      const candidates = buttons
        .map((node) => {
          const rect = node.getBoundingClientRect()
          const text = `${node.getAttribute("aria-label") || ""} ${node.innerText || ""}`.replace(/\s+/g, " ")
          if (/new note|share a thought|messenger|music|cover photo|облож|note/i.test(text)) return null
          const strong = /update profile picture|edit profile picture|change profile picture|add profile picture|profile photo|profile picture|фото профиля|аватар|profilbild|foto de perfil|photo de profil/i.test(text)
          const camera = /camera|камера|photo|picture|фото|bild/i.test(text)
          const hasIcon = Boolean(node.querySelector("svg, i, img"))
          const nearHeaderAvatar = rect.top >= 120 && rect.top <= 560 && rect.left >= innerWidth * 0.25 && rect.left <= innerWidth * 0.75
          const compact = rect.width <= 180 && rect.height <= 120
          const score =
            Number(strong) * 100 +
            Number(camera) * 35 +
            Number(hasIcon) * 10 +
            Number(nearHeaderAvatar) * 18 +
            Number(compact) * 8 -
            Math.abs(rect.left + rect.width / 2 - innerWidth / 2) / 40
          return { node, score }
        })
        .filter((item): item is { node: HTMLElement; score: number } => item !== null && item.score > 35)
        .sort((left, right) => right.score - left.score)
      candidates[0]?.node.click()
      return Boolean(candidates[0])
    })
    .catch(() => false)
  if (clicked) {
    await pause(1200)
  }
  return clicked
}

async function openProfilePhotoEditor(page: Page, log: (line: SwitchLog) => void) {
  const directControls = [
    page.getByRole("button", { name: PROFILE_PHOTO_RE }),
    page.getByLabel(PROFILE_PHOTO_RE),
    page.locator(
      '[aria-label*="profile picture" i], [aria-label*="profile photo" i], [aria-label*="фото профиля" i], [aria-label*="Profilbild" i]',
    ),
  ]

  for (let attempt = 0; attempt < 4; attempt += 1) {
    await dismissNewNoteDialog(page, log)
    if (await profilePhotoUploadControlsVisible(page)) return true

    if (attempt === 0 && (await clickFirstVisible(directControls, 3500))) {
      await pause(900)
      if (await dismissNewNoteDialog(page, log)) continue
      if (await profilePhotoUploadControlsVisible(page)) return true
    }

    if (await clickProfilePhotoEditControl(page)) {
      if (await dismissNewNoteDialog(page, log)) continue
      if (await profilePhotoUploadControlsVisible(page)) return true
    }

    if (await clickProfilePhotoCameraByGeometry(page)) {
      if (await dismissNewNoteDialog(page, log)) continue
      if (await profilePhotoUploadControlsVisible(page)) return true
    }
  }

  return false
}

const NAME_CHANGE_CONFIRM_RE = /confirm name change request|please enter your password/i
const NAME_CHANGE_SUCCESS_RE =
  /request submitted|submitted|we'?ll review|pending review|request sent|your request has been|запрос.*отправ|отправлен.*запрос/i
const NAME_CHANGE_EDIT_RE = /current page name|new page name|review change/i

type NameChangeResult = {
  ok: boolean
  nameApplied: boolean
}

async function typeReplacingCurrentValue(page: Page, value: string) {
  await page.keyboard.press("Meta+A").catch(() => undefined)
  await page.keyboard.press("Control+A").catch(() => undefined)
  await page.keyboard.press("Backspace").catch(() => undefined)
  await page.keyboard.type(value, { delay: 25 })
}

async function inputTextValue(locator: Locator) {
  return locator
    .evaluate((node: HTMLInputElement | HTMLTextAreaElement) => node.value || "")
    .catch(() => "")
}

async function setInputValue(locator: Locator, value: string) {
  await locator.evaluate((node: HTMLInputElement | HTMLTextAreaElement, nextValue) => {
    const prototype = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set
    if (setter) setter.call(node, nextValue)
    else node.value = nextValue
    node.dispatchEvent(new Event("input", { bubbles: true }))
    node.dispatchEvent(new Event("change", { bubbles: true }))
  }, value)
}

async function findPageNameInput(page: Page, currentName: string) {
  const roots: Array<Page | Frame> = [page, ...page.frames().filter((frame) => frame !== page.mainFrame())]
  let fallback: Locator | undefined
  let best: { field: Locator; score: number } | undefined

  for (const root of roots) {
    const fields = root.locator('input[type="text"], input:not([type]), textarea')
    const count = await fields.count().catch(() => 0)
    for (let index = 0; index < count; index += 1) {
      const field = fields.nth(index)
      if (!(await visible(field))) continue
      if (!fallback) fallback = field
      const value = await inputTextValue(field)
      const label = await field
        .evaluate((node: HTMLInputElement | HTMLTextAreaElement) =>
          [
            node.name || "",
            node.id || "",
            node.getAttribute("aria-label") || "",
            node.getAttribute("placeholder") || "",
            node.closest("tr, [role='row'], form, section, div")?.textContent || "",
          ]
            .join(" ")
            .replace(/\s+/g, " ")
            .trim(),
        )
        .catch(() => "")
      const score =
        (sameFan(value, currentName) ? 1000 : 0) +
        (/page\s*name|current\s*page\s*name|new\s*page\s*name|name/i.test(label) ? 200 : 0) +
        (value ? 50 : 0)
      if (!best || score > best.score) best = { field, score }
    }
  }

  return best?.field || fallback || null
}

async function fillPageNameInput(page: Page, fan: FanFormatInput) {
  const field = await findPageNameInput(page, fan.currentName)
  if (!field) throw new Error("Не нашли поле ввода Page name")

  for (let attempt = 0; attempt < 2; attempt += 1) {
    await field.click({ timeout: 4000 }).catch(() => undefined)
    await pause(250)
    await typeReplacingCurrentValue(page, fan.newName)
    await pause(350)
    const actual = await inputTextValue(field)
    if (sameFan(actual, fan.newName)) return actual
  }

  await setInputValue(field, fan.newName)
  await pause(350)
  const actual = await inputTextValue(field)
  if (sameFan(actual, fan.newName)) return actual
  throw new Error(`Не удалось ввести новое имя Page: в поле осталось «${actual || "пусто"}»`)
}

async function pageNameConfirmationFinished(page: Page) {
  const bodyText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "")
  if (NAME_CHANGE_SUCCESS_RE.test(bodyText)) return true
  if (await pageNameConfirmationVisible(page)) return false
  return !NAME_CHANGE_EDIT_RE.test(bodyText)
}

async function findVisiblePasswordInput(page: Page, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs
  const roots = () => [page, ...page.frames().filter((frame) => frame !== page.mainFrame())]
  do {
    for (const root of roots()) {
      const input = root.locator('input[type="password"]').first()
      if (await input.isVisible({ timeout: 400 }).catch(() => false)) return input
    }
    await pause(300)
  } while (Date.now() < deadline)
  return null
}

async function pageNameConfirmationVisible(page: Page) {
  if (await findVisiblePasswordInput(page, 700)) return true
  const roots = [page, ...page.frames().filter((frame) => frame !== page.mainFrame())]
  for (const root of roots) {
    const text = await root.locator("body").innerText({ timeout: 700 }).catch(() => "")
    if (NAME_CHANGE_CONFIRM_RE.test(text) || /\bRequest Change\b/i.test(text)) return true
  }
  return false
}

async function clickNameConfirmAction(page: Page, log: (line: SwitchLog) => void) {
  const roots = () => [page, ...page.frames().filter((frame) => frame !== page.mainFrame())]
  for (const root of roots()) {
    if (await clickLegacyFacebookSubmit(root, NAME_CONFIRM_SUBMIT_RE)) {
      log({ level: "info", text: "Нажали финальную кнопку подтверждения" })
      return true
    }
  }

  await page.setViewportSize({ width: 1000, height: 1100 }).catch(() => undefined)
  await page.mouse.wheel(0, 500).catch(() => undefined)
  await pause(500)
  for (const root of roots()) {
    if (await clickLegacyFacebookSubmit(root, NAME_CONFIRM_SUBMIT_RE)) {
      log({ level: "info", text: "Нажали финальную кнопку подтверждения после прокрутки" })
      return true
    }
  }

  if (await pageNameConfirmationVisible(page)) {
    await page.mouse.click(835, 708).catch(() => undefined)
    await pause(900)
    log({ level: "info", text: "Нажали Request Change координатой старой модалки" })
    return true
  }
  return false
}

async function verifyNameChangeAfterSubmit(
  page: Page,
  newName: string,
  log: (line: SwitchLog) => void,
): Promise<NameChangeResult> {
  const bodyText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "")
  const hasSubmittedText = NAME_CHANGE_SUCCESS_RE.test(bodyText)

  await page.goto("https://www.facebook.com/me", { waitUntil: "load", timeout: 60_000 }).catch(() => undefined)
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => undefined)
  await pause(2200)
  const actorName = await visibleActorName(page)
  if (sameFan(actorName, newName)) {
    log({ level: "ok", text: `Facebook уже показывает новое имя: ${newName}` })
    return { ok: true, nameApplied: true }
  }
  const profileText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "")
  const title = await page.title().catch(() => "")
  if (newName && new RegExp(`(^|\\s)${escapeRegex(newName)}($|\\s)`, "i").test(`${title}\n${profileText.slice(0, 2000)}`)) {
    log({ level: "ok", text: `Новое имя найдено на странице профиля: ${newName}` })
    return { ok: true, nameApplied: true }
  }
  if (hasSubmittedText) {
    log({ level: "info", text: `Facebook подтвердил отправку запроса имени, но пока показывает старое имя: ${newName}` })
    return { ok: true, nameApplied: false }
  }
  log({ level: "info", text: `Facebook не подтвердил отправку запроса имени: ${newName}` })
  return { ok: false, nameApplied: false }
}

async function confirmPageNameChangeAfterReview(
  page: Page,
  adsPowerProfileId: string,
  log: (line: SwitchLog) => void,
  newName: string,
): Promise<NameChangeResult> {
  for (let step = 0; step < 6; step += 1) {
    const initialText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "")
    const passwordInput = await findVisiblePasswordInput(page, step === 0 ? 2500 : 1000)
    const confirmVisible = NAME_CHANGE_CONFIRM_RE.test(initialText) || /\bRequest Change\b/i.test(initialText)
    let passwordFilled = false
    if (passwordInput) {
      log({ level: "info", text: "Facebook просит повторное подтверждение паролем" })
      const passwordResult = await getAdsPowerFacebookPassword(adsPowerProfileId)
      if (!passwordResult.ok || !passwordResult.password) {
        throw new Error(passwordResult.message || "Нет пароля Facebook для подтверждения смены имени Page")
      }
      log({ level: "ok", text: passwordResult.message })
      await passwordInput.click({ timeout: 4000 })
      await typeReplacingCurrentValue(page, passwordResult.password)
      log({ level: "ok", text: "Пароль Facebook подставлен в подтверждение" })
      passwordFilled = true
    } else if (confirmVisible) {
      log({ level: "info", text: "Facebook открыл старую модалку подтверждения имени" })
      const passwordResult = await getAdsPowerFacebookPassword(adsPowerProfileId)
      if (!passwordResult.ok || !passwordResult.password) {
        throw new Error(passwordResult.message || "Нет пароля Facebook для подтверждения смены имени Page")
      }
      log({ level: "ok", text: passwordResult.message })
      await page.setViewportSize({ width: 1000, height: 1100 }).catch(() => undefined)
      await page.mouse.wheel(0, 500).catch(() => undefined)
      await pause(500)
      const visiblePassword = await findVisiblePasswordInput(page, 1500)
      if (visiblePassword) {
        await visiblePassword.click({ timeout: 4000 })
        await typeReplacingCurrentValue(page, passwordResult.password)
        log({ level: "ok", text: "Пароль Facebook подставлен в старую модалку" })
        passwordFilled = true
      }
    }

    if (confirmVisible && !passwordFilled) {
      await pause(700)
      continue
    }

    const clicked = await clickNameConfirmAction(page, log)
    if (clicked) {
      await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined)
      await pause(2200)
      if (await pageNameConfirmationFinished(page) || !(await pageNameConfirmationVisible(page))) {
        return verifyNameChangeAfterSubmit(page, newName, log)
      }
    }

    const bodyText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "")
    if (NAME_CHANGE_SUCCESS_RE.test(bodyText)) return verifyNameChangeAfterSubmit(page, newName, log)
    if (!clicked && !(await pageNameConfirmationVisible(page))) {
      return verifyNameChangeAfterSubmit(page, newName, log)
    }
    if (!clicked && !/Continue|Log in|Login|Save changes|Save change|Request Change|Confirm Name Change Request/i.test(bodyText)) {
      return { ok: false, nameApplied: false }
    }
  }
  return { ok: false, nameApplied: false }
}

async function clickFacebookTextAction(page: Page, name: RegExp, timeoutMs = 5000) {
  const clicked = await clickFirstVisible(
    [
      page.getByRole("button", { name }),
      page.getByRole("menuitem", { name }),
      page.getByRole("link", { name }),
      page.getByText(name),
    ],
    timeoutMs,
  )
  if (clicked) return true

  const clickedByDom = await page
    .evaluate(
      ({ source, flags }) => {
        const re = new RegExp(source, flags)
        const visible = (el: Element) => {
          const box = (el as HTMLElement).getBoundingClientRect()
          const style = getComputedStyle(el)
          return (
            box.width >= 20 &&
            box.height >= 14 &&
            box.bottom > 0 &&
            box.right > 0 &&
            box.top < innerHeight &&
            box.left < innerWidth &&
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            Number(style.opacity || "1") > 0
          )
        }
        const textOf = (el: Element) =>
          `${el.getAttribute("aria-label") || ""}\n${(el as HTMLElement).innerText || ""}`
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean)
        const candidates = [...document.querySelectorAll("a, button, [role='button'], [role='menuitem'], [tabindex]")]
          .filter(visible)
          .map((node) => {
            const lines = textOf(node)
            const exact = lines.some((line) => re.test(line))
            const nested = !exact && [...node.querySelectorAll("*")].some((child) => textOf(child).some((line) => re.test(line)))
            return { node: node as HTMLElement, exact, nested }
          })
          .filter((item) => item.exact || item.nested)
        const picked = candidates.sort((left, right) => Number(right.exact) - Number(left.exact))[0]?.node
        picked?.click()
        return Boolean(picked)
      },
      { source: name.source, flags: name.flags },
    )
    .catch(() => false)
  if (clickedByDom) return true

  const source = JSON.stringify(name.source)
  const flags = JSON.stringify(name.flags)
  return page
    .evaluate(`(() => {
      const re = new RegExp(${source}, ${flags})
      const submit = [...document.querySelectorAll("input[type='submit'], button")]
        .find((node) => re.test([node.value || "", node.innerText || "", node.getAttribute("aria-label") || ""].join(" ")))
      if (!submit) return false
      const form = submit.closest("form")
      if (submit && form?.requestSubmit) form.requestSubmit(submit)
      else if (form?.submit) form.submit()
      else submit?.click()
      return Boolean(form || submit)
    })()`)
    .catch(() => false)
}

function facebookPageIdFromUrl(rawUrl: string) {
  try {
    const parsed = new URL(rawUrl)
    return parsed.searchParams.get("id") || parsed.pathname.match(/\/(\d{8,})\/?$/)?.[1] || ""
  } catch {
    return ""
  }
}

async function clickPageNameSettingsRow(page: Page, fanName: string) {
  const clicked = await page
    .evaluate((name) => {
      const visible = (el: Element) => {
        const box = (el as HTMLElement).getBoundingClientRect()
        const style = getComputedStyle(el)
        return (
          box.width >= 20 &&
          box.height >= 14 &&
          box.bottom > 0 &&
          box.right > 0 &&
          box.top < innerHeight &&
          box.left < innerWidth &&
          style.display !== "none" &&
          style.visibility !== "hidden"
        )
      }
      const linesOf = (el: Element) =>
        `${el.getAttribute("aria-label") || ""}\n${(el as HTMLElement).innerText || ""}`
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
      const nodes = [...document.querySelectorAll("a, button, [role='button'], [role='link'], [tabindex], div, span")]
        .filter(visible) as HTMLElement[]
      const fanMarks = nodes
        .filter((node) => linesOf(node).some((line) => line === name))
        .map((node) => node.getBoundingClientRect().top)
      const fanTop = fanMarks.length > 0 ? Math.min(...fanMarks) : -1
      const rows = nodes
        .filter((node) => linesOf(node).some((line) => /^Name$/i.test(line)))
        .map((node) => {
          let row = node
          for (let depth = 0; depth < 8 && row.parentElement; depth += 1) {
            const box = row.getBoundingClientRect()
            const lines = linesOf(row)
            if (box.width >= 240 && box.height >= 36 && box.height <= 180 && lines.some((line) => /^Name$/i.test(line))) {
              break
            }
            row = row.parentElement as HTMLElement
          }
          const box = row.getBoundingClientRect()
          const text = linesOf(row).join(" ")
          return { row, box, text }
        })
        .filter(({ box, text }) => box.width >= 180 && box.height >= 24 && box.height <= 220 && !/first name|last name/i.test(text))
        .filter(({ box }) => fanTop < 0 || box.top > fanTop - 4)
        .sort((left, right) => left.box.top - right.box.top || left.box.height - right.box.height)
      const picked = rows[0]
      if (!picked) return false
      const target =
        (document.elementFromPoint(picked.box.right - 24, picked.box.top + picked.box.height / 2) as HTMLElement | null)
          ?.closest("a, button, [role='button'], [role='link'], [tabindex]") as HTMLElement | null
      ;(target || picked.row).click()
      return true
    }, fanName)
    .catch(() => false)
  if (clicked) return true

  const labels = page.getByText(/^Name$/i)
  const count = await labels.count().catch(() => 0)
  const viewport = page.viewportSize() || { width: 760, height: 980 }
  for (let index = 0; index < count; index += 1) {
    const label = labels.nth(index)
    if (!(await visible(label))) continue
    const box = await label.boundingBox().catch(() => null)
    if (!box || box.y < 80 || box.y > viewport.height - 80) continue
    await page.mouse.click(viewport.width - 48, box.y + box.height / 2).catch(() => undefined)
    await pause(1000)
    if (/section=name/i.test(page.url())) return true
    await page.mouse.dblclick(viewport.width - 48, box.y + box.height / 2).catch(() => undefined)
    await pause(1200)
    if (/section=name/i.test(page.url())) return true
  }
  for (const y of [150, 185, 220, 255, 290, 325]) {
    await page.mouse.click(viewport.width - 48, y).catch(() => undefined)
    await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => undefined)
    await pause(1000)
    if (/section=name/i.test(page.url())) return true
    if (!/settings\/?\?tab=pages/i.test(page.url())) {
      await page.goto("https://web.facebook.com/settings/?tab=pages", { waitUntil: "load", timeout: 30_000 }).catch(() => undefined)
      await page.waitForLoadState("networkidle", { timeout: 7000 }).catch(() => undefined)
      await pause(800)
    }
  }
  return false
}

async function clickLegacyFacebookSubmit(root: Page | Frame, label: RegExp) {
  return root
    .evaluate(
      `(() => {
        const re = new RegExp(${JSON.stringify(label.source)}, ${JSON.stringify(label.flags)})
        const visible = (el) => {
          const box = el.getBoundingClientRect()
          const style = getComputedStyle(el)
          return (
            box.width >= 20 &&
            box.height >= 16 &&
            box.bottom > 0 &&
            box.right > 0 &&
            box.top < innerHeight &&
            box.left < innerWidth &&
            style.display !== "none" &&
            style.visibility !== "hidden"
          )
        }
        const target = [...document.querySelectorAll("*")]
          .filter(visible)
          .map((node) => {
            const text = [node.value || "", node.getAttribute("aria-label") || "", node.innerText || node.textContent || ""]
              .join(" ")
              .replace(/\\s+/g, " ")
              .trim()
            const box = node.getBoundingClientRect()
            return { node, text, area: box.width * box.height }
          })
          .filter(({ text }) => re.test(text))
          .sort((a, b) => a.area - b.area)[0]?.node
        if (target) {
          const clickable = target.closest("button, input, a, [role='button'], [tabindex]") || target
          const form = clickable.closest("form")
          if ((clickable.tagName === "BUTTON" || clickable.tagName === "INPUT") && form?.requestSubmit) {
            form.requestSubmit(clickable)
          } else {
            clickable.click()
          }
        }
        return Boolean(target)
      })()`,
    )
    .catch(() => false)
}

async function waitForPageNameReviewTransition(page: Page, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs
  do {
    await page.waitForLoadState("domcontentloaded", { timeout: 1000 }).catch(() => undefined)
    const bodyText = await page.locator("body").innerText({ timeout: 1200 }).catch(() => "")
    if (NAME_CHANGE_CONFIRM_RE.test(bodyText)) return true
    if (/\bRequest Change\b/i.test(bodyText)) return true
    if (NAME_CHANGE_SUCCESS_RE.test(bodyText)) return true
    if (await findVisiblePasswordInput(page, 500)) return true
    await pause(500)
  } while (Date.now() < deadline)
  return false
}

async function clickPageNameReviewChange(page: Page, log: (line: SwitchLog) => void) {
  for (const root of [page, ...page.frames().filter((frame) => frame !== page.mainFrame())]) {
    if (await clickLegacyFacebookSubmit(root, /^Review Change$/i)) {
      log({ level: "info", text: "Нажали Review Change внутри формы Page name" })
      if (await waitForPageNameReviewTransition(page)) return true
      log({ level: "info", text: "Review Change нажался, но подтверждение не открылось" })
    }
  }

  const point = await page
    .evaluate(() => {
      const visible = (el: Element) => {
        const box = (el as HTMLElement).getBoundingClientRect()
        const style = getComputedStyle(el)
        return (
          box.width >= 20 &&
          box.height >= 16 &&
          box.bottom > 0 &&
          box.right > 0 &&
          box.top < innerHeight &&
          box.left < innerWidth &&
          style.display !== "none" &&
          style.visibility !== "hidden"
        )
      }
      const nodes = [...document.querySelectorAll("button, input, a, [role='button'], [tabindex], span, div")]
        .filter(visible) as HTMLElement[]
      const candidates = nodes
        .map((node) => {
          const box = node.getBoundingClientRect()
          const text = [node.getAttribute("aria-label") || "", node.textContent || "", (node as HTMLInputElement).value || ""]
            .join(" ")
            .replace(/\s+/g, " ")
            .trim()
          const inMainArea = box.left > Math.min(180, innerWidth * 0.28)
          return { node, box, text, area: box.width * box.height, inMainArea }
        })
        .filter(({ text }) => /^Review Change$/i.test(text) || /\bReview Change\b/i.test(text))
        .sort((left, right) => Number(right.inMainArea) - Number(left.inMainArea) || left.area - right.area)
      const picked = candidates[0]
      if (!picked) return null
      const clickable = picked.node.closest("button, input, a, [role='button'], [tabindex]") as HTMLElement | null
      const box = (clickable || picked.node).getBoundingClientRect()
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 }
    })
    .catch(() => null)
  if (point) {
    await page.mouse.click(point.x, point.y).catch(() => undefined)
    if (await waitForPageNameReviewTransition(page)) {
      log({ level: "info", text: "Нажали Review Change по найденной кнопке формы" })
      return true
    }
    log({ level: "info", text: "Клик по найденной кнопке Review Change не открыл подтверждение" })
  }

  if (!(await pageNameEditFormVisible(page))) return false
  await page.mouse.click(270, 340).catch(() => undefined)
  if (await waitForPageNameReviewTransition(page)) {
    log({ level: "info", text: "Нажали Review Change координатой внутри формы Page name" })
    return true
  }
  log({ level: "info", text: "Координатный клик Review Change не открыл подтверждение" })
  return false
}

async function summarizeVisiblePage(page: Page) {
  const lines = await page
    .locator("body")
    .innerText({ timeout: 4000 })
    .then((text) =>
      text
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .filter((line, index, all) => all.indexOf(line) === index)
        .slice(0, 18)
        .join(" · "),
    )
    .catch(() => "")
  return `${page.url()}${lines ? ` · ${lines.slice(0, 420)}` : ""}`
}

async function pageNameEditFormVisible(page: Page) {
  if (/[?&]tab=profile/i.test(page.url()) && /[?&]section=name/i.test(page.url())) return true
  const bodyText = await page.locator("body").innerText({ timeout: 4000 }).catch(() => "")
  if (/current page name|new page name|review change|confirm name change request/i.test(bodyText)) return true
  const fields = page.locator('input[type="text"], input:not([type]), textarea')
  const count = await fields.count().catch(() => 0)
  for (let index = 0; index < count; index += 1) {
    const field = fields.nth(index)
    if (!(await visible(field))) continue
    const label = await field
      .evaluate((node: HTMLInputElement | HTMLTextAreaElement) =>
        [
          node.name || "",
          node.id || "",
          node.getAttribute("aria-label") || "",
          node.getAttribute("placeholder") || "",
          node.value || "",
        ].join(" "),
      )
      .catch(() => "")
    if (/name|page/i.test(label)) return true
  }
  return false
}

async function openPageNameViaPageSettings(
  page: Page,
  fan: FanFormatInput,
  log: (line: SwitchLog) => void,
  fanProfileUrl: string,
  adsPowerProfileId: string,
) {
  log({ level: "info", text: "Пробуем путь Page: Settings & privacy → Settings → Page setup → Name" })
  await page.setViewportSize({ width: 756, height: 982 }).catch(() => undefined)
  await page.goto("https://www.facebook.com/", { waitUntil: "load", timeout: 60_000 }).catch(() => undefined)
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => undefined)
  await pause(1500)
  await dismissCookies(page, log)
  await dismissOverlays(page)

  await ensureSwitcherOpen(page, log)
  if (!(await clickFacebookTextAction(page, SETTINGS_PRIVACY_RE))) {
    await page.keyboard.press("Escape").catch(() => undefined)
    throw new Error("Не нашли Settings & privacy страницы")
  }
  log({ level: "ok", text: "Открыли Settings & privacy страницы" })
  await pause(900)
  const settingsLayers = await describeOpenLayers(page).catch(() => [])
  if (settingsLayers.length > 0) {
    log({ level: "info", text: `Меню настроек страницы: ${settingsLayers.join(" | ")}` })
  }

  if (!(await clickFacebookTextAction(page, SETTINGS_RE))) {
    const pageId = facebookPageIdFromUrl(fanProfileUrl)
    if (!pageId) throw new Error("Не нашли Settings страницы")
    await saveFailureArtifact(
      page,
      { profileId: pageId, phase: "page-settings-menu", message: "Не нашли Settings страницы" },
      log,
    )
    log({ level: "info", text: "Settings в меню не кликнулся — открываем Page settings по ID" })
    const settingsUrls = [
      `https://www.facebook.com/pages/settings/?tab=page_info&id=${pageId}`,
      `https://web.facebook.com/pages/settings/?tab=page_info&id=${pageId}`,
      `https://www.facebook.com/profile.php?id=${pageId}&sk=settings`,
    ]
    for (const url of settingsUrls) {
      await page.goto(url, { waitUntil: "load", timeout: 60_000 }).catch(() => undefined)
      await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => undefined)
      await pause(2200)
      const bodyText = await page.locator("body").innerText({ timeout: 4000 }).catch(() => "")
      log({ level: "info", text: `Page settings candidate: ${await summarizeVisiblePage(page)}` })
      if (/page setup|page info|general page settings|name|settings/i.test(bodyText)) break
    }
  } else {
    log({ level: "ok", text: "Открыли Settings страницы" })
    await page.waitForLoadState("load", { timeout: 45_000 }).catch(() => undefined)
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => undefined)
    await pause(2500)
  }

  await page.goto("https://web.facebook.com/settings/?tab=pages", { waitUntil: "load", timeout: 60_000 })
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined)
  await pause(1800)
  log({ level: "ok", text: "Открыли Page setup через settings/?tab=pages" })
  if (process.env.FAN_FORMAT_DEBUG === "1") {
    await saveFailureArtifact(page, {
      profileId: adsPowerProfileId,
      phase: "page-setup-before-name-click",
      message: "Перед открытием строки Name",
    }, log)
  }

  let openedNameSection = await clickPageNameSettingsRow(page, fan.currentName)
  if (!openedNameSection) {
    log({ level: "info", text: `Не нашли строку Name для страницы: ${await summarizeVisiblePage(page)}` })
    log({ level: "info", text: "Пробуем прямой раздел Page name: settings/?tab=profile" })
    await page.goto("https://web.facebook.com/settings/?tab=profile", {
      waitUntil: "load",
      timeout: 60_000,
    }).catch(() => undefined)
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined)
    await pause(1800)
    const profileText = await page.locator("body").innerText({ timeout: 4000 }).catch(() => "")
    openedNameSection = /[?&]tab=profile/i.test(page.url()) || /general page settings|name/i.test(profileText)
    if (openedNameSection) {
      log({ level: "ok", text: "Открыли Page name прямым URL" })
    }
  }
  if (!openedNameSection) {
    return false
  }
  log({ level: "ok", text: "Открыли General Page settings → Name" })
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined)
  await pause(1500)

  const viewport = page.viewportSize() || { width: 756, height: 982 }
  for (const x of [707, 715, 699, viewport.width - 45]) {
    await page.mouse.click(x, 153).catch(() => undefined)
    await pause(350)
  }
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined)
  await pause(1600)
  if (!(await pageNameEditFormVisible(page))) {
    log({ level: "info", text: `Не открылась форма Edit для Page name: ${await summarizeVisiblePage(page)}` })
    return false
  }
  log({ level: "ok", text: "Открыли Edit для Page name" })

  const typedName = await fillPageNameInput(page, fan)
  log({ level: "ok", text: `Ввели новое имя Page: ${typedName}` })
  if (process.env.FAN_FORMAT_DEBUG === "1") {
    await saveFailureArtifact(page, {
      profileId: adsPowerProfileId,
      phase: "page-name-before-review",
      message: "Перед нажатием Review Change",
    }, log)
  }
  if (!(await clickPageNameReviewChange(page, log))) {
    await saveFailureArtifact(page, {
      profileId: adsPowerProfileId,
      phase: "page-name-review-button",
      message: "Не нашли настоящую кнопку Review Change",
    }, log)
    throw new Error("Не нашли настоящую кнопку Review Change")
  }
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined)
  await pause(2500)

  const confirmation = await confirmPageNameChangeAfterReview(page, adsPowerProfileId, log, fan.newName)
  if (!confirmation.ok) {
    log({ level: "info", text: `Подтверждение остановилось на экране: ${await summarizeVisiblePage(page)}` })
    await saveFailureArtifact(page, {
      profileId: adsPowerProfileId,
      phase: "page-name-confirm",
      message: "Не завершили подтверждение смены имени Page после Review Change",
    }, log)
    throw new Error("Не завершили подтверждение смены имени Page после Review Change")
  }
  log({ level: "ok", text: `Запрос смены названия отправлен: ${fan.newName}` })
  return confirmation
}

async function updateFanAvatar(page: Page, fan: FanFormatInput, log: (line: SwitchLog) => void) {
  if (!fan.avatarPath) throw new Error("Файл аватарки не передан")
  log({ level: "info", text: `Меняем аватарку «${fan.newName || fan.currentName}»` })
  await dismissPageWelcome(page, log)
  if (!(await openProfilePhotoEditor(page, log))) {
    throw new Error("Не нашли кнопку смены аватарки")
  }

  const chooseOpened = await clickFirstVisible(
    [
      page.getByRole("button", { name: CHOOSE_PROFILE_PICTURE_RE }),
      page.getByRole("menuitem", { name: CHOOSE_PROFILE_PICTURE_RE }),
      page.getByText(CHOOSE_PROFILE_PICTURE_RE),
    ],
    3500,
  )
  if (chooseOpened) {
    log({ level: "ok", text: "Открыли выбор фото профиля" })
    await page.getByRole("button", { name: UPLOAD_PHOTO_RE }).first().waitFor({ state: "visible", timeout: 10_000 }).catch(() => undefined)
    await pause(800)
  }
  await dismissNewNoteDialog(page, log)

  if (!(await clickUploadAndSetFile(page, fan.avatarPath, log, { profilePhotoOnly: true }))) {
    throw new Error("Не нашли загрузчик аватарки")
  }
  await pause(2500)
  if (!(await saveProfilePhotoDialog(page, log))) {
    throw new Error("Не нашли кнопку сохранения аватарки")
  }
  log({ level: "ok", text: `Аватарка обновлена: ${fan.newName}` })
}

async function updateFanCover(page: Page, fan: FanFormatInput, log: (line: SwitchLog) => void) {
  if (!fan.coverPath) return
  log({
    level: "info",
    text: `Меняем обложку «${fan.currentName}»${fan.coverTheme ? ` · ${fan.coverTheme}` : ""}`,
  })
  await dismissPageWelcome(page, log)
  const opened = await clickFirstVisible(
    [
      page.getByRole("button", { name: COVER_PHOTO_RE }),
      page.getByLabel(COVER_PHOTO_RE),
      page.getByText(COVER_PHOTO_RE),
      page.locator('[aria-label*="cover photo" i], [aria-label*="cover" i], [aria-label*="облож" i], [aria-label*="Titelbild" i]'),
    ],
    5000,
  )

  if (!opened) {
    throw new Error("Не нашли кнопку смены обложки")
  }

  await pause(1200)
  if (!(await clickUploadAndSetFile(page, fan.coverPath, log))) {
    throw new Error("Не нашли загрузчик обложки")
  }
  await pause(3000)
  if (!(await saveFacebookDialog(page, log))) {
    throw new Error("Не нашли кнопку сохранения обложки")
  }
  log({ level: "ok", text: `Обложка обновлена: ${fan.coverTheme || "cover"}` })
}

async function updateFanName(
  page: Page,
  fan: FanFormatInput,
  log: (line: SwitchLog) => void,
  adsPowerProfileId: string,
) {
  log({ level: "info", text: `Меняем имя «${fan.currentName}» → «${fan.newName}»` })
  const fanProfileUrl = page.url()

  const result = await openPageNameViaPageSettings(page, fan, log, fanProfileUrl, adsPowerProfileId)
  if (result) return result
  throw new Error("Page setup открыт, но форма смены имени Page не найдена")
}

export async function runFacebookFanFormat(
  profileId: string,
  fans: FanFormatInput[],
  onLog: (line: SwitchLog) => void,
): Promise<FanFormatResult> {
  return runFacebookFanFormatQueue(
    profileId,
    fans.map((fan) => ({ currentName: fan.currentName, fan })),
    async (job) => job.fan,
    onLog,
  )
}

export async function runFacebookFanFormatQueue<T extends FanFormatJob>(
  profileId: string,
  jobs: T[],
  prepareFan: (job: T) => Promise<FanFormatInput>,
  onLog: (line: SwitchLog) => void,
  prepareMedia?: (fan: FanFormatInput, job: T) => Promise<Partial<FanFormatInput>>,
): Promise<FanFormatResult> {
  const id = profileId.trim()
  if (!id) return { ok: false, message: "Выберите профиль" }
  if (jobs.length === 0) return { ok: false, message: "Выберите фанку" }

  let browser: Browser | undefined
  let page: Page | undefined
  const formatted: NonNullable<FanFormatResult["formatted"]> = []
  const pending: NonNullable<FanFormatResult["pending"]> = []
  const failed: Array<{ currentName: string; newName?: string; message: string }> = []
  try {
    const opened = await openFacebookPage(id, onLog)
    browser = opened.browser
    page = opened.page

    for (const job of jobs) {
      const currentName = job.currentName.trim()
      let preparedFan: FanFormatInput | undefined
      try {
        const selectedName = await switchToFan(page, currentName, onLog)
        await gotoCurrentFanProfile(page, selectedName, onLog)
        preparedFan = await prepareFan(job)
        const fan = { ...preparedFan, currentName: preparedFan.currentName || currentName }
        const nameAlreadyApplied = !sameFan(selectedName, currentName)

        if (nameAlreadyApplied) {
          onLog({
            level: "ok",
            text: `Facebook уже показывает новое имя фанки: ${currentName} → ${selectedName}`,
          })
          fan.newName = selectedName
        }

        if (prepareMedia) {
          Object.assign(fan, await prepareMedia(fan, job))
        }

        if (fan.avatarPath) {
          await updateFanAvatar(page, fan, onLog)
        } else {
          onLog({ level: "info", text: "Аватарку пропускаем: файл не передан" })
        }

        let nameResult: NameChangeResult
        if (nameAlreadyApplied) {
          nameResult = { ok: true, nameApplied: true }
        } else {
          nameResult = await updateFanName(page, fan, onLog, id)
        }
        if (!nameResult.nameApplied) {
          const message = `Facebook подтвердил запрос имени на review (${fan.newName}); аватарка уже обработана`
          pending.push({ currentName: fan.currentName, newName: fan.newName, message })
          onLog({ level: "info", text: message })
          await page.goto("https://www.facebook.com/", { waitUntil: "load", timeout: 60_000 }).catch(() => undefined)
          await pause(2000)
          continue
        }

        formatted.push({
          currentName: fan.currentName,
          newName: fan.newName,
          gender: fan.gender,
          nameApplied: true,
        })

        await gotoCurrentFanProfile(page, fan.newName, onLog)

        if (fan.coverPath) {
          await updateFanCover(page, fan, onLog)
        } else {
          onLog({ level: "info", text: "Обложку не меняем: оставляем текущую в Facebook" })
        }

        onLog({ level: "ok", text: `Фанка отформатирована: ${fan.currentName} → ${fan.newName}` })
      } catch (error) {
        const message = error instanceof Error ? error.message : "Фанка не отформатировалась"
        failed.push({ currentName, newName: preparedFan?.newName, message })
        onLog({ level: "error", text: `Фанка с ошибкой «${currentName}»: ${message}` })
        await saveFailureArtifact(
          page,
          { profileId: id, phase: `fan-format-${currentName}`, message },
          onLog,
        )
        await page.keyboard.press("Escape").catch(() => undefined)
        await page.keyboard.press("Escape").catch(() => undefined)
        await pause(800)
      }
      await page.goto("https://www.facebook.com/", { waitUntil: "load", timeout: 60_000 }).catch(() => undefined)
      await pause(2000)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Форматирование не прошло"
    onLog({ level: "error", text: message })
    await saveFailureArtifact(page, { profileId: id, phase: "fan-format", message }, onLog)
    disconnectBrowser(browser)
    onLog({ level: "info", text: "Закрываем профиль после ошибки" })
    await stopAdsPowerBrowser(id)
    return { ok: false, message, formatted, pending, failed }
  }

  onLog({ level: "info", text: "Закрываем профиль" })
  disconnectBrowser(browser)
  const stopped = await stopAdsPowerBrowser(id)
  if (!stopped.ok) {
    onLog({ level: "error", text: `Окно осталось открытым: ${stopped.message}` })
    return { ok: false, message: stopped.message, formatted, pending, failed }
  }

  const parts = [`отформатировано ${formatted.length}`]
  if (pending.length > 0) parts.push(`на review ${pending.length}`)
  if (failed.length > 0) parts.push(`ошибок ${failed.length}`)
  const message = `Готово: ${parts.join(", ")}`
  onLog({ level: failed.length > 0 ? "error" : "ok", text: message })
  return { ok: failed.length === 0, message, formatted, pending, failed }
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

async function visibleActorName(page: Page) {
  const commentName = await commentAsName(page)
  if (commentName) return commentName

  try {
    return await page.evaluate(() => {
      const text = document.body?.innerText || ""
      const match =
        text.match(/what['’]?s on your mind,\s*([^?\n]+)\?/i) ||
        text.match(/что у вас нового,\s*([^?\n]+)\?/i) ||
        text.match(/про що ви думаєте,\s*([^?\n]+)\?/i)
      return match ? match[1].replace(/\s+/g, " ").trim() : ""
    })
  } catch (error) {
    if (isDestroyed(error)) return ""
    throw error
  }
}

async function revealCommentBox(page: Page, log: (line: SwitchLog) => void) {
  await assertFacebookContentAvailable(page, log)
  const commentAction = page.getByRole("button", { name: COMMENT_ACTION_RE }).first()
  if (await clickIfVisible(commentAction, 4000)) {
    log({ level: "ok", text: "Нажали «Комментарий» под постом" })
    await pause(700)
  }
  const box = commentBox(page)
  try {
    await box.waitFor({ state: "visible", timeout: 15_000 })
  } catch (error) {
    await assertFacebookContentAvailable(page, log)
    throw error
  }
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
  await pause(700)
  return sameFan(await commentAsName(page), name)
}

async function switchToFan(page: Page, name: string, log: (line: SwitchLog) => void) {
  await ensureSwitcherOpen(page, log)
  try {
    await openAllProfilesDialog(page, log)
  } catch {
    log({ level: "info", text: "Пишем из компактного меню профилей" })
  }

  const selectedName = await clickNamedFan(page, name, log)
  log({ level: "info", text: `Ждём, пока Facebook переключит фанку «${selectedName}»` })
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
  return selectedName
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

  try {
    await switchToFan(page, name, log)
  } catch (error) {
    await page.keyboard.press("Escape").catch(() => undefined)
    await pause(1000)
    await revealCommentBox(page, log).catch(() => undefined)
    who = await visibleActorName(page)
    if (sameFan(who, name)) {
      log({ level: "ok", text: `Facebook уже переключил на «${name}»` })
    } else {
      throw error
    }
  }
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

async function visibleSubmittedCommentCount(page: Page, text: string) {
  const sample = text.replace(/\s+/g, " ").trim().slice(0, 160)
  if (sample.length < 4) return 0
  return page
    .evaluate((needle) => {
      const normalize = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase()
      const wanted = normalize(needle)
      const composer = document.querySelector('[data-farm-comment-composer="true"]')
      const visible = (el: Element) => {
        const box = (el as HTMLElement).getBoundingClientRect()
        const style = getComputedStyle(el)
        return (
          box.width >= 12 &&
          box.height >= 8 &&
          box.bottom > 0 &&
          box.right > 0 &&
          box.top < innerHeight &&
          box.left < innerWidth &&
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number(style.opacity || "1") > 0
        )
      }
      const nodes = [...document.body.querySelectorAll("div, span")]
        .filter((node) => !composer?.contains(node) && !node.contains(composer))
        .filter((node) => visible(node) && normalize((node as HTMLElement).innerText || "").includes(wanted))

      return nodes.filter((node) => {
        return ![...node.children].some((child) => normalize((child as HTMLElement).innerText || "").includes(wanted))
      }).length
    }, sample)
    .catch(() => 0)
}

async function visibleCommentReplyActionCount(page: Page) {
  return page
    .evaluate(() => {
      const composer = document.querySelector('[data-farm-comment-composer="true"]')
      const replyRe =
        /^(reply|ответить|відповісти|odpowiedz|responder|rispondi|répondre|antworten)$/i
      const visible = (el: Element) => {
        const box = (el as HTMLElement).getBoundingClientRect()
        const style = getComputedStyle(el)
        return (
          box.width >= 8 &&
          box.height >= 8 &&
          box.bottom > 0 &&
          box.right > 0 &&
          box.top < innerHeight &&
          box.left < innerWidth &&
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number(style.opacity || "1") > 0
        )
      }
      return [...document.querySelectorAll("a, span, div, [role='button']")].filter((node) => {
        if (composer?.contains(node) || node.contains(composer)) return false
        if (!visible(node)) return false
        const text = ((node as HTMLElement).innerText || "").replace(/\s+/g, " ").trim()
        if (!replyRe.test(text)) return false
        return ![...node.children].some((child) => replyRe.test(((child as HTMLElement).innerText || "").trim()))
      }).length
    })
    .catch(() => 0)
}

async function noCommentsPlaceholderVisible(page: Page) {
  return page
    .evaluate(() => {
      const text = (document.body.innerText || "").replace(/\s+/g, " ")
      return /no comments yet|be the first to comment|нет комментариев|немає коментарів|будьте первым|будь першим/i.test(
        text,
      )
    })
    .catch(() => false)
}

async function commentAppearsOnPage(
  page: Page,
  text: string,
  previousTextCount = 0,
  previousReplyCount = 0,
  hadNoComments = false,
) {
  const sample = text.replace(/\s+/g, " ").trim().slice(0, 160)
  const deadline = Date.now() + 18_000
  while (Date.now() < deadline) {
    if (sample.length >= 4) {
      const count = await visibleSubmittedCommentCount(page, sample)
      if (count > previousTextCount) return true
    }
    const replyCount = await visibleCommentReplyActionCount(page)
    if (replyCount > previousReplyCount) return true
    if (hadNoComments && !(await noCommentsPlaceholderVisible(page)) && replyCount > 0) return true
    await pause(1000)
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

function resolveCommentPhotoPath(photoPath: string) {
  if (!photoPath.trim()) return ""
  const fileName = path.basename(photoPath)
  return path.join(COMMENT_PHOTO_DIR, fileName)
}

async function markCommentComposer(page: Page, box: Locator) {
  await box.first().evaluate((el) => {
    document.querySelectorAll("[data-farm-comment-composer]").forEach((node) => {
      node.removeAttribute("data-farm-comment-composer")
    })

    let node: HTMLElement | null = el as HTMLElement
    for (let depth = 0; depth < 10 && node; depth += 1, node = node.parentElement) {
      const text = (node.innerText || "").trim()
      const hasFileInput = Boolean(node.querySelector('input[type="file"]'))
      const hasComposerControls = /photo|фото|зображ|zdj[eę]cie|imagen|imagem|foto|media/i.test(
        `${text} ${node.getAttribute("aria-label") || ""}`,
      )
      if (hasFileInput || hasComposerControls || node.getAttribute("role") === "form") {
        node.setAttribute("data-farm-comment-composer", "true")
        return
      }
    }

    ;(el.parentElement || el).setAttribute("data-farm-comment-composer", "true")
  })
}

async function attachCommentPhoto(
  page: Page,
  box: Locator,
  photoPath: string | undefined,
  log: (line: SwitchLog) => void,
) {
  if (!photoPath) return
  const diskPath = resolveCommentPhotoPath(photoPath)
  if (!diskPath) {
    throw new Error(`Фото не найдено: ${photoPath}`)
  }
  try {
    await access(diskPath)
  } catch {
    throw new Error(`Фото не найдено: ${photoPath}`)
  }

  await markCommentComposer(page, box)
  const composer = page.locator('[data-farm-comment-composer="true"]').last()

  const uploadViaInput = async (scope: Locator) => {
    const input = scope
      .locator('input[type="file"][accept*="image" i], input[type="file"][accept*="video" i], input[type="file"]')
      .last()
    if ((await input.count()) === 0) return false
    await input.setInputFiles(diskPath)
    return true
  }

  const uploadViaFileChooser = async () => {
    const buttons = composer
      .getByRole("button", { name: COMMENT_PHOTO_RE })
      .or(page.locator('[role="button"][aria-label]').filter({ hasText: COMMENT_PHOTO_RE }))
    const count = await buttons.count()
    for (let index = Math.min(count, 8) - 1; index >= 0; index -= 1) {
      const button = buttons.nth(index)
      if (!(await visible(button))) continue
      const chooserPromise = page.waitForEvent("filechooser", { timeout: 2500 }).catch(() => null)
      await forceClick(button, 4000)
      const chooser = await chooserPromise
      if (!chooser) continue
      await chooser.setFiles(diskPath)
      return true
    }
    return false
  }

  const uploaded =
    (await uploadViaInput(composer)) ||
    (await uploadViaFileChooser()) ||
    (await uploadViaInput(page.locator('[role="dialog"]').last())) ||
    (await uploadViaInput(page.locator("body")))

  if (!uploaded) {
    throw new Error("Не нашли кнопку прикрепления фото в комментарии")
  }

  log({ level: "ok", text: "Фото прикреплено" })
  await waitForCommentAttachment(page)
  await pause(800)
}

async function waitForCommentAttachment(page: Page) {
  const deadline = Date.now() + 12_000
  while (Date.now() < deadline) {
    const ready = await page
      .evaluate(() => {
        const composer = document.querySelector('[data-farm-comment-composer="true"]') as HTMLElement | null
        if (!composer) return true
        const text = (composer.innerText || "").toLowerCase()
        const uploading = /uploading|загрузка|завантаж|cargando|carregando|chargement|hochladen|caricamento/i.test(text)
        const busy = Boolean(
          composer.querySelector('[role="progressbar"], [aria-busy="true"], [data-visualcompletion="loading-state"]'),
        )
        return !uploading && !busy
      })
      .catch(() => true)
    if (ready) return
    await pause(500)
  }
}

async function markCommentSubmitButton(page: Page) {
  return page
    .evaluate(() => {
      document.querySelectorAll("[data-farm-comment-submit]").forEach((node) => {
        node.removeAttribute("data-farm-comment-submit")
      })

      const composer = document.querySelector('[data-farm-comment-composer="true"]') as HTMLElement | null
      if (!composer) return false
      const visible = (el: Element) => {
        const r = (el as HTMLElement).getBoundingClientRect()
        const style = getComputedStyle(el)
        return (
          r.width >= 8 &&
          r.height >= 8 &&
          r.bottom > 0 &&
          r.right > 0 &&
          r.top < innerHeight &&
          r.left < innerWidth &&
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number(style.opacity || "1") > 0
        )
      }
      const enabled = (el: Element) => {
        const node = el as HTMLButtonElement
        return !node.disabled && el.getAttribute("aria-disabled") !== "true"
      }
      const submitRe =
        /^(comment|post|send|publish|опубликовать|отправить|комментировать|opublikuj|wyślij|publicar|enviar|pubblica|invia|publier|envoyer|posten|senden)$/i
      const submitLooseRe =
        /press enter to post|comment|post|send|publish|опубликовать|отправить|opublikuj|wyślij|publicar|enviar|pubblica|invia|publier|envoyer|posten|senden/i
      const skipRe =
        /photo|фото|gif|sticker|emoji|attach|прикреп|прикріп|camera|камера|avatar|profile|reaction|like/i
      const roots: HTMLElement[] = [composer]
      let parent = composer.parentElement
      for (let depth = 0; depth < 5 && parent; depth += 1, parent = parent.parentElement) {
        roots.push(parent)
      }

      const buttons = [...new Set(roots.flatMap((root) =>
        [...root.querySelectorAll('button, [role="button"], [tabindex="0"]')] as HTMLElement[],
      ))]
      const candidates = buttons
        .filter((button) => visible(button) && enabled(button))
        .map((button) => {
          const label = (
            button.getAttribute("aria-label") ||
            button.getAttribute("title") ||
            button.innerText ||
            ""
          ).replace(/\s+/g, " ").trim()
          return { button, label, rect: button.getBoundingClientRect() }
        })
        .filter(({ label }) => label && submitLooseRe.test(label) && !skipRe.test(label))
        .sort((left, right) => {
          const leftExact = submitRe.test(left.label) ? 0 : 1
          const rightExact = submitRe.test(right.label) ? 0 : 1
          return leftExact - rightExact || right.rect.top - left.rect.top || right.rect.left - left.rect.left
        })

      const target = candidates[0]?.button
      if (!target) return false
      target.setAttribute("data-farm-comment-submit", "true")
      return true
    })
    .catch(() => false)
}

async function clickCommentSendArrow(page: Page, box: Locator) {
  const rect = await box
    .first()
    .boundingBox({ timeout: 2000 })
    .catch(() => null)
  if (!rect) return false

  const points = [
    { x: rect.x + rect.width - 20, y: rect.y + rect.height - 22 },
    { x: rect.x + rect.width - 18, y: rect.y + rect.height - 34 },
    { x: rect.x + rect.width - 34, y: rect.y + rect.height - 22 },
  ]

  for (const point of points) {
    await page.mouse.click(point.x, point.y)
    return true
  }

  return false
}

async function domClickCommentSendArrow(page: Page, box: Locator) {
  const rect = await box
    .first()
    .boundingBox({ timeout: 2000 })
    .catch(() => null)
  if (!rect) return false

  const point = { x: rect.x + rect.width - 20, y: rect.y + rect.height - 22 }
  return page
    .evaluate(({ x, y }) => {
      const target = document.elementFromPoint(x, y) as HTMLElement | null
      const button = target?.closest('[role="button"], button, [tabindex="0"]') as HTMLElement | null
      if (!button) return false
      button.focus()
      for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
        button.dispatchEvent(
          new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX: x,
            clientY: y,
          }),
        )
      }
      button.click()
      return true
    }, point)
    .catch(() => false)
}

async function submitCommentWithKeyboard(page: Page, box: Locator, shortcut: string) {
  await box.first().click({ timeout: 3000 }).catch(() => undefined)
  await pause(200)
  await page.keyboard.press(shortcut)
  return true
}

async function waitForSubmittedComment(
  page: Page,
  text: string,
  previousTextCount: number,
  previousReplyCount: number,
  hadNoComments: boolean,
) {
  await pause(2500)
  return commentAppearsOnPage(page, text, previousTextCount, previousReplyCount, hadNoComments)
}

async function sendPostComment(page: Page, box: Locator, text: string, log: (line: SwitchLog) => void) {
  await waitForCommentAttachment(page)
  const previousTextCount = await visibleSubmittedCommentCount(page, text)
  const previousReplyCount = await visibleCommentReplyActionCount(page)
  const hadNoComments = await noCommentsPlaceholderVisible(page)

  const keyboardShortcuts = ["Enter", "Control+Enter", "Meta+Enter"]

  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (await clickCommentSendArrow(page, box)) {
      log({ level: "info", text: "Нажали синюю стрелку отправки комментария" })
      if (await waitForSubmittedComment(page, text, previousTextCount, previousReplyCount, hadNoComments)) return true
    }

    const shortcut = keyboardShortcuts[attempt] || "Enter"
    await submitCommentWithKeyboard(page, box, shortcut).catch(() => undefined)
    log({ level: "info", text: `Отправляем комментарий с клавиатуры (${shortcut})` })
    if (await waitForSubmittedComment(page, text, previousTextCount, previousReplyCount, hadNoComments)) return true

    if (await domClickCommentSendArrow(page, box)) {
      log({ level: "info", text: "Нажали DOM-кнопку отправки комментария" })
      if (await waitForSubmittedComment(page, text, previousTextCount, previousReplyCount, hadNoComments)) return true
    }

    await markCommentSubmitButton(page)
    const scoped = page.locator('[data-farm-comment-submit="true"]').last()
    if ((await visible(scoped)) && (await forceClick(scoped, 5000))) {
      log({ level: "info", text: "Нажали найденную кнопку отправки комментария" })
      if (await waitForSubmittedComment(page, text, previousTextCount, previousReplyCount, hadNoComments)) return true
    }
  }

  return false
}

async function writePostComment(
  page: Page,
  text: string,
  log: (line: SwitchLog) => void,
  photoPath?: string,
) {
  const box = await revealCommentBox(page, log)
  await fillCommentText(page, box, text)
  log({ level: "ok", text: "Поле комментария открыто" })
  await pause(400)
  await attachCommentPhoto(page, box, photoPath, log)

  const sent = await sendPostComment(page, box, text, log)
  if (!sent) {
    throw new Error("Нажали отправку, но новый комментарий не появился на Facebook")
  }
  log({ level: "ok", text: "Комментарий отправлен и появился на Facebook" })
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
    photoPath?: string
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
    await assertFacebookContentAvailable(page, onLog)
    onLog({ level: "ok", text: `Страница: ${page.url()}` })

    if (input.fanName) {
      await ensureActingAs(page, input.fanName, input.url, onLog)
    }

    if (!input.likeOnly) {
      await writePostComment(page, input.message, onLog, input.photoPath)
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
    onLog({ level: "info", text: "Закрываем профиль после ошибки, чтобы очередь шла дальше" })
    const stopped = await stopAdsPowerBrowser(id)
    if (!stopped.ok && !isAdsPowerStartError(message)) {
      onLog({ level: "error", text: `Окно осталось открытым: ${stopped.message}` })
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
