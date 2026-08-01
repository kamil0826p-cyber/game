import type { SkillTreeSnapshot, SkillTargeting } from '../../contracts/socket';
import type {
  SkillBuildNodePayload,
  SkillBuildSnapshot,
  SkillLoadoutInvalidReason,
  SkillSpecializationPayload,
} from '../../contracts/skillBuild';

interface LocalizedCopy {
  name: string;
  description: string;
}

const plNodeCopy: Record<string, LocalizedCopy> = {
  'mage-arcanist-resonance': { name: 'Rezonująca koncentracja', description: 'Każda ranga wzmacnia Iskrę Arkanów bez zmiany jej roli.' },
  'mage-arcanist-fractured-ray': { name: 'Rozszczepiony promień', description: 'Iskra Arkanów może trafić tylny rząd wroga i zyskuje niewielką premię do obrażeń.' },
  'mage-arcanist-efficient-lock': { name: 'Wydajna blokada', description: 'Blokada Czasu kosztuje mniej energii, ale nadal ma długi czas odnowienia.' },
  'mage-arcanist-chrono-collapse': { name: 'Załamanie czasu', description: 'Kataklizm Żywiołów zadaje większe obrażenia, ale odnawia się o jedną turę dłużej.' },
  'mage-pyromancer-kindling': { name: 'Rozniecenie', description: 'Każda ranga zwiększa obrażenia Kuli Ognia.' },
  'mage-pyromancer-searing-lance': { name: 'Paląca lanca', description: 'Lanca Żaru nakłada również krótkie podpalenie.' },
  'mage-pyromancer-conserved-flame': { name: 'Zachowany płomień', description: 'Meteor kosztuje mniej energii, ale nie otrzymuje bezpośredniej premii do obrażeń.' },
  'mage-pyromancer-ashen-verdict': { name: 'Popielny wyrok', description: 'Meteor zużywa ODSŁONIĘCIE, aby wykonać skoordynowane, potężne uderzenie.' },
  'mage-cryomancer-deep-freeze': { name: 'Głębokie mrożenie', description: 'Każda ranga zwiększa obrażenia Mroźnej Nowy.' },
  'mage-cryomancer-front-nova': { name: 'Lodowcowy front', description: 'Mroźna Nowa skupia się na przednim rzędzie wroga i zadaje większe obrażenia.' },
  'mage-cryomancer-thin-ice': { name: 'Cienki lód', description: 'Lodowa Bariera kosztuje mniej energii.' },
  'mage-cryomancer-whiteout': { name: 'Biała zawieja', description: 'Mroźna Nowa nakłada silniejsze spowolnienie, ale odnawia się o jedną turę dłużej.' },
  'warrior-vanguard-braced': { name: 'Stabilna postawa', description: 'Każda ranga wzmacnia Żelazną Gardę.' },
  'warrior-vanguard-linebreaker': { name: 'Łamacz szyku', description: 'Uderzenie Tarczą atakuje przedni rząd wroga.' },
  'warrior-vanguard-cheap-guard': { name: 'Wyważona garda', description: 'Żelazna Garda kosztuje mniej energii.' },
  'warrior-vanguard-unyielding-line': { name: 'Nieugięta linia', description: 'Ostatni Bastion zapewnia dodatkowy efekt obronny.' },
  'warrior-berserker-rage': { name: 'Szał', description: 'Każda ranga zwiększa obrażenia Rozpłatania.' },
  'warrior-berserker-blood-price': { name: 'Cena krwi', description: 'Egzekucja kosztuje mniej energii.' },
  'warrior-berserker-front-whirlwind': { name: 'Miażdżący krąg', description: 'Wicher skupia się na przednim rzędzie wroga i zadaje większe obrażenia.' },
  'warrior-berserker-blood-execution': { name: 'Krwawa egzekucja', description: 'Egzekucja zużywa KRWAWIENIE, aby wykonać skoordynowane dobicie.' },
  'warrior-warlord-command': { name: 'Dowódcza obecność', description: 'Każda ranga wzmacnia efekty Okrzyku Bojowego.' },
  'warrior-warlord-disciplined-cry': { name: 'Zdyscyplinowany okrzyk', description: 'Okrzyk Bojowy kosztuje mniej energii.' },
  'warrior-warlord-front-cleave': { name: 'Uporządkowane natarcie', description: 'Rozpłatanie skupia się na przednim rzędzie i zadaje większe obrażenia.' },
  'warrior-warlord-iron-march': { name: 'Żelazny marsz', description: 'Niezłomny Szturm nakłada ZACHWIANIE, wspierając kombinacje drużyny.' },
  'archer-sharpshooter-aim': { name: 'Pewny cel', description: 'Każda ranga zwiększa obrażenia Przebijającej Strzały.' },
  'archer-sharpshooter-backline': { name: 'Widok na tylną linię', description: 'Szybki Strzał atakuje tylny rząd wroga.' },
  'archer-sharpshooter-efficient-pierce': { name: 'Wydajne przebicie', description: 'Przebijająca Strzała kosztuje mniej energii.' },
  'archer-sharpshooter-perfect-window': { name: 'Idealne okno', description: 'Doskonałe Polowanie zużywa ODSŁONIĘCIE, aby zmaksymalizować skoordynowaną presję.' },
  'archer-trapper-barbed': { name: 'Kolczaste pułapki', description: 'Każda ranga zwiększa obrażenia Pułapki Sidłowej.' },
  'archer-trapper-front-volley': { name: 'Strefa śmierci', description: 'Salwa skupia się na przednim rzędzie wroga i zadaje większe obrażenia.' },
  'archer-trapper-light-snare': { name: 'Lekkie sidła', description: 'Pułapka Sidłowa kosztuje mniej energii.' },
  'archer-trapper-hemorrhage': { name: 'Krwotok', description: 'Deszcz Strzał nakłada dodatkowe KRWAWIENIE.' },
  'archer-pathfinder-momentum': { name: 'Pęd', description: 'Każda ranga wzmacnia efekty Uniku z Przewrotem.' },
  'archer-pathfinder-cheap-roll': { name: 'Oszczędny przewrót', description: 'Unik z Przewrotem kosztuje mniej energii.' },
  'archer-pathfinder-back-mark': { name: 'Znak oskrzydlenia', description: 'Znak Drapieżcy atakuje tylny rząd wroga.' },
  'archer-pathfinder-relentless-hunt': { name: 'Nieustępliwe polowanie', description: 'Doskonałe Polowanie zadaje większe obrażenia, ale odnawia się o jedną turę dłużej.' },
};

