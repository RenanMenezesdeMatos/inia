"""Etapa 02 — gola polo (pé + colarinho com pontas), carcela e botões (parte do INIA_Polo).

Coordenadas de MUNDO. A gola segue o laço do decote da polo (V esquerdo ↑ nuca ↓ V direito), com o
pé subindo pelo pescoço e o colarinho dobrado para fora deitando sobre ombros/peito (colisão com a
polo). As pontas ficam na frente, apontando para baixo e um pouco para fora, como nas referências.
"""
from __future__ import annotations

import math

import bmesh
from mathutils import Vector
from mathutils.bvhtree import BVHTree

Z = Vector((0, 0, 1))


def thick_grid(bm, P: list[list[Vector]], thickness: float, side: Vector | None, uv_layer, uv_of, mat: int) -> list:
    """Placa com espessura a partir da grade P (linhas × colunas). A face "de cima" fica voltada para o
    lado oposto de `side` (se dado) e a espessura cresce na direção de `side`."""
    rows, cols = len(P), len(P[0])
    top = [[bm.verts.new(p) for p in row] for row in P]
    # normais da grade (média dos quads vizinhos)
    def quad_n(i, j):
        a, b, c = P[i][j], P[i][j + 1], P[i + 1][j]
        return (b - a).cross(c - a)
    N = [[Vector() for _ in range(cols)] for _ in range(rows)]
    for i in range(rows - 1):
        for j in range(cols - 1):
            q = quad_n(i, j)
            for a, b in ((i, j), (i, j + 1), (i + 1, j), (i + 1, j + 1)):
                N[a][b] += q
    flip = False
    if side is not None:
        avg = sum((n for row in N for n in row), Vector())
        flip = avg.dot(side) > 0  # normal da grade deve apontar para longe de `side`
    for i in range(rows):
        for j in range(cols):
            n = N[i][j].normalized() if N[i][j].length > 1e-12 else Vector((0, 0, 1))
            N[i][j] = -n if flip else n
    bot = [[bm.verts.new(P[i][j] - N[i][j] * thickness) for j in range(cols)] for i in range(rows)]
    faces = []

    def add(vs, uvs, out_dir):
        f = bm.faces.new(vs)
        f.material_index = mat
        f.smooth = True
        for loop, uv in zip(f.loops, uvs):
            loop[uv_layer].uv = uv
        f.normal_update()
        if f.normal.dot(out_dir) < 0:
            f.normal_flip()
        faces.append(f)

    for i in range(rows - 1):
        for j in range(cols - 1):
            nrm = N[i][j] + N[i + 1][j + 1]
            uv = [uv_of(i, j), uv_of(i, j + 1), uv_of(i + 1, j + 1), uv_of(i + 1, j)]
            add([top[i][j], top[i][j + 1], top[i + 1][j + 1], top[i + 1][j]], uv, nrm)
            add([bot[i][j], bot[i][j + 1], bot[i + 1][j + 1], bot[i + 1][j]], uv, -nrm)
    # aros (bordas da placa)
    edges = [((0, j), (0, j + 1)) for j in range(cols - 1)] + [((rows - 1, j), (rows - 1, j + 1)) for j in range(cols - 1)]
    edges += [((i, 0), (i + 1, 0)) for i in range(rows - 1)] + [((i, cols - 1), (i + 1, cols - 1)) for i in range(rows - 1)]
    center = sum((p for row in P for p in row), Vector()) / (rows * cols)
    for (a, b), (c, d) in edges:
        mid = (P[a][b] + P[c][d]) / 2
        # direção para fora da placa, no plano dela
        out = mid - center
        if a == c:  # borda de linha
            other = P[a + 1][b] if a + 1 < rows else P[a - 1][b]
            out = mid - other
        else:
            other = P[a][b + 1] if b + 1 < cols else P[a][b - 1]
            out = mid - other
        uv = [uv_of(a, b), uv_of(c, d), uv_of(c, d), uv_of(a, b)]
        add([top[a][b], top[c][d], bot[c][d], bot[a][b]], uv, out)
    return faces


