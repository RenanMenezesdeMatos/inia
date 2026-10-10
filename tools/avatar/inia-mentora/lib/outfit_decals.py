"""Etapa 02 — logos "vivo" (decalques com alpha MASK) e textura do broche INIA/MENTORA.

Atlas `logo_vivo.png` (1024², branco + alpha): marca horizontal (ícone à esquerda da palavra) na faixa
de cima, marca empilhada (ícone acima da palavra) no quadrado de baixo à esquerda. Os decalques são
grades finas que seguem a superfície da polo (afastadas 1,5 mm pela normal), com os pesos da polo.
"""
from __future__ import annotations

import math

import bmesh
import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

import outfit_raster as rs
from outfit_util import save_image

SS = 4
ATLAS = 1024
# regiões (u0, v0, u1, v1) no atlas
REGION_H = (0.0, 0.625, 1.0, 1.0)     # 1024×384
REGION_S = (0.0, 0.0, 0.5, 0.5)       # 512×512


def _compose(mask_ss: np.ndarray, region, out: np.ndarray) -> None:
    cov = rs.downsample(mask_ss, SS)
    h, w = cov.shape
    u0, v0 = int(region[0] * ATLAS), int(region[1] * ATLAS)
    out[v0:v0 + h, u0:u0 + w] = np.maximum(out[v0:v0 + h, u0:u0 + w], cov)


def make_logo_atlas() -> tuple[object, dict]:
    tris = rs.text_triangles("vivo", rs.ROUNDED_BOLD)
    x0, y0, x1, y1 = rs.text_bounds(tris)
    tw, th = x1 - x0, y1 - y0
    alpha = np.zeros((ATLAS, ATLAS))
    info = {}
    # --- horizontal: ícone (altura ≈ 1,05 × texto) + espaço + texto
    w_px, h_px = int(ATLAS * (REGION_H[2] - REGION_H[0])) * SS, int(ATLAS * (REGION_H[3] - REGION_H[1])) * SS
    unit = th * 1.05 / 1.155
    icon_w = 1.45 * unit
    gap = 0.30 * th
    total_w = icon_w + gap + tw
    margin = 0.06
    scale = w_px * (1 - 2 * margin) / total_w
    scale = min(scale, h_px * (1 - 2 * margin) / (th * 1.1))
    left = (w_px - total_w * scale) / 2
    base_y = (h_px - th * scale) / 2 - y0 * scale
    m = rs.raster_triangles(rs.place_text(tris, left + (icon_w + gap - x0) * scale, base_y, scale), w_px, h_px)
    icon_cx = left + icon_w * scale / 2
    icon_cy = base_y + y0 * scale + 0.15 * unit * scale
    m |= rs.wifi_mask(w_px, h_px, icon_cx, icon_cy, unit * scale)
    _compose(m, REGION_H, alpha)
    info["horizontal_aspect"] = w_px / h_px
    info["horizontal_content_frac"] = total_w * scale / w_px
    # --- empilhada: ícone centrado acima do texto (largura do ícone ≈ 0,55 × texto)
    w_px = h_px = int(ATLAS * 0.5) * SS
    unit_s = 0.55 * tw / 1.45
    icon_h = 1.155 * unit_s
    gap = 0.22 * th
    total_h = th + gap + icon_h
    scale = min(w_px * (1 - 2 * margin) / tw, h_px * (1 - 2 * margin) / total_h)
    bottom = (h_px - total_h * scale) / 2
    m = rs.raster_triangles(rs.place_text(tris, (w_px - tw * scale) / 2 - x0 * scale, bottom - y0 * scale, scale), w_px, h_px)
    icon_cy = bottom + (th + gap) * scale + 0.15 * unit_s * scale
    m |= rs.wifi_mask(w_px, h_px, w_px / 2, icon_cy, unit_s * scale)
    _compose(m, REGION_S, alpha)
    info["stacked_content_frac"] = tw * scale / w_px
    rgba = np.dstack([np.ones_like(alpha)] * 3 + [alpha])
    return save_image("logo_vivo", rgba), info


def conform_grid(tree: BVHTree, points: list[Vector], dirs: list[Vector], offset: float) -> list[Vector]:
    """Projeta cada ponto na superfície (raio de fora para dentro ao longo de −dir) e afasta `offset`."""
    out = []
    for p, d in zip(points, dirs):
        hit = tree.ray_cast(p + d * 0.08, -d, 0.2)
        if hit[0] is None:
            hit = tree.find_nearest(p, 0.05)
            if hit[0] is None:
                raise RuntimeError(f"decalque fora da superfície da polo em {tuple(round(c, 3) for c in p)}")
        n = hit[1] if hit[1].dot(d) > 0 else -hit[1]
        out.append(hit[0] + n * offset)
    return out


def grid_mesh(bm: bmesh.types.BMesh, pos: list[list[Vector]], region, uv_layer) -> list:
    """Grade (linhas × colunas) de quads com UV mapeando a região do atlas."""
    rows, cols = len(pos), len(pos[0])
    vs = [[bm.verts.new(p) for p in row] for row in pos]
    faces = []
    for i in range(rows - 1):
        for j in range(cols - 1):
            f = bm.faces.new([vs[i][j], vs[i][j + 1], vs[i + 1][j + 1], vs[i + 1][j]])
            f.smooth = True
            for loop in f.loops:
                ii, jj = next((a, b) for a in (i, i + 1) for b in (j, j + 1) if vs[a][b] is loop.vert)
                loop[uv_layer].uv = (region[0] + (region[2] - region[0]) * jj / (cols - 1), region[1] + (region[3] - region[1]) * ii / (rows - 1))
            faces.append(f)
    return faces


def planar_decal(bm, tree, center: Vector, normal: Vector, up: Vector, width: float, height: float, region, uv_layer,
                 cols: int = 13, rows: int = 6, offset: float = 0.0015) -> list:
    n = normal.normalized()
    up = (up - n * up.dot(n)).normalized()
    right = up.cross(n)
    pos = []
    for i in range(rows):
        y = (i / (rows - 1) - 0.5) * height
        pts = [center + right * ((j / (cols - 1) - 0.5) * width) + up * y for j in range(cols)]
        pos.append(conform_grid(tree, pts, [n] * cols, offset))
    return grid_mesh(bm, pos, region, uv_layer)


def cylinder_decal(bm, tree, axis_origin: Vector, axis_dir: Vector, facing: Vector, t0: float, radius: float, width: float,
                   height: float, region, uv_layer, cols: int = 10, rows: int = 9, offset: float = 0.0015) -> list:
    """Decalque enrolado em volta de um eixo (manga): colunas por ângulo (comprimento de arco / raio)."""
    d = axis_dir.normalized()
    f0 = (facing - d * facing.dot(d)).normalized()
    side = f0.cross(d)          # "direita" de quem olha a face com o topo apontando para −d
    pos = []
    for i in range(rows):
        t = t0 + (0.5 - i / (rows - 1)) * height   # linha 0 = base do logo (mais longe do ombro)
        pts, dirs = [], []
        for j in range(cols):
            phi = (j / (cols - 1) - 0.5) * width / radius
            radial = f0 * math.cos(phi) + side * math.sin(phi)
            pts.append(axis_origin + d * t + radial * radius)
            dirs.append(radial)
        pos.append(conform_grid(tree, pts, dirs, offset))
    return grid_mesh(bm, pos, region, uv_layer)
