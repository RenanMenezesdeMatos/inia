import type { Metadata } from "next"

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ExampleCard, SeeAlso, StepList, WarningCallout, WikiArticle, WikiFlow, WikiLink, WikiPageHeader, WikiSection, WikiTable } from "@/components/wiki/wiki-primitives"
import type { WikiTocEntry } from "@/components/wiki/wiki-toc"
import { INVESTIGATION_CAPABILITIES, INVESTIGATION_CAPABILITY_DESCRIPTIONS, INVESTIGATION_CAPABILITY_LABELS, INVESTIGATION_TOOLS } from "@/schemas/admin/investigation.schema"

export const metadata: Metadata = {
  title: "Ferramentas de investigação",
  description: "Como um Agent investiga os dados antes de concluir: capacidades, ferramentas que calculam fatos, IA que interpreta, restrição pelo Workflow, uso no chat e no avatar, trace auditável, qualidade e proveniência.",
}

const TOC: WikiTocEntry[] = [
  { id: "principio", label: "Princípio: ferramenta calcula, IA interpreta" },
  { id: "papeis", label: "Quem faz o quê" },
  { id: "capacidades", label: "Capacidades (o que o admin liga)" },
  { id: "ferramentas", label: "Ferramentas por capacidade" },
  { id: "qualidade", label: "Qualidade, amostra e proveniência" },
  { id: "workflow", label: "Workflow pode restringir" },
  { id: "chat-avatar", label: "Chat e Avatar" },
  { id: "trace", label: "Trace das ferramentas" },
  { id: "exemplo", label: "Exemplo: “Por que meu TMA aumentou?”" },
  { id: "limites", label: "Limites de investigação" },
  { id: "eficiencia", label: "Eficiência: preflight, ondas, ledger e evidência" },
  { id: "contexto-modelo", label: "Três contextos: auditoria, modelo e revisão" },
  { id: "escopo-evidencia", label: "Representatividade e escopo das afirmações" },
  { id: "roteamento", label: "Roteamento de modelo" },
  { id: "gating-fail-closed", label: "Validação de evidência fail-closed" },
  { id: "cobertura", label: "Cobertura: registrado × operacional" },
  { id: "gateway", label: "Gateway único de IA" },
  { id: "prompt-componentes", label: "Prompt por componentes e cache" },
  { id: "custo", label: "Tokens e custo estimado" },
  { id: "suficiencia", label: "Objetivo, necessidades de evidência e parada" },
  { id: "fatos-criticos", label: "Fatos críticos e cálculo pela aplicação" },
  { id: "recall", label: "Amostragem, fontes de evidência e contagem sem ambiguidade" },
  { id: "observacao-semantica", label: "Observação semântica antes do padrão" },
  { id: "limitacoes", label: "Limitações atuais" },
]

