# Lazaret Popielnych

## Przeznaczenie

`ashen-infirmary` to mała, bezpieczna mapa odrodzenia po porażce w walce PvE albo PvP. Przegrany gracz odzyskuje 35% maksymalnego HP i 25% maksymalnej energii, po czym serwer przenosi go na punkt `(11, 11)`.

## Układ mapy

- rozmiar: `24 x 18`, kafel `32 x 32`, mapa ortogonalna i skończona,
- sześć łóżek w dwóch bocznych rzędach,
- stół alchemiczny, szafy, skrzynie z opatrunkami, parawany, misy i cztery paleniska,
- środkowa alejka pozostaje przechodnia,
- portal na `(11, 16)` prowadzi do `greenfields` na `(4, 4)`,
- warstwy `Collisions` i `Portals` są zwykłymi warstwami obiektów Tiled.

## Pliki edytowalne w Tiled

- `frontend/public/maps/ashen-infirmary.json`
- `frontend/public/maps/tiles/ashen-infirmary.tsj`
- `frontend/public/assets/tiles/ashen-infirmary.svg`

Kopia mapy dla seeda znajduje się w `prisma/maps`. Obie kopie JSON mapy muszą pozostać identyczne; test `map-assets.spec.ts` sprawdza ich synchronizację.

## Przepływ porażki

`DefeatRecoveryService` obserwuje końcowe zdarzenie `combat:updated`. Reaguje tylko na przegraną zakończoną jako `DEFEATED`, `FORFEIT` albo `DISCONNECTED`, identyfikuje przegraną drużynę, zabezpiecza operację przed powtórzeniem i zleca autorytatywny transfer przez `MovementCoordinatorService`. Transfer aktualizuje indeks świata, widoczność, mapę klienta i zapis postaci.
