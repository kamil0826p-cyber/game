# Mroczna Lecznica — redesign zgodny z referencją

## Układ

Mapa zachowuje mały rozmiar **24 × 18 kafli** i odtwarza kompozycję referencji zamiast luźno się nią inspirować:

- prostokątna, kamienna sala z wejściem na dole pośrodku,
- zamknięte boczne drzwi w prawej ścianie,
- dokładnie **8 łóżek**: 4 po lewej i 4 po prawej,
- łóżka są trzysegmentowymi obiektami wielokaflowymi o rozmiarze 3 × 2 pola,
- szafki nocne stoją przy każdym łóżku,
- pierwsza para łóżek ma kotary,
- górna ściana jest zabudowana półkami, szafami aptecznymi, banerem, ikoną i świecznikami,
- w centrum są dwa stanowiska robocze: stół z księgą oraz stół alchemiczno-zabiegowy,
- na dole po lewej są stół roboczy, misa i parawan,
- na dole po prawej są skrzynie, beczki i regał z butelkami.

## Spawn i portal

- respawn po porażce: **12,9**,
- portal do `greenfields`: **12,17**,
- portal prowadzi na **4,4** na mapie docelowej.

## Kolizja

Stara kolizja została zastąpiona kolizją wynikającą wyłącznie z nowych ścian i footprintów obiektów.

Sprawdzone zostały:

- przejście od spawnu do dolnych drzwi,
- dojście do wszystkich czterech łóżek po lewej stronie,
- dojście do wszystkich czterech łóżek po prawej stronie,
- przejście przez dolną połowę mapy bez niewidzialnej ściany,
- otwarty kafel portalu w dolnych drzwiach,
- blokowanie pełnego obrysu łóżek i tylko podstaw wysokich mebli, kotar oraz magazynowych stosów.
