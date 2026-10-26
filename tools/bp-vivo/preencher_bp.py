"""Preenche o Modelo BP IA editando o XML do .xlsx direto (preserva fluxograma, comentários e validações).

Uso: python build_bp.py <modelo.xlsx> <saida.xlsx> [--sample]
--sample preenche as células amarelas com números de teste (só para conferir as fórmulas).
"""
import re
import sys
import zipfile
from xml.dom import minidom

SRC, OUT = sys.argv[1], sys.argv[2]
SAMPLE = "--sample" in sys.argv

zin = zipfile.ZipFile(SRC)
parts = {i.filename: zin.read(i.filename) for i in zin.infolist()}
order = [i.filename for i in zin.infolist()]

SHEETS = {"Contrato": "xl/worksheets/sheet1.xml", "Histórico": "xl/worksheets/sheet2.xml",
          "Racional": "xl/worksheets/sheet3.xml", "Descricao": "xl/worksheets/sheet6.xml"}
xml = {k: parts[v].decode("utf-8") for k, v in SHEETS.items()}
styles = parts["xl/styles.xml"].decode("utf-8")

# ---------------------------------------------------------------- estilos
fills_m = re.search(r'<fills count="(\d+)">(.*?)</fills>', styles, re.S)
YELLOW_FILL = int(fills_m.group(1))
styles = styles.replace(fills_m.group(0), f'<fills count="{YELLOW_FILL + 1}">{fills_m.group(2)}'
                        '<fill><patternFill patternType="solid"><fgColor rgb="FFFFFF00"/><bgColor indexed="64"/></patternFill></fill></fills>')
xfs_m = re.search(r'<cellXfs count="(\d+)">(.*?)</cellXfs>', styles, re.S)
xfs = re.findall(r'<xf [^>]*?(?:/>|>.*?</xf>)', xfs_m.group(2), re.S)
new_xfs = []
_cache = {}


def style(base, fill=False, fmt=None, wrap=False, font=None):
    key = (base, fill, fmt, wrap, font)
    if key in _cache:
        return _cache[key]
    xf = xfs[base]
    if font is not None:
        xf = re.sub(r'fontId="\d+"', f'fontId="{font}"', xf)
    if fill:
        xf = re.sub(r'fillId="\d+"', f'fillId="{YELLOW_FILL}"', xf)
        if 'applyFill="1"' not in xf:
            xf = xf.replace("<xf ", '<xf applyFill="1" ', 1)
    if fmt is not None:
        xf = re.sub(r'numFmtId="\d+"', f'numFmtId="{fmt}"', xf)
        if 'applyNumberFormat="1"' not in xf:
            xf = xf.replace("<xf ", '<xf applyNumberFormat="1" ', 1)
    if wrap:
        if "<alignment" in xf:
            xf = re.sub(r'<alignment([^/>]*)/>', lambda m: m.group(0) if "wrapText" in m.group(1) else f'<alignment{m.group(1)} wrapText="1"/>', xf)
            xf = re.sub(r'<alignment([^/>]*)/>', lambda m: m.group(0).replace('vertical="center"', 'vertical="top"') if 'vertical=' in m.group(1) else f'<alignment{m.group(1)} vertical="top"/>', xf)
        elif xf.endswith("/>"):
            xf = xf[:-2] + ' applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>'
    idx = len(xfs) + len(new_xfs)
    new_xfs.append(xf)
    _cache[key] = idx
    return idx


# ---------------------------------------------------------------- células
def col_index(ref):
    letters = re.match(r"[A-Z]+", ref).group(0)
    n = 0
    for ch in letters:
        n = n * 26 + ord(ch) - 64
    return n


def col_letter(n):
    s = ""
    while n:
        n, r = divmod(n - 1, 26)
        s = chr(65 + r) + s
    return s


