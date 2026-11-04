// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-gray; icon-glyph: mobile-alt;

/*
 * DuoFolds — small home-screen widget for iPhone Duo unfolds.
 * Shows TODAY (unfolds since midnight) and TOTAL (all unfolds ever logged).
 * Reads the file written by DuoLog.js.
 */

// ---- Config (USE_ICLOUD must match DuoLog.js) -------------------------------
const USE_ICLOUD = false
const REFRESH_MINUTES = 5  // a request only; iOS decides when widgets actually refresh
// -----------------------------------------------------------------------------

const C = {
  bgTop: new Color("#1F1F22"),
  bgBottom: new Color("#111113"),
  label: new Color("#8E8E93"),
  number: Color.white(),
  divider: new Color("#FFFFFF", 0.12),
}

async function loadData() {
  try {
    const fm = USE_ICLOUD ? FileManager.iCloud() : FileManager.local()
    const p = fm.joinPath(fm.joinPath(fm.documentsDirectory(), "DuoFolds"), "duo-log.json")
    const bak = p.replace(/\.json$/, ".bak.json")
    for (const f of [p, bak]) {
      if (!fm.fileExists(f)) continue
      try {
        if (USE_ICLOUD && !fm.isFileDownloaded(f)) await fm.downloadFileFromiCloud(f)
        const d = JSON.parse(fm.readString(f))
        if (d && Array.isArray(d.sessions)) return d
      } catch (e) {}
    }
  } catch (e) {}
  return { offset: 0, sessions: [] }
}

function counts(data) {
  const midnight = new Date()
  midnight.setHours(0, 0, 0, 0)
  const t0 = midnight.getTime()
  let today = 0
  for (const s of data.sessions) if ((s.o ?? s.c) >= t0) today++
  return { today, total: data.sessions.length + (data.offset || 0) }
}

const fmtNum = (n) => {
  try { return new Intl.NumberFormat().format(n) } catch (e) { return String(n) }
}

function addRow(w, value, label) {
  const row = w.addStack()
  row.layoutHorizontally()
  row.bottomAlignContent()

  const num = row.addText(fmtNum(value))
  num.font = Font.boldRoundedSystemFont(34)
  num.textColor = C.number
  num.lineLimit = 1
  num.minimumScaleFactor = 0.4

  row.addSpacer()

  const col = row.addStack()          // nudges the label onto the number's baseline
  col.layoutVertically()
  const lab = col.addText(label)
  lab.font = Font.semiboldSystemFont(10)
  lab.textColor = C.label
  col.addSpacer(6)
}

function addDivider(w) {
  const line = w.addStack()
  line.size = new Size(0, 1)
  line.backgroundColor = C.divider
  line.addSpacer()
}

function buildWidget(data) {
  const { today, total } = counts(data)
  const w = new ListWidget()

  const g = new LinearGradient()
  g.colors = [C.bgTop, C.bgBottom]
  g.locations = [0, 1]
  w.backgroundGradient = g
  w.setPadding(14, 14, 14, 14)

  // Header
  const head = w.addStack()
  head.layoutHorizontally()
  head.centerAlignContent()
  const sym = SFSymbol.named("rectangle.split.2x1") || SFSymbol.named("iphone")
  if (sym) {
    sym.applyFont(Font.semiboldSystemFont(10))
    const img = head.addImage(sym.image)
    img.imageSize = new Size(12, 12)
    img.tintColor = C.label
    head.addSpacer(5)
  }
  const title = head.addText("DUO FOLDS")
  title.font = Font.semiboldSystemFont(11)
  title.textColor = C.label

  w.addSpacer()
  addRow(w, today, "TODAY")
  w.addSpacer(8)
  addDivider(w)
  w.addSpacer(8)
  addRow(w, total, "TOTAL")

  w.refreshAfterDate = new Date(Date.now() + REFRESH_MINUTES * 60 * 1000)
  return w
}

const widget = buildWidget(await loadData())

if (config.runsInWidget) {
  Script.setWidget(widget)
} else {
  await widget.presentSmall()
}
Script.complete()
