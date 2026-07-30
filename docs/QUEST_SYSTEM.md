# Quest system

The quest system uses the existing `QuestDefinition` and `CharacterQuest` Prisma models. Definitions are data-driven: the server validates `steps` and `rewards`, stores event counters and the active stage in `CharacterQuest.progress`, and derives collection progress from the authoritative inventory.

Supported objectives:

- `COLLECT_ITEM` checks inventory quantity and can consume the required amount during turn-in.
- `KILL_MOB` increments after an authoritative PVE victory and supports exact or prefix matching.
- `TALK_TO_NPC` increments when dialogue starts with a configured NPC.

Every objective accepts an optional numeric `stage`. Steps in the same stage are active in parallel. A later stage cannot collect kill or talk progress until every objective in the current stage is complete. Definitions without `stage` remain compatible and use stage `0`.

Example progressive chain:

```ts
steps: [
  { id: 'visit-hunter', type: 'TALK_TO_NPC', npcKey: 'village-hunter', quantity: 1, stage: 0 },
  { id: 'kill-rabbits', type: 'KILL_MOB', mobKey: 'spawn-rabbit', quantity: 5, stage: 1 },
  { id: 'return-mira', type: 'TALK_TO_NPC', npcKey: 'mira-tanner', quantity: 1, stage: 2 },
]
```

In this example, rabbits killed before the hunter conversation do not count. Talking to the hunter completes stage `0`, unlocks the rabbit objective, and the final conversation with Mira completes stage `2`.

Quest NPC dialogues define roots for `notStarted`, `active`, `ready`, and `rewarded`, plus `ACCEPT` and `TURN_IN` actions. They may also define `activeStageNodes`, allowing different dialogue roots for the current stage:

```ts
quest: {
  questKey: 'progressive-rabbit-hunt',
  rootNodes: { notStarted: 'offer', active: 'waiting', ready: 'ready', rewarded: 'done' },
  activeStageNodes: { '0': 'visit-hunter', '1': 'hunt-rabbits', '2': 'return-to-mira' },
}
```

An intermediate NPC may use a normal `DIALOGUE` interaction type while still binding to the quest for stage-aware dialogue. Only NPCs whose dialogue type is `QUEST` are returned as quest-marker owners.

Quest-marker bindings are extracted from validated backend NPC dialogue definitions and returned by `quests:get`. The frontend no longer contains an `NPC key -> quest key` table. Adding another quest NPC through seeded or database content therefore does not require editing `NpcView`.

Quest rewards support experience and silver. Gold is premium currency and the quest schema explicitly rejects any reward with `gold` greater than zero. Item consumption, terminal `REWARDED` status, character progression, silver changes, and ledger entries are committed in one transaction. The unique character/quest relation and terminal status prevent duplicate rewards.

The first seeded quest, `rabbit-fur-for-mira`, asks for five `rabbit-fur`, consumes exactly five, and grants 180 experience and 300 silver. It has no explicit stage, so it remains a single-stage quest. Mira is placed on a validated free Greenfields tile. The quest journal reads live data through `quests:get`; the old hard-coded frontend list was removed.
