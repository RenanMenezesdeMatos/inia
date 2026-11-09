# PDF → Markdown nas bases de conhecimento: levantamento, mudanças e medição

06/11/2026. Implementado no repositório, na branch `claude/pdf-markdown-kb`. **Não publicado em produção.**

## 1. Resultado em uma página

O PDF enviado à base agora vira Markdown (títulos, listas, tabelas) e cada trecho sabe de que página veio, usando só o que já está instalado. Nada novo em manifest, lockfile, serviço ou API.

**O que a medição mostrou, sem arredondar a favor:**

| | Antes | Depois |
|---|---|---|
| Página citada e conferida com o PDF (rodada 1, n = 22) | 0 (o recurso não existia) | **21** |
| Frases inteiras, sem texto de outra coluna no meio (n = 18) | 12 | **18** |
| Valor ligado à linha e à coluna da tabela (n = 17) | 11 | **17** |
| Títulos do documento que viram seção (n = 32) | 0 | **32** |
| Texto entregue à IA por pergunta na busca lexical (mediana, n = 36) | 8.135 caracteres | **4.744** |
| Maior tempo com a API parada, manual de 74 páginas | 2.156 ms | **364 ms** |
| Trecho certo na busca, entre os 3 primeiros (n = 36) | 33 | 34 (empate na prática) |
| Trecho certo no orçamento de 8 trechos (n = 36) | 36 | 36 (**sem ganho**) |
| Resposta com o dado certo (rodada 1, n = 22) | 22 | 21 (**uma perda**, seção 5.3) |

Em resumo: **a busca e o acerto das respostas não melhoraram de forma mensurável nesta amostra.** O ganho medido está na página citada, na estrutura preservada, em menos texto enviado à IA e em menos tempo de API parada. A conversão também custa mais tempo que a extração anterior (seção 5.4).

Gasto com IA: US$ 0,99 em três rodadas com teto garantido, mais cerca de US$ 0,02 no teste de tela (seção 5.3).

## 2. O fluxo que existia

Upload (`knowledge-router.ts`) → validação (`fileContentAccepted`: assinatura e `pdf-guard`) → `extractTextFromFile` (`pdf-parse.getText({ pageJoiner: "" })`, uma string) → `knowledge_versions.content` → publicação (`knowledge-versions.ts`) → `chunkKnowledgeDocument` (divide por `#`) → busca BM25 (`retrieve-knowledge.ts`) ou navegação pela IA (`knowledge-workspace.ts`).

Quem depende de `content`: busca e prompt dos agentes, catálogo e esclarecimento, papéis de seção, catálogo de etapas e Checkpoint Registry, motor de feedback (documento inteiro), comparação de versões, formulário de edição e tela de material.

Problemas concretos no fluxo anterior:

- PDF não tinha `#`: tudo virava "trecho sem título", e a IA escolhia por uma prévia do texto.
- Duas colunas gravadas linha a linha chegavam intercaladas.
- Célula de tabela que quebra em duas linhas misturava texto de colunas vizinhas.
- Nenhuma página associada ao trecho.
- O carimbo "2" numa página digitalizada contava como texto, e nada avisava da página perdida.
- Título de seção virava etapa falsa no catálogo de etapas (`Quando emitir` como passo a cumprir).

## 3. Os 24 projetos

Decisão: **Implementar** = executar o projeto. **Abordagem** = reproduzir a ideia com o que já existe. **Adiar** = serviria, mas o ambiente não comporta. **Descartar** = sem benefício aqui.

Nenhum entrou como **Implementar**: todos exigem instalar algo. As fontes foram os READMEs e as documentações oficiais, consultados em 06/11/2026. "Não detalha" significa que a fonte lida não explica.

### Extração, OCR e conversão

