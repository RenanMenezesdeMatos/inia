"""Etapa 02 — texturas procedurais tileáveis dos tecidos (numpy → PNG em textures/).

- polo_basecolor.png / polo_normal.png: malha piquet (células em losango/colmeia pequenas).
- polo_rib_normal.png: canelado (gola e barras) — nervuras ao longo de V.
- belt_normal.png: grão de couro sutil.
Imagens com origem embaixo (convenção do Blender).
"""
from __future__ import annotations

import numpy as np

from common import hex_to_linear_rgba
from outfit_util import normal_from_height, save_image


def _grid(n: int) -> tuple[np.ndarray, np.ndarray]:
    u = (np.arange(n) + 0.5) / n
    return np.meshgrid(u, u)  # (x, y)


def _tile_noise(n: int, cells: int, seed: int) -> np.ndarray:
    """Ruído de valor tileável (interpolação cosseno numa grade periódica)."""
    rng = np.random.default_rng(seed)
    g = rng.random((cells, cells))
    x, y = _grid(n)
    fx, fy = x * cells, y * cells
    ix, iy = np.floor(fx).astype(int), np.floor(fy).astype(int)
    tx, ty = fx - ix, fy - iy
    tx, ty = (1 - np.cos(np.pi * tx)) / 2, (1 - np.cos(np.pi * ty)) / 2
    a = g[iy % cells, ix % cells]
    b = g[iy % cells, (ix + 1) % cells]
    c = g[(iy + 1) % cells, ix % cells]
    d = g[(iy + 1) % cells, (ix + 1) % cells]
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty


def pique_height(n: int = 512, cells: int = 16) -> np.ndarray:
    """Piquet: losangos em relevo com pequenas cavidades (colmeia), tileável."""
    x, y = _grid(n)
    a = np.cos(2 * np.pi * cells * (x + y))
    b = np.cos(2 * np.pi * cells * (x - y))
    cell = 0.5 * (a + b)                      # grade de losangos
    pits = np.clip(-(a * b), 0, 1) ** 2       # cavidades entre as laçadas
    h = 0.55 * cell - 0.45 * pits
    h += 0.08 * (_tile_noise(n, 64, 11) - 0.5)
    return h


def make_polo_textures(base_hex: str) -> dict:
    n = 512
    h = pique_height(n)
    normal = normal_from_height(h, 1.2)
    save_n = save_image("polo_normal", normal, non_color=True)
    # albedo: cor base (linear) com leve sombreamento das cavidades + manchas de tingimento
    base = np.array(hex_to_linear_rgba(base_hex)[:3])
    shade = 1.0 + 0.10 * (h - h.mean()) / (np.abs(h).max() + 1e-6) + 0.05 * (_tile_noise(n, 8, 3) - 0.5)
    lin = base[None, None, :] * shade[..., None]
    srgb = np.where(lin <= 0.0031308, lin * 12.92, 1.055 * np.power(np.clip(lin, 0, None), 1 / 2.4) - 0.055)
    albedo = np.dstack([srgb, np.ones((n, n))])
    save_c = save_image("polo_basecolor", albedo)
    # canelado: 14 nervuras por ladrilho ao longo de U (as nervuras correm em V)
    x, _y = _grid(n)
    rib = np.abs(np.sin(np.pi * 14 * x)) ** 0.6 + 0.08 * (_tile_noise(n, 48, 5) - 0.5)
    save_r = save_image("polo_rib_normal", normal_from_height(rib, 5.0), non_color=True)
    return {"normal": save_n, "basecolor": save_c, "rib_normal": save_r}


def make_belt_normal() -> object:
    n = 256
    h = 0.6 * _tile_noise(n, 48, 21) + 0.4 * _tile_noise(n, 96, 23)
    h = np.abs(h - 0.5) * 2  # vincos finos
    return save_image("belt_normal", normal_from_height(h, 2.5), non_color=True)
