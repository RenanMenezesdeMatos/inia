/**
 * Formato das chamadas do cenário "Nota da URA e Reincidência em setembro" da Larissa Monteiro (DEMO-OP-0001).
 *
 * "O:" = operador, "C:" = cliente. `{OPERADOR}` = primeiro nome de quem atende (Larissa ou o colega escolhido pelo script).
 * `intent` é só documentação do cenário — o motor NUNCA recebe isto; ele lê só a transcrição, o assunto e as flags.
 * `flags` = o que a fonte já calculou para a chamada (`nota_ura` 1–5 = nota da pesquisa na URA; `rechamada` = o cliente voltou a ligar
 * pelo mesmo problema). Chamada sem `nota_ura` = o cliente não respondeu a pesquisa.
 */
export type ScenarioCall = {
  key: string
  owner: "LARISSA" | "PEER_1" | "PEER_2" | "PEER_3" | "PEER_4" | "PEER_5"
  date: string
  time: string
  durationSeconds: number
  reason: string
  flags: { nota_ura?: number; rechamada?: boolean }
  intent: { good: boolean; failures: string[]; note?: string }
  lines: string[]
}
