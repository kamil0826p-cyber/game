import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { WorldStateService } from '../world/world-state.service.js';
import type { InventoryItemPayload, TradeSnapshot } from '../../contracts/socket.events.js';

const REQUEST_TTL_MS = 30_000;
const OPEN_TTL_MS = 5 * 60_000;
const INVENTORY_CAPACITY = 40;

export class TradeError extends Error {
  constructor(public readonly code: string, message: string, public readonly details?: Record<string, unknown>) {
    super(message);
    this.name = 'TradeError';
  }
}

type SilverRow = { initiatorSilver: number; recipientSilver: number };
type OfferInput = { itemId: string; quantity: number };

@Injectable()
export class TradeService {
  constructor(private readonly prisma: PrismaService, private readonly world: WorldStateService) {}

  async request(characterId: string, targetCharacterId: string): Promise<TradeSnapshot> {
    if (characterId === targetCharacterId) throw new TradeError('TRADE_INVALID_TARGET', 'Nie możesz handlować sam ze sobą.');
    const source = this.requireOnline(characterId);
    const target = this.requireOnline(targetCharacterId);
    if (source.mapId !== target.mapId || Math.max(Math.abs(source.x - target.x), Math.abs(source.y - target.y)) > 1) {
      throw new TradeError('TRADE_TOO_FAR', 'Podejdź bliżej do gracza, aby rozpocząć handel.');
    }
    await this.expireOldTrades();
    const active = await this.prisma.tradeSession.findFirst({
      where: {
        status: { in: ['REQUESTED', 'OPEN', 'LOCKED'] },
        OR: [
          { initiatorCharacterId: { in: [characterId, targetCharacterId] } },
          { recipientCharacterId: { in: [characterId, targetCharacterId] } },
        ],
      },
      select: { id: true },
    });
    if (active) throw new TradeError('TRADE_BUSY', 'Jeden z graczy prowadzi już handel.');
    const trade = await this.prisma.tradeSession.create({
      data: { initiatorCharacterId: characterId, recipientCharacterId: targetCharacterId, expiresAt: new Date(Date.now() + REQUEST_TTL_MS) },
      select: { id: true },
    });
    return this.snapshot(trade.id, characterId);
  }

  async respond(characterId: string, tradeId: string, accept: boolean): Promise<TradeSnapshot> {
    const trade = await this.requireParticipant(tradeId, characterId);
    if (trade.recipientCharacterId !== characterId || trade.status !== 'REQUESTED') throw new TradeError('TRADE_INVALID_STATE', 'Ta prośba o handel nie jest już aktywna.');
    if (trade.expiresAt.getTime() <= Date.now()) {
      await this.prisma.tradeSession.update({ where: { id: tradeId }, data: { status: 'EXPIRED' } });
      throw new TradeError('TRADE_EXPIRED', 'Prośba o handel wygasła.');
    }
    const next = await this.prisma.tradeSession.update({
      where: { id: tradeId },
      data: accept ? { status: 'OPEN', expiresAt: new Date(Date.now() + OPEN_TTL_MS) } : { status: 'CANCELLED' },
      select: { id: true },
    });
    return this.snapshot(next.id, characterId);
  }

