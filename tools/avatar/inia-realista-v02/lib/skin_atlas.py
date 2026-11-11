"""Etapa 04 — leitura do atlas original e rasterização das ilhas UV da pele (Blender 5.2 + numpy).

O atlas `girl_color` (2048², sRGB) é compartilhado por rosto, orelhas, pescoço, mãos, peça do
pescoço/colo, tornozelos, olhos (globos oculares) e interior da boca. Esta etapa sempre parte do
atlas PRISTINO embutido no GLB base (nunca de uma saída anterior), o que torna o script idempotente:
rodar de novo sobre a própria saída produz exatamente as mesmas texturas.

Convenções de pixel (iguais às de `bpy.types.Image.pixels`): linha 0 = v 0 (base da imagem), coluna 0
= u 0; o centro do texel (linha i, coluna j) é a UV ((j + .5) / W, (i + .5) / H).
"""
from __future__ import annotations

import json
import struct
from dataclasses import dataclass, field
from pathlib import Path

import bpy
import numpy as np

from common import BASE_GLB, BODY, EYES, HEAD, WORK

# ---------------------------------------------------------------------------
# Rótulos semânticos por texel
# ---------------------------------------------------------------------------
NONE, HEAD_SKIN, MOUTH_BAG, TEETH, GUMS, TONGUE, EYEBALL, HAND, NAILS, CHEST, RECT, ANKLE, OTHER = range(13)
LABEL_NAMES = {
    NONE: "none", HEAD_SKIN: "head_skin", MOUTH_BAG: "mouth_bag", TEETH: "teeth", GUMS: "gums", TONGUE: "tongue",
    EYEBALL: "eyeball", HAND: "hand", NAILS: "nails", CHEST: "chest", RECT: "chest_rect", ANKLE: "ankle", OTHER: "other_skin",
}

# Caixas UV (u0, u1, v0, v1) do atlas original — medidas na auditoria (mesh-audit/islands_welded.json).
BOX_MOUTH_BAG = (0.0, 0.125, 0.0, 0.235)
BOX_TEETH = (0.525, 0.622, 0.64, 1.0)
BOX_GUMS = (0.615, 0.795, 0.83, 1.0)
BOX_TONGUE = (0.615, 0.805, 0.585, 0.74)
BOX_NAILS = (0.12, 0.215, 0.0, 0.165)
BOX_HAND = (0.60, 1.0, 0.27, 0.60)
BOX_RECT = (0.66, 1.0, 0.0, 0.28)           # retângulo pescoço/colo — destino das UVs dos braços novos
BOX_ANKLE = (0.53, 0.655, 0.0, 0.275)
BOX_STRIP = (0.525, 0.62, 0.275, 0.565)      # tira curva da peça do colo
BOX_EYE_FRONT = (0.765, 1.0, 0.66, 0.925)   # disco do globo ocular (íris no polo)
IRIS_POLE_UV = (0.8758, 0.7957)

# Retângulo uniforme que outra etapa usa para as UVs da pele nova dos braços (spec da orquestração).
UNIFORM_RECT = (0.69, 1.0, 0.02, 0.27)


def in_box(u: np.ndarray, v: np.ndarray, box: tuple[float, float, float, float]) -> np.ndarray:
    u0, u1, v0, v1 = box
    return (u >= u0) & (u < u1) & (v >= v0) & (v < v1)


def texel_uv(shape: tuple[int, int]) -> tuple[np.ndarray, np.ndarray]:
    h, w = shape
    u = (np.arange(w, dtype=np.float32) + 0.5) / w
    v = (np.arange(h, dtype=np.float32) + 0.5) / h
    return np.broadcast_to(u[None, :], (h, w)), np.broadcast_to(v[:, None], (h, w))


def box_slices(shape: tuple[int, int], box: tuple[float, float, float, float]) -> tuple[slice, slice]:
    h, w = shape
    u0, u1, v0, v1 = box
    return slice(int(np.floor(v0 * h)), int(np.ceil(v1 * h))), slice(int(np.floor(u0 * w)), int(np.ceil(u1 * w)))


# ---------------------------------------------------------------------------
# Atlas pristino a partir do GLB base
# ---------------------------------------------------------------------------

