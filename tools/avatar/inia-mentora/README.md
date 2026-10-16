# INIA Mentora — pipeline do modelo 3D

Transforma o asset base (menina estilizada, CC BY 4.0) na **INIA Mentora**: mulher negra brasileira
adulta, estilo 3D tipo Pixar, afro volumoso de cachinhos, polo roxa com logos "vivo", broche
INIA / MENTORA, calça escura e cinto. Referências de aparência: `assets/avatar/inia/ref_*_v01.png`
(frente, 3/4, perfil e costas — sempre vistas juntas).

Tudo é gerado por script, em modo background do Blender, a partir do GLB base. Nenhum `.blend` é
editado à mão: para mudar o modelo, mude o script/parâmetro e rode o pipeline de novo.

| Saída | Onde | Versionada |
|---|---|---|
| Modelo web (o que o app carrega) | `frontend/public/models/inia-mentora.glb` | sim |
| Modelo editável final | `assets/avatar/inia/mentora/inia-mentora.blend` | sim |
| Texturas-fonte (PNG) usadas pelo `.blend` | `assets/avatar/inia/mentora/textures/` | sim |
| Renders de conferência (JPEG ~1600 px) | `assets/avatar/inia/mentora/renders/` | sim |
| Intermediários, logs, relatórios JSON | `assets/avatar/inia/mentora/work/` | não (`.gitignore`) |

O GLB original do asset (`frontend/public/models/inia-avatar-poc.glb`) **nunca é alterado**: é a
fonte da etapa 01 e continua sendo o modelo de fallback do app.

## Requisitos

- Blender 5.2.x (testado com 5.2.1 LTS). Caminho configurável pela variável `BLENDER`.
- ffmpeg em `/opt/homebrew/bin/ffmpeg` (folhas de comparação; constante `FFMPEG` em `lib/common.py`).
- Node + `frontend/node_modules` instalado (só para a conferência no three.js da etapa 08; sem isso
  ela é pulada com aviso).

## Como rodar

```bash
# da raiz do repositório
tools/avatar/inia-mentora/build.sh                 # 01 → 08 completo
FROM=06 tools/avatar/inia-mentora/build.sh         # recomeça da 06 (reaproveita work/build/05_hair.blend)
RENDERS=0 tools/avatar/inia-mentora/build.sh       # sem os renders da 08 (só as asserções)
BLENDER=/outro/Blender tools/avatar/inia-mentora/build.sh
```

Cada etapa roda num Blender limpo (`--factory-startup --python-exit-code 1`), em sequência, e o
script para no primeiro erro mostrando o fim do log (`work/build/logs/NN.log`). Os intermediários vão
para `work/build/` (variável `BUILD_DIR`), separados dos arquivos de iteração de cada etapa.