const plSpecializationCopy: Record<string, Omit<SkillSpecializationPayload, 'key' | 'characterClass' | 'icon' | 'selected' | 'spentPoints'>> = {
  'mage-arcanist': { name: 'Arkanista', promise: 'Precyzyjne wybuchy arkanów i kontrola tempa przeciwnika.', role: 'CONTROL', soloLoop: 'Przygotuj otwarcie Iskrą Arkanów, a następnie zablokuj lub rozbij odsłonięty cel.', groupSynergies: ['Tworzy przewidywalne okna kontroli dla ciężkich ataków sojuszników.', 'Sięga chronionych celów w tylnym rzędzie.'], threatResponse: 'Manipulacja czasem przerywa niebezpieczne tury wroga.', drawback: 'Długie czasy odnowienia kontroli karzą zły wybór celu.' },
  'mage-pyromancer': { name: 'Piromanta', promise: 'Narastające obrażenia od ognia zamieniane w wybuchowe zakończenia.', role: 'DAMAGE', soloLoop: 'Podpal cel, wywieraj presję, a następnie wykorzystaj przygotowanie drużyny Meteorem.', groupSynergies: ['Utrzymuje presję podpalenia na skupionym celu.', 'Wykorzystuje ODSŁONIĘCIE lub ZACHWIANIE do skoordynowanego finiszera.'], threatResponse: 'Wysokie obrażenia natychmiastowe mogą usunąć zagrożenie przed zakończeniem zapowiedzi.', drawback: 'Duże zużycie energii i niewiele narzędzi obronnych.' },
  'mage-cryomancer': { name: 'Kriomanta', promise: 'Kontrola formacji, tarcze i metodyczne wyniszczanie.', role: 'SUPPORT', soloLoop: 'Spowolnij front, osłoń się przed kontrą i ponownie otwórz okno kontroli.', groupSynergies: ['Chroni sojuszników podczas długich zapowiedzi.', 'Spowalnia zwarte formacje pod ataki rzędowe.'], threatResponse: 'Bariera i spowolnienie ograniczają siłę tur wybuchowych.', drawback: 'Niższe obrażenia szczytowe i zależność od planowania tur.' },
  'warrior-vanguard': { name: 'Awangardzista', promise: 'Ochrona pierwszej linii i niezawodna kontrola dostępu wroga.', role: 'DEFENSE', soloLoop: 'Broń się, zachwiej priorytetowe zagrożenie i przetrwaj kontratak.', groupSynergies: ['Tworzy bezpieczne tury dla kruchego tylnego rzędu.', 'Utrzymuje wrogów z przodu pod presją obszarową.'], threatResponse: 'Uderzenie Tarczą i obrona odpowiadają na zapowiedziane ataki.', drawback: 'Niższe obrażenia własne podczas aktywnej ochrony drużyny.' },
  'warrior-berserker': { name: 'Berserker', promise: 'Nieustanna presja fizyczna i decydujące okna egzekucji.', role: 'DAMAGE', soloLoop: 'Rozpłataj front, nabierz rozpędu i dobij ranny cel.', groupSynergies: ['Zużywa KRWAWIENIE lub ODSŁONIĘCIE nałożone przez sojuszników.', 'Wymusza reakcje obronne i otwiera przestrzeń dla magów.'], threatResponse: 'Egzekucja natychmiast usuwa niebezpieczny, osłabiony cel.', drawback: 'Mniej kontroli i kosztowne tury ofensywne.' },
  'warrior-warlord': { name: 'Wódz', promise: 'Tempo drużyny, presja na formację i trwałe dowodzenie polem bitwy.', role: 'HYBRID', soloLoop: 'Ustal tempo Okrzykiem Bojowym, a następnie naciskaj cały rząd formacji.', groupSynergies: ['Przyspieszenie wzmacnia skoordynowane serie obrażeń.', 'Presja rzędowa współgra ze znakami, spowolnieniami i chronionymi czarami.'], threatResponse: 'Ostatni Bastion stabilizuje sytuację po turze wybuchowej wroga.', drawback: 'Siła jest dzielona między atak i wsparcie.' },
  'archer-sharpshooter': { name: 'Strzelec wyborowy', promise: 'Precyzyjna presja na tylną linię i przebijające pancerz finisze.', role: 'DAMAGE', soloLoop: 'Oznacz cel, przebij jego obronę i zakończ Doskonałym Polowaniem.', groupSynergies: ['Zamienia ODSŁONIĘCIE w pewne obrażenia pojedynczego celu.', 'Usuwa chronione zagrożenia z tylnej linii.'], threatResponse: 'Dystansowy ostrzał może wyeliminować niebezpiecznych magów.', drawback: 'Słaba kontrola obszaru i mało możliwości odrobienia złego momentu.' },
  'archer-trapper': { name: 'Pułapkarz', promise: 'Łańcuchy kontroli, przygotowanie krwawienia i kara za przewidywalny ruch.', role: 'CONTROL', soloLoop: 'Unieruchom cel, rozłóż presję Salwą i wykorzystaj kontrolowany rząd.', groupSynergies: ['Unieruchamia cele pod zapowiedzi i ataki rzędowe.', 'Tworzy KRWAWIENIE dla finiszerów i stałej presji.'], threatResponse: 'Pułapka Sidłowa odbiera groźnemu celowi dostęp do preferowanej pozycji.', drawback: 'Tury przygotowawcze zadają mniej natychmiastowych obrażeń.' },
  'archer-pathfinder': { name: 'Tropiciel', promise: 'Mobilność, elastyczne cele i wytrzymała walka manewrowa.', role: 'HYBRID', soloLoop: 'Użyj Uniku z Przewrotem, zmień pozycję nacisku i kontynuuj ostrzał.', groupSynergies: ['Bezpiecznie przemieszcza się wokół chronionych sojuszników.', 'Oznacza cele, zachowując energię na reakcje.'], threatResponse: 'Unik odpowiada na skupione obrażenia fizyczne.', drawback: 'Niższe maksymalne obrażenia niż u Strzelca wyborowego.' },
};

