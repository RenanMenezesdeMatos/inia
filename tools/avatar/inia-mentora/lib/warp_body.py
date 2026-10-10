"""Campos do CORPO da etapa 03 (tronco, pescoço, membros, busto, cabeça mais baixa).

Modelo do campo (mundo, Z para cima):
    d(p) = (1 − Σ Aₗ(p)) · d_tronco(p) + Σ Aₗ(p) · (δₗ + d_radialₗ(p)) + d_busto(p)
- d_tronco: escala em x em torno do plano médio e em y em torno do eixo da coluna (frente/costas com
  fatores próprios), perfis por altura ancorados nos ossos (quadril, cintura, busto, ombro, pescoço);
  acima do ombro só a coluna do pescoço é escalada (o queixo/rosto não). Inclui o abaixamento da
  cabeça (pescoço mais curto): translação −D·s(z) que vale 1 da mandíbula para cima (cabeça rígida).
- Membros (braços/pernas): Aₗ = pertencimento suave à cadeia de ossos (ombro→cotovelo→punho→dedos;
  quadril→joelho→tornozelo→dedos). O membro inteiro translada por δₗ = d_tronco(junta raiz) — o braço
  acompanha o ombro alargado sem deformar — e ganha volume radial em torno do eixo dos ossos. No braço:
  radial uniforme no braço/antebraço, pulso oval (extra no plano da palma), mão com escala anisotrópica
  afim no referencial da mão (largura × espessura × comprimento), e o cotovelo desliza ao longo da
  cadeia (braço estica, antebraço encurta; ombro e pulso fixos). Pés sem mudança.
- Polegar (`ThumbField`): falange distal encurtada e mais grossa na ponta (sem "garra").
- Busto: deslocamentos suaves centrados na ponta dos ossos breast_*_ph.
"""
from __future__ import annotations

import numpy as np

from warp_core import FunctionField, RadialOffset, Warp, piecewise_profile, smootherstep, smoothstep
from warp_landmarks import spine_y_at

BODY_DEFAULTS: dict = {
    # fatores de escala do tronco (valor = fator − 1) por marco de altura. As referências mostram um
    # corpo ~1,35–1,5× mais largo que o do asset (medido com a cabeça na mesma escala, U = olhos→queixo).
    "sx": {"hip": 0.32, "waist": 0.36, "bust": 0.32, "shoulder": 0.30, "neck": 0.45},
    "sy_front": {"hip": 0.22, "waist": 0.30, "bust": 0.20, "shoulder": 0.10, "neck": 0.35},
    "sy_back": {"hip": 0.26, "waist": 0.18, "bust": 0.20, "shoulder": 0.22, "neck": 0.20},
    "neck_column_radius": 0.05,    # raio de saturação do alargamento do pescoço (acima do ombro)
    "head_drop_mm": 25.0,          # pescoço mais curto: a cabeça desce isso (rígida)
    # volume do braço: radial UNIFORME no braço/antebraço (o formato anatômico vem da etapa 02,
    # outfit_arms.py); no pulso, extra no plano da palma (pulso oval); na mão, escala ANISOTRÓPICA em
    # torno do eixo da mão (largura da palma/dedos e espessura; comprimento opcional a partir do
    # pulso) — afim dentro da mão, então dedos não se cruzam e as juntas acompanham.
    "arm_fullness": {"upper": 0.30, "fore": 0.30, "wrist": 0.26, "wrist_across": 0.10,
                     "hand_across": 0.20, "hand_normal": 0.14, "hand_length": -0.04},
    # pertencimento ao braço: raio pequeno no braço (não pegar tronco/axila); do antebraço em diante
    # maior, para a mão inteira (ponta do polegar a ~7 cm do eixo) andar junto — senão o alargamento
    # do tronco (escala em x) vazava para a ponta do polegar e esticava o dedo.
    "arm_membership": {"s": (-0.05, 0.06), "r": (0.06, 0.12), "r_hand": (0.11, 0.16)},
    # o asset tem braço CURTO e antebraço longo (227 × 235 mm; adulto real ≈ 1,3 : 1) — cotovelo alto,
    # que lê como membro de criança. O cotovelo desce ao longo do braço (ombro e pulso ficam onde estão):
    # braço estica e antebraço encurta de forma linear em cada segmento; juntas acompanham.
    "arm_elbow_shift_mm": 36.0,
    # polegar do asset: falange distal longa (47 mm) terminando em ponta fina — lê como garra. Encurta a
    # falange distal (fração do comprimento, em direção à junta Thumb3) e engrossa o polegar a partir da
    # falange proximal (mais na ponta, para arredondar).
    "thumb": {"distal_shorten": 0.25, "girth": 0.12, "girth_tip": 0.32, "membership_r": (0.016, 0.026)},
    "leg_fullness": {"thigh": 0.24, "calf": 0.12},
    "leg_membership": {"s": (-0.02, 0.08), "r": (0.11, 0.15)},
    "bust_mm": {"forward": 24.0, "out": 6.0, "down": 14.0},
    "bust_radii": (0.10, 0.11, 0.10),
}