def resample(points: list[Vector], count: int) -> list[Vector]:
    lengths = [0.0]
    for a, b in zip(points, points[1:]):
        lengths.append(lengths[-1] + (b - a).length)
    total = lengths[-1]
    out = []
    k = 0
    for i in range(count):
        s = total * i / (count - 1)
        while k < len(lengths) - 2 and lengths[k + 1] < s:
            k += 1
        t = (s - lengths[k]) / max(lengths[k + 1] - lengths[k], 1e-9)
        out.append(points[k].lerp(points[k + 1], t))
    return out


def push_out(tree: BVHTree, p: Vector, clearance: float, max_dist: float = 0.06) -> Vector:
    loc, nrm, _i, _d = tree.find_nearest(p, max_dist)
    if loc is None:
        return p
    out = (p - loc).dot(nrm)
    return p + nrm * (clearance - out) if out < clearance else p


def neck_curve(loop_verts: list, apex_z: float) -> list[Vector]:
    """Ordena o laço do decote começando no vértice do V (ápice), pela esquerda (x<0) primeiro."""
    pts = [v.co.copy() for v in loop_verts]
    i0 = min(range(len(pts)), key=lambda i: (abs(pts[i].x), pts[i].z))
    pts = pts[i0:] + pts[:i0]
    if pts[1].x > 0:
        pts = [pts[0]] + pts[1:][::-1]
    return pts + [pts[0]]


def _smooth01(x: float) -> float:
    x = min(1.0, max(0.0, x))
    return x * x * (3 - 2 * x)


def _snap(trees: list[tuple[BVHTree, Vector | None]], p: Vector, offset: float) -> Vector:
    """Encosta `p` na superfície mais próxima entre `trees` (lado de fora), afastado `offset`."""
    best = None
    for tree, outward in trees:
        loc, nrm, _i, dist = tree.find_nearest(p, 0.08)
        if loc is None:
            continue
        if outward is not None and nrm.dot(outward) < 0:
            nrm = -nrm
        if best is None or dist < best[2]:
            best = (loc, nrm, dist)
    return p if best is None else best[0] + best[1] * offset


def build_collar(bm, uv_layer, curve: list[Vector], polo_tree: BVHTree, skin_tree: BVHTree, rib_mat: int,
                 cols: int = 48, neck_y: float = 0.045, h_back: float = 0.021, h_end: float = 0.005,
                 w_back: float = 0.033, w_tip: float = 0.056, thickness: float = 0.0025) -> dict:
    pts = resample(curve, cols)
    stand, info = [], []
    for k, p in enumerate(pts):
        s = k / (cols - 1)
        r = Vector((p.x, p.y - neck_y, 0)).normalized()
        a = abs(math.atan2(p.x, -(p.y - neck_y)))           # 0 = frente, π = nuca
        front = 1 - _smooth01(a / (0.62 * math.pi))          # 1 no V, 0 dos lados para trás
        h = h_end + (h_back - h_end) * (1 - front)
        u = (Z - r * 0.12).normalized()
        base = p - r * 0.0015 - Z * 0.004
        top = push_out(skin_tree, p + u * h + r * 0.001, 0.004)
        stand.append([base, p.lerp(top, 0.5) + r * 0.0005, top])
        lat = Vector((1.0 if (p.x > 0 or (abs(p.x) < 1e-4 and s > 0.5)) else -1.0, 0, 0))
        info.append((r, front, lat))
    S = [[stand[j][i] for j in range(cols)] for i in range(3)]
    stand_faces = thick_grid(bm, S, thickness, None, uv_layer, lambda i, j: (j * 0.35, i * 0.4), rib_mat)
    tmp = bmesh.new()
    sv = [[tmp.verts.new(p) for p in row] for row in S]
    for i in range(2):
        for j in range(cols - 1):
            tmp.faces.new([sv[i][j], sv[i][j + 1], sv[i + 1][j + 1], sv[i + 1][j]])
    tmp.normal_update()
    stand_tree = BVHTree.FromBMesh(tmp)
    fall = []
    for j in range(cols):
        r, front, lat = info[j]
        top = S[2][j]
        loc, nrm, _f, _d = polo_tree.find_nearest(pts[j], 0.08)
        nrm = nrm if nrm is not None else r
        tip = front ** 1.5
        w = w_back + (w_tip - w_back) * tip
        d = -Z + r * 0.35 + lat * 0.5 * tip
        d = (d - nrm * d.dot(nrm)).normalized()
        fold = top + r * 0.0035 + Z * 0.0015
        rows = [fold]
        for t in (0.3, 0.62, 1.0):
            q = fold + d * w * t
            q = _snap([(polo_tree, (r + Z).normalized()), (stand_tree, r)], q, 0.0042 - 0.0012 * t)
            rows.append(q)
        fall.append(rows)
    tmp.free()
    for _ in range(3):  # borda do colarinho sem serrilhado (média ao longo do decote)
        for i in (1, 2, 3):
            new = [fall[j][i] if j in (0, cols - 1) else (fall[j - 1][i] + fall[j][i] * 2 + fall[j + 1][i]) / 4 for j in range(cols)]
            for j in range(cols):
                fall[j][i] = new[j]
    F = [[fall[j][i] for j in range(cols)] for i in range(4)]
    fall_faces = thick_grid(bm, F, thickness, None, uv_layer, lambda i, j: (j * 0.35, 1.0 + i * 0.5), rib_mat)
    return {"stand_faces": stand_faces, "fall_faces": fall_faces, "cols": cols}