const plRole: Record<SkillSpecializationPayload['role'], string> = {
  DAMAGE: 'Obrażenia', CONTROL: 'Kontrola', SUPPORT: 'Wsparcie', DEFENSE: 'Obrona', HYBRID: 'Hybryda',
};

const plTarget: Record<SkillTargeting, string> = {
  SELF: 'Siebie', ENEMY: 'Wróg', AREA: 'Obszar', ALLY: 'Sojusznik', ALL_ALLIES: 'Wszyscy sojusznicy', ALL_ENEMIES: 'Wszyscy wrogowie', FRONT_ROW: 'Przedni rząd', BACK_ROW: 'Tylny rząd', ADJACENT: 'Sąsiedni cel',
};

const plLoadoutReason: Record<SkillLoadoutInvalidReason, string> = {
  TOO_MANY_ACTIVE_ACTIONS: 'Zbyt wiele aktywnych umiejętności',
  TOO_MANY_PASSIVES: 'Zbyt wiele pasywów',
  PASSIVE_BUDGET_EXCEEDED: 'Przekroczony budżet pasywów',
  UNKNOWN_SKILL: 'Nieznana umiejętność',
  SKILL_NOT_LEARNED: 'Umiejętność nie została poznana',
  UNKNOWN_PASSIVE: 'Nieznany pasyw',
  PASSIVE_NOT_LEARNED: 'Pasyw nie został poznany',
  SPECIALIZATION_MISMATCH: 'Talent należy do innej specjalizacji',
  DUPLICATE_ENTRY: 'Powtórzony wpis w zestawie',
};

