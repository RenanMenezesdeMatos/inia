# Catálogo de favicons INIA

48 alternativas para apresentação, organizadas em seis símbolos e oito acabamentos. **B1 — Monograma IN, Livre — é a opção escolhida para uso no projeto.**

## Abrir e apresentar

Abra [index.html](index.html) no navegador para comparar as opções, ampliar o símbolo e conferir sua leitura em 16 e 32 px. O catálogo funciona sem conexão com a internet.

Para uma apresentação em imagem, abra a [prancha completa](pranchas/catalogo-completo.png). A pasta `pranchas/` também contém uma imagem por família, com todos os seus acabamentos.

## Organização

- `index.html`: catálogo interativo para apresentação.
- `opcoes/`: as 48 alternativas em SVG, PNG e ICO, agrupadas por família.
- `pranchas/`: comparação geral e seis comparações por família.
- `exploracoes-iniciais/primeira-proposta/`: primeira proposta da INIA, preservada antes da aplicação de B1.
- `exploracoes-iniciais/variantes/`: todas as explorações anteriores, incluindo a versão abstrata de rosto e cabelo.
- `symbols/`: fontes vetoriais das seis geometrias usadas no catálogo.
- `manifest.json`: relação dos códigos, conceitos, acabamentos e caminhos de cada arquivo.

## Como ler os códigos

A letra identifica o símbolo; o número identifica o acabamento. Por exemplo, **B1** combina a família **B — Monograma IN** com o acabamento **1 — Livre**.

| Letra | Símbolo | Pasta |
| --- | --- | --- |
| A | Inicial | `opcoes/A-inicial/` |
| B | Monograma IN | `opcoes/B-monograma/` |
| C | Conversa | `opcoes/C-conversa/` |
| D | Conexão | `opcoes/D-conexao/` |
| E | Centelha | `opcoes/E-centelha/` |
| F | Rosto + IA | `opcoes/F-rosto-ia/` |

| Número | Acabamento | Característica |
| --- | --- | --- |
| 1 | Livre | Símbolo solto, com fundo transparente e sem contorno |
| 2 | Reto | Cantos discretos, sem contorno |
| 3 | Suave | Cantos médios, sem contorno |
| 4 | Orgânico | Cantos bem arredondados, sem contorno |
| 5 | Circular | Fundo circular, sem contorno |
| 6 | Borda fina | Contorno rosa fino, centro branco |
| 7 | Borda larga | Contorno rosa espesso, centro roxo |
| 8 | Borda dupla | Contornos rosa e branco, centro roxo |

## Arquivos e cores

Cada alternativa inclui um **SVG editável**, um **PNG de 512 × 512 px** e um **ICO com 16, 32, 48, 64, 128 e 256 px**.

As cores institucionais são roxo `#660099`, rosa `#EB3C7D` e branco `#FFFFFF`. As variantes livres têm fundo transparente, então sua aparência muda conforme a superfície.

Arquivos de B1: [SVG](opcoes/B-monograma/B1-monograma-livre.svg), [PNG](opcoes/B-monograma/B1-monograma-livre.png) e [ICO](opcoes/B-monograma/B1-monograma-livre.ico).

Os caminhos em `manifest.json` são relativos a esta pasta. O campo `path` indica o nome sem extensão; `files` indica cada formato completo.