| Projeto | Caso de uso na INIA | Benefício esperado | Requisitos | Decisão e motivo |
|---|---|---|---|---|
| olmOCR | Ler páginas digitalizadas | OCR de boa qualidade | Python, GPU ≥ 12 GB ou servidor remoto, imagem de ~30 GB | **Adiar**: exige GPU ou API externa |
| Surya | Layout e OCR | Ordem de leitura por modelo | Python, torch, modelo; pesos com restrição comercial | **Adiar**: modelo a instalar e licença a avaliar |
| PDFMathTranslate | Nenhum | Tradução mantendo layout | Python, modelo, AGPL | **Descartar**: não há necessidade de tradução |
| Marker | PDF → Markdown | Referência direta para o pipeline | Python, torch, modelo; pesos com restrição | **Abordagem**: texto embutido primeiro, conferir página a página, tabela pela camada de texto, tirar margens |
| Umi-OCR | OCR em lote | Interface pronta | Programa de desktop com motores empacotados | **Adiar**: é aplicativo, não componente de servidor |
| Docling | PDF → Markdown e JSON | Layout e tabelas por modelo | Python; modelos não detalhados | **Adiar**: é a primeira opção se o ambiente aceitar Python |
| Tesseract | OCR das páginas `NO_TEXT` | Aproveitar as páginas digitalizadas | Binário e `traineddata` | **Adiar**: existe na máquina de desenvolvimento, não na implantação. É a primeira opção de OCR, se autorizado |
| MinerU | PDF → Markdown | Localizador estável `doc/page/block` | Python, modelos; licença própria | **Abordagem**: a página associada ao trecho veio dessa ideia (`extraction.pages[].offset`) |
| PaddleOCR | OCR e estrutura | Junta tabela entre páginas | Python, PaddlePaddle, modelos | **Abordagem**: juntar tabela que atravessa a página. Executar: adiar |

### Consulta a documentos e pesquisa com fontes

| Projeto | Caso de uso na INIA | Benefício esperado | Requisitos | Decisão e motivo |
|---|---|---|---|---|
| PaperQA | Citar documento e página | Resposta verificável | Python, LLM, embeddings | **Abordagem**: fonte com página. Aqui ela vem do sistema, nunca do modelo |
| SurfSense | Nenhum novo | Produto completo parecido | Docker, modelo; parser não detalhado | **Descartar**: a fonte não detalha técnica aproveitável |
| Kotaemon | Abrir o PDF na citação | Conferência rápida | Python, banco vetorial | **Abordagem**: link que abre na página. Destacar o trecho ficou de fora (a fonte não detalha como) |
| GPT Researcher | Nenhum | Pesquisa na web | Python, API de busca | **Descartar**: a INIA não pesquisa na internet |
| STORM | Nenhum | Relatório longo da web | Python, API de busca | **Descartar**: mesmo motivo |
| Khoj | Nenhum novo | Assistente pessoal | AGPL, Docker | **Descartar**: a fonte não detalha técnica aproveitável |
| Open Notebook | Mostrar o que vai para a IA | Transparência | Python, SurrealDB, Docker | **Abordagem**: aba "O que a IA lê" |
| PrivateGPT | Nenhum | Camada de API | Python, servidor de modelo | **Descartar**: a INIA já tem o gateway de IA |
| GPT Academic | Nenhum | Leitura acadêmica | GPL, Python | **Descartar**: outro público |

### Organização, colaboração e utilitários

| Projeto | Caso de uso na INIA | Benefício esperado | Requisitos | Decisão e motivo |
|---|---|---|---|---|
| Karakeep | Guardar o original | Evita perda | AGPL, Docker, Meilisearch | **Descartar**: a INIA já guarda o original por versão |
| Meetily | Reprocessar a partir do original | Refazer sem reenviar | Tauri, Whisper | **Abordagem**: "Reprocessar arquivo original". O produto em si é de áudio |
| Paperless-ngx | OCR só onde falta texto; original × arquivado | Critério claro | GPL, Docker, OCR | **Abordagem**: tratar o digitalizado à parte e nunca tocar no original. Modo `auto` confirmado na documentação de configuração |
| AFFiNE | Nenhum | Espaço de trabalho | Docker | **Descartar**: a fonte não trata de PDF |
| AppFlowy | Nenhum | Espaço de trabalho | AGPL, Flutter, Rust | **Descartar**: a fonte não trata de PDF |
| Stirling-PDF | Nenhum novo | Ferramentas de PDF | Docker; partes proprietárias | **Descartar**: serviço à parte, e a fonte não detalha OCR parcial nem comparação |

A página do MinerU trazia instruções dirigidas a agentes de IA (instalar uma skill, salvar preferência). Foram ignoradas e não vieram de quem pediu este trabalho.

### Recursos de experiência: o que já existia

| Recurso | Antes | Agora |
|---|---|---|
| Prévia do que a IA recebe | Só abrindo a edição do texto, sem os trechos | Aba "O que a IA lê": os trechos reais, com seção e página |
| Indicação de páginas sem texto | Não havia | Cobertura por página, com botão que abre cada uma |
| Navegação até a página citada | Leitor abria sempre na página 1 | Link da fonte abre na página; avisa se a versão mudou |
| Comparação de versões | Já existia | Mantida, com aviso quando é o mesmo arquivo convertido de outra forma |
| Reprocessar o original | Só reenviando o arquivo | Botão que gera rascunho, sem mudar o que está em uso |

