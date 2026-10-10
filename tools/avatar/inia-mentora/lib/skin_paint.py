"""Etapa 04 — pintura procedural do atlas da pele (numpy puro, determinístico).

Tudo é derivado de três entradas: o atlas original (pixels sRGB), os mapas rasterizados
(`skin_atlas.AtlasMaps`: rótulo + posição/normal de mundo em repouso por texel) e os parâmetros abaixo.
As formas do rosto (sobrancelha, delineado, blush, lábios) são desenhadas no ESPAÇO 3D do rosto
(projeção frontal |x|, z) e ancoradas em marcos extraídos da própria geometria/textura de entrada
(sobrancelha e contorno do olho originais, centro dos globos oculares), então continuam no lugar se a
etapa de proporções deformar a cabeça. O rosto é espelhado no atlas (meia face), por isso as formas
usam |x|.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np

import skin_atlas as A

LUMA = np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)


# ---------------------------------------------------------------------------
# Utilitários de cor e de imagem
# ---------------------------------------------------------------------------

def to_lin(c: np.ndarray) -> np.ndarray:
    c = np.asarray(c, dtype=np.float32)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4).astype(np.float32)


def to_srgb(c: np.ndarray) -> np.ndarray:
    c = np.clip(np.asarray(c, dtype=np.float32), 0.0, 1.0)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055).astype(np.float32)


def hex_lin(value: str) -> np.ndarray:
    value = value.removeprefix("#")
    return to_lin(np.array([int(value[i:i + 2], 16) / 255 for i in (0, 2, 4)], dtype=np.float32))


def smoothstep(e0: float, e1: float, x: np.ndarray) -> np.ndarray:
    t = np.clip((np.asarray(x, dtype=np.float32) - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def _box_axis(a: np.ndarray, r: int, axis: int) -> np.ndarray:
    if r <= 0:
        return a
    pad = [(0, 0)] * a.ndim
    pad[axis] = (r + 1, r)
    c = np.cumsum(np.pad(a, pad, mode="constant"), axis=axis, dtype=np.float64)
    n = a.shape[axis]
    hi = np.take(c, np.arange(2 * r + 1, 2 * r + 1 + n), axis=axis)
    lo = np.take(c, np.arange(0, n), axis=axis)
    return ((hi - lo) / (2 * r + 1)).astype(np.float32)


def blur(a: np.ndarray, sigma: float) -> np.ndarray:
    """Gaussiana aproximada (3 caixas separáveis), borda com zeros."""
    if sigma <= 0:
        return a.astype(np.float32)
    w = math.sqrt(4 * sigma * sigma + 1)
    r = max(int(round((w - 1) / 2)), 1)
    out = a.astype(np.float32)
    for _ in range(3):
        out = _box_axis(out, r, 0)
        out = _box_axis(out, r, 1)
    return out


def masked_blur(values: np.ndarray, mask: np.ndarray, sigma: float) -> np.ndarray:
    """Convolução normalizada: média gaussiana só dos texels válidos (mask)."""
    m = mask.astype(np.float32)
    num = blur(values * (m[..., None] if values.ndim == 3 else m), sigma)
    den = blur(m, sigma)
    den = np.maximum(den, 1e-6)
    return num / (den[..., None] if values.ndim == 3 else den)


def seam_columns(X: np.ndarray, head: np.ndarray) -> np.ndarray:
    """Coluna da costura central do rosto em cada linha do atlas (-1 onde não há). O UV do rosto é
    ESPELHADO (as duas metades usam a mesma ilha) e a linha média x = 0 fica na borda da ilha."""
    mid = head & (X < 0.0012)
    cols = np.where(mid, np.arange(X.shape[1])[None, :], -1).max(axis=1)
    if (cols >= 0).sum() < 20:
        raise RuntimeError("costura central do rosto não encontrada no atlas")
    return cols


def mirror_across_seam(a: np.ndarray, seams: np.ndarray, background: np.ndarray, width: int = 24) -> np.ndarray:
    """Cópia de `a` com o fundo logo depois da costura preenchido pelo reflexo da ilha (linha a linha).
    Um borrão feito sobre isso enxerga a outra metade do rosto na linha média (sem isso, a borda da
    ilha vira "borda do lábio" e o contorno escuro desenha uma linha vertical no meio da boca)."""
    b = a.copy()
    rows = np.nonzero(seams >= 0)[0]
    for j in range(width):
        dst, src = seams[rows] + 1 + j, seams[rows] - j
        ok = (dst < a.shape[1]) & (src >= 0)
        r, d, s = rows[ok], dst[ok], src[ok]
        free = background[r, d]
        b[r[free], d[free]] = a[r[free], s[free]]
    return b


def dilate_fill(color: np.ndarray, filled: np.ndarray, iterations: int) -> np.ndarray:
    """Sangria de borda: estende as ilhas para o fundo (evita costuras nos mipmaps)."""
    color = color.copy()
    filled = filled.copy()
    for _ in range(iterations):
        acc = np.zeros_like(color)
        cnt = np.zeros(filled.shape, dtype=np.float32)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)):
            f = np.roll(filled, (dy, dx), axis=(0, 1))
            acc += np.roll(color, (dy, dx), axis=(0, 1)) * f[..., None]
            cnt += f
        grow = (~filled) & (cnt > 0)
        if not grow.any():
            break
        color[grow] = acc[grow] / cnt[grow][:, None]
        filled = filled | grow
    return color


def harmonic_fill(values: np.ndarray, unknown: np.ndarray, allowed: np.ndarray, initial: np.ndarray,
                  iterations: int = 400) -> np.ndarray:
    """Preenchimento harmônico (Jacobi) dos texels `unknown`, com borda nos texels `allowed & ~unknown`.

    Sem manchas: cada texel vira a média dos vizinhos, então a pele reconstruída emenda suave com o que
    está em volta em todas as direções (um borrão ponderado puxava para onde havia mais suporte). Roda
    só na caixa que contém a região; `initial` é o chute inicial (ex.: `masked_blur`).
    """
    ys, xs = np.nonzero(unknown)
    if len(ys) == 0:
        return values
    y0, y1 = max(ys.min() - 2, 0), min(ys.max() + 3, values.shape[0])
    x0, x1 = max(xs.min() - 2, 0), min(xs.max() + 3, values.shape[1])
    v = np.where(unknown[..., None], initial, values)[y0:y1, x0:x1].astype(np.float32).copy()
    unk = unknown[y0:y1, x0:x1]
    ok = allowed[y0:y1, x0:x1].astype(np.float32)
    for _ in range(iterations):
        acc = np.zeros_like(v)
        cnt = np.zeros(unk.shape, dtype=np.float32)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            m = np.roll(ok, (dy, dx), axis=(0, 1))
            acc += np.roll(v, (dy, dx), axis=(0, 1)) * m[..., None]
            cnt += m
        upd = unk & (cnt > 0)
        v[upd] = acc[upd] / cnt[upd][:, None]
    out = values.copy()
    block = out[y0:y1, x0:x1]
    block[unk] = v[unk]
    out[y0:y1, x0:x1] = block
    return out


def _nearest(points: np.ndarray, queries: np.ndarray, chunk: int = 4096) -> tuple[np.ndarray, np.ndarray]:
    """Distância e índice do ponto mais próximo (força bruta em blocos; conjuntos pequenos)."""
    dist = np.empty(len(queries), dtype=np.float32)
    idx = np.empty(len(queries), dtype=np.int64)
    for start in range(0, len(queries), chunk):
        q = queries[start:start + chunk]
        d2 = ((q[:, None, :] - points[None, :, :]) ** 2).sum(-1)
        k = d2.argmin(1)
        idx[start:start + chunk] = k
        dist[start:start + chunk] = np.sqrt(d2[np.arange(len(q)), k])
    return dist, idx


def _bezier(p0, p1, p2, n: int = 400) -> np.ndarray:
    t = np.linspace(0.0, 1.0, n, dtype=np.float32)[:, None]
    p0, p1, p2 = (np.asarray(p, dtype=np.float32) for p in (p0, p1, p2))
    return (1 - t) ** 2 * p0 + 2 * (1 - t) * t * p1 + t * t * p2


def _hash_noise(shape: tuple[int, int], seed: int, sigma: float) -> np.ndarray:
    rng = np.random.default_rng(seed)
    n = blur(rng.standard_normal(shape).astype(np.float32), sigma)
    return n / max(float(n.std()), 1e-6)


# ---------------------------------------------------------------------------
# Parâmetros (cores em sRGB; todas as misturas são feitas em luz linear)
# ---------------------------------------------------------------------------

@dataclass
class Params:
    # Pele: albedo escolhido para que o render (estúdio neutro do pipeline e a cena do three.js)
    # fique no marrom quente das referências (realce #f09657, meio-tom #de7c3b, sombra #70310d).
    # Revisão (refine_face): matiz mais para o marrom-dourado (G/R maior), um pouco mais profundo e menos
    # rosado que #7c3206 — no AgX o antigo virava salmão alaranjado (testa ~#dd865c, matiz 19°).
    skin: str = "#723609"
    skin_gamma: float = 1.10           # contraste levemente maior das variações originais (pele escura)
    chroma_keep: float = 0.20          # fração da variação de croma original mantida (tira a maquiagem rosada/cinza)
    eye_halo_keep: float = 0.30        # fração da variação original (sombra cinza) mantida em volta dos olhos
    fill_iterations: int = 500
    eye_surround_mm: tuple[float, float] = (5.0, 11.0)          # entorno refeito: peso 1 até [0], zero em [1]
    uniform_factor: float = 0.93       # pele uniforme (base do pescoço, colo, braços novos) × albedo do rosto
    nails: str = "#9a6a58"
    neck_blend_mm: tuple[float, float] = (12.0, 55.0)
    # Marcos: a pálpebra interna (cavidade) abraça o globo ocular; a sobrancelha fica bem mais longe dele.
    socket_dist_mm: float = 9.5        # texel escuro a menos disso da superfície do globo = cavidade do olho
    # Sobrancelha nova (desenho analítico na projeção frontal |x|, z; ancorada na abertura do olho e na
    # altura da sobrancelha original, que acompanha o arco superciliar modelado)
    brow_color: str = "#1c0e07"
    brow_color_inner: str = "#28150b"  # início levemente mais claro/suave, como fios reais
    brow_start: float = -0.05          # início (fração da largura do olho a partir do canto interno)
    brow_end: float = 0.10             # fim da cauda além do canto externo (fração da largura do olho)
    brow_arch_s: float = 0.63          # posição do arco (0 = início, 1 = cauda)
    brow_raise_mm: float = 5.0         # sobe o arco em relação à linha central original
    brow_drop_mm: tuple[float, float] = (2.2, 8.5)                # queda da linha central: início, cauda
    brow_width_s: tuple[float, ...] = (0.0, 0.30, 0.60, 0.85, 1.0)
    brow_width_mm: tuple[float, ...] = (5.4, 5.6, 5.0, 3.0, 0.5)  # meia espessura ao longo de s
    brow_cap_mm: float = 2.2           # arredondamento dos cantos do início (rombudo, cantos suaves)
    brow_feather_mm: float = 0.45
    brow_opacity: float = 1.0
    # Olho: aro da cavidade (pálpebra interna), delineado superior, asa e linha inferior
    rim_upper: str = "#140a06"
    rim_lower_factor: float = 0.42     # linha d'água: pele escurecida e aquecida
    liner_color: str = "#140a06"
    liner_width_mm: tuple[float, float] = (0.55, 1.7)
    wing_mm: tuple[float, float] = (3.6, 2.2)                    # comprimento em |x| e subida em z
    lower_liner_opacity: float = 0.55
    lower_liner_color: str = "#2a150c"
    # Blush e lábios
    blush_mult: tuple[float, float, float] = (1.25, 0.97, 0.93)   # multiplicador linear no centro
    blush_strength: float = 0.95
    blush_center: tuple[float, float] = (0.012, -0.050)            # (dx, dz) relativo ao globo ocular
    blush_sigma_mm: float = 15.0
    lips: str = "#772c1c"
    lip_upper_factor: float = 0.86
    lip_line_factor: float = 0.70
    # Olhos
    iris_radius_px: float = 54.0
    pupil_radius_px: float = 21.0
    pupil: str = "#070403"
    iris_inner: str = "#24120a"
    iris_mid: str = "#3e2010"
    iris_outer: str = "#6a3c1c"
    limbal: str = "#0d0604"
    sclera: str = "#d6c8b8"
    sclera_lid_shadow: float = 0.22    # sombra pintada da pálpebra superior (o three.js não tem AO)
    # Boca
    teeth: str = "#d2c6b1"
    # profundidade (m) ATRÁS da frente dos lábios em que o escurecimento vai de f0 a f1. Relativa aos
    # lábios (não em y absoluto): muda junto quando a etapa 03 leva a boca para frente. Sem isso os
    # dentes laterais e o fundo saíam tão claros quanto os incisivos — um "anel" branco de canto a canto.
    mouth_depth: tuple[float, float] = (0.010, 0.030)
    bag_factor: tuple[float, float] = (0.45, 0.10)
    tongue_factor: tuple[float, float] = (0.70, 0.22)
    gums_factor: tuple[float, float] = (0.70, 0.25)
    teeth_factor: tuple[float, float] = (0.72, 0.16)  # os lábios não fazem sombra no three.js
    # Rugosidade (canal G do mapa metallic-roughness do glTF)
    rough_skin: float = 0.55
    rough_tzone: float = 0.62
    rough_brow: float = 0.85
    rough_lips: float = 0.42
    rough_lip_center: float = 0.38
    rough_socket: float = 0.70
    rough_iris: float = 0.10
    rough_sclera: float = 0.18
    rough_teeth: float = 0.28
    rough_gums: float = 0.36
    rough_tongue: float = 0.36
    rough_bag: float = 0.55
    rough_nails: float = 0.35


# ---------------------------------------------------------------------------
# Construção
# ---------------------------------------------------------------------------

def build(src_rgba: np.ndarray, maps: A.AtlasMaps, eye_center: np.ndarray, eye_radius: float, p: Params | None = None,
          debug: dict | None = None) -> tuple[np.ndarray, np.ndarray, dict]:
    """Devolve (cor sRGB HxWx3, metallic-roughness HxWx3 [R=1, G=rugosidade, B=metálico], relatório)."""
    p = p or Params()
    h, w = maps.shape
    lab = maps.label
    pos = maps.pos
    nrm = maps.normal
    src = src_rgba[..., :3].astype(np.float32)
    lin = to_lin(src)
    lum = lin @ LUMA
    src_lum_srgb = src @ LUMA
    U, V = A.texel_uv((h, w))
    X = np.abs(np.nan_to_num(pos[..., 0]))
    Y = np.nan_to_num(pos[..., 1])
    Z = np.nan_to_num(pos[..., 2])
    ecx, ecy, ecz = float(abs(eye_center[0])), float(eye_center[1]), float(eye_center[2])
    report: dict = {}

    head = lab == A.HEAD_SKIN
    skin_labels = (A.HEAD_SKIN, A.HAND, A.CHEST, A.RECT, A.ANKLE, A.OTHER)
    skin = np.isin(lab, skin_labels)
    out = lin.copy()

    # --- 1. Marcos do rosto (na textura ORIGINAL) --------------------------------------------------
    front = nrm[..., 1] < -0.2
    rel_x = X - ecx
    rel_z = Z - ecz
    # Distância até a superfície do globo ocular: a pele da cavidade (pálpebra interna) fica a poucos mm
    # dele; a sobrancelha, a mais de 12 mm. É isso que separa as duas regiões escuras (antes uma caixa
    # em z juntava o início da sobrancelha com a cavidade e o delineado contornava a sobrancelha).
    dist_eye = np.sqrt(rel_x ** 2 + (Y - ecy) ** 2 + rel_z ** 2) - eye_radius
    near_eye = head & (np.abs(rel_x) < 0.075) & (rel_z > -0.045) & (rel_z < 0.08)
    forehead = head & (np.abs(rel_x) < 0.07) & (rel_z > 0.06) & (rel_z < 0.09)
    if forehead.sum() < 500:
        raise RuntimeError("testa não encontrada (referência de luminância da pele)")
    dark = near_eye & (src_lum_srgb < 0.55 * float(np.median(src_lum_srgb[forehead])))
    socket_zone = near_eye & (dist_eye < p.socket_dist_mm / 1000) & (np.abs(rel_z) < 0.045)
    socket = dark & socket_zone
    brow0 = dark & (dist_eye >= p.socket_dist_mm / 1000) & (rel_z > 0.005) & (X > 0.004)
    if brow0.sum() < 200 or socket.sum() < 200:
        raise RuntimeError(f"marcos do rosto não encontrados (sobrancelha={int(brow0.sum())}, olho={int(socket.sum())})")
    report["brow_original_texels"] = int(brow0.sum())
    report["socket_texels"] = int(socket.sum())
    brow_line = _brow_centerline(X, Z, brow0)
    # Entorno do olho (sombra cinza/rosada "de maquiagem" do asset original): peso pela distância 3D até
    # a cavidade — 1 até `eye_surround_mm[0]`, some até `[1]`. Aqui a pele é refeita a partir da pele
    # limpa em volta (não da mediana global, que clareava o canto interno como uma mancha).
    sp = np.stack([X[socket], Y[socket], Z[socket]], axis=1)[::3]
    ring = near_eye & ~socket & (dist_eye < 0.03)
    ri = np.nonzero(ring)
    dist_sock = np.full((h, w), np.inf, dtype=np.float32)
    dist_sock[ri] = _nearest(sp, np.stack([X[ri], Y[ri], Z[ri]], axis=1))[0]
    s0, s1 = (v / 1000 for v in p.eye_surround_mm)
    halo_w = (1.0 - smoothstep(s0, s1, dist_sock)) * (head & ~socket)
    halo = halo_w > 0.02

    # --- 2. Pele: transferência de razão (luminância + parte do croma) em luz linear -------------
    base_sel = head & (lum > 0.45 * np.median(lum[head]))
    base = np.median(lin[base_sel], axis=0)
    target = hex_lin(p.skin)
    target_l = float(target @ LUMA)

    def transfer(mask: np.ndarray, tgt: np.ndarray, ref: np.ndarray, gamma: float, chroma_keep: float, flat: np.ndarray | None = None) -> None:
        ref_l = float(ref @ LUMA)
        tgt_l = float(tgt @ LUMA)
        li = lin[mask]
        l_in = np.maximum(li @ LUMA, 1e-6)
        r = np.clip(l_in / ref_l, 0.0, 2.5)
        keep = chroma_keep
        if flat is not None:
            f = flat[mask]
            r = r + (1.0 - r) * f * (r < 1.0)
            keep = chroma_keep * (1.0 - f)
        chroma = li / l_in[:, None]
        c = np.clip(chroma / (ref / ref_l), 0.5, 2.0)
        wgt = (smoothstep(0.25, 0.7, r) * keep)[:, None] if np.ndim(keep) else (smoothstep(0.25, 0.7, r) * keep)[:, None]
        oc = (tgt / tgt_l) * (1.0 + wgt * (c - 1.0))
        oc /= np.maximum(oc @ LUMA, 1e-6)[:, None]
        out[mask] = oc * (tgt_l * np.power(r, gamma))[:, None]

    transfer(skin, target, base, p.skin_gamma, p.chroma_keep)
    nails = lab == A.NAILS
    if nails.any():
        transfer(nails, hex_lin(p.nails), np.median(lin[nails], axis=0), 1.0, 0.5)
    report["skin_base_srgb"] = [int(round(c * 255)) for c in to_srgb(base)]

    # --- 3. Sobrancelha original: cobertura estimada e remoção -------------------------------------
    skin_ref = head & ~dark & (src_lum_srgb > 0.85 * float(np.median(src_lum_srgb[base_sel])))
    local_skin = masked_blur(src_lum_srgb, skin_ref, 14.0)
    core_l = float(np.percentile(src_lum_srgb[brow0], 20))
    a0 = np.clip((local_skin - src_lum_srgb) / np.maximum(local_skin - core_l, 1e-3), 0.0, 1.0)
    zc_orig = np.polyval(brow_line["fz"], np.clip(X, brow_line["x0"], brow_line["x1"]))
    brow_zone_soft = (head & (np.abs(Z - zc_orig) < 0.011) & (X > brow_line["x0"] - 0.005) & (X < brow_line["x1"] + 0.006)
                      & (dist_eye > 0.8 * p.socket_dist_mm / 1000))
    a0 = np.where(brow_zone_soft, a0, 0.0).astype(np.float32)
    a0 = a0 * (a0 > 0.04)
    hole = (blur((a0 > 0.0).astype(np.float32), 2.5) > 0.01) & head
    valid = head & ~hole & ~socket & ~halo
    fill = masked_blur(out, valid, 10.0)
    for sigma in (24.0, 48.0):  # buracos largos: raio maior só onde ainda falta suporte
        support = blur(valid.astype(np.float32), 10.0)
        weak = (hole | halo) & (support < 0.05)
        if not weak.any():
            break
        fill[weak] = masked_blur(out, valid, sigma)[weak]
    remove = np.clip(np.maximum(blur(hole.astype(np.float32), 1.5), np.clip(a0 * 3.0, 0, 1)), 0, 1) * head
    fill = harmonic_fill(out, head & (hole | halo | socket), head, fill, iterations=p.fill_iterations)
    # entorno do olho: pele limpa + uma fração da variação original (forma da pálpebra), sem manchas
    q = (out @ LUMA) / np.maximum(fill @ LUMA, 1e-6)
    surround = fill * np.clip(1.0 + p.eye_halo_keep * (q - 1.0), 0.6, 1.3)[..., None]
    out = out * (1 - halo_w[..., None]) + surround * halo_w[..., None]
    out = out * (1 - remove[..., None]) + fill * remove[..., None]
    report["brow_removed_texels"] = int(hole.sum())

    # --- 4. Lábios --------------------------------------------------------------------------------
    mouth_region = head & (X < 0.045) & (np.abs(Z - (ecz - 0.083)) < 0.03) & (Y < ecy - 0.02)
    gr = src[..., 1] / np.maximum(src[..., 0], 1e-4)
    lip_w = mouth_region * smoothstep(0.60, 0.545, gr) * smoothstep(0.30, 0.42, src_lum_srgb)
    lip_bin = lip_w > 0.5
    if lip_bin.sum() < 200:
        raise RuntimeError("máscara dos lábios não encontrada")
    lip_ref = np.median(lin[lip_bin], axis=0)
    lip_tgt = hex_lin(p.lips)
    mask_l = lip_w > 0.01
    saved = out.copy()
    transfer(mask_l, lip_tgt, lip_ref, 1.0, 0.4)
    lip_lin = out.copy()
    out[mask_l] = saved[mask_l]
    # lábio superior um pouco mais escuro: acima da linha média do lábio em cada |x|
    xs_l = X[lip_bin]
    zs_l = Z[lip_bin]
    bins = np.linspace(0.0, float(xs_l.max()) + 1e-4, 40)
    centers = []
    for b0, b1 in zip(bins[:-1], bins[1:]):
        m = (xs_l >= b0) & (xs_l < b1)
        if m.sum() > 5:
            centers.append(((b0 + b1) / 2, (zs_l[m].min() + zs_l[m].max()) / 2))
    centers = np.array(centers)
    zmid = np.interp(X, centers[:, 0], centers[:, 1])
    upper = smoothstep(-0.0008, 0.0012, Z - zmid)
    lip_lin *= (1.0 - (1.0 - p.lip_upper_factor) * upper)[..., None]
    # contorno: faixa fina dentro da borda da máscara. Os borrões enxergam a outra metade do rosto
    # através da costura central (UV espelhado), senão a linha média vira contorno.
    seam = seam_columns(X, head)
    bg = lab == A.NONE
    inner = blur(mirror_across_seam(lip_bin.astype(np.float32), seam, bg), 5.0)
    line = lip_bin * (1.0 - smoothstep(0.50, 0.80, inner))
    line = blur(mirror_across_seam(line.astype(np.float32), seam, bg), 1.2)
    lip_lin *= (1.0 - (1.0 - p.lip_line_factor) * np.clip(line * 1.6, 0, 1))[..., None]
    lip_soft = np.clip(blur(mirror_across_seam(lip_w.astype(np.float32), seam, bg), 1.0), 0, 1)
    report["face_seam_rows"] = int((seam >= 0).sum())
    out = out * (1 - lip_soft[..., None]) + lip_lin * lip_soft[..., None]
    report["lip_texels"] = int(lip_bin.sum())

    # --- 5. Pescoço → colo e antebraço uniformes --------------------------------------------------
    neck_ring_z = float(np.percentile(Z[head], 0.2))
    lo_mm, hi_mm = p.neck_blend_mm
    uniform = target * p.uniform_factor
    t_neck = head * smoothstep(neck_ring_z + hi_mm / 1000, neck_ring_z + lo_mm / 1000, Z)
    chest = np.isin(lab, (A.CHEST, A.RECT))
    out[chest] = uniform
    out = out * (1 - t_neck[..., None]) + uniform * t_neck[..., None]
    hand = lab == A.HAND
    hand_top_v = float(V[hand].max())
    t_hand = hand * smoothstep(hand_top_v - 0.040, hand_top_v - 0.010, V)
    out = out * (1 - t_hand[..., None]) + uniform * t_hand[..., None]
    report["uniform_skin_srgb"] = [int(round(c * 255)) for c in to_srgb(uniform)]
    report["neck_ring_z"] = round(neck_ring_z, 4)

    # --- 6. Blush (multiplicador quente e suave, em 3D) -------------------------------------------
    bc = np.array([ecx + p.blush_center[0], ecz + p.blush_center[1]], dtype=np.float32)
    cheek_pick = head & front & (np.abs(X - bc[0]) < 0.002) & (np.abs(Z - bc[1]) < 0.002)
    cheek_y = float(np.median(Y[cheek_pick])) if cheek_pick.any() else ecy - 0.06
    d2 = (X - bc[0]) ** 2 + (Z - bc[1]) ** 2 + (Y - cheek_y) ** 2
    blush = head * np.exp(-d2 / (2 * (p.blush_sigma_mm / 1000) ** 2)) * p.blush_strength
    mult = np.array(p.blush_mult, dtype=np.float32)
    out = out * (1.0 + blush[..., None] * (mult - 1.0))

    # --- 7. Sobrancelhas novas ---------------------------------------------------------------------
    boundary = socket & (blur((~socket & head).astype(np.float32), 1.0) > 0.05) & front
    if boundary.sum() < 50:
        raise RuntimeError("contorno da abertura do olho não encontrado")
    x_in, x_out = float(np.percentile(X[boundary], 0.5)), float(np.percentile(X[boundary], 99.5))
    brow_alpha, brow_info = _paint_brows(X, Z, head & (dist_eye > 0.004), brow_line, x_in, x_out, (h, w), p)
    t_in = np.clip(brow_info.pop("s_map"), 0, 1)
    tone = brow_info.pop("tone")
    c0, c1 = hex_lin(p.brow_color_inner), hex_lin(p.brow_color)
    brow_col = (c0 + (c1 - c0) * smoothstep(0.0, 0.30, t_in)[..., None]) * tone[..., None]
    out = out * (1 - brow_alpha[..., None]) + brow_col * brow_alpha[..., None]
    report["brow"] = brow_info

    # --- 8. Contorno dos olhos: aro superior escuro, linha d'água inferior, delineado + asa -------
    bx, bz = X[boundary], Z[boundary]
    by = Y[boundary]
    zlo = np.interp(bx, *_bin_extreme(bx, bz, np.min))
    zhi = np.interp(bx, *_bin_extreme(bx, bz, np.max))
    mx, mz = _bin_extreme(bx, bz, np.min)
    _, mz2 = _bin_extreme(bx, bz, np.max)
    zmid_eye = np.interp(X, mx, (mz + mz2) / 2)
    upper_rim = smoothstep(-0.0012, 0.0012, Z - zmid_eye)
    rim_up = hex_lin(p.rim_upper)
    rim_low = uniform * p.rim_lower_factor * np.array([1.08, 0.92, 0.9], dtype=np.float32)
    rim = rim_low * (1 - upper_rim[..., None]) + rim_up * upper_rim[..., None]
    sock_soft = np.clip(blur(socket.astype(np.float32), 0.7), 0, 1) * socket_zone
    out = out * (1 - sock_soft[..., None]) + rim * sock_soft[..., None]
    upper_pts = np.stack([bx, by, bz], axis=1)[bz > (zlo + zhi) / 2]
    lower_pts = np.stack([bx, by, bz], axis=1)[bz <= (zlo + zhi) / 2]
    eye_zone = head & ~socket & (np.abs(rel_x) < 0.055) & (np.abs(rel_z) < 0.045) & (Y < ecy + 0.01)
    ei = np.nonzero(eye_zone)
    eq = np.stack([X[ei], Y[ei], Z[ei]], axis=1)
    du, ku = _nearest(upper_pts, eq)
    su = np.clip((upper_pts[ku, 0] - x_in) / (x_out - x_in), 0, 1)
    wl0, wl1 = (v / 1000 for v in p.liner_width_mm)
    wu = wl0 + (wl1 - wl0) * smoothstep(0.05, 1.0, su) ** 1.3
    above = eq[:, 2] >= upper_pts[ku, 2] - 0.0006
    a_up = smoothstep(wu + 0.0004, wu - 0.0002, du) * above
    # asa: segmento a partir do canto externo superior
    corner = upper_pts[np.argmax(upper_pts[:, 0] + 0.35 * upper_pts[:, 2])]
    wing_end = corner[[0, 2]] + np.array([p.wing_mm[0], p.wing_mm[1]]) / 1000
    seg = wing_end - corner[[0, 2]]
    rq = eq[:, [0, 2]] - corner[[0, 2]]
    tseg = np.clip((rq @ seg) / float(seg @ seg), 0, 1)
    dseg = np.linalg.norm(rq - tseg[:, None] * seg[None, :], axis=1)
    wwing = wl1 * (1 - tseg) + 0.00015
    a_wing = smoothstep(wwing + 0.0003, wwing - 0.0002, dseg) * (eq[:, 0] > corner[0] - 0.002)
    dl, kl = _nearest(lower_pts, eq)
    sl = np.clip((lower_pts[kl, 0] - x_in) / (x_out - x_in), 0, 1)
    below = eq[:, 2] <= lower_pts[kl, 2] + 0.0004
    a_low = smoothstep(0.0008, 0.0002, dl) * below * smoothstep(0.30, 0.75, sl) * p.lower_liner_opacity
    upper_liner = np.zeros((h, w), dtype=np.float32)
    lower_liner = np.zeros((h, w), dtype=np.float32)
    upper_liner[ei] = np.clip(np.maximum(a_up, a_wing), 0, 1)
    lower_liner[ei] = np.clip(a_low, 0, 1)
    upper_liner = np.clip(blur(upper_liner, 0.5), 0, 1)
    lower_liner = np.clip(blur(lower_liner, 0.5), 0, 1)
    out = out * (1 - lower_liner[..., None]) + hex_lin(p.lower_liner_color) * lower_liner[..., None]
    out = out * (1 - upper_liner[..., None]) + hex_lin(p.liner_color) * upper_liner[..., None]
    liner = np.maximum(upper_liner, lower_liner)
    report["eye_opening_x"] = [round(x_in, 4), round(x_out, 4)]

    # --- 9. Olhos: íris procedural + esclera limpa -------------------------------------------------
    eye = lab == A.EYEBALL
    out = _paint_eyes(out, eye, pos, (h, w), p, report, ecz, eye_radius)

    # --- 10. Interior da boca (sem AO no three.js: escurece em direção à garganta) ---------------
    d0, d1 = p.mouth_depth
    lip_front_y = float(np.percentile(Y[lip_bin], 3))
    depth = smoothstep(d0, d1, Y - lip_front_y)
    report["lip_front_y"] = round(lip_front_y, 4)
    for label_id, (f0, f1) in ((A.MOUTH_BAG, p.bag_factor), (A.TONGUE, p.tongue_factor), (A.GUMS, p.gums_factor)):
        m = lab == label_id
        fac = f0 + (f1 - f0) * depth[m]
        out[m] = lin[m] * fac[:, None]
    teeth = lab == A.TEETH
    tl = lin[teeth] @ LUMA
    crown = float(np.percentile(tl, 80))
    tt = hex_lin(p.teeth)
    fac = p.teeth_factor[0] + (p.teeth_factor[1] - p.teeth_factor[0]) * depth[teeth]
    chroma = lin[teeth] / np.maximum(tl, 1e-6)[:, None]
    tone = np.clip(tl / crown, 0, 1.2)
    warm = (tt / float(tt @ LUMA)) * (1 - 0.35 * (1 - tone))[:, None] + chroma * (0.35 * (1 - tone))[:, None]
    warm /= np.maximum(warm @ LUMA, 1e-6)[:, None]
    out[teeth] = warm * (float(tt @ LUMA) * tone * fac)[:, None]

    # --- 11. Retângulo uniforme do colo (braços novos da etapa 03 mapeiam aqui) ------------------
    ys, xs = A.box_slices((h, w), A.UNIFORM_RECT)
    rect_ok = np.isin(lab[ys, xs], (A.NONE, A.RECT, A.CHEST))
    block = out[ys, xs]
    block[rect_ok] = uniform
    out[ys, xs] = block
    rect_mask = np.zeros((h, w), dtype=bool)
    rect_mask[ys, xs] = rect_ok

    # --- 12. Sangria + saída ---------------------------------------------------------------------
    painted = (lab != A.NONE) | rect_mask
    srgb = to_srgb(out)
    srgb = dilate_fill(srgb, painted, 12)
    grown = blur(painted.astype(np.float32), 6.0) > 0.001
    srgb[~grown & ~painted] = 0.0

    rough = _roughness(lab, X, Z, ecx, ecz, lip_soft, brow_alpha, liner, socket, eye, (h, w), p, painted, rect_mask)
    if debug is not None:
        debug.update(a0=a0, remove=remove, brow=brow_alpha, liner=liner, socket=socket.astype(np.float32), halo=halo_w, lips=lip_soft, blush=blush)
    return srgb, rough, report


def _bin_extreme(x: np.ndarray, z: np.ndarray, fn, n: int = 30) -> tuple[np.ndarray, np.ndarray]:
    edges = np.linspace(float(x.min()), float(x.max()) + 1e-6, n + 1)
    cx, cz = [], []
    for b0, b1 in zip(edges[:-1], edges[1:]):
        m = (x >= b0) & (x < b1)
        if m.sum() >= 3:
            cx.append((b0 + b1) / 2)
            cz.append(float(fn(z[m])))
    return np.array(cx), np.array(cz)


def _brow_centerline(X: np.ndarray, Z: np.ndarray, brow0: np.ndarray) -> dict:
    """Linha central (z em função de |x|) da sobrancelha ORIGINAL: média por faixa de 1 mm + cúbica."""
    xs, zs = X[brow0], Z[brow0]
    x0, x1 = float(np.percentile(xs, 1.0)), float(np.percentile(xs, 99.0))
    rows = []
    for b0 in np.arange(x0, x1, 0.001):
        m = (xs >= b0) & (xs < b0 + 0.001)
        if m.sum() >= 6:
            rows.append((b0 + 0.0005, float(np.median(zs[m])), float(m.sum())))
    rows = np.array(rows)
    if len(rows) < 20:
        raise RuntimeError("linha central da sobrancelha original não encontrada")
    fz = np.polyfit(rows[:, 0], rows[:, 1], 3, w=np.sqrt(rows[:, 2]))
    return {"fz": fz, "x0": x0, "x1": x1}


def _paint_brows(X, Z, head, line: dict, x_in: float, x_out: float, shape, p: Params) -> tuple[np.ndarray, dict]:
    """Sobrancelha nova desenhada na projeção frontal (|x|, z), como nas referências: início rombudo e
    grosso, parte interna quase horizontal, arco a ~60 % e cauda que desce e afina até a ponta.

    Âncoras: abertura do olho (x_in/x_out) para o comprimento; linha central da sobrancelha original
    (que acompanha o arco superciliar da malha) para a altura do arco. Bordas com leve franja de fios
    (ruído alongado na direção de crescimento) e uma variação tonal fina por dentro.
    Devolve alfa (H, W), `s_map` (posição ao longo da sobrancelha) e `tone` (multiplicador de cor).
    """
    h, w = shape
    width = x_out - x_in
    xa = x_in + p.brow_start * width
    xb = x_out + p.brow_end * width
    xk = xa + p.brow_arch_s * (xb - xa)
    z_arch = float(np.polyval(line["fz"], np.clip(xk, line["x0"], line["x1"]))) + p.brow_raise_mm / 1000
    d_in, d_out = (v / 1000 for v in p.brow_drop_mm)

    def center(x):
        ti = np.clip((xk - x) / (xk - xa), 0, None)
        to = np.clip((x - xk) / (xb - xk), 0, None)
        return z_arch - d_in * ti ** 2 - d_out * to ** 1.6

    def slope(x):
        ti = np.clip((xk - x) / (xk - xa), 0, None)
        to = np.clip((x - xk) / (xb - xk), 0, None)
        return 2 * d_in * ti / (xk - xa) - 1.6 * d_out * to ** 0.6 / (xb - xk)

    feather = p.brow_feather_mm / 1000
    zone = head & (X > xa - 0.004) & (X < xb + 0.004) & (np.abs(Z - center(X)) < 0.012)
    qi = np.nonzero(zone)
    x, z = X[qi].astype(np.float64), Z[qi].astype(np.float64)
    s = np.clip((x - xa) / (xb - xa), 0.0, 1.0)
    half = np.interp(s, p.brow_width_s, p.brow_width_mm) / 1000
    d = (z - center(x)) / np.sqrt(1 + slope(x) ** 2)          # distância perpendicular (assinada)
    # fios: direção de crescimento vai de ~70° (início, para cima) a ~12° (cauda, ao longo)
    ang = np.radians(70.0 - 58.0 * smoothstep(0.0, 0.45, s))
    along = x * 1000
    stroke = x * np.sin(ang) * 1000 - (z - z_arch) * np.cos(ang) * 1000   # mm, perpendicular aos fios
    rng = np.random.default_rng(7)
    fringe = np.zeros_like(x)
    for freq, amp in ((1 / 0.55, 0.5), (1 / 0.33, 0.3), (1 / 0.21, 0.2)):
        fringe += amp * np.sin(stroke * freq * 2 * np.pi + rng.uniform(0, 2 * np.pi) + 1.3 * np.sin(along * 0.9))
    edge = half + fringe * feather * 0.55
    a = smoothstep(edge + feather, edge - 0.6 * feather, np.abs(d))
    # início rombudo com cantos arredondados; cauda em ponta
    cap = xa + (p.brow_cap_mm / 1000) * np.clip(np.abs(d) / np.maximum(half, 1e-6), 0, 1.5) ** 2.5
    a *= smoothstep(cap - 0.5 * feather, cap + feather, x)
    a *= smoothstep(xb + 0.5 * feather, xb - feather, x)
    alpha = np.zeros((h, w), dtype=np.float32)
    alpha[qi] = np.clip(a, 0, 1) * p.brow_opacity
    alpha = np.clip(blur(alpha, 0.5), 0, 1)
    s_map = np.ones((h, w), dtype=np.float32)
    s_map[qi] = s
    # tom: fios levemente mais claros na metade de baixo do início; estrias finas ao longo dos fios
    streak = np.zeros_like(x)
    for freq in (1 / 0.42, 1 / 0.27):
        streak += np.sin(stroke * freq * 2 * np.pi + rng.uniform(0, 2 * np.pi)) / 2
    t = 1.0 + 0.10 * streak + 0.10 * smoothstep(0.0, 1.0, -d / np.maximum(half, 1e-6)) * (1 - smoothstep(0.1, 0.5, s))
    tone = np.ones((h, w), dtype=np.float32)
    tone[qi] = t
    info = {
        "x_range_mm": [round(xa * 1000, 1), round(xb * 1000, 1)],
        "arch_mm": [round(xk * 1000, 1), round(z_arch * 1000, 1)],
        "thickness_mm": [round(2 * v, 1) for v in p.brow_width_mm],
        "s_map": s_map,
        "tone": tone,
    }
    return alpha, info


def _iris_geometry(pos: np.ndarray, eye: np.ndarray, shape: tuple[int, int]) -> tuple[float, float, float]:
    """Centro do polo (px) e ângulo, no espaço UV, que aponta para baixo (−z) no globo."""
    h, w = shape
    pu, pv = A.IRIS_POLE_UV[0] * w - 0.5, A.IRIS_POLE_UV[1] * h - 0.5
    ys, xs = A.box_slices(shape, A.BOX_EYE_FRONT)
    yy, xx = np.mgrid[ys, xs]
    rr = np.hypot(xx - pu, yy - pv)
    ring = eye[ys, xs] & (np.abs(rr - 40) < 1.0)
    angle = np.arctan2(yy - pv, xx - pu)[ring]
    z = pos[ys, xs][..., 2][ring]
    # ajuste z ~ a + b cos(θ) + c sin(θ): direção de −z é atan2(−c, −b)
    M = np.stack([np.ones_like(angle), np.cos(angle), np.sin(angle)], axis=1)
    coef, *_ = np.linalg.lstsq(M, z, rcond=None)
    down = math.atan2(-coef[2], -coef[1])
    return pu, pv, down


def _paint_eyes(out: np.ndarray, eye: np.ndarray, pos: np.ndarray, shape, p: Params, report: dict, ecz: float, radius: float) -> np.ndarray:
    h, w = shape
    pu, pv, down = _iris_geometry(pos, eye, shape)
    R = p.iris_radius_px
    # Esclera limpa: cor quente uniforme, leve sombreamento só longe do polo (laterais, cobertas pelas
    # pálpebras) e sombra do limbo logo fora da íris. Nenhuma herança do anel cinza original.
    yy, xx = np.mgrid[0:h, 0:w]
    rr_full = np.hypot(xx - pu, yy - pv).astype(np.float32)
    ex = eye
    rr = rr_full[ex]
    shade = 1.0 - 0.30 * smoothstep(R * 1.8, R * 4.0, rr)
    shade *= 1.0 - 0.14 * np.exp(-(((rr - R * 1.02) / (R * 0.16)) ** 2))
    zr = (pos[..., 2][ex] - ecz) / radius       # metade de cima do globo: sombra da pálpebra superior
    shade *= 1.0 - p.sclera_lid_shadow * smoothstep(-0.05, 0.55, zr) * smoothstep(R * 0.9, R * 1.3, rr)
    out[ex] = hex_lin(p.sclera) * shade[:, None]
    # Íris supersampleada 4×4
    rad = R + 3
    x0, x1 = int(pu - rad) - 1, int(pu + rad) + 2
    y0, y1 = int(pv - rad) - 1, int(pv + rad) + 2
    ss = 4
    sy, sx = np.mgrid[y0 * ss:(y1 + 1) * ss, x0 * ss:(x1 + 1) * ss].astype(np.float32)
    sx = (sx + 0.5) / ss - 0.5
    sy = (sy + 0.5) / ss - 0.5
    dx, dy = sx - pu, sy - pv
    rrs = np.hypot(dx, dy)
    th = np.arctan2(dy, dx)
    rn = rrs / R
    rp = p.pupil_radius_px / R
    t = np.clip((rn - rp) / (1 - rp), 0, 1)
    inner, mid, outer, limb = (hex_lin(c) for c in (p.iris_inner, p.iris_mid, p.iris_outer, p.limbal))
    col = np.where((t < 0.40)[..., None], inner + (mid - inner) * (t / 0.40)[..., None],
                   mid + (outer - mid) * np.clip((t - 0.40) / 0.40, 0, 1)[..., None])
    rng = np.random.default_rng(11)
    fib = np.zeros_like(th)
    for freq in (13, 23, 37, 61, 89):
        fib += np.sin(th * freq + rng.uniform(0, 2 * np.pi) + 2.2 * np.sin(rn * rng.uniform(3, 7))) / math.sqrt(freq)
    fib /= np.abs(fib).max()
    col *= (1.0 + 0.18 * fib * smoothstep(0.02, 0.2, t))[..., None]
    # colarete (anel levemente mais claro perto da pupila) e iluminação pintada: baixo mais claro, topo sombreado
    col *= (1.0 + 0.15 * np.exp(-((t - 0.20) / 0.07) ** 2))[..., None]
    lower = np.cos(th - down)
    col *= (1.0 + 0.35 * np.clip(lower, 0, 1) * smoothstep(0.25, 0.8, t) - 0.25 * np.clip(-lower, 0, 1) * smoothstep(0.1, 0.9, t))[..., None]
    limb_t = smoothstep(0.80, 0.97, rn)
    col = col * (1 - limb_t[..., None]) + limb * limb_t[..., None]
    pupil_a = smoothstep(rp + 0.025, rp - 0.01, rn)
    col = col * (1 - pupil_a[..., None]) + hex_lin(p.pupil) * pupil_a[..., None]
    iris_a = smoothstep(1.04, 0.985, rn)
    col = col.reshape(y1 - y0 + 1, ss, x1 - x0 + 1, ss, 3).mean((1, 3))
    iris_a = iris_a.reshape(y1 - y0 + 1, ss, x1 - x0 + 1, ss).mean((1, 3))
    region = eye[y0:y1 + 1, x0:x1 + 1]
    blk = out[y0:y1 + 1, x0:x1 + 1]
    blended = blk * (1 - iris_a[..., None]) + col * iris_a[..., None]
    blk[region] = blended[region]
    out[y0:y1 + 1, x0:x1 + 1] = blk
    report["iris"] = {"pole_px": [round(pu, 1), round(pv, 1)], "down_deg": round(math.degrees(down), 1),
                      "iris_radius_px": R, "pupil_radius_px": p.pupil_radius_px}
    return out


def _roughness(lab, X, Z, ecx, ecz, lip_soft, brow_alpha, liner, socket, eye, shape, p: Params, painted, rect_mask) -> np.ndarray:
    h, w = shape
    g = np.full((h, w), p.rough_skin, dtype=np.float32)
    head = lab == A.HEAD_SKIN
    tz = head * np.exp(-((X / 0.018) ** 2)) * smoothstep(ecz - 0.07, ecz - 0.03, Z) * smoothstep(ecz + 0.10, ecz + 0.05, Z)
    g = g + (p.rough_tzone - p.rough_skin) * tz
    g = g * (1 - brow_alpha) + p.rough_brow * brow_alpha
    g = g * (1 - liner) + p.rough_brow * liner
    lipc = lip_soft * np.exp(-((X / 0.012) ** 2))
    g = g * (1 - lip_soft) + (p.rough_lips + (p.rough_lip_center - p.rough_lips) * lipc) * lip_soft
    g[socket] = p.rough_socket
    pu, pv = A.IRIS_POLE_UV[0] * w - 0.5, A.IRIS_POLE_UV[1] * h - 0.5
    yy, xx = np.mgrid[0:h, 0:w]
    rr = np.hypot(xx - pu, yy - pv)
    g[eye] = np.where(rr[eye] < p.iris_radius_px + 2, p.rough_iris, p.rough_sclera)
    for label_id, value in ((A.TEETH, p.rough_teeth), (A.GUMS, p.rough_gums), (A.TONGUE, p.rough_tongue),
                            (A.MOUTH_BAG, p.rough_bag), (A.NAILS, p.rough_nails)):
        g[lab == label_id] = value
    g[rect_mask] = p.rough_skin
    rough = np.zeros((h, w, 3), dtype=np.float32)
    rough[..., 0] = 1.0
    rough[..., 1] = g
    rough[..., 2] = 0.0
    rough = dilate_fill(rough, painted.copy(), 12)
    return rough
