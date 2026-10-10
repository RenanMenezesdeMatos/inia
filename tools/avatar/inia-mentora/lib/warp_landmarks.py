"""Marcos anatômicos medidos no modelo em tempo de execução (ossos + malha), em MUNDO.

Nada aqui usa índices de vértice fixos: tudo sai de ossos com nome Mixamo, da ilha de pele da cabeça
(maior componente soldada por posição), do perfil da linha média e dos olhos (INIA_Eyes).
Unidade de rosto U = distância vertical olhos→queixo (igual à usada pela etapa 05).
"""
from __future__ import annotations

import bpy
import numpy as np

from common import EYES, HEAD, RIG, bone_world_head, bone_world_tail
from warp_apply import key_world_coords, mesh_world_coords


def _islands(ob, P: np.ndarray) -> np.ndarray:
    """Rótulo de componente conexa por vértice, soldando vértices coincidentes (costuras de UV)."""
    me = ob.data
    key = np.round(P, 6)
    _, inv = np.unique(key, axis=0, return_inverse=True)
    inv = inv.ravel()
    parent = np.arange(inv.max() + 1)

    def find(a: int) -> int:
        root = a
        while parent[root] != root:
            root = parent[root]
        while parent[a] != root:
            parent[a], a = root, parent[a]
        return root

    ev = np.empty(len(me.edges) * 2, dtype=np.int64)
    me.edges.foreach_get("vertices", ev)
    for a, b in inv[ev.reshape(-1, 2)]:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb
    return np.array([find(i) for i in inv])


def _boundary_ring(ob, mask: np.ndarray) -> np.ndarray:
    """Vértices de borda aberta (arestas com uma face) dentro da máscara."""
    me = ob.data
    count = np.zeros(len(me.edges), dtype=np.int64)
    ek = {tuple(sorted(e.vertices)): e.index for e in me.edges}
    for p in me.polygons:
        for k in p.edge_keys:
            count[ek[k]] += 1
    ring = set()
    for e in me.edges:
        if count[e.index] == 1 and mask[e.vertices[0]] and mask[e.vertices[1]]:
            ring.update(e.vertices)
    return np.array(sorted(ring), dtype=np.int64)