## 4. O que foi implementado

**Conversão**

- `backend/src/modules/knowledge/domain/pdf-markdown/`: função pura, sem pdf.js.
  - `layout.ts`: tipos e `PDF_MARKDOWN_VERSION`.
  - `lines.ts`: linhas, ordem de leitura e colunas.
  - `tables.ts`: tabelas pelas tags, por grade desenhada ou por colunas alinhadas.
  - `pdf-markdown.ts`: títulos, listas, código, parágrafos, margens repetidas, cobertura.
  - `page-map.ts`: página de cada trecho, sem mudar a divisão em trechos.
- `backend/src/modules/knowledge/infrastructure/pdf-layout-reader.ts`: lê do pdf.js que o `pdf-parse` já traz.
- `backend/src/modules/knowledge/infrastructure/text-extractor.ts`: `extractKnowledgeFile`. Se a conversão falhar, usa o texto corrido e o envio continua.

Por que não `pdf-parse.getTable()`: nos manuais reais achou 0 tabelas (a borda é retângulo preenchido, e ele só olha traços) e leu caixas de diagrama como tabela de uma coluna.

Regras de não inventar:

- As tags do PDF valem primeiro. Sem tags, a aparência; sem evidência, texto como está.
- Duas linhas alinhadas não fazem tabela (mínimo 3). Caixa de diagrama também não.
- Sem cabeçalho distinto, a primeira linha não é promovida a cabeçalho.
- Célula vazia fica vazia. Hífen no fim da linha só some se o próprio documento usa a palavra inteira.
- Se a estrutura deixar mais de 2% das letras da página de fora, a página sai como linhas simples.

**Fluxo real**

- `backend/migrations/176_knowledge_version_extraction.sql`: coluna `extraction`, imutável fora do rascunho como o conteúdo.
- `knowledge-versions.ts`: registro no rascunho, na reversão e na edição (a origem das páginas acompanha as linhas mantidas).
- `knowledge-router.ts`: `POST /:id/reprocess` e `GET /:id/versions/:versionId/ai-preview`, com as mesmas permissões e validações do resto.
- `retrieve-knowledge.ts`, `knowledge-catalog.ts`, `knowledge-workspace.ts`, `clarification-state.ts`: página no trecho, na fonte e no prompt, só em PDF com registro. As demais bases saem no prompt byte a byte como antes.
- `knowledge-version-diff.ts`, `knowledge-version-history.ts`: comparação por palavras quando é o mesmo arquivo.

**Tela**

- `frontend/src/components/admin/knowledge/knowledge-ai-preview.tsx` (novo), `knowledge-detail-page.tsx`, `knowledge-pdf-viewer.tsx`, `knowledge-file-preview.tsx`, `knowledge-version-history/version-compare-dialog.tsx`.
- `frontend/src/components/knowledge-clarification/knowledge-sources.tsx`, `frontend/src/components/knowledge-material/knowledge-material-page.tsx`, `frontend/src/app/(app)/materiais/[id]/page.tsx`.
- Wiki: `/wiki/bases-conhecimento#pdf`.

**Compatibilidade**

- Nenhuma versão existente muda. `extraction` nulo continua funcionando em todos os caminhos.
- A divisão em trechos não mudou (`chunkKnowledgeDocument` intacto).
- Reprocessar só cria rascunho; publicar é decisão de quem administra.
- Comparações, citações e catálogo de etapas foram conferidos antes de mudar o conteúdo: a prova `knowledge-version-lifecycle-proof` passa sem alteração, e nenhuma linha de tabela virou etapa (ver seção 5.5).

## 5. Medição

Corpus (`backend/scripts/dev/pdf-markdown-eval/`). Conteúdo fictício, exceto os dois manuais do projeto, usados só sem IA.

| PDF | Páginas | Como é |
|---|---|---|
| `simples` | 3 | Digital simples, sem tags |
| `manual-tabelas` | 6 | Grade em traço e em retângulo fino, colunas sem grade, célula que quebra, tabela entre páginas |
| `duas-colunas-linha` | 2 | Duas colunas gravadas linha a linha |
| `duas-colunas-coluna` | 2 | Duas colunas gravadas coluna a coluna |
| `escaneado` | 1 | Só imagem JPEG |
| `escaneado-40-paginas` | 40 | Só imagem: pior caso de tempo |
| `misto` | 5 | Texto, digitalizadas (p. 2 e 4) e texto com imagem grande (p. 3) |
| `manual-chrome-tags` | 3 | Fontes reais embutidas, com tags (gerado pelo Chrome) |
| `manual-chrome-sem-tags` | 3 | O mesmo, sem tags |
| `it-013` / `it-008` | 39 / 74 | Manuais reais do projeto |

