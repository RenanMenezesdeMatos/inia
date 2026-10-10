"""Silhueta do afro medida nas imagens de referência (etapa 05), em unidades do ROSTO.

As tabelas abaixo foram medidas uma vez nas máscaras (fundo cinza × personagem) de
`assets/avatar/inia/ref_{front,profile,back}_v01.png` e em leituras ampliadas do contorno
rosto × cabelo (linha do cabelo, costeletas, borda inferior). Nada aqui depende de pixels em
tempo de execução: o 05_hair converte estas tabelas para metros usando os marcos do rosto medidos
no modelo, de modo que o cabelo acompanha qualquer mudança posterior de proporção do rosto.

Unidades:
- `dz`: altura relativa ao centro dos olhos, em U = (z_olhos − z_queixo). Positivo para cima.
- `dy`: profundidade relativa à ponta do nariz, em U. Positivo para trás (a personagem olha para −Y).
- `hw`: meia-largura na vista frontal, em F = meia-largura do rosto na altura das bochechas.

Âncoras usadas na medição (pixels da imagem 518×758):
- frente: centro dos olhos x=311 y=220; queixo y=337 (117 px = 1 U); rosto nas bochechas ±88 px (1 F).
  O lado direito da imagem corta o cabelo entre y=130 e y=275: ali vale a vista de costas × 1,05
  (a frente é ~5 % mais aproximada, medido onde os dois lados existem).
- perfil: olho y=217, queixo y=333 (116 px = 1 U); ponta do nariz x=104.
"""
from __future__ import annotations

FRONT_PX_PER_U = 117.0
PROFILE_PX_PER_U = 116.0
FACE_HALF_WIDTH_PX = 88.0

# Vista frontal: (y_px, meia-largura_px). Topo do "domo" simétrico; o vinco central (formato de
# coração) é esculpido à parte (DIP_*). Envoltória média dos cachos (a borda crespa vem da camada
# de cachos).
_FRONT_HALF_WIDTH_PX = [
    (20, 0), (24, 52), (28, 80), (34, 103), (40, 117), (46, 126), (52, 139), (58, 147), (64, 156),
    (70, 162), (76, 169), (82, 173), (88, 180), (94, 185), (100, 187), (106, 193), (112, 200),
    (118, 203), (124, 206), (130, 211), (136, 214), (142, 216), (148, 222), (154, 223), (160, 224),
    (166, 229), (172, 229), (178, 232), (184, 235), (190, 236), (196, 236), (202, 238), (208, 237),
    (214, 236), (220, 235), (226, 229), (232, 228), (238, 228), (244, 230), (250, 229), (256, 229),
    (262, 224), (268, 216), (274, 211), (280, 209), (286, 207), (292, 200), (298, 199), (304, 197),
    (310, 191), (316, 191), (322, 180), (328, 177), (334, 170), (340, 160), (346, 157), (352, 147),
    (358, 127), (364, 120), (370, 100), (376, 70), (380, 40), (382, 0),
]

# Perfil: frente do cabelo (y_px, x_px). Acima da testa é a silhueta; da linha do cabelo para baixo é
# a borda cabelo × lateral do rosto (têmpora → costeleta), lida em recorte ampliado; depois a borda
# inferior (nuca) até o ponto mais baixo.
_PROFILE_FRONT_PX = [
    (24, 205), (28, 191), (34, 184), (40, 167), (46, 162), (52, 148), (58, 142), (64, 138), (70, 135),
    (76, 129), (82, 122), (88, 118), (94, 117), (100, 115), (106, 112), (112, 109), (118, 110),
    (124, 112), (130, 116), (136, 132), (140, 152), (143, 167), (160, 180), (177, 190), (197, 200),
    (217, 207), (240, 210), (260, 217), (280, 223), (300, 227), (320, 233), (333, 243), (338, 255),
    (347, 280), (360, 310), (370, 333), (377, 353),
]

# Perfil: fundo do cabelo (y_px, x_px), do topo até o ponto mais baixo da nuca.
_PROFILE_BACK_PX = [
    (24, 262), (28, 308), (34, 331), (40, 344), (46, 361), (52, 368), (58, 378), (64, 388), (70, 393),
    (76, 396), (82, 404), (88, 412), (94, 416), (100, 420), (106, 427), (112, 430), (118, 435),
    (124, 438), (130, 441), (136, 444), (142, 450), (148, 452), (154, 452), (160, 452), (166, 457),
    (172, 460), (178, 461), (184, 465), (190, 467), (196, 468), (202, 468), (208, 470), (214, 471),
    (220, 471), (226, 466), (232, 462), (238, 462), (244, 463), (250, 465), (256, 464), (262, 463),
    (268, 460), (274, 456), (280, 455), (286, 453), (292, 451), (298, 447), (304, 444), (310, 443),
    (316, 441), (322, 435), (328, 432), (334, 428), (340, 420), (346, 416), (352, 410), (358, 398),
    (365, 385), (373, 365), (377, 353),
]

# Vinco no topo (formato de coração na frente e nas costas): profundidade e meia-largura em U,
# medidos na frente (lóbulos em y≈26, vinco em y≈55 → ~0,25 U) e nas costas (~0,21 U).
DIP_DEPTH_U = 0.24
DIP_HALF_WIDTH_U = 0.20


def _front_eye_y() -> float:
    return 220.0


def front_half_width_table() -> list[tuple[float, float]]:
    """[(dz em U, meia-largura em F)] de cima para baixo."""
    return [((_front_eye_y() - y) / FRONT_PX_PER_U, px / FACE_HALF_WIDTH_PX) for y, px in _FRONT_HALF_WIDTH_PX]


def profile_front_table() -> list[tuple[float, float]]:
    """[(dz em U, dy em U)] — frente do cabelo no perfil."""
    return [((217.0 - y) / PROFILE_PX_PER_U, (x - 104.0) / PROFILE_PX_PER_U) for y, x in _PROFILE_FRONT_PX]


def profile_back_table() -> list[tuple[float, float]]:
    """[(dz em U, dy em U)] — fundo do cabelo no perfil."""
    return [((217.0 - y) / PROFILE_PX_PER_U, (x - 104.0) / PROFILE_PX_PER_U) for y, x in _PROFILE_BACK_PX]
