// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-gray; icon-glyph: mobile-alt;

/*
 * DuoLog — logs iPhone Duo unfold / fold events.
 *
 * Called from a Shortcuts automation via Scriptable's "Run Script" action
 * with the parameter "open" (unfolded) or "close" (folded).
 * Runs headless: no UI is shown when called from Shortcuts.
 *
 * Run it from inside the Scriptable app (no parameter) to get a small menu:
 * view stats, log test events, delete the last session, set a starting total.
 *
 * Data: Scriptable/DuoFolds/duo-log.json  (DuoFolds.js reads the same file)
 */

// ---- Config (USE_ICLOUD must match DuoFolds.js) -----------------------------
const USE_ICLOUD = false   // false = on-device storage (fastest, works offline)
const DEBOUNCE_MS = 3000   // same event repeated within 3 s = duplicate, ignored
// -----------------------------------------------------------------------------

const fm = USE_ICLOUD ? FileManager.iCloud() : FileManager.local()
const dir = fm.joinPath(fm.documentsDirectory(), "DuoFolds")
const path = fm.joinPath(dir, "duo-log.json")
const bakPath = fm.joinPath(dir, "duo-log.bak.json")

/*
 * File format:
 * {
 *   v: 1,
 *   created: <ms>, updated: <ms>,
 *   offset: 0,                 // added to TOTAL (unfolds before you installed this)
 *   sessions: [
 *     { o: <open ms>, c: <close ms> },             // normal unfold
 *     { o: <open ms>, c: null }                    // currently unfolded
 *     { o: <open ms>, c: null, m: "noclose" },     // close event never arrived
 *     { o: null, c: <close ms>, m: "noopen" }      // open event never arrived
 *   ]
 * }
 * Each session is one unfold, so TOTAL = sessions.length + offset.
 */

// ---- Storage ----------------------------------------------------------------

async function tryRead(p) {
  if (!fm.fileExists(p)) return null
  try {
    if (USE_ICLOUD && !fm.isFileDownloaded(p)) await fm.downloadFileFromiCloud(p)
    const d = JSON.parse(fm.readString(p))
    return d && Array.isArray(d.sessions) ? d : null
  } catch (e) {
    return null
  }
}

async function load() {
  if (!fm.fileExists(dir)) fm.createDirectory(dir, true)
  const d = (await tryRead(path)) || (await tryRead(bakPath))
  if (d) return d
  if (fm.fileExists(path)) {
    // Unreadable and no good backup: set it aside rather than overwrite it.
    fm.move(path, fm.joinPath(dir, `duo-log.corrupt-${Date.now()}.json`))
  }
  const now = Date.now()
  return { v: 1, created: now, updated: now, offset: 0, sessions: [] }
}

function save(data) {
  const json = JSON.stringify(data)
  // Backup first, then main. If either write is interrupted, the other
  // file still holds a complete copy and load() falls back to it.
  fm.writeString(bakPath, json)
  fm.writeString(path, json)
}

// ---- Recording --------------------------------------------------------------

function parseAction(raw) {
  if (raw == null) return null
  if (typeof raw === "object") raw = raw.action ?? raw.event ?? raw.state ?? ""
  const s = String(raw).trim().toLowerCase()
  if (["open", "opened", "unfold", "unfolded"].includes(s)) return "open"
  if (["close", "closed", "fold", "folded"].includes(s)) return "close"
  return s === "" ? null : "unknown:" + s
}

function getAction() {
  const candidates = [
    args.shortcutParameter,                          // "Parameter" field in Shortcuts
    args.plainTexts && args.plainTexts[0],           // "Texts" field in Shortcuts
    args.queryParameters && args.queryParameters.action, // scriptable:///run/DuoLog?action=open
  ]
  for (const c of candidates) {
    const a = parseAction(c)
    if (a) return a
  }
  return null
}