**Gabarito ampliado no caminho, às claras:** depois da 1ª rodada sem IA, porque toda célula cabia em uma linha e nada distinguia as versões (casos W e relações de célula que quebra). Depois da 1ª rodada com IA, para investigar a perda (casos X). Uma página errada do gabarito (R1, R2, R4) foi corrigida pelo texto de cada página do PDF, sem olhar o conversor.

### 5.1 O que cada página forneceu

| PDF | Páginas com texto: antes → depois | Títulos | Tabelas | Trechos |
|---|---|---|---|---|
| `simples` | 3 → 3 | 0 → 7 de 7 | — | 2 → 7 |
| `manual-tabelas` | 6 → 6 | 0 → 7 de 7 | 0 → 5 | 4 → 8 |
| `duas-colunas-linha` | 2 → 2 | 0 → 1 de 1 | — | 2 → 3 |
| `duas-colunas-coluna` | 2 → 2 | 0 → 1 de 1 | — | 2 → 3 |
| `misto` | 5 → 3, **p. 2 e 4 apontadas como sem texto** (antes, o carimbo com o número da página contava como texto) | 0 → 4 de 4 | — | 1 → 4 |
| `escaneado` | 0 → 0, recusado com a explicação | — | — | 0 |
| `manual-chrome-tags` | 3 → 3 | 0 → 6 de 6 | 0 → 3 | 2 → 6 |
| `manual-chrome-sem-tags` | 3 → 3 | 0 → 6 de 6 | 0 → 3 | 2 → 6 |
| `it-013` | 39 → 39, 9 com imagem grande | 0 → 61 (sem gabarito) | 0 → 53 (sem gabarito) | 65 → 77 |
| `it-008` | 74 → 74, 32 com imagem grande | 0 → 54 (sem gabarito) | 0 → 124 (sem gabarito) | 127 → 136 |

Relações e texto:

- **Valor na linha e na coluna certas:** antes 11 de 17 (só "na mesma linha"; não havia ligação com a coluna), depois 17 de 17. As 6 perdas de antes são todas de célula que quebra.
- **Cabeçalho no mesmo trecho que o valor:** antes 15 de 17, depois 17 de 17.
- **Frases inteiras:** antes 12 de 18, depois 18 de 18. As 6 de antes: 5 em duas colunas gravadas linha a linha e 1 palavra partida por hífen.
- **Palavras perdidas fora de cabeçalho e rodapé:** 0 em todos os PDFs, inclusive 19.587 palavras no `it-008` e 9.965 no `it-013`. A exceção são os 2 números de página carimbados nas digitalizadas do `misto`, que saem de propósito.

### 5.2 Busca (sem IA)

Mesma função de produção, mesmo orçamento (8 trechos, 9.000 caracteres), todas as bases juntas, n = 36 perguntas.

| | Antes | Depois |
|---|---|---|
| Trecho certo entre os 3 primeiros | 33 | 34 |
| Trecho certo no orçamento | 36 | 36 |
| Página certa no trecho | 0 | 36 (31 em uma página só; 5 em intervalo como `p. 1–2`) |
| Tamanho do trecho certo (mediana) | 1.209 caracteres | 651 |
| Texto enviado por pergunta (mediana) | 8.135 caracteres | 4.744 |

Mudanças de posição: X1 subiu de 5º para 3º; R3 caiu de 6º para 7º, ainda no orçamento. **A busca não melhorou nesta amostra**: as bases são pequenas e cada trecho antigo já continha o dado. Em bases grandes pode ser diferente: é hipótese, não medida.

### 5.3 Respostas (com IA)

`gemini-3.8-flash`, serviço de esclarecimento de produção, mesmos prompts nos dois lados e ordem alternada. O envio é direto ao provedor, com limite de saída de 8.192 tokens, para o teto ser garantido; a rota do ambiente não envia limite. Respostas fora do roteiro foram lidas uma a uma.