def _glb_image_bytes(glb: Path, image_name: str) -> bytes:
    data = glb.read_bytes()
    magic, _version, _length = struct.unpack_from("<4sII", data, 0)
    if magic != b"glTF":
        raise ValueError(f"não é GLB: {glb}")
    offset = 12
    doc = None
    binary = None
    while offset < len(data):
        chunk_len, chunk_type = struct.unpack_from("<I4s", data, offset)
        payload = data[offset + 8: offset + 8 + chunk_len]
        if chunk_type == b"JSON":
            doc = json.loads(payload)
        elif chunk_type == b"BIN\x00":
            binary = payload
        offset += 8 + chunk_len
    if doc is None or binary is None:
        raise ValueError("GLB sem JSON/BIN")
    for image in doc.get("images", []):
        if image.get("name") == image_name:
            view = doc["bufferViews"][image["bufferView"]]
            start = view.get("byteOffset", 0)
            return binary[start: start + view["byteLength"]]
    raise KeyError(f"imagem {image_name} ausente em {glb}")


def load_source_image(image_name: str) -> np.ndarray:
    """Pixels (H, W, 4) float32 do PNG original embutido no GLB base, na codificação da imagem."""
    path = WORK / f"04_src_{image_name}.png"
    payload = _glb_image_bytes(BASE_GLB, image_name)
    if not path.exists() or path.read_bytes() != payload:
        path.write_bytes(payload)
    image = bpy.data.images.load(str(path), check_existing=False)
    try:
        image.colorspace_settings.name = "Non-Color"  # só queremos os bytes, sem conversão
        w, h = image.size
        pixels = np.empty(w * h * 4, dtype=np.float32)
        image.pixels.foreach_get(pixels)
    finally:
        bpy.data.images.remove(image)
    return pixels.reshape(h, w, 4)


# ---------------------------------------------------------------------------
# Rasterização das ilhas UV
# ---------------------------------------------------------------------------

@dataclass
class AtlasMaps:
    shape: tuple[int, int]
    label: np.ndarray                    # (H, W) uint8
    pos: np.ndarray                      # (H, W, 3) float32, posição de MUNDO em repouso (NaN fora)
    normal: np.ndarray                   # (H, W, 3) float32, normal de mundo em repouso
    counts: dict[str, int] = field(default_factory=dict)
    objects: dict[str, list[str]] = field(default_factory=dict)


def _classify_face(object_name: str, u: float, v: float) -> int:
    if object_name == EYES:
        return EYEBALL
    if object_name == HEAD:
        if in_box(np.float32(u), np.float32(v), BOX_MOUTH_BAG):
            return MOUTH_BAG
        if in_box(np.float32(u), np.float32(v), BOX_TEETH):
            return TEETH
        if in_box(np.float32(u), np.float32(v), BOX_GUMS):
            return GUMS
        if in_box(np.float32(u), np.float32(v), BOX_TONGUE):
            return TONGUE
        return HEAD_SKIN
    # corpo e qualquer malha nova com a pele (ex.: braços da etapa 03)
    for box, label in ((BOX_NAILS, NAILS), (BOX_HAND, HAND), (BOX_RECT, RECT), (BOX_ANKLE, ANKLE), (BOX_STRIP, CHEST)):
        if in_box(np.float32(u), np.float32(v), box):
            return label
    if u < 0.52:
        return CHEST  # parte superior da peça do colo, mapeada na continuação da ilha da cabeça
    return OTHER


def skin_objects(material: bpy.types.Material) -> list[bpy.types.Object]:
    return sorted((ob for ob in bpy.data.objects if ob.type == "MESH" and any(slot.material == material for slot in ob.material_slots)),
                  key=lambda ob: ob.name)


