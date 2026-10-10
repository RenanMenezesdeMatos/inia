"""Aplicação de uma `warp_core.Warp` às malhas (Basis + shape keys), aos olhos (rígido) e ao rig.

- Malhas: f é aplicada em MUNDO à Basis e à posição absoluta de cada shape key (novo_k = f(k)).
- Objetos rígidos (olhos): cada grupo (globo + córnea de um lado) recebe só a TRANSLAÇÃO f(c) − c do
  seu centro — nunca uma deformação — e o relatório mede quanto f se afastaria de rígida ali.
- Rig: cabeça/cauda de cada osso em modo edição recebem f (as juntas acompanham o corpo); o roll é
  realinhado ao eixo Z transportado pela jacobiana local, e objetos filhos de OSSO mantêm a posição
  de mundo.
"""
from __future__ import annotations

import bpy
import numpy as np
from mathutils import Vector

from warp_core import Warp


def _mat(ob) -> np.ndarray:
    return np.array(ob.matrix_world, dtype=np.float64)


def _to_world(co: np.ndarray, m: np.ndarray) -> np.ndarray:
    return co @ m[:3, :3].T + m[:3, 3]


def _to_local(P: np.ndarray, m: np.ndarray) -> np.ndarray:
    inv = np.linalg.inv(m)
    return P @ inv[:3, :3].T + inv[:3, 3]


def mesh_world_coords(ob, key=None) -> np.ndarray:
    data = key.data if key is not None else ob.data.vertices
    co = np.empty(len(data) * 3)
    data.foreach_get("co", co)
    return _to_world(co.reshape(-1, 3), _mat(ob))


def key_world_coords(ob) -> dict[str, np.ndarray]:
    """Posições de mundo de todas as key blocks (inclui Basis)."""
    if ob.data.shape_keys is None:
        return {}
    return {kb.name: mesh_world_coords(ob, kb) for kb in ob.data.shape_keys.key_blocks}


def _set_local(data, P_local: np.ndarray) -> None:
    data.foreach_set("co", P_local.astype(np.float64).ravel())


# Shape keys CORRETIVAS: só fazem sentido somadas a outra (ARKit: mouthClose fecha os lábios COM a
# mandíbula aberta; sozinha empurra o lábio inferior através do superior). O delta delas é transportado
# no contexto em que é usado: novo = f(B + Δctx + Δk) − f(B + Δctx) + f(B). Assim jawOpen + mouthClose
# continua exato em (1, 1) e quase linear no caminho.
KEY_CONTEXT = {"mouthClose": ("jawOpen",)}


def warp_mesh(ob, warp: Warp, key_context: dict | None = None) -> dict:
    """Aplica f à Basis e a todas as shape keys (posições absolutas). Retorna estatísticas."""
    key_context = KEY_CONTEXT if key_context is None else key_context
    m = _mat(ob)
    me = ob.data
    before = mesh_world_coords(ob)
    contextual = []
    if me.shape_keys is not None:
        orig = {kb.name: mesh_world_coords(ob, kb) for kb in me.shape_keys.key_blocks}
        basis_name = me.shape_keys.key_blocks[0].name
        B = orig[basis_name]
        fB = warp(B)
        for kb in me.shape_keys.key_blocks:
            ctx = [c for c in key_context.get(kb.name, ()) if c in orig]
            if ctx and kb.relative_key.name == basis_name:
                C = B + sum(orig[c] - B for c in ctx)
                new = warp(C + (orig[kb.name] - B)) - warp(C) + fB
                contextual.append(kb.name)
            else:
                new = warp(orig[kb.name])
            _set_local(kb.data, _to_local(new, m))
    after = warp(before)
    _set_local(me.vertices, _to_local(after, m))
    me.update()
    moved = float(np.linalg.norm(after - before, axis=1).max()) if len(before) else 0.0
    return {"verts": len(before), "keys": len(me.shape_keys.key_blocks) - 1 if me.shape_keys else 0,
            "contextual_keys": contextual, "max_move_mm": round(moved * 1000, 2)}


def split_by_side(P: np.ndarray) -> list[np.ndarray]:
    """Grupos rígidos dos olhos: um por lado (x<0 / x>0)."""
    return [np.where(P[:, 0] < 0)[0], np.where(P[:, 0] >= 0)[0]]


