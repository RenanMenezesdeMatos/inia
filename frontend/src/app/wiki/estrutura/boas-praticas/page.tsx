import type { Metadata } from "next"

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { FieldRow, SeeAlso, StepList, WarningCallout, WikiArticle, WikiLink, WikiPageHeader, WikiSection, WikiTable } from "@/components/wiki/wiki-primitives"
import type { WikiTocEntry } from "@/components/wiki/wiki-toc"

export const metadata: Metadata = {
  title: "Base de boas práticas",
  description: "O que os operadores com melhores resultados fazem nas conversas: comparação com um grupo de referência no mesmo contexto, obrigação × boa prática, força da evidência, revisão humana e uso nas respostas e nos feedbacks da INIA.",
}

const TOC: WikiTocEntry[] = [
  { id: "o-que-e", label: "O que é (e o que não é)" },
  { id: "como-funciona", label: "Como uma análise funciona" },
  { id: "forca", label: "Força da evidência" },
  { id: "obrigacao", label: "Obrigação × boa prática" },
  { id: "revisao", label: "Revisão e disponibilidade" },
  { id: "medir", label: "Medir por indicador ou por sinal" },
  { id: "no-feedback", label: "No feedback: de onde vem a prática" },
  { id: "uso", label: "Onde a INIA usa" },
  { id: "sinteticos", label: "Dados sintéticos" },
]