def surface_strip(tree: BVHTree, center: Vector, normal: Vector, up: Vector, width: float, height: float,
                  rows: int, cols: int, offset: float) -> list[list[Vector]]:
    n = normal.normalized()
    up = (up - n * up.dot(n)).normalized()
    right = up.cross(n)
    P = []
    for i in range(rows):
        y = (i / (rows - 1) - 0.5) * height
        row = []
        for j in range(cols):
            p = center + right * ((j / (cols - 1) - 0.5) * width) + up * y
            hit = tree.ray_cast(p + n * 0.05, -n, 0.1)
            if hit[0] is None:
                raise RuntimeError("carcela fora da polo")
            hn = hit[1] if hit[1].dot(n) > 0 else -hit[1]
            row.append(hit[0] + hn * offset)
        P.append(row)
    return P


def build_button(bm, uv_layer, center: Vector, normal: Vector, radius: float = 0.0052, thickness: float = 0.0024,
                 segments: int = 12, mat: int = 0) -> list:
    n = normal.normalized()
    a = Vector((1, 0, 0)) if abs(n.x) < 0.9 else Vector((0, 0, 1))
    u = (a - n * a.dot(n)).normalized()
    w = n.cross(u)
    faces = []
    rings = []
    for rr, z in ((radius * 0.72, thickness), (radius, thickness * 0.7), (radius, 0.0)):
        rings.append([bm.verts.new(center + (u * math.cos(2 * math.pi * k / segments) + w * math.sin(2 * math.pi * k / segments)) * rr + n * z) for k in range(segments)])
    top = bm.verts.new(center + n * thickness * 0.85)  # leve concavidade no centro
    for k in range(segments):
        j = (k + 1) % segments
        quads = [[top, rings[0][k], rings[0][j]], [rings[0][k], rings[1][k], rings[1][j], rings[0][j]],
                 [rings[1][k], rings[2][k], rings[2][j], rings[1][j]]]
        for vs in quads:
            f = bm.faces.new(vs)
            f.material_index = mat
            f.smooth = True
            f.normal_update()
            c = f.calc_center_median()
            if f.normal.dot(c - (center - n * 0.001)) < 0:
                f.normal_flip()
            for loop in f.loops:
                loop[uv_layer].uv = (0.5, 0.5)
            faces.append(f)
    return faces
