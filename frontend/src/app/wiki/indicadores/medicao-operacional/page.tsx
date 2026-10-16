import type { Metadata } from "next"

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ExampleCard, SeeAlso, WarningCallout, WikiArticle, WikiPageHeader, WikiSection, WikiTable } from "@/components/wiki/wiki-primitives"
import type { WikiTocEntry } from "@/components/wiki/wiki-toc"

export const metadata: Metadata = {
  title: "Medição operacional × Fechamento oficial",
  description:
    "As duas camadas de indicadores da INIA: medições operacionais diárias (o que está acontecendo agora, agregado pela INIA) e o fechamento oficial mensal (atingimento, PRV, quartil e peso recebidos da empresa). Janelas temporais, agregação por semântica, quartil operacional e evidência do cálculo.",
}

const TOC: WikiTocEntry[] = [
  { id: "visao-geral", label: "Duas camadas" },
  { id: "regra-de-ouro", label: "Regra de ouro" },
  { id: "medicao", label: "A medição operacional" },
  { id: "agregacao", label: "Agregação por semântica" },
  { id: "janelas", label: "Janelas temporais" },
  { id: "fechamento", label: "Mês fechado × mês corrente" },
  { id: "cobertura", label: "Cobertura mínima" },
  { id: "elegibilidade", label: "Dias elegíveis e situação funcional" },
  { id: "escalas", label: "Escalas 5x2 e 6x1" },
  { id: "excecoes", label: "Exceções: day off e banco de horas" },
  { id: "medicao-elegivel", label: "Medição só em data elegível" },
  { id: "feriados", label: "Feriados, capital operacional e política" },
  { id: "planejado-observado", label: "Planejado × observado" },
  { id: "disponibilidade", label: "Disponibilidade dos dados (D-1/D-2)" },
  { id: "classificacao", label: "Classificação e falta injustificada" },
  { id: "quartil", label: "Quartil operacional × quartil oficial" },
  { id: "tela", label: "Na área de Indicadores" },
  { id: "peso", label: "Peso oficial (weight_percent)" },
  { id: "componentes-oficiais", label: "Numerador e denominador do fechamento" },
  { id: "qa", label: "Evidência no QA Lab" },
  { id: "diario", label: "Indicadores com medição diária" },
]

const DAILY: { code: string; kind: string; daily: string; why: string }[] = [
  { code: "TMA, TMT, TEMPO_DIAGNOSTICO", kind: "Média ponderada", daily: "Sim", why: "Total de segundos ÷ contatos/casos/tickets do dia." },
  { code: "MONITORIA_QUALIDADE, QUALIDADE_ANALISE", kind: "Média ponderada", daily: "Sim", why: "Nota × quantidade de avaliações do dia; dia sem avaliação = sem medição." },
  { code: "NOTA_URA, NPS", kind: "Média ponderada", daily: "Sim", why: "Nota × respostas do dia; dia sem resposta = sem medição." },
  { code: "FCR, REINCIDENCIA_7D, TAXA_TRANSFERENCIA, TAXA_RETRABALHO, TAXA_RETENCAO, RECONTATO_CANCELAMENTO, SLA_24H", kind: "Taxa", daily: "Sim", why: "Ocorrências ÷ elegíveis do dia (contatos, casos, pedidos)." },
  { code: "ADERENCIA, TEMPO_DISPONIVEL", kind: "Taxa", daily: "Sim", why: "Minutos logados/disponíveis ÷ minutos escalados do dia." },
  { code: "BACKLOG", kind: "Último valor", daily: "Sim", why: "Snapshot do dia — a semana é o último backlog, nunca a soma dos snapshots." },
  { code: "TAXA_ABANDONO, CONVERSAO_UPSELL", kind: "Taxa", daily: "Não", why: "Apuradas por fila/campanha e estrutura, não por operador por dia." },
  { code: "QUALIDADE, TDNA, TEMPO_SILENCIO", kind: "Média ponderada", daily: "Não", why: "Legado duplicado (QUALIDADE) e derivados de flag por interação — granularidade INTERACTION, futura." },
  { code: "PRODUTIVIDADE", kind: "Média simples", daily: "Não", why: "Casos por dia sem volume de referência definido — fica mensal." },
]