const displayNodeName = (key: string, nodes: readonly SkillBuildNodePayload[]): string =>
  plNodeCopy[key]?.name ?? nodes.find((node) => node.key === key)?.name ?? key;

const localizeBlockedReason = (reason: string, nodes: readonly SkillBuildNodePayload[]): string => {
  const [code, ...parts] = reason.split(':');
  const names = parts.filter(Boolean).map((key) => displayNodeName(key, nodes));
  switch (code) {
    case 'LEVEL_REQUIRED': return 'Wymagany wyższy poziom postaci';
    case 'POINTS_REQUIRED': return 'Brak dostępnych punktów';
    case 'MAX_RANK': return 'Osiągnięto maksymalną rangę';
    case 'SPECIALIZATION_REQUIRED': return 'Najpierw wybierz tę specjalizację';
    case 'PREREQUISITE': return `Wymaga: ${names.join(', ')}`;
    case 'PREREQUISITE_ANY': return `Wymaga jednego z talentów: ${names.join(' lub ')}`;
    case 'CHOICE_CONFLICT': return `Wyklucza się z: ${names.join(', ')}`;
    case 'INVALID_RANK': return 'Nieprawidłowa ranga';
    case 'UNKNOWN_NODE': return 'Nieznany talent';
    default: return 'Warunki odblokowania nie zostały spełnione';
  }
};

const localizeBuild = (snapshot: SkillTreeSnapshot): SkillTreeSnapshot => {
  const build = snapshot as SkillBuildSnapshot;
  if (!Array.isArray(build.nodes) || !Array.isArray(build.specializations)) return snapshot;
  const nodes = build.nodes.map((node) => ({
    ...node,
    ...(plNodeCopy[node.key] ?? {}),
  }));
  return {
    ...build,
    skills: build.skills.map((skill) => ({
      ...skill,
      targeting: skill.targeting,
    })),
    nodes: nodes.map((node) => ({
      ...node,
      blockedReasons: node.blockedReasons.map((reason) => localizeBlockedReason(reason, nodes)),
      prerequisiteKeys: node.prerequisiteKeys.map((key) => displayNodeName(key, nodes)),
    })),
    specializations: build.specializations.map((specialization) => {
      const copy = plSpecializationCopy[specialization.key];
      return copy ? { ...specialization, ...copy, role: plRole[copy.role] as SkillSpecializationPayload['role'] } : specialization;
    }),
    loadouts: build.loadouts.map((loadout) => ({
      ...loadout,
      invalidReasons: loadout.invalidReasons.map((reason) => plLoadoutReason[reason] ?? reason) as SkillLoadoutInvalidReason[],
    })),
    activeLoadout: build.activeLoadout
      ? {
          ...build.activeLoadout,
          invalidReasons: build.activeLoadout.invalidReasons.map((reason) => plLoadoutReason[reason] ?? reason) as SkillLoadoutInvalidReason[],
        }
      : undefined,
  } as SkillBuildSnapshot;
};

let installed = false;
let currentLocale = 'en';

export const installBuildcraftLocalization = (locale: string): void => {
  currentLocale = locale;
  if (installed) return;
  installed = true;

  void import('../state/gameStore').then(({ gameStore }) => {
    const originalSpawn = gameStore.spawn.bind(gameStore);
    const originalUpdateSkillTree = gameStore.updateSkillTree.bind(gameStore);

    gameStore.spawn = (payload) =>
      originalSpawn({
        ...payload,
        skillTree: currentLocale === 'pl' ? localizeBuild(payload.skillTree) : payload.skillTree,
      });
    gameStore.updateSkillTree = (skillTree) =>
      originalUpdateSkillTree(currentLocale === 'pl' ? localizeBuild(skillTree) : skillTree);
  });
};

export const localizedTarget = (target: SkillTargeting, locale: string): string =>
  locale === 'pl' ? plTarget[target] : target;
