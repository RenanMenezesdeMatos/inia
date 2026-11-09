/**
 * Jobs de teste do parser isolado (rodam no processo filho): cada modo imita um parser — normal, travado num laço síncrono,
 * comendo heap, comendo memória fora do heap (como o pdf.js descompactando um fluxo), lançando erro ou devolvendo o resultado
 * em partes (como a planilha em lotes de linhas).
 */
export type TestJobInput = { mode: "echo" | "hang" | "heap" | "offheap" | "throw" | "chunks"; data?: Uint8Array; chunks?: number }

export async function run(input: TestJobInput, emit: (chunk: unknown) => void): Promise<unknown> {
  if (input.mode === "echo") return { pid: process.pid, bytes: input.data?.byteLength ?? 0, last: input.data?.at(-1) ?? null, env: Object.keys(process.env) }
  if (input.mode === "throw") throw new Error("Invalid PDF structure")
  if (input.mode === "chunks") {
    for (let index = 0; index < (input.chunks ?? 0); index += 1) emit({ index, rows: [[index, `linha ${index}`]] })
    return { pid: process.pid, chunks: input.chunks ?? 0 }
  }
  const keep: unknown[] = []
  for (;;) {
    if (input.mode === "heap") keep.push({ value: Math.random(), list: [1, 2, 3] })
    if (input.mode === "offheap") keep.push(new Uint8Array(8 * 1024 * 1024).fill(1))
  }
}
