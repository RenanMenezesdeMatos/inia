"""Etapa 06 — objetos do contrato, pose de repouso, skinning e blendshapes."""
from __future__ import annotations

import bpy
import numpy as np

from common import RIG, clear_pose, obj
import finalize_contract as C


def corner_normals(ob: bpy.types.Object) -> np.ndarray:
    me = ob.data
    out = np.empty(len(me.loops) * 3, dtype=np.float32)
    me.corner_normals.foreach_get("vector", out)
    return out.reshape(-1, 3)


def resolve_objects() -> dict:
    """Aplica ALIASES (junta/renomeia) e confere que todas as malhas do contrato existem."""
    mapping: dict[str, str] = {}
    for name, (action, target) in C.ALIASES.items():
        source = bpy.data.objects.get(name)
        if source is None:
            continue
        if action == "rename":
            source.name = target
            source.data.name = target
            mapping[name] = f"renomeado → {target}"
            continue
        dest = obj(target)
        before = corner_normals(dest)
        keep = len(before)
        with bpy.context.temp_override(active_object=dest, object=dest, selected_objects=[dest, source],
                                       selected_editable_objects=[dest, source]):
            bpy.ops.object.join()
        after = corner_normals(dest)[:keep]
        drift = float(np.degrees(np.arccos(np.clip((before * after).sum(1), -1, 1))).max())
        if drift > 0.5:
            raise RuntimeError(f"junção {name}→{target} alterou as normais da malha destino ({drift:.2f}°)")
        mapping[name] = f"juntado em {target} (normais preservadas, desvio máx {drift:.3f}°)"
    rig_ob = obj(RIG)
    if rig_ob.type != "ARMATURE":
        raise TypeError(f"{RIG} não é armature")
    for name in C.MESHES:
        ob = obj(name)
        if ob.type != "MESH":
            raise TypeError(f"{name} não é malha")
        ob.data.name = name
    rig_ob.data.name = RIG
    return mapping


def rest_pose() -> dict:
    """Sem ação, sem NLA, pose zerada, blendshapes em 0 (o frontend monta as animações em código)."""
    removed = [a.name for a in bpy.data.actions]
    for ob in bpy.data.objects:
        ob.animation_data_clear()
        if ob.type == "MESH" and ob.data.shape_keys:
            ob.data.shape_keys.animation_data_clear()
    for action in list(bpy.data.actions):
        bpy.data.actions.remove(action)
    rig_ob = obj(RIG)
    rig_ob.data.pose_position = "POSE"
    clear_pose()
    return {"actions_removed": removed}


def armature_modifier(ob: bpy.types.Object, rig_ob: bpy.types.Object) -> None:
    mods = [m for m in ob.modifiers if m.type == "ARMATURE"]
    for extra in mods[1:]:
        ob.modifiers.remove(extra)
    mod = mods[0] if mods else ob.modifiers.new("Armature", "ARMATURE")
    mod.object = rig_ob
    mod.use_vertex_groups = True
    mod.use_bone_envelopes = False
    mod.use_deform_preserve_volume = False
    others = [m.type for m in ob.modifiers if m.type != "ARMATURE"]
    if others:
        raise RuntimeError(f"{ob.name}: modificadores não exportáveis {others}")
    if ob.parent != rig_ob or ob.parent_type != "OBJECT":
        world = ob.matrix_world.copy()
        ob.parent = rig_ob
        ob.parent_type = "OBJECT"
        ob.matrix_parent_inverse = rig_ob.matrix_world.inverted()
        ob.matrix_world = world


def normalize_weights(ob: bpy.types.Object, bones: set[str]) -> dict:
    """≤ 4 influências por vértice, só grupos com nome de osso, soma 1."""
    removed_groups = [g.name for g in ob.vertex_groups if g.name not in bones]
    for name in removed_groups:
        ob.vertex_groups.remove(ob.vertex_groups[name])
    groups = list(ob.vertex_groups)
    changed = trimmed = 0
    for vertex in ob.data.vertices:
        pairs = sorted(((g.weight, g.group) for g in vertex.groups), reverse=True)
        keep = [(w, i) for w, i in pairs[:C.MAX_INFLUENCES] if w > 1e-5]
        total = sum(w for w, _ in keep)
        if total <= 0:
            raise RuntimeError(f"{ob.name}: vértice {vertex.index} sem peso")
        drop = [i for w, i in pairs if (w, i) not in keep]
        if not drop and abs(total - 1.0) < 1e-5:
            continue
        trimmed += len(pairs) > C.MAX_INFLUENCES
        changed += 1
        for index in drop:
            groups[index].remove([vertex.index])
        for weight, index in keep:
            groups[index].add([vertex.index], weight / total, "REPLACE")
    return {"groups_removed": removed_groups, "vertices_renormalized": changed, "vertices_trimmed_to_4": trimmed}


def skinning() -> dict:
    rig_ob = obj(RIG)
    bones = {b.name for b in rig_ob.data.bones}
    report = {}
    for name in C.MESHES:
        ob = obj(name)
        armature_modifier(ob, rig_ob)
        report[name] = normalize_weights(ob, bones)
    return report


def shape_keys(contract: dict) -> dict:
    report = {}
    for name in C.MESHES:
        ob = obj(name)
        keys = ob.data.shape_keys
        if name not in C.SHAPE_KEY_MESHES:
            if keys:
                raise RuntimeError(f"{name} tem blendshapes fora do contrato")
            continue
        if keys is None or not keys.use_relative:
            raise RuntimeError(f"{name}: blendshapes ausentes ou não relativos")
        blocks = keys.key_blocks
        names = [k.name for k in blocks][1:]
        expected = contract["shape_keys"][name]
        if names != expected:
            raise RuntimeError(f"{name}: blendshapes diferentes do contrato ARKit (ordem/nomes)")
        basis = np.empty(len(blocks[0].data) * 3, dtype=np.float32)
        blocks[0].data.foreach_get("co", basis)
        moved = []
        snapped = 0
        base3 = basis.reshape(-1, 3)
        for block in blocks[1:]:
            block.value = 0.0
            block.mute = False
            block.relative_key = blocks[0]
            co = np.empty_like(basis)
            block.data.foreach_get("co", co)
            co = co.reshape(-1, 3)
            # Ruído de ponto flutuante do asset base (deltas < 5 µm em milhares de vértices) vira
            # zero exato: o exportador só usa accessor esparso para deltas exatamente nulos.
            noise = (np.linalg.norm(co - base3, axis=1) < C.SHAPE_KEY_NOISE) & np.any(co != base3, axis=1)
            if noise.any():
                snapped += int(noise.sum())
                co[noise] = base3[noise]
                block.data.foreach_set("co", co.ravel())
            if np.abs(co - base3).max() > C.SHAPE_KEY_NOISE:
                moved.append(block.name)
        missing = [k for k in contract["nonzero"][name] if k not in moved]
        if missing:
            raise RuntimeError(f"{name}: blendshapes sem delta (a base tinha): {missing}")
        ob.active_shape_key_index = 0
        report[name] = {"count": len(names), "with_delta": len(moved), "noise_vertices_snapped": snapped}
    return report


def triangles(ob: bpy.types.Object) -> int:
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)

