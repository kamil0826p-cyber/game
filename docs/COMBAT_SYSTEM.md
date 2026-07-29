# Turn-based combat

## PVP entry rules

The server resolves combat eligibility from the authoritative runtime map and the shared adjacent-actor range:

| Zone     | Result                                                          |
| -------- | --------------------------------------------------------------- |
| `SAFE`   | Combat is rejected.                                             |
| `OUTLAW` | A 30-second duel request is sent and both players must consent. |
| `PVP`    | Combat starts immediately.                                      |

Trade and active combat are mutually exclusive. Starting combat cancels path movement for both participants, revalidates their map and distance after serialization, then transitions both runtime sessions to `IN_BATTLE`. Direct and path movement are rejected until combat returns to `IDLE`.

## Server authority

The client sends only one of:

- a basic-attack intent;
- a learned skill key;
- a request response;
- a forfeit.

`CombatEngine` owns initiative, turn order, damage, armor mitigation, energy, cooldowns, shields, status duration, damage over time, dodge, stun skips, victory, and the 30-second turn timeout. A timed-out turn resolves as a basic attack.

Every resolved action receives a monotonic sequence and is returned in `recentActions`. The client plays VFX only after receiving this resolved event, using the skill catalog's stable animation and visual metadata.

## Skill integration

Only learned skills from `SkillService` enter a combat actor's runtime skill map. The engine applies the catalog's typed operations:

- `DAMAGE`;
- `HEAL`;
- `SHIELD`;
- `APPLY_STATUS`.

Cooldowns remain measured in the actor's turns and are persisted back to `CharacterSkill`. Character HP, energy, and combat state are synchronized to the live world session after every action and checkpointed at combat completion.

## Failure recovery

- Disconnecting during active combat forfeits the fight.
- Pending requests expire automatically.
- Shutdown resolves active combat and checkpoints participants.
- A persisted `IN_BATTLE` value is repaired to `IDLE` when a character session is reconstructed, preventing a restart from permanently trapping a character.

## PVE extension seam

The engine accepts generic actors with `kind: PLAYER | MOB`. PVP-specific concerns—map policy, consent, online sessions, trade exclusion, and socket ownership—live in `CombatService`, outside damage resolution. A future mob coordinator can build a `MOB` actor and reuse the same engine, action events, skill operations, arena payload, and VFX pipeline.
