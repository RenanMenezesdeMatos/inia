import path from "node:path"
import { defineConfig } from "vitest/config"

// Espelha o path alias "@/*" já declarado em tsconfig.json — sem isto, vitest (que roda em cima
// do resolver do Vite, não do tsc) não sabe resolver "@/..." e qualquer módulo testado que use
// esse alias (a maioria do código de admin/workflows) falha com "Cannot find package".
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  test: {
    setupFiles: ["./vitest.setup.ts"],
    // A máquina de desenvolvimento roda várias sessões em paralelo (carga de 10 a 50+ medida em 2026-10-07) e os testes
    // de jsdom são presos à CPU: 5 s (o padrão) confundia máquina ocupada com teste travado. Um teste travado continua
    // falhando — só demora 15 s para dizer.
    testTimeout: 15_000,
  },
})
