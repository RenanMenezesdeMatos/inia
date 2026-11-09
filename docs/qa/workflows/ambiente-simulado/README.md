# Ambiente simulado para QA de UX de Workflows

API em memória, com dados fictícios, para abrir o frontend real sem banco, sem IA e sem credenciais. **Nada aqui prova comportamento do backend**: use para ver a tela, simular falhas e repetir a matriz. O que depende do motor, do banco ou de permissões reais precisa do ambiente de desenvolvimento.

## Subir

1. API simulada, a partir da raiz do repositório:

   ```bash
   node docs/qa/workflows/ambiente-simulado/mock-api.mjs
   ```

2. Copie o frontend para uma pasta temporária, pois o Next recusa um segundo `next dev` na mesma pasta. Clonar `node_modules` no APFS leva segundos:

   ```bash
   mkdir -p /tmp/inia-qa-front && rsync -a --exclude node_modules --exclude .next frontend/ /tmp/inia-qa-front/ && cp -cR frontend/node_modules /tmp/inia-qa-front/node_modules
   ```

3. Suba o frontend em `127.0.0.1`, que tem cookies separados de `localhost`, sem tocar na sessão real:

   ```bash
   cd /tmp/inia-qa-front && env NEXT_PUBLIC_INIA_API_URL=http://127.0.0.1:3412 INIA_API_URL=http://127.0.0.1:3412 npm run dev -- -p 3411 -H 127.0.0.1
   ```

4. Em `http://127.0.0.1:3411/auth/login`, entre com qualquer e-mail e senha: a API simulada aceita tudo e não confere nada. Use valores fictícios.

Para testar alterações, repita o `rsync` só de `frontend/src/`.

## Workflows de exemplo

| Rota | Serve para |
|---|---|
| `/admin/workflows/qa-novo` | Fluxo vazio, Gatilho → Fim |
| `/admin/workflows/qa-problemas` | Etapas incompletas, sem nome, com saída sem ligação |
| `/admin/workflows/qa-no-ar` | Publicado e ativo, com execuções em todos os estados |
| `/admin/workflows/qa-alterado` | Publicado, com fluxo salvo diferente |
| `/admin/workflows/qa-config` | Configuração não publicada |
| `/admin/workflows/qa-desligado` | Publicado e desativado |
| `/admin/workflows/qa-grande` | 42 etapas |
| `/admin/workflows/modelo-01` a `modelo-20` | Os modelos oficiais da fixture, como rascunho |

## Simular situações

Abra no navegador ou chame com `curl`:

| URL | Efeito |
|---|---|
| `http://127.0.0.1:3412/__mock/set?failNext=draft` | Próximo salvamento falha com 500 (também `create`, `patch`, `validate`, `publish`) |
| `http://127.0.0.1:3412/__mock/set?slowMs=1500` | Atrasa todas as respostas (`slowMs=0` volta ao normal) |
| `http://127.0.0.1:3412/__mock/set?validateError=WORKFLOW_OUTPUT_RECIPIENT_AMBIGUOUS:nodeId` | Dry-run recusa, apontando a etapa |
| `http://127.0.0.1:3412/__mock/set?access=grupo` | Sessão de admin restrito ao grupo (também `geral` e `nenhum`) |
| `http://127.0.0.1:3412/__mock/requests` | Últimas chamadas recebidas |

O salvamento aceita qualquer rascunho, sem a conferência de formato do schema real. Reiniciar o processo volta tudo ao estado inicial.

## Limites

- Autenticação, escopos, validação de publicação e impacto são aproximações.
- Em aba oculta do navegador embutido, o React Flow só mede depois de um quadro: tire uma captura antes de consultar o DOM.
