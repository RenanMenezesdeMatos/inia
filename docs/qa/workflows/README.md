# QA de Workflows

| Documento | Conteúdo |
|---|---|
| [relatorio-2026-11-04.md](relatorio-2026-11-04.md) | Diagnóstico, jornadas, referências, plano e limitações |
| [achados.md](achados.md) | Fichas de cada achado: evidência, reprodução, solução, aceite |
| [registro-de-achados.md](registro-de-achados.md) | Status atual de cada achado |
| [propostas.md](propostas.md) | Mudanças maiores, com antes/depois e decisões pendentes |
| [matriz-regressao.md](matriz-regressao.md) | Jornadas críticas para repetir depois de cada mudança |
| [indicadores.md](indicadores.md) | Métricas disponíveis e as que dependem de instrumentação |
| [ambiente-simulado/](ambiente-simulado/README.md) | API em memória para ver as telas sem banco nem credencial |
| [levantamento-p5.mjs](levantamento-p5.mjs) | Levantamento só de leitura das referências quebradas e das revisões sem revisor; obrigatório antes de implantar a P5 |

## Como repetir a auditoria

**Não há rotina nem automação configurada.** A repetição depende de alguém iniciá-la. Sugestão: depois de cada entrega que mexa no editor, e antes de cada homologação.

1. Rode as verificações automáticas da [matriz](matriz-regressao.md#verificações-automáticas).
2. Percorra a matriz. Use o ambiente simulado para o que é de tela, e o ambiente de desenvolvimento com uma conta de teste para os itens `R*`.
3. Nunca publique nem execute com efeito real sem autorização. Workflow publicado e ativo por Flag, Indicador ou Agenda age sobre os dados de todos que usam o banco de desenvolvimento e gasta IA.
4. Para cada achado novo, crie uma ficha em `achados.md` e uma linha no registro, com o tipo de evidência (interface, código, teste ou hipótese).
5. Atualize o status somente com evidência: `corrigido` exige teste, `validado` exige ver funcionando no navegador **com o backend real**. A tela simulada só leva a `conferido em simulação`.
6. Compare a documentação com a tela: Wiki em `frontend/src/app/wiki/workflows/` e `docs/workflow-engine-wiki.md`.
7. Sempre que possível, inclua pessoas reais: tarefas curtas com 5 administradores revelam o que nenhuma destas verificações revela.
