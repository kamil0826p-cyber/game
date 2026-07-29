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
): readonly ClientOutfitDefinition[] => definitions.map(([key, label, unlockLevel, description]) => ({ key, label, characterClass, unlockLevel, description }));

export const OUTFIT_CATALOG: Readonly<Record<CharacterClass, readonly ClientOutfitDefinition[]>> = {
  MAGE: makeOutfits('MAGE', [
    ['mage-apprentice', 'Szaty ucznia', 1, 'Klasyczne szaty młodego adepta magii.'],
    ['mage-scholar', 'Szaty uczonego', 1, 'Lekki strój badacza tajemnych ksiąg.'],
    ['mage-ember', 'Mag żaru', 1, 'Szaty przeszyte czerwonym blaskiem ognia.'],
    ['mage-frost', 'Mag mrozu', 1, 'Błękitne szaty odporne na lodowy wiatr.'],
    ['mage-storm', 'Mag burzy', 1, 'Strój naznaczony energią piorunów.'],
    ['mage-enchanter', 'Zaklinacz', 5, 'Bogato zdobiony ubiór do rytuałów.'],
    ['mage-archmage', 'Arcymag', 10, 'Ceremonialne szaty obszyte złotem.'],
    ['mage-astral', 'Mag astralny', 15, 'Szaty utkane z nocnego nieba.'],
    ['mage-void', 'Mag pustki', 20, 'Mroczny strój dla mistrzów zakazanej wiedzy.'],
    ['mage-royal', 'Królewski mag', 25, 'Reprezentacyjny ubiór nadwornego czarodzieja.'],
  ]),
  WARRIOR: makeOutfits('WARRIOR', [
    ['warrior-recruit', 'Pancerz rekruta', 1, 'Prosty i niezawodny pancerz polowy.'],
    ['warrior-iron', 'Żelazny wojownik', 1, 'Cięższy zestaw z kutego żelaza.'],
    ['warrior-guardian', 'Strażnik', 1, 'Barwy miejskiej straży i solidna tarcza.'],
    ['warrior-raider', 'Najeźdźca', 1, 'Surowy pancerz do szybkich wypadów.'],
    ['warrior-templar', 'Templariusz', 1, 'Jasna zbroja rycerza zakonnego.'],
    ['warrior-veteran', 'Weteran', 5, 'Pancerz noszący ślady wielu bitew.'],
    ['warrior-champion', 'Czempion', 10, 'Złota płyta i karmazynowy płaszcz.'],
    ['warrior-warlord', 'Wódz', 15, 'Groźny rynsztunek dowódcy armii.'],
    ['warrior-dragon', 'Smoczy rycerz', 20, 'Zbroja inspirowana łuskami smoka.'],
    ['warrior-royal', 'Królewski gwardzista', 25, 'Najlepszy pancerz królewskiej gwardii.'],
  ]),
  ARCHER: makeOutfits('ARCHER', [
    ['archer-scout', 'Zwiadowca', 1, 'Leśne skóry do cichego poruszania się.'],
    ['archer-hunter', 'Łowca', 1, 'Praktyczny strój tropiciela zwierzyny.'],
    ['archer-forest', 'Leśny strzelec', 1, 'Zielony ubiór wtapiający się w knieje.'],
    ['archer-desert', 'Pustynny strzelec', 1, 'Lekki strój chroniący przed słońcem.'],
    ['archer-shadow', 'Cień', 1, 'Ciemny zestaw do nocnych zasadzek.'],
    ['archer-marksman', 'Wyborowy strzelec', 5, 'Precyzyjny ekwipunek do dalekich strzałów.'],
    ['archer-ranger', 'Łowczy', 10, 'Strój doświadczonego obrońcy szlaków.'],
    ['archer-wind', 'Strzelec wiatru', 15, 'Lekki płaszcz dla mistrza szybkości.'],
    ['archer-moon', 'Księżycowy łucznik', 20, 'Srebrzysty ubiór nocnego łowcy.'],
    ['archer-royal', 'Królewski łucznik', 25, 'Reprezentacyjny strój elitarnej straży.'],
  ]),
};

export const CLASS_PRESENTATION: Readonly<Record<CharacterClass, { label: string; role: string; description: string; accent: string }>> = {
  MAGE: { label: 'Mage', role: 'Arcane specialist', description: 'High energy and intelligence with fragile defenses.', accent: 'text-violet-300' },
  WARRIOR: { label: 'Warrior', role: 'Armored vanguard', description: 'High health, strength, and armor for close combat.', accent: 'text-rose-300' },
  ARCHER: { label: 'Archer', role: 'Agile marksman', description: 'High agility with balanced health and energy.', accent: 'text-emerald-300' },
};

export const outfitImageUrl = (outfitKey: string): string => `/assets/sprites/${encodeURIComponent(outfitKey)}.png`;