def esc(t):
    return t.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def set_cell(sheet, ref, value, s=None):
    """value: str (texto), int/float (número) ou '=fórmula'."""
    x = xml[sheet]
    row_n = int(re.search(r"\d+", ref).group(0))
    row_re = re.compile(r'<row r="%d"(?: [^>]*)?(?:/>|>.*?</row>)' % row_n, re.S)
    m = row_re.search(x)
    if m is None:  # cria a linha na posição certa
        rows = [(int(r.group(1)), r.start()) for r in re.finditer(r'<row r="(\d+)"', x)]
        pos = next((p for n, p in rows if n > row_n), x.index("</sheetData>"))
        x = x[:pos] + f'<row r="{row_n}"></row>' + x[pos:]
        m = row_re.search(x)
    row = m.group(0)
    if row.endswith("/>"):
        row = row[:-2] + "></row>"
    row = re.sub(r' spans="[^"]*"', "", row)
    cell_re = re.compile(r'<c r="%s"(?: [^>]*?)?(?:/>|>.*?</c>)' % ref, re.S)
    cm = cell_re.search(row)
    old_s = None
    if cm:
        sm = re.search(r' s="(\d+)"', cm.group(0).split(">")[0])
        old_s = sm.group(1) if sm else None
    s_attr = f' s="{s}"' if s is not None else (f' s="{old_s}"' if old_s else "")
    if isinstance(value, str) and value.startswith("="):
        new = f'<c r="{ref}"{s_attr}><f>{esc(value[1:])}</f></c>'
    elif isinstance(value, str):
        new = f'<c r="{ref}"{s_attr} t="inlineStr"><is><t xml:space="preserve">{esc(value)}</t></is></c>'
    elif value is None:
        new = f'<c r="{ref}"{s_attr}/>'
    else:
        new = f'<c r="{ref}"{s_attr}><v>{value}</v></c>'
    if cm:
        row = row[:cm.start()] + new + row[cm.end():]
    else:
        target = col_index(ref)
        pos = None
        for c in re.finditer(r'<c r="([A-Z]+)\d+"', row):
            if col_index(c.group(1)) > target:
                pos = c.start()
                break
        if pos is None:
            pos = row.rindex("</row>")
        row = row[:pos] + new + row[pos:]
    xml[sheet] = x[:m.start()] + row + x[m.end():]


def set_row_height(sheet, row_n, ht):
    x = xml[sheet]
    m = re.search(r'<row r="%d"([^>]*?)(/?)>' % row_n, x)
    attrs = re.sub(r' (ht|customHeight)="[^"]*"', "", m.group(1))
    xml[sheet] = x[:m.start()] + f'<row r="{row_n}"{attrs} ht="{ht}" customHeight="1"{m.group(2)}>' + x[m.end():]


# ---------------------------------------------------------------- estilos usados
WRAP_TOP = 88            # texto longo das caixas do Contrato (já quebra linha)
LABEL = 58               # rótulo com borda
NUM = 29                 # número com borda, #,##0
TITLE = 53               # título vermelho
HEAD = 97                # cabeçalho azul-escuro
HEAD2 = 100
MONTH = 27               # mês azul-escuro (mmm-yy)
PLAIN = 41               # texto sem borda (transborda para a direita)
Y_TXT = style(70, fill=True)
Y_NUM = style(NUM, fill=True)
Y_DEC = style(NUM, fill=True, fmt=4)
Y_PCT = style(NUM, fill=True, fmt=9)
Y_MON = style(NUM, fill=True, fmt=17)
DEC = style(NUM, fmt=4)
PCT = style(NUM, fmt=9)
NUM_PLAIN = style(NUM, fmt=3)
DESC_WRAP = style(28, wrap=True)

P = "'Racional (descrição)'"

# ================================================================ Contrato
set_cell("Contrato", "D6", "INIA - Supervisor Virtual")
set_cell("Contrato", "D8", None, Y_TXT)                       # Diretoria: a preencher
set_cell("Contrato", "P8", "Renan Menezes")
set_cell("Contrato", "C11", (
    "A INIA é uma supervisora virtual com IA para a operação de atendimento. Ela identifica sinais na operação (rechamada, "
    "nota baixa na URA, indicador fora da meta), reúne as evidências (trecho da chamada, resultado do indicador, procedimento "
    "vigente), monta um diagnóstico explicável e entrega ao colaborador um feedback com recomendação. Cada caso fica "
    "registrado e é acompanhado até o encerramento ou o encaminhamento à liderança. Toda conclusão aponta para uma fonte "
    "verificável, e nenhuma decisão sobre a situação funcional da pessoa é tomada pela IA.\n"
    "Objetivos: automatizar a monitoria de qualidade e o preparo de feedback, liberando horas de monitores e supervisores; "
    "ampliar a cobertura de monitoria além da amostra manual; dar o feedback ao colaborador assim que a chamada chega à INIA."), WRAP_TOP)
set_cell("Contrato", "C13", (
    "Quantitativos: redução das horas de monitoria manual e de preparo de feedback de indicadores (cálculo na aba Racional); "
    "ampliação da cobertura de monitoria sem aumento de equipe.\n"
    "Qualitativos: feedback padronizado e baseado em evidência (trecho literal da chamada e procedimento vigente); histórico "
    "rastreável de cada caso; visão para a liderança de onde atuar primeiro; registro da ciência do colaborador; apoio à "
    "melhoria de indicadores como TMA, rechamada e nota da URA."), WRAP_TOP)