export default function BestPracticesWikiPage() {
  return (
    <WikiArticle toc={TOC}>
      <WikiPageHeader
        eyebrow="02 · Pessoas e Estrutura"
        title="Base de boas práticas"
        lead="O Diagnóstico mostra se o processo foi seguido. A base de boas práticas responde outra pergunta: o que os operadores com melhores resultados fazem nas conversas que pode ajudar outros operadores a melhorar? Cada padrão é uma associação observada, com números calculados pelo sistema, evidência rastreável e revisão humana — nunca uma causa garantida."
      />

      <WikiSection id="o-que-e" title="O que é (e o que não é)" eyebrow="Escopo">
        <p>Um padrão é um comportamento <strong>opcional</strong> e observável na transcrição — como explicar o motivo de uma espera e combinar o retorno, ou retomar a conversa resumindo o que foi verificado — que aparece com mais frequência entre os melhores resultados do que no grupo de referência, no mesmo contexto (motivo e submotivo da chamada), população (Grupo ou Subgrupo) e período. “Os melhores” são os operadores do 1º quartil oficial de um indicador ou as chamadas com resultado bom num sinal da chamada (por exemplo, a nota da URA).</p>
        <p>Não é: cumprir uma etapa obrigatória (saudação padrão, identificação, validação de segurança, avisos), uma frase de uma chamada isolada, o estilo de um único operador, nem algo que dependa do tom de voz (só o áudio mostraria).</p>
      </WikiSection>

      <WikiSection id="como-funciona" title="Como uma análise funciona" eyebrow="Passo a passo">
        <StepList
          steps={[
            { title: "Grupos", detail: "Melhores resultados = 1º quartil oficial do indicador na maioria das competências escolhidas; referência = os demais (ou o 4º quartil). Quem não tem quartil oficial fica fora — dado ausente nunca é desempenho ruim." },
            { title: "Contextos e amostra", detail: "A comparação acontece dentro de cada contexto; contextos diferentes nunca entram no mesmo número. Cada operador entra com no máximo 4 chamadas por contexto e só com 2 ou mais chamadas transcritas ali; um contexto só é analisado com 3 ou mais operadores em cada grupo." },
            { title: "Hipóteses", detail: "A IA lê chamadas dos dois grupos e propõe comportamentos que parecem mais frequentes entre os melhores. Os padrões já existentes do mesmo indicador e Grupo são sempre medidos de novo." },
            { title: "Codificação cega", detail: "Cada chamada da amostra é lida de novo, sem que a IA saiba o grupo, o indicador ou o resultado de quem atendeu. “Aparece” só vale com um trecho literal da fala do OPERADOR, conferido pelo sistema." },
            { title: "Números", detail: "O sistema calcula, por contexto, a frequência em cada grupo (média das taxas de cada operador), a diferença, quantos adotam e a força. A IA nunca dá número." },
            { title: "Obrigação", detail: "O que se sustentou é conferido contra procedimentos, argumentários e pontos do processo do Grupo." },
          ]}
        />
      </WikiSection>

      <WikiSection id="forca" title="Força da evidência" eyebrow="Critérios explícitos">
        <WikiTable>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Resultado</TableHead>
                <TableHead>Quando</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow><TableCell className="font-medium">Moderada</TableCell><TableCell>≥ 3 operadores e ≥ 6 chamadas com a situação em cada grupo; ≥ 3 operadores com melhores resultados adotam (em metade ou mais das próprias chamadas); diferença ≥ 20 p.p.; ≥ 2/3 deles acima da média da referência; nenhum operador com mais da metade das ocorrências.</TableCell></TableRow>
              <TableRow><TableCell className="font-medium">Forte</TableCell><TableCell>Além disso: ≥ 5 operadores e ≥ 15 chamadas por grupo, ≥ 4 adotam e diferença ≥ 30 p.p.</TableCell></TableRow>
              <TableRow><TableCell className="font-medium">Não vira padrão</TableCell><TableCell>Ocorrência isolada, concentrada num operador, comum aos dois grupos, mais frequente na referência, sem diferença, associação fraca ou dados insuficientes — o relatório da análise diz qual.</TableCell></TableRow>
            </TableBody>
          </Table>
        </WikiTable>
        <p>Chamadas em que a situação não aconteceu (ex.: não houve espera) ficam fora do denominador: ausência de situação não é ausência do comportamento.</p>
      </WikiSection>

      <WikiSection id="obrigacao" title="Obrigação × boa prática" eyebrow="Nunca recomendar descumprir o processo">
        <FieldRow label="Opcional" value="Nenhuma fonte trata como obrigação (ou a base só recomenda): pode virar padrão." />
        <FieldRow label="Diferenciada" value="Há uma etapa obrigatória relacionada, mas o comportamento vai além dela (ex.: explicar por que a confirmação de dados é necessária). O que conta é o comportamento adicional." />
        <FieldRow label="Obrigação" value="É a própria etapa exigida: descartado — pertence ao Diagnóstico." />
        <FieldRow label="Contraria" value="Omitir informação, pular etapa, encerrar antes do necessário, pedir nota ou qualquer manipulação de indicador: descartado, mesmo que apareça mais entre os melhores." />
        <FieldRow label="Pendente" value="As fontes não permitem decidir (ou faltam fontes): o padrão fica pendente de validação e fora das recomendações até alguém confirmar." />
      </WikiSection>

      <WikiSection id="revisao" title="Revisão e disponibilidade" eyebrow="Decisão humana">
        <p>Quem administra a configuração do Grupo aprova, rejeita, desativa, reativa ou edita o texto (números e evidências nunca são editáveis; editar devolve para revisão). Cada decisão fica no histórico e na auditoria.</p>
        <p><strong>Como isso ajuda no resultado</strong> (opcional): quem revisa escreve, ou corrige o rascunho que a IA propõe na análise, como a prática ajuda no indicador ou no sinal, pelo que ela muda na chamada e sem prometer resultado (ex.: “o cliente não precisa anotar o protocolo na linha, e esse tempo sai da chamada”). A base mede associação, nunca causa; por isso o feedback, o chat e a voz só dizem como a prática ajuda no resultado com esse texto aprovado. Sem ele, falam só do que a ação faz pelo cliente.</p>
        <p>Um padrão só orienta operadores quando está <strong>aprovado</strong>, não pode ser obrigação, a análise mais recente ainda sustenta a associação e os dados são reais. Se uma análise nova enfraquece a evidência, ele deixa de orientar sozinho — e some dos feedbacks já entregues na próxima leitura.</p>
        <WarningCallout title="Privacidade" kind="tip">
          As evidências mostram falas literais com nomes e dados pessoais mascarados; quem atendeu aparece como “Operador A/B…”. Abrir a chamada completa só vale para quem tem a pessoa no próprio escopo, e o acesso fica registrado.
        </WarningCallout>
      </WikiSection>

      <WikiSection id="medir" title="Medir por indicador ou por sinal" eyebrow="O que define os melhores">
        <p><strong>Por indicador</strong> (TMA, Rechamada, Nota da URA como indicador): os operadores do 1º quartil oficial contra os demais. O quartil é sempre o oficial do fechamento — nunca recalculado, nem para um Subgrupo.</p>
        <p><strong>Por sinal da chamada</strong> (por exemplo, a nota da URA que vem em cada chamada): as chamadas com resultado bom contra as com resultado ruim. O que é bom e ruim é cadastro do sinal (Administração → flags de canal, o mesmo sinal dos <WikiLink href="/wiki/workflows/triggers">Triggers</WikiLink>): num sinal numérico, uma faixa boa e uma ruim (o meio fica de fora); num sinal sim/não, qual valor é o ruim. Chamada sem o sinal nunca conta como boa nem como ruim. O mesmo operador pode ter chamadas nos dois grupos; os mínimos (operadores e chamadas em cada grupo) e os critérios de força são os mesmos.</p>
        <p><strong>População</strong>: o Grupo inteiro ou um Subgrupo dele (os melhores do subgrupo contra os demais do subgrupo). Padrão do Subgrupo e padrão do Grupo são revisados separados.</p>
      </WikiSection>

      <WikiSection id="no-feedback" title="No feedback: de onde vem a prática" eyebrow="1 a 2 práticas, no texto e no bloco">
        <p>As práticas são escolhidas antes da redação. O texto do feedback pode ligar o ponto daquele assunto à prática de quem tem melhor resultado — sempre como sugestão opcional, depois do que o processo pede, com os números como estão e a fala sugerida exata, colocada pelo sistema. O bloco próprio “Oportunidades inspiradas em boas práticas” continua mostrando todas. Sem ponto a ajustar, os parabéns vêm primeiro e inteiros; a prática, no máximo uma, só no fim, como um passo a mais.</p>
        <FieldRow label="Feedback de indicador" value="Práticas dos melhores no indicador do feedback, nos assuntos (submotivo) onde a investigação localizou o problema." />
        <FieldRow label="Feedback por sinal" value="Práticas das melhores chamadas do sinal que disparou o feedback, no assunto da chamada. Sem prática do sinal, as dos melhores no indicador relacionado ao sinal (cadastro do sinal)." />
        <p>Em cada assunto, a INIA usa o primeiro nível com prática aprovada e sustentada: <strong>subgrupo + submotivo → grupo + submotivo → subgrupo + motivo → grupo + motivo</strong>. Sem prática em nenhum nível, nem o texto nem o bloco falam de boa prática — nunca recua para a organização inteira nem para outro resultado. O registro guarda de onde veio cada prática (por exemplo, “Dos operadores com melhor TMA do seu grupo (…), em chamadas de Segunda via”).</p>
      </WikiSection>

      <WikiSection id="uso" title="Onde a INIA usa" eyebrow="Chat, voz, feedback e Diagnóstico">
        <p><strong>Operador</strong>: ao perguntar “como melhoro meu TMA?”, a INIA combina o resultado e a tendência dele, as práticas aprovadas para os contextos das chamadas dele e uma sugestão de fala — apresentada como exemplo. Ela só diz o que a pessoa faz quando as chamadas dela foram analisadas; sem prática sustentada, diz isso em vez de dar conselho genérico.</p>
        <p><strong>Quem lidera</strong>: “o que os melhores fazem em TMA?” traz as práticas dos Grupos da estrutura, com os números — e a orientação de confirmar ouvindo chamadas antes de atribuir a alguém. Ver <WikiLink href="/wiki/estrutura/lideranca">A INIA para quem lidera</WikiLink>.</p>
        <p><strong>Feedback</strong>: o texto pode citar a prática ligada ao ponto daquele assunto, como sugestão, e o bloco próprio, “Oportunidades inspiradas em boas práticas”, mostra os detalhes, separado do cumprimento do processo. Em “Ouvir com a INIA”, a conclusão sugere as práticas que o texto ainda não disse. <strong>Diagnóstico</strong>: um indicativo compacto na investigação do indicador e no detalhe da chamada, com link para as evidências.</p>
      </WikiSection>

      <WikiSection id="sinteticos" title="Dados sintéticos" eyebrow="Teste do mecanismo">
        <p>Fora de produção existe um dataset fictício para testar o fluxo inteiro (obrigações cumpridas por todos, comportamento recorrente, frase isolada, poucas avaliações, contextos que não se comparam, dados insuficientes, indicador sem benefício, prática de um tipo de contato e uma tentativa de instruir a IA dentro da transcrição). Ele valida o mecanismo, não prova nada sobre o mundo real, e nunca alimenta recomendações de produção.</p>
      </WikiSection>

      <SeeAlso
        links={[
          { href: "/wiki/estrutura/lideranca", label: "A INIA para quem lidera" },
          { href: "/wiki/estrutura/reports", label: "Reports recorrentes" },
        ]}
      />
    </WikiArticle>
  )
}
