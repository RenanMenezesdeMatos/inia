"""Etapa 07 — calibração de cor do GLB para o visualizador web (three.js, PBR Neutral).

Por que existe: as etapas 02–05 calibraram os albedos para o estúdio de conferência do Blender (AgX +
luzes fortes, que clareiam e dessaturam). No app (luzes de `studio-lighting.ts` + tone mapping
Khronos PBR Neutral, que ainda "come" os escuros) os MESMOS albedos saem ~40 % mais escuros e
supersaturados (pele marrom-laranja, polo violeta quase preta, calça e cinto pretos chapados).
O `.blend` final continua com os albedos das etapas (é o que as etapas controlam); só as CÓPIAS
exportadas (texturas WebP, cor por vértice e cores de fator em memória) recebem esta correção.

Transformação por grupo de materiais, em OKLab: L' = L·gL, C' = C·gC, h' = h + dh. Ganho em L é um
ganho de luminância (gL³) igual para claros e escuros — desfaz o escurecimento sem mudar a relação
entre pele, sobrancelha e lábio do mesmo atlas; gC controla a saturação.

Os ganhos foram medidos (08_verify, seção "web_color") comparando a mediana exibida de cada grupo na
réplica da iluminação do app (`export_web_studio.py`, conferida contra capturas do three.js) com a
mediana das mesmas regiões nas referências (`TARGETS`). Se as etapas 02–05 mudarem cores, rode o
build e copie os ganhos sugeridos pelo relatório da 08 para `CALIBRATION`.
"""
from __future__ import annotations

import numpy as np

# Mediana exibida medida nas referências (ref_front / ref_back em 518×760, retângulos de pele do
# rosto/pescoço/antebraços, peito/barriga/manga da polo, calça e cinto). O cabelo das referências
# (p25 #140804 · p50 #30170b · p75 #65361c) é dividido entre o volume (base) e os cachos.
TARGETS = {
    "skin": "#bd6b40",
    "polo": "#542578",
    "hair_volume": "#24110a",  # base escura do afro (≈ p35 do cabelo nas referências)
    "hair_curls": "#5a321c",   # cachinhos: raiz escura → caramelo (≈ p70)
    "pants": "#25201f",
    "belt": "#1c1716",
}

# grupo: materiais, gL, gC, dh (graus). Grupos sem entrada não são alterados (logo branco, broche,
# córnea, botões, fivela metálica).
CALIBRATION = {
    "skin": {"materials": ["M_Skin"], "gL": 1.51, "gC": 1.0, "dh": -3.5},
    "polo": {"materials": ["M_Polo", "M_PoloRib", "M_PoloButton"], "gL": 1.66, "gC": 0.99, "dh": -1.0},
    "hair_volume": {"materials": ["M_Hair"], "gL": 1.83, "gC": 0.55, "dh": -10.0},
    "hair_curls": {"materials": ["M_HairCurls"], "gL": 1.8, "gC": 0.9, "dh": 1.0},  # v02: fitas (cor por vértice × textura de fios),
    "pants": {"materials": ["M_Pants"], "gL": 1.71, "gC": 0.70, "dh": 0.0},
    "belt": {"materials": ["M_Belt"], "gL": 1.88, "gC": 0.70, "dh": 0.0},
    # metal da fivela: no app ele reflete o RoomEnvironment (a réplica do Blender não reproduz esse
    # reflexo), ganho conferido no navegador: fivela ≈ metal escovado das referências (#7b6555)
    "buckle": {"materials": ["M_Buckle"], "gL": 1.75, "gC": 1.0, "dh": 0.0},
}

# v02: nos cachos em fita a textura (`hair_card`) é quase branca (só o desenho dos fios) e a COR vive na
# cor por vértice — a correção vai para o atributo, nunca para a textura.
VERTEX_COLOR_FIRST = ("M_HairCurls",)

_M1 = np.array([[0.4122214708, 0.5363325363, 0.0514459929],
                [0.2119034982, 0.6806995451, 0.1073969566],
                [0.0883024619, 0.2817188376, 0.6299787005]])
_M2 = np.array([[0.2104542553, 0.7936177850, -0.0040720468],
                [1.9779984951, -2.4285922050, 0.4505937099],
                [0.0259040371, 0.7827717662, -0.8086757660]])


def srgb_to_linear(c):
    c = np.asarray(c, dtype=np.float64)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(c):
    c = np.clip(np.asarray(c, dtype=np.float64), 0.0, 1.0)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)


def linear_to_oklab(rgb):
    lms = np.cbrt(np.asarray(rgb, dtype=np.float64) @ _M1.T)
    return lms @ _M2.T


def oklab_to_linear(lab):
    lms = np.asarray(lab, dtype=np.float64) @ np.linalg.inv(_M2).T
    return (lms ** 3) @ np.linalg.inv(_M1).T


