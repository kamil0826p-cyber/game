import { Injectable, type OnModuleInit } from '@nestjs/common';
import { GAME_ERROR_CODES, GameError } from '../../common/errors/game.error.js';
import { PrismaService } from '../../database/prisma.service.js';
import { ENCOUNTER_CATALOG } from '../mobs/encounters/encounter.catalog.js';
import type { EncounterDefinition } from '../mobs/encounters/encounter.types.js';
import { EXPEDITION_CATALOG } from './expedition.catalog.js';
import type {
  ExpeditionDefinition,
  ExpeditionEncounterReference,
} from './expedition.types.js';
import { assertExpeditionCatalog } from './expedition.validator.js';
import { compileExpeditionCatalogView } from './expedition.view.js';

function maximumEncounterActors(definition: EncounterDefinition): number {
  const summons = new Set(
    definition.phases.flatMap((phase) => phase.summonActorKeys ?? []),
  );
  return Math.max(
    ...definition.scaling.map(
      (tier) => new Set([...tier.actorKeys, ...summons]).size,
    ),
  );
}

@Injectable()
export class ExpeditionCatalogService implements OnModuleInit {
  private readonly definitions = new Map(
    EXPEDITION_CATALOG.map((definition) => [
      `${definition.key}@${definition.version}`,
      definition,
    ]),
  );

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    const itemRecords = await this.prisma.itemDefinition.findMany({ select: { key: true } }) as Array<{ key: string }>;
    const itemKeys = new Set<string>(itemRecords.map((item) => item.key));
    const encounters = new Map<string, ExpeditionEncounterReference>(
      ENCOUNTER_CATALOG.map((definition) => [
        definition.key,
        {
          key: definition.key,
          version: definition.version,
          maximumActors: maximumEncounterActors(definition),
        },
      ]),
    );
    assertExpeditionCatalog(EXPEDITION_CATALOG, { encounters, itemKeys });
  }

  list() {
    return EXPEDITION_CATALOG.map((definition) =>
      compileExpeditionCatalogView(definition),
    );
  }

  require(key: string, version?: number): ExpeditionDefinition {
    const definition = version
      ? this.definitions.get(`${key}@${version}`)
      : [...this.definitions.values()]
          .filter((candidate) => candidate.key === key)
          .sort((left, right) => right.version - left.version)[0];
    if (!definition) {
      throw new GameError(GAME_ERROR_CODES.INVALID_PAYLOAD, 'errors.payload.invalid', {
        reason: 'EXPEDITION_DEFINITION_NOT_FOUND',
        key,
        version,
      });
    }
    return definition;
  }
}
