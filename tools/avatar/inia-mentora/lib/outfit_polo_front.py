"""Etapa 02 — polo: fechamento da frente (a jaqueta era aberta), decote em V curto e barra estendida.

Coordenadas de MUNDO. A frente é fechada por uma faixa de quads entre as bordas esquerda e direita da
jaqueta (a malha é simétrica: a borda direita é o espelho da esquerda). Acima de `z_v` a faixa só é
construída pela metade de cada lado, deixando o V aberto (meia-largura `w(z)` crescente), como o
colarinho aberto das referências. A barra curta da jaqueta é prolongada em anéis até dentro do cinto.
"""
from __future__ import annotations

import math

import bmesh
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

from outfit_polo import TORSO_AXIS_Y, boundary_loops, mirror_partner

H = 4  # colunas por metade da faixa da frente


def fill_small_holes(bm: bmesh.types.BMesh, max_sides: int = 12) -> int:
    filled = 0
    for lp in boundary_loops(bm):
        if len(lp) <= max_sides:
            bmesh.ops.contextual_create(bm, geom=[e for e in bm.edges if e.is_boundary and e.verts[0] in lp and e.verts[1] in lp])
            filled += 1
    return filled


def _mix_weights(dl, a, b, t: float) -> dict:
    acc: dict = {}
    for g, w in a[dl].items():
        acc[g] = acc.get(g, 0.0) + (1 - t) * w
    for g, w in b[dl].items():
        acc[g] = acc.get(g, 0.0) + t * w
    return acc


def _set_weights(v, dl, acc: dict) -> None:
    top = sorted(acc.items(), key=lambda kv: -kv[1])[:4]
    tot = sum(w for _g, w in top) or 1.0
    dv = v[dl]
    dv.clear()
    for g, w in top:
        if w / tot > 1e-3:
            dv[g] = w / tot


def front_y_of(tree: BVHTree | None, x: float, z: float) -> float | None:
    """y da superfície mais à frente dos proxies (raio vindo da frente)."""
    if tree is None:
        return None
    hit = tree.ray_cast(Vector((x, -0.4, z)), Vector((0, 1, 0)), 0.6)
    return hit[0].y if hit[0] is not None else None


def front_edge_chain(main: list, z_hem: float) -> list:
    """Borda esquerda da frente, do canto da barra subindo até o pescoço (ordem do laço)."""
    hem_left = [i for i, v in enumerate(main) if abs(v.co.z - z_hem) < 1e-4 and v.co.x < 0 and v.co.y < -0.05]
    if not hem_left:
        raise RuntimeError("canto esquerdo da barra não encontrado")
    start = max(hem_left, key=lambda i: main[i].co.x)
    n = len(main)
    step = 1 if main[(start + 1) % n].co.z > z_hem + 1e-4 else -1
    chain = [main[start]]
    i = start
    while True:
        i = (i + step) % n
        v = main[i]
        if v.co.z > 1.43 or v.co.y > 0.01 or v.co.x > -0.02 or len(chain) > 60:
            break
        chain.append(v)
    return chain


def close_front(bm: bmesh.types.BMesh, z_hem: float, z_v: float, v_slope: float, w0: float,
                proxy_tree: BVHTree | None, ease: float = 0.004) -> dict:
    """Fecha a frente. Linhas = vértices da borda esquerda (z crescente); colunas 0..2H (H = centro)."""
    dl = bm.verts.layers.deform.verify()
    main = boundary_loops(bm)[0]
    left = front_edge_chain(main, z_hem)
    # a borda da jaqueta tem uma aba/dobra (degrau de ~5 mm em y): alinha com os vizinhos (e o espelho)
    for _ in range(2):
        for i in range(1, len(left) - 1):
            v = left[i]
            avg_y = (left[i - 1].co.y + left[i + 1].co.y) / 2
            if abs(v.co.y - avg_y) > 0.0015 and v.co.z < 1.3:
                r, _d = mirror_partner(main, v)
                v.co.y = avg_y
                r.co.y = avg_y
    rows = []
    last_z = -1.0
    for v in left:
        r, dist = mirror_partner(main, v)
        if dist > 2e-4:
            raise RuntimeError(f"borda da frente sem par espelhado ({dist:.5f} m)")
        if v.co.z - last_z < 0.0035 and v.co.z < 1.3:
            # linha quase coincidente com a anterior (dobra da borda): afasta um pouco (sem lâmina)
            v.co.z = r.co.z = last_z + 0.0035
        last_z = v.co.z
        half = -v.co.x
        w = 0.0 if v.co.z <= z_v else w0 + (v.co.z - z_v) * v_slope
        if half - w < 0.006:
            break
        rows.append((v, r, w))
    if len(rows) < 6:
        raise RuntimeError("frente: poucas linhas para fechar")

    grid = []
    for (lv, rv, w) in rows:
        row = {0: lv, 2 * H: rv}
        half = -lv.co.x
        for j in range(1, 2 * H):
            if w > 0 and j == H:
                continue
            if w == 0:
                x = -half + (2 * half) * j / (2 * H)
            elif j < H:
                x = -half + (half - w) * j / (H - 1)
            else:
                x = w + (half - w) * (j - H - 1) / (H - 1)
            y = lv.co.y
            fy = front_y_of(proxy_tree, x, lv.co.z)
            if fy is not None:
                y = min(y, fy - ease)
            nv = bm.verts.new((x, y, lv.co.z))
            _set_weights(nv, dl, _mix_weights(dl, lv, rv, (x + half) / (2 * half)))
            row[j] = nv
        grid.append(row)

    faces = []

    def add(vs):
        f = bm.faces.new(vs)
        f.smooth = True
        faces.append(f)

    for i in range(len(grid) - 1):
        a, b = grid[i], grid[i + 1]
        for j in range(2 * H):
            if j in a and j + 1 in a and j in b and j + 1 in b:
                add([a[j], a[j + 1], b[j + 1], b[j]])
        if H in a and H not in b:  # transição fechado → aberto (ponta do V)
            add([a[H - 1], a[H], b[H - 1]])
            add([a[H], a[H + 1], b[H + 1]])
    # orientação: normais para −Y (frente)
    for f in faces:
        f.normal_update()
        if f.normal.y > 0:
            f.normal_flip()
    return {"rows": len(grid), "faces": len(faces), "v_bottom_z": round(next((r[0].co.z for r in rows if r[2] > 0), 0.0), 4),
            "new_verts": [v for row in grid for j, v in row.items() if j not in (0, 2 * H)], "faces_list": faces}


