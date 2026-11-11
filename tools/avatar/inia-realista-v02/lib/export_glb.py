"""Etapa 07 — exportação glTF binária e medição do arquivo (geometria × morphs × texturas)."""
from __future__ import annotations

from pathlib import Path

import bpy

import finalize_contract as C

EXPORT_SETTINGS = dict(
    export_format="GLB",
    export_copyright=C.COPYRIGHT,
    export_image_format="AUTO",        # as cópias já são WebP (lib/export_textures.py)
    export_texcoords=True,
    export_normals=True,
    export_tangents=False,             # o three.js deriva o espaço tangente no shader
    export_materials="EXPORT",
    export_vertex_color="MATERIAL",    # COLOR_0 só onde o material usa Color Attribute (cabelo)
    export_attributes=False,
    export_cameras=False,
    export_lights=False,
    export_extras=True,                # procedência no nó INIA_Rig (extras)
    export_yup=True,
    export_apply=False,                # modificadores = skinning; blendshapes precisam disso
    export_shared_accessors=True,
    export_animations=False,           # o frontend monta os clipes em código
    export_skins=True,
    export_def_bones=False,            # os 55 ossos (inclusive *_ph), como no GLB base
    export_leaf_bone=False,
    export_rest_position_armature=True,
    export_armature_object_remove=False,
    export_hierarchy_flatten_bones=False,
    export_influence_nb=C.MAX_INFLUENCES,
    export_all_influences=False,
    export_morph=True,
    export_morph_normal=True,
    export_morph_tangent=False,
    export_morph_animation=False,
    export_try_sparse_sk=True,         # accessors esparsos (só vértices que se movem)
    export_try_omit_sparse_sk=True,    # blendshape sem delta (tongueOut, olhos) = accessor sem dados
    export_draco_mesh_compression_enable=False,  # o GLTFLoader do app não registra Draco/Meshopt
    use_selection=False,
    use_visible=False,
    export_unused_images=False,
    export_unused_textures=False,
)


def export(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=str(path), **EXPORT_SETTINGS)


def breakdown(path: Path) -> dict:
    """Bytes do BIN por categoria + contagens, lidos do próprio GLB."""
    gltf = C.read_glb_json(path)
    views = gltf.get("bufferViews", [])
    category = ["geometry"] * len(views)
    for image in gltf.get("images", []):
        if "bufferView" in image:
            category[image["bufferView"]] = "textures"

    def mark_accessor(index: int, kind: str) -> None:
        accessor = gltf["accessors"][index]
        if "bufferView" in accessor:
            category[accessor["bufferView"]] = kind
        sparse = accessor.get("sparse")
        if sparse:
            category[sparse["indices"]["bufferView"]] = kind
            category[sparse["values"]["bufferView"]] = kind

    meshes = {}
    for mesh in gltf.get("meshes", []):
        tris = 0
        for primitive in mesh["primitives"]:
            for target in primitive.get("targets", []):
                for accessor in target.values():
                    mark_accessor(accessor, "morphs")
            if "indices" in primitive:
                tris += gltf["accessors"][primitive["indices"]]["count"] // 3
        meshes[mesh.get("name", "?")] = {"triangles": tris, "primitives": len(mesh["primitives"]),
                                         "morph_targets": len(mesh.get("extras", {}).get("targetNames", []))}
    totals = {"geometry": 0, "morphs": 0, "textures": 0}
    for view, kind in zip(views, category):
        totals[kind] += view["byteLength"]
    size = path.stat().st_size
    return {
        "file_bytes": size,
        "file_mb": round(size / 1024 / 1024, 2),
        "bin_bytes": totals,
        "json_bytes": size - sum(totals.values()),
        "meshes": meshes,
        "images": [{"name": im.get("name"), "mime": im.get("mimeType"),
                    "bytes": views[im["bufferView"]]["byteLength"]} for im in gltf.get("images", [])],
        "extensions_used": gltf.get("extensionsUsed", []),
        "extensions_required": gltf.get("extensionsRequired", []),
        "animations": len(gltf.get("animations", [])),
        "nodes": len(gltf.get("nodes", [])),
        "skins": [len(s["joints"]) for s in gltf.get("skins", [])],
    }