def rasterize(material: bpy.types.Material, shape: tuple[int, int]) -> AtlasMaps:
    """Rasteriza todas as faces (em repouso, sem shape keys/modificadores) que usam `material`."""
    h, w = shape
    label = np.zeros((h, w), dtype=np.uint8)
    pos = np.full((h, w, 3), np.nan, dtype=np.float32)
    nrm = np.zeros((h, w, 3), dtype=np.float32)
    counts: dict[str, int] = {}
    objects: dict[str, list[str]] = {}
    # Ordem: corpo/outros primeiro, cabeça e olhos por último (sobrepõem margens de sangria).
    obs = skin_objects(material)
    obs.sort(key=lambda ob: {EYES: 2, HEAD: 1}.get(ob.name, 0))
    for ob in obs:
        me = ob.data
        uv_layer = me.uv_layers.active
        if uv_layer is None:
            raise RuntimeError(f"{ob.name} sem UVMap")
        me.calc_loop_triangles()
        slots = {i for i, slot in enumerate(ob.material_slots) if slot.material == material}
        matrix = ob.matrix_world
        normal_matrix = matrix.to_3x3().inverted().transposed()
        co = np.empty(len(me.vertices) * 3, dtype=np.float32)
        me.vertices.foreach_get("co", co)
        co = co.reshape(-1, 3)
        world = co @ np.array(matrix.to_3x3(), dtype=np.float32).T + np.array(matrix.translation, dtype=np.float32)
        vnorm = np.empty(len(me.vertices) * 3, dtype=np.float32)
        me.vertices.foreach_get("normal", vnorm)
        vnorm = vnorm.reshape(-1, 3) @ np.array(normal_matrix, dtype=np.float32).T
        vnorm /= np.maximum(np.linalg.norm(vnorm, axis=1, keepdims=True), 1e-9)
        uvs = np.empty(len(me.loops) * 2, dtype=np.float32)
        uv_layer.data.foreach_get("uv", uvs)
        uvs = uvs.reshape(-1, 2)
        tri_loops = np.empty(len(me.loop_triangles) * 3, dtype=np.int32)
        me.loop_triangles.foreach_get("loops", tri_loops)
        tri_loops = tri_loops.reshape(-1, 3)
        tri_verts = np.empty(len(me.loop_triangles) * 3, dtype=np.int32)
        me.loop_triangles.foreach_get("vertices", tri_verts)
        tri_verts = tri_verts.reshape(-1, 3)
        tri_mat = np.empty(len(me.loop_triangles), dtype=np.int32)
        me.loop_triangles.foreach_get("material_index", tri_mat)
        keep = np.isin(tri_mat, list(slots))
        labels_here: dict[int, int] = {}
        for loops, verts in zip(tri_loops[keep], tri_verts[keep]):
            tuv = uvs[loops]
            centroid = tuv.mean(0)
            lab = _classify_face(ob.name, float(centroid[0]), float(centroid[1]))
            labels_here[lab] = labels_here.get(lab, 0) + 1
            px = tuv[:, 0] * w - 0.5
            py = tuv[:, 1] * h - 0.5
            x0 = max(int(np.floor(px.min())), 0)
            x1 = min(int(np.ceil(px.max())), w - 1)
            y0 = max(int(np.floor(py.min())), 0)
            y1 = min(int(np.ceil(py.max())), h - 1)
            if x1 < x0 or y1 < y0:
                continue
            xs, ys = np.meshgrid(np.arange(x0, x1 + 1, dtype=np.float32), np.arange(y0, y1 + 1, dtype=np.float32))
            (ax, bx, cx), (ay, by, cy) = px, py
            den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
            if abs(den) < 1e-12:
                continue
            l1 = ((by - cy) * (xs - cx) + (cx - bx) * (ys - cy)) / den
            l2 = ((cy - ay) * (xs - cx) + (ax - cx) * (ys - cy)) / den
            l3 = 1.0 - l1 - l2
            inside = (l1 >= -1e-4) & (l2 >= -1e-4) & (l3 >= -1e-4)
            if not inside.any():
                continue
            iy = ys[inside].astype(np.int32)
            ix = xs[inside].astype(np.int32)
            bary = np.stack([l1[inside], l2[inside], l3[inside]], axis=1)
            label[iy, ix] = lab
            pos[iy, ix] = bary @ world[verts]
            n = bary @ vnorm[verts]
            nrm[iy, ix] = n / np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-9)
        objects[ob.name] = sorted(LABEL_NAMES[k] for k in labels_here)
    # Preenche frestas de 1–2 texels entre triângulos vizinhos (e a margem de sangria) sem cruzar ilhas.
    label, pos, nrm = _grow(label, pos, nrm, iterations=3)
    for lab, name in LABEL_NAMES.items():
        if lab != NONE:
            counts[name] = int((label == lab).sum())
    return AtlasMaps(shape=shape, label=label, pos=pos, normal=nrm, counts=counts, objects=objects)


def _grow(label: np.ndarray, pos: np.ndarray, nrm: np.ndarray, iterations: int) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    label = label.copy()
    pos = pos.copy()
    nrm = nrm.copy()
    for _ in range(iterations):
        empty = label == NONE
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            src_label = np.roll(label, (dy, dx), axis=(0, 1))
            take = empty & (src_label != NONE)
            if not take.any():
                continue
            label[take] = src_label[take]
            pos[take] = np.roll(pos, (dy, dx), axis=(0, 1))[take]
            nrm[take] = np.roll(nrm, (dy, dx), axis=(0, 1))[take]
            empty = label == NONE
    return label, pos, nrm
