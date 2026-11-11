# INIA Mentora v02 — pipeline da evolução visual (em avaliação)

Cópia derivada do pipeline da Mentora (`tools/avatar/inia-mentora/`), com as mudanças de aparência da
v02. **Nada do pipeline original, dos seus modelos ou das suas texturas é lido para escrita**: esta
cópia aponta para caminhos próprios (`lib/common.py`).

| Saída | Onde |
|---|---|
| Modelo web | `frontend/public/models/inia-mentora-v02.glb` |
| Modelo editável | `assets/avatar/inia/realista-v02/inia-mentora-v02.blend` |
| Texturas-fonte (PNG) | `assets/avatar/inia/realista-v02/textures/` |
| Renders de conferência (Blender) | `assets/avatar/inia/realista-v02/renders/` (`baseline/` = Mentora original pelo mesmo caminho) |
| Comparação no navegador, vídeo e métricas | `assets/avatar/inia/realista-v02/comparacao/` |
| Intermediários e logs | `assets/avatar/inia/realista-v02/work/` (fora do git) |

O produto continua carregando `inia-mentora.glb`. A v02 só aparece no laboratório
(`/dev/avatar-lab`, opção "Mentora v02 — em avaliação", ou `?model=v02`).

## Como rodar

```bash
tools/avatar/inia-realista-v02/build.sh             # 01 → 08 (~40–55 s)
FROM=05 tools/avatar/inia-realista-v02/build.sh     # recomeça numa etapa
RENDERS=0 tools/avatar/inia-realista-v02/build.sh   # sem os renders da 08
python3 tools/avatar/inia-realista-v02/compare_glb.py frontend/public/models/inia-mentora.glb \
    frontend/public/models/inia-mentora-v02.glb     # métricas dos dois GLBs (sem Blender)
```

Requisitos, contrato com o frontend, calibração de cor e demais parâmetros: os mesmos do
[README da Mentora](../inia-mentora/README.md). Só o que difere está abaixo.

**Ponto de partida conferido:** antes de qualquer mudança, esta cópia (só com os caminhos trocados)
gerou um GLB byte a byte igual ao `inia-mentora.glb` versionado (md5 `003de43e…`). Ou seja, a v02 é a
Mentora + as mudanças listadas aqui, e nada mais.

## O que muda em relação à Mentora

| Etapa | Mudança | Onde |
|---|---|---|
| 02 | Piquet da polo mais legível (normal 0,25 → 0,42). | `lib/outfit_build.py` |
| 04 | Pele do rosto com variação de cor (manchas largas e médias), poros, rubor leve no nariz, queixo e orelhas, rugosidade irregular e mapa de normais novo (`skin_normal.png`). Lábios mais coral, com vincos verticais. | `lib/v02_skin.py`, `04_skin_eyes.py`, `lib/skin_paint.py` (`extras`, `lips`) |
| 05 | Cachos em **fita** texturizada (hair cards helicoidais) no lugar dos tubos de 3 lados: 648 cachos (eram 372), 5,6 voltas e 4,2 cm em média (eram 4,4 e 2,8 cm), com a mesma quantidade de triângulos. Textura de fios `hair_card.png` (recorte por alpha MASK, dupla-face). Pontas acobreadas e mais contraste entre mechas. | `lib/hair_curls.py` (`ribbon_mesh`), `lib/v02_hair_card.py`, `05_hair.py` |
| 05 | Cabelo com peso parcial (0 na raiz, até 0,5 na ponta) no osso `hair_02_ph` do asset base, para o balanço do cabelo no app. | `05_hair.py` (`sway_weights`) |
| 06 | `M_HairCurls` também sai em alpha MASK; `inia_motion_profile: "natural"` nos extras do `INIA_Rig` (o app liga o perfil de movimento da v02 só para este GLB). | `lib/finalize_materials.py`, `lib/finalize_contract.py` |
| 07 | Atlas de pele (cor, normal e rugosidade) em até 2048 px; nos cachos a calibração web vai para a cor por vértice, não para a textura de fios. | `lib/finalize_contract.py`, `lib/export_web_color.py` |

Geometria do rosto e do corpo, proporções, olhos, esqueleto (55 ossos) e os 52 blendshapes não foram
tocados: são os da Mentora.

## Tentado e retirado (com motivo)

- **Brilho de penugem na polo** (`KHR_materials_sheen`): no three.js, com a luz do app, até peso 0,08
  lavava o roxo para lilás. Retirado depois da captura no navegador.
