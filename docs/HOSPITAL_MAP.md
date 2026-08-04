# Mroczna Lecznica — mapa porażki

## Zakres

Mapa `hospital` pozostaje bezpieczną mapą odrodzenia po przegranej walce PVP albo PVE. Portal na południu nadal korzysta ze standardowego systemu portali i prowadzi do `greenfields`.

## Parametry

- klucz: `hospital`
- nazwa: `Mroczna Lecznica`
- strefa: `SAFE`
- rozmiar: `24 x 18` pól
- kafel: `32 x 32`
- spawn po porażce: `12,15`
- portal wyjściowy: `12,17`
- cel portalu: `greenfields`, pole `4,4`

Pliki mapy są identyczne w:

```text
frontend/public/maps/hospital.json
prisma/maps/hospital.json
```

Mapa korzysta z przygotowanych wcześniej tilesetów:

```text
hospital-floor.tsj
hospital-structure.tsj
hospital-beds.tsj
hospital-props.tsj
```

## Uporządkowany układ

Pomieszczenie jest podzielone na dwie czytelne części szpitalne po obu stronach szerokiego, centralnego przejścia.

- Cztery identyczne żelazne łóżka tworzą dwa równe rzędy.
- Łóżka stoją na kolumnach `x=4` oraz `x=19`, dzięki czemu układ jest symetryczny.
- Przy łóżkach nie ma przypadkowych mis, parawanów ani trudnych do rozpoznania małych obiektów.
- Dwie szafy apteczne stoją razem w górnej, centralnej części mapy i tworzą jedno zaplecze medyczne.
- Skrzynie oraz beczki tworzą dwa zwarte magazyny w dolnych narożnikach.
- Cztery paleniska są rozmieszczone parami i wyznaczają narożniki części użytkowej.
- Jedyny mocniejszy detal posadzki, rytualny znak, znajduje się dokładnie na osi głównego przejścia.
- Spawn i portal leżą na tej samej osi, więc wyjście z lecznicy jest od razu czytelne.

Aktualny plan:

```text
########################
#                      #
# B        AA        B #
#                      #
#   H              H   #
#   M              M   #
#   F              F   #
#                      #
#           S          #
#                      #
#   H              H   #
#   M              M   #
#   F              F   #
#                      #
# B                  B #
# CCR       P      RCC #
#                      #
############O###########
```

Legenda:

- `H/M/F` — segmenty żelaznego łóżka,
- `A` — szafa apteczna,
- `B` — palenisko,
- `C/R` — skrzynia i beczka,
- `S` — centralny znak posadzki,
- `P` — spawn po porażce,
- `O` — portal do Greenfields.

Assety `hospital-bedside-table`, `hospital-privacy-screen-*`, `hospital-blood-basin` oraz `hospital-candle-stand` pozostają dostępne w tilesecie, ale nie są użyte na tej mapie. Przy aktualnym przybliżeniu ich sylwetki były mało czytelne i tworzyły wrażenie przypadkowego bałaganu.

## Warstwy

1. `Ground` — regularny wzór kamiennej posadzki i jeden centralny znak.
2. `Structure Below` — zamknięty obwód ścian z symetrycznymi uszkodzeniami i filarami.
3. `Beds and Furniture` — łóżka, paleniska oraz dwa zwarte magazyny.
4. `Tall Props and Door` — dwie szafy apteczne i drzwi wyjściowe.
5. `Portals` — obiekt portalu do Greenfields.

## Seed i integracja

`prisma/seed-hospital.ts` ładuje mapę, rozwiązuje zewnętrzne TSJ, sprawdza kolizje oraz zapisuje mapę i portal do bazy. `prisma/seed-all.ts` uruchamia ten seed po głównym seedzie świata.

`DefeatRecoveryService` nadal:

1. wybiera pokonanych graczy z `hp <= 0`,
2. czeka na zakończenie stanu walki,
3. przenosi ich na spawn lecznicy,
4. odświeża widoczność,
5. wysyła `world:mapChanged`,
6. utrwala pozycję w bazie.

## Testy układu

Test mapy pilnuje teraz nie tylko poprawności technicznej, ale również kompozycji:

- dokładnych pozycji czterech łóżek,
- jednakowego typu wszystkich łóżek,
- braku nieczytelnych rekwizytów przy łóżkach,
- wspólnego stanowiska aptecznego,
- symetrycznego oświetlenia,
- dwóch zwartych stref magazynowych,
- pojedynczego centralnego znaku,
- przechodniego spawnu i portalu,
- zamkniętego obwodu mapy.
