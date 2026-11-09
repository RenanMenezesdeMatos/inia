/** Contrato entre a API (`isolated-parser.ts`) e o processo filho que roda o parser (`isolated-parser-child.ts`). */

/** Código de saída do filho quando a memória residente ou o heap passam do teto. */
export const EXIT_MEMORY = 71
/** Código de saída do filho quando o parser lança erro (arquivo ilegível) — a mensagem vai antes, pelo IPC. */
export const EXIT_FAILED = 72
/** Código de saída do filho quando a API some (canal IPC fechado): o filho nunca fica órfão rodando um parser. */
export const EXIT_ORPHANED = 73

/** `job` é a URL `file:` de um módulo do próprio servidor que exporta `run(input, emit)` — nunca algo vindo do usuário. */
export type ChildRequest = { job: string; input: unknown; heapMb: number; rssMb: number }
export type ChildReply = { ok: true; value: unknown } | { ok: false; message: string }
/** Parte do resultado enviada antes da resposta final (ex.: lote de linhas de uma planilha), na ordem em que o job emitiu. */
export type ChildChunk = { chunk: unknown }
export type ChildMessage = ChildReply | ChildChunk

/** Assinatura do módulo de job: `emit` manda uma parte do resultado à API sem esperar o fim da leitura. */
export type IsolatedJob = { run: (input: unknown, emit: (chunk: unknown) => void) => Promise<unknown> }
