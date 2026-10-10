"""Etapa 02 (roupa) — utilitários de malha, pesos, materiais e imagens.

Tudo em coordenadas de MUNDO (Z para cima, a personagem olha para −Y). Os objetos novos são criados
em mundo e depois parentados ao rig com `common.parent_to_rig`.
"""
from __future__ import annotations

import math
from pathlib import Path

import bmesh
import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

from common import TEX_DIR, hex_to_linear_rgba, obj, parent_to_rig


# ---------------------------------------------------------------------------
# Ilhas soldadas por posição (o GLB duplica vértices nas costuras de UV)
# ---------------------------------------------------------------------------

def welded_islands(bm: bmesh.types.BMesh, material_index: int | None = None, ndigits: int = 5) -> list[list]:
    key = {v: (round(v.co.x, ndigits), round(v.co.y, ndigits), round(v.co.z, ndigits)) for v in bm.verts}
    faces = [f for f in bm.faces if material_index is None or f.material_index == material_index]
    index = {f: i for i, f in enumerate(faces)}
    parent = list(range(len(faces)))

    def find(a: int) -> int:
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    first: dict = {}
    for f in faces:
        for v in f.verts:
            k = (f.material_index, key[v])
            if k in first:
                a, b = find(index[f]), find(first[k])
                if a != b:
                    parent[a] = b
            else:
                first[k] = index[f]
    comps: dict[int, list] = {}
    for f in faces:
        comps.setdefault(find(index[f]), []).append(f)
    return sorted(comps.values(), key=len, reverse=True)


def island_bbox(faces) -> tuple[Vector, Vector]:
    vs = {v for f in faces for v in f.verts}
    xs, ys, zs = zip(*[(v.co.x, v.co.y, v.co.z) for v in vs])
    return Vector((min(xs), min(ys), min(zs))), Vector((max(xs), max(ys), max(zs)))


def material_slot(ob: bpy.types.Object, prefix: str) -> int:
    for i, m in enumerate(ob.data.materials):
        if m is not None and m.name.startswith(prefix):
            return i
    raise KeyError(f"{ob.name}: material ausente '{prefix}*'")


# ---------------------------------------------------------------------------
# Objetos temporários / BVH
# ---------------------------------------------------------------------------

def mesh_object_from_faces(name: str, bm_src: bmesh.types.BMesh, faces, link: bool = True) -> bpy.types.Object:
    """Cria um objeto (mundo) só com as faces dadas de um bmesh já em coordenadas de mundo."""
    keep = set(faces)
    bm = bm_src.copy()
    bm.faces.ensure_lookup_table()
    src_index = {f.index for f in keep}
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.index not in src_index], context="FACES")
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    if link:
        bpy.context.scene.collection.objects.link(ob)
    return ob


def world_bmesh(ob: bpy.types.Object, deformed: bool = False) -> bmesh.types.BMesh:
    bm = bmesh.new()
    if deformed:
        dg = bpy.context.evaluated_depsgraph_get()
        bm.from_object(ob, dg)
    else:
        bm.from_mesh(ob.data)
    bm.transform(ob.matrix_world)
    bm.normal_update()
    return bm


def bvh_of(ob: bpy.types.Object, deformed: bool = False) -> BVHTree:
    bm = world_bmesh(ob, deformed)
    tree = BVHTree.FromBMesh(bm)
    bm.free()
    return tree


def link_world_object(name: str, me: bpy.types.Mesh) -> bpy.types.Object:
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def remove_object(ob: bpy.types.Object) -> None:
    data = ob.data
    bpy.data.objects.remove(ob, do_unlink=True)
    if isinstance(data, bpy.types.Mesh) and data.users == 0:
        bpy.data.meshes.remove(data)


# ---------------------------------------------------------------------------
# Pesos (skinning)
# ---------------------------------------------------------------------------

def transfer_weights(target: bpy.types.Object, source: bpy.types.Object, mapping: str = "POLYINTERP_NEAREST") -> None:
    """Copia os grupos de vértices (nomes = ossos) do objeto-fonte pelo ponto mais próximo."""
    for vg in source.vertex_groups:
        if target.vertex_groups.get(vg.name) is None:
            target.vertex_groups.new(name=vg.name)
    mod = target.modifiers.new("_wt", "DATA_TRANSFER")
    mod.object = source
    mod.use_object_transform = True
    mod.use_vert_data = True
    mod.data_types_verts = {"VGROUP_WEIGHTS"}
    mod.vert_mapping = mapping
    mod.layers_vgroup_select_src = "ALL"
    mod.layers_vgroup_select_dst = "NAME"
    with bpy.context.temp_override(object=target, active_object=target, selected_objects=[target]):
        bpy.ops.object.modifier_apply(modifier=mod.name)