set_cell("Contrato", "C15", (
    "Reduzir em [__]% as horas mensais de monitoria manual e de preparo de feedback no escopo do piloto ([__] colaboradores), "
    "mantendo ou ampliando a cobertura de monitoria, em até [__] meses após a entrada em produção."), WRAP_TOP)
set_cell("Contrato", "C17", (
    "1) Horas/mês de monitoria manual e de preparo de feedback (antes × depois); 2) feedbacks gerados pela INIA por mês e % de "
    "colaboradores do escopo com feedback; 3) cobertura de monitoria (chamadas analisadas ÷ chamadas elegíveis); 4) % de "
    "feedbacks com ciência do colaborador; 5) evolução de TMA, rechamada e nota da URA no grupo do piloto; 6) custo de IA por "
    "feedback."), WRAP_TOP)
# o modelo usa letra branca nessas duas células; a cópia do estilo troca só a fonte (negrito preto)
BLACK_CHOICE = style(104, font=8)
set_cell("Contrato", "C19", "Opex", BLACK_CHOICE)
set_cell("Contrato", "K19", "Reduzido", BLACK_CHOICE)
# o modelo formata o valor do ganho como data (mm-dd-yy); a cópia do estilo usa número com 2 casas
set_cell("Contrato", "H22", "=Racional!P40", style(102, fmt=4))
for r, h in ((11, 112), (13, 92), (15, 44), (17, 60)):
    set_row_height("Contrato", r, h)

# ================================================================ Racional (descrição): premissas
D = "Descricao"
set_cell(D, "B58", "PREMISSAS DO CÁLCULO - INIA (preencher as células amarelas)", TITLE)
for ref, txt in (("B59", "Premissa"), ("C59", "Valor"), ("D59", "Unidade"), ("E59", "Fonte / observação")):
    set_cell(D, ref, txt, HEAD if ref == "B59" else HEAD2)

premissas = [
    # linha, texto, valor, estilo, unidade, fonte
    (60, "Monitorias manuais por mês hoje (escopo do piloto)", None, Y_NUM, "monitorias/mês", "Relatório de monitoria da operação"),
    (61, "Tempo médio de uma monitoria manual (ouvir, avaliar, registrar e devolver)", None, Y_NUM, "minutos", "Medição da operação (cronometrar uma amostra)"),
    (62, "% das monitorias manuais que a INIA passa a fazer", None, Y_PCT, "%", "Chamadas que já disparam feedback automático (ex.: rechamada, nota baixa na URA)"),
    (63, "Colaboradores no escopo", None, Y_NUM, "pessoas", "Quadro do piloto"),
    (64, "Tempo do supervisor para preparar o feedback de indicador, por colaborador/mês", None, Y_NUM, "minutos", "Medição com os supervisores"),
    (65, "% desse preparo que a INIA assume", None, Y_PCT, "%", "A INIA entrega diagnóstico, evidências e texto; o supervisor revisa e conversa com o colaborador"),
    (66, "Salário mensal do monitor de qualidade", None, Y_NUM, "R$", "RH (ou a aba Salários)"),
    (67, "Salário mensal do supervisor", None, Y_NUM, "R$", "RH (ou a aba Salários)"),
    (68, "Fator RH (encargos e benefícios)", "=Salários!D3", DEC, "x", "Aba Salários"),
    (69, "Horas trabalhadas por mês", None, Y_NUM, "horas", "Jornada contratual"),
    (70, "Custo-hora do monitor", "=IFERROR(C66*C68/C69,0)", DEC, "R$/hora", "Salário × fator RH ÷ horas"),
    (71, "Custo-hora do supervisor", "=IFERROR(C67*C68/C69,0)", DEC, "R$/hora", "Salário × fator RH ÷ horas"),
    (72, "Horas/mês gastas hoje (monitoria + preparo de feedback)", "=C60*C61/60+C63*C64/60", NUM_PLAIN, "horas/mês", "Base da aba Histórico"),
    (73, "Custo-hora médio de hoje (ponderado)", "=IFERROR((C60*C61/60*C70+C63*C64/60*C71)/C72,0)", DEC, "R$/hora", ""),
    (74, "Horas/mês economizadas com 100% de adoção", "=C60*C61/60*C62+C63*C64/60*C65", NUM_PLAIN, "horas/mês", ""),
    (75, "Custo-hora médio das horas economizadas (ponderado)", "=IFERROR((C60*C61/60*C62*C70+C63*C64/60*C65*C71)/C74,0)", DEC, "R$/hora", ""),
    (76, "Mês em que a INIA começa a gerar ganho", None, Y_MON, "mês", "Mês de entrada em produção (digite o dia 1º, ex.: 01/01/2027)"),
    (77, "Feedbacks de monitoria gerados pela INIA por mês (com 100% de adoção)", "=C60*C62", NUM_PLAIN, "feedbacks/mês", "Fórmula = monitorias substituídas; se a cobertura aumentar, digite o volume previsto"),
    (78, "Custo de IA por feedback de monitoria", 0.30, Y_DEC, "US$", "Medido na INIA (out/2026, Gemini): média de US$ 0,15 a 0,19, máximo de US$ 0,41; usado 0,30 com margem"),
    (79, "Custo de IA do feedback de indicador, por colaborador/mês", 1.50, Y_DEC, "US$", "Medido na INIA (out/2026, Gemini): média de US$ 0,80 a 1,21 com investigação, máximo de US$ 3,24; usado 1,50"),
    (80, "Câmbio", None, Y_DEC, "R$/US$", "Câmbio orçamentário informado pelo CDG"),
    (81, "Infraestrutura (servidor e banco) por mês", None, Y_NUM, "R$/mês", "Custo do ambiente na Vivo"),
    (82, "Sustentação (pessoas) por mês", None, Y_NUM, "R$/mês", "Se houver equipe dedicada"),
    (83, "Custo de IA por mês com 100% de adoção", "=(C77*C78+C63*C79)*C80", NUM_PLAIN, "R$/mês", "Será atualizado com o preço do provedor liberado pelo LAB IA"),
]
for r, txt, val, st, unit, src in premissas:
    set_cell(D, f"B{r}", txt, LABEL)
    set_cell(D, f"C{r}", val, st)
    set_cell(D, f"D{r}", unit, LABEL)
    if src:
        set_cell(D, f"E{r}", src, PLAIN)