def smooth_region(bm: bmesh.types.BMesh, verts: list, iterations: int = 6, factor: float = 0.5) -> None:
    """Laplaciano só nos `verts` (vizinhos fora do conjunto ficam fixos)."""
    vs = set(verts)
    for _ in range(iterations):
        new = {}
        for v in vs:
            nb = [e.other_vert(v) for e in v.link_edges]
            if len(nb) < 3 or v.is_boundary:
                continue
            avg = sum((n.co for n in nb), Vector()) / len(nb)
            new[v] = v.co.lerp(avg, factor)
        for v, co in new.items():
            v.co = co


def hem_ring(bm: bmesh.types.BMesh, z_hem: float) -> list:
    for lp in boundary_loops(bm):
        if all(abs(v.co.z - z_hem) < 2e-3 for v in lp):
            return sorted(lp, key=lambda v: math.atan2(v.co.x, -(v.co.y - TORSO_AXIS_Y)))
    raise RuntimeError("anel da barra não encontrado (a frente foi fechada?)")


def outer_radius(tree: BVHTree, theta: float, z: float) -> float | None:
    d = Vector((math.sin(theta), -math.cos(theta), 0.0))
    origin = Vector((0.0, TORSO_AXIS_Y, z)) + d * 0.45
    hit = tree.ray_cast(origin, -d, 0.45)
    if hit[0] is None:
        return None
    return (hit[0] - Vector((0.0, TORSO_AXIS_Y, z))).length


def extend_hem(bm: bmesh.types.BMesh, z_hem: float, levels: list[tuple[float, float]], proxy_tree: BVHTree,
               src_interp) -> list:
    """Prolonga a barra: `levels` = [(z, folga)]. `src_interp(verts)` grava os pesos dos novos vértices."""
    ring = hem_ring(bm, z_hem)
    thetas = [math.atan2(v.co.x, -(v.co.y - TORSO_AXIS_Y)) for v in ring]
    prev = ring
    prev_r = [Vector((v.co.x, v.co.y - TORSO_AXIS_Y, 0)).length for v in ring]
    new_all = []
    for z, ease in levels:
        rs = []
        for th, pr in zip(thetas, prev_r):
            r = outer_radius(proxy_tree, th, z)
            rs.append(pr if r is None else r + ease)
        rs = np.array(rs)
        for _ in range(3):  # suaviza ao longo do anel
            rs = 0.5 * rs + 0.25 * (np.roll(rs, 1) + np.roll(rs, -1))
        cur = []
        for th, r in zip(thetas, rs):
            cur.append(bm.verts.new((math.sin(th) * r, TORSO_AXIS_Y - math.cos(th) * r, z)))
        n = len(cur)
        for k in range(n):
            f = bm.faces.new([prev[k], prev[(k + 1) % n], cur[(k + 1) % n], cur[k]])
            f.smooth = True
            f.normal_update()
            c = f.calc_center_median()
            if f.normal.dot(Vector((c.x, c.y - TORSO_AXIS_Y, 0))) < 0:
                f.normal_flip()
        prev, prev_r = cur, list(rs)
        new_all += cur
    src_interp(new_all)
    return new_all
