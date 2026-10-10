"""Etapa 02 — pele dos braços (o asset base não tem pele sob as mangas compridas da jaqueta).

Constrói, dentro do bmesh do INIA_Body (coordenadas de MUNDO), um tubo de pele por braço que parte do
anel aberto de 18 vértices do antebraço (fim da mão do asset) e sobe pelos ossos ForeArm → Arm até ficar
~3 cm por dentro da barra da manga curta da polo. O tubo é soldado ao anel (reusa os vértices da mão)
e tem UVs no retângulo uniforme de pele do atlas (u 0.69–1.0 × v 0.02–0.27). O FORMATO é anatômico
(perfis abaixo): braço cheio que afina devagar até o cotovelo, olécrano macio, antebraço cheio no terço
proximal afinando até o pulso oval; seção ovalizada por região (bíceps/tríceps, epicôndilos, plano da
palma). A etapa 03 só soma volume uniforme, alonga o braço (cotovelo mais baixo) e ajusta pulso/mão.
"""
from __future__ import annotations

import math

import bmesh
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

from common import bone_world_head

# Perfis de raio médio (m) no tamanho do asset. A etapa 03 soma ~30 % de volume radial UNIFORME ao
# braço inteiro (`arm_fullness` em warp_body.py), então o formato é decidido AQUI. Alvo final (depois
# da 03), braço de mulher adulta cheia (refs): braço na barra da manga ≈ 61 mm de raio, afinando
# devagar até o cotovelo ≈ 50 mm (sem "cintura" no cotovelo) → antebraço cheio no terço proximal
# ≈ 49 mm → pulso oval ≈ 28 × 21 mm (semieixos). Proporções de referência (antropometria feminina):
# cotovelo/braço ≈ 0,83, antebraço máx./braço ≈ 0,8, pulso/braço ≈ 0,45 (circunferências).
# Antebraço: distância ao anel (fim da mão do asset, ~6 cm acima do pulso; 0,172 m até o cotovelo).
FOREARM_PROFILE = [(0.0, None), (0.032, 0.0285), (0.062, 0.0325), (0.092, 0.0359), (0.122, 0.0380), (0.152, 0.0388), (0.25, 0.0392)]
# Braço: distância ao cotovelo (a barra da manga fica a ~0,092 m; o tubo termina ~3 cm dentro dela).
UPPER_PROFILE = [(0.0, 0.0392), (0.012, 0.0402), (0.035, 0.0431), (0.065, 0.0458), (0.092, 0.0469), (0.2, 0.0462)]
# Ovalização da seção por posição (distância ASSINADA ao cotovelo: < 0 antebraço, > 0 braço).
# Valor > 0 = mais largo frente/trás (eixo +Y do mundo no A-pose); < 0 = mais largo no plano coronal.
# Braço mais fundo que largo (bíceps/tríceps); cotovelo mais largo entre os epicôndilos; antebraço
# proximal largo no plano coronal; antebraço distal/pulso largo no plano da palma (pronado = ±Y).
OVAL_PROFILE = [(-0.30, 0.08), (-0.12, 0.05), (-0.085, 0.0), (-0.05, -0.06), (-0.01, -0.07), (0.012, -0.035),
                (0.035, 0.04), (0.065, 0.07), (0.095, 0.07), (0.13, 0.04), (0.3, 0.04)]
RING_SPACING = 0.0115
UV_RECT = (0.745, 0.075, 0.935, 0.215)  # (u0, v0, u1, v1) — miolo do retângulo uniforme


def _interp(profile, s):
    xs = [p[0] for p in profile]
    ys = [p[1] for p in profile]
    return float(np.interp(s, xs, ys))


def find_forearm_ring(bm: bmesh.types.BMesh, skin_index: int, side: str):
    """Arestas de borda (topologia soldada) do anel do antebraço do lado 'Left'/'Right'."""
    sign = 1.0 if side == "Left" else -1.0
    key = {v: (round(v.co.x, 5), round(v.co.y, 5), round(v.co.z, 5)) for v in bm.verts}
    count: dict = {}
    edge_of: dict = {}
    for f in bm.faces:
        if f.material_index != skin_index:
            continue
        for e in f.edges:
            k = frozenset((key[e.verts[0]], key[e.verts[1]]))
            count[k] = count.get(k, 0) + 1
            edge_of[k] = e
    ring_edges = []
    for k, n in count.items():
        if n != 1:
            continue
        e = edge_of[k]
        mid = (e.verts[0].co + e.verts[1].co) / 2
        if 0.40 < sign * mid.x < 0.48 and 1.075 < mid.z < 1.145:
            ring_edges.append(e)
    positions = {key[v]: v.co.copy() for e in ring_edges for v in e.verts}
    if len(positions) != 18 or len(ring_edges) != 18:
        raise RuntimeError(f"anel do antebraço {side}: esperado 18 vértices/arestas, achei {len(positions)}/{len(ring_edges)}")
    return ring_edges, positions, key


def _frame(d: Vector, ref: Vector) -> tuple[Vector, Vector]:
    u = (ref - d * ref.dot(d)).normalized()
    return u, d.cross(u).normalized()


