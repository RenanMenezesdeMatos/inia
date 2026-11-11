# Goldfish Review Report — Estágio 6 (Comprehension)

**Target:** `docs/designs/ciencia-com-concordancia/design_draft.md` v1 (FeatureRange 1–144, DetailedRange 145–173)
**Reviewer:** `egm-comprehension` (subagente novo, só leitura) · **Status:** completed

## Paráfrase — o que o documento propõe
Juntar a avaliação dos feedbacks de indicador e de monitoria (inclui o feedback de atendimento entregue) com a confirmação de ciência. Primeira etapa com "Concordo"/"Não concordo" sem marcação; discordar pede motivo da lista atual e justificativa 3–1000; segunda etapa login e senha. Ciência e escolha na mesma transação, tabela nova imutável (`feedback_read_agreements`); discordância na fila de contestações existente; polegares saem; endpoint antigo 409; o item mostra escolha, motivo, justificativa e resposta; contestações antigas continuam aparecendo.

## Paráfrase — como o sistema funciona hoje
Duas ações separadas: "Confirmar ciência" (diálogo central, login e senha, trava 5/15 min, transação idempotente) e "Este conteúdo foi útil?" (rodapé; UP grava; DOWN abre Popover com motivo e descrição; histórico mutável). Todo DOWN vigente é contestação; revisor responde uma vez; colaborador vê em "Ver resposta" e recebe aviso.

## Achados
| Id | Sev. | Escopo | Resumo |
| --- | --- | --- | --- |
| CP-1 | Major | G2, D6, D7, A2 | Rótulos/perguntas dos motivos foram escritos para "não foi útil" (NOT_HELPFUL, POOR_WRITING, INIA_COULD_NOT_ANSWER) e não fazem sentido sob "Por que você não concorda?" |
| CP-2 | Major | G6, D6 | Controle de ciência fica dentro do acordeão em atendimento e publicado sem V2: escolha e resposta escondidas com o item fechado; o aviso deve abrir o item |
| CP-3 | Major | D6, plano 13 | Mapa da sessão tem precedência e cache infinito: resposta da revisão que chega depois não aparece; falta regra de junção e o cache de entregas |
| CP-4 | Major | D6 | Fechar o diálogo (Esc, toque fora, Cancelar, bloqueio) perde até 1000 caracteres |
| CP-5 | Major | A5, D6 | No celular a etapa com "Não concordo" passa de 450 px; `DialogContent` sem altura máxima nem rolagem |
| CP-6 | Major | D6, D7 | "Revisão de contestações" é jargão; não diz quem lê nem onde a resposta aparece; "Sua avaliação" colide com o glossário |
| CP-7 | Major | G7, D4, D6 | Contestação antiga em item sem ciência: aparece? Quem confirmou antes do deploy perde o caminho de discordar — registrar |
| CP-8 | Nit | D5 × plano 4 | "Uma consulta" × duas; formato de `sources`; onde aparece o aviso de `alreadyConfirmed`; o que é "escolha diferente" |
| CP-9 | Nit | §5 | Tela antiga: mensagens mandam tentar de novo, só recarregar resolve |
| CP-10 | Nit | D6 | Controle dos motivos, trocar motivo mantém o texto, "Etapa 1 de 2", foco inicial, justificativa como texto puro |
| CP-11 | Nit | glossário | Termos sem definição (Joinha, Leitura do dia, aplicação, evento, massa demo, Monitoria de usabilidade, footer) |
