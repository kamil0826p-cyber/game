# Mroczna Lecznica — mapa porażki

## Zakres

Drugi etap dodaje gotową mapę Tiled oraz podpina ją do przepływu walki. Postać, której HP spadnie do zera w zakończonej walce PVP albo PVE, zostaje przeniesiona do bezpiecznej mapy `hospital`. Z lecznicy można wyjść istniejącym mechanizmem portali na mapę `greenfields`.

## Mapa

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

Mapa korzysta wyłącznie z tilesetów przygotowanych w pierwszym etapie:

```text
hospital-floor.tsj
hospital-structure.tsj
hospital-beds.tsj
hospital-props.tsj
```

## Układ pomieszczenia

Mapa ma cztery kompletne łóżka rozstawione po dwóch stronach szerokiego przejścia. Przy łóżkach znajdują się stoliki, parawany i misy. Górna część pełni funkcję zaplecza aptecznego, a dolne narożniki są użyte jako magazyn i źródła światła. Posadzka zawiera kontrolowane warianty pęknięć, krwi i jeden znak rytualny.

Warstwy:

1. `Ground` — pełna posadzka i warianty zabrudzeń.
2. `Structure Below` — obwód ścian, filary i wnęka wejściowa.
3. `Beds and Furniture` — łóżka oraz niskie rekwizyty.
4. `Tall Props and Door` — szafa, parawany, świecznik i drzwi z `renderBand=above`.
5. `Portals` — obiekt portalu do Greenfields.

Portal otwiera pole zamkniętych drzwi w siatce kolizji, więc gracz może wejść w drzwi i uruchomić standardową zmianę mapy.

## Seed

`prisma/seed-hospital.ts`:

- ładuje mapę i zewnętrzne deskryptory TSJ,
- kompiluje kolizje,
- sprawdza spawn i cel portalu,
- tworzy lub aktualizuje mapę `hospital`,
- odtwarza portal prowadzący do Greenfields.

`prisma/seed-all.ts` uruchamia seed szpitala bezpośrednio po głównym seedzie map.

## Przenoszenie po porażce

`DefeatRecoveryService` obserwuje autorytatywne zdarzenia `combat:updated`. Dla terminalnego snapshotu `FINISHED`:

1. wybiera wyłącznie graczy z `hp <= 0`,
2. odnajduje mapę `hospital` i bezpieczny spawn,
3. aktualizuje pozycję w `WorldStateService`,
4. odświeża widoczność starej i nowej mapy,
5. wysyła klientowi `world:mapChanged`,
6. zapisuje nową pozycję przez istniejący persistence.

Obsługa jest wspólna dla PVP i PVE, ponieważ oba systemy publikują ten sam kontrakt `combat:updated`. Identyfikator walki jest zapamiętywany, aby broadcast tego samego zakończenia do kilku uczestników nie wykonał transferu wielokrotnie.

## Self-review

- Mapa jest finite, orthogonal i zgodna z siatką `32 x 32`.
- Kopie frontend/backend są identyczne.
- Wszystkie cztery tilesety są zewnętrznymi plikami `.tsj` w kanonicznych katalogach.
- Spawn nie znajduje się na kolizji.
- Portal jest osiągalny ze spawnu i jego pole jest przechodnie.
- Cały obwód poza portalem jest zablokowany.
- Łóżka składają się z 12 segmentów, czyli czterech kompletnych obiektów.
- Przenoszony jest tylko faktycznie pokonany uczestnik; zwycięzca zostaje na dotychczasowej mapie.
- Transfer jest deduplikowany per `combatId` i zapisywany w bazie.
- Nie powstał drugi system portali ani osobna ścieżka zmiany mapy na kliencie.

## Ograniczenie

Transfer dotyczy aktywnych sesji znajdujących się w `WorldStateService`. Gdy postać zniknie całkowicie z pamięci procesu przed terminalnym zdarzeniem walki, serwis zapisze ostrzeżenie; standardowy przepływ rozłączenia utrzymuje jednak uczestnika walki do jej rozstrzygnięcia.
