# Praca z mapami w Tiled

Ten dokument opisuje praktyczny sposób tworzenia i aktualizowania map w edytorze **Tiled**, tak aby warstwy, grafiki, kolizje i portale działały w grze.

Szczegółowy kontrakt techniczny formatu znajduje się w [`MAP_FORMAT.md`](./MAP_FORMAT.md).

## 1. Ustawienia nowej mapy

Utwórz mapę z następującymi ustawieniami:

- orientation: `Orthogonal`,
- tile size: `32 x 32`,
- map type: finite, czyli bez opcji infinite map,
- format zapisu: JSON (`.json` lub `.tmj`),
- encoding warstw: JSON, CSV albo base64,
- compression: brak, `zlib` albo `gzip`.

Silnik nie obsługuje map izometrycznych, map infinite/chunked ani tilesetów TSX/XML.

## 2. Gdzie edytować mapę

Najwygodniej otworzyć kopię frontendową:

```text
frontend/public/maps/<map-key>.json
```

Ścieżki do grafik i zewnętrznych tilesetów są wtedy rozwiązywane względem katalogu `frontend/public` i Tiled może je normalnie wyświetlić.

Po zapisaniu mapy skopiuj identyczny plik również do:

```text
prisma/maps/<map-key>.json
```

Obie kopie muszą być identyczne:

- `frontend/public/maps` jest używane przez klienta,
- `prisma/maps` jest używane przez seed i autorytatywny backend.

Jeżeli mapa korzysta z zewnętrznego tilesetu `.tsj`, zachowaj tę samą względną strukturę katalogów w obu miejscach.

## 3. Zalecany układ warstw

Przykładowy układ:

```text
Ground
Roads
Props Below
Characters                 <- warstwa logiczna gry, nie tworzysz jej w Tiled
Props Above
Collisions
Portals
```

Nazwy zwykłych warstw graficznych mogą być dowolne.

### Elementy pod postacią

Warstwa bez dodatkowej właściwości jest renderowana pod postaciami.

Można też jawnie ustawić własną właściwość warstwy:

```text
renderBand = below
```

Typ właściwości: `string`.

### Elementy nad postacią

Dla koron drzew, dachów, łuków i innych elementów zasłaniających postać ustaw:

```text
renderBand = above
```

Typ właściwości: `string`.

Właściwość można ustawić także na grupie warstw. Dzieci dziedziczą `renderBand`, widoczność, opacity i offset grupy.

## 4. Dlaczego pod koroną można chodzić, a pod pniem nie

**Renderowanie i kolizja są niezależne.**

`renderBand=above` oznacza wyłącznie, że grafika jest rysowana nad postacią. Nie oznacza to kolizji.

Kafelek blokuje ruch dopiero wtedy, gdy spełnia co najmniej jedną z zasad kolizji:

1. znajduje się na warstwie `collision` lub warstwie z `collision=true`,
2. ma właściwość kafla `collides=true`,
3. ma obiekty w edytorze kolizji kafla,
4. pokrywa go obiekt z warstwy `Collisions` lub warstwy z `collision=true`.

W aktualnym drzewie działa to tak:

- kafel korony jest na warstwie `Tree Canopies` z `renderBand=above`,
- kafel korony nie ma `collides=true` ani obiektu kolizji,
- dlatego postać może wejść pod koronę i zostaje przez nią częściowo zasłonięta,
- kafel pnia ma footprint w edytorze kolizji kafla,
- dlatego pola zajmowane przez pień i podstawę drzewa są zablokowane.

To jest zalecany model także dla budynków:

- dach lub górna część budynku: `renderBand=above`, bez kolizji,
- ściany, fundament albo wejście: osobny kafel z dokładnym footprintem kolizji.

## 5. Dodawanie kolizji kafla

W panelu Tilesets:

1. wybierz kafel,
2. kliknij **Edit Tile Collision**,
3. narysuj prostokąt, wielokąt albo inną figurę na obszarze, który ma blokować ruch,
4. zapisz tileset i mapę.

Kolizja jest automatycznie stosowana do każdej instancji tego kafla na mapie.

Dla dużego obiektu nie zaznaczaj całej grafiki jako kolizji. Zaznacz tylko fizyczną podstawę, po której postać nie może chodzić. Korona drzewa może być szeroka, ale footprint pnia powinien pozostać mały.

Alternatywnie dla prostego kafla można dodać właściwość:

```text
collides = true
```

