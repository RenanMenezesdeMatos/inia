-- Desfoque do fundo por cenário da INIA (cada foto já tem a própria profundidade de campo).
--
-- Aditiva. Valor em px num palco de referência de 1440 px de largura; quem exibe escala pela largura real (palco, painel,
-- prévia), então o desfoque parece o mesmo em qualquer tamanho. 0 = nítido; padrão 0,5 px (um foco de câmera leve).
-- Cenários existentes recebem o padrão.

alter table inia_scenes
  add column background_blur numeric(3, 2) not null default 0.5
  check (background_blur >= 0 and background_blur <= 3);
