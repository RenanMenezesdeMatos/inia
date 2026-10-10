/**
 * Configura o par DIA/NOITE dos cenários da INIA já cadastrados (eventos de 2026 e 2027 + cenário padrão), a partir das
 * coleções geradas em `output/imagegen/`:
 *   - `vivo-calendario/`               — as imagens ORIGINAIS (as que já estão nos cenários);
 *   - `vivo-calendario-luz-invertida/` — a mesma cena com a luz trocada; o inventário liga cada arquivo ao original pelo
 *     `original_sha256` e diz se ele é `dia` ou `noite`. Ano-Novo, Feliz 2027 e Halloween têm a versão DIURNA nessa pasta (o
 *     original é que é noturno) — o script nunca presume que tudo ali é noite.
 *
 * O par é encontrado pelo HASH da imagem que já está no cenário (nunca pelo nome do arquivo); "Feliz 2027" só pode casar com
 * a virada 2026/2027 e o Ano-Novo 2026 nunca recebe a imagem com o ano impresso. Faixas iniciais: Dia 06:00–18:00 (principal),
 * Noite 18:00–06:00. Nome, período, desfoque, escurecimento e o cenário padrão ficam como estão; nada é criado nem duplicado.
 * Cada cenário é gravado pelo MESMO serviço da tela (validação, transação, auditoria), em nome de um Administrador geral.
 *
 *   npx tsx scripts/dev/configure-inia-scene-day-night.ts            # ensaio: mostra o plano, não grava
 *   npx tsx scripts/dev/configure-inia-scene-day-night.ts --apply    # grava e confere
 * Idempotente: cenário já com o par certo é pulado.
 */
