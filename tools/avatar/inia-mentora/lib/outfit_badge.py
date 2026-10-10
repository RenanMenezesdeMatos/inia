"""Etapa 02 — broche redondo "INIA / MENTORA" (INIA_Badge): textura 512² e malha chanfrada (~260 tris)."""
from __future__ import annotations

import math

import bmesh
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

import outfit_raster as rs
from outfit_util import save_image

N = 512
R_TEX = 0.49  # raio do disco no atlas (fração da largura)


def _srgb(hex_color: str) -> np.ndarray:
    h = hex_color.removeprefix("#")
    return np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)])


def make_badge_texture() -> object:
    ss = 2
    n = N * ss
    ys, xs = np.mgrid[0:n, 0:n] + 0.5
    cx = cy = n / 2
    R = R_TEX * n
    dx, dy = (xs - cx) / R, (ys - cy) / R
    r = np.hypot(dx, dy)
    # gradiente diagonal: violeta (cima-esquerda) → azul (baixo-direita)
    t = np.clip((dx - dy) / (2 * math.sqrt(2)) * 1.25 + 0.5, 0, 1)
    c0, c1 = _srgb("#5a3290"), _srgb("#1e2c80")
    col = c0[None, None, :] * (1 - t)[..., None] + c1[None, None, :] * t[..., None]
    # rosado perto da borda de cima-esquerda, vinheta suave
    pink = _srgb("#7a3480")
    wp = np.clip(1 - np.hypot(dx + 0.55, dy - 0.55) / 0.9, 0, 1) ** 2 * 0.45
    col = col * (1 - wp[..., None]) + pink * wp[..., None]
    col *= (1 - 0.18 * np.clip(r - 0.55, 0, 1))[..., None]
    # aro rosado-violeta brilhante (0,88 R … R)
    rim = np.clip((r - 0.86) / 0.05, 0, 1)
    rim_col = _srgb("#a070c0")
    rim_shade = (0.80 + 0.35 * np.clip((-dx + dy) / 1.4, -0.3, 1))[..., None]
    col = col * (1 - rim[..., None]) + np.clip(rim_col * rim_shade, 0, 1) * rim[..., None]
    # brilho especular pintado (arco claro em cima-esquerda)
    gloss = np.clip(1 - np.abs(np.hypot(dx + 0.05, dy + 0.05) - 0.80) / 0.06, 0, 1) * np.clip((dy - dx) / 1.2, 0, 1) * (r < 0.86)
    col = np.clip(col + 0.22 * gloss[..., None], 0, 1)
    # texto
    white = np.zeros((n, n), bool)
    for text, width, cy_frac in (("INIA", 1.22, 0.60), ("MENTORA", 1.20, 0.34)):
        tris = rs.text_triangles(text, rs.ARIAL_BOLD)
        x0, y0, x1, y1 = rs.text_bounds(tris)
        sc = width * R / (x1 - x0)
        if text == "MENTORA":
            sc = min(sc, 0.23 * R / (y1 - y0))
        else:
            sc = min(sc, 0.52 * R / (y1 - y0))
        tx = cx - (x0 + x1) / 2 * sc
        ty = (cy_frac * n) - (y0 + y1) / 2 * sc
        white |= rs.raster_triangles(rs.place_text(tris, tx, ty, sc), n, n)
    cov = rs.downsample(white, ss)
    col = col.reshape(N, ss, N, ss, 3).mean(axis=(1, 3))
    col = col * (1 - cov[..., None]) + cov[..., None] * 0.97
    rgba = np.dstack([col, np.ones((N, N))])
    return save_image("badge_color", rgba)


def build_badge(bm: bmesh.types.BMesh, uv_layer, center: Vector, normal: Vector, up: Vector, radius: float,
                thickness: float, segments: int = 32) -> list:
    n = normal.normalized()
    up = (up - n * up.dot(n)).normalized()
    right = up.cross(n)
    b = 0.0022  # chanfro

    def uv_at(rr: float, ang: float) -> tuple[float, float]:
        k = R_TEX * rr / radius
        return 0.5 + k * math.cos(ang), 0.5 + k * math.sin(ang)

    rings_spec = [(radius - b, 0.0), (radius - 0.35 * b, -0.35 * b), (radius, -b), (radius, -thickness)]
    rings = []
    for rr, z in rings_spec:
        ring = []
        for k in range(segments):
            ang = 2 * math.pi * k / segments
            ring.append(bm.verts.new(center + (right * math.cos(ang) + up * math.sin(ang)) * rr + n * z))
        rings.append(ring)
    front_c = bm.verts.new(center)
    back_c = bm.verts.new(center - n * thickness)
    faces = []
    uv_r = [radius - b, radius - 0.35 * b, radius * 0.985, radius * 0.97]
    for k in range(segments):
        j = (k + 1) % segments
        a0, a1 = 2 * math.pi * k / segments, 2 * math.pi * (k + 1) / segments
        f = bm.faces.new([front_c, rings[0][k], rings[0][j]])
        uvs = [(0.5, 0.5), uv_at(uv_r[0], a0), uv_at(uv_r[0], a1)]
        faces.append((f, uvs, n))
        for i in range(3):
            f = bm.faces.new([rings[i][k], rings[i + 1][k], rings[i + 1][j], rings[i][j]])
            uvs = [uv_at(uv_r[i], a0), uv_at(uv_r[i + 1], a0), uv_at(uv_r[i + 1], a1), uv_at(uv_r[i], a1)]
            faces.append((f, uvs, None))
        f = bm.faces.new([back_c, rings[3][j], rings[3][k]])
        faces.append((f, [uv_at(radius * 0.97, a0)] * 3, -n))
    out = []
    for f, uvs, want in faces:
        for loop, uv in zip(f.loops, uvs):
            loop[uv_layer].uv = uv
        f.normal_update()
        ref = want if want is not None else f.calc_center_median() - (center - n * thickness * 0.5)
        if f.normal.dot(ref) < 0:
            f.normal_flip()  # bmesh mantém o UV de cada canto no mesmo vértice
        f.smooth = want is None
        out.append(f)
    return out


def seat_offset(tree: BVHTree, center: Vector, normal: Vector, up: Vector, radius: float, gap: float = 0.001) -> float:
    """Quanto afastar o broche (ao longo da normal) para que toda a borda de trás fique fora da polo."""
    n = normal.normalized()
    up = (up - n * up.dot(n)).normalized()
    right = up.cross(n)
    need = 0.0
    for k in range(24):
        ang = 2 * math.pi * k / 24
        p = center + (right * math.cos(ang) + up * math.sin(ang)) * radius
        hit = tree.ray_cast(p + n * 0.05, -n, 0.1)
        if hit[0] is not None:
            need = max(need, (hit[0] - p).dot(n))
    return need + gap
