# Quest system

The quest system uses the existing `QuestDefinition` and `CharacterQuest` Prisma models. Definitions are data-driven: the server validates `steps` and `rewards`, stores event counters in `CharacterQuest.progress`, and derives collection progress from the authoritative inventory.

Supported objectives:

- `COLLECT_ITEM` checks inventory quantity and can consume the required amount during turn-in.
- `KILL_MOB` increments after an authoritative PVE victory and supports exact or prefix matching.
- `TALK_TO_NPC` increments when dialogue starts with a configured NPC.

Quest rewards support experience and silver. Gold is premium currency and the quest schema explicitly rejects any reward with `gold` greater than zero. Item consumption, terminal `REWARDED` status, character progression, silver changes, and ledger entries are committed in one transaction. The unique character/quest relation and terminal status prevent duplicate rewards.

Quest NPC dialogues define roots for `notStarted`, `active`, `ready`, and `rewarded`, plus `ACCEPT` and `TURN_IN` actions. The first seeded quest, `rabbit-fur-for-mira`, asks for five `rabbit-fur`, consumes exactly five, and grants 180 experience and 300 silver. Mira is placed on a validated free Greenfields tile. The quest journal reads live data through `quests:get`; the old hard-coded frontend list was removed.