def build_arm(bm: bmesh.types.BMesh, skin_index: int, side: str, sleeve_len: float, uv_layer, report: dict) -> list:
    """Cria o tubo do braço `side`. `sleeve_len` = distância (m) da cabeça do osso Arm até a barra da manga."""
    ring_edges, positions, key = find_forearm_ring(bm, skin_index, side)
    pts = np.array([p[:] for p in positions.values()])
    c0 = Vector(pts.mean(axis=0))
    _u, _s, vt = np.linalg.svd(pts - pts.mean(axis=0))
    d0 = Vector(vt[2]).normalized()
    elbow = bone_world_head(f"{side}ForeArm")
    shoulder = bone_world_head(f"{side}Arm")
    if d0.dot(elbow - c0) < 0:
        d0 = -d0
    arm_dir = (elbow - shoulder).normalized()
    end = shoulder + arm_dir * (sleeve_len - 0.03)

    # Linha central: anel → cotovelo (eixo do antebraço) → ponto final no osso Arm; cotovelo arredondado.
    fore_len = (elbow - c0).length
    up_len = (end - elbow).length
    total = fore_len + up_len
    n_rings = max(8, int(round(total / RING_SPACING)))
    ss = np.linspace(0.0, total, n_rings + 1)

    def center(s: float) -> Vector:
        if s <= fore_len:
            t = s / fore_len
            # começa na direção normal do anel e converge para o eixo do osso
            base = c0.lerp(elbow, t)
            bend = (d0 * fore_len * t - (elbow - c0) * t) * (1 - t) * 0.5 * math.exp(-4 * t)
            p = base + bend
        else:
            p = elbow.lerp(end, (s - fore_len) / up_len)
        # arredonda o cotovelo (média com vizinhança de ±2 cm)
        return p

    raw = [center(s) for s in ss]
    cl = []
    for i, p in enumerate(raw):
        s = ss[i]
        w = math.exp(-((s - fore_len) / 0.02) ** 2) * 0.5
        if 0 < i < len(raw) - 1:
            p = p.lerp((raw[i - 1] + raw[i + 1]) / 2, w)
        cl.append(p)

    # Ângulos das colunas = ângulos dos vértices do anel no referencial do anel.
    ref = Vector(pts[0]) - c0
    u0, v0 = _frame(d0, ref)
    cols = []
    for k, p in positions.items():
        rel = p - c0
        cols.append((math.atan2(rel.dot(v0), rel.dot(u0)), rel.length, k, (rel - d0 * rel.dot(d0)).length))
    cols.sort()
    angles = [c[0] for c in cols]
    ring_r = [c[3] for c in cols]
    col_of_key = {c[2]: i for i, c in enumerate(cols)}
    mean_r0 = float(np.mean(ring_r))

    # "Para trás" do braço no mundo = +Y (costas); usado para o olécrano (bico do cotovelo).
    back = Vector((0.0, 1.0, 0.0))
    rings = []
    u_prev = u0
    tangent_prev = d0
    for k in range(1, n_rings + 1):
        s = ss[k]
        a = cl[k - 1]
        b = cl[k + 1] if k + 1 < len(cl) else cl[k] + (cl[k] - cl[k - 1])
        tangent = (b - a).normalized()
        # transporte paralelo do referencial
        rot = tangent_prev.rotation_difference(tangent)
        u_k = (rot @ u_prev)
        u_k, v_k = _frame(tangent, u_k)
        u_prev, tangent_prev = u_k, tangent
        e = s - fore_len  # distância assinada ao cotovelo
        if s <= fore_len:
            target = _interp([(p[0], p[1] if p[1] is not None else mean_r0) for p in FOREARM_PROFILE], s)
        else:
            target = _interp(UPPER_PROFILE, e)
        oval = _interp(OVAL_PROFILE, e)
        # o formato do anel da mão some em ~5 cm (smoothstep); depois só a seção anatômica
        t_b = min(1.0, s / 0.05)
        blend = t_b * t_b * (3 - 2 * t_b)
        back_k = (back - tangent * back.dot(tangent)).normalized()
        g_el = math.exp(-(e / 0.016) ** 2)
        g_tri = math.exp(-((e - 0.055) / 0.035) ** 2) if e > 0 else 0.0
        g_bi = math.exp(-((e - 0.075) / 0.03) ** 2) if e > 0 else 0.0
        ring = []
        for i, ang in enumerate(angles):
            radial = (u_k * math.cos(ang) + v_k * math.sin(ang)).normalized()
            shape_ring = ring_r[i] / mean_r0
            c2 = 2.0 * radial.dot(back_k) ** 2 - 1.0  # cos(2φ) com φ medido a partir de "trás"
            r = target * ((1 - blend) * shape_ring + blend * (1.0 + oval * c2))
            facing = radial.dot(back)
            # olécrano macio (atrás) e dobra do cotovelo (frente)
            r += g_el * (0.0022 * max(0.0, facing) ** 3 - 0.0010 * max(0.0, -facing) ** 2)
            # tríceps/tecido macio atrás e bíceps à frente, suaves (só no braço)
            r += g_tri * 0.0016 * max(0.0, facing) ** 1.5 + g_bi * 0.0010 * max(0.0, -facing) ** 2
            ring.append(cl[k] + radial * r)
        rings.append(ring)

    # Vértices novos
    new_verts = []
    ring_bm = []
    for ring in rings:
        vs = [bm.verts.new(p) for p in ring]
        ring_bm.append(vs)
        new_verts.extend(vs)
    bm.verts.ensure_lookup_table()

    n = len(angles)
    faces = []
    u_a, v_a, u_b, v_b = UV_RECT

    def uv_of(col: float, s: float) -> tuple[float, float]:
        return (u_a + (u_b - u_a) * col / n, v_a + (v_b - v_a) * s / total)

    # Anel 0 (mão) → anel 1 : usa as arestas de borda reais (respeita duplicatas de costura)
    for e in ring_edges:
        va, vb = e.verts
        ia, ib = col_of_key[key[va]], col_of_key[key[vb]]
        quad = [va, vb, ring_bm[0][ib], ring_bm[0][ia]]
        ua, ub = ia, ib
        if ia == 0 and ib == n - 1:
            ua = n
        if ib == 0 and ia == n - 1:
            ub = n
        faces.append((bm.faces.new(quad), [(ua, 0.0), (ub, 0.0), (ub, ss[1]), (ua, ss[1])]))
    for k in range(len(ring_bm) - 1):
        for i in range(n):
            j = (i + 1) % n
            quad = [ring_bm[k][i], ring_bm[k][j], ring_bm[k + 1][j], ring_bm[k + 1][i]]
            faces.append((bm.faces.new(quad), [(i, ss[k + 1]), (i + 1 if j else n, ss[k + 1]), (i + 1 if j else n, ss[k + 2]), (i, ss[k + 2])]))
    # tampa (fica dentro da manga)
    cap_center = bm.verts.new(cl[-1] + (cl[-1] - cl[-2]).normalized() * 0.006)
    new_verts.append(cap_center)
    for i in range(n):
        j = (i + 1) % n
        tri = [ring_bm[-1][i], ring_bm[-1][j], cap_center]
        faces.append((bm.faces.new(tri), [(i, total), (i + 1 if j else n, total), (i + 0.5, total)]))

    # Orientação: normais para fora da linha central; UVs por canto
    for f, uvspec in faces:
        f.material_index = skin_index
        f.smooth = True
        f.normal_update()
        centre = f.calc_center_median()
        nearest = min(cl, key=lambda p: (p - centre).length)
        by_vert = {v: uv_of(col, s) for v, (col, s) in zip(list(f.verts), uvspec)}
        if f.normal.dot(centre - nearest) < 0:
            f.normal_flip()
        for loop in f.loops:
            loop[uv_layer].uv = by_vert[loop.vert]

    ring_verts = list({v for e in ring_edges for v in e.verts})
    report[f"arm_{side}"] = {
        "rings": n_rings, "faces": len(faces), "ring_radius_mm": round(mean_r0 * 1000, 1),
        "length_m": round(total, 3), "elbow_r_mm": round(_interp(FOREARM_PROFILE[1:], fore_len) * 1000, 1),
    }
    return new_verts, ring_verts, [f for f, _ in faces]


