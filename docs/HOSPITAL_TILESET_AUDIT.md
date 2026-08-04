# Audyt i zestaw kafli: szpital dark fantasy

## Zakres etapu

Ten etap dodaje wyłącznie kafle i deskryptory Tiled potrzebne do późniejszego zbudowania małego szpitala po przegranej walce. Nie dodaje mapy, portalu, seeda, spawnu ani logiki przenoszenia gracza.

## Wynik audytu istniejącego systemu

- Siatka mapy ma `32 x 32` piksele, orientację orthogonal i skończone wymiary.
- Mapy są zapisywane jako JSON i używają zewnętrznych deskryptorów Tiled w formacie `.tsj`.
- Runtime nie obsługuje `.tsx`/XML.
- Kanoniczny katalog frontendowych deskryptorów i grafik to `frontend/public/assets/tiles`.
- Backend przechowuje mirror deskryptorów w `prisma/assets/tiles`; backend nie potrzebuje kopii grafik SVG.
- Dla obiektów większych niż jedno pole zalecany jest tileset typu `Collection of Images`: każdy obiekt lub segment ma własny obraz o rzeczywistym rozmiarze.
- Kolizja i kolejność renderowania są niezależne. Kolizję definiuje `collides=true` albo `objectgroup`; elementy zasłaniające postać należy później umieszczać na warstwie z `renderBand=above`.
- Duże obiekty są kotwiczone do dolnego pola. Ich footprint znajduje się w dolnych `32` pikselach obrazu.

## Struktura nowego zestawu

Dodano cztery logiczne tilesety typu `Collection of Images`:

| Tileset | Liczba kafli | Zawartość |
| --- | ---: | --- |
| `hospital-floor.tsj` | 5 | dwie posadzki, pęknięcia, plama krwi, rytualny znak |
| `hospital-structure.tsj` | 5 | ściana, zniszczona ściana, gzyms, filar, zamknięte drzwi |
| `hospital-beds.tsj` | 6 | łóżko żelazne i słomiane, każde jako osobne segmenty head/middle/foot |
| `hospital-props.tsj` | 9 | stolik, szafa apteczna, dwa segmenty parawanu, misa, palenisko, świecznik, skrzynia, beczka |

Łącznie zestaw zawiera **25 osobnych grafik SVG**. Nie ma jednego obrazu przedstawiającego całe pomieszczenie ani jednego wielkiego atlasu rekwizytów.

## Składanie wielokaflowych obiektów

### Łóżka

Każdy wariant łóżka składa się z trzech osobnych kafli ustawianych pionowo:

```text
head
middle
foot
```

Każdy segment zajmuje jedno pole `32 x 32` i ma pełną kolizję. Dzięki temu mapę można swobodnie układać, obracać przez dobór warstw i łatwo wymieniać uszkodzony albo zakrwawiony środkowy segment w przyszłości.

### Wysokie obiekty

Drzwi, szafa apteczna, parawany i świecznik mają obraz `32 x 64`. W tilesecie mają footprint wyłącznie w dolnym polu `32 x 32`, zgodnie z obecnym modelem dużych obiektów. Podczas tworzenia mapy:

- szafę, parawany i świecznik warto umieścić na warstwie `renderBand=above`,
- drzwi należy umieścić na warstwie zgodnej z zachowaniem wejścia; obecny wariant jest zamknięty i blokuje dolne pole,
- górna część grafiki nie tworzy dodatkowej niewidzialnej kolizji.

## Kierunek artystyczny

- Paleta jest ciemna, przygaszona i chłodna: zielonkawe kamienie, czernione żelazo, stare drewno oraz brudne płótno.
- Motywy medyczne są średniowieczne i okultystyczne: misa z krwią, apteczna szafa, parawany, rytualny znak, zużyte łóżka.
- Uniknięto jasnej, bajkowej kolorystyki z obrazu referencyjnego. Referencja została użyta jedynie do poziomu szczegółowości i modularnego układu obiektów.

## Self-review

- **Format:** wszystkie deskryptory są JSON `.tsj`, a grafiki są tekstowymi `.svg` zawierającymi pikselowe PNG.
- **Skala:** bazowy kafel ma `32 x 32`; duże obiekty mają `32 x 64` i footprint w dolnym polu.
- **Modularność:** 25 unikalnych plików graficznych; łóżka są rozbite na osobne segmenty zamiast jednej grafiki całego mebla.
- **Przezroczystość:** obiekty mają przezroczyste tło; kafle podłogi i ścian są celowo nieprzezroczyste.
- **Kolizje:** pełne kafle używają `collides=true`; wysokie obiekty mają precyzyjny `objectgroup` ograniczony do podstawy.
- **Ścieżki:** deskryptory odwołują się wyłącznie do lokalnych nazw SVG bez katalogów i `..`.
- **Mirror:** cztery `.tsj` należy utrzymywać identycznie w `frontend/public/assets/tiles` i `prisma/assets/tiles`.
- **Czytelność:** kształty łóżek, drzwi, parawanów, szafy, źródeł światła i pojemników są rozpoznawalne przy powiększeniu nearest-neighbor.
- **Zakres:** nie dodano mapy ani logiki gry, zgodnie z podziałem prac na etapy.

## Znane ograniczenia

- Zestaw nie zawiera jeszcze otwartej wersji drzwi ani animacji ognia/świec; można je dodać podczas etapu mapy lub animacji.
- Nie ma obrotów łóżek. Obecne segmenty są przygotowane do układu pionowego; wariant poziomy wymaga osobnego zestawu grafik.
- Ostateczne rozmieszczenie warstw `below`/`above` oraz test zasłaniania postaci będą możliwe dopiero po wygenerowaniu mapy.
