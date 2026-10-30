/**
 * Catálogo das capturas reais do Gemini Live que o laboratório do avatar reproduz
 * (`src/lib/avatar/lipsync/__fixtures__/gemini-live/`). É também a LISTA BRANCA da rota que serve
 * os arquivos: só `<id>.json` e `<id>.wav` destes ids — nenhum caminho vindo da URL chega ao disco.
 */

export const LAB_FIXTURES = [
  { id: "frase-01-apresentacao", label: "Frase 1 — apresentação" },
  { id: "frase-02-proposta", label: "Frase 2 — proposta" },
  { id: "frase-03-escolha", label: "Frase 3 — pergunta de escolha" },
  { id: "frase-04-amanha", label: "Frase 4 — números e horário" },
  { id: "frase-05-labiais", label: "Frase 5 — labiais (p/b/m/f/v)" },
  { id: "resposta-longa", label: "Resposta longa (~55 s)" },
  // Voz de produção (Kore), 2026-10-07.
  { id: "kore-frase-01-apresentacao", label: "Kore — apresentação" },
  { id: "kore-frase-04-amanha", label: "Kore — números e horário" },
  { id: "kore-frase-05-labiais", label: "Kore — labiais + \"feedback\"" },
  { id: "kore-numeros", label: "Kore — protocolo, valor, data e hora" },
  { id: "kore-lista-ingles", label: "Kore — lista com palavras em inglês" },
  { id: "kore-voz-pergunta-curta", label: "Kore — resposta a pergunta falada (curta)" },
  { id: "kore-voz-pergunta-longa", label: "Kore — resposta a pergunta falada (longa)" },
  { id: "kore-resposta-longa", label: "Kore — resposta longa (~57 s)" },
  { id: "kore-frase-02-proposta-texto-incompleto", label: "Kore — transcrição parou no meio" },
  { id: "kore-frase-03-escolha-texto-incompleto", label: "Kore — transcrição pulou um trecho" },
  { id: "kore-frase-04-amanha-texto-incompleto", label: "Kore — transcrição só com 2 palavras" },
] as const

export type LabFixtureId = (typeof LAB_FIXTURES)[number]["id"]

export type LabFixtureFileKind = "json" | "wav"

const FIXTURE_IDS: ReadonlySet<string> = new Set(LAB_FIXTURES.map((fixture) => fixture.id))

export function isLabFixtureId(value: string): value is LabFixtureId {
  return FIXTURE_IDS.has(value)
}

/**
 * Nome de arquivo aceito pela rota (`frase-01-apresentacao.wav`). Comparação exata com a lista —
 * nunca `path.basename`/normalização, que aceitariam variações com `..`, barras ou maiúsculas.
 */
export function parseLabFixtureFile(name: string): { id: LabFixtureId; kind: LabFixtureFileKind } | null {
  const match = /^([a-z0-9-]+)\.(json|wav)$/.exec(name)
  if (!match) return null
  const [, id, kind] = match
  if (!isLabFixtureId(id!)) return null
  return { id, kind: kind as LabFixtureFileKind }
}

/** URL servida pela rota de desenvolvimento do laboratório. */
export function labFixtureUrl(id: LabFixtureId, kind: LabFixtureFileKind): string {
  return `/dev/avatar-lab/fixtures/${id}.${kind}`
}

export function labFixtureLabel(id: LabFixtureId): string {
  return LAB_FIXTURES.find((fixture) => fixture.id === id)?.label ?? id
}