Typ właściwości: `bool`.

Ta opcja blokuje cały kafel mapy i jest odpowiednia np. dla ściany lub skały zajmującej pełne pole.

## 6. Osobna warstwa kolizji

Dla ścian mapy, niewidzialnych barier albo nietypowych kształtów utwórz Object Layer o nazwie:

```text
Collisions
```

Warstwa może być ukryta w Tiled. `visible=false` wpływa na podgląd i rendering, ale nie wyłącza kolizji w grze.

Możesz też użyć dowolnej nazwy i dodać do warstwy właściwość:

```text
collision = true
```

Typ właściwości: `bool`.

## 7. Duże obiekty

Najbardziej przenośny wariant Tiled to tileset typu **Collection of Images**, gdzie każdy duży obiekt ma własny obraz o rzeczywistym rozmiarze i przezroczystym tle.

Dla dużych kafli gra domyślnie odczytuje:

- `imagewidth` i `imageheight` kafla,
- standardowy `tileoffset` tilesetu,
- obiekty z edytora kolizji kafla.

Silnik obsługuje także opcjonalne właściwości:

```text
renderWidthTiles
renderHeightTiles
renderAnchorX
renderAnchorY
renderOffsetXTiles
renderOffsetYTiles
```

Są one potrzebne tylko wtedy, gdy standardowy rozmiar obrazu i `tileoffset` nie wystarczają.

Nie umieszczaj grafiki wychodzącej poza komórkę atlasu bez odpowiedniego marginesu. Tiled i renderer wycinają kafel według granic komórki atlasu, więc piksele poza nią zostaną utracone. Dla koron, budynków i innych szerokich obiektów preferuj osobny pełnowymiarowy obraz albo atlas z odpowiednio dużą komórką.

## 8. Portale

Utwórz Object Layer o nazwie:

```text
Portals
```

Dla prostokątnego obiektu portalu ustaw typ:

```text
portal
```

Dodaj właściwości:

```text
destinationMapKey = crystal-cave
targetX = 1
targetY = 32
```

Typy:

- `destinationMapKey`: string,
- `targetX`: int,
- `targetY`: int.

Pozycja źródłowa jest liczona z położenia obiektu. Można ją nadpisać właściwościami `sourceX` i `sourceY` typu `int`.

Cały prostokąt portalu jest traktowany jako przechodni, nawet gdy znajduje się na zablokowanej granicy mapy.

## 9. Dodawanie nowej mapy do gry

Po utworzeniu pliku mapy:

1. umieść go w `frontend/public/maps`,
2. skopiuj identyczny plik do `prisma/maps`,
3. jeżeli używasz `.tsj`, skopiuj również tilesety i zachowaj względne ścieżki,
4. dodaj mapę do `mapDefinitions` w `prisma/seed.ts`,
5. ustaw `key`, nazwę, typ strefy oraz bezpieczny punkt startowy,
6. uruchom seed.

Frontend automatycznie szuka nieznanej mapy pod adresem:

```text
/maps/<map-key>.json
```

Nie trzeba dodawać osobnego wpisu do asset manifestu, o ile grafiki są prawidłowo zadeklarowane w tilesecie Tiled.

## 10. Walidacja przed commitem

Uruchom:

```bash
npm test
npm run frontend:test
npm run frontend:build
npm run prisma:seed
```

Seed powinien zostać uruchomiony szczególnie po zmianie:

- rozmiaru mapy,
- kolizji,
- portali,
- spawnów,
- tilesetów,
- kluczy map.

Jeżeli zmieniła się grafika SVG lub inny asset pod tym samym URL-em, wykonaj twarde odświeżenie przeglądarki (`Ctrl+Shift+R` lub `Cmd+Shift+R`), aby nie oglądać starej wersji z cache.

## 11. Lista kontrolna

Przed zakończeniem pracy sprawdź:

- mapa jest orthogonal i finite,
- rozmiar kafla wynosi `32 x 32`,
- obie kopie mapy są identyczne,
- ścieżki do grafik działają z poziomu pliku mapy lub `.tsj`,
- warstwy nad postaciami mają `renderBand=above`,
- kolizja znajduje się wyłącznie na fizycznych podstawach obiektów,
- korony i dachy nie mają przypadkowego `collides=true`,
- portal prowadzi na istniejącą mapę i niezablokowane pole,
- spawn nie znajduje się na kolizji,
- testy i build przechodzą.