def lch(rgb_linear):
    lab = linear_to_oklab(rgb_linear)
    return lab[..., 0], np.hypot(lab[..., 1], lab[..., 2]), np.degrees(np.arctan2(lab[..., 2], lab[..., 1])) % 360


def transform_linear(rgb, gL: float, gC: float, dh: float):
    """Aplica (gL, gC, dh) a cores lineares (…×3) e devolve lineares em [0, 1]."""
    lab = linear_to_oklab(rgb)
    angle = np.radians(dh)
    a = lab[..., 1] * np.cos(angle) - lab[..., 2] * np.sin(angle)
    b = lab[..., 1] * np.sin(angle) + lab[..., 2] * np.cos(angle)
    out = np.stack([np.clip(lab[..., 0] * gL, 0.0, 1.0), a * gC, b * gC], axis=-1)
    return np.clip(oklab_to_linear(out), 0.0, 1.0)


def transform_srgb(rgb, gL: float, gC: float, dh: float):
    return linear_to_srgb(transform_linear(srgb_to_linear(rgb), gL, gC, dh))


def group_of(material_name: str) -> dict | None:
    for entry in CALIBRATION.values():
        if material_name in entry["materials"]:
            return entry
    return None


# ---------------------------------------------------------------------------
# Aplicação na cena (somente em memória, durante a exportação)
# ---------------------------------------------------------------------------

def _base_color_sources(material):
    """Nós que alimentam o Base Color do Principled (atravessando Mix)."""
    bsdf = next(n for n in material.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    found, stack = [], [bsdf.inputs["Base Color"]]
    while stack:
        socket = stack.pop()
        for link in socket.links:
            node = link.from_node
            found.append(node)
            if node.type == "MIX":
                stack += [s for s in node.inputs if s.is_linked]
    return bsdf, found


def image_calibrations(materials) -> dict[int, dict]:
    """{ponteiro da imagem: grupo} para as imagens de cor base a corrigir. Com textura × cor por
    vértice (volume do cabelo) a correção vai para a TEXTURA — o atributo é um multiplicador quase
    branco e saturaria; cor por vértice só é corrigida quando é a única fonte (cachos)."""
    result: dict[int, dict] = {}
    for material in materials:
        if material.name in VERTEX_COLOR_FIRST:
            continue
        entry = group_of(material.name)
        _, sources = _base_color_sources(material)
        for node in sources:
            if node.type == "TEX_IMAGE" and node.image is not None:
                key = node.image.as_pointer()
                if key in result and result[key] is not entry:
                    raise RuntimeError(f"imagem {node.image.name} usada por grupos de cor diferentes")
                result[key] = entry
    return {k: v for k, v in result.items() if v is not None}


def apply_to_scene(objects, materials) -> dict:
    """Corrige cores de fator e atributos de cor por vértice (em memória). Devolve o relatório."""
    report = {}
    done: set[tuple[str, str]] = set()
    for material in materials:
        entry = group_of(material.name)
        if entry is None:
            continue
        bsdf, sources = _base_color_sources(material)
        args = (entry["gL"], entry["gC"], entry["dh"])
        if not bsdf.inputs["Base Color"].is_linked:
            value = bsdf.inputs["Base Color"].default_value
            new = transform_linear(np.array(value[:3]), *args)
            bsdf.inputs["Base Color"].default_value = (*new, value[3])
            report[material.name] = "fator " + "#%02x%02x%02x" % tuple((linear_to_srgb(new) * 255).round().astype(int))
        if any(n.type == "TEX_IMAGE" for n in sources) and material.name not in VERTEX_COLOR_FIRST:
            sources = []  # a textura já recebe a correção (image_calibrations)
        for node in sources:
            if node.type != "VERTEX_COLOR":
                continue
            for ob in objects:
                if material.name not in [s.material.name for s in ob.material_slots if s.material]:
                    continue
                groups = {id(group_of(s.material.name)) for s in ob.material_slots if s.material}
                if len(groups) != 1:
                    raise RuntimeError(f"{ob.name}: cor por vértice compartilhada por grupos de cor diferentes")
                if (ob.name, node.layer_name) in done:
                    continue
                done.add((ob.name, node.layer_name))
                attribute = ob.data.color_attributes[node.layer_name]
                data = np.empty(len(attribute.data) * 4, dtype=np.float32)
                attribute.data.foreach_get("color", data)
                rgba = data.reshape(-1, 4)
                if attribute.data_type == "BYTE_COLOR":  # guardado em sRGB
                    rgba[:, :3] = transform_srgb(rgba[:, :3], *args)
                else:
                    rgba[:, :3] = transform_linear(rgba[:, :3], *args)
                attribute.data.foreach_set("color", rgba.ravel())
                report[f"{ob.name}.{node.layer_name}"] = f"cor por vértice ({len(rgba)})"
    return report
