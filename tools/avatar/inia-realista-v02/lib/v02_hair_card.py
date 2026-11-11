"""v02 — textura dos cachos em fita (hair card): fios desenhados ao longo de V, recorte no alpha.

`hair_card.png` (RGBA, sRGB): `VARIANTS` colunas lado a lado, cada uma uma mecha de fios finos com
brilho próprio (cinza claro: a COR vem da cor por vértice do cacho, raiz escura → ponta acobreada).
O alpha é quase cheio no miolo da mecha e desfiado só nas bordas e em poucas frestas — de longe (mipmaps)
a mecha continua fechada em vez de sumir. Periódica em V (a fita repete a textura ao longo do cacho).
Gerada por código, determinística, sem imagem de terceiros.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np

from skin_png import write_png

VARIANTS = 4
V_TILE_M = 0.045          # comprimento de cacho coberto por uma repetição da textura


def build(path: Path, cell: int = 128, height: int = 512, seed: int = 20261110) -> Path:
    rng = np.random.default_rng(seed)
    img = np.zeros((height, cell * VARIANTS, 4), dtype=np.float32)
    v = (np.arange(height) + 0.5) / height
    x = (np.arange(cell) + 0.5) / cell
    for k in range(VARIANTS):
        shade = np.zeros((height, cell), dtype=np.float32)
        cover = np.zeros((height, cell), dtype=np.float32)
        strands = int(rng.integers(15, 20))
        for _ in range(strands):
            # mais fios no miolo que nas bordas
            x0 = float(np.clip(0.5 + rng.normal(0, 0.24), 0.05, 0.95))
            wob = sum(rng.uniform(0.004, 0.022) * np.sin(2 * np.pi * (f * v + rng.random())) for f in (1, 2, 3))
            cx = x0 + wob
            sigma = rng.uniform(0.022, 0.04)
            tone = rng.uniform(0.5, 1.0)
            # brilho que varia ao longo do fio (periódico)
            tone_v = tone * (0.85 + 0.15 * np.sin(2 * np.pi * (rng.integers(1, 4) * v + rng.random())))
            g = np.exp(-((x[None, :] - cx[:, None]) / sigma) ** 2)
            win = g > cover
            shade = np.where(win, tone_v[:, None] * (0.55 + 0.45 * g), shade)
            cover = np.maximum(cover, g)
        edge = np.clip(np.minimum(x, 1 - x) / 0.07, 0, 1)[None, :]
        alpha = np.clip((cover * edge - 0.22) / 0.2, 0, 1)
        img[:, k * cell:(k + 1) * cell, 0] = shade * 1.0
        img[:, k * cell:(k + 1) * cell, 1] = shade * 0.96
        img[:, k * cell:(k + 1) * cell, 2] = shade * 0.92
        img[:, k * cell:(k + 1) * cell, 3] = alpha
    # fora do recorte a cor continua a dos fios (sem halo escuro no mipmap)
    rgb = img[..., :3]
    rgb[img[..., 3] < 0.02] = 0.7
    write_png(path, img)
    return path
