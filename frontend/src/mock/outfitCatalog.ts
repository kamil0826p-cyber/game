import type { CharacterClass } from '../contracts/game';

export interface ClientOutfitDefinition {
  key: string;
  label: string;
  characterClass: CharacterClass;
  unlockLevel: number;
  description: string;
}

const makeOutfits = (
  characterClass: CharacterClass,
  definitions: ReadonlyArray<readonly [key: string, label: string, unlockLevel: number, description: string]>,
): readonly ClientOutfitDefinition[] =>
  definitions.map(([key, label, unlockLevel, description]) => ({ key, label, characterClass, unlockLevel, description }));

export const OUTFIT_CATALOG: Readonly<Record<CharacterClass, readonly ClientOutfitDefinition[]>> = {
  MAGE: makeOutfits('MAGE', [
    ['mage-apprentice', 'Szaty ucznia', 1, 'Klasyczne szaty młodego adepta magii.'],
    ['mage-scholar', 'Szaty uczonego', 10, 'Lekki strój badacza tajemnych ksiąg.'],
    ['mage-ember', 'Mag żaru', 20, 'Szaty przeszyte czerwonym blaskiem ognia.'],
    ['mage-frost', 'Mag mrozu', 30, 'Błękitne szaty odporne na lodowy wiatr.'],
    ['mage-storm', 'Mag burzy', 40, 'Strój naznaczony energią piorunów.'],
    ['mage-enchanter', 'Zaklinacz', 50, 'Bogato zdobiony ubiór do rytuałów.'],
    ['mage-archmage', 'Arcymag', 60, 'Ceremonialne szaty obszyte złotem.'],
    ['mage-astral', 'Mag astralny', 70, 'Szaty utkane z nocnego nieba.'],
    ['mage-void', 'Mag pustki', 80, 'Mroczny strój dla mistrzów zakazanej wiedzy.'],
    ['mage-royal', 'Królewski mag', 90, 'Reprezentacyjny ubiór nadwornego czarodzieja.'],
    ['mage-ascendant', 'Wyniesiony', 100, 'Najwyższa forma arcymaga, przepełniona czystą magią.'],
  ]),
  WARRIOR: makeOutfits('WARRIOR', [
    ['warrior-recruit', 'Pancerz rekruta', 1, 'Prosty i niezawodny pancerz polowy.'],
    ['warrior-iron', 'Żelazny wojownik', 10, 'Cięższy zestaw z kutego żelaza.'],
    ['warrior-guardian', 'Strażnik', 20, 'Barwy miejskiej straży i solidna tarcza.'],
    ['warrior-raider', 'Najeźdźca', 30, 'Surowy pancerz do szybkich wypadów.'],
    ['warrior-templar', 'Templariusz', 40, 'Jasna zbroja rycerza zakonnego.'],
    ['warrior-veteran', 'Weteran', 50, 'Pancerz noszący ślady wielu bitew.'],
    ['warrior-champion', 'Czempion', 60, 'Złota płyta i karmazynowy płaszcz.'],
    ['warrior-warlord', 'Wódz', 70, 'Groźny rynsztunek dowódcy armii.'],
    ['warrior-dragon', 'Smoczy rycerz', 80, 'Zbroja inspirowana łuskami smoka.'],
    ['warrior-royal', 'Królewski gwardzista', 90, 'Najlepszy pancerz królewskiej gwardii.'],
    ['warrior-immortal', 'Nieśmiertelny', 100, 'Legendarny pancerz wojownika, który nie zna porażki.'],
  ]),
  ARCHER: makeOutfits('ARCHER', [
    ['archer-scout', 'Zwiadowca', 1, 'Leśne skóry do cichego poruszania się.'],
    ['archer-hunter', 'Łowca', 10, 'Praktyczny strój tropiciela zwierzyny.'],
    ['archer-forest', 'Leśny strzelec', 20, 'Zielony ubiór wtapiający się w knieje.'],
    ['archer-desert', 'Pustynny strzelec', 30, 'Lekki strój chroniący przed słońcem.'],
    ['archer-shadow', 'Cień', 40, 'Ciemny zestaw do nocnych zasadzek.'],
    ['archer-marksman', 'Wyborowy strzelec', 50, 'Precyzyjny ekwipunek do dalekich strzałów.'],
    ['archer-ranger', 'Łowczy', 60, 'Strój doświadczonego obrońcy szlaków.'],
    ['archer-wind', 'Strzelec wiatru', 70, 'Lekki płaszcz dla mistrza szybkości.'],
    ['archer-moon', 'Księżycowy łucznik', 80, 'Srebrzysty ubiór nocnego łowcy.'],
    ['archer-royal', 'Królewski łucznik', 90, 'Reprezentacyjny strój elitarnej straży.'],
    ['archer-starshot', 'Gwiezdny strzelec', 100, 'Legendarny ubiór mistrza, którego strzały przecinają niebo.'],
  ]),
};

export const CLASS_PRESENTATION: Readonly<Record<CharacterClass, { label: string; role: string; description: string; accent: string }>> = {
  MAGE: { label: 'Mage', role: 'Arcane specialist', description: 'High energy and intelligence with fragile defenses.', accent: 'text-violet-300' },
  WARRIOR: { label: 'Warrior', role: 'Armored vanguard', description: 'High health, strength, and armor for close combat.', accent: 'text-rose-300' },
  ARCHER: { label: 'Archer', role: 'Agile marksman', description: 'High agility with balanced health and energy.', accent: 'text-emerald-300' },
};

export const outfitImageUrl = (outfitKey: string): string => `/assets/sprites/${encodeURIComponent(outfitKey)}.png`;