def _midline_segments(ob, P: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """Segmentos (y0, z0, y1, z1) das arestas da pele que estão no plano x = 0 (malha simétrica)."""
    ev = np.empty(len(ob.data.edges) * 2, dtype=np.int64)
    ob.data.edges.foreach_get("vertices", ev)
    ev = ev.reshape(-1, 2)
    A, B = P[ev[:, 0]], P[ev[:, 1]]
    on = mask[ev[:, 0]] & mask[ev[:, 1]] & (np.abs(A[:, 0]) < 2e-4) & (np.abs(B[:, 0]) < 2e-4)
    if on.sum() < 20:
        raise RuntimeError("marcos: a cabeça não tem laço de arestas na linha média (x = 0)")
    return np.c_[A[on][:, 1:], B[on][:, 1:]]


def _front_profile(seg: np.ndarray, z_lo: float, z_hi: float, step: float = 0.0005) -> np.ndarray:
    """Perfil da linha média: para cada z, o y mais à frente (menor y) entre os segmentos cruzados."""
    y0, z0, y1, z1 = seg.T
    rows = []
    for z in np.arange(z_lo, z_hi, step):
        c = (z0 - z) * (z1 - z) <= 0
        if not c.any():
            continue
        dz = np.where(np.abs(z1[c] - z0[c]) < 1e-9, 1e-9, z1[c] - z0[c])
        y = y0[c] + (y1[c] - y0[c]) * np.clip((z - z0[c]) / dz, 0, 1)
        rows.append((z, y.min()))
    return np.array(rows)


def _local_extreme(prof: np.ndarray, z_lo: float, z_hi: float, kind: str) -> tuple[float, float]:
    s = (prof[:, 0] >= z_lo) & (prof[:, 0] <= z_hi)
    seg = prof[s]
    i = np.argmin(seg[:, 1]) if kind == "front" else np.argmax(seg[:, 1])
    return float(seg[i, 0]), float(seg[i, 1])


def face_landmarks() -> dict:
    head = bpy.data.objects[HEAD]
    eyes = bpy.data.objects[EYES]
    P = mesh_world_coords(head)
    labels = _islands(head, P)
    ids, counts = np.unique(labels, return_counts=True)
    skin_mask = labels == ids[np.argmax(counts)]
    skin = P[skin_mask]

    E = mesh_world_coords(eyes)
    centers, radii = [], []
    for side in (-1, 1):
        sel = E[E[:, 0] * side > 0]
        lo, hi = sel.min(0), sel.max(0)
        centers.append((lo + hi) / 2)
        radii.append(float((hi[0] - lo[0]) / 2))
    eye_r, eye_l = centers  # r = lado −X (direito da personagem)
    eye = (eye_l + eye_r) / 2
    io = float(eye_l[0] - eye_r[0])

    mid = skin[np.abs(skin[:, 0]) < 0.004]
    chin_cand = mid[(mid[:, 1] < eye[1] - 0.013) & (mid[:, 2] < eye[2])]
    chin_z = float(chin_cand[:, 2].min())
    U = float(eye[2] - chin_z)
    prof = _front_profile(_midline_segments(head, P, skin_mask), chin_z - 0.002, eye[2])
    nose_z, nose_y = _local_extreme(prof, eye[2] - 0.6 * U, eye[2] - 0.1 * U, "front")
    subn_z, subn_y = _local_extreme(prof, nose_z - 0.20 * U, nose_z - 0.06 * U, "back")
    ulip_z, ulip_y = _local_extreme(prof, subn_z - 0.12 * U, subn_z - 0.02 * U, "front")
    slit_z, slit_y = _local_extreme(prof, ulip_z - 0.15 * U, ulip_z - 0.03 * U, "back")   # rima labial
    llip_z, llip_y = _local_extreme(prof, slit_z - 0.12 * U, slit_z - 0.01 * U, "front")
    sulc_z, sulc_y = _local_extreme(prof, llip_z - 0.18 * U, llip_z - 0.05 * U, "back")   # sulco mentolabial
    pog_z, pog_y = _local_extreme(prof, chin_z + 0.05 * U, sulc_z - 0.01 * U, "front")    # ponta do queixo

    # cantos da boca: o vértice que mouthPucker mais puxa para o centro (comissura), por lado
    keys = key_world_coords(head)
    corners = []
    if "mouthPucker" in keys:
        dx = keys["mouthPucker"][:, 0] - keys["Basis"][:, 0]
        for side in (-1, 1):
            cand = np.where(skin_mask & (P[:, 0] * side > 0.004) & (np.abs(P[:, 2] - slit_z) < 0.25 * U))[0]
            corners.append(P[cand[np.argmax(-side * dx[cand])]])
    mouth_hw = float(np.mean([abs(c[0]) for c in corners])) if corners else 0.2 * U

    # asas do nariz: maior |x| da pele à frente, entre a base do nariz e a ponta
    band = skin[(skin[:, 2] > subn_z - 0.01 * U) & (skin[:, 2] < nose_z + 0.03 * U) & (skin[:, 1] < subn_y + 0.012)
                & (np.abs(skin[:, 0]) < 0.25 * U)]
    i = int(np.argmax(np.abs(band[:, 0])))
    alae = band[i]

    # crânio / orelhas (mesmo critério da etapa 05)
    skull = skin[(skin[:, 2] > eye[2] + 0.25 * U) & (skin[:, 2] < eye[2] + 0.45 * U)]
    skull_hw = float(np.abs(skull[:, 0]).max())
    ears = skin[(np.abs(skin[:, 0]) > skull_hw + 0.003) & (skin[:, 2] < eye[2] + 0.4 * U) & (skin[:, 2] > chin_z)]

    # maçãs do rosto: ponto mais à frente da pele perto de (±0.62·IO, olhos − 0.5·U)
    apples = []
    for side in (-1, 1):
        win = skin[(np.abs(skin[:, 0] - side * 0.62 * io) < 0.006) & (np.abs(skin[:, 2] - (eye[2] - 0.5 * U)) < 0.006)]
        apples.append(win[np.argmin(win[:, 1])])

    # anel de solda cabeça-corpo: borda aberta da ilha de pele
    ring = _boundary_ring(head, skin_mask & (P[:, 2] < chin_z - 0.02))
    ring_P = P[ring] if len(ring) else np.zeros((0, 3))
    return {
        "eye_l": eye_l, "eye_r": eye_r, "eye": eye, "eye_radius": float(np.mean(radii)), "io": io,
        "chin_z": chin_z, "U": U, "nose_tip": np.array([0.0, nose_y, nose_z]),
        "subnasale": np.array([0.0, subn_y, subn_z]), "upper_lip": np.array([0.0, ulip_y, ulip_z]),
        "slit": np.array([0.0, slit_y, slit_z]), "lower_lip": np.array([0.0, llip_y, llip_z]),
        "sulcus": np.array([0.0, sulc_y, sulc_z]), "pogonion": np.array([0.0, pog_y, pog_z]),
        "mouth_corners": corners, "mouth_hw": mouth_hw, "alae": alae,
        "skull_hw": skull_hw, "ears_min": ears.min(0) if len(ears) else None, "ears_max": ears.max(0) if len(ears) else None,
        "apples": apples, "ring_z": (float(ring_P[:, 2].min()), float(ring_P[:, 2].max())) if len(ring_P) else None,
        "ring_count": int(len(ring)), "ring_positions": ring_P, "skin_verts": int(skin_mask.sum()),
    }


def _bone(name: str) -> tuple[np.ndarray, np.ndarray]:
    return np.array(bone_world_head(name)), np.array(bone_world_tail(name))


def body_landmarks() -> dict:
    """Juntas e eixos do corpo a partir dos ossos (nomes Mixamo)."""
    rig = bpy.data.objects[RIG]
    bones = rig.data.bones
    out: dict = {}
    for name in ("Hips", "Spine", "Spine1", "Spine2", "Neck", "Head"):
        out[name] = _bone(name)[0]
    out["neck_tail"] = _bone("Neck")[1]
    for side in ("Left", "Right"):
        arm = [_bone(f"{side}Arm")[0], _bone(f"{side}ForeArm")[0], _bone(f"{side}Hand")[0]]
        tips = [_bone(f"{side}Hand{f}3")[1] for f in ("Middle", "Index") if f"{side}Hand{f}3" in bones]
        out[f"{side}_arm_chain"] = arm + ([np.mean(tips, axis=0)] if tips else [_bone(f"{side}Hand")[1]])
        out[f"{side}_clavicle"] = _bone(f"{side}Shoulder")[0]
        # plano da palma (indicador → mínimo), para o volume anisotrópico de pulso e mão (warp_body)
        out[f"{side}_hand_across"] = _bone(f"{side}HandIndex1")[0] - _bone(f"{side}HandPinky1")[0]
        if f"{side}HandThumb3" in bones:
            out[f"{side}_thumb_chain"] = [_bone(f"{side}HandThumb{i}")[0] for i in (1, 2, 3)] + [_bone(f"{side}HandThumb3")[1]]
        out[f"{side}_leg_chain"] = [_bone(f"{side}UpLeg")[0], _bone(f"{side}Leg")[0], _bone(f"{side}Foot")[0],
                                   _bone(f"{side}ToeBase")[1]]
        lower = side.lower()
        if f"breast_{lower}_ph" in bones:
            out[f"{side}_breast"] = _bone(f"breast_{lower}_ph")
    spine = [out[n] for n in ("Hips", "Spine", "Spine1", "Spine2", "Neck")] + [out["neck_tail"]]
    out["spine_polyline"] = np.array(spine)
    return out


def spine_y_at(body: dict, z: np.ndarray) -> np.ndarray:
    """Profundidade (y) do eixo do tronco em cada altura, interpolando a cadeia da coluna."""
    pl = body["spine_polyline"]
    order = np.argsort(pl[:, 2])
    return np.interp(z, pl[order, 2], pl[order, 1])


def torso_surface(meshes: list, z: float, band: float = 0.006, x_max: float = 0.05) -> tuple[float, float]:
    """Frente (menor y) e costas (maior y) do tronco perto da linha média numa altura."""
    ys = []
    for ob in meshes:
        P = mesh_world_coords(ob)
        s = (np.abs(P[:, 2] - z) < band) & (np.abs(P[:, 0]) < x_max)
        if s.any():
            ys.append(P[s, 1])
    if not ys:
        return float("nan"), float("nan")
    y = np.concatenate(ys)
    return float(y.min()), float(y.max())
