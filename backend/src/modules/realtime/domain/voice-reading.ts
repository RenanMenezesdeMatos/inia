/**
 * LEITURA na voz: a INIA fala uma resposta que já foi gravada e já está na tela, sem consultar nada de novo. Usada quando a escolha
 * clicada no formulário do esclarecimento seguiu pelo caminho de texto porque o modelo de voz encerrou o turno sem consultar as bases
 * (com a voz ligada ela fala toda resposta). O texto vai como um turno de texto da sessão de voz: este aviso + o conteúdo gravado + a
 * MESMA instrução de fala que a ferramenta mandaria (`clarification-voice.ts` ou a do resumo). O transporte responde "nada a consultar"
 * a qualquer ferramenta pedida durante a leitura.
 *
 * Medido contra o Gemini Live real (27/10/2026, modelo e regras da voz do operador, 3 rodadas): 6 de 6 leituras faladas, fiéis, sem
 * acionar a ferramenta e sem ler os marcadores de fonte (resposta com passos e pergunta nova com as opções).
 */
export const VOICE_READING_LEAD =
  "[Leitura: a resposta abaixo acabou de ser buscada nas bases e já está na tela. Fale-a agora, seguindo a instrução que vem com ela. Não acione nenhuma ferramenta e não diga que vai consultar.]\n\n"

export function renderVoiceReading(content: string, voiceInstruction: string): string {
  return `${VOICE_READING_LEAD}${content.trim()}${voiceInstruction}`
}