def _chain_projection(P: np.ndarray, chain: list[np.ndarray], sigma: float = 0.015):
    """Projeção suave numa polilinha: distância, abscissa s (0 na 1ª junta), vetor radial p − c e
    tangente, como médias ponderadas pelos segmentos mais próximos (sem salto nas dobras de
    cotovelo/joelho)."""
    pts = [np.asarray(c, float) for c in chain]
    dists, abscissas, radials, units = [], [], [], []
    acc = 0.0
    for a, b in zip(pts[:-1], pts[1:]):
        ab = b - a
        L2 = float(ab @ ab)
        units.append(ab / np.sqrt(L2))
        t = np.clip(((P - a) @ ab) / L2, 0.0, 1.0)
        c = a[None, :] + t[:, None] * ab[None, :]
        r = P - c
        dists.append(np.linalg.norm(r, axis=1))
        abscissas.append(acc + t * np.sqrt(L2))
        radials.append(r)
        acc += np.sqrt(L2)
    # abscissa negativa antes da 1ª junta (dentro do tronco) para o pertencimento
    a, b = pts[0], pts[1]
    u = (b - a) / np.linalg.norm(b - a)
    before = (P - a) @ u
    abscissas[0] = np.where(before < 0, before, abscissas[0])
    D = np.stack(dists)
    w = np.exp(-((D - D.min(0)) ** 2) / (2 * sigma ** 2))
    w /= w.sum(0)
    d = (w * D).sum(0)
    s = (w * np.stack(abscissas)).sum(0)
    rad = np.einsum("kn,knj->nj", w, np.stack(radials))
    lengths = [float(np.linalg.norm(b - a)) for a, b in zip(pts[:-1], pts[1:])]
    tan = w.T @ np.stack(units)
    tan /= np.linalg.norm(tan, axis=1, keepdims=True)
    return d, s, rad, lengths, tan