def weights_matrix(ob: bpy.types.Object) -> tuple[np.ndarray, list[str]]:
    names = [vg.name for vg in ob.vertex_groups]
    w = np.zeros((len(ob.data.vertices), len(names)), dtype=np.float64)
    for v in ob.data.vertices:
        for g in v.groups:
            w[v.index, g.group] = g.weight
    return w, names


def write_weights(ob: bpy.types.Object, w: np.ndarray, names: list[str], limit: int = 4, verts: np.ndarray | None = None) -> None:
    """Normaliza, limita a `limit` influências e grava (só nos vértices `verts`, se dado)."""
    groups = [ob.vertex_groups.get(n) or ob.vertex_groups.new(name=n) for n in names]
    idx = np.arange(len(w)) if verts is None else verts
    for i in idx:
        row = w[i].copy()
        if limit and np.count_nonzero(row) > limit:
            cut = np.sort(row)[-limit]
            row[row < cut] = 0.0
        total = row.sum()
        if total <= 0:
            continue
        row /= total
        for gi, g in enumerate(groups):
            if row[gi] > 1e-4:
                g.add([int(i)], float(row[gi]), "REPLACE")
            else:
                g.remove([int(i)])


def smooth_weights(ob: bpy.types.Object, iterations: int = 3, factor: float = 0.5, verts: np.ndarray | None = None, limit: int = 4) -> None:
    """Suavização laplaciana dos pesos pela topologia (vértices soldados por posição contam como vizinhos)."""
    me = ob.data
    w, names = weights_matrix(ob)
    co = np.array([v.co[:] for v in me.vertices])
    keys = {}
    rep = np.arange(len(co))
    for i, c in enumerate(np.round(co, 5)):
        rep[i] = keys.setdefault(tuple(c), i)
    nbrs: list[set] = [set() for _ in range(len(co))]
    for e in me.edges:
        a, b = rep[e.vertices[0]], rep[e.vertices[1]]
        nbrs[a].add(b)
        nbrs[b].add(a)
    active = np.ones(len(co), bool) if verts is None else np.isin(np.arange(len(co)), verts)
    for _ in range(iterations):
        wr = w[rep].copy()
        new = w.copy()
        for i in range(len(co)):
            r = rep[i]
            if not active[i] or not nbrs[r]:
                continue
            avg = wr[list(nbrs[r])].mean(axis=0)
            new[i] = (1 - factor) * w[i] + factor * avg
        w = new
    write_weights(ob, w, names, limit, verts=np.nonzero(active)[0])


def rigid_weights_from(target: bpy.types.Object, source: bpy.types.Object, point: Vector, limit: int = 4) -> None:
    """Pesos iguais para todos os vértices (peça rígida: botão, broche) = pesos da fonte no ponto."""
    tree = bvh_of(source)
    loc, _n, face, _d = tree.find_nearest(point)
    poly = source.data.polygons[face]
    mw = source.matrix_world
    pts = [mw @ source.data.vertices[i].co for i in poly.vertices]
    dist = np.array([(p - loc).length for p in pts]) + 1e-6
    bary = (1 / dist) / (1 / dist).sum()
    acc: dict[str, float] = {}
    for vi, b in zip(poly.vertices, bary):
        for g in source.data.vertices[vi].groups:
            name = source.vertex_groups[g.group].name
            acc[name] = acc.get(name, 0.0) + b * g.weight
    top = sorted(acc.items(), key=lambda kv: -kv[1])[:limit]
    total = sum(v for _k, v in top)
    for vg in list(target.vertex_groups):
        target.vertex_groups.remove(vg)
    everyone = [v.index for v in target.data.vertices]
    for name, value in top:
        target.vertex_groups.new(name=name).add(everyone, value / total, "REPLACE")


def finish_skinned(ob: bpy.types.Object) -> None:
    """Parenta ao rig (modificador Armature) sem mover a malha."""
    parent_to_rig(ob, with_armature_modifier=True)