**Tempo**: o pipeline completo leva menos de 1 minuto num Mac Apple Silicon (tabela "Tempo por
etapa" abaixo); a etapa mais lenta é a 04 (pintura do atlas de pele).

## Etapas

Todas seguem o mesmo contrato de linha de comando e imprimem um relatório JSON curto:

```bash
/Applications/Blender.app/Contents/MacOS/Blender -b --python-exit-code 1 \
  --python tools/avatar/inia-mentora/NN_etapa.py -- in=<entrada.blend> out=<saida.blend> [opções]
```

São determinísticas (seeds fixas, nada depende de hora ou ordem de dicionário) e falham alto se um
objeto esperado não existir.

| Etapa | Entrada → saída | O que faz | Módulos |
|---|---|---|---|
| `01_base.py` | GLB base → `01_base.blend` | Importa o GLB, descarta a ação/pose estática, renomeia para `INIA_Rig/Body/Head/Eyes` (ossos e blendshapes mantêm os nomes originais). | `lib/common.py` |
| `02_outfit.py` | → `02_outfit.blend` | Roupa: pele dos braços, polo (`INIA_Polo`: gola, carcela, 3 botões, manga curta com barra canelada, piquet), logos "vivo" (`INIA_Logos`, alpha MASK), broche (`INIA_Badge`), calça grafite e cinto com fivela (`INIA_Belt`). Texturas `polo_*`, `logo_vivo`, `badge_color`, `belt_normal`. | `lib/outfit_*.py` |
| `03_proportions.py` | → `03_proportions.blend` | Proporções adultas do rosto e do corpo por UMA deformação espacial suave aplicada à Basis e a TODAS as shape keys (e às juntas do rig), guiada por marcos medidos no próprio modelo. | `lib/warp_*.py` |
| `04_skin_eyes.py` | → `04_skin_eyes.blend` | Atlas de pele marrom quente (`skin_basecolor`, 2048²), sobrancelhas, delineado, blush, lábios, íris castanha, `skin_metal_rough`, córnea (`eye_cornea`). Materiais `M_Skin`/`M_Cornea`. | `lib/skin_*.py` |
| `05_hair.py` | → `05_hair.blend` | Afro: volume `INIA_Hair` (≤ 6k tri, textura tileável `hair_volume_*`) + molinhas 3D `INIA_HairCurls` (≤ 60k tri, cor por vértice), ajustados ao crânio medido, rígidos no osso `Head`. | `lib/hair_*.py` |
| `06_finalize.py` | → `inia-mentora.blend` | Contrato do modelo web (ver abaixo): nomes, repouso, skinning ≤ 4 pesos, 52 blendshapes, empties de enquadramento, materiais exportáveis, limpeza. | `lib/finalize_*.py` |
| `07_export.py` | `.blend` final → `inia-mentora.glb` | glTF binário: skin, morphs com normais (esparsos, ruído podado), texturas WebP redimensionadas, **cor calibrada para o visualizador web**, sem animações; meta ≤ 12 MB com o tamanho por categoria no relatório. | `lib/export_textures.py`, `export_web_color.py`, `export_glb.py`, `export_prune.py` |
| `08_verify.py` | GLB → renders + relatório | Reimporta o GLB num Blender limpo e confere o contrato; renderiza (na réplica da iluminação do app) as 4 vistas × referências, close-ups do rosto e expressões (morphs); mede a cor exibida × referências. `lib/export_three_check.mjs` carrega o GLB com o GLTFLoader do frontend. | `lib/export_verify.py`, `export_renders.py`, `export_web_studio.py`, `export_color_check.py` |

Para iterar numa etapa isolada, quase todas aceitam `renders=<prefixo>` (4 vistas × referências em
`work/renders/<prefixo>_compare.png`). Para renderizar qualquer `.blend` do pipeline:
`render_compare.py -- in=<arquivo.blend> prefix=<nome> [framing=reference|head|full]`.

## Contrato com o frontend

O app (`frontend/src/lib/avatar/animation/avatar-rig.ts`, `rig-framing.ts`, `rig-bones.ts`) procura
tudo por NOME. A etapa 06 garante e a 08 confere (fonte única dos nomes: `lib/finalize_contract.py`):

- **Objetos**: `INIA_Rig` (armature) e as malhas `INIA_Body` (pele de mãos/braços/pescoço, calça,
  tênis, cinto e fivela), `INIA_Head` (rosto, orelhas, pescoço, boca completa), `INIA_Eyes` (globos +
  córneas), `INIA_Polo`, `INIA_Logos`, `INIA_Badge`, `INIA_Hair`, `INIA_HairCurls` (a malha que a
  qualidade "low" esconde). O `INIA_Belt` da etapa 02 é juntado ao `INIA_Body` na 06.
- **Esqueleto**: os 55 ossos Mixamo do asset base (mesmos nomes; `hair_02_ph` e `breast_*_ph`
  incluídos). Toda malha é filha do `INIA_Rig` com modificador Armature e ≤ 4 influências
  normalizadas; cabelo e cachos são 100 % no osso `Head`.
- **Blendshapes**: `INIA_Head` e `INIA_Eyes` com os 52 ARKit do GLB base, mesmos nomes e ordem. Todo
  blendshape que tinha delta na base continua tendo (`tongueOut` é vazio desde a base; nos olhos só
  os `eyeLook*` movem o globo). Ruído numérico (< 5 µm) é zerado para os accessors saírem esparsos.
- **Enquadramento** (empties filhos de objeto do `INIA_Rig`, medidos na 06):
  `INIA_Frame_Top` (topo do cabelo), `INIA_Frame_Face` (entre os olhos), `INIA_Frame_Chest` (limite
  inferior da vista do chat: 4,5 cm abaixo do broche/logo do peito) e `INIA_Frame_Belt` (limite
  inferior das vistas de referência: 6 cm abaixo do cinto). As folgas são medidas no plano do rosto
  (alvo da câmera); o peito fica ~9 cm à frente dele, então na perspectiva do app sobra ~2 cm abaixo
  do broche e uma faixa de calça abaixo do cinto, como nas referências. Folgas em `finalize_contract.py`.
- **Materiais**: Principled BSDF com imagens, cor por vértice no cabelo (`Color Attribute` → COLOR_0),
  logo em alpha MASK (corte 0,5), córnea em BLEND (como no asset base). Nenhum nó procedural.
- **GLB**: Y para cima (a personagem olha para +Z), sem animações/câmeras/luzes (o frontend monta os
  clipes em código), texturas WebP (`EXT_texture_webp`, suportado pelo GLTFLoader), procedência em
  `asset.copyright` e nos extras do nó `INIA_Rig`. Sem Draco/Meshopt (o app não registra decoders).

## Como mudar parâmetros

Mude o parâmetro e rode `FROM=<etapa> build.sh` (as etapas seguintes são refeitas):

| O quê | Onde |
|---|---|
| Polo, logos (tamanho/posição), broche, cinto | dicionário `P` em `lib/outfit_build.py` (etapa 02) |
| Proporções do rosto/corpo | campos de `lib/warp_face.py` / `lib/warp_body.py`, ou `params=<json>` na 03 |
| Braços e mãos (perfil do tubo, seção oval, cotovelo, mãos, polegar) | `FOREARM_PROFILE`/`UPPER_PROFILE`/`OVAL_PROFILE` em `lib/outfit_arms.py` (02) + `arm_*`, `hand_*`, `thumb` em `lib/warp_body.py` (03); pose idle em `frontend/src/lib/avatar/animation/idle-pose.ts` |
| Lábios (contorno) e interior da boca (escurecimento por profundidade) | `Params` em `lib/skin_paint.py` (`lip_*`, `mouth_depth`, `*_factor`, `teeth`) |
| Tons de pele, maquiagem, íris | `Params` em `04_skin_eyes.py` (ou `params=<json>`) |
| Silhueta, volume, cachos, cores do cabelo | `CFG` em `05_hair.py` (+ `lib/hair_fit.py`, `lib/hair_curls.py`) |
| Folgas dos empties, alias de objetos, tetos de textura, meta de tamanho | `lib/finalize_contract.py` |
| Qualidade WebP / meta em MB | `07_export.py -- quality=88 max_mb=12` |
| Cor no navegador (ganhos por grupo) | `CALIBRATION` em `lib/export_web_color.py` (ver abaixo) |
| Iluminação da réplica do app (renders da 08) | `lib/export_web_studio.py` (espelha `studio-lighting.ts`) |

### Cor no navegador (calibração web)

As etapas 02–05 calibraram os albedos para o estúdio de conferência do Blender (AgX com luzes fortes,
que clareiam e dessaturam): a polo tem albedo `#280444`, a pele ≈ `#703509`. No app o modelo é
iluminado por `frontend/src/lib/avatar/animation/studio-lighting.ts` (hemisfério + 4 direcionais sem
sombra + RoomEnvironment, tone mapping Khronos PBR Neutral) e esses mesmos albedos saíam ~40 % mais
escuros e supersaturados — o PBR Neutral ainda "come" os escuros (pele marrom-laranja, polo violeta
quase preta, calça e cinto pretos chapados). Medido em captura real do three.js.

Por isso a etapa 07 corrige só as CÓPIAS exportadas (o `.blend` não muda): cada grupo de materiais
(pele, polo, volume do cabelo, cachos, calça, cinto, fivela) recebe um ganho em OKLab
(`L·gL`, `C·gC`, `h+dh`) na textura de cor base, na cor por vértice ou na cor de fator — tabela
`CALIBRATION` em `lib/export_web_color.py`. Os ganhos foram medidos comparando a mediana exibida de
cada grupo com a mediana das mesmas regiões nas referências (`TARGETS`).

- A etapa 08 renderiza numa réplica da iluminação do app (`lib/export_web_studio.py`, conferida contra
  capturas do three.js: pele, polo, cabelo, calça e cinto batem com diferença de L < 0,01) e imprime
  `COR <grupo> <exibida> alvo <referência> … sugestão {gL, gC, dh}`.
- Se uma etapa anterior mudar cores, ou se `studio-lighting.ts` mudar, rode o build e copie as
  sugestões da 08 para `CALIBRATION` (1–2 rodadas convergem). Metais e verniz (fivela, broche)
  dependem do reflexo do RoomEnvironment, que a réplica não reproduz: confira no navegador.
- `07_export.py -- web_color=0` exporta sem a correção (para comparar).

## Tempo por etapa

Build completo do zero (`build.sh`, Mac Apple Silicon, Blender 5.2.1, EEVEE), 2026-09-25:

| 01 | 02 | 03 | 04 | 05 | 06 | 07 | 08 (+ three.js) | Total |
|---|---|---|---|---|---|---|---|---|
| 1 s | 2 s | 2 s | 17 s | 4 s | 1 s | 2 s | 7 s (+1 s) | **~36 s** |

O resultado é determinístico: dois builds seguidos geram o GLB e as texturas byte a byte iguais.

Tamanho do GLB (etapa 07): **6,3 MiB** = geometria 3,3 MiB (os cachos são ~60 % dos triângulos) +
morphs 1,9 MiB (52 blendshapes esparsos com normais) + texturas 1,0 MiB (WebP) + JSON 0,1 MiB.
Triângulos: 94.389 no total (Body 13.618 · Head 11.439 · Eyes 1.152 · Polo 4.960 · Logos 392 ·
Badge 256 · Hair 5.200 · HairCurls 57.372).

## Proveniência e licença

- Asset base: **"Pixar style girl (rigging)"**, de **Black vizual**, licença
  **CC BY 4.0** (<https://creativecommons.org/licenses/by/4.0/>). O modelo da INIA Mentora é uma
  obra **modificada** (roupa, proporções, pele, olhos e cabelo novos gerados por este pipeline).
- A licença exige **atribuição**: mantenha o crédito ao autor, o link da licença e a indicação de
  que houve modificação onde o modelo for distribuído/exibido (o GLB leva isso em
  `asset.copyright` e nos extras do `INIA_Rig`; no app, no "i" do canto do palco do avatar). Prova da
  licença (página do Sketchfab em PDF): `assets/avatar/inia/mentora/licenca/`.
- O GLB original fica intacto em `frontend/public/models/inia-avatar-poc.glb`.
- As texturas em `assets/avatar/inia/mentora/textures/` são geradas por código (sem imagens de
  terceiros), exceto o normal map da calça, que vem do asset base (empacotado no `.blend`).
- Fonte do texto dos logos: Arial Rounded Bold rasterizada pela etapa 02 (ver `lib/outfit_raster.py`).

## Limitações conhecidas

- **Aparência** (decisões das etapas 02–05, não alteradas pelas etapas 06–08): o rosto ainda lê
  jovem (olhos grandes do asset base; os olhos não são escalados) e o sorriso discreto das
  referências vem do app (`mouthSmile*` no repouso), não da geometria; lábios nude-rosados em vez do
  coral das referências; na vista 3/4 aparece uma faixa lisa de pele na linha do cabelo; cachos
  mais finos e "pontilhados" que os das referências; tronco ~25 % mais estreito que o das
  referências (os braços, agora cheios, parecem um pouco pesados em relação a ele) e o cotovelo
  fica ~5 cm acima do cinto (nas referências, na altura do cinto); mãos e polegar só reescalados
  (nós dos dedos do asset base); o broche fica na lateral do busto e, na vista 3/4, é visto quase de
  raspão (reflexo claro, texto pouco legível). Os dentes da frente continuam claros (dentes são bem
  mais claros que pele escura) — o three.js não tem sombra dos lábios, então a profundidade da boca
  é pintada no atlas.
- **Revisão de 2026-09-25** (nariz "enorme", boca "não humana", braços "deformados"): nariz e boca
  voltaram a proporções de adulta (asas +8 % em vez de +20 %, ponta +18 % em vez de +45 %, nariz
  3 mm para frente, maçãs menos para frente; boca ~50 mm em vez de ~64 mm, 2,5 mm para frente em
  vez de 7,5 mm — o "focinho" do perfil); costura vertical no meio dos lábios corrigida (o UV do
  rosto é espelhado e o contorno do lábio tratava a borda da ilha como borda do lábio); interior da
  boca escurecido pela profundidade atrás dos lábios (antes os dentes laterais formavam um anel
  branco de canto a canto); braços refeitos (seção oval, cotovelo sem estrangulamento, antebraço
  cheio até um pulso oval, cotovelo descido 36 mm para proporção braço:antebraço de adulta, mãos
  mais largas, polegar mais curto e redondo, manga mais justa) e pose idle do app com os braços
  ~7° do corpo em vez de ~11°.
- **Tentativa de 2026-09-25 revertida** (aproximar do "estilo Pixar da foto": maçãs altas, queixo
  largo, mandíbula arredondada, lábios mais cheios, boca mais alta/nariz encurtado, linha do cabelo
  descendo nas têmporas): o resultado ficou artificial e mudou as distâncias olhos–nariz–boca–queixo;
  foi revertida e o build voltou byte a byte ao GLB aprovado. Ficou só o **filtro** (sulco entre o
  nariz e a boca, `sculpt_philtrum` em `lib/warp_sculpt.py`, `PHILTRUM_DEFAULTS`): um deslocamento
  por vértice somado igualmente à Basis e a todas as shape keys (18 vértices, sulco de 2,2 mm e
  colunas de ~0,5 mm) — as expressões e o fechamento dos lábios não mudam. `params` com
  `{"face": {"philtrum": null}}` na 03 desliga. A 05 aceita `cfg=<json>` para iterar no `CFG`.
- **Portabilidade**: a etapa 02 rasteriza o texto dos logos com fontes do macOS
  (`/System/Library/Fonts/Supplemental/Arial Rounded Bold.ttf` e `Arial Bold.ttf`) e `lib/common.py`
  usa o ffmpeg em `/opt/homebrew/bin/ffmpeg`; em outro sistema, ajuste esses caminhos.
- **Cor**: a calibração web vale para a iluminação atual do app (`studio-lighting.ts` de
  2026-09-25). Renderizado no estúdio AgX do Blender, o GLB calibrado parece lavado (esperado; os
  renders da 08 usam a réplica do app). A réplica não reproduz o reflexo do RoomEnvironment em
  metal/verniz (fivela, broche): confira esses no navegador.
- **Tamanho**: sem Draco/Meshopt (o `GLTFLoader` do app não registra decoders); com eles o GLB
  cairia para ~2–3 MB.
- A conferência no Node (`export_three_check.mjs`) não decodifica texturas (não há DOM); a
  decodificação WebP e a renderização foram conferidas num navegador real (three.js 0.185).
