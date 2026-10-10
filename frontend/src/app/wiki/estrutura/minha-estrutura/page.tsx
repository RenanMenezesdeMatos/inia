import type { Metadata } from "next"

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ExampleCard, FieldRow, SeeAlso, WarningCallout, WikiArticle, WikiFlow, WikiLink, WikiPageHeader, WikiSection, WikiTable } from "@/components/wiki/wiki-primitives"
import type { WikiTocEntry } from "@/components/wiki/wiki-toc"

export const metadata: Metadata = {
  title: "Estrutura organizacional (aba do perfil)",
  description: "A aba Organograma do perfil usa um organograma interativo: um nível acima (o gestor imediato), a pessoa focal e os subordinados diretos abaixo. Todo mundo explora o organograma da organização; numa estrutura acima da sua, o ramo que leva até você fica sempre apontado (“Ir até mim” percorre a cadeia); o card de cada pessoa responde três perguntas — Dados do colaborador, Dados da estrutura (só para gestão) e Reporta-se à.",
}

const TOC: WikiTocEntry[] = [
  { id: "visao-geral", label: "Visão geral" },
  { id: "o-que-mostra", label: "O organograma navegável" },
  { id: "card", label: "O card: três perguntas" },
  { id: "dados-da-estrutura", label: "Dados da estrutura (gestão)" },
  { id: "cadeia", label: "Cadeia de liderança" },
  { id: "contexto", label: "Grupo, Subgrupo e estrutura imediata" },
  { id: "navegacao", label: "Navegação progressiva" },
  { id: "de-onde-vem", label: "De onde vem a informação" },
  { id: "visibilidade", label: "Visibilidade por permissão" },
  { id: "mesma-estrutura", label: "A mesma estrutura em toda a INIA" },
  { id: "o-que-nao-e", label: "O que a aba não é" },
]