set_cell(D, "B85", "Adoção progressiva (% do ganho em cada mês desde o início)", HEAD)
set_cell(D, "B86", "Percentual de adoção (proposta: ajuste se quiser)", LABEL)
ramp = [0.25, 0.50, 0.75] + [1.0] * 9
for i in range(12):
    c = col_letter(3 + i)
    set_cell(D, f"{c}85", f"Mês {i + 1}", HEAD2)
    set_cell(D, f"{c}86", ramp[i], Y_PCT)

set_cell(D, "B88", "COMO O CÁLCULO FUNCIONA", TITLE)
explica = [
    "Ganho (aba Racional): horas economizadas no mês = horas/mês economizadas com 100% de adoção × % de adoção do mês; valor unitário = custo-hora médio dessas horas.",
    "Base (aba Histórico): horas/mês gastas hoje × custo-hora médio de hoje, repetidas nos 12 meses. Se houver o histórico real mês a mês, substitua pelos valores reais.",
    "Custos (aba Racional): custo de IA do mês (com o mesmo % de adoção) + infraestrutura + sustentação, a partir do mês de início.",
    "Tipo de ganho: Opex reduzido (horas de trabalho liberadas). Não considera redução de quadro; a classificação final (ganho orçamentário ou gerencial) é do CDG.",
    "O custo de IA será atualizado com o preço do provedor liberado pelo LAB IA (etapa 'Disponibilização do custo da solução para o CDG' do fluxo).",
    "Fora do cálculo (ganhos qualitativos): maior cobertura de monitoria, feedback padronizado com evidência, acompanhamento de cada caso e apoio à melhoria de TMA, rechamada e nota da URA.",
]
for i, t in enumerate(explica):
    set_cell(D, f"B{89 + i}", t, PLAIN)

set_cell(D, "B96", "CÁLCULO MÊS A MÊS (alimenta as abas Racional e Histórico)", TITLE)
set_cell(D, "B97", "Mês", HEAD)
linhas = [(98, "Meses desde o início"), (99, "% de adoção no mês"), (100, "Horas economizadas"), (101, "Custo-hora (R$)"),
          (102, "Custo de IA (R$)"), (103, "Infraestrutura + sustentação (R$)"), (104, "Custo total do mês (R$)")]
for r, t in linhas:
    set_cell(D, f"B{r}", t, LABEL)
