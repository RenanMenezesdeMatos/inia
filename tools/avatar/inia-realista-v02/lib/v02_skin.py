"""v02 — pele menos "plástica": variação de cor, poros, rugosidade irregular e mapa de normais.

Entra DEPOIS da pintura da etapa 04 (`skin_paint.build`), só na pele do ROSTO/orelhas/pescoço do atlas
(`HEAD_SKIN`); sobrancelha, delineado, cavidade do olho, olhos e boca ficam como estavam. Braços e colo
usam um bloco uniforme do atlas (muitos triângulos no mesmo texel) e não recebem detalhe — limitação
do UV do asset base.

O que muda (tudo determinístico, sem imagem de terceiros):
- cor: manchas largas e médias de melanina/hemoglobina (±3 % e ±2 % de luminância, as mais claras um
  pouco mais quentes), poros (pontos ~0,3 mm, −5 %), rubor leve na ponta do nariz, queixo e orelhas;
- lábios: vincos verticais finos (cor e relevo);
- rugosidade: irregular (±0,05), poros mais foscos, zona T um pouco mais lisa — o brilho deixa de ser
  uma faixa uniforme;
- `skin_normal.png` (tangente, convenção glTF): relevo dos poros, da variação média e dos vincos.

O UV do rosto é espelhado (as duas metades usam os mesmos texels), então a variação é simétrica; a
amplitude é baixa justamente para isso não ser percebido.
"""
from __future__ import annotations

import numpy as np

import skin_atlas as A
import skin_paint as P


def enhance(color_srgb: np.ndarray, metal_rough: np.ndarray, maps: A.AtlasMaps, ex: dict, seed: int = 20261110,
            strength: float = 1.0) -> tuple[np.ndarray, np.ndarray, np.ndarray, dict]:
    h, w = maps.shape
    lab = maps.label
    head = (lab == A.HEAD_SKIN).astype(np.float32)
    lips = ex["lips"]
    keep = (1 - ex["brow"]) * (1 - ex["liner"]) * (1 - ex["socket"])
    skin = head * keep * (1 - lips)                       # pele "nua" do rosto
    soft = np.clip(P.blur(skin, 2.0), 0, 1) * skin         # some nas bordas (sem degrau no contorno)
    X, Z = ex["X"], ex["Z"]
    ecz = ex["ecz"]

    lin = P.to_lin(color_srgb.astype(np.float32))
    large = P._hash_noise((h, w), seed, 46.0)              # manchas largas (~2–3 cm)
    medium = P._hash_noise((h, w), seed + 1, 9.0)          # ~5 mm
    fine = P._hash_noise((h, w), seed + 2, 1.1)            # grão dos poros
    pores = np.clip(fine - 0.9, 0, 1.6) / 1.6              # só os picos viram poro
    pores *= 0.55 + 0.45 * np.clip(P._hash_noise((h, w), seed + 3, 30.0) * 0.5 + 0.5, 0, 1)  # densidade varia

    s = strength
    lum = 1.0 + s * (0.022 * large + 0.012 * medium) - s * 0.04 * pores
    warm = s * (0.012 * large + 0.008 * medium)            # claro = mais quente, escuro = mais frio
    gain = np.stack([lum * (1 + warm), lum, lum * (1 - warm)], axis=-1)
    # rubor: ponta do nariz, queixo e orelhas (pele fina) — bem abaixo do blush das maçãs
    nose = np.exp(-((X / 0.016) ** 2 + ((Z - (ecz - 0.047)) / 0.014) ** 2))
    chin = np.exp(-((X / 0.022) ** 2 + ((Z - (ecz - 0.118)) / 0.014) ** 2))
    ears = np.clip((X - 0.088) / 0.012, 0, 1) * np.exp(-(((Z - (ecz - 0.012)) / 0.035) ** 2))
    flush = s * np.clip(0.55 * nose + 0.35 * chin + 0.6 * ears, 0, 1)
    gain *= 1.0 + flush[..., None] * np.array([0.085, -0.02, -0.045], dtype=np.float32)
    lin = lin * (1 + (gain - 1) * soft[..., None])

    # lábios: vincos verticais (linhas de |x| constante, levemente irregulares)
    crease_n = P._hash_noise((h, w), seed + 4, 3.0)
    crease = 0.5 + 0.5 * np.sin(X * 5200.0 + 2.6 * crease_n)
    crease = np.clip((crease - 0.55) / 0.45, 0, 1) ** 2
    lin *= 1.0 - s * 0.10 * (crease * lips)[..., None]

    rough = metal_rough.copy()
    g = rough[..., 1]
    tzone = np.exp(-((X / 0.02) ** 2)) * P.smoothstep(ecz - 0.06, ecz - 0.03, Z) * P.smoothstep(ecz + 0.10, ecz + 0.05, Z)
    g = g + soft * s * (0.035 * medium + 0.03 * large + 0.08 * pores - 0.05 * tzone)
    g = g + lips * s * 0.08 * crease
    rough[..., 1] = np.clip(g, 0.2, 0.95)

    # relevo (m, escala arbitrária) → normal tangente. Linha do array ↑ = V ↑ (write_png grava a linha 0 na base).
    height = soft * (-1.0 * pores + 0.05 * medium) + lips * (-0.9 * crease)
    height = P.blur(height, 0.6)
    k = 1.4 * s
    du = np.gradient(height, axis=1) * k
    dv = np.gradient(height, axis=0) * k
    n = np.stack([-du, -dv, np.ones_like(du)], axis=-1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    normal = n * 0.5 + 0.5

    report = {"skin_texels": int((skin > 0.5).sum()), "pore_coverage": round(float((pores * skin > 0.1).mean() / max(float(skin.mean()), 1e-6)), 4),
              "luminance_gain_p01_p99": [round(float(v), 3) for v in np.percentile(lum[skin > 0.5], [1, 99])],
              "normal_tilt_p99_deg": round(float(np.degrees(np.arccos(np.percentile(n[..., 2][skin > 0.5], 1)))), 2)}
    return P.to_srgb(lin), rough, normal.astype(np.float32), report