| Rodada | Amostra | Dado certo: antes | Dado certo: depois | Página conferida: depois | Custo |
|---|---|---|---|---|---|
| 1. Geral | 11 perguntas × 2 amostras | 22 de 22 | **21 de 22** | 21 de 22 | US$ 0,5118 |
| 2. Dado sob título que não o menciona | 5 perguntas × até 4 amostras (o teto cortou 2 execuções) | 17 de 19 | 19 de 19 | 19 de 19 | US$ 0,3647 |
| 3. Código final | 11 perguntas × 1 amostra, só depois | — | 11 de 11 | 11 de 11 | US$ 0,1138 |

"Página conferida" compara, sem usar o conversor, as palavras do dado com o texto da página citada do PDF. Antes não havia página para conferir (0 em todas).

**A perda, examinada:** na rodada 1, a pergunta W4 ("Quando se aplica a devolução em dobro?") recebeu "não encontrei" em 1 de 2 amostras. O dado está numa tabela sob "2.1 Quem decide cada exceção", título que não menciona devolução, e a IA leu "4. Prazos de devolução de valores". Antes, a prévia de um trecho sem título mostrava parte desse texto. Repetida 4 vezes na rodada 2, W4 acertou 4 de 4, e o lado anterior errou casos parecidos (X3: 2 de 4). Por isso **não mudei o prompt**. É risco real, de baixa frequência nesta amostra, e não está eliminado.

Pergunta sem resposta nos textos (E1, dado só em imagem): nenhum lado afirmou o valor que só existe na página digitalizada, em 5 execuções.

Nas rodadas 1 e 2 também: tempo mediano 13,2 → 13,4 s e 13,3 → 15,0 s; 3 chamadas por pergunta nos dois lados; tokens de entrada 193.477 → 177.948 na rodada 1. Diferenças dentro da variação, sem ganho de velocidade comprovado.

Em duas perguntas, reprovações automáticas foram revistas lendo a resposta. W4: "após a data" estava certo, e o critério pedia "depois da data"; o gabarito foi corrigido e vale para as duas colunas. C3: o dado estava certo em outra base que também o traz; a página conferiu nela.

### 5.4 Tempo

Mediana de 5 execuções, ordem alternada, mesma máquina. A coluna da máquina quieta foi medida antes das últimas correções do conversor, que não tocam na leitura do arquivo.

| PDF | Máquina quieta | Máquina ocupada (rodada final) |
|---|---|---|
| `simples` (3 p.) | 1 → 2 ms | 4 → 9 ms |
| `manual-tabelas` (6 p.) | 2 → 5 ms | 16 → 51 ms |
| `it-013` (39 p., 3,7 MB) | 100 → 260 ms | 771 → 2.127 ms |
| `it-008` (74 p., 10,8 MB) | 183 → 467 ms | 1.603 → 3.935 ms |
| `escaneado-40-paginas` | 3 → 8 ms | 23 → 22 ms |

**A conversão custa cerca de 2,5 vezes a extração anterior**, sempre só no envio ou no reprocessamento, nunca na consulta. Sem regressão perceptível em PDF simples (milissegundos).

Dois problemas foram encontrados e corrigidos antes de medir:

- **Decodificar imagens** era 90% do tempo (9,5 s × 1,7 s no `it-008`) e não serve para nada aqui. Agora a imagem é reconhecida pela matriz que a posiciona. Em 11 PDFs, todas as páginas receberam a mesma classificação com e sem decodificar.
- **O pdf.js no Node não devolve o controle à API.** Agora há uma pausa entre as páginas. Maior tempo com a API parada, no `it-008`: 2.156 ms antes e 364 ms depois. No `manual-tabelas`, uma medição isolada subiu de 21 para 217 ms, sem padrão reprodutível nas medianas: tratei como ruído, não como ganho nem perda.

### 5.5 Catálogo de etapas

Sem IA, pelo extrator de produção. Nenhuma linha de tabela virou etapa em nenhum dos 3 PDFs conferidos. Candidatos: `simples` 18 → 9, `manual-tabelas` 17 → 7, `manual-chrome-tags` 4 → 4. A redução vem de títulos e frases partidas que deixaram de virar etapa. **O motor de feedback não foi medido** com bases convertidas (seção 7).

### 5.6 Tela, verificada no fluxo real

Pilha isolada (código desta branch, cópia do banco de teste, host próprio), no navegador:

