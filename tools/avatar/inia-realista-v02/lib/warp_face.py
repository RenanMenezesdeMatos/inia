"""Campos do ROSTO da etapa 03, construídos a partir dos marcos (`warp_landmarks.face_landmarks`).

Todas as distâncias são em unidades de rosto U (olhos→queixo) ou em mm; os centros são marcos medidos.
Os campos do rosto são multiplicados por uma máscara que zera tudo perto dos globos oculares
(pálpebras e órbitas ficam onde estão, então os olhos rígidos continuam encaixados). Os olhos NÃO são
escalados: os globos quase se tocam na linha média (folga de ~3 mm), então qualquer escala por olho
dobraria a malha entre eles.
"""
from __future__ import annotations

import numpy as np

from warp_core import FunctionField, LocalScale, Masked, RadialOffset, SaturatingScale, Warp, piecewise_profile, smootherstep, smoothstep

# Parâmetros padrão (ajustados comparando com ref_front/threequarter/profile; ver 03_proportions.py).
FACE_DEFAULTS: dict = {
    # alargamento da mandíbula/bochecha baixa/queixo: fator em x por profundidade d = (olhos − z)/U
    "lower_face_width": 0.18,
    "lower_face_profile": [(0.12, 0.0), (0.62, 1.0), (0.80, 1.0), (1.00, 1.15), (1.50, 1.15), (1.75, 0.0)],
    "cheek_mm": 4.5,            # maçãs do rosto: para fora/frente (7 escondia o nariz em 3/4)
    "cheek_radius_u": 0.50,
    "jowl_mm": 2.5,             # bochecha baixa
    "midcheek_mm": 2.5,         # bochecha média (entre maçã e mandíbula)
    "midcheek_radius_u": 0.36,
    "jaw_forward_mm": 2.5,      # boca + queixo (lábios, dentes, interior) para frente, constante na mandíbula
                                # (7,5 fazia um "focinho" no perfil)
    "mouth_up_mm": 1.5,
    "mouth_width": 0.13,        # largura da boca (alargamento saturado nos cantos): ~50 mm, adulta.
                                # 0,42 dava ~64 mm e uma boca achatada, "de boneco"
    "mouth_interior_ratio": 0.4,  # fração do alargamento aplicada a dentes/interior da boca
    "lip_thickness": 0.14,      # altura dos lábios (escala z suave em torno da rima)
    "lip_forward_mm": 0.6,
    "nose_width": 0.08,         # asas do nariz: escala x ~ +8 % na asa (a base já tem ~37 mm, adulta);
                                # 0,20 + ponta +45 % deixavam o nariz enorme e achatado
    "nose_saturation": 1.6,     # meia-largura de saturação em múltiplos de |x| da asa
    "nose_support_x_u": 0.40,   # suporte do alargamento (U): largo em z para não vincar o sulco
    "nose_support_z_u": 0.22,
    "nose_tip_round": 0.18,     # ponta: escala local x (+18 %) e z (+9 %) — ponta redonda
    "nose_tip_drop_mm": 0.6,
    "valley_mm": 1.0,           # vale nariz-bochecha preenchido (para frente)
    "valley_z_u": 0.09,    # ponta levemente mais cheia para baixo/frente
    "nose_forward_mm": 3.0,     # projeção do nariz (ponta + dorso baixo) para frente
    "eye_guard_mm": (4.0, 22.0),  # máscara: 0 até r_olho + 4 mm, 1 a partir de r_olho + 22 mm
}


def eye_guard(lm: dict, inner_mm: float, outer_mm: float):
    """m(P): 0 dentro de r_olho + inner, 1 além de r_olho + outer (produto dos dois olhos)."""
    centers = [np.asarray(lm["eye_l"]), np.asarray(lm["eye_r"])]
    r = lm["eye_radius"]

    def mask(P: np.ndarray) -> np.ndarray:
        m = np.ones(len(P))
        for c in centers:
            d = np.linalg.norm(P - c[None, :], axis=1)
            m *= smootherstep(r + inner_mm / 1000, r + outer_mm / 1000, d)
        return m
    return mask