- **Relevo médio na pele e variação mais forte**: no render de conferência a pele ficou encaroçada.
  Ficou só o relevo de poros e vincos, com a variação de cor reduzida.
- **Cachos mais claros** (ganho de luminosidade 2,2): as mechas ficaram aloiradas. Ficou 1,8, mais
  escuro que a mediana das referências (ver "Limitações").
- **96 mil triângulos de cachos**: 889 cachos, mas o GLB ia a 11,6 MiB. Ficou o orçamento da Mentora
  (≤ 64 mil nos cachos).

## Métricas (2026-11-10)

| | Mentora | v02 |
|---|---|---|
| GLB | 6,27 MiB | 8,94 MiB |
| Transferido pelo servidor de desenvolvimento | 4,45 MB | 6,24 MB |
| Triângulos | 94.887 | 95.501 |
| Draw calls | 14 | 14 |
| Materiais / texturas | 12 / 12 | 12 / 14 |
| Texturas no GLB | 1,00 MiB | 1,61 MiB |
| Ossos / blendshapes | 55 / 52 | 55 / 52 |
| FPS no laboratório (vista do chat, 1912×1280) | 60 | 60 |
| Quadro p50 / p95 | 17 / 18–19 ms | 17 / 18 ms |

Orçamento adotado: até 10 MiB, até 100 mil triângulos, 14 draw calls, 60 fps no aparelho de teste.
O aumento de tamanho vem dos vértices dos cachos (as fitas não compartilham vértices como os tubos:
59,8 mil vértices contra 29,9 mil) e das duas texturas novas. Medidas e método em
`assets/avatar/inia/realista-v02/comparacao/` (`glb-metrics.json`, `navegador-desempenho.json`).

## Capturas no navegador

Roteiros em `captura/` (Playwright 1.63 com o WebKit 2359 já em cache; `PLAYWRIGHT_CORE` aponta para o
pacote, que não é dependência do projeto). Com o frontend de desenvolvimento no ar:

```bash
python3 captura/recv.py <pasta> &                                # receptor local dos vídeos (porta 8765)
node captura/shots.mjs <pasta> mentora:front v02:front …         # modelo:vista[:perfil]
node captura/video.mjs mentora "Kore — números e horário"        # repouso → escuta → fala, com áudio
node captura/perf.mjs                                            # FPS, triângulos, draw calls, carga
```

O laboratório aceita `?model=mentora|v02|poc&view=…&motion=auto|classic|natural`, então as duas versões
são capturadas na mesma página, com a mesma câmera, luz e tamanho.

## Limitações conhecidas

- **Reprodutibilidade:** pele, cabelo e texturas saem idênticos entre builds; em 1 de 3 builds seguidos
  os buffers de vértices da `INIA_Polo` saíram diferentes (mesmo tamanho, conteúdo diferente). A etapa
  02 não teve a geometria alterada pela v02; a causa não foi investigada.
- **Cabelo:** a mediana dos cachos fica mais escura que a das referências (`#331704` contra `#5a321c`);
  o cobre das referências é mais luminoso. O recorte por alpha é duro (sem alpha-to-coverage).
- **Pele:** o detalhe só existe no rosto, orelhas e pescoço. Braços e colo usam um bloco uniforme do
  atlas do asset base. O UV do rosto é espelhado, então a variação é simétrica. Sem espalhamento
  subsuperficial (o glTF/three.js padrão não tem).
- **Rosto:** proporções e olhos são os da Mentora (o rosto ainda lê mais jovem que as referências).
- **Tamanho:** sem Draco/Meshopt, como na Mentora.

## Proveniência e licença

- Base: **"Pixar style girl (rigging)"**, de **Black vizual**, **CC BY 4.0** — a mesma da Mentora; a
  atribuição continua em `asset.copyright`, nos extras do `INIA_Rig` e no "i" do palco do avatar. Prova
  da licença: `assets/avatar/inia/mentora/licenca/`.
- **Nenhum asset novo de terceiros.** `hair_card.png` e `skin_normal.png` são geradas por código
  (`lib/v02_hair_card.py`, `lib/v02_skin.py`).
- As orientações do repositório `arjun988/blender-skills` (MIT, commit `904f095`) foram lidas e seguidas
  como guia de método; nenhum arquivo dele foi copiado para o projeto.