export default function MedicaoOperacionalPage() {
  return (
    <WikiArticle toc={TOC}>
      <WikiPageHeader
        eyebrow="03 · Indicadores e Performance"
        title="Medição operacional × Fechamento oficial"
        lead="A INIA trabalha com duas camadas de indicadores que nunca se misturam. A camada operacional são medições diárias por colaborador que a INIA agrega em janelas (hoje, últimos 7 dias, semana anterior…) para dizer o que está acontecendo agora. O fechamento oficial é a competência mensal recebida pronta da empresa — valor oficial, atingimento, quartil oficial, peso e PRV — que a INIA só lê."
      >
        <p className="max-w-2xl text-sm text-foreground/80">
          Por isso são frases diferentes, e as duas podem ser verdadeiras ao mesmo tempo: &quot;Mariana foi <strong className="font-medium text-foreground">Q4 oficial</strong> de TMA em agosto&quot; (fechamento
          corporativo) e &quot;Mariana está em <strong className="font-medium text-foreground">Q4 operacional</strong> de TMA nos últimos 7 dias&quot; (calculado pela INIA sobre as medições daquela janela e daquela população).
        </p>
      </WikiPageHeader>

      <WikiSection id="regra-de-ouro" title="Regra de ouro" eyebrow="O que a INIA calcula e o que ela nunca inventa">
        <div className="grid gap-4 md:grid-cols-2">
          <ExampleCard title="A INIA PODE calcular (camada operacional)">
            <ul className="list-inside list-disc space-y-1">
              <li>média ponderada, taxa, soma, último valor, mínimo, máximo, contagem;</li>
              <li>variação percentual entre duas janelas ((atual − anterior) ÷ anterior × 100);</li>
              <li>ranking relativo numa população;</li>
              <li>quartil <strong className="font-medium text-foreground">operacional</strong> numa população, janela e agregação.</li>
            </ul>
          </ExampleCard>
          <ExampleCard title="A INIA NÃO inventa (camada oficial)">
            <ul className="list-inside list-disc space-y-1">
              <li>atingimento oficial (achievement_percent);</li>
              <li>PRV oficial;</li>
              <li>quartil oficial;</li>
              <li>peso oficial (weight_percent).</li>
            </ul>
            <p className="mt-2">Esses quatro continuam vindo da fonte corporativa, por competência mensal. Não existe &quot;PRV diário&quot; nem &quot;peso diário&quot; só porque passamos a ter medições diárias.</p>
          </ExampleCard>
        </div>
      </WikiSection>

      <WikiSection id="medicao" title="A medição operacional" eyebrow="indicator_measurements">
        <p>
          Cada medição expressa um <strong className="font-medium text-foreground">intervalo de negócio explícito</strong> — colaborador, indicador, valor, início e fim do período, granularidade (hoje DAILY;
          MONTHLY/CUSTOM para legado; HOURLY e INTERACTION preparadas para o futuro) e origem. O momento em que a linha foi gravada (created_at) nunca é usado como período
          do indicador. Além do valor apresentável do período, a medição guarda os <strong className="font-medium text-foreground">componentes</strong> necessários para agregar corretamente vários
          períodos: numerador, denominador e amostra.
        </p>
        <WarningCallout title="Dia sem amostra é SEM DADOS, não zero">
          Um operador sem avaliação de qualidade no dia não tem medição de Qualidade naquele dia; sem resposta na URA, não tem Nota URA. A janela &quot;últimos 7 dias&quot; usa só os dias que
          existem — e informa quantos foram, com a cobertura em relação aos dias úteis esperados. Ausência nunca vira zero, e nunca coloca ninguém no Q4 por omissão.
        </WarningCallout>
      </WikiSection>

      <WikiSection id="agregacao" title="Agregação por semântica" eyebrow="Nunca AVG(value) para tudo">
        <p>
          Cada indicador declara, no catálogo, <strong className="font-medium text-foreground">como vários períodos se combinam</strong>. O editor de Workflow só oferece as agregações que fazem sentido para
          o indicador escolhido e a publicação rejeita o resto (SUM de TMA não existe; média simples de taxa com volumes diferentes por dia também não).
        </p>
        <ExampleCard title="Por que TMA da semana não é a média dos TMAs diários">
          <p>Segunda: 600 s em 10 chamadas. Terça: 400 s em 100 chamadas. A média simples diria 500 s. O correto é Σ tempo ÷ Σ chamadas = (6.000 + 40.000) ÷ 110 = <strong className="font-medium text-foreground">418 s</strong>. A INIA agrega assim: média ponderada pelo volume.</p>
        </ExampleCard>
        <WikiTable caption="Semânticas de agregação da camada operacional.">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Semântica</TableHead>
                <TableHead>Como agrega</TableHead>
                <TableHead>Exemplos</TableHead>
                <TableHead>Agregações oferecidas no editor</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow><TableCell>Média ponderada</TableCell><TableCell>Σ numerador ÷ Σ denominador</TableCell><TableCell>TMA, TMT, Qualidade (por avaliações), Nota URA e NPS (por respostas)</TableCell><TableCell>Média ponderada, Mínimo, Máximo, Quantidade</TableCell></TableRow>
              <TableRow><TableCell>Taxa</TableCell><TableCell>Σ ocorrências ÷ Σ elegíveis × 100</TableCell><TableCell>FCR, Reincidência, Transferência, Retrabalho, Retenção, SLA, Aderência</TableCell><TableCell>Média ponderada, Mínimo, Máximo, Quantidade</TableCell></TableRow>
              <TableRow><TableCell>Último valor</TableCell><TableCell>o snapshot mais recente da janela</TableCell><TableCell>Backlog</TableCell><TableCell>Último valor, Máximo, Mínimo, Média simples, Quantidade</TableCell></TableRow>
              <TableRow><TableCell>Soma</TableCell><TableCell>Σ dos períodos</TableCell><TableCell>produção (quando existir)</TableCell><TableCell>Soma, Média simples, Mínimo, Máximo, Quantidade</TableCell></TableRow>
              <TableRow><TableCell>Média simples</TableCell><TableCell>média dos valores dos períodos</TableCell><TableCell>só quando o período já é uma média sem volume</TableCell><TableCell>Média simples, Mínimo, Máximo, Quantidade</TableCell></TableRow>
            </TableBody>
          </Table>
        </WikiTable>
        <p>
          Condition, Ranking (VALUE e CHANGE), quartil operacional, QA Lab e o contexto operacional entregue aos Agents usam o <strong className="font-medium text-foreground">mesmo resolvedor</strong> — não existe uma
          segunda matemática em nenhum módulo.
        </p>
      </WikiSection>

      <WikiSection id="janelas" title="Janelas temporais" eyebrow="Uma definição só, no calendário local da organização">
        <WikiTable caption="Janelas disponíveis para Valor do indicador. Fontes oficiais (Atingimento/PRV) só existem por fechamento mensal — nunca Hoje, Ontem, dias ou semana.">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Janela</TableHead>
                <TableHead>Definição</TableHead>
                <TableHead>Janela anterior (comparação)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow><TableCell>Hoje</TableCell><TableCell>do início do dia local até agora (parcial)</TableCell><TableCell>ontem completo</TableCell></TableRow>
              <TableRow><TableCell>Ontem</TableCell><TableCell>o dia local anterior, completo</TableCell><TableCell>anteontem</TableCell></TableRow>
              <TableRow><TableCell>Últimos N dias</TableCell><TableCell>os N dias de calendário terminando hoje (hoje parcial incluído); dias corridos — fim de semana sem medição só não soma</TableCell><TableCell>os N dias imediatamente anteriores</TableCell></TableRow>
              <TableRow><TableCell>Semana corrente / anterior</TableCell><TableCell>segunda a domingo civis (corrente é parcial)</TableCell><TableCell>a semana civil anterior</TableCell></TableRow>
              <TableRow><TableCell>Mês corrente / anterior</TableCell><TableCell>mês civil (corrente é parcial)</TableCell><TableCell>o mês civil anterior</TableCell></TableRow>
              <TableRow><TableCell>Últimos N meses fechados</TableCell><TableCell>N meses civis completos; o agregado é da união dos meses (Σ ÷ Σ), nunca média das médias mensais; mês esperado sem medição = SEM DADOS</TableCell><TableCell>—</TableCell></TableRow>
            </TableBody>
          </Table>
        </WikiTable>
        <p>
          Uma medição pertence à janela quando o intervalo dela <strong className="font-medium text-foreground">sobrepõe</strong> a janela — assim a medição diária de hoje entra em &quot;Hoje&quot; mesmo com fim às 23:59:59.
          A variação percentual entre janelas usa uma única fórmula: (atual − anterior) ÷ anterior × 100; anterior zero é SEM DADOS. Para indicadores em que menor é melhor (TMA), a
          variação de performance é o inverso da matemática (+8% de TMA = −8% de performance).
        </p>
        <ExampleCard title="Calendário local = timezone IANA da organização">
          <p>
            &quot;Hoje&quot;, &quot;semana&quot; e &quot;mês&quot; são calculados no fuso IANA cadastrado em <code>operations.timezone</code> (ex.: <code>America/Fortaleza</code>, <code>America/Sao_Paulo</code>) — nunca com um
            deslocamento fixo de −03 e nunca com lógica manual de horário de verão: quem sabe se um fuso tem DST é a base de dados de fusos do sistema. Sem timezone cadastrado, o fallback é
            explícito e documentado (<code>America/Fortaleza</code>) — nunca UTC silencioso. Às 23:30 de Fortaleza ainda é &quot;hoje&quot;; às 23:30 em UTC do mesmo instante já seria &quot;amanhã&quot; — por
            isso o fuso chega a todas as avaliações pelo contexto organizacional (<code>EvaluationOptions.timeZone</code>), não como string repetida em cada consulta.
          </p>
        </ExampleCard>
      </WikiSection>

      <WikiSection id="fechamento" title="Mês fechado × mês corrente" eyebrow="Regra explícita: o mês corrente nunca é chamado de fechamento">
        <div className="grid gap-4 md:grid-cols-2">
          <ExampleCard title="Fechamento oficial = mês civil COMPLETO">
            <p>
              Só existe fechamento oficial (atingimento, quartil oficial, PRV, peso) para meses civis já encerrados. Em 16/09/2026 o último fechamento é <strong className="font-medium text-foreground">agosto/2026</strong>;
              &quot;Últimos 6 fechamentos&quot; = março a agosto. A massa de demonstração deriva as competências fechadas da data de referência — nunca de uma lista fixa.
            </p>
          </ExampleCard>
          <ExampleCard title="Mês corrente = só acompanhamento operacional">
            <p>
              Setembro (parcial) existe apenas na camada operacional: medições DIÁRIAS até hoje. Qualquer tela, texto, feedback ou modelo que fale do mês corrente fala de
              &quot;acompanhamento&quot;/&quot;últimos N dias&quot;, nunca de &quot;fechamento de setembro&quot;. Ao virar o mês, o fechamento passa a existir quando a fonte oficial o publica — a INIA não o antecipa.
            </p>
            <p className="mt-2">
              <strong className="font-medium text-foreground">Guard central em runtime:</strong> mesmo que exista uma linha de setembro no banco (fixture, carga antecipada), nenhum leitor oficial — perfil, estrutura, histórico, Conditions
              e Rankings oficiais, Agents com performance, QA Lab, seletor de competência — a enxerga como fechamento enquanto <code>referencePeriod &gt; último mês fechado</code> no fuso da organização. A regra é temporal, não depende
              da origem da linha; a linha permanece e passa a valer em 01/10.
            </p>
          </ExampleCard>
        </div>
      </WikiSection>

      <WikiSection id="cobertura" title="Cobertura mínima" eyebrow="Dias com medição ÷ dias elegíveis">
        <p>
          Cobertura = <strong className="font-medium text-foreground">dias com medição ÷ dias elegíveis</strong> na janela. Dia elegível = dia em que a escala previa trabalho (calendário real; segunda a sexta só como compatibilidade para quem não tem escala) <strong className="font-medium text-foreground">e</strong> a partir da
          admissão (<code>people.hired_at</code>) <strong className="font-medium text-foreground">e</strong> situação funcional EM PRODUÇÃO naquele dia (ver as seções seguintes). Quem foi admitido no meio da janela tem menos dias elegíveis: 3 dias com dado em 3 elegíveis é 100%, não 60%.
          Fim de semana nunca conta como &quot;faltou dado&quot;.
        </p>
        <WikiTable caption="Exemplos com 7 dias corridos = 5 dias úteis elegíveis e cobertura mínima de 60%.">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Dias com dado</TableHead>
                <TableHead>Cobertura</TableHead>
                <TableHead>Resultado da Condition/Ranking</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow><TableCell>5 de 5</TableCell><TableCell>100%</TableCell><TableCell>avalia normalmente</TableCell></TableRow>
              <TableRow><TableCell>3 de 5</TableCell><TableCell>60%</TableCell><TableCell>avalia (60% ≥ 60%)</TableCell></TableRow>
              <TableRow><TableCell>1 de 5</TableCell><TableCell>20%</TableCell><TableCell>SEM DADOS (BELOW_MINIMUM_COVERAGE) — nunca 0, nunca Q4</TableCell></TableRow>
              <TableRow><TableCell>0 de 5</TableCell><TableCell>—</TableCell><TableCell>SEM DADOS (NO_VALUE)</TableCell></TableRow>
              <TableRow><TableCell>3 de 3 (admitido dia 11)</TableCell><TableCell>100%</TableCell><TableCell>avalia normalmente — ausência justificada pela admissão</TableCell></TableRow>
            </TableBody>
          </Table>
        </WikiTable>
        <ul className="list-inside list-disc space-y-1">
          <li>
            <strong className="font-medium text-foreground">Padrão do indicador × regra do Workflow:</strong> o catálogo (<code>IndicatorDefinition.minimumCoverage</code>, ex.: TMA 60%) é o PADRÃO — é o que a área de Indicadores usa e o que o editor pré-preenche ao escolher o indicador.
            Cada Workflow/versão guarda o PRÓPRIO valor (pode sobrescrever: catálogo 60%, Workflow 80% → o runtime usa 80%); nada em runtime altera um Workflow publicado. Sem cobertura mínima no catálogo, a tela usa só o mínimo de medições (se houver) — nunca inventa um limiar.
          </li>
          <li>Campo <strong className="font-medium text-foreground">Cobertura mínima de dias (%)</strong> em Condition (Valor do indicador e Quartil operacional) e em Ranking sobre medições — opcional; sem ele, 1 dia com dado continua sendo dado válido.</li>
          <li>Só existe na camada operacional: fontes oficiais e Quantidade de ocorrências rejeitam o campo na publicação.</li>
          <li>O trace do QA Lab mostra dias elegíveis, dias com dados, cobertura, mínimo exigido e o resultado (&quot;abaixo do mínimo: SEM DADOS&quot;).</li>
          <li>No Ranking e no quartil operacional, quem está abaixo do mínimo fica FORA da população ranqueada, contado como SEM DADOS.</li>
        </ul>
      </WikiSection>

      <WikiSection id="elegibilidade" title="Dias elegíveis e situação funcional" eyebrow="A ausência não é performance ruim">
        <p>
          O colaborador tem uma <strong className="font-medium text-foreground">situação funcional</strong> com histórico por período — consumida da fonte de colaboradores, nunca calculada pela INIA
          (a INIA não é RH: não solicita, aprova nem calcula saldo de férias). É diferente de &quot;conta ativa&quot; (login): quem foi transferido pode continuar com conta por histórico. As nove situações reais do negócio:
        </p>
        <WikiTable caption="Situações funcionais reais — rótulos exatamente como aparecem no perfil, no Admin e na Central.">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Situação</TableHead>
                <TableHead>Elegível operacionalmente?</TableHead>
                <TableHead>Como costuma chegar</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow><TableCell><strong className="font-medium text-foreground">EM PRODUÇÃO</strong></TableCell><TableCell><strong className="font-medium text-foreground">Sim — a única</strong></TableCell><TableCell>Colaboradores (snapshot)</TableCell></TableRow>
              <TableRow><TableCell>TRANSFERIDO</TableCell><TableCell>Não</TableCell><TableCell>Colaboradores</TableCell></TableRow>
              <TableRow><TableCell>FÉRIAS</TableCell><TableCell>Não</TableCell><TableCell>Ausências (período) ou Colaboradores</TableCell></TableRow>
              <TableRow><TableCell>INSS</TableCell><TableCell>Não</TableCell><TableCell>Ausências ou Colaboradores</TableCell></TableRow>
              <TableRow><TableCell>PILOTO</TableCell><TableCell>Não</TableCell><TableCell>Colaboradores</TableCell></TableRow>
              <TableRow><TableCell>MATERNIDADE</TableCell><TableCell>Não</TableCell><TableCell>Ausências ou Colaboradores</TableCell></TableRow>
              <TableRow><TableCell>PATERNIDADE</TableCell><TableCell>Não</TableCell><TableCell>Ausências ou Colaboradores</TableCell></TableRow>
              <TableRow><TableCell>APOSENTADO</TableCell><TableCell>Não</TableCell><TableCell>Colaboradores</TableCell></TableRow>
              <TableRow><TableCell>ATIVIDADE OFF</TableCell><TableCell>Não</TableCell><TableCell>Ausências ou Colaboradores</TableCell></TableRow>
            </TableBody>
          </Table>
        </WikiTable>
        <p>
          <strong className="font-medium text-foreground">Regra positiva única: somente EM PRODUÇÃO é elegível operacionalmente.</strong> Não existe lista negativa espalhada (&quot;não é férias e não é INSS e…&quot;): a regra vive num único
          lugar (<code>isOperationallyEligibleStatus</code>) e é reaproveitada por Condition, Ranking, quartil, Analytics e QA Lab. Os códigos anteriores (Ativo, Férias, Afastado, Inativo) foram convertidos de forma determinística
          (Ativo → EM PRODUÇÃO, Férias → FÉRIAS, Afastado/Inativo → ATIVIDADE OFF — nunca INSS ou APOSENTADO por palpite) e o texto original da fonte é sempre preservado.
        </p>
        <WikiTable caption="Exemplo: janela de segunda a sexta com escala 5x2 (5 dias programados), férias de quarta a sexta, medições na segunda e na terça.">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Programados</TableHead>
                <TableHead>Excluídos</TableHead>
                <TableHead>Dias elegíveis</TableHead>
                <TableHead>Dias com medição</TableHead>
                <TableHead>Cobertura</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow><TableCell>5</TableCell><TableCell>3 em FÉRIAS</TableCell><TableCell>2</TableCell><TableCell>2</TableCell><TableCell><strong className="font-medium text-foreground">100%</strong> — não 2/5 = 40%</TableCell></TableRow>
              <TableRow><TableCell>5</TableCell><TableCell>5 em MATERNIDADE</TableCell><TableCell>0</TableCell><TableCell>—</TableCell><TableCell>SEM DADOS (<code>NO_ELIGIBLE_DAYS</code>) — nunca 0%, nunca valor 0, nunca Q4</TableCell></TableRow>
              <TableRow><TableCell>5</TableCell><TableCell>1 antes da admissão + 2 em INSS</TableCell><TableCell>2</TableCell><TableCell>2</TableCell><TableCell>100% — admissão e situação combinam</TableCell></TableRow>
            </TableBody>
          </Table>
        </WikiTable>
        <ul className="list-inside list-disc space-y-1">
          <li><strong className="font-medium text-foreground">Férias, INSS, maternidade, paternidade não viram zero:</strong> quem não deveria ter produzido sai do denominador; quem deveria e não tem dado é cobertura baixa. Transferido, piloto, aposentado e atividade off simplesmente não participam.</li>
          <li><strong className="font-medium text-foreground">Ranking e quartil operacional:</strong> colaborador sem nenhum dia elegível na janela não participa da população (nem Q4 por omissão); parcialmente elegível participa só com os dias elegíveis. Numa estrutura de 25 com 3 de férias a janela inteira, a população operacional é 22 (&quot;22 de 25 elegíveis&quot;).</li>
          <li><strong className="font-medium text-foreground">Medições recebidas durante férias</strong> permanecem no banco (lineage, auditoria), mas ficam fora de todo cálculo operacional. Se a fonte corrigir a situação (férias 09–20 → 10–20), os cálculos passam a refletir a nova elegibilidade — a medição nunca é reescrita nem apagada.</li>
          <li><strong className="font-medium text-foreground">Situação sem data efetiva:</strong> se a fonte não informa quando a situação começou, a INIA usa a data local em que observou a carga (&quot;situação conhecida a partir desta carga&quot;) e <strong className="font-medium text-foreground">não retroage</strong>. Sem período registrado, o dia é EM PRODUÇÃO presumido — e a INIA sinaliza a presunção.</li>
          <li><strong className="font-medium text-foreground">Fechamento oficial não muda:</strong> atingimento, quartil oficial, peso e PRV continuam sendo os da fonte corporativa — a situação funcional afeta só a camada operacional.</li>
          <li>No perfil, a situação aparece de forma discreta (&quot;Situação: INSS · desde 11/09/2026&quot;), com o histórico (&quot;EM PRODUÇÃO 01/09–10/09 · INSS desde 11/09&quot;) e a origem (fonte › feed). No Admin › Usuários, o histórico por período com o texto da fonte, o registro manual (fonte MANUAL) e &quot;Origem do dado&quot; (linhagem até a carga).</li>
        </ul>
      </WikiSection>

      <WikiSection id="escalas" title="Escalas 5x2 e 6x1" eyebrow="O regime não basta — a folga tem data">
        <p>
          Existem dois regimes: <strong className="font-medium text-foreground">5x2</strong> e <strong className="font-medium text-foreground">6x1</strong>. O regime é metadata (vem em Jornadas de trabalho, com vigência — histórico de quem mudou de
          regime). A evidência da elegibilidade é o <strong className="font-medium text-foreground">calendário programado por dia</strong> (contrato Escalas de trabalho): &quot;nesta data a pessoa estava programada para trabalhar ou de folga?&quot;.
          Um 6x1 pode folgar na quarta e trabalhar sábado e domingo; um 5x2 pode folgar terça e quarta. A INIA <strong className="font-medium text-foreground">não assume</strong> que domingo é folga nem que 5x2 é segunda a sexta quando a escala diz outra coisa.
        </p>
        <WikiTable caption="Regra final: dia elegível = admitido E situação EM PRODUÇÃO E escala diz que trabalha E sem exclusão de calendário. Exemplo 6x1 numa semana de segunda a domingo.">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Dias no calendário</TableHead>
                <TableHead>Programados</TableHead>
                <TableHead>Folga programada</TableHead>
                <TableHead>Excluídos por situação</TableHead>
                <TableHead>Elegíveis</TableHead>
                <TableHead>Com dado</TableHead>
                <TableHead>Cobertura</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow><TableCell>7</TableCell><TableCell>6</TableCell><TableCell>1 (quarta)</TableCell><TableCell>—</TableCell><TableCell>6</TableCell><TableCell>6</TableCell><TableCell><strong className="font-medium text-foreground">100%</strong> — sábado e domingo contam</TableCell></TableRow>
              <TableRow><TableCell>7</TableCell><TableCell>6</TableCell><TableCell>1 (domingo)</TableCell><TableCell>2 em INSS</TableCell><TableCell>4</TableCell><TableCell>4</TableCell><TableCell><strong className="font-medium text-foreground">100%</strong></TableCell></TableRow>
              <TableRow><TableCell>7</TableCell><TableCell>6</TableCell><TableCell>1</TableCell><TableCell>2 em INSS</TableCell><TableCell>4</TableCell><TableCell>2</TableCell><TableCell>50%</TableCell></TableRow>
              <TableRow><TableCell>7</TableCell><TableCell>5</TableCell><TableCell>2 (sáb/dom)</TableCell><TableCell>—</TableCell><TableCell>5</TableCell><TableCell>5</TableCell><TableCell>100% — 5x2 clássico</TableCell></TableRow>
            </TableBody>
          </Table>
        </WikiTable>
        <ul className="list-inside list-disc space-y-1">
          <li><strong className="font-medium text-foreground">Status × escala se intersectam:</strong> escala &quot;trabalha&quot; + MATERNIDADE = não elegível; folga programada + EM PRODUÇÃO = não elegível; sábado programado + EM PRODUÇÃO = elegível.</li>
          <li><strong className="font-medium text-foreground">Ausência de linha no calendário não é folga</strong> — é &quot;a fonte não informou&quot;. Por isso o feed de escalas costuma ser um snapshot de horizonte (ex.: D-7 até D+30); em modo delta, só as datas recebidas mudam.</li>
          <li><strong className="font-medium text-foreground">6x1 conhecido sem folga informada:</strong> a INIA não inventa a folga nem usa segunda a sexta — os dias ficam com escala desconhecida, fora do cálculo, sem virar &quot;deveria ter produzido&quot; (motivo <code>WORK_SCHEDULE_UNKNOWN</code> no QA Lab).</li>
          <li><strong className="font-medium text-foreground">Fonte de escala atrasada:</strong> mesma filosofia da situação funcional — dias depois da última carga são &quot;escala presumida&quot;; sem medição neles o motivo é <code>WORK_SCHEDULE_STALE</code> (&quot;a folga pode ter mudado&quot;), nunca &quot;não produziu&quot;. Causa diferente, código diferente de <code>EMPLOYMENT_STATUS_STALE</code>.</li>
          <li><strong className="font-medium text-foreground">Correção posterior</strong> (quarta trabalha → quarta folga) sobrescreve a data e os cálculos históricos passam a refletir a escala corrigida; medições nunca são apagadas.</li>
          <li>No perfil e no Admin: &quot;Escala: 6x1&quot;, a próxima folga <em>programada</em> (só quando há calendário explícito — nunca inferida) e a origem (fonte › feed). No acompanhamento operacional: &quot;4 de 4 dias elegíveis · 100% · 1 folga agendada · 2 dias em INSS&quot;.</li>
        </ul>
      </WikiSection>

      <WikiSection id="excecoes" title="Exceções: day off e banco de horas" eyebrow="A escala dizia trabalha — uma decisão posterior tirou a pessoa da produção">
        <p>
          A folga <strong className="font-medium text-foreground">normal</strong> do 6x1 não é exceção: ela vem em Escalas de trabalho com &quot;trabalha = não&quot;. <strong className="font-medium text-foreground">Day off</strong>, <strong className="font-medium text-foreground">banco de horas</strong> e <strong className="font-medium text-foreground">folga extraordinária</strong> são exceções
          individuais (contrato Exceções de calendário): a escala original continua dizendo &quot;trabalha&quot; e a exceção vence naquele dia. A INIA preserva os dois fatos — calendário programado e exceção — em vez de fingir que a escala sempre disse folga.
        </p>
        <ul className="list-inside list-disc space-y-1">
          <li><strong className="font-medium text-foreground">Precedência única por dia:</strong> admissão → situação funcional (≠ EM PRODUÇÃO = não elegível) → produção observada (trabalhou — ver &quot;Planejado × observado&quot;) → exceção não produtiva → escala explícita (folga / trabalha) → fallback com política de feriado. A causa é contada uma vez: FÉRIAS + day off no mesmo dia = 1 dia em FÉRIAS.</li>
          <li><strong className="font-medium text-foreground">Motivos:</strong> Day off, Banco de horas, Folga extraordinária, Atestado (só o motivo operacional — a INIA nunca guarda diagnóstico, CID ou documento médico) e Ajuste de escala (override registrado por &quot;Corrigir planejamento&quot; numa pendência; a escala da fonte não é adulterada). Falta injustificada NÃO é exceção: é classificação (ver abaixo) — a escala continua dizendo &quot;deveria trabalhar&quot;.</li>
          <li><strong className="font-medium text-foreground">Duas origens, uma tabela:</strong> a exceção chega pela Central (contrato Exceções de calendário) OU é registrada pelo Supervisor no <em>Calendário da equipe</em> (um dia ou período, antes da data) — o cliente pode usar só uma ou as duas. Quando a Central diz uma coisa e o Supervisor já disse outra, a INIA não sobrescreve: mantém o registro do Supervisor e grava o aviso <code>DATA_SCHEDULE_EXCEPTION_CONFLICT</code> na quarentena da carga (conflito auditável, visível na Qualidade da Central e no dia do calendário).</li>
          <li><strong className="font-medium text-foreground">O motor decide pelo efeito</strong> (não produtivo), nunca por <code>if código === DAY_OFF</code>; o código explica o porquê e o texto da fonte fica preservado.</li>
          <li><strong className="font-medium text-foreground">Cancelar</strong> uma exceção (&quot;vigente = não&quot;) mantém a linha e devolve o dia ao cálculo; mesma exceção 2× = 1 registro; a origem (fonte › feed › carga) fica visível em &quot;Origem do dado&quot;.</li>
          <li>No acompanhamento operacional: &quot;4 de 4 dias elegíveis · 100% · 1 folga agendada · 1 Day off · 1 dia em INSS&quot;. No QA Lab: &quot;Exceções individuais: 1 Day off — a exceção vence a escala naquele dia&quot;.</li>
        </ul>
      </WikiSection>

      <WikiSection id="medicao-elegivel" title="Medição só em data elegível" eyebrow="Cobertura e valor olham o MESMO universo">
        <p>
          Uma medição de um dia <strong className="font-medium text-foreground">não elegível</strong> (folga programada, day off, banco de horas, férias, INSS, antes da admissão) <strong className="font-medium text-foreground">fica no banco</strong> (auditoria, lineage, correção futura) e <strong className="font-medium text-foreground">sai de todo cálculo operacional</strong>:
          não entra no numerador, no denominador, na amostra, na média, na soma — e o &quot;último valor&quot; operacional é o último valor <em>em data elegível</em>, não a última linha física.
        </p>
        <WikiTable caption="Semana de segunda a domingo, 6x1 com folga na quarta: a quarta traz TMA 900 s (alguém registrou um atendimento na folga).">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Dia</TableHead>
                <TableHead>Escala</TableHead>
                <TableHead>Medição</TableHead>
                <TableHead>Entra no cálculo?</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow><TableCell>Seg · Ter</TableCell><TableCell>trabalha</TableCell><TableCell>400 · 420</TableCell><TableCell>sim</TableCell></TableRow>
              <TableRow><TableCell>Qua</TableCell><TableCell>folga programada</TableCell><TableCell>900</TableCell><TableCell><strong className="font-medium text-foreground">não</strong> — preservada, ignorada (&quot;1 medição em dia não elegível ignorada&quot;)</TableCell></TableRow>
              <TableRow><TableCell>Qui · Sex · Sáb · Dom</TableCell><TableCell>trabalha</TableCell><TableCell>430 · 405 · 415 · 425</TableCell><TableCell>sim — sábado e domingo contam</TableCell></TableRow>
              <TableRow><TableCell colSpan={3}>Resultado: 6 de 6 dias elegíveis · 100% · TMA = média ponderada dos 6 dias (a quarta não puxa o TMA para cima)</TableCell><TableCell>—</TableCell></TableRow>
            </TableBody>
          </Table>
        </WikiTable>
        <ul className="list-inside list-disc space-y-1">
          <li><strong className="font-medium text-foreground">Uma regra só:</strong> as datas elegíveis do resolvedor único entram na consulta de medições (por pessoa, em lote) — nunca uma segunda interpretação em SQL. Todas as estratégias (média ponderada, taxa, média simples, soma, último valor) e a reincidência (contagem) respeitam a mesma elegibilidade.</li>
          <li><strong className="font-medium text-foreground">Dia local:</strong> a medição é associada ao dia no fuso da organização (nunca UTC ingênuo). Granularidades diária, horária e por interação recebem a regra diária; linhas mensais/custom mantêm o comportamento anterior (só a situação funcional do dia inicial), porque uma linha mensal não representa observações de um dia.</li>
          <li><strong className="font-medium text-foreground">Correção e reversão:</strong> quarta &quot;trabalha → folga&quot; tira a medição do cálculo; &quot;folga → trabalha&quot; traz de volta — prova de que nada foi apagado.</li>
          <li><strong className="font-medium text-foreground">Consequência do fallback:</strong> quem não tem escala explícita está em seg–sex por compatibilidade — uma medição de sábado dessa pessoa também fica fora até a escala real chegar pela Central.</li>
        </ul>
      </WikiSection>

      <WikiSection id="feriados" title="Feriados, capital operacional e política" eyebrow="Escala explícita vence feriado — sempre">
        <ul className="list-inside list-disc space-y-1">
          <li><strong className="font-medium text-foreground">Capital operacional:</strong> a empresa informa, por colaborador, a capital brasileira cuja jurisdição de feriados vale para ele (Colaboradores › <code>operationalCapitalCode</code>, uma das 27 capitais). A UF é derivada — feriado nacional vale para todos; estadual só para a UF da capital (CE não vale para Recife); municipal só para a própria capital (Fortaleza não vale para Salvador). Não é endereço, residência, lotação nem teletrabalho — isso não existe na INIA.</li>
          <li><strong className="font-medium text-foreground">Sem capital:</strong> só feriados nacionais e datas da organização são conhecidos; estadual/municipal não são inferidos (confiança &quot;capital não informada&quot;, visível na Qualidade da Central).</li>
          <li><strong className="font-medium text-foreground">Catálogo-base × datas da organização:</strong> o calendário-base (Administração › Central de Dados › Calendário operacional) traz os feriados legais de 2026–2028 com fonte verificável e base legal; ponto facultativo não entra. Datas próprias da operação são um overlay pequeno — ninguém recadastra o Natal 27 vezes.</li>
          <li><strong className="font-medium text-foreground">Feriado não é folga automática:</strong> call center opera em feriado. Feriado + escala explícita &quot;trabalha&quot; = trabalha; feriado + folga explícita = 1 exclusão (folga); feriado + trabalha + day off = não elegível (exceção). Só no <em>fallback</em> seg–sex (sem escala explícita) o feriado pode agir — e só com a política <strong className="font-medium text-foreground">Excluir feriados aplicáveis</strong>. O padrão é <strong className="font-medium text-foreground">Ignorar</strong> (comportamento anterior preservado).</li>
          <li><strong className="font-medium text-foreground">Fallback legado (segunda a sexta):</strong> existe só como compatibilidade para colaboradores sem <em>nenhuma</em> configuração de escala (nem calendário, nem regime 6x1). A INIA marca explicitamente (&quot;seg–sex por compatibilidade&quot;) e trata esses dias como escala presumida. Conforme Escalas de trabalho for alimentado pela Central, o fallback deixa de ser usado automaticamente.</li>
          <li><strong className="font-medium text-foreground">Horizonte ≠ freshness:</strong> a Central mostra até que data o calendário de escalas é conhecido (&quot;Calendário disponível: 01/09 → 31/10&quot;) e avisa quando restam poucos dias — independentemente de a carga ter chegado há 10 minutos. Um 6x1 numa data além do horizonte fica com escala desconhecida (<code>WORK_SCHEDULE_UNKNOWN</code>), nunca &quot;não produziu&quot;.</li>
          <li><strong className="font-medium text-foreground">Incerteza nunca vira baixa performance:</strong> NÃO ELEGÍVEL ≠ performance zero; NÃO SEI A ESCALA/SITUAÇÃO COM SEGURANÇA ≠ performance ruim. A INIA nunca transforma ausência esperada ou dado incerto em feedback negativo.</li>
        </ul>
      </WikiSection>

      <WikiSection id="planejado-observado" title="Planejado × observado" eyebrow="A INIA não pergunta só se a pessoa estava programada — pergunta se houve evidência de que trabalhou">
        <p>
          O calendário responde ao <strong className="font-medium text-foreground">PLANEJADO</strong> (situação funcional, escala, folga, day off, banco de horas, atestado). A <strong className="font-medium text-foreground">evidência de produção</strong> responde ao <strong className="font-medium text-foreground">OBSERVADO</strong>. O estado final de cada dia combina os dois — sem apagar nenhum: o plano fica registrado mesmo quando a realidade o supera.
        </p>
        <ul className="list-inside list-disc space-y-1">
          <li><strong className="font-medium text-foreground">O que prova atividade</strong> (regra determinística, sem IA): uma interação real do colaborador no dia, ou uma medição diária de um indicador que o administrador marcou explicitamente como <em>&quot;Comprova atividade operacional&quot;</em> na tela Indicadores (com volume/amostra maior que zero). Uma nota de qualidade ou um TMA atrasado nunca prova presença por si — e o indicador em cálculo só torna o dia elegível se a própria definição dele estiver marcada (sem circularidade &quot;TMA existe → dia elegível → TMA entra&quot;).</li>
          <li><strong className="font-medium text-foreground">Situação funcional é soberana:</strong> produção com FÉRIAS, INSS, MATERNIDADE, APOSENTADO, TRANSFERIDO… NÃO torna o dia elegível nem muda a situação. Vira uma inconsistência de dados (aviso ao Supervisor e contagem na Qualidade da Central) para a fonte de situação ser corrigida.</li>
          <li><strong className="font-medium text-foreground">Trabalho real supera o plano:</strong> EM PRODUÇÃO + day off/banco de horas/folga 6x1 + produção observada = dia <em>trabalhado</em> (elegível — a medição volta a contar). A exceção não é apagada: o perfil mostra &quot;1 dia trabalhado em Day off previsto&quot; e o Supervisor recebe um aviso de divergência plano × realidade (não necessariamente erro: pode ser hora extra ou mudança operacional).</li>
          <li><strong className="font-medium text-foreground">Ausência de produção nunca cria exceção nem falta sozinha:</strong> EM PRODUÇÃO + programado + sem exceção + turno encerrado (horário de fim do turno da escala; sem horário, só depois de a data operacional encerrar no fuso da organização) + <strong className="font-medium text-foreground">fontes já fechadas e confiáveis</strong> (ver <a className="underline" href="#disponibilidade">Disponibilidade dos dados</a>) + nenhuma evidência = pendência <em>&quot;Produção não identificada após o fechamento das fontes&quot;</em> para o Supervisor, na Surface Pendências e no sino. É um estado intermediário: o dia continua elegível por planejamento até alguém classificar.</li>
          <li><strong className="font-medium text-foreground">O Supervisor classifica o que aconteceu</strong> (ver <a className="underline" href="#classificacao">Classificação</a>): <em>Falta injustificada</em> · <em>Ausência justificada</em> (motivo) · <em>Trabalhou — dados não chegaram</em> · <em>Corrigir planejamento</em> (ajuste de escala registrado por cima, a escala da fonte não muda).</li>
          <li><strong className="font-medium text-foreground">Produção que chega depois</strong> resolve a pendência automaticamente (&quot;Produção recebida após o alerta&quot;); uma exceção registrada depois do alerta também (&quot;Plano atualizado após o alerta&quot;). Uma pendência por colaborador × dia; o job roda a cada 5 minutos, é idempotente e só avalia organizações com alguma fonte de evidência (interações ingeridas ou indicador marcado) — sem fonte, ausência de evidência não significa nada e ninguém é cobrado.</li>
          <li><strong className="font-medium text-foreground">Calendário da equipe</strong> (aba do perfil de quem lidera uma equipe — Supervisor, Coordenador, Gerente — e de contas com o papel que dá o Calendário da equipe, só para as pessoas do escopo desse papel): por colaborador × dia, o estado resolvido — trabalhou, trabalha (planejado), aguardando dados, fonte atrasada, sem produção · classificar, falta injustificada, ausência justificada, trabalhou · dados não recebidos, folga/day off/banco/atestado, situação funcional, escala desconhecida — com evidência, pendência, divergência, classificação (quem, quando, histórico) e a trilha de auditoria de cada exceção. Não é WFM: sem geração de escala, troca de turno, banco de horas calculado ou aprovação de RH — é a superfície de provisionamento, classificação e correção operacional. A coluna de hoje fica demarcada com bordas laterais discretas na cor primária. A lista de colaboradores tem busca (nome ou cargo), filtros por <strong>Grupo</strong> e <strong>Subgrupo</strong> (só os presentes na equipe; trocar o grupo limpa o subgrupo), <strong>Cargo</strong> (o cargo informado pela empresa, opções vindas da própria equipe), <strong>Escala</strong> (5x2, 6x1, sem escala configurada), <strong>Situação no período</strong> (com pendência, aguardando dados, fonte atrasada, com falta injustificada, com divergência, com inconsistência) e <strong>Hoje</strong> (trabalham / não trabalham: o dia de hoje resolvido como esperado trabalhar — exclui folga, day off, situação não produtiva, atestado e escala desconhecida; funciona mesmo com outro período na tela) e paginação — o mesmo padrão das listagens administrativas. Filtrar nunca muda o que se calcula: os filtros só escolhem quem aparece na grade, e &quot;Provisionar exceção&quot; continua listando todos os operadores diretos.</li>
        </ul>
      </WikiSection>

      <WikiSection id="disponibilidade" title="Disponibilidade dos dados (D-1/D-2)" eyebrow="Fim do turno não significa dado fechado">
        <p>
          Na operação real grande parte dos indicadores chega em D-1, alguns em D-2, e a base de RH (férias, afastamentos, licenças, atestados) também atrasa. Por isso a INIA distingue quatro coisas: o <strong className="font-medium text-foreground">planejado</strong> (o que deveria acontecer), o <strong className="font-medium text-foreground">observado</strong> (o que apareceu nas fontes), a <strong className="font-medium text-foreground">disponibilidade dos dados</strong> (quando cada fonte já deveria conter o dia) e a <strong className="font-medium text-foreground">classificação operacional</strong> (como um dia sem produção foi explicado). Antes de concluir qualquer ausência ela pergunta: <em>os dados que poderiam explicar este dia já deveriam ter chegado?</em>
        </p>
        <ul className="list-inside list-disc space-y-1">
          <li><strong className="font-medium text-foreground">SLA por feed na Central de Dados:</strong> cada feed relevante (medições operacionais, interações, colaboradores/afastamentos) declara <em>&quot;o dado de D chega em D-N até HH:MM&quot;</em> no fuso da organização (ex.: Produção D-1 até 11:00; RH D-2 até 08:00). Um indicador pode ter um SLA próprio só quando o mesmo feed mistura prazos. Sem SLA configurado a INIA <strong className="font-medium text-foreground">não assume D-1</strong>: o dia fica &quot;disponibilidade não configurada&quot; e nenhuma ausência é concluída.</li>
          <li><strong className="font-medium text-foreground">Freshness ≠ disponibilidade:</strong> o feed pode ter sincronizado hoje às 08:00 (atualizado) e o dado de ontem só ser esperado às 11:00. A Central mostra os dois separadamente: &quot;Última carga&quot; e &quot;Dados esperados: D-1 até 11:00 · Estado&quot;.</li>
          <li><strong className="font-medium text-foreground">Aguardando dados:</strong> turno encerrado, mas o último prazo entre as fontes de evidência (só as configuradas como evidência — PRV e fechamentos oficiais não são esperados) ou o prazo do RH ainda não venceu. O calendário mostra &quot;Aguardando dados · até 18/09 11:00&quot; ou &quot;Aguardando RH&quot;. Nenhuma pendência, nenhuma falta.</li>
          <li><strong className="font-medium text-foreground">Fonte atrasada:</strong> o prazo venceu e a fonte não entregou o dia (nenhuma carga bem-sucedida depois do prazo nem dado de negócio cobrindo a data — feed falhou, ficou parado ou está atrasado). É problema de <em>dado</em>: quem administra a Central de Dados na organização inteira recebe um alerta por fonte × dia (&quot;Dado de 17/09 ainda não recebido&quot;) e nenhum colaborador vira &quot;sem produção&quot; — nunca 2.000 pendências falsas. Quando a carga chega, o alerta é resolvido e a avaliação segue.</li>
          <li><strong className="font-medium text-foreground">RH dentro do SLA</strong> segura a conclusão (&quot;Aguardando RH&quot;); RH com SLA vencido e sem carga vira alerta de fonte — a INIA não presume EM PRODUÇÃO. Sem feed de situação configurado (cadastro manual), não há RH a esperar.</li>
          <li>Só com todas as fontes relevantes fechadas e confiáveis o dia programado sem evidência vira <em>&quot;Sem produção · classificar&quot;</em>.</li>
        </ul>
      </WikiSection>

      <WikiSection id="classificacao" title="Classificação e falta injustificada" eyebrow="Só uma pessoa autorizada explica um dia — e toda explicação é revisável">
        <p>
          Provisionar (antes da data: day off, banco de horas, atestado conhecido, folga extraordinária) continua sendo <strong className="font-medium text-foreground">planejamento</strong> — uma exceção de calendário. Classificar é outra coisa: depois de detectada a ausência de produção, o Supervisor explica o que aconteceu. A classificação não altera a escala (que continua dizendo &quot;deveria trabalhar&quot;) e nunca nasce de IA.
        </p>
        <ul className="list-inside list-disc space-y-1">
          <li><strong className="font-medium text-foreground">Falta injustificada:</strong> situação EM PRODUÇÃO, prevista para trabalhar, sem produção, sem justificativa conhecida, confirmada pelo Supervisor. O dia <strong className="font-medium text-foreground">continua esperado e elegível</strong> — não sai do universo operacional. Diferente de atestado, férias, INSS, day off ou banco de horas, que tiram o dia (salvo trabalho observado).</li>
          <li><strong className="font-medium text-foreground">Política por indicador</strong> (tela Indicadores, &quot;Tratamento de falta injustificada&quot;): <em>Sem amostra</em> (TMA, Qualidade, taxas — não existe medição, nunca um zero falso) ou <em>Contribuição zero</em> (Produção, volume — o dia entra como 0 produzido no cálculo). Contribuição zero não cria uma medição artificial: ela afeta apenas o cálculo operacional quando uma falta injustificada foi confirmada. Só é válida para soma ou média de contagens; a tela bloqueia TMA/taxa/snapshot com contribuição zero. Nunca <code>if código === &quot;PRODUCAO&quot;</code>.</li>
          <li><strong className="font-medium text-foreground">Cobertura:</strong> para um indicador com contribuição zero, a falta injustificada é um resultado conhecido daquele dia (conta como dia com dado e Produção 0 entra em ranking/quartil como valor real); para um indicador sem amostra, o dia simplesmente não tem medição — nunca parece &quot;integração perdeu dado&quot;.</li>
          <li><strong className="font-medium text-foreground">Ausência justificada:</strong> motivo ATESTADO, DAY_OFF, BANCO_HORAS, FOLGA_EXTRAORDINARIA ou outro motivo suportado — o dia sai do cálculo. Para atestado só o motivo é guardado: nunca CID, diagnóstico, documento ou descrição clínica (a tabela não tem coluna para isso).</li>
          <li><strong className="font-medium text-foreground">Trabalhou — dados não chegaram:</strong> dia elegível, nada inventado; os indicadores seguem sem valor até o dado real chegar (aí a reconciliação é automática). O calendário mostra &quot;Trabalhou · dados não recebidos&quot; e o detalhe diz &quot;Confirmado pelo Supervisor. Nenhum indicador foi criado pela INIA&quot;.</li>
          <li><strong className="font-medium text-foreground">Revisável, com histórico:</strong> &quot;Editar classificação&quot; no Calendário da equipe cria uma nova revisão e marca a anterior (quem, quando, valor anterior, valor novo). 09:12 Falta injustificada → 15:43 Alterado para Atestado: a contribuição zero anterior deixa de existir, rankings/analytics recalculam, nenhuma medição é apagada, o histórico permanece.</li>
          <li><strong className="font-medium text-foreground">A verdade pode chegar depois:</strong> produção real após uma falta injustificada → o dia vira <em>trabalhou</em> e a classificação fica no histórico como contrariada por evidência posterior (Supervisor avisado). RH informa férias/INSS depois → a situação funcional prevalece e a classificação fica como superada pela fonte autoritativa. RH confirmando EM PRODUÇÃO não apaga um atestado registrado manualmente.</li>
          <li><strong className="font-medium text-foreground">Precedência final do dia:</strong> situação funcional não produtiva → trabalho real observado → classificação humana → exceção/plano → escala explícita → fallback → desconhecido.</li>
        </ul>
        <WarningCallout title="Fora de escopo">
          <p>Folha de pagamento, desconto salarial, aprovação formal de atestado, armazenamento de documento médico, gestão/cálculo de banco de horas, WFM completo, punição disciplinar e qualquer IA decidindo ou classificando ausência.</p>
        </WarningCallout>
      </WikiSection>

      <WikiSection id="quartil" title="Quartil operacional × quartil oficial" eyebrow="Mesma palavra, dois conceitos">
        <div className="grid gap-4 md:grid-cols-2">
          <ExampleCard title="Quartil OFICIAL">
            <p>Persistido pela fonte corporativa no fechamento mensal (employee_indicator_performance / employee_prv_performance). Q1 = melhor, Q4 = pior, sempre. A INIA nunca recalcula. É o que &quot;Q4 recorrente&quot; significa: Q4 oficial em fechamentos consecutivos.</p>
          </ExampleCard>
          <ExampleCard title="Quartil OPERACIONAL">
            <p>Calculado pela INIA para uma população + indicador + janela + agregação: resolve o valor operacional de cada colaborador, ordena pela direção oficial do indicador (HIGHER: maiores = Q1; LOWER, como TMA: menores = Q1) e classifica Q1 = melhores 25% … Q4 = piores 25%.</p>
          </ExampleCard>
        </div>
        <ul className="list-inside list-disc space-y-1">
          <li><strong className="font-medium text-foreground">População</strong> = exatamente a população elegível do Workflow (Abrangência ∩ Filtro populacional) ou, havendo uma coleção anterior, só ela. Q4 da equipe de um Supervisor é relativo àquela equipe; de uma Gerência, àquela Gerência — nunca comparáveis entre si.</li>
          <li><strong className="font-medium text-foreground">Empates</strong> ficam na mesma posição (1, 2, 2, 4) e no mesmo quartil; o id do colaborador só ordena a lista de forma estável, nunca separa quartil.</li>
          <li><strong className="font-medium text-foreground">Populações pequenas</strong>: com menos de 4 colaboradores com dados não existe &quot;pior 25%&quot; — ninguém é classificado, e o QA explica o motivo.</li>
          <li><strong className="font-medium text-foreground">SEM DADOS</strong> fica fora da população ranqueada — nunca vira Q4 artificialmente.</li>
          <li><strong className="font-medium text-foreground">TARGET</strong> (meta por faixa) não tem regra de classificação — bloqueado até existir regra oficial.</li>
        </ul>
        <p>
          <strong className="font-medium text-foreground">Quartil depende da população comparada.</strong> Por isso a UI nunca mostra &quot;Q4&quot; solto: mostra &quot;Q4 operacional · 95º de 108 · Pares: Subgrupo Voz (106 de 108 elegíveis)&quot; — quartil, posição,
          tamanho e quem são os pares. Na área de Indicadores os pares são o Subgrupo (ou o Grupo) do colaborador — a mesma população em que a fonte oficial calcula o quartil do fechamento; num Workflow, a população continua sendo
          Abrangência ∩ Filtro populacional ∩ coleção anterior ∩ elegibilidade, e o trace do QA diz &quot;calculado entre N colaboradores com dados, de M elegíveis na população deste Workflow&quot;. O resultado do resolvedor já traz
          tipo, rótulo e tamanho da população, elegíveis, posição, quartil, janela e cobertura — o frontend nunca recalcula.
        </p>
        <ExampleCard title="Condition &quot;Quartil operacional&quot; (source OPERATIONAL_QUARTILE)">
          <p>
            &quot;Este colaborador está no Q4 operacional de TMA nos últimos 7 dias?&quot; — a mesma classificação do Ranking, calculada em lote sobre a população do Workflow (Abrangência ∩ Filtro populacional, ou a
            coleção anterior), uma resolução por população (nunca N+1). Comparação só &quot;É igual a&quot; / &quot;É diferente de&quot; + Q1..Q4; janela operacional (dias, semana, mês), agregação de valor, direção HIGHER/LOWER
            (TARGET bloqueado na publicação). População com menos de 4 com dados, colaborador sem medição, abaixo da cobertura mínima ou indicador sem direção = SEM DADOS. Individual-only: num Workflow consolidado use-a como critério de
            &quot;Selecionar colaboradores&quot; ou depois de &quot;Aplicar individualmente&quot;.
          </p>
          <p className="mt-2">
            Exemplo combinado: &quot;Quartil do indicador (fechamento oficial) é igual a Q4&quot; <strong className="font-medium text-foreground">E</strong> &quot;Quartil operacional de TMA nos últimos 7 dias é igual a Q4&quot; → TRUE para
            Mariana Alves na massa demo (Q4 oficial em agosto/2026 + Q4 operacional entre os pares do Subgrupo) — duas camadas, dois nomes, nunca o mesmo número.
          </p>
        </ExampleCard>
      </WikiSection>

      <WikiSection id="tela" title="Na área de Indicadores" eyebrow="Fechamento oficial × Acompanhamento operacional, lado a lado">
        <p>
          No detalhe de um indicador do colaborador a tela mostra dois blocos com rótulos inequívocos: <strong className="font-medium text-foreground">Fechamento oficial</strong> (resultado, meta, atingimento oficial,
          &quot;Quartil oficial&quot;, peso, competência anterior — lidos da fonte) e <strong className="font-medium text-foreground">Acompanhamento operacional</strong> (janela atual, janela anterior, variação de performance
          com sinal pela direção oficial, &quot;Quartil operacional — últimos 7 dias&quot; entre os pares do mesmo Subgrupo/Grupo, cobertura). O card do indicador traz o chip &quot;Operacional 7d&quot;; a estrutura ganha um resumo
          operacional pequeno (Σ numerador ÷ Σ denominador dos membros). Tudo vem do mesmo resolvedor das Conditions — abrir a tela nunca chama LLM.
        </p>
        <p>
          O seletor <strong className="font-medium text-foreground">Comparação operacional</strong>, ao lado da competência, escolhe as duas janelas que o acompanhamento operacional compara — e vale para todos os
          papéis (operador, supervisor e acima), para o card do colaborador e para o resumo da estrutura. Opções: <strong className="font-medium text-foreground">Últimos 7 dias × 7 dias anteriores</strong> (padrão),{" "}
          <strong className="font-medium text-foreground">Semana corrente (até hoje) × semana anterior</strong>, <strong className="font-medium text-foreground">Mês corrente (até hoje) × mês anterior</strong>,{" "}
          <strong className="font-medium text-foreground">Bimestre corrente (até hoje) × bimestre anterior</strong> e <strong className="font-medium text-foreground">Trimestre corrente (até hoje) × trimestre anterior</strong>. Nas
          opções de calendário a janela atual é o período civil <em>corrente, até hoje</em> (semana = segunda a domingo; bimestre = jan–fev, mar–abr, mai–jun, jul–ago, set–out, nov–dez; trimestre = jan–mar…) e a anterior é o
          período civil anterior completo. O card mostra as duas janelas lado a lado, cada uma com datas reais e tamanho em dias (&quot;17 de 61 dias — o bimestre ainda está em curso&quot; × &quot;62 dias de calendário&quot;), e o
          quartil operacional é calculado na mesma janela atual. Como a janela atual pode ser bem menor que a anterior, indicadores de <strong className="font-medium text-foreground">soma</strong> (ex.: volume de atendimentos)
          não recebem variação nessas opções (&quot;Soma em período parcial — não comparável&quot;); médias, taxas e último valor continuam comparáveis. A escolha fica na URL (<code>compare=</code>) e nunca altera a competência do fechamento oficial: são dois
          seletores independentes.
        </p>
        <ul className="list-inside list-disc space-y-1">
          <li>Indicador sem medição diária (<code>daily_supported = false</code>) ou sem medição do colaborador nas duas janelas: sem card operacional.</li>
          <li>&quot;Sem dados operacionais suficientes&quot; segue a <strong className="font-medium text-foreground">cobertura mínima do indicador no catálogo</strong> (ex.: TMA 60%; indicadores amostrados como Monitoria têm um padrão menor) — não existe limiar fixo da tela. A cobertura real e o mínimo do indicador são sempre exibidos (&quot;1 de 5 dias elegíveis · 20% · Mínimo do indicador: 60%&quot;) — nunca 0, nunca quartil.</li>
          <li>O bloco operacional nunca mostra atingimento, PRV ou peso — esses só existem no fechamento oficial.</li>
        </ul>
      </WikiSection>

      <WikiSection id="peso" title="Peso oficial (weight_percent)" eyebrow="Explicação, não recálculo">
        <p>
          O peso oficial de cada indicador existe para <strong className="font-medium text-foreground">explicar e auditar a composição do PRV</strong> recebido da empresa. A INIA não precisa dele para recalcular o
          PRV — e não existe peso operacional: medições diárias não criam um &quot;PRV do dia&quot;.
        </p>
      </WikiSection>

      <WikiSection id="componentes-oficiais" title="Numerador e denominador do fechamento" eyebrow="Para somar estruturas em valor — nunca para recalcular o oficial">
        <p>
          O fechamento mensal por colaborador × indicador pode trazer, além de valor, meta, atingimento, peso e quartil, os dois{" "}
          <strong className="font-medium text-foreground">componentes do valor oficial</strong> (contrato <code>OFFICIAL_INDICATOR_PERFORMANCE@2</code> da Central de Dados). Só existem quando a
          estratégia do indicador define o valor por componentes, e o fator vem da <strong className="font-medium text-foreground">estratégia</strong>, nunca da unidade:
        </p>
        <WikiTable caption="Componentes por estratégia — a mesma regra das medições diárias.">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Estratégia</TableHead>
                <TableHead>Numerador</TableHead>
                <TableHead>Denominador</TableHead>
                <TableHead>Valor</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>Taxa</TableCell>
                <TableCell>Ocorrências do mês</TableCell>
                <TableCell>Base / elegíveis do mês</TableCell>
                <TableCell>numerador ÷ denominador × 100</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Média ponderada</TableCell>
                <TableCell>Total do mês (ex.: segundos falados, soma das notas)</TableCell>
                <TableCell>Volume do mês (ex.: atendimentos, avaliações)</TableCell>
                <TableCell>numerador ÷ denominador (uma média de notas em % já está em %)</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Média simples, Soma, Último valor</TableCell>
                <TableCell colSpan={2}>Sem componentes — a carga que os enviar vai para a quarentena</TableCell>
                <TableCell>o valor informado</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </WikiTable>
        <ExampleCard title="Resultado de uma estrutura em valor">
          <p>
            TMA da coordenação = Σ segundos ÷ Σ atendimentos dos fechamentos dos colaboradores — nunca a média dos TMAs. Ex.: 393 s em 1.202 atendimentos e 468 s em 657 atendimentos dão
            (472.386 + 307.476) ÷ (1.202 + 657) ≈ 419,5 s. A contribuição de cada unidade é a participação dela no numerador e no denominador.
          </p>
        </ExampleCard>
        <ul className="list-disc space-y-1 pl-5">
          <li>Os dois vêm juntos, o denominador é maior que zero e eles precisam conferir com o valor informado, com tolerância de arredondamento (o maior entre 0,1, 1% e meia unidade da casa decimal informada). Incoerência vai inteira para a quarentena: a INIA nunca corrige nem o valor oficial nem os componentes.</li>
          <li>Atingimento, quartil, peso e PRV continuam sendo os da fonte — os componentes não recalculam nada.</li>
          <li>Fechamento sem componentes continua válido (feed na versão 1, ou indicador que a fonte não detalha). Componente ausente nunca é desempenho ruim: a pessoa só fica fora da soma em valor.</li>
          <li>Uma carga sem componentes não apaga os já recebidos enquanto o valor oficial for o mesmo; valor oficial novo sem componentes apaga os antigos, para nunca ficarem incoerentes.</li>
        </ul>
      </WikiSection>

      <WikiSection id="qa" title="Evidência no QA Lab" eyebrow="Como o número foi formado">
        <p>Todo resultado operacional carrega a evidência do cálculo, e o QA Lab mostra tudo — nunca só o resultado:</p>
        <ExampleCard title="Condition — TMA, últimos 7 dias">
          <p>Janela: 10/09/2026 → 16/09/2026 · Dias com dados: 5 de 5 úteis (cobertura 100%) · medições: 5 · Componentes: Σ 136.803 s ÷ Σ 288 contatos · Método: média ponderada → 475,0 s.</p>
        </ExampleCard>
        <ExampleCard title="Ranking — Q4 operacional de TMA">
          <p>Fonte: medição operacional · TMA · Média ponderada · Últimos 7 dias · direção LOWER (menor é melhor) · População elegível: 25 · com dados: 25 · sem dados: 0 → Q4 operacional, posição 22/25.</p>
        </ExampleCard>
        <ExampleCard title="CHANGE — últimos 7 vs 7 anteriores">
          <p>Anterior 468,93 → Atual 483,05 · variação matemática +3,01% · direção LOWER → variação de performance −3,01% (queda).</p>
        </ExampleCard>
        <p>Quando um Agent recebe performance, o contexto separa explicitamente &quot;DADOS OPERACIONAIS&quot; (janela, método, tendência vs. janela anterior) de &quot;Fechamento oficial&quot; (atingimento, PRV, quartil oficial) — nunca no mesmo campo.</p>
      </WikiSection>

      <WikiSection id="diario" title="Indicadores com medição diária" eyebrow="Auditados um a um (daily_supported)">
        <WikiTable caption="Semântica operacional e suporte a medição diária por colaborador, conforme o catálogo real.">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Indicadores</TableHead>
                <TableHead>Semântica</TableHead>
                <TableHead>Diário</TableHead>
                <TableHead>Motivo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {DAILY.map((row) => (
                <TableRow key={row.code}>
                  <TableCell className="font-mono text-xs">{row.code}</TableCell>
                  <TableCell>{row.kind}</TableCell>
                  <TableCell>{row.daily}</TableCell>
                  <TableCell>{row.why}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </WikiTable>
        <WarningCallout title="Modelo 13 — Monitoramento operacional do dia" kind="tip">
          Hoje só existe medição DIÁRIA. O modelo (antes chamado &quot;Monitoramento no turno&quot;) usa &quot;Hoje&quot; (o dia local, parcial até agora), que é útil, mas{" "}
          <strong className="font-medium text-foreground">não representa o meio do turno</strong>: o nome foi ajustado pra não prometer monitoramento intraturno. Isso exigiria
          granularidade HOURLY, que a arquitetura já prevê e ainda não implementa.
        </WarningCallout>
      </WikiSection>

      <SeeAlso
        links={[
          { href: "/wiki/indicadores", label: "Indicadores e Performance", hint: "valor × meta × atingimento, PRV, pesos, quartil oficial e competência" },
          { href: "/wiki/workflows/conditions", label: "Conditions", hint: "fontes, períodos e comparações" },
          { href: "/wiki/workflows/ranking", label: "Selecionar colaboradores e Ranking", hint: "VALUE, CHANGE e quartil operacional" },
          { href: "/wiki/qa-lab", label: "QA Lab", hint: "trace e evidência do cálculo" },
        ]}
      />
    </WikiArticle>
  )
}