import { createHash } from "node:crypto"
import { readdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { pool } from "../../src/infrastructure/database/pool.js"
import { updateScene, type SceneImageInput } from "../../src/modules/inia-scenes/application/inia-scene-service.js"
import { parseClock } from "../../src/modules/inia-scenes/domain/scene-time-slots.js"

const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001"
const ACTOR_EMAIL = "renanmenezesdematos@gmail.com"
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..")
const ORIGINALS = join(ROOT, "output/imagegen/vivo-calendario")
const INVERTED = join(ROOT, "output/imagegen/vivo-calendario-luz-invertida")
const REPORT = join(INVERTED, "cenarios-dia-noite-configurados.json")
const DAY = { label: "Dia", start: "06:00", end: "18:00" } as const
const NIGHT = { label: "Noite", start: "18:00", end: "06:00" } as const
const apply = process.argv.includes("--apply")

type InvertedEntry = { tema: string; periodo: "dia" | "noite"; arquivo: string; sha256: string; original_sha256: string }
type SceneRow = { id: string; name: string; schedule_start: string | null; schedule_end: string | null; blur: number; dim: number }
type ImageRow = { id: string; scene_id: string; label: string; is_primary: boolean; start_minute: number | null; end_minute: number | null; sha256: string }

const sha256 = (data: Buffer) => createHash("sha256").update(data).digest("hex")
const slotOf = (side: { start: string; end: string }) => ({ start: parseClock(side.start)!, end: parseClock(side.end)! })

async function loadState() {
  const [scenes, images, settings] = await Promise.all([
    pool.query<SceneRow>(`select id, name, to_char(schedule_start, 'YYYY-MM-DD') schedule_start, to_char(schedule_end, 'YYYY-MM-DD') schedule_end, background_blur::float8 blur, background_dim::int dim from inia_scenes where organization_id = $1 order by schedule_start nulls first, name`, [ORGANIZATION_ID]),
    pool.query<ImageRow>(`select id, scene_id, label, is_primary, start_minute, end_minute, sha256 from inia_scene_images where organization_id = $1`, [ORGANIZATION_ID]),
    pool.query<{ default_scene_id: string | null }>(`select default_scene_id from inia_scene_settings where organization_id = $1`, [ORGANIZATION_ID]),
  ])
  return { scenes: scenes.rows, images: images.rows, defaultSceneId: settings.rows[0]?.default_scene_id ?? null }
}

async function main() {
  const inverted = (JSON.parse(await readFile(join(INVERTED, "inventario.json"), "utf8")) as { arquivos: InvertedEntry[] }).arquivos
  // Arquivos conferidos pelo conteúdo: o inventário só vale se o hash bater com o arquivo em disco.
  const invertedFiles = new Map<string, { entry: InvertedEntry; data: Buffer }>()
  for (const entry of inverted) {
    const data = await readFile(join(INVERTED, entry.arquivo))
    if (sha256(data) !== entry.sha256) throw new Error(`Hash diferente do inventário: ${entry.arquivo}`)
    if (invertedFiles.has(entry.original_sha256)) throw new Error(`Dois arquivos invertidos para o mesmo original: ${entry.arquivo}`)
    invertedFiles.set(entry.original_sha256, { entry, data })
  }
  // Originais identificados pelo conteúdo de cada PNG da pasta (o inventário antigo não lista o "Feliz 2027").
  const originalNameOf = new Map<string, string>()
  for (const file of (await readdir(ORIGINALS)).filter((name) => name.endsWith(".png"))) originalNameOf.set(sha256(await readFile(join(ORIGINALS, file))), file)

  const actor = (await pool.query<{ person_id: string }>(
    `select ua.person_id from user_accounts ua join access_role_assignments ara on ara.user_account_id = ua.id and ara.revoked_at is null
      where ua.email = $1 and ara.organization_id = $2 and ara.role_code = 'ADMINISTRADOR_GERAL' and ara.scope_type = 'ORGANIZATION'`,
    [ACTOR_EMAIL, ORGANIZATION_ID],
  )).rows[0]
  if (!actor) throw new Error(`${ACTOR_EMAIL} não é Administrador geral da organização.`)

  const before = await loadState()
  const imagesOf = (sceneId: string, state = before) => state.images.filter((image) => image.scene_id === sceneId)
  const plan: Array<{ scene: SceneRow; action: "CONFIGURE" | "ALREADY_CONFIGURED"; dayFile: string; nightFile: string; images?: SceneImageInput[] }> = []
  for (const scene of before.scenes) {
    const current = imagesOf(scene.id)
    const primary = current.find((image) => image.is_primary)!
    // Já configurado (rodada anterior): Dia + Noite com as faixas e o par certo.
    const day = current.find((image) => image.label === DAY.label && image.start_minute === slotOf(DAY).start && image.end_minute === slotOf(DAY).end)
    const night = current.find((image) => image.label === NIGHT.label && image.start_minute === slotOf(NIGHT).start && image.end_minute === slotOf(NIGHT).end)
    const knownOriginal = current.map((image) => image.sha256).find((sha) => invertedFiles.has(sha))
    if (current.length === 2 && day && night && knownOriginal) {
      const pair = invertedFiles.get(knownOriginal)!
      const expectedDay = pair.entry.periodo === "dia" ? pair.entry.sha256 : knownOriginal
      const expectedNight = pair.entry.periodo === "noite" ? pair.entry.sha256 : knownOriginal
      if (day.sha256 !== expectedDay || night.sha256 !== expectedNight) throw new Error(`"${scene.name}" tem Dia/Noite com imagens fora do par esperado — conferir à mão.`)
      plan.push({ scene, action: "ALREADY_CONFIGURED", dayFile: pair.entry.periodo === "dia" ? pair.entry.arquivo : originalNameOf.get(knownOriginal) ?? "(padrão)", nightFile: pair.entry.periodo === "noite" ? pair.entry.arquivo : originalNameOf.get(knownOriginal) ?? "(padrão)" })
      continue
    }
    if (current.length !== 1) throw new Error(`"${scene.name}" tem ${current.length} imagens e não é um par conhecido — conferir à mão.`)
    const pair = invertedFiles.get(primary.sha256)
    if (!pair) throw new Error(`"${scene.name}": nenhuma versão com a luz trocada para a imagem atual (${primary.sha256.slice(0, 12)}).`)
    // "Feliz 2027" só na virada 2026/2027; o Ano-Novo 2026 nunca com o ano impresso.
    const isFeliz2027Scene = /feliz 2027/i.test(scene.name)
    const isFeliz2027File = pair.entry.arquivo.includes("feliz-2027")
    if (isFeliz2027Scene !== isFeliz2027File) throw new Error(`"${scene.name}" casaria com ${pair.entry.arquivo} — par inválido para o Feliz 2027.`)
    const existingIsDay = pair.entry.periodo === "noite"
    const existingName = originalNameOf.get(primary.sha256) ?? "(imagem atual do cenário — fora da pasta)"
    const images: SceneImageInput[] = existingIsDay
      ? [
          { id: primary.id, label: DAY.label, slot: slotOf(DAY), isPrimary: true },
          { label: NIGHT.label, slot: slotOf(NIGHT), isPrimary: false, data: pair.data },
        ]
      : [
          { label: DAY.label, slot: slotOf(DAY), isPrimary: true, data: pair.data },
          { id: primary.id, label: NIGHT.label, slot: slotOf(NIGHT), isPrimary: false },
        ]
    plan.push({ scene, action: "CONFIGURE", dayFile: existingIsDay ? existingName : pair.entry.arquivo, nightFile: existingIsDay ? pair.entry.arquivo : existingName, images })
  }

  console.log(`${apply ? "APLICANDO" : "ENSAIO (use --apply para gravar)"} — ${plan.length} cenários, padrão ${before.defaultSceneId}`)
  for (const item of plan) {
    const period = item.scene.schedule_start ? `${item.scene.schedule_start} → ${item.scene.schedule_end}` : "sem período"
    console.log(`  ${item.action === "CONFIGURE" ? "+" : "="} ${item.scene.name.padEnd(34)} ${period.padEnd(25)} Dia: ${item.dayFile.padEnd(48)} Noite: ${item.nightFile}`)
  }
  if (!apply) return

  for (const item of plan) {
    if (item.action !== "CONFIGURE") continue
    await updateScene(pool, { organizationId: ORGANIZATION_ID, personId: actor.person_id }, item.scene.id, { images: item.images })
  }

  // Conferência: mesmos cenários, nomes, períodos, desfoque, escurecimento e padrão; cada um com Dia (principal) e Noite.
  const after = await loadState()
  const problems: string[] = []
  if (after.defaultSceneId !== before.defaultSceneId) problems.push("o cenário padrão mudou")
  if (after.scenes.length !== before.scenes.length) problems.push("a quantidade de cenários mudou")
  for (const scene of before.scenes) {
    const now = after.scenes.find((row) => row.id === scene.id)
    if (!now) { problems.push(`"${scene.name}" sumiu`); continue }
    if (JSON.stringify(now) !== JSON.stringify(scene)) problems.push(`"${scene.name}" mudou nome/período/desfoque/escurecimento`)
    const images = imagesOf(scene.id, after)
    const day = images.find((image) => image.label === DAY.label)
    const night = images.find((image) => image.label === NIGHT.label)
    if (images.length !== 2 || !day?.is_primary || night?.is_primary !== false) problems.push(`"${scene.name}" sem o par Dia (principal) + Noite`)
    if (day && (day.start_minute !== 360 || day.end_minute !== 1080)) problems.push(`"${scene.name}": faixa do dia errada`)
    if (night && (night.start_minute !== 1080 || night.end_minute !== 360)) problems.push(`"${scene.name}": faixa da noite errada`)
  }
  const report = {
    status: problems.length === 0 ? "configured" : "problems",
    verifiedAt: new Date().toISOString(),
    organizationId: ORGANIZATION_ID,
    timeZone: "America/Fortaleza",
    slots: { day: `${DAY.start}–${DAY.end}`, night: `${NIGHT.start}–${NIGHT.end}` },
    defaultSceneId: after.defaultSceneId,
    defaultScenePreserved: after.defaultSceneId === before.defaultSceneId,
    totalScenes: after.scenes.length,
    configuredNow: plan.filter((item) => item.action === "CONFIGURE").length,
    problems,
    scenes: plan.map((item) => {
      const images = imagesOf(item.scene.id, after)
      return {
        id: item.scene.id,
        name: item.scene.name,
        period: item.scene.schedule_start ? { start: item.scene.schedule_start, end: item.scene.schedule_end } : null,
        isDefault: item.scene.id === after.defaultSceneId,
        day: { file: item.dayFile, sha256: images.find((image) => image.label === DAY.label)?.sha256 },
        night: { file: item.nightFile, sha256: images.find((image) => image.label === NIGHT.label)?.sha256 },
        action: item.action,
      }
    }),
  }
  await writeFile(REPORT, `${JSON.stringify(report, null, 2)}\n`)
  console.log(problems.length === 0 ? `OK — ${report.configuredNow} configurados agora; relatório em ${REPORT}` : `PROBLEMAS:\n  ${problems.join("\n  ")}`)
  if (problems.length > 0) process.exitCode = 1
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(() => pool.end())