| Verificado | Resultado |
|---|---|
| Envio de PDF pelo formulário | Base criada, cobertura aparece no detalhe |
| Cobertura de PDF misto | "3 de 5 páginas lidas", p. 2 e 4 sem texto, p. 3 com imagem grande |
| Botão da página | Abre o PDF na página; pedir a mesma página de novo também leva até ela |
| "O que a IA lê" | Trechos com seção e página; versão antiga avisa que usa a leitura anterior |
| Reprocessar | Rascunho V2 criado, V1 continua em uso |
| Comparar V1 com V2 | "Sem mudança no arquivo", aviso de reconversão, palavras só em cada versão |
| Chat do operador | Resposta certa, com "3. Regras regionais · p. 2" nas fontes |
| Link da fonte | Abre o material na página 2 (conferido pelos pixels da página desenhada) |
| Citação de versão anterior | Avisa que o conteúdo pode estar em outra página |

Essa pergunta do chat foi digitada com a voz ligada e seguiu pelo caminho da voz; o caminho só de texto usa o mesmo serviço e a mesma lista de fontes, mas não foi repetido na tela. Sem o painel visível, a captura de tela do leitor saiu em branco: a página foi conferida pelo `data-page-number` e pelos pixels do canvas, não a olho.

## 6. Como verifiquei que roda no ambiente atual

- **Manifests:** `package.json` e `package-lock.json` sem nenhuma alteração. `pdfjs-dist` 5.4.296 e `@napi-rs/canvas-win32-x64-msvc` 0.1.80 já estão no lockfile do backend, instalados por `npm run install:all` (`npm ci`).
- **Implantação:** `deploy/windows` e `scripts/install` não instalam Python, Tesseract nem Poppler. O OCR não entrou por isso. `tesseract` existe só na minha máquina. A camada de IA não envia imagem a nenhum modelo hoje (`inlineData` aparece apenas em áudio), então OCR por IA seria um fluxo de dados novo, a autorizar.
- **Sem o binário do canvas:** simulei o `@napi-rs/canvas` ausente. O `pdf.js` não carrega, e **o `pdf-parse` de hoje falha igual**: é o mesmo pré-requisito de antes, não um novo.
- **Importação direta:** o leitor importa `pdfjs-dist/legacy/build/pdf.mjs`, o mesmo módulo que o `pdf-parse` carrega. Ele não está declarado no `package.json` do backend por decisão (a restrição proíbe mexer em manifest); a versão vem do `pdf-parse`, travada no lockfile.
- **Não verificado:** nada rodou em Windows nem em servidor. Não tive acesso autorizado a inspecionar a VM ou a homologação; a conclusão vem dos arquivos de implantação e do lockfile.
- **Build:** `npm run build` do backend e `next build` do frontend passam; o extrator compilado em `dist` converteu o PDF misto com as páginas certas. A compilação rodou no Mac, não no Windows.
- **Testes, com o código final:** frontend 2.358 passam. Provas de banco (`pdf-markdown-proof`, `knowledge-version-lifecycle-proof`, `live-knowledge-version-proof`, `knowledge-material-access-proof`, `agent-knowledge-scope-proof`): 37 passam numa cópia isolada do banco de teste. Backend: 5.545 passam e 2 falharam na suíte completa com a máquina sob carga (`performance-generator`, `indicator-diagnosis-evidence-roles`). As duas passam sozinhas e são de código não tocado; numa execução anterior, a instável tinha sido outra (`http-security`), que também passa sozinha.

## 6.1 Imagens e leitura como conteúdo (acréscimo de 06/11/2026)

Pedido depois da primeira entrega: as instruções de trabalho trazem prints do processo, e a pessoa precisa vê-los mesmo que a IA não leia. Com o texto e os prints em mãos, a página do material passou a abrir como um conteúdo cadastrado, com o PDF original a um clique.

| PDF | Tamanho | Imagens | Guardadas (WebP q90) | Em PNG | Leitura total | Maior pausa da API |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| IT-INIA-008 (74 págs.) | 10,8 MB | 92 | 6,18 MB | 36,0 MB | 7,3 s | 181 ms |
| IT-INIA-013 (39 págs.) | 3,7 MB | 39 | 2,02 MB | 11,4 MB | 2,4 s | 321 ms |
| IT-INIA-012 | 16,8 MB | 96 | 8,35 MB | não medido | 10,2 s | 153 ms |
| IT-INIA-005 | 1,7 MB | 10 | 0,94 MB | não medido | 1,1 s | 56 ms |

Nos 9 PDFs conferidos, o Markdown ficou idêntico, caractere por caractere, ao gerado sem a leitura das imagens. Todas as imagens caíram num trecho, e nenhuma ficou fora de um fim de linha. O upload real do IT-INIA-008 pela API levou 7 s, e a maior espera da API durante ele foi de 306 ms.