class BodyField:
    """Campo do corpo inteiro (tronco + pescoço + cabeça + membros); ver docstring do módulo."""

    def __init__(self, body: dict, face: dict, params: dict | None = None):
        self.p = p = {**BODY_DEFAULTS, **(params or {})}
        self.body = body
        hip_z = float(body["Left_leg_chain"][0][2])
        waist_z = float(body["Spine"][2])
        bust_z = float(body["Left_breast"][0][2]) if "Left_breast" in body else (waist_z + float(body["Spine2"][2])) / 2
        shoulder_z = float(body["Left_arm_chain"][0][2])
        neck_z = float(body["Neck"][2])
        chin_z = float(face["chin_z"])
        self.z_marks = {"hip": hip_z, "waist": waist_z, "bust": bust_z, "shoulder": shoulder_z, "neck": neck_z, "chin": chin_z}

        def knots(key: str) -> list[tuple[float, float]]:
            v = p[key]
            return [(hip_z - 0.15, 0.0), (hip_z, v["hip"]), (waist_z, v["waist"]), (bust_z, v["bust"]),
                    (shoulder_z, v["shoulder"]), (neck_z + 0.02, v["neck"]), (chin_z - 0.01, v["neck"]),
                    (chin_z + 0.012, 0.0)]
        self.k_sx, self.k_syf, self.k_syb = knots("sx"), knots("sy_front"), knots("sy_back")
        self.z_sh = shoulder_z + 0.03
        self.drop = p["head_drop_mm"] / 1000
        self.drop_z = (neck_z - 0.02, chin_z - 0.005)
        ring = face.get("ring_positions")
        self.neck_front_y = float(ring[:, 1].min()) if ring is not None and len(ring) else float(body["Neck"][1]) - 0.045
        self.limbs = []
        for side in ("Left", "Right"):
            arm = body[f"{side}_arm_chain"]
            self.limbs.append(("arm", side, arm, p["arm_membership"]))
            self.limbs.append(("leg", side, body[f"{side}_leg_chain"], p["leg_membership"]))
        # direção "através da palma" (indicador → mínimo) de cada mão, para o pulso oval e a mão
        self.hand_across = {side: np.asarray(body[f"{side}_hand_across"], float) for side in ("Left", "Right")}
        self.deltas = {}
        for kind, side, chain, _ in self.limbs:
            self.deltas[(kind, side)] = self.trunk(np.asarray(chain[0], float)[None, :])[0]

    # ---------------------------------------------------------------- tronco + pescoço + cabeça
    def trunk(self, P: np.ndarray) -> np.ndarray:
        p = self.p
        x, y, z = P[:, 0], P[:, 1], P[:, 2]
        yc = spine_y_at(self.body, z)
        sx = piecewise_profile(z, self.k_sx)
        syf = piecewise_profile(z, self.k_syf)
        syb = piecewise_profile(z, self.k_syb)
        back = smoothstep(yc - 0.03, yc + 0.03, y)
        sy = syf + (syb - syf) * back
        r = np.sqrt(x ** 2 + (y - yc) ** 2)
        # abaixo do ombro: escala simples; acima: coluna do pescoço com alargamento SATURADO
        # (escala perto do eixo, deslocamento constante a partir do raio do pescoço) sumindo em r
        a = p["neck_column_radius"]
        sat = a * np.tanh(r / a) / np.maximum(r, 1e-9)
        fade = 1.0 - smootherstep(a + 0.02, a + 0.10, r)
        neck = smootherstep(self.z_sh, self.z_sh + 0.05, z)
        # região varrida pelo queixo no jawOpen/jawForward (na frente do pescoço, abaixo do queixo):
        # sem alargamento do pescoço e com a descida INTEIRA da cabeça — senão mexer a mandíbula
        # mudaria o quanto o campo empurra o queixo (a key amplificaria/encolheria)
        front = 1.0 - smootherstep(self.neck_front_y - 0.045, self.neck_front_y + 0.005, y)
        s2 = smootherstep(self.drop_z[1] - 0.075, self.drop_z[1] - 0.04, z)
        gain = (1.0 - neck) + neck * sat * fade * (1.0 - front * s2)
        out = np.zeros_like(P)
        out[:, 0] = sx * x * gain
        out[:, 1] = sy * (y - yc) * gain
        # cabeça desce rígida da mandíbula para cima
        s1 = smootherstep(self.drop_z[0], self.drop_z[1], z)
        out[:, 2] = -self.drop * (s1 + (1.0 - s1) * front * s2)
        return out

    # ---------------------------------------------------------------- membros
    def _limb(self, kind: str, side: str, chain, member, P: np.ndarray):
        d, s, rad, lengths, tan = _chain_projection(P, chain)
        s0, s1 = member["s"]
        r0, r1 = member["r"]
        if "r_hand" in member:
            k = smootherstep(lengths[0] + 0.02, lengths[0] + 0.08, s)
            r0 = r0 + (member["r_hand"][0] - r0) * k
            r1 = r1 + (member["r_hand"][1] - r1) * k
        A = smootherstep(s0, s1, s) * (1.0 - smootherstep(r0, r1, d))
        if kind == "leg":
            f = self.p["leg_fullness"]
            up = lengths[0]
            low = lengths[1]
            prof = [(0.03, 0.0), (0.10, f["thigh"]), (0.6 * up, f["thigh"]), (up, 0.5 * f["thigh"]),
                    (up + 0.5 * low, f["calf"]), (up + low, 0.0)]
            return A, piecewise_profile(s, prof)[:, None] * rad
        f = self.p["arm_fullness"]
        up, fore = lengths[0], lengths[1]
        wrist = up + fore
        # radial isotrópico: uniforme no braço/antebraço, some logo depois do pulso (a mão tem a sua)
        iso = piecewise_profile(s, [(0.0, 0.0), (0.10, f["upper"]), (up, f["upper"]), (up + 0.6 * fore, f["fore"]),
                                    (wrist, f["wrist"]), (wrist + 0.03, 0.0)])
        # extras no referencial da mão: "across" = indicador → mínimo (plano da palma), "normal" = dorso/palma
        g_x = piecewise_profile(s, [(up + 0.45 * fore, 0.0), (wrist, f["wrist_across"]), (wrist + 0.03, f["hand_across"])])
        g_n = piecewise_profile(s, [(wrist, 0.0), (wrist + 0.03, f["hand_normal"])])
        ex = np.asarray(self.hand_across[side], float)[None, :]
        ex = ex - tan * np.einsum("ij,ij->i", tan, np.broadcast_to(ex, tan.shape))[:, None]
        ex /= np.linalg.norm(ex, axis=1, keepdims=True)
        en = np.cross(tan, ex)
        rx = np.einsum("ij,ij->i", rad, ex)
        rn = np.einsum("ij,ij->i", rad, en)
        out = iso[:, None] * rad + (g_x * rx)[:, None] * ex + (g_n * rn)[:, None] * en
        shift = self.p["arm_elbow_shift_mm"] / 1000
        if shift:
            along = np.interp(s, [0.0, up, wrist], [0.0, shift, 0.0])
            out += along[:, None] * tan
        if f.get("hand_length", 0.0):
            beyond = np.clip(s - wrist, 0.0, None) * smootherstep(wrist - 0.01, wrist + 0.01, s)
            out += (f["hand_length"] * beyond)[:, None] * tan
        return A, out

    def __call__(self, P: np.ndarray) -> np.ndarray:
        P = np.asarray(P, float)
        total_A = np.zeros(len(P))
        limb_part = np.zeros_like(P)
        for kind, side, chain, member in self.limbs:
            A, radial = self._limb(kind, side, chain, member, P)
            total_A += A
            limb_part += A[:, None] * (self.deltas[(kind, side)][None, :] + radial)
        total_A = np.clip(total_A, 0.0, 1.0)
        return (1.0 - total_A)[:, None] * self.trunk(P) + limb_part