# ---------------------------------------------------------------------------
# Materiais e imagens
# ---------------------------------------------------------------------------

def principled_material(name: str, base_hex: str | None = None, roughness: float = 0.8, metallic: float = 0.0,
                        base_image: bpy.types.Image | None = None, normal_image: bpy.types.Image | None = None,
                        normal_strength: float = 1.0, alpha_image: bool = False, specular: float | None = None) -> bpy.types.Material:
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    out.location, bsdf.location = (300, 0), (0, 0)
    nt.links.new(bsdf.outputs[0], out.inputs[0])
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if specular is not None:
        bsdf.inputs["Specular IOR Level"].default_value = specular
    if base_hex:
        bsdf.inputs["Base Color"].default_value = hex_to_linear_rgba(base_hex)
    if base_image is not None:
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = base_image
        tex.location = (-400, 200)
        nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
        if alpha_image:
            nt.links.new(tex.outputs["Alpha"], bsdf.inputs["Alpha"])
            mat.blend_method = "CLIP" if hasattr(mat, "blend_method") else mat.blend_method
            mat.alpha_threshold = 0.5 if hasattr(mat, "alpha_threshold") else None
            try:
                mat.surface_render_method = "DITHERED"
            except AttributeError:
                pass
    if normal_image is not None:
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = normal_image
        tex.image.colorspace_settings.name = "Non-Color"
        tex.location = (-400, -250)
        nmap = nt.nodes.new("ShaderNodeNormalMap")
        nmap.inputs["Strength"].default_value = normal_strength
        nmap.location = (-150, -250)
        nt.links.new(tex.outputs["Color"], nmap.inputs["Color"])
        nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
    return mat


def _png_chunk(kind: bytes, payload: bytes) -> bytes:
    import struct
    import zlib
    return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", zlib.crc32(kind + payload) & 0xFFFFFFFF)


def save_image(name: str, pixels: np.ndarray, non_color: bool = False) -> bpy.types.Image:
    """Grava `pixels` (h×w×4, float 0..1 já na codificação final — sRGB para cor —, linha 0 = base)
    como PNG determinístico (zlib puro, sem gerência de cor do Blender) e devolve a imagem carregada."""
    import struct
    import zlib
    arr = np.asarray(pixels, dtype=np.float32)
    h, w, c = arr.shape
    data = np.clip(np.rint(arr * 255.0), 0, 255).astype(np.uint8)[::-1]
    raw = np.concatenate([np.zeros((h, 1), dtype=np.uint8), data.reshape(h, w * c)], axis=1)
    png = b"\x89PNG\r\n\x1a\n" + _png_chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, {3: 2, 4: 6}[c], 0, 0, 0))
    png += _png_chunk(b"IDAT", zlib.compress(raw.tobytes(), 9)) + _png_chunk(b"IEND", b"")
    path = Path(TEX_DIR) / f"{name}.png"
    path.write_bytes(png)
    old = bpy.data.images.get(f"{name}.png")
    if old is not None:
        bpy.data.images.remove(old)
    img = bpy.data.images.load(str(path))
    img.name = f"{name}.png"
    img.colorspace_settings.name = "Non-Color" if non_color else "sRGB"
    return img


def load_image(path: Path, non_color: bool = False) -> bpy.types.Image:
    img = bpy.data.images.load(str(path), check_existing=True)
    img.reload()
    if non_color:
        img.colorspace_settings.name = "Non-Color"
    return img


def smoothstep(a: float, b: float, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def normal_from_height(height: np.ndarray, strength: float) -> np.ndarray:
    """Mapa normal em espaço tangente (OpenGL, +Y) de um campo de altura tileável (h×w)."""
    dx = (np.roll(height, -1, axis=1) - np.roll(height, 1, axis=1)) * 0.5 * strength
    dy = (np.roll(height, -1, axis=0) - np.roll(height, 1, axis=0)) * 0.5 * strength
    n = np.dstack([-dx, -dy, np.ones_like(height)])
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    rgba = np.dstack([n * 0.5 + 0.5, np.ones_like(height)])
    return rgba


def uv_sphere_dir(theta: float, phi: float) -> Vector:
    return Vector((math.cos(phi) * math.cos(theta), math.cos(phi) * math.sin(theta), math.sin(phi)))
