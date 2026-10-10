"""Etapa 02 — rasterização (numpy) de texto e ícones para as texturas dos logos e do broche.

O texto vem da fonte real via objeto de texto do Blender convertido em malha (triângulos); o ícone
"wi-fi" (ponto + 2 arcos) é desenhado por campo de distância. Supersampling 4× para bordas limpas.
"""
from __future__ import annotations

import math

import bmesh
import bpy
import numpy as np

ROUNDED_BOLD = "/System/Library/Fonts/Supplemental/Arial Rounded Bold.ttf"
ARIAL_BOLD = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"


def text_triangles(text: str, font_path: str) -> np.ndarray:
    """Triângulos (N×3×2) do texto em unidades da fonte (altura de corpo ≈ 1), origem na linha de base."""
    font = bpy.data.fonts.load(font_path, check_existing=True)
    cu = bpy.data.curves.new("_txt", "FONT")
    cu.body = text
    cu.font = font
    cu.size = 1.0
    cu.resolution_u = 24
    ob = bpy.data.objects.new("_txt", cu)
    bpy.context.scene.collection.objects.link(ob)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    tris = np.array([[(l.vert.co.x, l.vert.co.y) for l in f.loops] for f in bm.faces])
    bm.free()
    bpy.data.meshes.remove(me)
    bpy.data.objects.remove(ob, do_unlink=True)
    bpy.data.curves.remove(cu)
    return tris


def raster_triangles(tris: np.ndarray, width: int, height: int) -> np.ndarray:
    """Cobertura (height×width, 0/1) dos triângulos em coordenadas de pixel (origem embaixo)."""
    out = np.zeros((height, width), dtype=bool)
    for a, b, c in tris:
        x0, x1 = int(max(0, math.floor(min(a[0], b[0], c[0])))), int(min(width - 1, math.ceil(max(a[0], b[0], c[0]))))
        y0, y1 = int(max(0, math.floor(min(a[1], b[1], c[1])))), int(min(height - 1, math.ceil(max(a[1], b[1], c[1]))))
        if x1 < x0 or y1 < y0:
            continue
        xs, ys = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
        d1 = (xs - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (ys - b[1])
        d2 = (xs - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (ys - c[1])
        d3 = (xs - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (ys - a[1])
        neg = (d1 < 0) | (d2 < 0) | (d3 < 0)
        pos = (d1 > 0) | (d2 > 0) | (d3 > 0)
        out[y0:y1 + 1, x0:x1 + 1] |= ~(neg & pos)
    return out


def wifi_mask(width: int, height: int, cx: float, cy: float, unit: float, angle_deg: float = 44.0) -> np.ndarray:
    """Ponto + 2 arcos concêntricos abertos para cima (unit = raio do arco externo, em pixels)."""
    ys, xs = np.mgrid[0:height, 0:width] + 0.5
    dx, dy = xs - cx, ys - cy
    r = np.hypot(dx, dy)
    ang = np.degrees(np.arctan2(dx, dy))  # 0 = para cima
    stroke = 0.17 * unit
    mask = r < 0.15 * unit  # ponto
    lim = angle_deg
    for radius in (0.55 * unit, 0.92 * unit):
        inside = (np.abs(r - radius) < stroke / 2) & (np.abs(ang) <= lim)
        for s in (-1, 1):  # pontas arredondadas
            ex = cx + radius * math.sin(math.radians(s * lim))
            ey = cy + radius * math.cos(math.radians(s * lim))
            inside |= np.hypot(xs - ex, ys - ey) < stroke / 2
        mask |= inside
    return mask


def downsample(mask: np.ndarray, factor: int) -> np.ndarray:
    h, w = mask.shape
    return mask.reshape(h // factor, factor, w // factor, factor).mean(axis=(1, 3))


def place_text(tris: np.ndarray, x: float, y: float, scale: float) -> np.ndarray:
    return tris * scale + np.array([x, y])


def text_bounds(tris: np.ndarray) -> tuple[float, float, float, float]:
    pts = tris.reshape(-1, 2)
    return pts[:, 0].min(), pts[:, 1].min(), pts[:, 0].max(), pts[:, 1].max()
