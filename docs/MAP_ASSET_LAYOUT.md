# Układ assetów map i tilesetów

## Wynik audytu

Przed uporządkowaniem zasoby jednego tilesetu były rozdzielone między dwa katalogi frontendu:

- `frontend/public/maps/tiles` zawierał deskryptory Tiled (`.tsj`),
- `frontend/public/assets/tiles` zawierał obrazy kafelków (`.svg`).

Mapy wskazywały `tiles/*.tsj`, a każdy deskryptor cofał się następnie do `../../assets/tiles/*.svg`. Dodatkowo backend miał drugi, podobnie nazwany katalog `prisma/maps/tiles`. Układ działał, ale utrudniał odnalezienie kompletnego tilesetu, sprzyjał niespójnym nazwom i łatwo było przenieść tylko połowę zasobu.

## Układ kanoniczny

Po stronie klienta wszystkie elementy tilesetu znajdują się w jednym miejscu:

```text
frontend/public/assets/tiles/
  dark-forest-terrain.tsj
  dark-forest-terrain.svg
  black-pine-trunk.tsj
  black-pine-trunk.svg
  black-pine-canopy.tsj
  black-pine-canopy.svg
  cave.tsj
  cave-floor.svg
  cave-rock.svg
  tiled-world.svg
```

Mapy w `frontend/public/maps/*.json` wskazują deskryptory przez:

```text
../assets/tiles/<tileset>.tsj
```

Deskryptory frontendowe odwołują się do obrazów wyłącznie po nazwie pliku, ponieważ `.tsj` i `.svg` leżą obok siebie.

Backend zachowuje wymagany mirror samych danych Tiled w:

```text
prisma/assets/tiles/
```

Mapy w `prisma/maps/*.json` są identyczne z kopiami frontendowymi, więc ta sama ścieżka `../assets/tiles/<tileset>.tsj` działa również podczas seeda.

## Rozszerzenia są przypisane do ról

Rozszerzenia nie są zamienne i nie należy ich sztucznie ujednolicać:

- `.json` — kompletna mapa Tiled,
- `.tsj` — zewnętrzny deskryptor tilesetu Tiled,
- `.svg` — obraz kafla albo atlasu.

W pipeline map nie używamy deskryptorów `.tsx`/XML. Wszystkie obrazy wskazywane przez aktualne deskryptory map mają format `.svg`.

## Zasady dodawania nowych kafelków

1. Umieść obraz i frontendowy deskryptor w `frontend/public/assets/tiles`.
2. Nazwij deskryptor tak samo jak pole `name` tilesetu; dla pojedynczego obrazu użyj tej samej nazwy bazowej dla `.tsj` i `.svg`.
3. W frontendowym `.tsj` używaj lokalnej nazwy obrazu bez `../` i bez katalogów.
4. Dodaj mirror deskryptora do `prisma/assets/tiles`.
5. W obu kopiach mapy użyj `../assets/tiles/<nazwa>.tsj`.
6. Nie twórz ponownie katalogów `frontend/public/maps/tiles` ani `prisma/maps/tiles`.
7. Uruchom testy map; test regresyjny sprawdza istnienie deskryptorów, formaty rozszerzeń, lokalność obrazów oraz brak starych katalogów.
