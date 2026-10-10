"""Etapa 03 — suavização local do NARIZ (e da junção asa-bochecha) como offset por vértice.

A deformação espacial (`warp_face`) muda proporções, mas não arredonda a forma do nariz do asset
(ponta pequena com uma quina marcada no alto da asa, que vira um risco claro/vinco no render).
Aqui a pele da cabeça recebe uma suavização de Taubin (λ/μ, sem encolher) só numa região em torno do
nariz, com peso suave (1 no núcleo, 0 na borda) e zerada perto dos olhos e dos lábios.

O resultado é um OFFSET POR VÉRTICE δ somado igualmente à Basis e às posições absolutas de TODAS as
shape keys: os deltas das expressões (noseSneer, cheekSquint…) ficam exatamente como estavam. Só a pele
do nariz/bochechas é tocada (nenhuma outra malha encosta nessa região). Vértices duplicados por costura
de UV são soldados por posição, então a costura continua fechada.
"""
from __future__ import annotations

import numpy as np

from warp_apply import _mat, _set_local, _to_local, key_world_coords, mesh_world_coords
from warp_core import ellipsoid_t, kernel, smootherstep

SCULPT_DEFAULTS: dict = {
    "iterations": 45,
    "lambda": 0.50,
    "mu": -0.53,
    "radii_u": (0.34, 0.24, 0.26),   # elipsoide (x, y, z) em U em torno do nariz
    "plateau": 0.35,
    "eye_guard_mm": (3.0, 14.0),     # zero até r_olho + 3 mm, peso pleno a partir de r_olho + 14 mm
    "lip_guard_u": (0.02, 0.07),     # abaixo do subnasal: zero a partir de 0.07 U
    # ponta em bola (antes da suavização): elipsoide encostado na ponta, raios em U (x, y, z)
    "tip_radii_u": (0.17, 0.10, 0.11),
    "tip_center_drop_u": 0.02,       # centro um pouco abaixo da ponta (bola cheia embaixo)
    "tip_dir": (-0.35, 0.15),        # rampa da máscara direcional (só cima/frente)
    "tip_inflate": 0.35,             # 0,85 fazia uma "bola" na ponta
}