def build_face_fields(lm: dict, params: dict | None = None) -> list:
    p = {**FACE_DEFAULTS, **(params or {})}
    U = lm["U"]
    eye_z = float(lm["eye"][2])
    mm = 1e-3
    fields = []

    # Região varrida pela mandíbula (jawOpen/mouthClose levam lábio inferior e queixo até ~6 cm abaixo):
    # os campos da boca/queixo são CONSTANTES (ou lineares) nela, para que combinações de shape keys
    # somadas linearmente continuem fechando os lábios (erro de 2ª ordem ~ curvatura de f × Δ1 × Δ2).
    chin_z, subn_z = lm["chin_z"], float(lm["subnasale"][2])
    slit, ulip = lm["slit"], lm["upper_lip"]
    slit_y = float(slit[1])

    def jaw_slab(P: np.ndarray) -> np.ndarray:
        z, y = P[:, 2], P[:, 1]
        wz = smootherstep(chin_z - 0.095, chin_z - 0.065, z) * (1.0 - smootherstep(subn_z + 0.002, subn_z + 0.03, z))
        return wz * (1.0 - smootherstep(slit_y + 0.035, slit_y + 0.10, y))

    # 1. mandíbula/bochecha baixa/queixo mais largos (escala x em torno do plano médio), na frente das
    #    orelhas; abaixo do queixo só na frente (onde o queixo aberto passa), nunca no pescoço.
    ear_front_y = float(lm["ears_min"][1]) if lm["ears_min"] is not None else float(lm["eye"][1]) + 0.06
    knots = p["lower_face_profile"]
    width = p["lower_face_width"]

    def lower_face(P: np.ndarray) -> np.ndarray:
        d = (eye_z - P[:, 2]) / U
        front = 1.0 - smoothstep(ear_front_y - 0.02, ear_front_y + 0.02, P[:, 1])
        below = smootherstep(0.95, 1.15, d) * smootherstep(slit_y + 0.035, slit_y + 0.075, P[:, 1])
        s = width * piecewise_profile(d, knots) * front * (1.0 - below)
        out = np.zeros_like(P)
        out[:, 0] = s * P[:, 0]
        return out
    fields.append(FunctionField("lower_face_width", lower_face))

    # 2. maçãs do rosto cheias (para fora e para frente), 3. bochecha baixa
    for i, apple in enumerate(lm["apples"]):
        side = np.sign(apple[0])
        n = np.array([side * 0.75, -0.66, 0.0])
        r = p["cheek_radius_u"] * U
        fields.append(RadialOffset(f"cheek_{'LR'[i]}", tuple(apple), (r, r, 0.9 * r), tuple(n * p["cheek_mm"] * mm), plateau=0.25))
        jowl = np.array([apple[0] * 1.15, apple[1] + 0.012, eye_z - 0.78 * U])
        fields.append(RadialOffset(f"jowl_{'LR'[i]}", tuple(jowl), (r, r, r), (side * p["jowl_mm"] * mm, -0.3 * p["jowl_mm"] * mm, 0.0)))
        # bochecha média (entre a maçã e a mandíbula, ao lado do sulco nasolabial): preenche a curva para
        # que a silhueta da bochecha em 3/4 seja convexa e contínua (sem calombo na altura da asa do nariz)
        mid = np.array([apple[0] * 1.05, apple[1] + 0.004, eye_z - 0.66 * U])
        rm = p["midcheek_radius_u"] * U
        fields.append(RadialOffset(f"midcheek_{'LR'[i]}", tuple(mid), (rm, rm, 0.85 * rm),
                                   (side * 0.8 * p["midcheek_mm"] * mm, -0.6 * p["midcheek_mm"] * mm, 0.0), plateau=0.2))

    # 4. boca + queixo para frente (e um pouco para cima): translação constante na região da mandíbula
    fwd, up = p["jaw_forward_mm"] * mm, p["mouth_up_mm"] * mm

    def jaw_forward(P: np.ndarray) -> np.ndarray:
        w = jaw_slab(P) * (1.0 - smootherstep(0.045, 0.09, np.abs(P[:, 0])))
        out = np.zeros_like(P)
        out[:, 1] = -fwd * w
        out[:, 2] = up * w
        return out
    fields.append(FunctionField("jaw_forward", jaw_forward))

    # 5. boca mais larga (cantos empurrados, saturado) — constante em z na região da mandíbula —,
    #    lábios um pouco mais altos e cheios
    hw = lm["mouth_hw"]
    ratio = p["mouth_interior_ratio"]
    mouth_w = SaturatingScale("mouth_width_raw", (0.0, 0.0, 0.0), (1e3, 1e3, 1e3), (1, 0, 0), p["mouth_width"], hw)

    def mouth_width(P: np.ndarray) -> np.ndarray:
        w = jaw_slab(P) * (1.0 - smootherstep(0.06, 0.10, np.abs(P[:, 0])))
        w *= 1.0 - (1.0 - ratio) * smoothstep(slit_y + 0.004, slit_y + 0.016, P[:, 1])
        return mouth_w(P) * w[:, None]
    fields.append(FunctionField("mouth_width", mouth_width))
    fields.append(LocalScale("lip_thickness", (0.0, float(ulip[1]), float(slit[2])), (1.8 * hw, 0.022, 0.045),
                             (1, 1, 1 + p["lip_thickness"]), pivot=(0.0, 0.0, float(slit[2])), plateau=0.3))
    fields.append(RadialOffset("lip_forward", (0.0, float(ulip[1]), float(slit[2])), (0.30 * U, 0.15 * U, 0.30 * U),
                               (0.0, -p["lip_forward_mm"] * mm, 0.0)))

    # 6. nariz: asas mais largas e ponta mais redonda, com transição SUAVE para a bochecha.
    #    O alargamento é uma escala x quase linear (meia-largura de saturação > asa) com suporte largo em
    #    z/y, de modo que o sulco nasolabial acompanha a asa sem dobrar; a bochecha ao lado só é empurrada.
    alae = lm["alae"]
    ax = abs(float(alae[0]))
    fields.append(SaturatingScale("nose_width", (0.0, float(alae[1]) - 0.002, float(alae[2]) + 0.001),
                                  (p["nose_support_x_u"] * U, 0.30 * U, p["nose_support_z_u"] * U), (1, 0, 0),
                                  p["nose_width"], p["nose_saturation"] * ax, plateau=0.35))
    # vale entre a parede lateral do nariz e a bochecha (vira um vinco em 3/4 quando a maçã vem para
    # frente): preenchido para frente/fora, com suporte alto em z (da asa até perto do canto do olho)
    for side in (-1.0, 1.0):
        vc = (side * (ax + 0.004), float(alae[1]) + 0.006, float(alae[2]) + p["valley_z_u"] * U)
        fields.append(RadialOffset(f"nose_valley_{'RL'[int(side > 0)]}", vc, (0.11 * U, 0.10 * U, 0.17 * U),
                                   (side * 0.35 * p["valley_mm"] * mm, -p["valley_mm"] * mm, 0.0), plateau=0.2))
    tip = lm["nose_tip"]
    fields.append(LocalScale("nose_tip_round", (0.0, float(tip[1]) + 0.004, float(tip[2]) - 0.001),
                             (0.16 * U, 0.14 * U, 0.14 * U), (1 + p["nose_tip_round"], 1.0, 1 + 0.5 * p["nose_tip_round"]),
                             pivot=(0.0, float(tip[1]) + 0.006, float(tip[2])), plateau=0.2))
    fields.append(RadialOffset("nose_tip_down", (0.0, float(tip[1]), float(tip[2])), (0.14 * U, 0.12 * U, 0.12 * U),
                               (0.0, -0.4 * p["nose_tip_drop_mm"] * mm, -p["nose_tip_drop_mm"] * mm)))
    # projeção do nariz (ponta + metade de baixo do dorso para frente): com as maçãs cheias, o nariz do
    # asset quase não passa da bochecha em 3/4 — vira um "botão" achatado. Suporte estreito em x (só o
    # nariz) e alto em z (vai sumindo no dorso até perto dos olhos, sem dobra).
    if p["nose_forward_mm"]:
        fields.append(RadialOffset("nose_forward", (0.0, float(tip[1]) + 0.006, float(tip[2]) + 0.10 * U),
                                   (0.13 * U, 0.16 * U, 0.30 * U), (0.0, -p["nose_forward_mm"] * mm, 0.0), plateau=0.25))

    guard = eye_guard(lm, *p["eye_guard_mm"])
    return [Masked(f.name, f, guard) for f in fields]


def add_face(warp: Warp, lm: dict, params: dict | None = None) -> None:
    for f in build_face_fields(lm, params):
        warp.add(f)
