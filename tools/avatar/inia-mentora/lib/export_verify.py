"""Etapa 08 — asserções sobre o GLB reimportado num Blender limpo."""
from __future__ import annotations

from pathlib import Path

import bpy
import numpy as np

from common import RIG, obj
import finalize_contract as C

MAX_TRIANGLES = 130_000


class Checks:
    def __init__(self) -> None:
        self.failures: list[str] = []
        self.passed: list[str] = []

    def check(self, ok: bool, message: str) -> None:
        (self.passed if ok else self.failures).append(message)


def objects(checks: Checks) -> dict:
    rig_ob = bpy.data.objects.get(RIG)
    checks.check(rig_ob is not None and rig_ob.type == "ARMATURE", f"{RIG} é armature")
    for name in C.MESHES:
        ob = bpy.data.objects.get(name)
        checks.check(ob is not None and ob.type == "MESH", f"malha {name} presente")
        if ob is None:
            continue
        mods = [m for m in ob.modifiers if m.type == "ARMATURE" and m.object == rig_ob]
        checks.check(len(mods) == 1 and ob.parent == rig_ob, f"{name} skinned no {RIG}")
        weights = np.zeros(len(ob.data.vertices))
        for vertex in ob.data.vertices:
            weights[vertex.index] = sum(g.weight for g in vertex.groups)
        checks.check(bool((weights > 0.99).all()), f"{name}: todo vértice com peso (soma≈1)")
    for name in C.FRAMES:
        ob = bpy.data.objects.get(name)
        checks.check(ob is not None and ob.type == "EMPTY" and ob.parent == rig_ob and not ob.parent_bone,
                     f"empty {name} filho de objeto do {RIG}")
    extra = sorted(ob.name for ob in bpy.data.objects if ob.name not in {RIG, *C.MESHES, *C.FRAMES})
    checks.check(not extra, f"sem objetos extras ({extra})")
    checks.check(not bpy.data.actions, "sem animações")
    checks.check(not bpy.data.cameras and not bpy.data.lights, "sem câmeras/luzes")
    frames = {name: [round(v, 4) for v in obj(name).matrix_world.translation] for name in C.FRAMES if name in bpy.data.objects}
    heights = [frames[n][2] for n in C.FRAMES if n in frames]
    checks.check(heights == sorted(heights, reverse=True), "empties em ordem Top > Face > Chest > Belt")
    return frames


def bones(checks: Checks, contract: dict) -> int:
    names = [b.name for b in obj(RIG).data.bones]
    checks.check(len(names) == 55, f"55 ossos (achei {len(names)})")
    checks.check(sorted(names) == sorted(contract["bones"]), "nomes Mixamo originais dos ossos")
    return len(names)


def shape_keys(checks: Checks, contract: dict) -> dict:
    report = {}
    for name in C.SHAPE_KEY_MESHES:
        ob = obj(name)
        keys = ob.data.shape_keys
        blocks = keys.key_blocks if keys else []
        names = [k.name for k in blocks][1:]
        checks.check(names == contract["shape_keys"][name], f"{name}: 52 blendshapes ARKit na ordem da base")
        if not blocks:
            continue
        basis = np.empty(len(blocks[0].data) * 3, dtype=np.float32)
        blocks[0].data.foreach_get("co", basis)
        moved = []
        for block in blocks[1:]:
            co = np.empty_like(basis)
            block.data.foreach_get("co", co)
            if np.abs(co - basis).max() > 1e-5:
                moved.append(block.name)
        missing = [k for k in contract["nonzero"][name] if k not in moved]
        checks.check(not missing, f"{name}: blendshapes com delta como na base (faltando {missing})")
        report[name] = {"count": len(names), "with_delta": len(moved),
                        "without_delta": [k for k in names if k not in moved][:10]}
    return report


def triangles(checks: Checks) -> dict:
    counts = {name: sum(len(p.vertices) - 2 for p in obj(name).data.polygons) for name in C.MESHES}
    total = sum(counts.values())
    checks.check(total < MAX_TRIANGLES, f"total de triângulos {total} < {MAX_TRIANGLES}")
    return {**counts, "total": total}


def textures(checks: Checks) -> dict:
    report = {}
    for name in C.MESHES:
        for slot in obj(name).material_slots:
            mat = slot.material
            for node in mat.node_tree.nodes:
                if node.type != "TEX_IMAGE":
                    continue
                image = node.image
                ok = image is not None and image.size[0] > 0 and len(image.pixels) > 0
                checks.check(ok, f"{mat.name}: textura {image.name if image else '?'} decodificada")
                if image is not None:
                    report[image.name] = f"{image.size[0]}x{image.size[1]} {image.file_format}"
    return report


def glb_summary(path: Path) -> dict:
    gltf = C.read_glb_json(path)
    return {
        "images": [f"{im.get('name')} {im.get('mimeType')}" for im in gltf.get("images", [])],
        "alpha_modes": {m["name"]: m.get("alphaMode", "OPAQUE") for m in gltf.get("materials", [])},
        "extensions_required": gltf.get("extensionsRequired", []),
        "animations": len(gltf.get("animations", [])),
        "copyright": gltf.get("asset", {}).get("copyright"),
    }