for i in range(12):
    c = col_letter(3 + i)          # C..N na descrição
    rc = col_letter(4 + i)         # D..O na aba Racional
    set_cell(D, f"{c}97", f"=Racional!{rc}30", MONTH)
    set_cell(D, f"{c}98", f'=IF($C$76="","",(YEAR({c}97)-YEAR($C$76))*12+MONTH({c}97)-MONTH($C$76))', NUM)
    set_cell(D, f"{c}99", f'=IF({c}98="",0,IF({c}98<0,0,INDEX($C$86:$N$86,MIN(12,{c}98+1))))', PCT)
    set_cell(D, f"{c}100", f"=$C$74*{c}99", NUM)
    set_cell(D, f"{c}101", f"=IF({c}100=0,0,$C$75)", DEC)
    set_cell(D, f"{c}102", f"=$C$83*{c}99", NUM)
    set_cell(D, f'{c}103', f'=IF({c}98="",0,IF({c}98<0,0,$C$81+$C$82))', NUM)
    set_cell(D, f"{c}104", f"={c}102+{c}103", NUM)

    # ---- aba Racional: só os vínculos
    set_cell("Racional", f"{rc}31", f"={P}!{c}100")
    set_cell("Racional", f"{rc}32", f"={P}!{c}101")
    set_cell("Racional", f"{rc}38", f"={P}!{c}104")
    # ---- aba Histórico: base atual
    set_cell("Histórico", f"{rc}22", f"={P}!$C$72")
    set_cell("Histórico", f"{rc}23", f"={P}!$C$73")

set_cell("Racional", "C31", "Horas economizadas/mês (premissas na aba Racional (descrição))", DESC_WRAP)
set_cell("Racional", "C32", "Custo-hora médio (R$)", DESC_WRAP)
set_cell("Racional", "C38", "IA + infraestrutura + sustentação (R$/mês)", DESC_WRAP)
set_row_height("Racional", 31, 42)
set_row_height("Racional", 38, 30)
set_cell("Histórico", "C22", "Horas/mês gastas hoje com monitoria manual e preparo de feedback", DESC_WRAP)
set_cell("Histórico", "C23", "Custo-hora médio (R$)", DESC_WRAP)
set_row_height("Histórico", 22, 42)

if SAMPLE:  # números de teste, só para conferir as fórmulas
    for ref, v in (("C60", 2000), ("C61", 20), ("C62", 0.6), ("C63", 300), ("C64", 30), ("C65", 0.5),
                   ("C66", 3500), ("C67", 6000), ("C69", 180), ("C76", 46296), ("C80", 5.5), ("C81", 3000), ("C82", 0)):
        set_cell(D, ref, v)

xml[D] = re.sub(r'<dimension ref="[^"]*"/>', '<dimension ref="B3:Y104"/>', xml[D])

# ---------------------------------------------------------------- grava
styles = styles.replace(xfs_m.group(0), f'<cellXfs count="{len(xfs) + len(new_xfs)}">{xfs_m.group(2)}{"".join(new_xfs)}</cellXfs>')
parts["xl/styles.xml"] = styles.encode("utf-8")
for k, v in SHEETS.items():
    parts[v] = xml[k].encode("utf-8")

wb = parts["xl/workbook.xml"].decode("utf-8")
wb = re.sub(r'<calcPr ([^>]*?)/>', lambda m: '<calcPr ' + re.sub(r' ?fullCalcOnLoad="[^"]*"', "", m.group(1)) + ' fullCalcOnLoad="1"/>', wb)
parts["xl/workbook.xml"] = wb.encode("utf-8")
# a cadeia de cálculo é refeita pelo Excel; uma desatualizada provoca "reparo"
parts.pop("xl/calcChain.xml", None)
order = [o for o in order if o != "xl/calcChain.xml"]
rels = parts["xl/_rels/workbook.xml.rels"].decode("utf-8")
parts["xl/_rels/workbook.xml.rels"] = re.sub(r'<Relationship [^>]*Target="calcChain.xml"[^>]*/>', "", rels).encode("utf-8")
ct = parts["[Content_Types].xml"].decode("utf-8")
parts["[Content_Types].xml"] = re.sub(r'<Override [^>]*PartName="/xl/calcChain.xml"[^>]*/>', "", ct).encode("utf-8")

for name in list(SHEETS.values()) + ["xl/styles.xml", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "[Content_Types].xml"]:
    minidom.parseString(parts[name])  # falha se o XML ficou inválido

with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
    for name in order:
        z.writestr(name, parts[name])
print("ok", OUT, "estilos novos:", len(new_xfs))
