# ADR-006 — Avatar conversacional da INIA

## Status

Aceito. Atualizado em 2026-09-25: voz pelo **Gemini Live** (não OpenAI Realtime/WebRTC), modelo
**INIA Mentora** (`frontend/public/models/inia-mentora.glb`, pipeline reprodutível em
`tools/avatar/inia-mentora/`) e **lip-sync PT-BR alinhado ao áudio ouvido** (Fase 2 abaixo, concluída).
Detalhes de implementação na seção "Avatar da INIA" do `CLAUDE.md`.

## Decisão

A experiência será **voice-first e multimodal**, com três modos escolhidos pelo usuário:

1. Avatar com voz;
2. Somente voz, usando uma representação leve em forma de orb;
3. Texto.

A primeira versão comercial usará um personagem 3D em React Three Fiber, desacoplado do motor de conversação. O protótipo sincroniza a voz nativa do navegador com visemas aproximados do português por eventos `boundary` da síntese de fala e seleciona gestos positivos, negativos ou explicativos pelo conteúdo. OpenAI Realtime por WebRTC será responsável pelo áudio bidirecional na integração definitiva. O modelo 3D final será um GLB rigado com morph targets/visemas; o renderer já aceita os estados ocioso, ouvindo, pensando e falando.

## Motivos

- Voz natural e baixa latência geram mais valor que modelagem 3D nesta fase.
- O impacto visual do 3D é relevante para a demonstração comercial e justifica o custo adicional, desde que exista fallback leve.
- O modo somente voz atende usuários que não querem ver o avatar.
- Texto continua disponível como fallback de acessibilidade e para ambientes sem microfone.

## Arquitetura

- `ConversationSession`: cria e encerra a sessão, controla consentimento e estado do microfone.
- `RealtimeTransport`: WebRTC no navegador; credencial efêmera emitida pelo backend.
- `IniaContextProvider`: fornece perfil, equipe, indicadores, diagnósticos e permissões.
- `AvatarRenderer`: contrato visual independente (`3d`, `orb`, `text`, futuramente `video-avatar`).
- `ConversationTranscript`: registra transcrição e eventos autorizados para auditoria.

O segredo da API nunca será enviado ao frontend. O backend cria uma sessão efêmera, aplica as instruções e limita as ferramentas disponíveis conforme o perfil do usuário.

## Etapas

### Fase 1

- Modos Avatar, Somente voz e Texto.
- Avatar 3D com respiração, piscadas, movimentos ociosos, gestos de mãos/cabeça e estados ocioso, ouvindo, pensando e falando.
- Lip-sync local aproximado por visemas, sincronizado aos limites da fala do navegador.
- Conversação speech-to-speech em WebRTC.
- Interrupção natural, indicação clara de microfone e transcrição opcional.

### Fase 2 (concluída em 2026-09-25)

- Trocar a heurística local por visemas temporizados do áudio da sessão e morph targets do GLB.
  Implementado sem dependência de runtime: G2P PT-BR por regras + alinhamento incremental
  (Viterbi semi-Markov) do texto da `outputTranscription` aos quadros do PCM analisado na chegada
  + coarticulação por dominância, amostrada no relógio de saída do `AudioContext`. Bibliotecas
  avaliadas e descartadas: HeadAudio/wawa-lipsync/wLipSync (só áudio, sem PT-BR), TalkingHead
  (exige timestamps de palavra que o Live não fornece), Rhubarb (não é streaming),
  vosk-browser (pesado, só palavra), phonemizers baseados em eSpeak (GPL).
- Avatar em vídeo por provedor plugável.
- Apresentação visual de indicadores e planos durante a conversa.

### Fase 3

- Evoluir o GLB, animações corporais, expressões emocionais e sincronização fonema-visema conforme os testes comerciais.

## Requisitos de segurança e privacidade

- Consentimento explícito antes de abrir o microfone.
- Indicador persistente enquanto o microfone estiver ativo.
- Encerramento imediato da captura ao fechar ou trocar de modo.
- Autorização no backend para acesso a dados do operador ou da equipe.
- Política configurável de retenção de áudio e transcrições.
- Nenhuma gravação automática sem base legal e comunicação ao usuário.
