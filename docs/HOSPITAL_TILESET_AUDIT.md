# Audyt i redesign tilesetów szpitala

## Założenia techniczne

- siatka: `32 × 32` piksele,
- mapa: finite orthogonal JSON zgodny z Tiled,
- zewnętrzne tilesety: `.tsj`,
- frontendowe grafiki: osobne pliki SVG z osadzonym pikselowym PNG,
- backend przechowuje lustrzaną kopię deskryptorów `.tsj`,
- duże obiekty są kotwiczone do dolnego pola zgodnie z istniejącym rendererem.

## Nowy zestaw

| Tileset | Liczba kafli | Zawartość |
| --- | ---: | --- |
| `hospital-floor.tsj` | 5 | trzy kamienne posadzki oraz dwa przezroczyste detale podłogi |
| `hospital-structure.tsj` | 6 | ściany, uszkodzona ściana, gzyms, filar, drzwi boczne i otwarte drzwi główne |
| `hospital-beds.tsj` | 6 | dwa warianty łóżka, każdy rozbity na poziome segmenty `head / middle / foot` |
| `hospital-props.tsj` | 18 | szafki, półki, kotary, światła, dwa stoły centralne, parawan i magazyn |

Łącznie mapa używa **35 osobnych grafik SVG**. Nie istnieje jeden obraz całego pomieszczenia ani jeden monolityczny atlas szpitala.

## Łóżka

Każde łóżko jest składane z trzech obrazów `32 × 64`, więc zajmuje 3 × 2 pola. Lewy rząd używa kolejności `head → middle → foot`, a prawy rząd tych samych segmentów w kolejności odwróconej i z poziomym flipem Tiled. Dzięki temu poduszki są skierowane do ścian, a nogi łóżek do środkowego przejścia, jak na referencji.

Każdy segment posiada pełny footprint `32 × 64`, dlatego kolizja odpowiada faktycznemu obrysowi łóżka i nie tworzy dodatkowych, niewidzialnych blokad.

## Wysokie obiekty

Szafy, stoły, regały, skrzynie, beczki, źródła światła i parawan mają w deskryptorach jawne footprinty. Obiekty stojące blokują wyłącznie dolny rząd swojej podstawy. Dekoracje ścienne oraz otwarte drzwi główne mają `collisionMode=none`.

## Kierunek wizualny

Paleta i materiały odpowiadają referencji:

- regularna, ciemna kamienna posadzka,
- czarne i grafitowe cegły,
- ciemne drewno z mosiężnymi detalami,
- jasna, lekko zabrudzona pościel,
- ciepłe pomarańczowe światło świec i pochodni,
- apteczne fiolki, księgi, narzędzia i religijno-medyczne symbole.

UI widoczne na referencji nie zostało kopiowane.