Conferido no fluxo real, em banco isolado: leitura como conteúdo, troca para o PDF, salto para a página citada, "O que a IA lê", celular (375 px, sem rolagem lateral) e uma pergunta real no chat, respondida pelo texto com 5 imagens da seção abaixo. A IA não recebe imagens: não houve rodada de medição de respostas porque o texto e os prompts não mudam.

Decisões, armadilhas e limites: [memória da área](../memoria/agentes-e-conhecimento.md), seção "Imagens dos PDFs e leitura como conteúdo".

## 6.2 PDF digitalizado: leitura por OCR (acréscimo de 07/11/2026)

O pedido foi que um PDF sem texto selecionável virasse texto e prints recortados, com o OCR dentro do código, porque nada pode ser instalado na VM de produção. O motor é o Tesseract compilado em WebAssembly, com o português, nos arquivos de `backend/vendor/tesseract/`.

**Leitura do texto**, numa amostra de 8 páginas reais (2.018 palavras, 289 com acento):

| Motor | Palavras reais lidas | Acentos certos | Tempo por página (Mac) |
| --- | ---: | ---: | ---: |
| Tesseract instalado, só com inglês | 83% | 19 de 289 | 0,8 s |
| WebAssembly + português rápido (`tessdata_fast`), o escolhido | 98% | 286 de 289 | 1,2 s |
| WebAssembly + português preciso (`tessdata_best`) | 98% | 286 de 289 | 3,3 s |

**O que é print.** As posições reais dos prints vêm da camada de texto dos próprios manuais: as páginas foram desenhadas como imagem e lidas pelo OCR, e a resposta certa era conhecida. A regra foi travada no conjunto do ajuste antes de olhar os outros três. "Texto real perdido" conta palavras do documento que caíram numa área cortada.

| Conjunto | Prints | Regra: achados | Regra: áreas erradas | Regra: texto real perdido | Classificação do Tesseract: texto real perdido |
| --- | ---: | ---: | ---: | ---: | ---: |
| Manuais do ajuste (5) | 141 | 132 | 5 | 0 de 35.226 | 31 |
| Manuais novos (3) | 159 | 43 | 18 | 0 de 63.632 | 320 |
| 8 manuais inéditos | 159 | 84 | 20 | 0 de 56.983 | 377 |
| Escaneamento simulado dos 3 novos | 142 | 29 | 42 | 105 de 57.021 | 422 |
| Escaneamento simulado dos 8 inéditos | 159 | 85 | 23 | 26 de 56.957 | não medido |

A classificação do próprio Tesseract (blocos de imagem do hOCR) achou menos prints e tirou texto real em todos os conjuntos. Somada à regra, achou de 3 a 31 prints a mais e tirou de 11 a 372 palavras reais. Por isso ela não entrou. No escaneamento simulado, a regra cortou como imagem duas áreas de texto pequeno com fundo (uma tabela e um quadro). Duas correções declaradas antes da validação ("limite 0,75" e "faixa de cor sólida não corta") não evitaram a perda no escaneamento dos 8 inéditos e ficaram de fora.

**A leitura de verdade sem os prints**, nas páginas com print, com a página pintada de branco onde o print foi cortado e lida de novo:

| Conjunto | Texto real lido: inteira → sem os prints | Palavras que não são do documento |
| --- | ---: | ---: |
| 8 manuais inéditos | 98% → 97% | 13.590 → 8.812 |
| Escaneamento simulado dos 8 inéditos | 97% → 98% | 12.885 → 8.809 |

O que sobra de palavras indevidas vem dos prints não achados: eles continuam como texto, e com erros.

**Estrutura**, em 6 manuais (até 20 páginas cada), comparando o Markdown pelo OCR com o da camada de texto do mesmo PDF e com os prints de verdade fora dos dois lados:

| Tamanho da letra | Títulos que não batiam | Títulos achados | Níveis coerentes | Palavras |
| --- | ---: | ---: | ---: | ---: |
| Altura da linha do Tesseract, como veio | 31 de 165 | 132 de 136 | 90% | 97,3% |
| Corpo ±18% vale como corpo, e degraus de 25% acima (o escolhido) | 12 de 137 | 125 de 136 | 95% | 97,3% |

