import type { Locale } from '../../i18n/dictionaries';

type LocalizedSkillCopy = Record<Locale, { name: string; description: string }>;

const copy: Readonly<Record<string, LocalizedSkillCopy>> = {
  'mage-arcane-spark': {
    en: { name: 'Arcane Spark', description: 'Launches a fast arcane bolt at one enemy.' },
    pl: {
      name: 'Iskra arkanów',
      description: 'Posyła w jednego przeciwnika szybki pocisk energii arkanów.',
    },
  },
  'mage-flame-orb': {
    en: { name: 'Flame Orb', description: 'Hurls a burning orb that ignites its target.' },
    pl: { name: 'Kula ognia', description: 'Miota płonącą kulę, która podpala cel.' },
  },
  'mage-frost-nova': {
    en: {
      name: 'Frost Nova',
      description: 'Freezes the battlefield, damaging and slowing every enemy.',
    },
    pl: {
      name: 'Mroźna nova',
      description: 'Zamraża pole walki, raniąc i spowalniając wszystkich przeciwników.',
    },
  },
  'mage-ember-lance': {
    en: {
      name: 'Ember Lance',
      description: 'Pierces one enemy with concentrated fire that ignores part of its armor.',
    },
    pl: {
      name: 'Żarowa lanca',
      description:
        'Przebija jednego wroga skoncentrowanym ogniem, częściowo ignorując pancerz.',
    },
  },
  'mage-ice-barrier': {
    en: {
      name: 'Ice Barrier',
      description: 'Surrounds the caster with a temporary shield of enchanted ice.',
    },
    pl: {
      name: 'Lodowa bariera',
      description: 'Otacza maga tymczasową tarczą z zaklętego lodu.',
    },
  },
  'mage-meteor': {
    en: { name: 'Meteor', description: 'Calls down a meteor that burns every enemy.' },
    pl: {
      name: 'Meteor',
      description: 'Przyzywa meteor, który rani i podpala wszystkich przeciwników.',
    },
  },
  'mage-time-lock': {
    en: {
      name: 'Time Lock',
      description: 'Suspends one enemy in time and prevents its next action.',
    },
    pl: {
      name: 'Blokada czasu',
      description: 'Zatrzymuje jednego przeciwnika w czasie i odbiera mu następną akcję.',
    },
  },
  'mage-elemental-cataclysm': {
    en: {
      name: 'Elemental Cataclysm',
      description: 'Combines fire, frost, and arcane force in a devastating battlefield spell.',
    },
    pl: {
      name: 'Kataklizm żywiołów',
      description: 'Łączy ogień, mróz i arkana w niszczycielskim zaklęciu obszarowym.',
    },
  },
  'warrior-shield-bash': {
    en: { name: 'Shield Bash', description: 'Strikes one enemy and briefly staggers it.' },
    pl: {
      name: 'Uderzenie tarczą',
      description: 'Uderza jednego przeciwnika i może go na chwilę ogłuszyć.',
    },
  },
  'warrior-cleave': {
    en: { name: 'Cleave', description: 'Sweeps a weapon through every enemy.' },
    pl: {
      name: 'Rozpłatanie',
      description: 'Szerokim zamachem dosięga wszystkich przeciwników.',
    },
  },
  'warrior-iron-guard': {
    en: {
      name: 'Iron Guard',
      description: 'Raises a defensive stance that greatly reduces incoming damage.',
    },
    pl: {
      name: 'Żelazna garda',
      description: 'Przyjmuje postawę znacznie ograniczającą otrzymywane obrażenia.',
    },
  },
  'warrior-whirlwind': {
    en: {
      name: 'Whirlwind',
      description: 'Spins through the enemy formation with a powerful series of strikes.',
    },
    pl: {
      name: 'Wir ostrzy',
      description: 'Wiruje wśród wrogów, zadając serię potężnych ciosów.',
    },
  },
  'warrior-battle-cry': {
    en: {
      name: 'Battle Cry',
      description: 'Increases the warrior’s damage and initiative for several turns.',
    },
    pl: {
      name: 'Okrzyk bojowy',
      description: 'Na kilka tur zwiększa obrażenia i inicjatywę wojownika.',
    },
  },
  'warrior-execution': {
    en: { name: 'Execution', description: 'Deals extreme damage to a badly wounded enemy.' },
    pl: {
      name: 'Egzekucja',
      description: 'Zadaje ogromne obrażenia ciężko rannemu przeciwnikowi.',
    },
  },
  'warrior-last-stand': {
    en: {
      name: 'Last Stand',
      description: 'Recovers health and hardens the warrior against incoming attacks.',
    },
    pl: {
      name: 'Ostatni bastion',
      description: 'Odzyskuje zdrowie i wzmacnia obronę przed kolejnymi atakami.',
    },
  },
  'warrior-unbreakable-assault': {
    en: {
      name: 'Unbreakable Assault',
      description: 'Charges through the enemy line with unstoppable force.',
    },
    pl: {
      name: 'Niepowstrzymany szturm',
      description: 'Przełamuje szeregi przeciwników z niepowstrzymaną siłą.',
    },
  },
  'archer-quick-shot': {
    en: { name: 'Quick Shot', description: 'Fires a fast arrow at one enemy.' },
    pl: {
      name: 'Szybki strzał',
      description: 'Błyskawicznie wypuszcza strzałę w jednego przeciwnika.',
    },
  },
  'archer-piercing-arrow': {
    en: { name: 'Piercing Arrow', description: 'Fires an armor-piercing arrow at one enemy.' },
    pl: {
      name: 'Przebijająca strzała',
      description: 'Wystrzeliwuje strzałę częściowo ignorującą pancerz przeciwnika.',
    },
  },
  'archer-snare-trap': {
    en: {
      name: 'Snare Trap',
      description: 'Damages one enemy and prevents it from acting freely.',
    },
    pl: { name: 'Wnyki', description: 'Rani jednego wroga i ogranicza jego działania.' },
  },
  'archer-volley': {
    en: { name: 'Volley', description: 'Rains arrows over every enemy.' },
    pl: { name: 'Salwa', description: 'Zasypuje wszystkich przeciwników gradem strzał.' },
  },
  'archer-evasive-roll': {
    en: { name: 'Evasive Roll', description: 'Avoids incoming attacks and gains initiative.' },
    pl: { name: 'Unik', description: 'Pozwala unikać ataków i zwiększa inicjatywę.' },
  },
  'archer-rain-of-arrows': {
    en: {
      name: 'Rain of Arrows',
      description: 'Blankets the battlefield with arrows that leave enemies bleeding.',
    },
    pl: {
      name: 'Deszcz strzał',
      description: 'Pokrywa pole walki strzałami, wywołując krwawienie przeciwników.',
    },
  },
  'archer-predators-mark': {
    en: {
      name: 'Predator’s Mark',
      description: 'Marks one enemy, increasing all damage it receives.',
    },
    pl: {
      name: 'Znak łowcy',
      description: 'Oznacza jednego wroga, zwiększając otrzymywane przez niego obrażenia.',
    },
  },
  'archer-perfect-hunt': {
    en: {
      name: 'Perfect Hunt',
      description: 'Exploits every opening with a lethal, perfectly aimed shot.',
    },
    pl: {
      name: 'Doskonałe polowanie',
      description: 'Wykorzystuje każdą słabość śmiertelnie precyzyjnym strzałem.',
    },
  },
};

export const getSkillCopy = (
  key: string,
  locale: Locale,
  fallback: { name: string; description: string },
): { name: string; description: string } => copy[key]?.[locale] ?? fallback;