def interpolate_weights_from(bm: bmesh.types.BMesh, targets: list, src_bm: bmesh.types.BMesh, src_tree: BVHTree, deform_layer, src_deform) -> None:
    """Pesos dos vértices `targets` = interpolação baricêntrica dos pesos da face mais próxima da fonte."""
    from mathutils.geometry import intersect_point_tri
    src_bm.faces.ensure_lookup_table()
    for v in targets:
        loc, _n, fi, _d = src_tree.find_nearest(v.co)
        face = src_bm.faces[fi]
        verts = face.verts[:]
        pts = [x.co for x in verts]
        if len(pts) >= 3:
            ws = np.array([1.0 / ((p - loc).length + 1e-5) for p in pts])
            ws /= ws.sum()
            if len(pts) == 3:
                a, b, c = pts
                v0, v1, v2 = b - a, c - a, loc - a
                d00, d01, d11 = v0.dot(v0), v0.dot(v1), v1.dot(v1)
                d20, d21 = v2.dot(v0), v2.dot(v1)
                den = d00 * d11 - d01 * d01
                if abs(den) > 1e-12:
                    bv = (d11 * d20 - d01 * d21) / den
                    bw = (d00 * d21 - d01 * d20) / den
                    bu = 1 - bv - bw
                    ws = np.clip(np.array([bu, bv, bw]), 0, 1)
                    ws /= ws.sum()
        acc: dict[int, float] = {}
        for sv, w in zip(verts, ws):
            for g, gw in sv[src_deform].items():
                acc[g] = acc.get(g, 0.0) + w * gw
        dv = v[deform_layer]
        dv.clear()
        top = sorted(acc.items(), key=lambda kv: -kv[1])[:4]
        tot = sum(w for _g, w in top) or 1.0
        for g, w in top:
            if w / tot > 1e-3:
                dv[g] = w / tot