export default function InvestigationToolsWikiPage() {
  return (
    <WikiArticle toc={TOC}>
      <WikiPageHeader
        eyebrow="06 · Agents"
        title="Ferramentas de investigação"
        lead="Um Agent não precisa responder de uma vez com o que recebeu. Com ferramentas de investigação, ele consulta fatos determinísticos nos dados — indicador, períodos, recortes, população comparável, interações, transcrições, jornada, bases de conhecimento — e só então conclui. A INIA não deve responder “seu TMA está alto, seja mais rápido”: ela investiga o que aconteceu, quando, onde está concentrado, em quais interações, comparado com quem, e se os dados sustentam a conclusão."
      />

      <WikiSection id="principio" title="Princípio: ferramenta calcula, IA interpreta" eyebrow="Regra arquitetural">
        <p>
          <strong className="font-medium text-foreground">Ferramenta</strong> = consulta ou calcula um fato determinístico (a mesma matemática das telas de Indicadores, das
          Conditions e do Calendário operacional — nunca uma segunda versão). <strong className="font-medium text-foreground">Agent</strong> = decide o que investigar,
          formula hipóteses e interpreta os resultados. A IA não faz cálculo que a aplicação pode fazer e não conclui causa sem evidência.
        </p>
        <WikiFlow
          steps={[
            { label: "Contexto inicial mínimo", tone: "input" },
            { label: "Agent escolhe uma ferramenta", tone: "ai" },
            { label: "Ferramenta devolve fatos + qualidade + proveniência", tone: "core" },
            { label: "Agent avalia · pode chamar outra", tone: "ai" },
            { label: "Evidência suficiente", tone: "core" },
            { label: "Diagnóstico / feedback (+ materiais de apoio, se pertinentes)", tone: "output" },
          ]}
        />
        <p>
          A investigação é <em>dinâmica</em>: nada é pré-calculado “para todo feedback”. Dois colaboradores com o mesmo indicador ruim não recebem obrigatoriamente o
          mesmo diagnóstico — se as evidências forem diferentes, os feedbacks são diferentes; se forem parecidas, a semelhança é aceitável e explicável pelo trace.
        </p>
      </WikiSection>

      <WikiSection id="papeis" title="Quem faz o quê" eyebrow="Agent · Orquestrador · Workflow · Chat/Avatar">
        <WikiTable>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Papel</TableHead>
                <TableHead>Responsabilidade</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="font-medium">Ferramenta</TableCell>
                <TableCell>Consulta/calcula fatos, somente leitura. Nunca altera indicador, transcrição, situação, escala, ausência, base ou feedback.</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Agent</TableCell>
                <TableCell>É o dono das capacidades. Investiga apenas quando necessário, escolhe as ferramentas conforme o problema, diferencia correlação de causa e para quando há evidência suficiente.</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Orquestrador</TableCell>
                <TableCell>Escolhe quais especialistas atuam, coordena e sintetiza. Não ganha ferramentas analíticas: cada especialista investiga com as capacidades dele e devolve resposta, evidências, trace e candidatos a material.</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Workflow</TableCell>
                <TableCell>Define objetivo, contexto e escopo; pode restringir as capacidades disponíveis naquela execução. Nunca concede capacidade que o Agent não tem.</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Chat / Avatar</TableCell>
                <TableCell>Acionam Orquestrador + Agents sem Workflow. O especialista usa as capacidades configuradas nele.</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </WikiTable>
      </WikiSection>

      <WikiSection id="capacidades" title="Capacidades (o que o admin liga)" eyebrow="Agent › Ferramentas de investigação">
        <p>
          No editor do Agent, a seção <strong className="font-medium text-foreground">Ferramentas de investigação</strong> mostra sete capacidades amigáveis — nunca nomes técnicos.
          Cada capacidade libera ferramentas internas (lista “avançado, somente leitura”). Sem nenhuma capacidade marcada, o Agent responde como sempre.
        </p>
        <WikiTable>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Capacidade</TableHead>
                <TableHead>O que permite</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {INVESTIGATION_CAPABILITIES.map((capability) => (
                <TableRow key={capability}>
                  <TableCell className="font-medium">{INVESTIGATION_CAPABILITY_LABELS[capability]}</TableCell>
                  <TableCell>{INVESTIGATION_CAPABILITY_DESCRIPTIONS[capability]}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </WikiTable>
      </WikiSection>

      <WikiSection id="ferramentas" title="Ferramentas por capacidade" eyebrow="Pequenas e determinísticas">
        <p>
          Não existe uma ferramenta “diagnostique tudo”: cada uma responde a uma pergunta objetiva. As duas de análise de transcrição usam IA para ler o conteúdo,
          mas devolvem <em>padrões com trechos literais</em> — um trecho que não existe na transcrição é descartado pela aplicação.
        </p>
        <WikiTable>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Capacidade</TableHead>
                <TableHead>Ferramenta</TableHead>
                <TableHead>Pergunta que responde</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {INVESTIGATION_TOOLS.map((tool) => (
                <TableRow key={tool.key}>
                  <TableCell>{INVESTIGATION_CAPABILITY_LABELS[tool.capability]}</TableCell>
                  <TableCell className="font-medium">{tool.label}</TableCell>
                  <TableCell>{TOOL_QUESTIONS[tool.key]}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </WikiTable>
        <WarningCallout title="Oficial ≠ operacional">
          Fechamento oficial (valor, atingimento, quartil, peso, PRV) é consultado como fornecido — nunca recalculado. Análise operacional (medições diárias, pela
          semântica do catálogo: média ponderada, taxa, soma, último valor) é outra camada e as ferramentas nunca misturam as duas.
        </WarningCallout>
        <WarningCallout title="Recortes por assunto, hora e flag" kind="tip">
          As medições de indicador são por colaborador × dia — não existe vínculo medição ↔ interação. Recortes por assunto/hora/flag usam a duração e o volume das
          próprias interações registradas (uma <em>proxy declarada</em> para indicadores em segundos ou contagem) e a resposta diz isso explicitamente; para indicadores em
          percentual (Qualidade, taxas) esse recorte é “não suportado”, nunca inventado.
        </WarningCallout>
      </WikiSection>

      <WikiSection id="qualidade" title="Qualidade, amostra e proveniência" eyebrow="Todo fato vem com contexto">
        <p>
          Toda ferramenta devolve <strong className="font-medium text-foreground">dados</strong>, <strong className="font-medium text-foreground">qualidade</strong> (amostra,
          cobertura, atualidade e um status: dado suficiente, amostra insuficiente, cobertura insuficiente, dado desatualizado, fonte atrasada, disponibilidade
          desconhecida, sem dados, não suportado) e <strong className="font-medium text-foreground">proveniência</strong> (período, população, filtros, fonte, método). As
          mesmas semânticas de suficiência do catálogo de indicadores e do Calendário operacional valem aqui — amostra insuficiente não vira afirmação definitiva.
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Comparações com pares são sempre agregadas (Subgrupo ou Grupo), com população mínima; nenhum dado individual de colega é exposto ao modelo nem ao feedback.</li>
          <li>Interações comparáveis são escolhidas por regra determinística (mesmo assunto/canal, menor duração), anônimas — nunca “bons operadores” por opinião do modelo.</li>
          <li>Picos e recorrência usam mediana e desvio absoluto mediano (método fixo, explicável) — nunca IA nem aprendizado de máquina.</li>
          <li>Jornada operacional reutiliza o Calendário operacional (planejado × observado, precedência congelada): a ferramenta relata; não reinterpreta férias/INSS nem classifica ausência.</li>
        </ul>
      </WikiSection>

      <WikiSection id="workflow" title="Workflow pode restringir" eyebrow="Node Chamar agente › Ferramentas nesta execução">
        <p>
          O node <em>Chamar agente</em> mostra as capacidades que o Agent tem e permite desmarcar algumas para aquela execução. A regra é uma interseção: capacidades
          efetivas = capacidades do Agent ∩ permitidas pelo Workflow. Nodes antigos (sem override) usam as do Agent — nenhum Workflow existente muda de comportamento.
        </p>
        <ExampleCard title="Exemplo">
          O Agent tem Indicadores, Segmentação, Comparação, Interações e Base de Conhecimento. O Workflow libera só Indicadores, Segmentação e Interações. Nessa
          execução o Agent não compara com a estrutura nem consulta a base — e o Workflow não conseguiria liberar “Jornada operacional”, que o Agent não tem.
        </ExampleCard>
      </WikiSection>

      <WikiSection id="chat-avatar" title="Chat e Avatar" eyebrow="Sem Workflow">
        <p>
          No chat e no avatar o Orquestrador aciona os especialistas; cada um investiga com as capacidades configuradas nele (sujeito = o operador da conversa; período
          padrão = últimos 30 dias) antes de responder. O Orquestrador continua coordenando e sintetizando — não vira um Agent monolítico com todas as ferramentas.
        </p>
      </WikiSection>

      <WikiSection id="trace" title="Trace das ferramentas" eyebrow="Auditável, sem raciocínio">
        <p>
          Cada execução guarda um trace seguro: ferramenta, argumentos resumidos, resultado resumido, qualidade, proveniência, início e fim. Nunca o prompt, nunca a
          cadeia de raciocínio — só ações e fatos observáveis. Ele viaja com o resultado do Agent no Workflow, aparece na Revisão humana (“Ferramentas de investigação
          utilizadas”), fica no registro da execução do Agent e no <code>context_snapshot</code> do Feedback, e no chat fica junto da resposta. No QA Lab, a seção{" "}
          <strong className="font-medium text-foreground">Ferramentas utilizadas</strong> de cada etapa é a prova de que o Agent realmente investigou.
        </p>
      </WikiSection>

      <WikiSection id="exemplo" title="Exemplo: “Por que meu TMA aumentou?”" eyebrow="Uma investigação possível">
        <WarningCallout title="É um exemplo, não um roteiro" kind="tip">
          O Agent não é obrigado a seguir sempre esta ordem nem a usar todas as ferramentas. Ele escolhe conforme o problema: “preciso comparar período?”, “preciso
          segmentar por assunto?”, “preciso olhar as chamadas?”, “preciso consultar a escala?”. Zero conclusões fortes é um resultado aceitável quando os dados não
          sustentam mais que isso.
        </WarningCallout>
        <StepList
          steps={[
            { title: "Consultar indicador", detail: "TMA do colaborador no período, pela semântica oficial do catálogo, com meta, amostra e cobertura." },
            { title: "Comparar períodos", detail: "Piorou em relação ao período anterior? Diferença absoluta e relativa calculadas pela aplicação." },
            { title: "Segmentar por assunto", detail: "Onde a duração está concentrada (duração das interações registradas por assunto — proxy declarada)." },
            { title: "Comparar com a estrutura", detail: "O Subgrupo tem o mesmo comportamento no mesmo assunto? Agregado, sem expor colegas." },
            { title: "Buscar interações", detail: "As chamadas mais longas do assunto concentrado, com flags." },
            { title: "Analisar transcrições", detail: "Padrões com trechos literais que possam explicar a duração (nunca causa sem evidência)." },
            { title: "Consultar Base de Conhecimento", detail: "Qual procedimento se aplica ao que foi observado." },
            { title: "Recomendar material", detail: "Até 3 materiais reais, só entre os consultados, com motivo específico." },
          ]}
        />
      </WikiSection>

      <WikiSection id="limites" title="Limites de investigação" eyebrow="Custo e loops sob controle">
        <ul className="list-disc space-y-1 pl-5">
          <li>Orçamento de chamadas de ferramenta por execução: alvo de 8 e teto de 12 (o preflight conta); esgotado, o Agent conclui com o que apurou.</li>
          <li>Rodadas de planejamento: preferencialmente 2, no máximo 3. A escrita das notas e a síntese final não contam como rodada.</li>
          <li>Mesma ferramenta com exatamente os mesmos argumentos na mesma investigação = resultado reaproveitado do cache da execução (sem nova consulta).</li>
          <li>Tempo limite por ferramenta e para a investigação inteira; listas de interações e transcrições têm teto fixo.</li>
          <li>Token Budget: limiares de aviso configuráveis por ambiente (total, input, output) — a execução registra o alerta, nunca é interrompida por ele.</li>
        </ul>
      </WikiSection>

      <WikiSection id="eficiencia" title="Eficiência: preflight, ondas, ledger e evidência" eyebrow="Evidência útil por token">
        <p>
          O Agent continua decidindo o que investigar — mas não precisa pensar várias vezes sobre a mesma coisa. A investigação funciona assim:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong className="font-medium text-foreground">Preflight determinístico</strong>: quando a execução parte de um indicador, a aplicação já consulta o
            indicador (valor, meta, amostra, cobertura, atualidade), valida a qualidade do dado e lista as dimensões disponíveis antes da primeira request;
            quando parte de uma interação, já traz o contexto dela. É só o fato inicial — nunca o diagnóstico.
          </li>
          <li>
            <strong className="font-medium text-foreground">Ondas em paralelo</strong>: numa única decisão o Agent pode pedir várias ferramentas independentes
            (ex.: comparar períodos + comparar com o Subgrupo + detectar anomalias); elas rodam ao mesmo tempo e o resultado volta em uma rodada. O trace
            registra a rodada e quantas chamadas correram juntas; a sequência continua lógica.
          </li>
          <li>
            <strong className="font-medium text-foreground">Evidence Ledger</strong>: cada fato apurado vira uma linha compacta F1, F2… (ferramenta, argumentos
            essenciais, resultado, qualidade). É isso que o modelo lê a cada rodada e na síntese final — sem identificadores técnicos, timestamps ou
            proveniência integral, que continuam no trace persistido para QA e auditoria.
          </li>
          <li>
            <strong className="font-medium text-foreground">Contexto compactado por rodada</strong>: objetivo, contexto inicial, ledger acumulado, limitações,
            resultados detalhados só da última onda e o orçamento restante. Nada do histórico bruto é reenviado.
          </li>
          <li>
            <strong className="font-medium text-foreground">Só as ferramentas utilizáveis</strong> são declaradas em cada rodada: as permitidas pelas capacidades,
            aplicáveis ao contexto (sem interações no período, nenhuma ferramenta de interação) e com pré-requisitos satisfeitos (analisar transcrições só
            depois de conhecer ids). Organizar evidências e recomendar materiais acontecem na síntese final, sem ida e volta extra.
          </li>
          <li>
            <strong className="font-medium text-foreground">Valor informacional</strong>: a política pede nova consulta só se ela puder confirmar, refutar ou
            alterar uma hipótese — Subgrupo antes de Grupo, uma camada de histórico por vez, dimensão com hipótese, jornada e base de conhecimento sob
            demanda, e reserva de chamadas para interações/transcrições quando a resposta pretende falar de comportamento.
          </li>
          <li>
            <strong className="font-medium text-foreground">Evidence gating</strong>: a síntese final devolve, além do feedback, as hipóteses sustentadas e não
            sustentadas, as limitações, cada afirmação sobre comportamento com as referências que a sustentam e a base de cada recomendação (evidência
            observada, orientação da base de conhecimento ou sugestão geral de desenvolvimento). A aplicação valida por código: afirmação comportamental sem
            fato de interação/transcrição e recomendação &quot;observada&quot; sem referência são devolvidas ao modelo para UMA correção; se persistirem, a
            resposta é descartada. Sem evidência, a linguagem correta é factual: &quot;os dados mostram o indicador acima da referência, mas a amostra de
            interações disponível não é suficiente para identificar uma causa comportamental&quot;.
          </li>
        </ul>
      </WikiSection>

      <WikiSection id="contexto-modelo" title="Três contextos: auditoria, modelo e revisão" eyebrow="UUID é para o sistema; fato é para a IA; resumo é para o humano">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong className="font-medium text-foreground">Contexto de auditoria</strong> — o que fica persistido (trace completo das ferramentas, identificadores reais, proveniência
            integral, timestamps). Nunca é enviado ao modelo.
          </li>
          <li>
            <strong className="font-medium text-foreground">Contexto do modelo</strong> — só informação com valor para o raciocínio: fatos F1..Fn, qualidade e período. Identificadores
            técnicos são removidos e as entidades que a IA precisa citar viram referências curtas desta execução (I1 = uma interação, K1 = um documento, M1 = um material de apoio),
            que a aplicação resolve de volta. Uma referência inventada ou de outra execução é recusada. Organização, colaborador e permissões são vinculados pelo runtime — a IA nunca
            os informa.
          </li>
          <li>
            <strong className="font-medium text-foreground">Contexto de revisão</strong> — a apresentação legível para o supervisor (ver <WikiLink href="/wiki/workflows/human-review">Revisão humana</WikiLink>).
          </li>
        </ul>
      </WikiSection>

      <WikiSection id="escopo-evidencia" title="Representatividade e escopo das afirmações" eyebrow="Evidência verdadeira ≠ generalização válida">
        <p>
          Cada fato de interação/transcrição recebe uma representatividade calculada pela aplicação — <strong className="font-medium text-foreground">Insuficiente</strong>,{" "}
          <strong className="font-medium text-foreground">Anedótica</strong> ou <strong className="font-medium text-foreground">Representativa</strong> — a partir do número de interações analisadas,
          do universo do período e da amostra mínima. Cada afirmação sobre comportamento declara um escopo: <em>nesta(s) interação(ões)</em>, <em>padrão no período</em>,{" "}
          <em>padrão do colaborador</em> ou <em>padrão dos pares</em>. Duas interações entre centenas de contatos sustentam &quot;nas duas interações analisadas ocorreu X&quot;,
          nunca &quot;você costuma fazer X&quot; — a validação por código devolve a afirmação para correção e, persistindo, a resposta é descartada (Workflow) ou substituída pela
          versão factual (chat e voz). O mesmo contrato vale para o Agent direto, para o especialista acionado por um Orquestrador e para a síntese do Orquestrador, que nunca pode
          ampliar o escopo do que o especialista sustentou.
        </p>
      </WikiSection>

      <WikiSection id="roteamento" title="Roteamento de modelo" eyebrow="Determinístico e independente de provedor">
        <p>
          A INIA conhece tiers de modelo (<strong className="font-medium text-foreground">BASIC</strong>, <strong className="font-medium text-foreground">STANDARD</strong>,{" "}
          <strong className="font-medium text-foreground">DEEP</strong>) e perfis (provedor, modelo, capacidades), nunca um nome de modelo dentro de um Agent ou Workflow. A rota de
          cada request é decidida por regras com sinais do runtime (fase, número e tamanho de transcrições, quantidade de especialistas, complexidade da saída) — nunca por outra
          chamada de IA — e só entre perfis que sustentam o contrato da fase (function calling, saída estruturada, janela de contexto). Falha de parse ou correção de evidência
          pode escalar um tier; erro de rede nunca escala. O modo padrão (CURRENT) mantém as rotas já em produção; o modo EFFICIENCY é avaliado em QA comparativo antes de qualquer
          adoção. O QA Lab mostra a rota de cada request.
        </p>
      </WikiSection>

      <WikiSection id="gating-fail-closed" title="Validação de evidência fail-closed" eyebrow="Resposta sem envelope validável nunca chega ao usuário">
        <p>
          Toda resposta com conteúdo comportamental (feedback do Agent, especialista, chat, avatar e síntese do Orquestrador) traz um envelope interno de evidência —
          os campos de auditoria no JSON ou a linha interna <code>EVIDENCE_JSON</code> — que a aplicação valida por código. A partir da V1.3 o envelope é obrigatório:
          se ele vier ausente ou inválido, a resposta é tratada como <strong className="font-medium text-foreground">não validável</strong>, nunca como &quot;zero afirmações&quot;.
        </p>
        <StepList
          steps={[
            { title: "Envelope presente e parseável?", detail: "Sim → as afirmações e recomendações são validadas contra o ledger. Não → uma correção pede o envelope." },
            { title: "Retry válido?", detail: "Sim → validado normalmente (uma única correção). Não → fallback." },
            { title: "Fallback factual seguro", detail: "No chat, no avatar e no Agent em texto livre, a resposta vira um texto determinístico com os fatos do ledger validado, as limitações e a orientação de procedimento quando há base real — nunca reaproveita texto comportamental do modelo. No Workflow (Feedback), a resposta é descartada, como já acontece com a citação não literal." },
          ]}
        />
        <p>
          Nenhum segundo modelo &quot;julga&quot; o primeiro: contrato estruturado + validação determinística + no máximo uma correção. O trace guarda envelope presente, status
          do parse, correção tentada/aceita e fallback usado; a Revisão humana e o QA Lab mostram esse status.
        </p>
      </WikiSection>

      <WikiSection id="cobertura" title="Cobertura: registrado × operacional" eyebrow="Dois universos que nunca se confundem">
        <p>
          &quot;Analisei quantas das interações disponíveis?&quot; e &quot;analisei uma parcela representativa de todos os contatos?&quot; são perguntas diferentes. A cobertura do universo{" "}
          <strong className="font-medium text-foreground">registrado</strong> compara interações analisadas com as interações gravadas do colaborador no período. O universo{" "}
          <strong className="font-medium text-foreground">operacional</strong> é o volume que compõe o indicador (por exemplo, 1.267 contatos de um TMA). A cobertura operacional só é
          calculada quando a relação entre os dois conjuntos é conhecida; quando não é possível ligar as interações registradas ao volume operacional, ela fica{" "}
          <em>Não determinado</em> — a INIA nunca infere &quot;30 de 1.267&quot;. Trinta interações registradas, trinta analisadas = 100% do registrado, não 100% do operacional.
          A representatividade (Insuficiente/Anedótica/Representativa) parte do registrado e, frente a um universo operacional maior e não vinculado, uma amostra abaixo do absoluto
          não é promovida a representativa. O escopo permitido para as afirmações (nesta interação, padrão no período, do colaborador, dos pares) deriva disso, por código.
        </p>
      </WikiSection>

      <WikiSection id="gateway" title="Gateway único de IA" eyebrow="Toda request do backend é observável no mesmo ponto">
        <p>
          Agent, especialista, Orquestrador (chat, voz e Workflow), análise semântica de transcrições, síntese pós-Join e Orquestrador consolidado saem por um único gateway,
          que decide a rota (perfil/tier), classifica a request (fase, propósito, origem e tipo semântico — nunca ids pessoais), registra contexto por categoria e componentes de
          prompt, observa o cache e estima o custo. Exceções documentadas: a sessão de voz do avatar (Gemini Live) roda no navegador e continua uma sessão própria — qualquer
          especialista/Agent acionado a partir dela passa pelo gateway; e o chat sem Orquestrador configurado mantém a resposta em streaming, sem evidência envolvida.
        </p>
      </WikiSection>

      <WikiSection id="prompt-componentes" title="Prompt por componentes e cache" eyebrow="O modelo recebe só o necessário para a tarefa atual">
        <p>
          O prompt de cada request é composto de componentes com id, versão e fases em que se aplicam — identidade do Agent, expectativas e restrições da organização, política de
          investigação, contrato de saída, regras de evidência (estáticos) e sujeito, trechos de conhecimento recuperados, materiais candidatos e referências da execução (dinâmicos).
          O planejamento não recebe o contrato de redação final nem os trechos de KB (só os títulos, para decidir a consulta); a síntese não recebe schemas de ferramentas. As
          declarações das ferramentas enviadas ao modelo são compactas (pergunta que a ferramenta responde + argumentos semânticos); a validação continua no catálogo, e o indicador
          em foco é injetado pelo runtime quando omitido. O prefixo estático — igual entre colaboradores, sem transcrição, ledger ou dado pessoal — pode ir para o cache explícito do
          provedor; a chave inclui modelo, versão dos componentes e conteúdo, de modo que qualquer mudança de prompt invalida o cache. Conteúdo dinâmico nunca entra em cache
          compartilhado. Cada otimização é ativada separadamente (perfil de prompt, schema compacto, cache explícito, modo de roteamento) e só vira padrão depois do comparativo
          nos mesmos casos, sob a regra: <strong className="font-medium text-foreground">qualidade &gt; economia de tokens</strong>.
        </p>
      </WikiSection>

      <WikiSection id="custo" title="Tokens e custo estimado" eyebrow="Só o que o provedor informou, preço só por configuração">
        <p>
          Cada request registra tokens de entrada, cacheados, saída e raciocínio como o provedor informou (ausente = &quot;Não informado&quot;, nunca estimado), o modo de cache
          (nenhum, implícito ou explícito) e, quando o administrador configura preços por perfil de modelo, um custo estimado (ESTIMATED_PROVIDER_COST) — sempre uma estimativa,
          nunca fatura. Sem configuração, o QA Lab mostra &quot;Preço não configurado&quot;.
        </p>
      </WikiSection>

      <WikiSection id="suficiencia" title="Objetivo, necessidades de evidência e parada" eyebrow="O modelo propõe parar; o runtime decide">
        <p>
          Toda investigação recebe do runtime um <strong className="font-medium text-foreground">objetivo</strong> explícito — descrever a performance, explicar o desvio do
          indicador, feedback de uma interação, identificar padrão do colaborador, comparar com a população, auditoria de processo ou diagnóstico multidomínio — e o{" "}
          <strong className="font-medium text-foreground">escopo de afirmação exigido</strong> pela conclusão (nesta interação, padrão no período, do colaborador, dos pares, ou
          apenas quantitativo). O Agent não é obrigado a perseguir um escopo maior do que o objetivo pede, nem pode parar antes de sustentá-lo.
        </p>
        <p>
          A parada é um <strong className="font-medium text-foreground">controle de suficiência da evidência</strong>, não um mecanismo de economia: não existe &quot;usou X
          ferramentas → pare&quot; nem &quot;já há texto possível → pare&quot;. Ao decidir não chamar mais ferramentas, o Agent entrega, junto das notas, um estado investigativo
          compacto (afirmações sustentadas com escopo, perguntas abertas, hipóteses com status, evidência conflitante, limitações, se mais evidência mudaria a conclusão) — nunca
          raciocínio. A aplicação deriva as <strong className="font-medium text-foreground">necessidades de evidência</strong> do objetivo + evidência encontrada (nunca um
          checklist por indicador) e só aceita a parada quando o objetivo está respondido, o escopo exigido sustentado, não há pergunta ou hipótese <em>material</em> aberta
          (material = poderia mudar a conclusão, a recomendação, o escopo permitido, revelar problema estrutural ou evidência não representativa), não há contradição relevante sem
          contextualização e nenhuma ferramenta disponível resolveria a lacuna. Caso contrário a parada é recusada e a investigação continua com as lacunas e as ferramentas
          candidatas; sem caminho, termina como dados insuficientes.
        </p>
        <WikiTable>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Motivo da parada</TableHead>
                <TableHead>Quando</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="font-medium">Evidência suficiente</TableCell>
                <TableCell>objetivo respondido, escopo sustentado, nenhuma lacuna material aberta</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Dados insuficientes</TableCell>
                <TableCell>sabe-se o que faltaria, mas os dados não existem/não têm cobertura (ex.: 1.267 contatos e 2 interações registradas para uma causa comportamental)</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Sem caminho</TableCell>
                <TableCell>há lacuna, mas nenhuma ferramenta autorizada nesta execução a resolve</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Limite de rodadas / orçamento de ferramentas / limiar de tokens / segurança</TableCell>
                <TableCell>a investigação terminou por limite — a síntese recebe isso explicitamente e nunca apresenta evidência incompleta como suficiente</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </WikiTable>
        <p>
          Uma chamada única com transcrição, citação literal e procedimento aplicável termina sem pedir comparáveis; &quot;isso é um padrão do colaborador?&quot; com uma
          interação não termina — precisa de recorrência e representatividade, ou termina como dados insuficientes. O Orquestrador preserva esses motivos: um especialista com dados
          insuficientes nunca vira &quot;provavelmente a causa é X&quot;, e evidência conflitante entre especialistas aparece como conflito. O QA Lab mostra o objetivo, o escopo
          exigido, o motivo, as necessidades (satisfeitas/abertas/bloqueadas), as hipóteses materiais e cada parada proposta e recusada, com o motivo.
        </p>
      </WikiSection>

      <WikiSection id="fatos-criticos" title="Fatos críticos e cálculo pela aplicação" eyebrow="A aplicação calcula; a IA interpreta">
        <p>
          Toda proporção, delta ou taxa útil à conclusão é calculada pelas ferramentas e entregue pronta (&quot;6 de 7 interações com a flag = 85,7%&quot;, diferença × meta em
          segundos e %, própria × referência das comparáveis, variação do primeiro ao último ponto do histórico) — o modelo nunca deriva números, e valores oficiais (atingimento,
          quartil, peso, PRV) continuam como fornecidos. Dos resultados das ferramentas a aplicação extrai os{" "}
          <strong className="font-medium text-foreground">fatos críticos à decisão</strong> (valor × meta, tendência, comparação com a referência, qualidade do dado); a síntese
          declara quais considerou e a aplicação valida por código: um fato de melhora nunca vira &quot;piorou&quot;, a meta não vira &quot;atingida&quot;, e a limitação de
          representatividade não some. O texto não precisa repetir todos os números — precisa não contradizer o que os dados dizem. Uma correção; contradição persistente descarta.
        </p>
      </WikiSection>

      <WikiSection id="recall" title="Amostragem, fontes de evidência e contagem sem ambiguidade" eyebrow="Encontrar mais evidência real sem passar a inventar">
        <p>
          <strong className="font-medium text-foreground">A amostra depende da pergunta.</strong> Listar as interações mais recentes responde &quot;o que aconteceu ultimamente&quot;; para um padrão ou uma
          evolução numa janela longa (mais de ~5 semanas), o runtime escolhe por padrão uma amostra <em>distribuída no tempo</em>: a janela é dividida em blocos de ~30 dias e a seleção faz rodízio
          entre eles — determinística (a mesma janela e os mesmos dados dão sempre a mesma amostra), sem aumentar o teto de itens. O modelo pode pedir outra estratégia (por assunto, com/sem flag) quando
          uma hipótese justificar. A estratégia, os blocos e quantas interações vieram de cada um ficam no trace (nunca ids).
        </p>
        <p>
          <strong className="font-medium text-foreground">A análise de transcrições sabe por que existe.</strong> Além do pedido do Agent, a ferramenta recebe o objetivo derivado, o escopo de afirmação
          exigido, a intenção do período (uma interação · padrão · padrão e evolução) e as necessidades, perguntas e hipóteses materiais ainda abertas — nunca uma lista de &quot;o que procurar&quot;.
          Zero achados sustentados é uma resposta válida; um achado sem trecho literal continua descartado por código.
        </p>
        <p>
          <strong className="font-medium text-foreground">Unidades literais reais.</strong> A transcrição chega ao modelo como <em>turnos</em> numerados (&quot;[T4] CLIENTE: …&quot;, sem
          marcação de tempo — ela fica só na auditoria), e cada trecho citado aponta para uma interação, um turno e um falante. A verificação continua literal e determinística, turno a turno: um
          achado que depende de duas falas (pergunta e resposta) cita dois trechos, cada um validado sozinho, e declara se precisa de todos (&quot;ALL&quot;) ou de um (&quot;ANY&quot;); a
          concatenação de duas falas numa citação só nunca existiu na fonte e não é aceita; paráfrase, falante trocado e interação trocada continuam recusados; um número de turno errado com trecho
          literal em outro turno é resolvido pelo trecho e registrado como divergência. Nos pares, a validação é contra a projeção de privacidade. As contagens usam só evidência validada, e o QA Lab
          mostra &quot;Evidências semânticas: candidatas · validadas · descartadas&quot; com o motivo no detalhe técnico.
        </p>
        <p>
          <strong className="font-medium text-foreground">Ver momentos diferentes ≠ afirmar que algo mudou.</strong> Numa janela longa, cada interação chega ao modelo com o bloco da janela e a data local
          calculados pela aplicação (&quot;I4 · B2 · 28/07&quot;; B1 = início, B2 = meio, B3 = fim) — a ordem no texto e o estilo da conversa não dizem nada sobre tempo. Ter evidência de vários blocos é
          <em> cobertura temporal</em>; dizer que algo aumentou, passou a acontecer, ficou estável ou aconteceu &quot;no início do período&quot; é uma <em>relação temporal</em>, e a investigação só a aceita
          quando os blocos foram comparados: a análise de interações devolve uma comparação entre blocos com as contagens recalculadas pela aplicação (a direção declarada é conferida contra elas),
          e &quot;nenhuma diferença sustentada&quot; é um resultado válido que encerra a pergunta. Na resposta final, uma afirmação temporal precisa declarar a relação e os blocos; posição fora do bloco,
          um único momento, comparação só do indicador para uma afirmação sobre comportamento, direção contrária aos fatos ou amostra insuficiente são recusados por código — inclusive quando a
          linguagem temporal aparece nas hipóteses, na premissa de uma recomendação ou no texto entregue. O QA Lab mostra &quot;Comparação temporal: blocos disponíveis · analisados · comparados · resultado&quot;.
          <strong className="font-medium text-foreground"> Ausência na amostra ≠ ausência no período.</strong> Um achado sem trecho nas transcrições analisadas de um bloco é &quot;não observado na amostra&quot;, nunca
          &quot;deixou de ocorrer&quot;: a aplicação compara analisadas × interações registradas por bloco e só considera a ausência estabelecida com cobertura suficiente. Cada relação tem requisito próprio —
          mudança exige evidência comparável nos dois blocos (ou ausência estabelecida); tendência exige três momentos ordenados, não só extremos diferentes; estabilidade considera todos os momentos analisados;
          concentração exige ausência estabelecida nos blocos de contraste; padrões diferentes só precisam de evidência positiva em cada lado. Quando as amostras diferem sem sustentar relação, o resultado é
          &quot;diferença só na amostra&quot;, e a resposta pode dizer apenas o fato da amostra (&quot;observado em 2 das 3 analisadas de junho e em nenhuma das 3 de agosto&quot;). Os blocos são dias civis inteiros
          (B1 = 01/06 a 30/06 · B2 = 01/07 a 31/07 · B3 = 01/08 a 31/08), sem intervalos sobrepostos.
          <strong className="font-medium text-foreground"> &quot;Nenhuma diferença sustentada&quot; não é &quot;permaneceu estável&quot;.</strong> A aplicação deriva das comparações validadas uma <em>conclusão temporal autorizada</em>
          (relação sustentada · nenhuma diferença sustentada · diferença só na amostra · insuficiente) com uma formulação segura, e o texto entregue, as hipóteses e as premissas das recomendações são checados
          contra ela: estabilidade (&quot;se manteve constante&quot;, &quot;mantendo a performance estável&quot;) só com relação de estabilidade sustentada; mudança/tendência só com relação de mudança sustentada.
          Sem isso a resposta recebe uma correção e, persistindo, o destino fail-closed de sempre. Um status de relação (&quot;STABLE&quot;) escrito no lugar do resultado da comparação não é promovido a
          &quot;nenhuma diferença&quot;. Nas transcrições, o modelo vê SÓ a referência canônica de cada interação (&quot;I6 · B2 · 14/03&quot;) — nenhuma posição de apresentação concorre com o handle;
          &quot;I3&quot; é sempre a interação I3 e uma referência inexistente é recusada. O QA Lab mostra &quot;Conclusão autorizada&quot; ao lado da comparação temporal.
        </p>
        <p>
          <strong className="font-medium text-foreground">Contagem sem ambiguidade.</strong> &quot;Trecho verificado em ≥2 de 8 analisadas&quot; conta as transcrições <em>analisadas</em> em que o achado
          tem citação literal verificada — um limite inferior, nunca &quot;quantas vezes aconteceu no período&quot;. A participação no universo do período só é calculada quando a amostra é o universo
          inteiro; caso contrário fica indeterminada e o contexto diz explicitamente que &quot;2 de 8&quot; não representa &quot;2 de 30&quot;. Tudo calculado pela aplicação.
        </p>
        <p>
          <strong className="font-medium text-foreground">Fontes de evidência.</strong> A cada rodada o modelo vê as famílias de evidência desta execução (conteúdo das interações, eventos por interação,
          histórico/evolução, segmentação, população, indicador, qualidade do dado, jornada, conhecimento), quais já consultou e que tipo de lacuna cada uma responde — e a pergunta &quot;que tipo de
          evidência ainda mudaria a conclusão?&quot;. Não é um checklist: uma fonte só é consultada quando a lacuna é material. Duas necessidades genéricas entraram no controlador de parada: em janela
          longa com pergunta de padrão/causa, a evidência precisa atravessar o período (histórico ou interações de mais de um bloco); num feedback de interação trazida por um sinal (flag), o sinal
          precisa de contexto além da própria transcrição (eventos; outras interações do colaborador). Uma recusa de parada na última rodada fica registrada como tal — sem rodada extra.
        </p>
      </WikiSection>

      <WikiSection id="observacao-semantica" title="Observação semântica antes do padrão" eyebrow="Fato → interpretação → padrão → afirmação">
        <p>
          <strong className="font-medium text-foreground">A análise não salta da transcrição para o padrão.</strong> Para cada interação analisada a INIA monta primeiro um <em>frame semântico</em>: o que o
          cliente precisava e se ficou resolvido, parcial, sem resposta ou indeterminado; as perguntas e as respostas (completa, parcial, sem relação); o que o operador fez ou declarou ter feito
          (consultou, confirmou, transferiu, orientou, resumiu, informou prazo, assumiu compromisso, verificou entendimento); o que informou ao cliente; os compromissos e se foram cumpridos na própria
          conversa; os sinais do cliente (pergunta repetida, confusão, urgência, discordância, satisfação, insatisfação, pedido de confirmação); e as afirmações do operador sobre procedimento
          (&quot;precisa…&quot;, &quot;não precisa…&quot;, &quot;o prazo é…&quot;). Só depois vêm os <em>findings</em> daquela interação — ponto forte, atrito, necessidade não resolvida, questão procedimental,
          contradição, contexto — e só no fim os <em>padrões entre interações</em>, montados a partir dos findings. Um frame com listas vazias é resposta válida: nenhuma interação é obrigada a ter defeito,
          e um comportamento positivo é registrado com a mesma seriedade que um risco.
        </p>
        <p>
          <strong className="font-medium text-foreground">Nada flutua.</strong> Toda observação aponta para um turno literal da própria interação (a mesma verificação de sempre); um finding só existe se
          nasce de observações válidas do mesmo frame; um padrão só existe se nasce de findings válidos — a evidência do padrão é a união da evidência dos findings, e a cadeia padrão → finding →
          observação → turno → transcrição é auditável de ponta a ponta. O tipo do padrão é derivado dos findings pela aplicação (positivo só vira ponto forte; risco real nunca vira ponto forte;
          misto quando há os dois); uma necessidade &quot;resolvida&quot; sem o turno que a resolveu volta a &quot;indeterminada&quot;; uma necessidade sem resposta é registrada sem inventar o que deveria ter sido dito.
          A extração e a síntese de padrões são duas chamadas distintas: pedindo as duas coisas de uma vez, o modelo devolvia um frame em oito e saltava para a conclusão.
          Na primeira chamada a INIA <em>observa primeiro</em> (findings são opcionais); na segunda, com todas as observações verificadas à frente, ela pode <em>promover</em> uma observação a finding —
          só com observações que já existem (uma observação omitida nunca é recuperada; o QA Lab mostra &quot;N na extração + M promovidos na síntese&quot;). Eventos da transcrição (falas
          sobrepostas, espera, transferência, silêncio) são observações próprias com atribuição, não risco automático; um sinal do cliente sozinho (pergunta repetida, insatisfação) vira
          &quot;atrito da interação&quot;, nunca ponto de atenção do operador — atribuir um risco ao operador exige uma observação do lado dele (ação, afirmação, compromisso, necessidade não resolvida).
        </p>
        <p>
          <strong className="font-medium text-foreground">Repetição não é amplitude.</strong> Cada padrão recebe DUAS medidas calculadas pela aplicação, que respondem a perguntas diferentes.
          O <em>nível</em> responde &quot;quanto se repetiu?&quot;: observado uma vez · repetido na amostra · recorrente na amostra (ao menos metade das analisadas, mínimo três) · padrão do colaborador
          sustentado. O <em>escopo de suporte</em> responde &quot;até onde a evidência permite generalizar?&quot;: só nas interações analisadas · no período analisado (amostra representativa) · no período
          analisado com todas as interações registradas · padrão do colaborador. Desse escopo sai o teto da afirmação: cobrir todas as seis interações registradas de um período prova o período, não um
          traço da pessoa — &quot;no período analisado&quot; passa, &quot;o colaborador apresenta como característica&quot; não. &quot;Duas das oito analisadas&quot; sustenta exatamente isso —
          &quot;observado em duas das oito interações analisadas&quot;. Cada afirmação da resposta final aponta para UM suporte, escolhido entre os padrões e findings que existem naquela execução (a
          aplicação mostra a lista e recusa qualquer identificador fora dela — não há reparo por aproximação), e confere o vínculo: o padrão existe e foi aceito, a polaridade combina (um ponto forte
          nunca vira &quot;falha recorrente&quot;; um atrito sem atribuição nunca vira falha do colaborador), o escopo declarado não excede o teto e a linguagem forte (&quot;costuma&quot;, &quot;é um padrão
          seu&quot;) só passa com padrão do colaborador sustentado — fatos verdadeiros não sustentam padrão sem padrão. Mesmo esse escopo descreve o que foi observado <em>na janela analisada</em>:
          &quot;no período analisado, o colaborador apresentou um padrão recorrente de…&quot; passa; &quot;o colaborador é…&quot;, &quot;por natureza&quot;, &quot;sempre foi&quot; não passam em nenhum escopo.
        </p>
        <p>
          <strong className="font-medium text-foreground">A aplicação projeta; a IA escolhe e explica.</strong> Cada padrão e cada finding aceito vira um <em>candidato de afirmação</em> montado pela
          aplicação, já com o tipo (ponto forte, ponto de atenção, atrito da interação, questão procedimental), a polaridade que ele autoriza, o escopo máximo que a evidência sustenta, a contagem
          (&quot;observado em 4 de 8 interações analisadas&quot;), a proveniência e a regra temporal válida naquela execução. A IA recebe essa lista e decide só duas coisas: quais candidatos são
          relevantes para a resposta — deixar candidatos de fora é uma escolha legítima — e como explicá-los em linguagem natural. Ela não redecide se algo é força ou risco, nem até onde pode
          generalizar. O que continua sendo verificado é a redação: um texto que descreve um ponto forte como falha, que atribui ao colaborador um atrito sem atribuição, que generaliza acima do escopo
          do candidato ou que afirma uma mudança temporal não autorizada é recusado e reescrito — e cada afirmação continua sendo tratada uma a uma.
        </p>
        <p>
          <strong className="font-medium text-foreground">Uma conclusão errada não apaga três conclusões certas.</strong> A validação é por afirmação: cada uma recebe seu próprio veredito, e a
          correção enviada ao modelo cita <em>só</em> as que falharam — com o suporte congelado (o mesmo padrão/finding: trocá-lo para a afirmação passar é recusado), a polaridade permitida por aquele
          suporte, o escopo máximo e o motivo — pedindo que o resto da resposta fique como está. O que se corrige entra; o que insiste é descartado, e as afirmações válidas da mesma resposta continuam
          valendo, junto das recomendações que se apoiam nelas (uma recomendação que só existia por causa da afirmação descartada cai com ela). A resposta inteira só é substituída pela versão factual
          em último caso: quando a afirmação descartada continua escrita no texto entregue, quando o problema é do texto como um todo (fato do período contradito, linguagem temporal sem comparação
          sustentada) ou quando nenhuma afirmação segura sobrou. O QA Lab mostra o destino: &quot;4 propostas · 3 aceitas (1 após correção) · 1 descartada&quot;. Uma relação temporal sustentada carrega o seu <em>escopo de suporte</em>: só nas amostras comparadas
          (&quot;nas interações analisadas, 2 de 3 em fevereiro e 3 de 3 em abril&quot;), nas interações registradas (cobertura total, volume baixo) ou como mudança do colaborador — &quot;você passou a&quot;
          exige o último. Uma afirmação do operador sobre
          procedimento é registrada, nunca julgada na análise: concluir que a orientação diverge do procedimento exige um finding/padrão procedimental da interação e um trecho real da base de
          conhecimento; sem a base, fica como questão procedimental a verificar. O QA Lab resume: &quot;Análise semântica: N frames · com finding · forças · riscos · necessidades não resolvidas ·
          questões procedimentais · padrões entre interações&quot;.
        </p>
      </WikiSection>

      <WikiSection id="procedimento" title="Afirmou uma regra? A base realmente diz isso?" eyebrow="Fato · interpretação · avaliação procedimental">
        <p>
          <strong className="font-medium text-foreground">Três coisas que nunca se misturam.</strong> &quot;O cliente perguntou se precisa enviar documento&quot; e &quot;o operador disse que não
          precisa&quot; são <em>fatos</em>, com o turno literal de cada um. &quot;O operador afirmou a ausência de um requisito documental&quot; é <em>interpretação</em>: a afirmação normativa passa a
          carregar assunto, modalidade (é obrigatório · não é obrigatório · é proibido · é permitido · é uma informação · é um compromisso), condição, ação e o prazo/valor exatamente como foi dito.
          &quot;Coerente&quot;, &quot;divergente&quot; ou &quot;indeterminado&quot; é <em>avaliação</em> — e ela só existe depois de uma regra da base de conhecimento.
        </p>
        <p>
          <strong className="font-medium text-foreground">A regra precisa estar escrita.</strong> A INIA traduz os trechos recuperados das bases autorizadas do Agent em regras estruturadas (assunto,
          modalidade, condição, ação, valor) e <em>só aceita a regra com o trecho literal do documento</em> — paráfrase, documento não apresentado ou assunto vazio são descartados. Sem trecho que
          sustente a regra, o resultado é &quot;conhecimento insuficiente&quot;: conhecimento geral sobre o setor nunca preenche a lacuna, e a afirmação segue como questão procedimental a verificar.
          Entre vários documentos recuperados, vale o trecho que fala do <em>mesmo assunto</em> da afirmação — a presença de uma base qualquer não é autoridade genérica.
        </p>
        <p>
          <strong className="font-medium text-foreground">A comparação é da aplicação, não do modelo.</strong> Modalidade contra modalidade: a base diz que a ação é <em>opcional</em> e o atendimento
          não a fez — isso não é erro; a base <em>exige</em> sob uma condição verdadeira e o operador diz explicitamente que não é necessário — isso é divergência. Se a condição da regra não está
          sustentada pelo contexto daquele atendimento, a regra é <em>inaplicável</em>: comparar o cenário errado é o falso positivo procedimental mais comum, e ele é contado explicitamente.
          Prazos e valores são normalizados com o operador que o texto usa: &quot;48 horas&quot; cabe dentro de &quot;até 48 horas&quot; e dentro de &quot;24 a 48 horas&quot;; &quot;72 horas&quot; não
          cabe em &quot;até 48 horas&quot;; &quot;48 horas úteis&quot; e &quot;48 horas&quot; não são a mesma coisa e a aplicação não inventa a conversão — fica como divergência possível, não confirmada.
          Quatro resultados: coerente, divergência possível, contradito e conhecimento insuficiente.
        </p>
        <p>
          <strong className="font-medium text-foreground">Aderência é uma força; aderência parcial não é aderência integral.</strong> Uma afirmação coerente com um trecho verificado da base vira um
          ponto forte com a mesma seriedade de um risco; uma afirmação contradita vira uma divergência procedimental verificada; uma divergência possível ou um assunto sem regra viram questão
          procedimental. O que a regra não decide não vira finding nenhum. E como a avaliação cobre apenas os pontos confrontados com a base — não existe checklist estruturado do procedimento
          inteiro —, &quot;cumpriu os requisitos verificados&quot; passa e &quot;seguiu integralmente o procedimento&quot; é recusado. O QA Lab mostra o funil: afirmações normativas · regras da base com
          trecho literal · comparações por resultado · cobertura.
        </p>
        <p>
          <strong className="font-medium text-foreground">Uma necessidade em aberto é, primeiro, um resultado.</strong> Ao fim de um atendimento a INIA registra o ESTADO de cada necessidade do cliente
          (resolvida, parcial, em aberto, indeterminada) — esse estado vem da leitura da conversa e nunca é reescrito depois. Separadamente, e só depois, ela pergunta DE QUÊ aquele resultado dependeu:
          de uma ação do operador, de um terceiro (uma visita técnica, outra área, um sistema), de algo que o próprio cliente precisa fazer depois, de um prazo do processo — ou de nada que a conversa
          permita determinar, que é a resposta mais comum e perfeitamente válida. Diagnosticar corretamente e agendar a visita técnica deixa a necessidade em aberto e continua sendo um bom atendimento.
        </p>
        <p>
          <strong className="font-medium text-foreground">Atribuir ao operador exige uma ponte.</strong> A conta só passa para a conduta dele quando a própria conversa mostra a ligação: uma resposta dele
          parcial ou não relacionada à pergunta do cliente, um compromisso dele contrariado ali mesmo, ou uma divergência procedimental confirmada contra um trecho da base. Sem essa ponte, a aplicação
          recusa a atribuição — mesmo que a análise tenha proposto — e a necessidade em aberto permanece como <em>resultado da interação</em>, sem ponto de atenção e sem culpa. É por isso que
          &quot;a necessidade ficou em aberto&quot; e &quot;o operador deixou a necessidade em aberto&quot; são duas frases diferentes, e só a segunda precisa de prova.
        </p>
        <p>
          <strong className="font-medium text-foreground">E padrão do colaborador exige que o padrão seja dele.</strong> Cada padrão entre interações carrega o seu DONO: conduta do operador, lado do
          cliente, resultado da interação, dependência de processo, ou indeterminado. Só um padrão de conduta do operador pode sustentar &quot;o colaborador costuma…&quot;. Quatro atendimentos em oito
          com necessidades em aberto por dependência externa continuam sendo um padrão — do período, do processo —, nunca um traço da pessoa, por mais que a amostra seja representativa. Essa trava é
          estrutural: ela não depende de o texto estar bem escrito.
        </p>
        <p>
          <strong className="font-medium text-foreground">A avaliação procedimental é um acompanhante, não um juiz do que já foi visto.</strong> Ela roda depois que a leitura da conversa terminou,
          recebe só as observações relevantes (necessidades, perguntas e respostas, ações, afirmações sobre procedimento) e nunca reescreve nenhuma delas: apenas anota o significado normativo e devolve
          uma avaliação. Se essa etapa falhar, a investigação continua normalmente — o que se perde é a informação procedimental, nunca a análise. O QA Lab mostra as duas coisas lado a lado:
          quantas necessidades ficaram em aberto e de quê dependem, e quantas afirmações foram confrontadas com a base.
        </p>
      </WikiSection>

      <WikiSection id="limitacoes" title="Limitações atuais" eyebrow="O que ainda não existe">
        <ul className="list-disc space-y-1 pl-5">
          <li>Dimensões disponíveis hoje: dia, dia da semana, semana (medição) e assunto, canal, hora, flag (interações). Perfil de cliente, produto e tipo de interação não existem nos dados.</li>
          <li>O Orquestrador pós-Join (síntese gerencial) não investiga — trabalha só com os resultados consolidados.</li>
          <li>O node Orquestrador do Workflow não restringe capacidades dos especialistas (só o node Chamar agente restringe).</li>
          <li>A cobertura operacional só é determinada quando o volume do indicador coincide com as interações registradas; em todos os outros casos fica &quot;Não determinado&quot;.</li>
          <li>O prompt do Orquestrador (chat/voz) e do Orquestrador consolidado ainda não é separado em prefixo estático — não usa cache explícito.</li>
          <li>A materialidade de perguntas/hipóteses declaradas pelo modelo é a que ele declara (no máximo 4 materiais abertas de cada vez); a aplicação só impõe materialidade às necessidades que deriva do objetivo.</li>
          <li>A recusa de parada na última rodada é registrada, não remediada: o limite de 3 rodadas de planejamento continua o mesmo.</li>
          <li>Flags e histórico só entram quando o Agent os escolhe; a base de conhecimento continua consultada em toda execução; a comparação entre blocos é feita pela análise de interações (comportamento) ou pelo histórico do indicador — não há comparação automática de flags/eventos por bloco.</li>
          <li>Referências internas (I-n, rótulos de escopo, marcador de zero achados) ainda podem aparecer no texto final ao colaborador.</li>
        </ul>
      </WikiSection>

      <SeeAlso
        links={[
          { href: "/wiki/agents", label: "Agents", hint: "campos do editor, incluindo Ferramentas de investigação" },
          { href: "/wiki/orchestrators", label: "Orchestrators", hint: "coordenação e síntese" },
          { href: "/wiki/bases-conhecimento#material-apoio", label: "Materiais de apoio", hint: "candidatos → recomendação → apresentação" },
          { href: "/wiki/qa-lab", label: "QA Lab", hint: "seção Ferramentas utilizadas" },
        ]}
      />
    </WikiArticle>
  )
}

const TOOL_QUESTIONS: Record<string, string> = {
  get_indicator_snapshot: "Qual é a situação deste indicador neste período? (valor pela semântica do catálogo, meta, amostra, cobertura, oficial como fornecido)",
  compare_periods: "Melhorou ou piorou? (diferença absoluta/relativa, direção e sentido de performance)",
  inspect_indicator_composition: "O que está formando este indicador? (componentes reais; sem componentes = não suportado)",
  validate_data_quality: "Existe evidência suficiente para confiar nesta análise?",
  detect_anomalies: "Isso é recorrente ou existe pico/período atípico? (mediana + MAD)",
  get_employee_history: "Como evoluiu no histórico? (operacional por semana ou oficial por mês, nunca misturados)",
  synthesize_evidence: "Organiza fatos, hipóteses sustentadas/não sustentadas e limitações — não calcula nada novo",
  get_available_dimensions: "Por quais dimensões este dado pode ser segmentado com os dados reais?",
  segment_indicator: "Onde o resultado está concentrado? (buckets com amostra e contribuição)",
  compare_population: "Isso é individual ou também ocorre no Subgrupo/Grupo? (agregado, com população mínima)",
  find_interactions: "Quais interações estão relacionadas a este recorte? (limite seguro)",
  get_interaction_context: "Qual é o contexto objetivo desta interação?",
  get_interaction_flags: "Quais flags apareceram neste conjunto? (coexistência não é causa)",
  find_comparable_interactions: "Quais interações de pares são realmente comparáveis? (mesmo assunto/canal, anônimas)",
  analyze_interactions: "Que padrões aparecem nestas transcrições, com trecho literal?",
  analyze_peer_patterns: "Que padrões aparecem nas comparáveis de melhor desempenho? (“na amostra analisada”)",
  inspect_work_context: "Escala, situação, ausências e disponibilidade dos dados explicam o resultado?",
  query_knowledge: "Qual procedimento interno é relevante para esta evidência?",
  recommend_support_materials: "Quais materiais reais, entre os consultados, ajudam de verdade? (0–3, com motivo)",
}