def _similarity(J: np.ndarray) -> np.ndarray:
    """Similaridade mais próxima de J (rotação da decomposição polar × escala uniforme)."""
    U_, S, Vt = np.linalg.svd(J)
    R = U_ @ Vt
    if np.linalg.det(R) < 0:
        U_[:, -1] *= -1
        R = U_ @ Vt
    return R * float(S.mean())


def warp_rigid_groups(ob, warp: Warp, groups: list[np.ndarray]) -> dict:
    """Cada grupo (globo + córnea de um lado) recebe a SIMILARIDADE local de f no seu centro c:
    p → f(c) + s·R·(p − c) (translação + escala uniforme, nunca deformação), em todas as key blocks.
    Relata a não-rigidez: quanto f se afastaria dessa similaridade sobre os vértices do grupo."""
    m = _mat(ob)
    me = ob.data
    base = mesh_world_coords(ob)
    report, maps = [], []
    for idx in groups:
        if len(idx) == 0:
            maps.append(None)
            continue
        c = (base[idx].min(0) + base[idx].max(0)) / 2
        fc = warp(c[None, :])[0]
        A = _similarity(warp.jacobian(c[None, :])[0])
        maps.append((c, fc, A))
        nonrigid = np.linalg.norm(warp(base[idx]) - (fc[None, :] + (base[idx] - c[None, :]) @ A.T), axis=1).max()
        report.append({"center": [round(float(v), 4) for v in c], "translation_mm": [round(float(v) * 1000, 3) for v in fc - c],
                       "scale": round(float(np.cbrt(np.linalg.det(A))), 4), "nonrigidity_mm": round(float(nonrigid) * 1000, 4)})
    blocks = list(me.shape_keys.key_blocks) if me.shape_keys else []
    for data in [kb.data for kb in blocks] + [me.vertices]:
        co = np.empty(len(data) * 3)
        data.foreach_get("co", co)
        P = _to_world(co.reshape(-1, 3), m)
        for idx, mp in zip(groups, maps):
            if mp is None:
                continue
            c, fc, A = mp
            P[idx] = fc[None, :] + (P[idx] - c[None, :]) @ A.T
        _set_local(data, _to_local(P, m))
    me.update()
    return {"groups": report}


def warp_armature(rig_ob, warp: Warp) -> dict:
    """Move cabeça/cauda de cada osso (modo edição) por f; realinha o roll ao Z transportado por J.
    Objetos filhos de osso mantêm a posição de mundo."""
    bone_children = [(o, o.matrix_world.copy()) for o in bpy.data.objects
                     if o.parent == rig_ob and o.parent_type == "BONE"]
    M = rig_ob.matrix_world.copy()
    Minv = M.inverted()
    prev_active = bpy.context.view_layer.objects.active
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    bpy.context.view_layer.objects.active = rig_ob
    rig_ob.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    moved = {}
    ebones = rig_ob.data.edit_bones
    plan = []
    for eb in ebones:
        h = np.array(M @ eb.head)
        t = np.array(M @ eb.tail)
        z_axis = np.array((M.to_3x3() @ eb.z_axis).normalized())
        mid = (h + t) / 2
        J = warp.jacobian(mid[None, :])[0]
        nh, nt = warp(np.stack([h, t]))
        nz = J @ z_axis
        plan.append((eb.name, nh, nt, nz, h))
    for name, nh, nt, nz, h in plan:
        eb = ebones[name]
        if eb.use_connect and eb.parent is not None:
            pass  # cabeça = cauda do pai (já transformada de forma consistente)
        eb.head = Minv @ Vector(nh)
        eb.tail = Minv @ Vector(nt)
        eb.align_roll((Minv.to_3x3() @ Vector(nz)).normalized())
        moved[name] = round(float(np.linalg.norm(nh - h)) * 1000, 2)
    bpy.ops.object.mode_set(mode="OBJECT")
    for o, mw in bone_children:
        o.matrix_world = mw
    bpy.context.view_layer.objects.active = prev_active
    return {"bones": len(plan), "max_joint_move_mm": max(moved.values()) if moved else 0.0, "moved_mm": moved}


def rig_meshes(rig_ob) -> list:
    """Todas as malhas do rig (filhas diretas ou de osso, recursivo)."""
    out = []

    def walk(parent):
        for o in parent.children:
            if o.type == "MESH":
                out.append(o)
            walk(o)
    walk(rig_ob)
    return sorted(out, key=lambda o: o.name)
