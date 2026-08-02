import type { ExpeditionDefinition } from './expedition.types.js';

export const ASHEN_PILGRIMAGE: ExpeditionDefinition = {
  key: 'ashen-pilgrimage',
  version: 1,
  contentVersion: '2026.08.02.1',
  name: 'Popielna Pielgrzymka',
  minimumPartySize: 1,
  maximumPartySize: 10,
  recommendedPartySize: 5,
  entryConditions: [{ type: 'LEVEL_AT_LEAST', level: 5 }],
  preparationCost: {
    silver: 25,
    items: [],
  },
  decisionPolicy: 'LEADER',
  startNodeKey: 'black-gate',
  resources: [
    { key: 'light', label: 'Światło', initial: 6, minimum: 0, maximum: 8, failureAtMinimum: true },
    { key: 'supplies', label: 'Zapasy', initial: 4, minimum: 0, maximum: 6 },
    { key: 'morale', label: 'Morale', initial: 5, minimum: 0, maximum: 7, failureAtMinimum: true },
    { key: 'ritual-stability', label: 'Stabilność rytuału', initial: 3, minimum: 0, maximum: 5 },
    { key: 'threat', label: 'Zagrożenie', initial: 0, minimum: 0, maximum: 10 },
  ],
  riskProfiles: [
    {
      key: 'guarded',
      version: 1,
      label: 'Ostrożna wyprawa',
      pendingLootLossPercent: 40,
      maxConsequenceSeverity: 1,
      consequencePool: ['ash-burn', 'frayed-nerves'],
      insuranceCostSilver: 20,
      insurancePendingLootLossReductionPercent: 25,
      insuranceConsequenceSeverityReduction: 1,
      checkpointSecurityPercent: 60,
    },
    {
      key: 'blood-oath',
      version: 1,
      label: 'Krwawe zobowiązanie',
      pendingLootLossPercent: 70,
      maxConsequenceSeverity: 2,
      consequencePool: ['ash-burn', 'frayed-nerves', 'ritual-scar'],
      insuranceCostSilver: 45,
      insurancePendingLootLossReductionPercent: 20,
      insuranceConsequenceSeverityReduction: 1,
      checkpointSecurityPercent: 35,
    },
  ],
  difficultyProfiles: [
    {
      key: 'BASE',
      label: 'Podstawowa',
      mechanics: ['SCOUTED_BRANCHES', 'ONE_RITUAL_COUNTER'],
      hiddenPreviewFields: [],
    },
    {
      key: 'MASTERED',
      label: 'Mistrzowska',
      mechanics: ['PARTIAL_ROUTE_INTEL', 'STARTING_THREAT'],
      hiddenPreviewFields: ['knownCost'],
      extraResourcePressure: [{ resourceKey: 'threat', amount: 1 }],
    },
    {
      key: 'RITUAL',
      label: 'Rytualna',
      mechanics: ['NEMESIS_VARIANT', 'RITUAL_STABILITY_DRAIN', 'EXTRA_STARTING_THREAT'],
      hiddenPreviewFields: ['knownCost', 'scoutHint'],
      extraResourcePressure: [
        { resourceKey: 'ritual-stability', amount: -1 },
        { resourceKey: 'threat', amount: 2 },
      ],
    },
  ],
  encounterPools: [
    {
      key: 'brood-crossing',
      entries: [{ encounterKey: 'brood-hunt', encounterVersion: 1, weight: 1 }],
    },
    {
      key: 'execution-crossing',
      entries: [{ encounterKey: 'execution-circle', encounterVersion: 1, weight: 1 }],
    },
    {
      key: 'ritual-hunt',
      entries: [
        {
          encounterKey: 'execution-circle',
          encounterVersion: 1,
          weight: 2,
          variantKey: 'salted-chains',
          requiredRitualChoiceKey: 'salted-chain',
        },
        {
          encounterKey: 'execution-circle',
          encounterVersion: 1,
          weight: 2,
          variantKey: 'blind-lantern',
          requiredRitualChoiceKey: 'blind-lantern',
        },
        {
          encounterKey: 'execution-circle',
          encounterVersion: 1,
          weight: 1,
          variantKey: 'unprepared-nemesis',
        },
      ],
    },
  ],
  lootPools: [
    {
      key: 'road-cache',
      rolls: 1,
      entries: [
        { key: 'road-silver', weight: 5, category: 'SILVER', core: true, silver: 25 },
        { key: 'chitin-buckler', weight: 2, category: 'EQUIPMENT', core: true, itemKey: 'tempered-chitin-buckler', quantity: 1 },
      ],
    },
    {
      key: 'ritual-relic',
      rolls: 1,
      entries: [
        { key: 'ritual-silver', weight: 4, category: 'SILVER', core: true, silver: 60 },
        { key: 'ashen-focus', weight: 1, category: 'RELIC', core: true, itemKey: 'ashen-reliquary-focus', quantity: 1 },
      ],
    },
  ],
  nodes: [
    {
      key: 'black-gate',
      type: 'START',
      title: 'Czarna Brama',
      description: 'Grupa wybiera pierwszą drogę na podstawie zwiadu i zapasów.',
      outgoing: [
        {
          key: 'take-hollow-road',
          toNodeKey: 'hollow-road',
          preview: {
            threatType: 'Zasadzka pomiotu',
            knownCost: '1 światło',
            rewardCategory: 'materiały i srebro',
            scoutHint: 'Wąska droga premiuje ochronę tylnej linii.',
          },
          costs: [{ resourceKey: 'light', amount: -1 }],
        },
        {
          key: 'enter-bone-marsh',
          toNodeKey: 'bone-marsh',
          preview: {
            threatType: 'Hazard i egzekutorzy',
            knownCost: '1 zapas, +1 zagrożenie',
            rewardCategory: 'relikty',
            scoutHint: 'Bagno pozwala ominąć pierwszy patrol kosztem zasobów.',
          },
          costs: [
            { resourceKey: 'supplies', amount: -1 },
            { resourceKey: 'threat', amount: 1 },
          ],
        },
      ],
    },
    {
      key: 'hollow-road',
      type: 'COMBAT',
      title: 'Pusta Droga',
      description: 'Wielomobowa obława pomiotu blokuje przejście.',
      encounterPoolKey: 'brood-crossing',
      onSuccess: [{ resourceKey: 'morale', amount: 1 }],
      onFailure: [{ resourceKey: 'morale', amount: -2 }],
      outgoing: [
        {
          key: 'follow-ash-tracks',
          toNodeKey: 'ash-tracks',
          preview: { threatType: 'Śledztwo', knownCost: 'brak', rewardCategory: 'wiedza', scoutHint: 'Tropy zdradzają rytualne znaki.' },
        },
      ],
    },
    {
      key: 'ash-tracks',
      type: 'INVESTIGATION',
      title: 'Tropy w Popiele',
      description: 'Zebrana wiedza ujawnia kategorię zagrożenia, ale nie pełny skrypt encounteru.',
      outgoing: [
        {
          key: 'interpret-ritual-signs',
          toNodeKey: 'fork-of-vows',
          preview: {
            threatType: 'Rozwidlenie i przysięgi',
            knownCost: 'brak',
            rewardCategory: 'wiedza i wybór trasy',
            scoutHint: 'Aktywna przysięga może otworzyć trzecią drogę.',
          },
        },
      ],
    },
    {
      key: 'bone-marsh',
      type: 'HAZARD',
      title: 'Kościane Mokradło',
      description: 'Grupa przechodzi przez skażone bagno, zarządzając światłem i morale.',
      onSuccess: [{ resourceKey: 'light', amount: -1 }],
      onFailure: [
        { resourceKey: 'light', amount: -2 },
        { resourceKey: 'morale', amount: -1 },
      ],
      outgoing: [
        {
          key: 'cross-the-gallows',
          toNodeKey: 'pilgrim-rest',
          preview: { threatType: 'Odpoczynek pielgrzymów', knownCost: '+1 zagrożenie', rewardCategory: 'relikty', scoutHint: 'Łańcuchy zdradzają rytm patrolu.' },
          costs: [{ resourceKey: 'threat', amount: 1 }],
        },
      ],
    },
    {
      key: 'pilgrim-rest',
      type: 'REST',
      title: 'Ognisko Pielgrzymów',
      description: 'Ograniczony odpoczynek wymienia zapasy na morale albo pozwala iść dalej kosztem zagrożenia.',
      outgoing: [
        {
          key: 'spend-supplies-to-rest',
          toNodeKey: 'whispering-bells',
          preview: { threatType: 'Regeneracja', knownCost: '1 zapas', rewardCategory: 'morale' },
          costs: [
            { resourceKey: 'supplies', amount: -1 },
            { resourceKey: 'morale', amount: 2 },
          ],
        },
        {
          key: 'press-on-without-rest',
          toNodeKey: 'whispering-bells',
          preview: { threatType: 'Zmęczenie', knownCost: '+1 zagrożenie', rewardCategory: 'oszczędzone zapasy' },
          costs: [{ resourceKey: 'threat', amount: 1 }],
        },
      ],
    },
    {
      key: 'whispering-bells',
      type: 'EVENT',
      title: 'Szepczące Dzwony',
      description: 'Jawny wybór kosztu prowadzi do tego samego rozwidlenia, ale zmienia budżet dalszego ryzyka.',
      outgoing: [
        {
          key: 'silence-the-bells',
          toNodeKey: 'fork-of-vows',
          preview: { threatType: 'Zdarzenie', knownCost: '1 światło', rewardCategory: 'niższe zagrożenie' },
          costs: [
            { resourceKey: 'light', amount: -1 },
            { resourceKey: 'threat', amount: -1 },
          ],
        },
        {
          key: 'listen-to-the-bells',
          toNodeKey: 'fork-of-vows',
          preview: { threatType: 'Zdarzenie', knownCost: '+1 skażenie runu', rewardCategory: 'wiedza rytualna' },
          costs: [{ resourceKey: 'ritual-stability', amount: -1 }],
        },
      ],
    },
    {
      key: 'fork-of-vows',
      type: 'BRANCH_GATE',
      title: 'Rozwidlenie Przysiąg',
      description: 'Flagi, przysięgi i skażenie mogą ujawnić dodatkowe informacje, ale nie blokują legalnej ekstrakcji.',
      outgoing: [
        {
          key: 'hunt-brood',
          toNodeKey: 'brood-sanctum',
          preview: { threatType: 'Gniazdo pomiotu', knownCost: '1 zapas', rewardCategory: 'materiały', scoutHint: 'Niższe ryzyko, stabilny łup.' },
          costs: [{ resourceKey: 'supplies', amount: -1 }],
        },
        {
          key: 'challenge-executioners',
          toNodeKey: 'execution-yard',
          preview: { threatType: 'Krąg kata', knownCost: '+2 zagrożenie', rewardCategory: 'relikty', scoutHint: 'Więcej równoległych zagrożeń dla dużej grupy.' },
          costs: [{ resourceKey: 'threat', amount: 2 }],
        },
        {
          key: 'invoke-ashen-oath',
          toNodeKey: 'ritual-preparation',
          preview: { threatType: 'Przysięga', knownCost: '2 stabilności rytuału', rewardCategory: 'bezpośrednie polowanie', scoutHint: 'Dostępne tylko przy aktywnej przysiędze popiołu.' },
          costs: [{ resourceKey: 'ritual-stability', amount: -2 }],
          conditions: [{ type: 'CONSEQUENCE', kind: 'OATH', key: 'ashen-vow', comparison: 'EQ', value: 'ACTIVE' }],
        },
      ],
    },
    {
      key: 'brood-sanctum',
      type: 'ELITE',
      title: 'Sanktuarium Pomiotu',
      description: 'Wariant obławy z dodatkowym celem zwiadowczym.',
      encounterPoolKey: 'brood-crossing',
      lootPoolKey: 'road-cache',
      onSuccess: [{ resourceKey: 'morale', amount: 1 }],
      onFailure: [{ resourceKey: 'morale', amount: -2 }],
      outgoing: [
        {
          key: 'claim-road-cache',
          toNodeKey: 'ash-merchant',
          preview: { threatType: 'Usługa runu', knownCost: 'wybór wymiany', rewardCategory: 'światło lub zachowane zapasy' },
        },
      ],
    },
    {
      key: 'ash-merchant',
      type: 'MERCHANT',
      title: 'Kupiec Popiołu',
      description: 'Ograniczona usługa działa wyłącznie na zasobach runu; pending loot nie trafia do handlu.',
      outgoing: [
        {
          key: 'trade-supplies-for-light',
          toNodeKey: 'ashen-cache',
          preview: { threatType: 'Usługa', knownCost: '1 zapas', rewardCategory: '+2 światło' },
          costs: [
            { resourceKey: 'supplies', amount: -1 },
            { resourceKey: 'light', amount: 2 },
          ],
        },
        {
          key: 'decline-merchant',
          toNodeKey: 'ashen-cache',
          preview: { threatType: 'Usługa', knownCost: 'brak', rewardCategory: 'zachowane zasoby' },
        },
      ],
    },
    {
      key: 'execution-yard',
      type: 'BOSS',
      title: 'Dziedziniec Egzekucji',
      description: 'Wersjonowany encounter z telegraphami i skalowaniem 1–10.',
      encounterPoolKey: 'execution-crossing',
      lootPoolKey: 'road-cache',
      onSuccess: [{ resourceKey: 'ritual-stability', amount: 1 }],
      onFailure: [
        { resourceKey: 'morale', amount: -2 },
        { resourceKey: 'threat', amount: 1 },
      ],
      outgoing: [
        {
          key: 'take-execution-tithe',
          toNodeKey: 'ashen-cache',
          preview: { threatType: 'Skrytka', knownCost: 'brak', rewardCategory: 'zabezpieczenie łupu' },
        },
      ],
    },
    {
      key: 'ashen-cache',
      type: 'CACHE',
      title: 'Popielna Skrytka',
      description: 'Checkpoint zabezpiecza część pending loot przed dalszym ryzykiem.',
      checkpoint: true,
      outgoing: [
        {
          key: 'extract-now',
          toNodeKey: 'safe-extraction',
          preview: { threatType: 'Ekstrakcja', knownCost: 'brak', rewardCategory: 'zabezpieczony łup' },
        },
        {
          key: 'descend-to-ritual',
          toNodeKey: 'ritual-preparation',
          preview: { threatType: 'Rytualne polowanie', knownCost: '1 światło i 1 stabilność', rewardCategory: 'relikt i mastery', scoutHint: 'Wybrana kontra zmienia fazę celu.' },
          costs: [
            { resourceKey: 'light', amount: -1 },
            { resourceKey: 'ritual-stability', amount: -1 },
          ],
        },
      ],
    },
    {
      key: 'ritual-preparation',
      type: 'RITUAL',
      title: 'Przygotowanie Polowania',
      description: 'Jawny wybór tropu, przynęty i kontry zmienia wariant encounteru.',
      ritualChoices: [
        {
          key: 'salted-chain',
          label: 'Posól łańcuch celu',
          disclosedEffect: 'Osłabia ochronę lidera i otwiera wcześniejsze okno przerwania.',
          encounterVariantKey: 'salted-chains',
          resourceEffects: [{ resourceKey: 'supplies', amount: -1 }],
        },
        {
          key: 'blind-lantern',
          label: 'Zgaś ślepą latarnię',
          disclosedEffect: 'Zmienia otwarcie walki i ujawnia kontrę przeciw telegraphowi.',
          encounterVariantKey: 'blind-lantern',
          resourceEffects: [{ resourceKey: 'light', amount: -1 }],
          corruptionDelta: 1,
        },
      ],
      outgoing: [
        {
          key: 'begin-ritual-hunt',
          toNodeKey: 'ritual-hunt',
          preview: { threatType: 'Nemezis', knownCost: 'wybrany koszt rytuału', rewardCategory: 'relikt', scoutHint: 'Wariant jest deterministyczny względem przygotowania.' },
        },
      ],
    },
    {
      key: 'ritual-hunt',
      type: 'BOSS',
      title: 'Rytualne Polowanie',
      description: 'Encounter korzysta z jawnie wybranego wariantu, nie z adaptacyjnego AI.',
      encounterPoolKey: 'ritual-hunt',
      lootPoolKey: 'ritual-relic',
      onSuccess: [
        { resourceKey: 'morale', amount: 1 },
        { resourceKey: 'threat', amount: -2 },
      ],
      onFailure: [
        { resourceKey: 'morale', amount: -3 },
        { resourceKey: 'ritual-stability', amount: -2 },
      ],
      outgoing: [
        {
          key: 'leave-deep-sanctum',
          toNodeKey: 'deep-extraction',
          preview: { threatType: 'Ekstrakcja', knownCost: 'brak', rewardCategory: 'relikt i historia polowania' },
        },
      ],
    },
    {
      key: 'safe-extraction',
      type: 'EXTRACTION',
      title: 'Bezpieczna Ekstrakcja',
      description: 'Terminalna transakcja przenosi kwalifikowany łup do inventory lub claim queue.',
      outgoing: [],
      terminal: 'EXTRACT',
    },
    {
      key: 'deep-extraction',
      type: 'EXTRACTION',
      title: 'Głęboka Ekstrakcja',
      description: 'Terminalna transakcja kończy pełną trasę rytualną.',
      outgoing: [],
      terminal: 'COMPLETE',
    },
  ],
  checkpointPolicy: {
    reconnectAllowed: true,
    replacementAllowed: false,
    secureOnCheckpoint: true,
    shutdownMode: 'PERSIST_ONLY',
  },
  rewardRules: {
    distribution: 'PERSONAL',
    fullInventoryPolicy: 'CLAIM_QUEUE',
    terminalIdempotency: true,
    coreLootPoolKeys: ['road-cache', 'ritual-relic'],
  },
  rotationPolicy: {
    cadence: 'WEEKLY',
    broadWindowDays: 7,
    rotationVariantKeys: ['ashen-wind', 'silent-bells', 'broken-moon'],
    coreRewardsRemainAvailable: true,
  },
  globalMutators: ['NO_PERMANENT_GEAR_LOSS', 'FROZEN_PARTY_AFTER_START', 'CHECKPOINTED_STATE'],
};

export const EXPEDITION_CATALOG: readonly ExpeditionDefinition[] = [ASHEN_PILGRIMAGE];
