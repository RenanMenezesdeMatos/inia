/**
 * Base de exemplo do Checkpoint Registry (NÃO é base real de cliente): versões 1 e 2 de um procedimento de visita técnica com
 * uma regra de retenção, para provar extração, reconciliação, governança e o caminho de runtime da cauda longa — sem modelo.
 *
 * v1 → v2: endereço igual (UNCHANGED); telefone reescrito (SEMANTICALLY_EQUIVALENT); maior de idade passa a exigir 18 anos
 * (MODIFIED); ponto de referência some (REMOVED); janela de horário entra (NEW); objetivo e exemplos nunca viram checkpoint.
 */
export const REGISTRY_DOC_TITLE = "Procedimento de Visita Técnica"

export const REGISTRY_KB_V1 = `# ${REGISTRY_DOC_TITLE}

## 1. Objetivo

Garantir que a visita técnica aconteça na data combinada, com o cliente informado.

## 2. Agendamento da visita técnica

Antes de confirmar a visita técnica, confirmar se haverá uma pessoa maior de idade disponível na residência para receber o técnico.

Checklist do agendamento:

- Confirme o endereço completo do cliente;
- Confirme o telefone de contato do cliente;
- Confirme o ponto de referência do endereço.

## 3. Exemplos de fala

“Na hora da visita vai ter alguém em casa para receber o técnico?”

## 4. Cancelamento com fidelização

Quando houver fidelização vigente e multa aplicável, orientar o cliente sobre a multa antes de concluir o cancelamento.

## 5. O que evitar

- Não orientar o cliente apenas a aguardar.
`

export const REGISTRY_KB_V2 = `# ${REGISTRY_DOC_TITLE}

## 1. Objetivo

Garantir que a visita técnica aconteça na data combinada, com o cliente informado.

## 2. Agendamento da visita técnica

Antes de confirmar a visita técnica, confirmar se haverá uma pessoa maior de 18 anos disponível na residência para receber o técnico.

Checklist do agendamento:

- Confirme o endereço completo do cliente;
- Confirme com o cliente o telefone de contato;
- Informe ao cliente a janela de horário da visita.

## 3. Exemplos de fala

“Na hora da visita vai ter alguém em casa para receber o técnico?”

## 4. Cancelamento com fidelização

Quando houver fidelização vigente e multa aplicável, orientar o cliente sobre a multa antes de concluir o cancelamento.

## 5. O que evitar

- Não orientar o cliente apenas a aguardar.
`

/** Conversas de runtime (cauda longa): nenhuma palavra-chave cadastrada — o especialista relaciona fala e checkpoint. */
export const VISIT_TRANSCRIPT = [
  "Operador: Boa tarde, aqui é a Paula, da assistência técnica. Vou agendar a sua visita.",
  "Cliente: Boa tarde, pode ser na quinta.",
  "Operador: Na hora da visita vai ter alguém de maior em casa para receber o técnico?",
  "Cliente: Vai sim, minha esposa vai estar.",
  "Operador: Perfeito, então fica confirmado para quinta.",
].join("\n")
export const RETENTION_WITH_PENALTY = [
  "Operador: Boa tarde, aqui é o Diego, do cancelamento.",
  "Cliente: Quero cancelar a minha linha hoje.",
  "Operador: Como ainda existe fidelização, se você cancelar hoje haverá cobrança da multa prevista no contrato.",
  "Cliente: Entendi, mesmo assim quero cancelar.",
  "Operador: Certo, vou seguir com o cancelamento.",
].join("\n")
export const RETENTION_WITHOUT_PENALTY = [
  "Operador: Boa tarde, aqui é o Diego, do cancelamento.",
  "Cliente: Quero cancelar a minha linha, já passou o período de fidelidade.",
  "Operador: Isso mesmo, seu contrato não tem mais fidelização. Vou seguir com o cancelamento.",
  "Cliente: Obrigado.",
].join("\n")
