import { createRequire } from "node:module"
const { webkit } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_CORE)
const [out, width, ...labels] = process.argv.slice(2)
const b = await webkit.launch(); const p = await b.newPage({ viewport: { width: Number(width), height: 44 } })
await p.setContent(`<body style="margin:0;display:flex;background:#18141e;font:600 22px -apple-system,Helvetica;color:#fff">${labels.map((l) => `<div style="flex:1;padding:8px 16px">${l}</div>`).join("")}</body>`)
await p.screenshot({ path: out }); await b.close()
