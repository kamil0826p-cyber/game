import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { NpcService } from '../npcs/npc.service.js';

const BORIN_KEY = 'quartermaster';
const BORIN_MARKET_KEY = 'greenfields-market';

@Injectable()
export class MarketNpcBootstrapService implements OnApplicationBootstrap {
  constructor(
    private readonly prisma: PrismaService,
    private readonly npcs: NpcService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const quartermasters = await this.prisma.npcDefinition.findMany({
      where: { key: BORIN_KEY },
      select: { id: true, dialogue: true },
    });
    let changed = false;
    for (const quartermaster of quartermasters) {
      const patched = this.withMarketChoice(quartermaster.dialogue);
      if (!patched) continue;
      await this.prisma.npcDefinition.update({
        where: { id: quartermaster.id },
        data: { dialogue: patched },
      });
      changed = true;
    }
    if (changed) this.npcs.clearMapCache();
  }

  private withMarketChoice(value: Prisma.JsonValue): Prisma.InputJsonValue | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const dialogue = JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
    const nodes = dialogue.nodes;
    if (!nodes || typeof nodes !== 'object' || Array.isArray(nodes)) return undefined;
    const welcome = (nodes as Record<string, unknown>).welcome;
    if (!welcome || typeof welcome !== 'object' || Array.isArray(welcome)) return undefined;
    const choices = (welcome as Record<string, unknown>).choices;
    if (!Array.isArray(choices)) return undefined;

    const withoutMarket = choices.filter(
      (choice) =>
        !choice ||
        typeof choice !== 'object' ||
        Array.isArray(choice) ||
        (choice as Record<string, unknown>).id !== 'open-market',
    );
    const marketChoice = {
      id: 'open-market',
      label: {
        pl: 'Chcę skorzystać z rynku przedmiotów.',
        en: 'I want to use the item market.',
      },
      action: 'OPEN_MARKET',
    };
    const declineIndex = withoutMarket.findIndex(
      (choice) =>
        choice &&
        typeof choice === 'object' &&
        !Array.isArray(choice) &&
        (choice as Record<string, unknown>).action === 'CLOSE',
    );
    if (declineIndex >= 0) withoutMarket.splice(declineIndex, 0, marketChoice);
    else withoutMarket.push(marketChoice);
    (welcome as Record<string, unknown>).choices = withoutMarket;
    dialogue.market = { marketKey: BORIN_MARKET_KEY };
    return dialogue as Prisma.InputJsonValue;
  }
}