A maioria dos 12 é texto grande da capa. O resto: uma linha quebrada do título e um erro de leitura ("Cc8 — Compilar"). Os 11 títulos não achados se distinguem só pelo negrito, que o OCR não dá: ficam como parágrafo, sem invenção. A calibração do tamanho, em 821 linhas, deu à altura da linha do Tesseract uma razão mediana de 0,936 do tamanho real.

**Tempo:** um PDF digitalizado de 40 páginas foi lido em 54 s neste Mac, medido antes de a leitura ir para o processo filho com teto de memória (R-24), onde ela roda agora com o pdf.js e o motor, sem passar pela thread principal da API nem do processamento. O motor ocupa 78 MB. Na VM, a velocidade não foi medida.

**Não verificado:** Windows Server 2016 (ensaiar na homologação da Azure antes da VM da empresa), a velocidade lá e um PDF escaneado de verdade. Os escaneados daqui são páginas desenhadas, ou essas páginas com papel tingido, ruído e 0,3° de inclinação.

## 7. Limitações e pendências

**Medido, mas limitado**

- Amostra pequena: 22 respostas na rodada principal, sobre documentos pequenos e fictícios. Serve para achar defeito, não para afirmar taxa.
- Modelo de teste é Gemini. O modelo de destino da Vivo não está acessível aqui.

**Não medido (hipóteses)**

- Ganho na busca em bases grandes.
- PDF exportado do Word ou Acrobat: não há nenhum no corpus. O código cobre as bordas em retângulo fino e as tags, mas nunca viu um arquivo real desses.
- **Motor de feedback com base convertida.** O código dele não mudou, mas o texto que ele recebe muda quando uma base PDF é reprocessada e publicada. Recomendo testar com uma base antes de reprocessar em massa. Publicar também sincroniza o Checkpoint Registry, e as etapas passam a ser outras.

**Não feito**

- OCR feito em 07/11/2026 (seção 6.2). Ficou de fora: as bordas das tabelas de página digitalizada (a tabela é montada só pela posição das colunas: em 8 páginas da IT-005, 7 de 11 tabelas saíram como tabela, uma célula de duas linhas virou duas linhas, e o conteúdo das outras 4 saiu como texto), negrito e o que passa de 300 páginas digitalizadas por documento.
- Destaque do trecho dentro do PDF. O link leva à página, não à frase.
- Página nas respostas fora do esclarecimento: o especialista recebe `[Seção · p. 3]` no prompt, mas a tela não mostra citação nesse caminho, e o material de apoio abre sem página.
- DOCX continua como texto corrido (`mammoth.extractRawText`).
- Reprocessar em lote: é uma base por vez.
- Trecho que cruza a página aparece como intervalo (`p. 1–2`): a divisão em trechos ficou intacta de propósito, porque é contrato do catálogo de etapas.

**Antes de produção:** aplicar as migrations 176, 178 e 179. O restante vem com o código, inclusive o motor de OCR (`backend/vendor/tesseract/`). Para rodar as provas de banco em `inia_test`, antes `npm run db:migrate:test`.

## 8. Como reproduzir

Sem IA, sem custo, sem banco:

```bash
cd backend
npx tsx scripts/dev/pdf-markdown-eval/generate-corpus.ts /caminho/corpus
npx tsx scripts/dev/pdf-markdown-eval/measure-offline.ts /caminho/corpus /caminho/sem-ia.json
```

`generate-corpus.ts` usa o Google Chrome, se houver, para os dois PDFs de navegador. Ele só fabrica arquivos de teste.

Conferir o que chegaria à IA, sem chamar a IA:

```bash
npx tsx scripts/dev/pdf-markdown-eval/measure-answers.ts /caminho/corpus /caminho/ensaio
```

Com IA (paga, com teto garantido por reserva antes de cada chamada, em `call-budget.ts`):

```bash
INIA_PDF_EVAL_PAID=1 GEMINI_API_KEY=... npx tsx scripts/dev/pdf-markdown-eval/measure-answers.ts /caminho/corpus /caminho/respostas --run --teto=1 --amostras=2
npx tsx scripts/dev/pdf-markdown-eval/report-answers.ts /caminho/corpus /caminho/respostas
```

Opções: `--perguntas=W4,X1` e `--lados=depois`. O preço fixado no script é o de `ai_model_pricing` em 06/11/2026; confira antes de rodar. Rodar com outros valores não é comparável.

Provas:

```bash
npx vitest run src/modules/knowledge/domain/pdf-markdown
INIA_DB_PROOF=1 npx vitest run pdf-markdown-proof
```

Resultados desta rodada, com as respostas da IA: `docs/dev/pdf-para-markdown/resultados/`.
