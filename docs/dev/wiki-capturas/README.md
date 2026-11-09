# Capturas da Wiki de Workflows

Gera os prints de `/wiki/workflows/exemplos` a partir da tela real do editor, com uma API simulada e dados fictícios. Não usa banco, IA, credenciais nem o ambiente de desenvolvimento compartilhado.

Regere quando um formulário de `frontend/src/components/admin/workflows/` mudar, ou quando um grafo de `demo-graphs.ts` mudar: nenhum teste compara a imagem com a tela.

## Como rodar

Precisa do Google Chrome instalado e de uma cópia do pacote `playwright-core`, apontada por `PLAYWRIGHT_CORE`.

1. Suba a API simulada, a partir da raiz do repositório:

   ```bash
   PORT=3452 FRONT_ORIGIN=http://127.0.0.1:3451 node docs/dev/wiki-capturas/api-simulada.mjs
   ```

2. Copie o frontend para uma pasta temporária, pois o Next recusa um segundo `next dev` na mesma pasta, e suba em `127.0.0.1`, que tem cookies separados de `localhost`:

   ```bash
   mkdir -p /tmp/inia-capturas && rsync -a --exclude node_modules --exclude .next frontend/ /tmp/inia-capturas/ && cp -cR frontend/node_modules /tmp/inia-capturas/node_modules
   ```

   ```bash
   cd /tmp/inia-capturas && env NEXT_PUBLIC_INIA_API_URL=http://127.0.0.1:3452 INIA_API_URL=http://127.0.0.1:3452 npm run dev -- -p 3451 -H 127.0.0.1
   ```

3. Tire os prints. `--apenas=id1,id2` limita a alguns:

   ```bash
   PLAYWRIGHT_CORE=/caminho/para/playwright-core FRONT_URL=http://127.0.0.1:3451 API_URL=http://127.0.0.1:3452 node docs/dev/wiki-capturas/capturar.mjs
   ```

## O que o script faz

- Abre cada Workflow de exemplo no editor, clica no nó e recorta o painel. As imagens vão para `frontend/public/wiki-capturas/workflows/`.
- Calcula as marcações numeradas pela posição dos próprios rótulos na tela, e grava tudo em `frontend/src/components/wiki/workflow-demo/demo-shots.json`. Não edite esse JSON à mão.
- A tela do colaborador é o `/operator` real, com o feedback fictício de `dados-acompanhamento.mjs`.

Para acrescentar um print: inclua uma entrada em `SHOTS` (`capturar.mjs`) e cite o id em `shots` da cena. O teste `demo-catalog.test.ts` cobra que o arquivo exista.
