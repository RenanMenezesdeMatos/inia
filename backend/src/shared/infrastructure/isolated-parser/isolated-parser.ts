import { fork } from "node:child_process"
import { createRequire } from "node:module"
import { extname } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { EXIT_MEMORY, type ChildMessage, type ChildRequest } from "./isolated-parser-protocol.js"

/**
 * PARSER ISOLADO (R-24, achado DATA-1) — arquivo enviado por usuário (PDF, DOCX, XLSX) é lido num processo filho com teto de
 * heap, de memória residente e de tempo. Bomba de descompressão, laço infinito ou falha nativa do parser derruba só o filho; a API
 * recebe um `IsolatedParserError` e segue de pé. As pré-varreduras (`pdf-guard.ts`, `zip-guard.ts`) continuam antes, no processo
 * da API: recusam o caso conhecido sem gastar um processo. Resultado grande (a tabela de uma planilha) volta em partes pelo
 * `onChunk`, na ordem, antes da resposta final.
 *
 * Funciona igual sob tsx/vitest (o filho também é `.ts` e carrega o tsx) e com `node dist/...` em produção, inclusive no
 * Windows: o filho é o mesmo `node` da API (`process.execPath`), sem shell, e o prazo mata com `SIGKILL` (TerminateProcess).
 */
export type IsolatedParserLimits = { heapMb: number; rssMb: number; timeoutMs: number }

/** Manuais reais (docs/manuais, até 14 MB) ficam abaixo de ~170 MB residentes e 0,3 s: o teto dá folga de 4× e recusa a bomba. */
export const ISOLATED_PARSER_LIMITS: IsolatedParserLimits = { heapMb: 512, rssMb: 768, timeoutMs: 30_000 }

export type IsolatedParserFailure = "MEMORY" | "TIMEOUT" | "CRASHED" | "FAILED" | "BUSY"

export class IsolatedParserError extends Error {
  constructor(
    readonly reason: IsolatedParserFailure,
    message: string,
    readonly pid?: number,
  ) {
    super(message)
    this.name = "IsolatedParserError"
  }
}

/** Módulo irmão do chamador com a MESMA extensão: `.ts` sob tsx/vitest (desenvolvimento e testes), `.js` em `dist/` (produção). */
export function siblingModule(callerUrl: string, name: string): URL {
  return new URL(`./${name}${extname(fileURLToPath(callerUrl))}`, callerUrl)
}

const CHILD_ENTRY = fileURLToPath(siblingModule(import.meta.url, "isolated-parser-child"))

/** Em desenvolvimento e nos testes o filho também é TypeScript: carrega o tsx (devDependency — produção roda o `.js` do `dist/`). */
function loaderArgs(): string[] {
  if (extname(CHILD_ENTRY) !== ".ts") return []
  return ["--import", pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href]
}

/** O filho lê arquivo de usuário: não herda os segredos do ambiente da API (banco, chaves, provedores de IA). */
const CHILD_ENV_KEYS = ["PATH", "SystemRoot", "windir", "TEMP", "TMP", "TMPDIR", "NODE_ENV"]

function childEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(CHILD_ENV_KEYS.flatMap((key) => (process.env[key] === undefined ? [] : [[key, process.env[key]]])))
}

/** Recebe, na ordem, cada parte que o job emite antes da resposta final (ex.: lotes de linhas de uma planilha). */
export type IsolatedChunkHandler = (chunk: unknown) => void

function runInChild(job: URL, input: unknown, limits: IsolatedParserLimits, onChunk?: IsolatedChunkHandler): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = fork(CHILD_ENTRY, [], {
      execArgv: [`--max-old-space-size=${limits.heapMb}`, ...loaderArgs()],
      env: childEnv(),
      serialization: "advanced",
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    })
    let parserError: string | undefined
    let timedOut = false
    const deadline = setTimeout(() => {
      timedOut = true
      child.kill("SIGKILL")
    }, limits.timeoutMs)

    child.on("message", (message: ChildMessage) => {
      if ("chunk" in message) {
        if (parserError !== undefined || timedOut) return
        try {
          onChunk?.(message.chunk)
        } catch (error) {
          // Quem recebe as partes recusou uma: a leitura para aqui (nunca uma exceção solta no processo da API).
          parserError = error instanceof Error ? error.message : String(error)
          child.kill("SIGKILL")
        }
        return
      }
      if (!message.ok) {
        parserError ??= message.message
        return
      }
      if (parserError !== undefined) return
      clearTimeout(deadline)
      resolve(message.value)
      child.kill("SIGKILL")
    })
    // Falha só é devolvida depois do `exit`: quem recebe o erro sabe que o filho já terminou.
    child.once("exit", (code, signal) => {
      clearTimeout(deadline)
      if (timedOut) return reject(new IsolatedParserError("TIMEOUT", `A leitura do arquivo passou do prazo de ${limits.timeoutMs} ms.`, child.pid))
      if (code === EXIT_MEMORY) return reject(new IsolatedParserError("MEMORY", `A leitura do arquivo passou do teto de memória (${limits.rssMb} MB).`, child.pid))
      if (parserError !== undefined) return reject(new IsolatedParserError("FAILED", parserError, child.pid))
      reject(new IsolatedParserError("CRASHED", `O processo de leitura do arquivo terminou sem resposta (código ${code}, sinal ${signal}).`, child.pid))
    })
    child.once("error", (error) => {
      // Filho iniciado (falha de IPC ou do kill): o `exit` decide. Sem pid, o processo nem nasceu e o `exit` pode não vir.
      if (child.pid !== undefined) {
        child.kill("SIGKILL")
        return
      }
      clearTimeout(deadline)
      reject(new IsolatedParserError("CRASHED", `Não foi possível iniciar o processo de leitura do arquivo: ${error.message}`))
    })
    child.send({ job: job.href, input, heapMb: limits.heapMb, rssMb: limits.rssMb } satisfies ChildRequest)
  })
}

export type IsolatedParser = <T>(job: URL, input: unknown, limits?: IsolatedParserLimits, onChunk?: IsolatedChunkHandler) => Promise<T>

/**
 * Poucos filhos ao mesmo tempo (cada um pode chegar ao teto de memória) e fila curta: o excesso recebe `BUSY` na hora em vez de
 * empilhar processos. O prazo de cada leitura conta a partir do início do filho, não da espera na fila.
 */
export function createIsolatedParser(options: { maxRunning: number; maxWaiting: number }): IsolatedParser {
  let running = 0
  const waiting: (() => void)[] = []

  async function acquire(): Promise<void> {
    if (running < options.maxRunning) {
      running += 1
      return
    }
    if (waiting.length >= options.maxWaiting) throw new IsolatedParserError("BUSY", "Há muitos arquivos sendo lidos agora.")
    await new Promise<void>((resolve) => waiting.push(resolve))
  }

  function release(): void {
    const next = waiting.shift()
    if (next) next()
    else running -= 1
  }

  return async <T>(job: URL, input: unknown, limits = ISOLATED_PARSER_LIMITS, onChunk?: IsolatedChunkHandler) => {
    await acquire()
    try {
      return (await runInChild(job, input, limits, onChunk)) as T
    } finally {
      release()
    }
  }
}

export const runIsolated = createIsolatedParser({ maxRunning: 2, maxWaiting: 8 })