def _weld(P: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    _, first, inv = np.unique(np.round(P, 6), axis=0, return_index=True, return_inverse=True)
    return first, inv.ravel()


def _neighbors(ob, inv: np.ndarray, n: int) -> tuple[np.ndarray, np.ndarray]:
    ev = np.empty(len(ob.data.edges) * 2, dtype=np.int64)
    ob.data.edges.foreach_get("vertices", ev)
    e = inv[ev.reshape(-1, 2)]
    e = e[e[:, 0] != e[:, 1]]
    e = np.unique(np.sort(e, axis=1), axis=0)
    return e[:, 0], e[:, 1]


def _laplacian(X: np.ndarray, a: np.ndarray, b: np.ndarray, deg: np.ndarray) -> np.ndarray:
    acc = np.zeros_like(X)
    np.add.at(acc, a, X[b])
    np.add.at(acc, b, X[a])
    return acc / np.maximum(deg, 1)[:, None] - X


def sculpt_weights(P: np.ndarray, skin: np.ndarray, lm: dict, p: dict) -> np.ndarray:
    U = lm["U"]
    tip, subn, alae = lm["nose_tip"], lm["subnasale"], lm["alae"]
    center = np.array([0.0, 0.5 * (float(tip[1]) + float(alae[1])), 0.5 * (float(tip[2]) + float(subn[2])) + 0.02 * U])
    radii = np.array(p["radii_u"]) * U
    w = kernel(ellipsoid_t(P, center, radii), p["plateau"]) * skin
    r = lm["eye_radius"]
    for c in (lm["eye_l"], lm["eye_r"]):
        d = np.linalg.norm(P - np.asarray(c)[None, :], axis=1)
        w *= smootherstep(r + p["eye_guard_mm"][0] / 1000, r + p["eye_guard_mm"][1] / 1000, d)
    g0, g1 = p["lip_guard_u"]
    w *= smootherstep(float(subn[2]) - g1 * U, float(subn[2]) - g0 * U, P[:, 2])
    return w


def inflate_tip(X: np.ndarray, w: np.ndarray, lm: dict, p: dict) -> np.ndarray:
    """Ponta do nariz em bola: pontos DENTRO de um elipsoide encostado na ponta são empurrados até a
    superfície dele (só as direções para cima/frente — a base com as narinas fica como está). Enche o
    sulco entre a ponta e a asa, que é a quina clara do asset."""
    U = lm["U"]
    tip = np.asarray(lm["nose_tip"], float)
    radii = np.array(p["tip_radii_u"]) * U
    c = tip + np.array([0.0, radii[1], -p["tip_center_drop_u"] * U])
    q = (X - c) / radii
    r = np.linalg.norm(q, axis=1)
    n = q / np.maximum(r, 1e-9)[:, None]
    facing = n[:, 2] * 0.8 - n[:, 1] * 0.6          # para cima/frente
    w_dir = smootherstep(p["tip_dir"][0], p["tip_dir"][1], facing)
    target = c + radii * n
    amt = (r < 1.0) * w * w_dir * p["tip_inflate"]
    return X + amt[:, None] * (target - X)


def sculpt_nose(ob, skin_mask: np.ndarray, lm: dict, params: dict | None = None) -> dict:
    """Aplica a suavização ponderada e soma o mesmo δ à Basis e a todas as shape keys."""
    p = {**SCULPT_DEFAULTS, **(params or {})}
    P = mesh_world_coords(ob)
    first, inv = _weld(P)
    X0 = P[first]
    n = len(X0)
    a, b = _neighbors(ob, inv, n)
    deg = np.bincount(a, minlength=n) + np.bincount(b, minlength=n)
    skin_w = np.zeros(n)
    skin_w[inv[skin_mask]] = 1.0
    w = sculpt_weights(X0, skin_w, lm, p)[:, None]
    X = inflate_tip(X0, w[:, 0], lm, p)
    inflated = float(np.linalg.norm(X - X0, axis=1).max())
    for _ in range(p["iterations"]):
        X = X + p["lambda"] * w * _laplacian(X, a, b, deg)
        X = X + p["mu"] * w * _laplacian(X, a, b, deg)
    delta = (X - X0)[inv]
    m = _mat(ob)
    me = ob.data
    if me.shape_keys is not None:
        for name, co in key_world_coords(ob).items():
            _set_local(me.shape_keys.key_blocks[name].data, _to_local(co + delta, m))
    _set_local(me.vertices, _to_local(P + delta, m))
    me.update()
    moved = np.linalg.norm(delta, axis=1)
    return {"verts_moved": int((moved > 1e-5).sum()), "max_mm": round(float(moved.max()) * 1000, 2),
            "tip_inflate_max_mm": round(inflated * 1000, 2),
            "mean_mm_moved": round(float(moved[moved > 1e-5].mean()) * 1000, 3) if (moved > 1e-5).any() else 0.0}


# ---------------------------------------------------------------------------------------------
# Filtro (sulco entre o nariz e a boca)
# ---------------------------------------------------------------------------------------------

PHILTRUM_DEFAULTS: dict = {
    "depth_mm": 2.2,            # sulco central, para dentro (0,9 quase não aparecia na luz frontal)
    "half_width_mm": 3.5,       # meia-largura (gaussiana em x) do sulco
    "ridge_mm": 0.6,            # colunas do filtro, para fora, dos dois lados do sulco
    "ridge_x_mm": 5.5,          # |x| das colunas
    "ridge_half_width_mm": 2.4,
    "top_gap_mm": 0.5,          # começa logo abaixo da base do nariz
    "bottom_gap_mm": 0.6,       # termina logo acima do ponto mais à frente do lábio superior
    "fade_mm": 2.0,             # entrada/saída em z
    "surface_depth_mm": 6.0,    # só a pele da frente (o interior da boca fica atrás)
}


def philtrum_offsets(P: np.ndarray, skin: np.ndarray, lm: dict, p: dict) -> np.ndarray:
    """δ (N,3) do filtro: sulco central para trás (+y) e duas colunas para frente (−y), só na faixa
    entre a base do nariz e o lábio superior, só na pele da frente."""
    mm = 1e-3
    subn, ulip = np.asarray(lm["subnasale"], float), np.asarray(lm["upper_lip"], float)
    z_top = float(subn[2]) - p["top_gap_mm"] * mm
    z_bot = float(ulip[2]) + p["bottom_gap_mm"] * mm
    fade = p["fade_mm"] * mm
    x, y, z = P[:, 0], P[:, 1], P[:, 2]
    wz = smootherstep(z_bot, z_bot + fade, z) * (1.0 - smootherstep(z_top - fade, z_top, z))
    front = min(float(subn[1]), float(ulip[1])) + p["surface_depth_mm"] * mm
    w = wz * (y < front) * skin
    groove = p["depth_mm"] * mm * np.exp(-(x / (p["half_width_mm"] * mm)) ** 2)
    ridge = p["ridge_mm"] * mm * np.exp(-((np.abs(x) - p["ridge_x_mm"] * mm) / (p["ridge_half_width_mm"] * mm)) ** 2)
    delta = np.zeros_like(P)
    delta[:, 1] = w * (groove - ridge)
    return delta


def sculpt_philtrum(ob, skin_mask: np.ndarray, lm: dict, params: dict | None = None) -> dict:
    """Soma o MESMO δ à Basis e a todas as shape keys (as expressões não mudam: o sulco acompanha a
    pele). δ é função da posição, então vértices duplicados na costura de UV continuam juntos."""
    p = {**PHILTRUM_DEFAULTS, **(params or {})}
    P = mesh_world_coords(ob)
    delta = philtrum_offsets(P, skin_mask.astype(float), lm, p)
    m = _mat(ob)
    me = ob.data
    if me.shape_keys is not None:
        for name, co in key_world_coords(ob).items():
            _set_local(me.shape_keys.key_blocks[name].data, _to_local(co + delta, m))
    _set_local(me.vertices, _to_local(P + delta, m))
    me.update()
    moved = np.abs(delta[:, 1])
    return {"verts_moved": int((moved > 1e-5).sum()), "groove_mm": round(float(delta[:, 1].max()) * 1000, 2),
            "ridge_mm": round(float(-delta[:, 1].min()) * 1000, 2)}
