# Combat skill system

## Progression

- A new character starts with no learned skills.
- The server derives earned points from `floor(characterLevel / 10)`.
- Each unlock costs one point and each skill currently has one rank.
- A skill can be unlocked only when its class, minimum level, prerequisite skills, and available-point requirements all match.
- The character row is locked during an unlock transaction, preventing two concurrent requests from spending the same point.

The server owns the complete eligibility decision. Client-side `unlockState` values only explain that decision in the UI.

## Trees

Every class has eight combat-only skills: one root, two three-skill branches, and one capstone that requires both branches.

### Mage

| Order | Skill | Role | Prerequisite |
| --- | --- | --- | --- |
| 1 | Arcane Spark | Arcane single-target attack | — |
| 2 | Flame Orb | Fire attack and burn | Arcane Spark |
| 3 | Frost Nova | Area damage and slow | Arcane Spark |
| 4 | Ember Lance | Heavy fire attack with armor penetration | Flame Orb |
| 5 | Ice Barrier | Self shield | Frost Nova |
| 6 | Meteor | Area fire attack and burn | Ember Lance |
| 7 | Time Lock | One-turn control | Ice Barrier |
| 8 | Elemental Cataclysm | Area capstone | Meteor + Time Lock |

### Warrior

| Order | Skill | Role | Prerequisite |
| --- | --- | --- | --- |
| 1 | Shield Bash | Attack with a stun chance | — |
| 2 | Cleave | Area attack | Shield Bash |
| 3 | Iron Guard | Defensive stance | Shield Bash |
| 4 | Whirlwind | Heavy area attack | Cleave |
| 5 | Battle Cry | Damage and initiative buff | Iron Guard |
| 6 | Execution | Finisher against wounded enemies | Whirlwind |
| 7 | Last Stand | Heal and damage reduction | Battle Cry |
| 8 | Unbreakable Assault | Area capstone | Execution + Last Stand |

### Archer

| Order | Skill | Role | Prerequisite |
| --- | --- | --- | --- |
| 1 | Quick Shot | Fast single-target attack | — |
| 2 | Piercing Arrow | Armor-piercing attack | Quick Shot |
| 3 | Snare Trap | Damage and control | Quick Shot |
| 4 | Volley | Area attack | Piercing Arrow |
| 5 | Evasive Roll | Dodge and initiative buff | Snare Trap |
| 6 | Rain of Arrows | Area attack and bleed | Volley |
| 7 | Predator's Mark | Increased damage-taken debuff | Evasive Roll |
| 8 | Perfect Hunt | Single-target capstone | Rain of Arrows + Predator's Mark |

## Combat integration contract

Each definition contains:

- targeting (`SELF`, `ENEMY`, or `AREA`);
- energy cost and cooldown measured in turns;
- typed effect operations for damage, healing, shields, and statuses;
- a stable `animationKey`;
- cast, projectile, and impact VFX keys with color and travel-time metadata.

The action bar never applies an effect locally. Outside combat it is disabled. During combat it emits a `game:combat-skill-intent` event containing only the stable skill key. The future combat coordinator should send that intent to the server, wait for an authoritative resolved combat event, and only then play the animation described by the resolved skill's visual metadata.
