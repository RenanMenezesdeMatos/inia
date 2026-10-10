import { z } from "zod"

/**
 * O Zod 4 testa `Function("")` na primeira validação para decidir se compila os parsers (JIT). A CSP da interface não tem
 * 'unsafe-eval' (lib/security/content-security-policy.ts), então o teste virava uma violação registrada em toda página e o Zod
 * caía no caminho interpretado de qualquer forma. `jitless` vai direto para esse caminho — mesmo resultado, sem tentar eval.
 * Importado pelo Providers da raiz (primeiro código de cliente de toda página), antes de qualquer validação.
 */
z.config({ jitless: true })
