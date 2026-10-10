import { readFileSync } from "node:fs"
import path from "node:path"

import { buildCaptureSteps, wavDataBytes, type CaptureFixtureJson, type CaptureStep } from "@/lib/avatar/lab/capture-steps"
import { FIXTURE_DIR } from "@/lib/avatar/lipsync/__fixtures__/load-fixture"

/**
 * Apoio de TESTE (só Node): transforma uma captura real do Gemini Live (`gemini-live/<id>.json` +
 * `.wav`) de volta nas MENSAGENS do servidor, na ordem e no instante em que chegaram. A montagem
 * das mensagens é a MESMA do laboratório do avatar no navegador (`lib/avatar/lab/capture-steps.ts`);
 * aqui só se lê do disco.
 */

export type LiveCaptureStep = CaptureStep

export type LiveCapture = { id: string; transcript: string; steps: LiveCaptureStep[] }

export function loadLiveCapture(id: string): LiveCapture {
  const json = JSON.parse(readFileSync(path.join(FIXTURE_DIR, `${id}.json`), "utf8")) as CaptureFixtureJson
  const wav = readFileSync(path.join(FIXTURE_DIR, `${id}.wav`))
  const pcm = wavDataBytes(new Uint8Array(wav.buffer, wav.byteOffset, wav.byteLength))
  return { id, transcript: json.transcript, steps: buildCaptureSteps(json, pcm) }
}
