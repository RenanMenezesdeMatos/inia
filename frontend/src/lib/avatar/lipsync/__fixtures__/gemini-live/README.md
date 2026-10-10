# Fixtures reais do Gemini Live

Capturadas em 2026-09-24 com `models/gemini-2.5-flash-native-audio-latest` (mesmo modelo e mesma
configuração de sessão do avatar: `responseModalities: ["AUDIO"]`, `outputAudioTranscription`, voz
padrão, detecção automática de atividade desligada) por
`tools/avatar/capture-gemini-live-fixtures.mjs` a partir de `tools/avatar/gemini-live-fixture-cases.json`.

- `<id>.wav`: todo o áudio da resposta (PCM16 mono 24 kHz), na ordem de chegada.
- `<id>.json`: `events[]` com `t` (ms desde o envio do pedido) e `audioBytes` (tamanho de cada chunk,
  para reconstruir os chunks a partir do WAV), `transcript` (fragmentos de `outputTranscription`),
  `generationComplete` e `turnComplete`.

Observações medidas: o primeiro chunk tem ~960 ms e os seguintes 40 ms; o áudio chega mais rápido que a
reprodução (folga ≥ 0,9 s desde o primeiro chunk, até ~39 s na resposta longa); os fragmentos de
transcrição chegam intercalados e quase sempre antes do trecho correspondente ser ouvido. Nenhum
timestamp de palavra/fonema é fornecido pelo Live.

## Capturas com a voz de produção (Kore), 2026-10-07

`kore-*`: mesma sessão da produção (`buildSetupMessage`: voz **Kore** de `backend/src/config/inia-voice.ts`, transcrição de
entrada e saída, push-to-talk), capturadas por `tools/avatar/capture-gemini-live-fixtures.mjs` a partir de
`tools/avatar/gemini-live-fixture-cases-kore.json`. Além das 5 frases e da resposta longa, há números/datas/protocolo
(`kore-numeros`), lista com palavras em inglês (`kore-lista-ingles`) e duas respostas a perguntas FALADAS
(`kore-voz-pergunta-*`: a pergunta foi sintetizada no Mac com a voz Luciana e enviada como o microfone, em tempo real).
O JSON delas também traz `voice`, `audioPrompt` e `extra` (transcrição da pergunta falada, uso de tokens — o replay
ignora). Custo das 13 sessões (10 + 3 de controle): ≈ US$ 0,06.

`*-texto-incompleto`: em 3 de 13 frases curtas daquele dia o Live mandou a transcrição INCOMPLETA — parou no meio
("Minha proposta é bem", "Amanhã, às") ou pulou um trecho do meio ("Você prefere benefícios ou atendimento?" sem
"falar sobre vendas,"). Não é da voz (a repetição com Kore e o controle com a voz padrão vieram completos): é falha
intermitente da transcrição de saída. Ficam como regressão: a boca tem de acompanhar a fala sem texto.

`../reference/whisper-words.json`: alinhamento de REFERÊNCIA independente (início/fim de cada palavra de cada captura, pelo
Whisper `small` via `tools/avatar/whisper-word-reference.py`, que roda num venv à parte — nada disso é dependência do
projeto). O texto da captura não é dado ao Whisper. Os tempos dele erram dezenas de ms (às vezes ~0,2 s numa pausa):
serve para achar palavra fora do lugar e viés, não para medir 10 ms.
