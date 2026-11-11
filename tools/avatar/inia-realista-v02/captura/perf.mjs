import { createRequire } from "node:module"
const { webkit } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_CORE)
const labels = ["FPS (rAF)", "Quadro p50 / p95", "Renders/s (WebGL)", "Triângulos", "Draw calls", "Geometrias / texturas"]
const out = []
for (const round of [1, 2]) for (const model of ["mentora", "v02"]) {
  const browser = await webkit.launch()                       // navegador novo: sem cache de GLB nem de GPU
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 2 })
  const t0 = Date.now()
  await page.goto(`http://localhost:3000/dev/avatar-lab?model=${model}&view=chat`, { waitUntil: "load" })
  await page.waitForSelector("canvas")
  await page.waitForFunction(() => !document.body.innerText.includes("Carregando avatar"), null, { timeout: 60000 })
  const readyMs = Date.now() - t0
  await page.waitForTimeout(12000)
  const values = await page.evaluate((labels) => { const lines = document.body.innerText.split("\n").map((l) => l.trim()).filter(Boolean); return Object.fromEntries(labels.map((l) => [l, lines[lines.indexOf(l) + 1]])) }, labels)
  const glb = await page.evaluate(() => performance.getEntriesByType("resource").filter((r) => r.name.endsWith(".glb")).map((r) => ({ ms: Math.round(r.duration), bytes: r.transferSize || r.encodedBodySize })))
  const canvas = await page.evaluate(() => { const c = document.querySelector("canvas"); return `${c.width}x${c.height}` })
  out.push({ round, model, readyMs, canvas, glb, ...values })
  console.log(JSON.stringify(out.at(-1)))
  await browser.close()
}
