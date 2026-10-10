"""Contrato do modelo web da INIA Mentora (etapas 06–08).

O frontend (`frontend/src/lib/avatar/animation/avatar-rig.ts` e `rig-framing.ts`) procura objetos,
ossos, blendshapes e empties por NOME. Este módulo é a fonte única desses nomes para o pipeline;
os nomes de ossos e a ordem dos 52 blendshapes ARKit vêm do GLB base original (nunca editado), para
que qualquer divergência apareça como erro e não como detalhe silencioso.
"""
from __future__ import annotations

import json
import struct
from pathlib import Path

from common import BASE_GLB, BODY, EYES, HEAD, OUT_DIR, REPO, RIG

POLO = "INIA_Polo"
LOGOS = "INIA_Logos"
BADGE = "INIA_Badge"
HAIR = "INIA_Hair"
CURLS = "INIA_HairCurls"

# Malhas do contrato (a ordem é a do relatório).
MESHES = (BODY, HEAD, EYES, POLO, LOGOS, BADGE, HAIR, CURLS)
SHAPE_KEY_MESHES = (HEAD, EYES)

# Objetos produzidos pelas etapas anteriores com outro nome: {nome: (ação, destino)}.
#  - "merge": junta na malha de destino (materiais e pesos preservados);
#  - "rename": só troca o nome.
ALIASES = {
    "INIA_Belt": ("merge", BODY),  # cinto + fivela (etapa 02) → mesmo objeto da calça
}

# Empties de enquadramento lidos por `rig-framing.ts` (filhos do INIA_Rig, parent de OBJETO).
FRAME_TOP = "INIA_Frame_Top"
FRAME_FACE = "INIA_Frame_Face"
FRAME_CHEST = "INIA_Frame_Chest"
FRAME_BELT = "INIA_Frame_Belt"
FRAMES = (FRAME_TOP, FRAME_FACE, FRAME_CHEST, FRAME_BELT)

# Folgas do enquadramento (metros).
# Folgas medidas no plano do rosto (alvo da câmera). O peito fica ~9 cm À FRENTE desse plano, então
# na perspectiva do app o broche e o cinto aparecem ~2 cm mais baixos: as folgas compensam isso.
FRAME_CHEST_BELOW_MARKS = 0.045  # abaixo do broche / logo do peito (o que estiver mais baixo)
FRAME_BELT_BELOW_BELT = 0.06     # abaixo da borda inferior do cinto (faixa de calça das referências)

MAX_INFLUENCES = 4
SHAPE_KEY_NOISE = 5e-6  # m; |delta| abaixo disso é ruído numérico do asset base

# Nós de material que o exportador glTF entende (o resto teria de ser assado em imagem).
EXPORTABLE_NODES = {
    "OUTPUT_MATERIAL", "BSDF_PRINCIPLED", "TEX_IMAGE", "NORMAL_MAP", "SEPARATE_COLOR",
    "VERTEX_COLOR", "MIX", "MATH", "UVMAP", "TEX_COORD", "MAPPING",
}
PROCEDURAL_NODES = {
    "TEX_NOISE", "TEX_VORONOI", "TEX_WAVE", "TEX_MUSGRAVE", "TEX_GRADIENT", "TEX_MAGIC",
    "TEX_CHECKER", "TEX_BRICK", "TEX_WHITE_NOISE", "TEX_GABOR", "VALTORGB", "BUMP", "GROUP",
}

# Texturas: teto de tamanho na exportação (as fontes PNG nunca são alteradas).
ATLAS_IMAGES = ("skin_basecolor",)   # atlas pele/rosto (≤ 2048)
ATLAS_MAX = 2048
OTHER_MAX = 1024
GLB_TARGET_BYTES = 12 * 1024 * 1024

PROVENANCE = {
    "inia_model": "inia-mentora",
    "inia_base_asset": "Pixar style girl (rigging) — Black vizual",
    "inia_base_license": "CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)",
    "inia_modified": "Modificado pelo pipeline tools/avatar/inia-mentora (roupa, proporções, pele, cabelo)",
}
COPYRIGHT = ("Base: 'Pixar style girl (rigging)' by Black vizual, CC BY 4.0 — "
             "modified for INIA (INIA Mentora)")

RENDERS_DIR = OUT_DIR / "renders"
THREE_CHECK = REPO / "tools/avatar/inia-mentora/lib/export_three_check.mjs"


def read_glb_json(path: Path) -> dict:
    data = Path(path).read_bytes()
    if struct.unpack_from("<I", data, 0)[0] != 0x46546C67:
        raise ValueError(f"não é GLB: {path}")
    length = struct.unpack_from("<I", data, 12)[0]
    return json.loads(data[20:20 + length])


def base_contract() -> dict:
    """Nomes de ossos e blendshapes (com ordem) do GLB base + quais blendshapes têm delta."""
    gltf = read_glb_json(BASE_GLB)
    nodes = gltf["nodes"]
    joints = [nodes[j]["name"] for j in gltf["skins"][0]["joints"]]
    by_node = {"girl_head": HEAD, "girl_eyes": EYES}
    shape_keys: dict[str, list[str]] = {}
    nonzero: dict[str, list[str]] = {}
    for node in nodes:
        target = by_node.get(node.get("name"))
        if target is None or "mesh" not in node:
            continue
        mesh = gltf["meshes"][node["mesh"]]
        names = mesh["extras"]["targetNames"]
        shape_keys[target] = names
        moved = set()
        for primitive in mesh["primitives"]:
            for index, morph in enumerate(primitive.get("targets", [])):
                accessor = gltf["accessors"][morph["POSITION"]]
                if any(abs(v) > 1e-5 for v in accessor.get("min", []) + accessor.get("max", [])):
                    moved.add(names[index])
        nonzero[target] = [name for name in names if name in moved]
    return {"bones": joints, "shape_keys": shape_keys, "nonzero": nonzero}
