import { defineConfig } from "vitest/config"

/**
 * Os testes de domínio mais pesados (massa demo, replays de diagnóstico) levam até ~2 s sozinhos; na suíte completa, com um
 * processo por núcleo e a máquina ocupada, ficam 3–4× mais lentos e estouravam o limite padrão de 5 s sem nenhum erro de
 * lógica. 20 s dá folga para essa variação e ainda derruba um teste que trave de verdade.
 */
export default defineConfig({
  test: {
    testTimeout: 20_000,
    hookTimeout: 20_000,
    // Provas de banco (INIA_DB_PROOF=1) só rodam com o banco de teste em dia com as migrations; sem a variável, não faz nada.
    globalSetup: ["./src/infrastructure/database/testing/proof-database-setup.ts"],
  },
})