class ThumbField:
    """Correção local do polegar (ver `BODY_DEFAULTS["thumb"]`), somada ao campo do corpo."""

    def __init__(self, chains: list, params: dict):
        self.chains = [[np.asarray(c, float) for c in chain] for chain in chains]
        self.p = params

    def __call__(self, P: np.ndarray) -> np.ndarray:
        P = np.asarray(P, float)
        out = np.zeros_like(P)
        p = self.p
        r0, r1 = p["membership_r"]
        for chain in self.chains:
            d, s, rad, lengths, tan = _chain_projection(P, chain, sigma=0.006)
            s2 = lengths[0]                   # junta Thumb2 (início da falange proximal)
            s3 = lengths[0] + lengths[1]      # junta Thumb3 (início da falange distal)
            end = s3 + lengths[2]
            A = smootherstep(s2 - 0.012, s2 + 0.004, s) * (1.0 - smootherstep(end + 0.004, end + 0.014, s))
            A = A * (1.0 - smootherstep(r0, r1, d))
            grow = piecewise_profile(s, [(s2, p["girth"]), (s3, p["girth"]), (end, p["girth_tip"])])
            u3 = (chain[3] - chain[2]) / lengths[2]
            pull = -p["distal_shorten"] * np.clip(s - s3, 0.0, None)
            out += A[:, None] * (grow[:, None] * rad + pull[:, None] * u3[None, :])
        return out


def add_body(warp: Warp, body: dict, face: dict, params: dict | None = None) -> BodyField:
    field = BodyField(body, face, params)
    warp.add(FunctionField("body", field))
    chains = [body[f"{side}_thumb_chain"] for side in ("Left", "Right") if f"{side}_thumb_chain" in body]
    if chains and field.p.get("thumb"):
        warp.add(FunctionField("thumb", ThumbField(chains, field.p["thumb"])))
    p = field.p
    b = p["bust_mm"]
    for side in ("Left", "Right"):
        if f"{side}_breast" not in body:
            continue
        head, tail = body[f"{side}_breast"]
        sgn = np.sign(tail[0])
        off = (sgn * b["out"] / 1000, -b["forward"] / 1000, -b["down"] / 1000)
        warp.add(RadialOffset(f"bust_{side}", tuple(tail), p["bust_radii"], off))
    return field
