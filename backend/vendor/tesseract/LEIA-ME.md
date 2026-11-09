# Motor de OCR das bases de conhecimento

Estes arquivos leem o texto das páginas digitalizadas de PDFs enviados às bases de conhecimento, isto é, páginas que são só imagem e não deixam selecionar o texto. Eles vão para o servidor junto com o código, no mesmo ZIP, e nada é instalado: não há instalador, pacote npm ou Python, serviço nem mudança no `package.json` ou no `package-lock.json`. O código que os usa fica em `src/modules/knowledge/infrastructure/pdf-ocr/ocr-engine.ts` e roda só no processo filho com teto de memória que lê os arquivos enviados (`pdf-ocr-job.ts`).

| Arquivo | O que é | Tamanho | SHA-256 |
|---|---|---|---|
| `tesseract-core-simd-lstm.cjs` + `.wasm` | Tesseract 5.1 compilado em WebAssembly, versão com SIMD (mais rápida) | 125 KB + 2,87 MB | `be3504705d7111d1d1f3f7f9dff326c26d334031ede36e31c4d3cf883027e982` (.js original) · `187d76742dfc0d8929f0b49a619f145bb6370730776c7bd0d3e20c6b2098808d` |
| `tesseract-core-lstm.cjs` + `.wasm` | A mesma coisa sem SIMD, usada só se a CPU não aceitar a outra | 125 KB + 2,87 MB | `48a3ee8e00924cb8c7f0cc0d099b1318fea120af56b3ee8fb3a70dd2311806c2` (.js original) · `220e2e87551edccb85519796a170469f8ab2a8055216789e3b8b1ada18b7bc2b` |
| `por.traineddata` | Modelo de português, variante rápida (`tessdata_fast`) | 1,98 MB | `c4932b937207a9514b7514d518b931a99938c02a28a5a5a553f8599ed58b7deb` |
| `LICENSE` | Licença Apache 2.0 do tesseract.js-core | | |

## Origem

- **Motor:** pacote npm `tesseract.js-core` 6.1.2, baixado de `https://registry.npmjs.org/tesseract.js-core/-/tesseract.js-core-6.1.2.tgz` com o sha512 do registro conferido, em 06/11/2026. Licença Apache 2.0. Foram copiados só os 4 arquivos acima. Os `.js` foram renomeados para `.cjs`, sem mudar o conteúdo, porque o backend é `"type": "module"` e esses carregadores são CommonJS.
- **Componentes compilados no motor:** Tesseract (Apache 2.0), Leptonica, zlib, libpng, libtiff, libjpeg, giflib e libwebp, com licenças permissivas. Os avisos de cada um estão no repositório de origem, `https://github.com/naptha/tesseract.js-core`.
- **Português:** `https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/main/por.traineddata`, baixado em 06/11/2026. Licença Apache 2.0.

## Por que a variante rápida do português

Em 8 páginas reais (2.018 palavras), a variante rápida e a precisa (`tessdata_best`) leram 98% das palavras e acertaram 286 de 289 acentos. A precisa levou 3,3 s por página e a rápida, 1,2 s. As medidas estão em `docs/dev/pdf-para-markdown/relatorio.md`.

## Como trocar de versão

1. Baixe o pacote e o modelo nos endereços acima e confira o hash do registro.
2. Copie os mesmos arquivos para cá, renomeando `.js` para `.cjs`, e atualize a tabela.
3. Atualize `OCR_ENGINE_LABEL` em `ocr-engine.ts` e rode de novo as medidas do relatório antes de publicar. Um motor novo pode ler diferente.