async function record(action, now) {
  const data = await load()
  const s = data.sessions
  const last = s[s.length - 1]
  let msg

  if (action === "open") {
    if (last && last.c == null && last.o != null && now - last.o < DEBOUNCE_MS) {
      msg = "duplicate open ignored"
    } else {
      // Previous unfold is still "open": its close was missed. Flag it so it
      // still counts as an unfold but is left out of time calculations.
      if (last && last.c == null) last.m = "noclose"
      s.push({ o: now, c: null })
      msg = "open logged"
    }
  } else {
    if (last && last.c == null && !last.m) {
      last.c = now
      msg = `close logged (${fmtDur(now - last.o)} unfolded)`
    } else if (last && last.c != null && now - last.c < DEBOUNCE_MS) {
      msg = "duplicate close ignored"
    } else {
      // Folded without a matching open: the unfold happened, we just missed
      // its start. Count it, with no duration.
      s.push({ o: null, c: now, m: "noopen" })
      msg = "close logged (open was missed)"
    }
  }

  data.updated = now
  save(data)
  return `DuoLog: ${msg} · total ${s.length + (data.offset || 0)}`
}

// ---- Stats (used by the in-app menu) ----------------------------------------

function startOfDay(t) {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function stats(data, now) {
  const t0 = startOfDay(now)
  const s = data.sessions
  let today = 0, todayMs = 0, timedMs = 0, timedCount = 0, missed = 0
  s.forEach((x, i) => {
    const at = x.o ?? x.c
    const isToday = at >= t0
    if (isToday) today++
    if (x.m) { missed++; return }
    let dur = null
    if (x.o != null && x.c != null) dur = x.c - x.o
    else if (x.o != null && x.c == null && i === s.length - 1) dur = now - x.o // unfolded right now
    if (dur == null) return
    timedMs += dur
    timedCount++
    if (isToday) todayMs += dur
  })
  return {
    today,
    total: s.length + (data.offset || 0),
    todayMs,
    avgMs: timedCount ? timedMs / timedCount : 0,
    totalMs: timedMs,
    missed,
    unfoldedNow: s.length > 0 && s[s.length - 1].c == null && !s[s.length - 1].m,
  }
}

function fmtDur(ms) {
  const m = Math.round(ms / 60000)
  if (m < 1) return `${Math.round(ms / 1000)}s`
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

// ---- In-app menu ------------------------------------------------------------

async function menu() {
  while (true) {
    const data = await load()
    const st = stats(data, Date.now())
    const a = new Alert()
    a.title = "Duo Folds"
    a.message =
      `Today: ${st.today} unfolds · ${fmtDur(st.todayMs)} unfolded\n` +
      `Total: ${st.total} unfolds` + (data.offset ? ` (incl. ${data.offset} starting)` : "") + `\n` +
      `Avg per unfold: ${fmtDur(st.avgMs)}\n` +
      `All-time unfolded: ${fmtDur(st.totalMs)}\n` +
      `Missed open/close events: ${st.missed}\n` +
      `Unfolded now: ${st.unfoldedNow ? "yes" : "no"}`
    a.addAction("Log OPEN (test)")
    a.addAction("Log CLOSE (test)")
    a.addDestructiveAction("Delete last session")
    a.addAction("Set starting total…")
    a.addAction("View raw data")
    a.addCancelAction("Done")
    const i = await a.presentSheet()

    if (i === -1) return
    if (i === 0) await record("open", Date.now())
    if (i === 1) await record("close", Date.now())
    if (i === 2 && data.sessions.length) {
      data.sessions.pop()
      save(data)
    }
    if (i === 3) {
      const p = new Alert()
      p.title = "Starting total"
      p.message = "Unfolds that happened before you started logging. Added to TOTAL."
      p.addTextField("0", String(data.offset || 0))
      p.addAction("Save")
      p.addCancelAction("Cancel")
      if ((await p.present()) === 0) {
        const n = parseInt(p.textFieldValue(0), 10)
        data.offset = Number.isFinite(n) && n >= 0 ? n : 0
        save(data)
      }
    }
    if (i === 4) await QuickLook.present(JSON.stringify(data, null, 2), true)
  }
}

// ---- Main -------------------------------------------------------------------

const action = getAction()

if (action === "open" || action === "close") {
  Script.setShortcutOutput(await record(action, Date.now()))
} else if (action) {
  // Throwing surfaces as a Shortcuts error banner, which makes a typo obvious.
  throw new Error(`DuoLog: unknown parameter "${action.slice(8)}". Use "open" or "close".`)
} else if (config.runsInApp) {
  await menu()
} else {
  throw new Error('DuoLog: no parameter. In Run Script, add "open" or "close" under Texts.')
}

Script.complete()
