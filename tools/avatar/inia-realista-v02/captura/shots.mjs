import { createRequire } from "node:module"
import { writeFileSync } from "node:fs"
const { webkit } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_CORE)
const out = process.argv[2]
const jobs = process.argv.slice(3) // model:view:motion
const browser = await webkit.launch()
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 2 })
page.on("pageerror", (e) => console.log("PAGEERROR", e.message))
for (const job of jobs) {
  const [model, view, motion = "auto"] = job.split(":")
  const t0 = Date.now()
  await page.goto(`http://localhost:3000/dev/avatar-lab?model=${model}&view=${view}&motion=${motion}`, { waitUntil: "load" })
  await page.waitForSelector("canvas", { timeout: 60000 })
  await page.waitForFunction(() => !document.body.innerText.includes("Carregando avatar"), null, { timeout: 60000 })
  const loadMs = Date.now() - t0
  await page.waitForTimeout(3500)
  const canvas = page.locator("canvas").first()
  await canvas.screenshot({ path: `${out}/${model}_${view}.png` })
  const diag = await page.evaluate(() => document.body.innerText.split("\n").filter((l) => /FPS|Triângulos|Draw|quadro|ms/i.test(l)).slice(0, 12).join(" | "))
  console.log(job, "loadMs", loadMs, diag.slice(0, 400))
}
await browser.close()
