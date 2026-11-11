"""Etapa 06 — materiais exportáveis, imagens em `textures/` (ou empacotadas) e limpeza do arquivo."""
from __future__ import annotations

import os
from pathlib import Path

import bpy

from common import RIG, TEX_DIR, obj
import finalize_contract as C

LOGO_MATERIAL = "M_Logo"
# v02: os cachos em fita também recortam pelo alpha da textura (MASK, corte 0,5)
MASK_MATERIALS = (LOGO_MATERIAL, "M_HairCurls")


def contract_materials() -> list[bpy.types.Material]:
    seen: dict[str, bpy.types.Material] = {}
    for name in C.MESHES:
        for slot in obj(name).material_slots:
            if slot.material is None:
                raise RuntimeError(f"{name}: slot de material vazio")
            seen.setdefault(slot.material.name, slot.material)
    return [seen[k] for k in sorted(seen)]


def principled_of(mat: bpy.types.Material) -> bpy.types.Node:
    out = [n for n in mat.node_tree.nodes if n.type == "OUTPUT_MATERIAL" and n.is_active_output]
    if len(out) != 1 or not out[0].inputs["Surface"].is_linked:
        raise RuntimeError(f"{mat.name}: saída de material ausente")
    bsdf = out[0].inputs["Surface"].links[0].from_node
    if bsdf.type != "BSDF_PRINCIPLED":
        raise RuntimeError(f"{mat.name}: superfície não é Principled BSDF ({bsdf.type})")
    return bsdf


def check_nodes(mat: bpy.types.Material) -> None:
    kinds = {n.type for n in mat.node_tree.nodes}
    procedural = kinds & C.PROCEDURAL_NODES
    if procedural:
        # Nenhuma etapa usa textura procedural hoje; se alguma passar a usar, ela deve gravar a
        # imagem assada em textures/ (o glTF não carrega nós procedurais).
        raise RuntimeError(f"{mat.name}: nós procedurais não assados {sorted(procedural)}")
    unknown = kinds - C.EXPORTABLE_NODES - {"FRAME", "REROUTE"}
    if unknown:
        raise RuntimeError(f"{mat.name}: nós que o glTF não exporta {sorted(unknown)}")


def logo_alpha_mask(mat: bpy.types.Material) -> str:
    """Alpha do logo como MASK (corte 0,5): Alpha(textura) → Math Round → Alpha do BSDF."""
    bsdf = principled_of(mat)
    socket = bsdf.inputs["Alpha"]
    if not socket.is_linked:
        raise RuntimeError(f"{mat.name}: alpha não vem da textura")
    source = socket.links[0].from_node
    if source.type == "MATH" and source.operation == "ROUND":
        return "MASK (já configurado)"
    tree = mat.node_tree
    from_socket = socket.links[0].from_socket
    rounder = tree.nodes.new("ShaderNodeMath")
    rounder.name = rounder.label = "Alpha MASK (corte 0.5)"
    rounder.operation = "ROUND"
    rounder.location = (bsdf.location.x - 220, bsdf.location.y - 260)
    tree.links.new(from_socket, rounder.inputs[0])
    tree.links.new(rounder.outputs[0], socket)
    mat.surface_render_method = "DITHERED"
    return "MASK (Math Round inserido)"


def materials() -> dict:
    report = {}
    for mat in contract_materials():
        check_nodes(mat)
        bsdf = principled_of(mat)
        entry = {"alpha": "OPAQUE"}
        if mat.name in MASK_MATERIALS:
            entry["alpha"] = logo_alpha_mask(mat)
        elif bsdf.inputs["Alpha"].is_linked:
            if mat.surface_render_method != "BLENDED":
                raise RuntimeError(f"{mat.name}: alpha ligado sem modo definido")
            entry["alpha"] = "BLEND (córnea do asset base)"
        entry["images"] = sorted(n.image.name for n in mat.node_tree.nodes if n.type == "TEX_IMAGE" and n.image)
        entry["vertex_color"] = any(n.type == "VERTEX_COLOR" for n in mat.node_tree.nodes)
        report[mat.name] = entry
    return report


def used_images() -> list[bpy.types.Image]:
    images = {}
    for mat in contract_materials():
        for node in mat.node_tree.nodes:
            if node.type == "TEX_IMAGE":
                if node.image is None:
                    raise RuntimeError(f"{mat.name}: nó de imagem vazio ({node.name})")
                images[node.image.name] = node.image
    return [images[k] for k in sorted(images)]


def images(tex_dir: Path) -> dict:
    """Imagens em `textures/` ficam referenciadas; as do asset base (empacotadas) continuam
    empacotadas; qualquer outra (ex.: pasta de rascunho) é empacotada e reportada."""
    tex_dir = tex_dir.resolve()
    report = {}
    for image in used_images():
        if tuple(image.size) == (0, 0):
            raise RuntimeError(f"imagem sem pixels: {image.name} ({image.filepath})")
        if image.packed_file is not None:
            report[image.name] = f"empacotada ({image.size[0]}²)"
            continue
        path = Path(bpy.path.abspath(image.filepath)).resolve()
        if not path.exists():
            raise RuntimeError(f"arquivo de textura ausente: {path}")
        if path.parent == tex_dir:
            image.filepath = str(path)
            report[image.name] = f"textures/{path.name}"
        else:
            image.pack()
            report[image.name] = f"empacotada (fora de textures/: {path})"
    return report


def cleanup() -> dict:
    keep = set(C.MESHES) | set(C.FRAMES) | {RIG}
    removed = sorted(ob.name for ob in bpy.data.objects if ob.name not in keep)
    for name in removed:
        bpy.data.objects.remove(bpy.data.objects[name], do_unlink=True)
    for collection in list(bpy.data.collections):
        if not collection.all_objects:
            bpy.data.collections.remove(collection)
    scene = bpy.context.scene
    scene.camera = None
    scene.world = None
    for scene_other in list(bpy.data.scenes):
        if scene_other != scene:
            bpy.data.scenes.remove(scene_other)
    scene.frame_set(1)
    bpy.data.orphans_purge(do_local_ids=True, do_linked_ids=True, do_recursive=True)
    return {"objects_removed": removed}


def relative_image_paths(blend_path: Path) -> None:
    for image in bpy.data.images:
        if image.packed_file is None and image.filepath:
            absolute = Path(bpy.path.abspath(image.filepath)).resolve()
            image.filepath = "//" + os.path.relpath(absolute, blend_path.parent.resolve())
