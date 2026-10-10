// RFC 6266: nome ASCII simples no `filename` e o nome real (UTF-8) no `filename*`, para
// acentos em nomes de arquivo chegarem certos no download. Compartilhado pelo router admin da
// Base de Conhecimento e pelo leitor de materiais (`knowledge-material-router.ts`).
export function contentDisposition(type: "inline" | "attachment", filename: string) {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'")
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}
