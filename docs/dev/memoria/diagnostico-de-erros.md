# Diagnóstico de erros — telas, catálogo e runbook da VM (11/11/2026)

Pedido: telas de erro com as sete artes, catálogo de códigos e um fluxo de diagnóstico que o administrador da VM consegue seguir
sem Claude, partindo do código e da referência copiados da tela — inclusive pelo terminal, com a interface fora.
Feito na worktree `.claude/worktrees/telas-de-erro` (branch `claude/telas-de-erro`, a partir de 32e364c7).

## Regras que ficam

- **Três campos, nunca misturados**: status HTTP = a resposta; **código** = tipo de falha (o que o catálogo explica);
  **referência** = uma ocorrência (o `x-request-id` da API — gerado pelo navegador em cada chamada do `api-client` ou pela API —,
  `job-<tarefa>-<uuid>`, `proc-<uuid>`, `web-<uuid>` do navegador, ou o `digest` do Next).
- **Contratos preservados**: nenhum status nem código existente mudou. Toda resposta de erro ganhou só `error.reference`; o 500
  mantém `requestId`. Falhas inesperadas continuam 500, agora com código classificado (`INIA-BANCO-INDISPONIVEL`,
  `INIA-BANCO-TIMEOUT`, `INIA-BANCO-CONEXOES-ESGOTADAS`, `INIA-DEPENDENCIA-TIMEOUT`) ou `INTERNAL_ERROR`.
- **Catálogo único** em `backend/src/shared/domain/errors/error-catalog.ts` (`ERROR_CATALOG_VERSION`): entradas completas (causas
  como hipóteses + sinal que confirma, verificações em ordem, comandos da VM, recuperação, escalada, arquivos) + famílias por status
  para os ~880 códigos de regra de negócio, que são INVENTARIADOS do fonte (`domain-error-codes.generated.ts`). Mudou código ou
  mensagem de erro em qualquer módulo? `npm --prefix backend run errors:catalog` — o teste `error-catalog.test.ts` falha até isso.
  Códigos novos seguem `INIA-<MÓDULO>-<CAUSA>` só quando a causa tem tratamento operacional próprio; os antigos ganham aliases.
- **Referência local ≠ registrada**: a tela só diz "registrada no servidor" quando a API confirmou (201 em
  `POST /api/v1/client-errors`, ou a resposta veio da própria API). Offline, fica numa fila no `sessionStorage` e vai quando a rede
  volta. Falha que nasce no proxy (502/503/504 sem `x-inia-release`) diz "procurar no registro do servidor de acesso (IIS)".
- **Log**: chave `failure` (nunca `err` — o serializador do pino troca `err` por `{type,message,stack}` e perde `code`), `time` ISO
  UTC, `service` e `release` (arquivo `RELEASE` da raiz, escrito pelo `instalar-servicos.ps1` a partir do commit; ou `INIA_RELEASE`).
- **Ocorrências** (`error_occurrences`, migration 187): gravação assíncrona com teto por processo (600 graves / 120 comuns por
  minuto), 404 de rota inexistente só no log, retenção `INIA_ERROR_OCCURRENCE_RETENTION_DAYS` (30). Leitura só com
  `support.diagnostics.view` em escopo de organização (papel Administrador geral); vê a própria organização + as sem organização.
- **Arte de sem conexão**: escolhida só no navegador (`useSyncExternalStore`, `null` no servidor) e memorizada por ocorrência; o
  contador entre ocorrências fica no `localStorage`. Escolher no `useState` do render dava arte diferente entre servidor e
  hidratação (visto no ensaio: a mesma arte duas vezes).
- **`/auth/me` com 5xx não é "sem sessão"**: `getCurrentUserFromCookies` agora lança (tela 500 com digest) em vez de mandar ao login
  — com o banco fora a pessoa caía num login que também falhava.

## Ensaio (11/11/2026, equivalente local da VM)

Backend compilado (`node dist/main/server.js --role=api`, `NODE_ENV=production`, sem workers e sem chave de IA), interface em
`next start`, logs em arquivo como o WinSW, proxy local no lugar do IIS (mesmas regras do `web.config`, log W3C com `x-request-id`)
e um repassador TCP na frente do PostgreSQL (`inia_test`, organização temporária) para derrubar/travar o banco só para essa API.
Provado: 404 real; 400/401/403/500/proxy/sem conexão (galeria e tela real); alternância das duas artes sem erro de hidratação;
celular e tema claro sem rolagem lateral; sem conexão com o app aberto preserva o digitado e envia a fila quando volta; incidente
completo com banco fora (tela → Copiar detalhes → log → CLI sem banco → `/ready` 503 → `failure.code` ECONNREFUSED distingue de
57P03 e de `INIA-BANCO-TIMEOUT`, que o travamento produziu); 502 do proxy achado só no log do IIS (0 linhas na API) e registrado
depois pela fila do navegador; 401/403 em chamadas diretas. Scripts e logs do ensaio ficaram fora do Git (scratchpad da sessão).
**Não validado em IIS real** (não havia Windows): os campos personalizados do log do IIS e o comportamento do ARR.

## Pendências

- Formulários um a um ainda mostram só a mensagem (sem faixa código/referência) — ver `docs/operacao/inventario-de-falhas.md`.
- Página de erro própria do IIS (502 com a arte) não configurada: precisa de IIS para validar sem quebrar os 4xx da API.
- Abertura a frio sem internet depende de service worker (não existe).
