# Indicadores de dificuldade de uso — Workflows

**Nenhum destes indicadores está ativo hoje.** Não existe painel nem rotina de acompanhamento. As consultas abaixo são sugestões a executar sob demanda e não foram validadas com dados reais de uso.

**Privacidade:** coletar só códigos, contagens, tempos e ids internos. Nunca nome de colaborador, transcrição, conteúdo de feedback ou texto digitado.

## Disponíveis com o que já está gravado

| Indicador | Pergunta | Fonte | Limite |
|---|---|---|---|
| Tempo até a primeira publicação | Quanto demora do rascunho ao ar? | `workflows.created_at` × primeira `workflow_versions.created_at` | Não separa tempo ativo de tempo parado |
| Criados e nunca publicados | Quantos ficam pelo caminho? | `workflows` sem `active_version_id` | Inclui modelos e testes; filtrar por nome distorce |
| Versões por workflow | Publica-se por tentativa e erro? | `count(*)` de `workflow_versions` por workflow | Republicar pode ser legítimo |
| Causa de falhas | O que mais falha? | Eventos `node_failed` e `flow_dead`, por tipo e por código | Só execuções reais |
| Execuções bloqueadas e tempo até resolver | Quanto tempo ficam paradas? | `workflow_enrollments.status = 'blocked'`, `blocked_at`, novas tentativas | — |
| Revisões paradas há muito tempo | WF-08 acontece? | Matrículas `waiting` em revisão sem alerta correspondente | Consulta precisa cruzar `alerts` |
| Publicações por pessoa e gatilho | Quem usa, e o quê? | `audit_logs` `WORKFLOW_PUBLISHED` | Não mede dificuldade |

Exemplo, só leitura:

```sql
select w.id,
       w.created_at,
       min(v.created_at) as primeira_publicacao,
       min(v.created_at) - w.created_at as tempo_ate_publicar,
       count(v.id) as versoes
from workflows w
left join workflow_versions v on v.workflow_id = w.id
group by w.id, w.created_at;
```

## Dependem de instrumentação

A monitoria de usabilidade (`backend/src/modules/usage-analytics`) já existe, mas está desligada e só registra elementos catalogados. Na auditoria, `workflow.manual_run.open` é o único elemento de Workflows encontrado no editor.

| Indicador | Evento a registrar (só código e contagem) | Pergunta |
|---|---|---|
| Conclusão e abandono da criação | `workflow.create.open`, `.done`, `.cancel` | Quem começa termina? |
| Tempo até o primeiro workflow válido | Primeira `workflow.validation.ready` por workflow | Quanto esforço até ficar publicável? |
| Erros de validação mais frequentes | `workflow.validation.issue` com **código**, nunca a mensagem | Quais regras confundem? |
| Tentativas de publicação | `workflow.publish.start`, `.confirm`, `.cancel` | A pessoa desiste no diálogo? |
| Localizar e corrigir etapa com erro | `workflow.issue.open`, tempo até o problema sumir | A lista ajuda? |
| Uso de modelos | `workflow.create.from_template`, `.adapted`, `.published` (depende de P3) | Modelos reduzem esforço? |
| Causa de falha identificada | `workflow.execution.expand`, seguido de nova tentativa ou edição | A aba explica? Exige validação qualitativa |
| Saída sem salvar | `workflow.leave_guard.discard`, `.keep` | Com que frequência isso quase vira perda? |

**Antes de ligar:** o catálogo `usage-elements.ts` está sendo editado por outra sessão, e a coleta só deve ser ligada por decisão explícita, por área.

## Como ler

- Número alto de publicações por workflow **não significa** dificuldade sozinho: cruze com entrevista.
- Sem coleta, não há linha de base. Registre os valores antes de P1 e P3 para poder comparar.