  async setOffer(characterId: string, tradeId: string, items: OfferInput[], silver: number): Promise<TradeSnapshot> {
    this.assertSilver(silver);
    if (items.length > INVENTORY_CAPACITY) throw new TradeError('TRADE_INVALID_OFFER', 'Oferta zawiera zbyt wiele pozycji.');
    const ids = new Set<string>();
    for (const item of items) {
      if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 9999 || ids.has(item.itemId)) throw new TradeError('TRADE_INVALID_OFFER', 'Oferta jest nieprawidłowa.');
      ids.add(item.itemId);
    }
    await this.prisma.$transaction(async (tx) => {
      const trade = await this.requireParticipantTx(tx, tradeId, characterId);
      this.assertOpen(trade.status, trade.expiresAt);
      const character = await tx.character.findUnique({ where: { id: characterId }, select: { silver: true } });
      if (!character || character.silver < silver) throw new TradeError('INSUFFICIENT_SILVER', 'Nie masz wystarczającej ilości srebra.');
      const owned = await tx.inventoryItem.findMany({ where: { id: { in: [...ids] }, characterId }, select: { id: true, quantity: true, equippedSlot: true } });
      if (owned.length !== ids.size) throw new TradeError('TRADE_ITEM_NOT_OWNED', 'Nie posiadasz jednego z oferowanych przedmiotów.');
      for (const offered of items) {
        const item = owned.find((entry) => entry.id === offered.itemId);
        if (!item || item.equippedSlot || item.quantity < offered.quantity) throw new TradeError('TRADE_INVALID_OFFER', 'Nie można zaoferować tego przedmiotu lub ilości.');
      }
      await tx.tradeOfferItem.deleteMany({ where: { tradeSessionId: tradeId, offeredByCharacterId: characterId } });
      if (items.length > 0) await tx.tradeOfferItem.createMany({ data: items.map((item) => ({ tradeSessionId: tradeId, offeredByCharacterId: characterId, inventoryItemId: item.itemId, quantity: item.quantity })) });
      const column = trade.initiatorCharacterId === characterId ? 'initiatorSilver' : 'recipientSilver';
      await tx.$executeRawUnsafe(`UPDATE "TradeSession" SET "${column}" = $1, "initiatorAccepted" = false, "recipientAccepted" = false, "status" = 'OPEN', "updatedAt" = NOW() WHERE id = $2::uuid`, silver, tradeId);
    });
    return this.snapshot(tradeId, characterId);
  }

  async accept(characterId: string, tradeId: string): Promise<TradeSnapshot> {
    let completed = false;
    await this.prisma.$transaction(async (tx) => {
      const trade = await this.requireParticipantTx(tx, tradeId, characterId);
      this.assertOpen(trade.status, trade.expiresAt);
      const acceptedField = trade.initiatorCharacterId === characterId ? 'initiatorAccepted' : 'recipientAccepted';
      await tx.$executeRawUnsafe(`UPDATE "TradeSession" SET "${acceptedField}" = true, "updatedAt" = NOW() WHERE id = $1::uuid`, tradeId);
      const refreshed = await tx.tradeSession.findUnique({ where: { id: tradeId } });
      if (refreshed?.initiatorAccepted && refreshed.recipientAccepted) {
        await this.complete(tx, tradeId, refreshed.initiatorCharacterId, refreshed.recipientCharacterId);
        completed = true;
      }
    }, { isolationLevel: 'Serializable' });
    const snapshot = await this.snapshot(tradeId, characterId);
    if (completed) this.syncOnlineBalances(snapshot);
    return snapshot;
  }

  async cancel(characterId: string, tradeId: string): Promise<TradeSnapshot> {
    const trade = await this.requireParticipant(tradeId, characterId);
    if (!['REQUESTED', 'OPEN', 'LOCKED'].includes(trade.status)) return this.snapshot(tradeId, characterId);
    await this.prisma.tradeSession.update({ where: { id: tradeId }, data: { status: 'CANCELLED' } });
    return this.snapshot(tradeId, characterId);
  }

  async get(characterId: string, tradeId: string): Promise<TradeSnapshot> {
    await this.requireParticipant(tradeId, characterId);
    return this.snapshot(tradeId, characterId);
  }

  private async complete(tx: Prisma.TransactionClient, tradeId: string, initiatorId: string, recipientId: string): Promise<void> {
    await tx.$queryRawUnsafe(`SELECT id FROM "Character" WHERE id IN ($1::uuid, $2::uuid) ORDER BY id FOR UPDATE`, initiatorId, recipientId);
    const silver = await this.readSilver(tx, tradeId);
    const characters = await tx.character.findMany({ where: { id: { in: [initiatorId, recipientId] } }, select: { id: true, silver: true } });
    const initiator = characters.find((entry) => entry.id === initiatorId);
    const recipient = characters.find((entry) => entry.id === recipientId);
    if (!initiator || !recipient) throw new TradeError('TRADE_INVALID_STATE', 'Nie można zakończyć handlu.');
    if (initiator.silver < silver.initiatorSilver || recipient.silver < silver.recipientSilver) throw new TradeError('INSUFFICIENT_SILVER', 'Jeden z graczy nie ma już wystarczającej ilości srebra.');
    const offers = await tx.tradeOfferItem.findMany({ where: { tradeSessionId: tradeId }, include: { inventoryItem: { include: { itemDefinition: true } } } });
    for (const offer of offers) {
      const expectedOwner = offer.offeredByCharacterId;
      if (offer.inventoryItem.characterId !== expectedOwner || offer.inventoryItem.equippedSlot || offer.inventoryItem.quantity < offer.quantity) throw new TradeError('TRADE_OFFER_CHANGED', 'Oferta zmieniła się i handel został przerwany.');
    }
    await this.assertCapacity(tx, initiatorId, offers.filter((offer) => offer.offeredByCharacterId === recipientId).map((offer) => ({ definitionId: offer.inventoryItem.itemDefinitionId, quantity: offer.quantity, stackLimit: offer.inventoryItem.itemDefinition.stackLimit })));
    await this.assertCapacity(tx, recipientId, offers.filter((offer) => offer.offeredByCharacterId === initiatorId).map((offer) => ({ definitionId: offer.inventoryItem.itemDefinitionId, quantity: offer.quantity, stackLimit: offer.inventoryItem.itemDefinition.stackLimit })));
    await tx.tradeOfferItem.deleteMany({ where: { tradeSessionId: tradeId } });
    for (const offer of offers) {
      const targetId = offer.offeredByCharacterId === initiatorId ? recipientId : initiatorId;
      await this.transferItem(tx, offer.inventoryItem.id, offer.inventoryItem.itemDefinitionId, offer.quantity, offer.inventoryItem.quantity, targetId, offer.inventoryItem.itemDefinition.stackLimit, offer.inventoryItem.instanceData as Prisma.InputJsonValue);
    }
    const initiatorAfter = initiator.silver - silver.initiatorSilver + silver.recipientSilver;
    const recipientAfter = recipient.silver - silver.recipientSilver + silver.initiatorSilver;
    await tx.character.update({ where: { id: initiatorId }, data: { silver: initiatorAfter } });
    await tx.character.update({ where: { id: recipientId }, data: { silver: recipientAfter } });
    const ledgerRows = [
      ...(silver.initiatorSilver > 0 ? [{ characterId: initiatorId, operationId: `trade:${tradeId}:out`, currency: 'SILVER' as const, direction: 'DEBIT' as const, amount: silver.initiatorSilver, reason: 'PLAYER_TRADE', balanceAfter: initiator.silver - silver.initiatorSilver, metadata: { tradeId, counterpartyId: recipientId } }] : []),
      ...(silver.recipientSilver > 0 ? [{ characterId: initiatorId, operationId: `trade:${tradeId}:in`, currency: 'SILVER' as const, direction: 'CREDIT' as const, amount: silver.recipientSilver, reason: 'PLAYER_TRADE', balanceAfter: initiatorAfter, metadata: { tradeId, counterpartyId: recipientId } }] : []),
      ...(silver.recipientSilver > 0 ? [{ characterId: recipientId, operationId: `trade:${tradeId}:out`, currency: 'SILVER' as const, direction: 'DEBIT' as const, amount: silver.recipientSilver, reason: 'PLAYER_TRADE', balanceAfter: recipient.silver - silver.recipientSilver, metadata: { tradeId, counterpartyId: initiatorId } }] : []),
      ...(silver.initiatorSilver > 0 ? [{ characterId: recipientId, operationId: `trade:${tradeId}:in`, currency: 'SILVER' as const, direction: 'CREDIT' as const, amount: silver.initiatorSilver, reason: 'PLAYER_TRADE', balanceAfter: recipientAfter, metadata: { tradeId, counterpartyId: initiatorId } }] : []),
    ];
    if (ledgerRows.length > 0) await tx.characterCurrencyLedger.createMany({ data: ledgerRows });
    await tx.tradeSession.update({ where: { id: tradeId }, data: { status: 'COMPLETED' } });
  }

  private async assertCapacity(tx: Prisma.TransactionClient, characterId: string, incoming: Array<{ definitionId: string; quantity: number; stackLimit: number }>): Promise<void> {
    const inventory = await tx.inventoryItem.findMany({ where: { characterId }, select: { itemDefinitionId: true, quantity: true } });
    let free = INVENTORY_CAPACITY - inventory.length;
    for (const item of incoming) {
      const stackSpace = inventory.filter((entry) => entry.itemDefinitionId === item.definitionId).reduce((sum, entry) => sum + Math.max(0, item.stackLimit - entry.quantity), 0);
      const remaining = Math.max(0, item.quantity - stackSpace);
      free -= Math.ceil(remaining / item.stackLimit);
    }
    if (free < 0) throw new TradeError('INVENTORY_FULL', 'Jeden z graczy nie ma miejsca w plecaku.');
  }

  private async transferItem(tx: Prisma.TransactionClient, sourceId: string, definitionId: string, quantity: number, sourceQuantity: number, targetId: string, stackLimit: number, instanceData: Prisma.InputJsonValue): Promise<void> {
    if (quantity === sourceQuantity) await tx.inventoryItem.delete({ where: { id: sourceId } });
    else await tx.inventoryItem.update({ where: { id: sourceId }, data: { quantity: { decrement: quantity } } });
    let remaining = quantity;
    const stacks = await tx.inventoryItem.findMany({ where: { characterId: targetId, itemDefinitionId: definitionId, equippedSlot: null, quantity: { lt: stackLimit } }, orderBy: { slotIndex: 'asc' } });
    for (const stack of stacks) {
      const moved = Math.min(remaining, stackLimit - stack.quantity);
      if (moved > 0) await tx.inventoryItem.update({ where: { id: stack.id }, data: { quantity: { increment: moved } } });
      remaining -= moved;
      if (remaining === 0) return;
    }
    const used = new Set((await tx.inventoryItem.findMany({ where: { characterId: targetId }, select: { slotIndex: true } })).map((entry) => entry.slotIndex));
    for (let slot = 0; remaining > 0 && slot < INVENTORY_CAPACITY; slot += 1) {
      if (used.has(slot)) continue;
      const moved = Math.min(remaining, stackLimit);
      await tx.inventoryItem.create({ data: { characterId: targetId, itemDefinitionId: definitionId, quantity: moved, slotIndex: slot, instanceData } });
      remaining -= moved;
    }
    if (remaining > 0) throw new TradeError('INVENTORY_FULL', 'Brak miejsca w plecaku.');
  }

  private async snapshot(tradeId: string, viewerId: string): Promise<TradeSnapshot> {
    const trade = await this.prisma.tradeSession.findUnique({ where: { id: tradeId }, include: { initiator: { select: { id: true, name: true, silver: true } }, recipient: { select: { id: true, name: true, silver: true } }, offers: { include: { inventoryItem: { include: { itemDefinition: true } } }, orderBy: { createdAt: 'asc' } } } });
    if (!trade || (trade.initiatorCharacterId !== viewerId && trade.recipientCharacterId !== viewerId)) throw new TradeError('TRADE_NOT_FOUND', 'Nie znaleziono handlu.');
    const silver = await this.readSilver(this.prisma, tradeId);
    const toItem = (offer: typeof trade.offers[number]): InventoryItemPayload => {
      const metadata = offer.inventoryItem.itemDefinition.metadata as Record<string, unknown>;
      return { id: offer.inventoryItem.id, definitionKey: offer.inventoryItem.itemDefinition.key, name: offer.inventoryItem.itemDefinition.name, description: offer.inventoryItem.itemDefinition.description, category: (metadata.category as InventoryItemPayload['category']) ?? 'MATERIAL', rarity: (metadata.rarity as InventoryItemPayload['rarity']) ?? 'COMMON', icon: String(metadata.icon ?? '◆'), quantity: offer.quantity, stackLimit: offer.inventoryItem.itemDefinition.stackLimit, slotIndex: offer.inventoryItem.slotIndex, minimumLevel: Number(metadata.minimumLevel ?? 1), usable: false, statBonuses: {}, buyPriceSilver: Number(metadata.buyPriceSilver ?? 0), sellPriceSilver: Number(metadata.sellPriceSilver ?? 0), sellable: metadata.sellable !== false };
    };
    return { id: trade.id, status: trade.status, expiresAt: trade.expiresAt.getTime(), selfCharacterId: viewerId, initiator: { characterId: trade.initiator.id, name: trade.initiator.name, silver: trade.initiator.silver, offeredSilver: silver.initiatorSilver, accepted: trade.initiatorAccepted, items: trade.offers.filter((offer) => offer.offeredByCharacterId === trade.initiator.id).map(toItem) }, recipient: { characterId: trade.recipient.id, name: trade.recipient.name, silver: trade.recipient.silver, offeredSilver: silver.recipientSilver, accepted: trade.recipientAccepted, items: trade.offers.filter((offer) => offer.offeredByCharacterId === trade.recipient.id).map(toItem) } };
  }

  private async readSilver(client: Pick<PrismaService, '$queryRawUnsafe'> | Prisma.TransactionClient, tradeId: string): Promise<SilverRow> {
    const rows = await client.$queryRawUnsafe<SilverRow[]>('SELECT "initiatorSilver", "recipientSilver" FROM "TradeSession" WHERE id = $1::uuid', tradeId);
    return rows[0] ?? { initiatorSilver: 0, recipientSilver: 0 };
  }

  private async requireParticipant(tradeId: string, characterId: string) {
    const trade = await this.prisma.tradeSession.findUnique({ where: { id: tradeId } });
    if (!trade || (trade.initiatorCharacterId !== characterId && trade.recipientCharacterId !== characterId)) throw new TradeError('TRADE_NOT_FOUND', 'Nie znaleziono handlu.');
    return trade;
  }

  private async requireParticipantTx(tx: Prisma.TransactionClient, tradeId: string, characterId: string) {
    const trade = await tx.tradeSession.findUnique({ where: { id: tradeId } });
    if (!trade || (trade.initiatorCharacterId !== characterId && trade.recipientCharacterId !== characterId)) throw new TradeError('TRADE_NOT_FOUND', 'Nie znaleziono handlu.');
    return trade;
  }

  private requireOnline(characterId: string) {
    const session = this.world.getByCharacterId(characterId);
    if (!session?.activeInWorld) throw new TradeError('TRADE_TARGET_OFFLINE', 'Gracz nie jest dostępny.');
    return session;
  }

  private assertOpen(status: string, expiresAt: Date): void {
    if (!['OPEN', 'LOCKED'].includes(status)) throw new TradeError('TRADE_INVALID_STATE', 'Handel nie jest otwarty.');
    if (expiresAt.getTime() <= Date.now()) throw new TradeError('TRADE_EXPIRED', 'Handel wygasł.');
  }

  private assertSilver(silver: number): void {
    if (!Number.isSafeInteger(silver) || silver < 0 || silver > 2_000_000_000) throw new TradeError('TRADE_INVALID_OFFER', 'Nieprawidłowa kwota srebra.');
  }

  private async expireOldTrades(): Promise<void> {
    await this.prisma.tradeSession.updateMany({ where: { status: { in: ['REQUESTED', 'OPEN', 'LOCKED'] }, expiresAt: { lt: new Date() } }, data: { status: 'EXPIRED' } });
  }

  private syncOnlineBalances(snapshot: TradeSnapshot): void {
    for (const side of [snapshot.initiator, snapshot.recipient]) {
      const session = this.world.getByCharacterId(side.characterId);
      if (!session) continue;
      session.silver = side.silver;
      session.stateRevision += 1;
      session.dirty = true;
    }
  }
}