export default function MyStructurePage() {
  return (
    <WikiArticle toc={TOC}>
      <WikiPageHeader
        eyebrow="02 · Pessoas e Estrutura"
        title="Estrutura organizacional (aba do perfil)"
        lead="A aba Organograma usa um organograma interativo: um nível acima da pessoa focal é exibido para facilitar a navegação pela estrutura, a focal fica no centro e quem reporta diretamente a ela aparece ligado abaixo. Todo mundo pode explorar o organograma da organização inteira, respeitando os dados que cada papel está autorizado a ver. Ao interagir com uma pessoa, a tela conduz você até ela: o conector entre as duas pessoas ganha um sinal de percurso, a câmera desliza e o card de chegada recebe um destaque breve. É uma visualização organizacional — não é performance, não é comparação e não é administração."
      />

      <WikiSection id="o-que-mostra" title="O organograma navegável" eyebrow="Três conceitos">
        <p>
          No perfil de qualquer papel existe a aba <strong className="font-medium text-foreground">Organograma</strong>. Na ficha de um colaborador
          aberta por um gestor, a mesma visão aparece como <strong className="font-medium text-foreground">Estrutura</strong>. Não existe uma área
          separada da tela para inspecionar alguém: os dados aparecem dentro do card da própria pessoa, em qualquer tamanho de tela. Três conceitos
          organizam a tela:
        </p>
        <FieldRow label="Contexto de navegação" value="A trilha no topo (“Minha estrutura › Gerente › Supervisora”) mostra por onde você chegou até a estrutura aberta — descendo pelos subordinados ou subindo pelo gestor — e permite voltar a qualquer nível. Os botões Voltar e Avançar do navegador percorrem o mesmo caminho. Acima da focal aparece só o gestor imediato; a cadeia completa fica em “Ver cadeia de liderança”." />
        <FieldRow label="Estrutura focal" value="O organograma: o gestor imediato acima, a pessoa focal no centro e quem reporta diretamente a ela ligado abaixo por conectores, em linhas equilibradas quando são muitos (25 ou 30 subordinados nunca viram uma fileira infinita). O canvas é navegável: arraste para mover, use a roda do mouse, o gesto de pinça ou os controles + − para aproximar ou afastar (o zoom é limitado — a estrutura nunca sai do canvas) e o botão de centralizar para reenquadrar; em telas estreitas a árvore fica vertical. A busca seleciona a pessoa e centraliza o organograma nela, sem esconder as outras." />
        <FieldRow label="Pessoa selecionada" value="O card expandido, no lugar onde ele está, com um cabeçalho fixo (avatar, nome, cargo, área e “N diretos” quando lidera alguém) e seções abaixo — Dados do colaborador, Dados da estrutura (só para gestão, quando a pessoa lidera) e Reporta-se à. Ao abrir a aba, a pessoa selecionada é a própria focal — o card dela já vem expandido. Clicar num subordinado expande o card dele no próprio organograma (a linha cresce para baixo, nada se sobrepõe); só um card fica expandido por vez, e trocar de seção não carrega nada." />
        <WarningCallout title="Selecionar uma pessoa ≠ abrir a estrutura dela" kind="tip">
          Clicar no card de uma pessoa expande os dados dela e não muda a estrutura aberta. Abrir a estrutura é uma ação explícita — o botão
          “Abrir estrutura” dentro do card expandido — que muda o organograma, o endereço da página e a trilha.
        </WarningCallout>
      </WikiSection>


      <WikiSection id="card" title="O card: três perguntas" eyebrow="Sem misturar conceitos">
        <p>
          O cabeçalho do card nunca muda ao trocar de seção. No card compacto de quem lidera aparece uma linha de resumo (“30 diretos · 26 em
          produção” para a gestão; só “30 diretos” para o operador). No card expandido, cada seção responde uma pergunta diferente — em cards
          estreitos as seções viram ícones, com o nome completo disponível ao passar o mouse e para leitores de tela:
        </p>
        <WikiTable caption="As seções do card expandido.">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Seção</TableHead>
                <TableHead>Pergunta que responde</TableHead>
                <TableHead>Quem vê</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="font-medium">Dados do colaborador</TableCell>
                <TableCell>Quem é essa pessoa profissionalmente: e-mail corporativo, Grupo, Subgrupo, capital operacional (jurisdição de calendário — não é endereço), gestor direto. Nunca salário, PRV, performance, quartil, feedback, dado médico, telefone pessoal ou endereço.</TableCell>
                <TableCell>Todos os papéis, para qualquer pessoa da organização.</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Dados da estrutura</TableCell>
                <TableCell>Como está organizada e distribuída a estrutura que ela lidera: população atual por situação (quantidade e percentual), span de controle, abrangência operacional, médias da estrutura e referência do Grupo.</TableCell>
                <TableCell>Supervisor, Coordenador, Gerente, Gerente Sênior, Diretor — para qualquer líder que naveguem — e contas com um papel que dá “Ver os dados de gestão”, só para líderes do escopo desse papel. O operador não tem esta seção em nenhum card.</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Reporta-se à</TableCell>
                <TableCell>Onde essa pessoa está posicionada acima: o gestor imediato, com foto e cargo, e o botão Abrir estrutura para subir. No topo da organização a seção diz “Topo da estrutura organizacional”.</TableCell>
                <TableCell>Todos os papéis.</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </WikiTable>
      </WikiSection>

      <WikiSection id="dados-da-estrutura" title="Dados da estrutura (gestão)" eyebrow="Terminologia inequívoca">
        <WikiTable caption="Definições oficiais — informação descritiva, nunca avaliação (não existe span “ideal”, “alto” ou “baixo”).">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Medida</TableHead>
                <TableHead>Definição</TableHead>
                <TableHead>Exemplo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="font-medium">Estrutura atual</TableCell>
                <TableCell>Todos os cadastros ativos abaixo da pessoa, em qualquer nível e de qualquer cargo. É o denominador único de todos os percentuais da seção — os buckets sempre somam exatamente esse total.</TableCell>
                <TableCell>Coordenadora com 5 Supervisores e 125 operadores: 130 pessoas.</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Situação atual</TableCell>
                <TableCell>Quantas pessoas da estrutura estão hoje (data local da organização) em produção, de férias, no INSS, em licença-maternidade e em licença-paternidade — quantidade e percentual com uma casa decimal. Outras situações (transferido, piloto, aposentado, atividade off) somam em “Outras situações”. É a situação funcional do cadastro, agregada; nunca a situação de uma pessoa específica.</TableCell>
                <TableCell>Em produção 26 · 86,7% · Férias 2 · 6,7% · INSS 1 · 3,3% · Maternidade 1 · 3,3% · Paternidade 0 · 0,0%.</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Não confirmado</TableCell>
                <TableCell>Quando a fonte de situação funcional da Central de Dados está atrasada, quem não tem uma situação informada cobrindo o dia entra em “Não confirmado” — a INIA não presume “em produção” sem dado recente. Um aviso explica o motivo.</TableCell>
                <TableCell>“Fonte de situação funcional atrasada: 26 situações não confirmadas.”</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Span de controle</TableCell>
                <TableCell>Quantidade de pessoas que se reportam DIRETAMENTE ao gestor, de qualquer cargo, lida do vínculo “a quem reporta” — nunca deduzida do cargo. Um operador que reporta direto a um Coordenador conta no span do Coordenador. Férias, INSS, maternidade e paternidade NÃO reduzem o span: quem está afastado continua estruturalmente vinculado.</TableCell>
                <TableCell>30 operadores vinculados, 2 de férias: span continua 30.</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Abrangência operacional</TableCell>
                <TableCell>Quantos operadores existem abaixo do gestor, em qualquer nível.</TableCell>
                <TableCell>Coordenadora: 125 operadores (o span dela é 5).</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Média da estrutura</TableCell>
                <TableCell>Para cada par de cargos que existe de fato na estrutura (quem gere quem), o total de subordinados dividido pelo número de gestores daquele cargo — calculado das relações reais de reporte.</TableCell>
                <TableCell>Gerente com 4 coordenações, 20 supervisões e 487 operadores: 5,0 supervisões / coordenação e 24,4 operadores / supervisão.</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Referência do Grupo</TableCell>
                <TableCell>A média do span de controle das pessoas de MESMO cargo e MESMO Grupo na organização (a própria pessoa incluída), com o tamanho dessa população. Serve de contexto descritivo — não é meta, ranking nem avaliação.</TableCell>
                <TableCell>25,4 diretos / supervisão · 18 supervisões em Atendimento B2B.</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </WikiTable>
        <WarningCallout title="Privacidade em estruturas pequenas" kind="tip">
          INSS, maternidade e paternidade podem identificar alguém quando a estrutura é pequena. Abaixo de 5 pessoas, esses três motivos aparecem
          apenas somados como “Afastamentos”, com o aviso “Detalhamento de afastamentos indisponível para estruturas pequenas”. Nenhum card mostra a
          situação individual de uma pessoa — a seção é sempre agregada.
        </WarningCallout>
      </WikiSection>

      <WikiSection id="cadeia" title="Cadeia de liderança" eyebrow="Real, nunca inventada">
        <WikiFlow compact steps={[{ label: "Diretor", tone: "people" }, { label: "Gerente Sênior", tone: "people" }, { label: "Gerente", tone: "people" }, { label: "Coordenador", tone: "people" }, { label: "Supervisor", tone: "people" }, { label: "Você", tone: "neutral" }]} />
        <p>
          A cadeia é lida do vínculo <em>a quem reporta</em> de cada pessoa, subindo até quem não reporta a ninguém — a mesma leitura que resolve
          destinatários de Workflow (ver <WikiLink href="/wiki/estrutura#hierarquia">A cadeia hierárquica</WikiLink>). Regras que valem sempre:
        </p>
        <ul className="list-inside list-disc space-y-1">
          <li>Só os níveis que existem são desenhados. Uma gerência sem Coordenador mostra Supervisor → Gerente, sem um Coordenador fictício.</li>
          <li>Sem gestor cadastrado, a aba diz <strong className="font-medium text-foreground">Gestor não informado</strong> — o topo da cadeia (Diretor) é um caso legítimo.</li>
          <li>Se o gestor direto cadastrado estiver inativo, a aba avisa e a cadeia continua a partir do próximo nível ativo — pessoas inativas não aparecem como liderança.</li>
          <li>Um vínculo circular no cadastro (A reporta a B, B reporta a A) é interrompido pela leitura; a aba abre normalmente e mostra o que foi possível percorrer.</li>
        </ul>
        <ExampleCard title="Exemplo">
          Uma operadora do Grupo Retenção, Subgrupo Voz, vê em “Ver cadeia de liderança”: Diretor → Gerente Sênior → Gerente → Coordenador →
          Supervisora → ela mesma (marcada como “Você”). Uma colega de uma gerência sem Coordenador vê a mesma cadeia sem esse nível.
        </ExampleCard>
      </WikiSection>

      <WikiSection id="contexto" title="Grupo, Subgrupo e estrutura imediata" eyebrow="Contexto imediato">
        <WikiTable caption="O que cada linha do contexto significa.">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Linha</TableHead>
                <TableHead>Significado</TableHead>
                <TableHead>Quando não existe</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="font-medium">Grupo</TableCell>
                <TableCell>A unidade organizacional cadastrada para a pessoa (ex.: Retenção).</TableCell>
                <TableCell>“Não informado”.</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Subgrupo</TableCell>
                <TableCell>A subdivisão do Grupo, quando cadastrada (ex.: Voz).</TableCell>
                <TableCell>“Não informado” — muitos Grupos não têm Subgrupo, e isso é normal.</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Estrutura imediata</TableCell>
                <TableCell>A estrutura do gestor direto: “Equipe de …” quando é um Supervisor; “Estrutura de …” para os cargos acima — o mesmo vocabulário das sete âncoras.</TableCell>
                <TableCell>“Não informado” quando não há gestor.</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Gestor direto</TableCell>
                <TableCell>A primeira pessoa da cadeia, com o cargo.</TableCell>
                <TableCell>“Gestor não informado” ou “Gestor direto inativo”.</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Operadores da equipe</TableCell>
                <TableCell>Quando a estrutura imediata é uma Equipe de Supervisor: os operadores ativos que reportam diretamente a ele — a mesma população usada por Indicadores, Equipe e Workflows.</TableCell>
                <TableCell>“—”.</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Operadores na estrutura</TableCell>
                <TableCell>Quando a estrutura imediata é de Coordenador ou acima: os operadores ativos em qualquer nível abaixo. Cargos de gestão nunca entram na contagem — por isso o rótulo diz “operadores”, não “integrantes”.</TableCell>
                <TableCell>“—”.</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </WikiTable>
        <WarningCallout title="Operadores não são “pessoas cadastradas”" kind="tip">
          Contas inativas e cargos de gestão nunca entram na contagem. A contagem descreve o tamanho do contexto; quem reporta diretamente à
          pessoa focal aparece em “Quem reporta a…”. Situação por fato, PRV e revisões continuam na aba{" "}
          <WikiLink href="/wiki/estrutura/equipe">Equipe / Estrutura</WikiLink>.
        </WarningCallout>
      </WikiSection>

      <WikiSection id="navegacao" title="Navegação progressiva" eyebrow="Selecionar → Focar → nova estrutura">
        <WikiFlow compact steps={[{ label: "Clique no card", tone: "neutral" }, { label: "O card expande", tone: "people" }, { label: "Abrir estrutura", tone: "people" }, { label: "Subordinados diretos", tone: "people" }, { label: "Nova pessoa", tone: "neutral" }]} />
        <p>
          Clique no card de uma pessoa para expandir seus dados. Para subir, selecione o gestor imediato acima da focal: o clique nele já abre a
          estrutura dele, sem expandir antes. No card expandido de um subordinado podem aparecer duas ações, decididas pela INIA para cada pessoa:
        </p>
        <ul className="list-inside list-disc space-y-1">
          <li>
            <strong className="font-medium text-foreground">Abrir estrutura</strong> — quando você possui permissão e a pessoa lidera uma estrutura,
            use Abrir estrutura para navegar para os subordinados daquela pessoa: ela vira a pessoa focal e o card dela é o que fica expandido. De lá,
            o processo se repete — Gerente → Coordenador → Supervisor → operador — sempre um nível por vez, nunca a árvore inteira. Uma pessoa sem
            subordinados (folha) nunca mostra esse botão; a própria focal também não.
          </li>
          <li>
            <strong className="font-medium text-foreground">Ver perfil</strong> — abre a ficha do colaborador, disponível hoje apenas para operadores
            da sua estrutura. As duas ações são independentes: é normal poder abrir a estrutura de um Supervisor sem poder abrir a ficha dele.
          </li>
        </ul>
        <WarningCallout title="Todo mundo navega a estrutura de todo mundo — a ficha e os dados da estrutura continuam restritos">
          Qualquer pessoa ativa da organização pode ser a pessoa focal: subir pela própria cadeia, descer pelas equipes e também explorar outras
          Coordenações e Gerências, como num organograma corporativo aberto. Em todos os cards aparecem só os dados profissionais (cargo, e-mail
          corporativo, Grupo, Subgrupo, capital operacional, gestor direto, “N diretos”). O que continua restrito: a ficha do colaborador
          (“Ver perfil”, só para operadores da sua própria estrutura) e a seção Dados da estrutura (só para cargos de gestão ou para o papel com “Ver os dados de gestão” no escopo do líder). Uma pessoa
          inativa ou um endereço inexistente recebe “Sem acesso a esta estrutura”.
        </WarningCallout>
        <WarningCallout title="O caminho até você fica sempre apontado" kind="tip">
          Numa estrutura acima da sua (a pessoa focal é um gestor da sua cadeia real), o subordinado dela que leva até você fica destacado o tempo
          todo — borda e sombra diferentes, o marcador “Sua estrutura” (“Este caminho leva até você”) e o conector entre os dois em movimento
          contínuo. Só um trecho por estrutura: no Diretor, Diretor → Gerente Sênior; abrindo o Gerente Sênior, Gerente Sênior → Gerente; e assim
          por diante até a sua Supervisora, onde o destaque cai em você (“Você”). O destaque não some com o tempo, nem ao selecionar outro card,
          trocar de seção, arrastar ou aproximar — só muda quando a estrutura aberta muda, e não existe em estruturas que não estão acima de você.
          Nada muda de estrutura sozinho: “Ir até mim” percorre a cadeia um nível por vez, a seu comando. Com “reduzir movimento” ativado no
          sistema, o conector fica com um traço estático diferenciado e a orientação continua.
        </WarningCallout>
        <ExampleCard title="A tela conduz você até a pessoa">
          Ao clicar num subordinado, o conector entre a pessoa focal e ele recebe um sinal de percurso, a câmera desliza até ele e o card ganha um
          destaque breve ao chegar. Ao subir pelo gestor (ou pela seção Reporta-se à) o sinal percorre o conector no sentido inverso, enquanto a nova
          estrutura é carregada — a navegação nunca espera a animação. A busca conduz a câmera até a pessoa encontrada. Esse feedback é transitório e
          não substitui o caminho até você, que continua apontado. Com “reduzir movimento” ativado no sistema, nada é animado: a centralização é
          imediata e tudo continua funcionando.
        </ExampleCard>
        <p>
          A pessoa focal fica no endereço da página: atualizar a página mantém a estrutura aberta, os botões Voltar e Avançar do navegador
          percorrem o caminho, e um link compartilhado abre a mesma estrutura para quem tem permissão. Expandir cards não carrega nada — os
          dados já vieram com a estrutura; só Abrir estrutura busca uma nova.
        </p>
      </WikiSection>

      <WikiSection id="de-onde-vem" title="De onde vem a informação" eyebrow="Fonte única">
        <p>
          A aba não tem uma árvore própria. Ela lê o mesmo cadastro de pessoas — papel, a quem reporta, Grupo e Subgrupo — que alimenta todo o resto da
          plataforma, e esse cadastro chega pela <WikiLink href="/wiki/central-de-dados">Central de Dados</WikiLink> (contratos Colaboradores, Grupos,
          Subgrupos e Estrutura organizacional) ou pela Administração. Quando existe um feed de Estrutura organizacional configurado, o rodapé mostra
          “Fonte: … · Atualizado em …”. Sem feed, nada é mostrado — a INIA não inventa uma origem.
        </p>
        <p>
          Para corrigir um gestor, um Grupo ou um Subgrupo, o caminho é o cadastro corporativo (ou a Administração, para quem tem esse papel). A aba
          é só leitura; quem tem o papel que administra pessoas vê um atalho “Gerenciar estrutura” para a área existente.
        </p>
      </WikiSection>

      <WikiSection id="visibilidade" title="Visibilidade por permissão" eyebrow="Backend decide">
        <ul className="list-inside list-disc space-y-1">
          <li>Todo papel vê a <strong className="font-medium text-foreground">própria</strong> estrutura.</li>
          <li>Todo papel navega a estrutura de qualquer pessoa ativa da organização — inclusive outras Coordenações e Gerências. Outra organização, pessoa inativa ou endereço inexistente: “Sem acesso a esta estrutura”.</li>
          <li>Poder navegar não é poder abrir a ficha: “Ver perfil” continua só para operadores da sua própria estrutura (a mesma subárvore que vale para Indicadores e Equipe — ver <WikiLink href="/wiki/estrutura#escopo">Escopo organizacional</WikiLink>).</li>
          <li>A seção Dados da estrutura só chega para Supervisor, Coordenador, Gerente, Gerente Sênior, Diretor e para contas com o papel que dá “Ver os dados de gestão” (só de líderes do escopo do papel); para o operador ela não existe em nenhum card, e a INIA nem calcula esses números para ele.</li>
          <li>Administradores seguem o escopo dos papéis deles (organização, Grupo ou Subgrupo); o nível hierárquico “Fora da hierarquia” não dá visão nenhuma a mais.</li>
          <li>A resposta traz só a cadeia ACIMA da pessoa focal, os subordinados DIRETOS dela e as contagens: nunca outros ramos da árvore.</li>
        </ul>
      </WikiSection>

      <WikiSection id="mesma-estrutura" title="A mesma estrutura em toda a INIA" eyebrow="Por que isso importa">
        <p>
          O que a aba mostra é exatamente o que a INIA usa, sem outra cópia, para decidir <strong className="font-medium text-foreground">escopo</strong>{" "}
          (o que cada pessoa enxerga), <strong className="font-medium text-foreground">população</strong> (quem entra numa Equipe, num Grupo ou numa
          estrutura consolidada), <strong className="font-medium text-foreground">destinatários</strong> (para qual Supervisor, Gerente ou Diretor um
          resultado de Workflow é entregue) e <strong className="font-medium text-foreground">permissões</strong>. Se a aba mostra um Gerente na sua
          cadeia, é esse Gerente que receberia um escalonamento seu; se mostra 25 integrantes na sua equipe, é essa a população de um ranking da equipe.
        </p>
      </WikiSection>

      <WikiSection id="o-que-nao-e" title="O que a aba não é" eyebrow="Limites conscientes">
        <ul className="list-inside list-disc space-y-1">
          <li>Não é a árvore completa da empresa: cada tela mostra o gestor imediato, uma pessoa e os subordinados diretos dela (a cadeia completa fica em “Ver cadeia de liderança”) — a navegação é progressiva.</li>
          <li>Não mostra performance de ninguém: sem PRV, quartil, atingimento, feedbacks ou situação funcional individual de terceiros.</li>
          <li>Não avalia gestores: não existe span ideal, score, ranking de gestores, alerta de span alto ou baixo nem recomendação de reorganização.</li>
          <li>Não mostra dados pessoais (telefone, endereço, salário, dado médico).</li>
          <li>Não edita nada: sem alterar gestor, Grupo ou Subgrupo.</li>
          <li>Não tem histórico: é a estrutura atual, não “onde a pessoa estava há seis meses”.</li>
          <li>Não usa IA: tudo é lido do cadastro, deterministicamente.</li>
        </ul>
        <SeeAlso
          links={[
            { href: "/wiki/estrutura", label: "Pessoas e Estrutura" },
            { href: "/wiki/estrutura/equipe", label: "Equipe / Estrutura (aba de gestão)" },
            { href: "/wiki/workflows/outputs#destinatarios", label: "Resolução de destinatários" },
            { href: "/wiki/central-de-dados", label: "Central de Dados" },
          ]}
        />
      </WikiSection>
    </WikiArticle>
  )
}
