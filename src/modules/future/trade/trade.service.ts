import { Injectable } from '@nestjs/common';
import { GAME_ERROR_CODES, GameError } from '../../../common/errors/game.error.js';
import type { InventorySnapshot, ItemRarity, TradeSnapshot } from '../../../contracts/socket.events.js';
import { PrismaService } from '../../../database/prisma.service.js';
import type { Prisma } from '../../../generated/prisma/client.js';
import { INVENTORY_CAPACITY, ItemService } from '../../items/item.service.js';
import { WorldEventsPublisher } from '../../world/world-events.publisher.js';
import { WorldStateService } from '../../world/world-state.service.js';
import { buildTradeLockKeys, isTradeDistanceAllowed, MAX_TRADE_OFFER_ITEMS, MAX_TRADE_SILVER, TRADE_OPEN_TTL_MS, TRADE_REQUEST_TTL_MS } from './trade.rules.js';

const ACTIVE = ['REQUESTED', 'OPEN', 'LOCKED'] as const;
const includeTrade = {
  initiator: { select: { id: true, userId: true, name: true, silver: true } },
  recipient: { select: { id: true, userId: true, name: true, silver: true } },
  offers: { orderBy: { createdAt: 'asc' as const }, include: { inventoryItem: { include: { itemDefinition: true } } } },
};
type Trade = Prisma.TradeSessionGetPayload<{ include: typeof includeTrade }>;

@Injectable()
export class TradeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly items: ItemService,
    private readonly world: WorldStateService,
    private readonly publisher: WorldEventsPublisher,
  ) {}

  async getActive(userId: string, characterId: string): Promise<TradeSnapshot | null> {
    const trade = await this.prisma.tradeSession.findFirst({
      where: { OR: [{ initiatorCharacterId: characterId }, { recipientCharacterId: characterId }], status: { in: [...ACTIVE] } },
      include: includeTrade,
      orderBy: { createdAt: 'desc' },
    });
    if (!trade) return null;
    this.owner(trade, characterId, userId);
    if (trade.expiresAt.getTime() <= Date.now()) {
      await this.prisma.tradeSession.update({ where: { id: trade.id }, data: { status: 'EXPIRED', initiatorAccepted: false, recipientAccepted: false } });
      await this.broadcast(trade.id);
      return null;
    }
    return this.snapshot(trade.id, characterId);
  }

  async request(userId: string, characterId: string, targetCharacterId: string): Promise<TradeSnapshot> {
    if (characterId === targetCharacterId) this.fail('TRADE_SELF', 'errors.trade.self');
    const initiator = this.online(characterId, userId);
    const recipient = this.online(targetCharacterId);
    this.near(initiator, recipient);
    const trade = await this.prisma.$transaction(async (tx) => {
      await this.lockPlayers(tx, characterId, targetCharacterId);
      await tx.tradeSession.updateMany({ where: { status: { in: [...ACTIVE] }, expiresAt: { lte: new Date() } }, data: { status: 'EXPIRED', initiatorAccepted: false, recipientAccepted: false } });
      const active = await tx.tradeSession.findFirst({ where: { OR: [{ initiatorCharacterId: { in: [characterId, targetCharacterId] } }, { recipientCharacterId: { in: [characterId, targetCharacterId] } }], status: { in: [...ACTIVE] } }, include: includeTrade });
      if (active) {
        if ([active.initiatorCharacterId, active.recipientCharacterId].includes(characterId) && [active.initiatorCharacterId, active.recipientCharacterId].includes(targetCharacterId)) return active;
        this.fail('TRADE_BUSY', 'errors.trade.busy');
      }
      return tx.tradeSession.create({ data: { initiatorCharacterId: characterId, recipientCharacterId: targetCharacterId, expiresAt: new Date(Date.now() + TRADE_REQUEST_TTL_MS) }, include: includeTrade });
    });
    const recipientSnapshot = await this.snapshot(trade.id, targetCharacterId);
    this.publisher.emit(recipient.socketId, 'trade:requested', recipientSnapshot);
    return this.snapshot(trade.id, characterId);
  }

  async respond(userId: string, characterId: string, tradeId: string, accept: boolean): Promise<TradeSnapshot> {
    await this.change(tradeId, characterId, userId, async (tx, trade) => {
      if (trade.recipientCharacterId !== characterId) this.fail('TRADE_FORBIDDEN', 'errors.trade.forbidden');
      this.expires(trade);
      if (trade.status !== 'REQUESTED') this.fail('TRADE_NOT_OPEN', 'errors.trade.notOpen');
      if (accept) this.near(this.online(trade.initiatorCharacterId), this.online(trade.recipientCharacterId));
      await tx.tradeSession.update({ where: { id: tradeId }, data: accept ? { status: 'OPEN', expiresAt: new Date(Date.now() + TRADE_OPEN_TTL_MS) } : { status: 'CANCELLED' } });
    });
    await this.broadcast(tradeId);
    return this.snapshot(tradeId, characterId);
  }

  async setItem(userId: string, characterId: string, tradeId: string, itemId: string, quantity: number): Promise<TradeSnapshot> {
    await this.change(tradeId, characterId, userId, async (tx, trade) => {
      this.openNearby(trade);
      if (!Number.isInteger(quantity) || quantity < 0 || quantity > 9999) this.fail('INVALID_PAYLOAD', 'errors.payload.invalid');
      if (quantity === 0) await tx.tradeOfferItem.deleteMany({ where: { tradeSessionId: tradeId, inventoryItemId: itemId, offeredByCharacterId: characterId } });
      else {
        const item = await tx.inventoryItem.findFirst({ where: { id: itemId, characterId, character: { userId } }, select: { quantity: true, equippedSlot: true } });
        if (!item || item.equippedSlot || quantity > item.quantity) this.fail('TRADE_ITEM_INVALID', 'errors.trade.itemInvalid');
        const existing = trade.offers.find((offer) => offer.inventoryItemId === itemId);
        if (!existing && trade.offers.filter((offer) => offer.offeredByCharacterId === characterId).length >= MAX_TRADE_OFFER_ITEMS) this.fail('INVALID_PAYLOAD', 'errors.payload.invalid');
        await tx.tradeOfferItem.upsert({ where: { tradeSessionId_inventoryItemId: { tradeSessionId: tradeId, inventoryItemId: itemId } }, create: { tradeSessionId: tradeId, inventoryItemId: itemId, offeredByCharacterId: characterId, quantity }, update: { offeredByCharacterId: characterId, quantity } });
      }
      await this.reset(tx, tradeId);
    });
    await this.broadcast(tradeId);
    return this.snapshot(tradeId, characterId);
  }

  async setSilver(userId: string, characterId: string, tradeId: string, silver: number): Promise<TradeSnapshot> {
    await this.change(tradeId, characterId, userId, async (tx, trade) => {
      this.openNearby(trade);
      if (!Number.isInteger(silver) || silver < 0 || silver > MAX_TRADE_SILVER) this.fail('INVALID_PAYLOAD', 'errors.payload.invalid');
      const character = await tx.character.findUnique({ where: { id: characterId }, select: { silver: true } });
      if (!character || silver > character.silver) this.fail('INSUFFICIENT_SILVER', 'errors.items.insufficientSilver');
      await tx.tradeSession.update({ where: { id: tradeId }, data: characterId === trade.initiatorCharacterId ? { initiatorSilver: silver } : { recipientSilver: silver } });
      await this.reset(tx, tradeId);
    });
    await this.broadcast(tradeId);
    return this.snapshot(tradeId, characterId);
  }

  async accept(userId: string, characterId: string, tradeId: string): Promise<TradeSnapshot> {
    let completed = false;
    await this.change(tradeId, characterId, userId, async (tx, trade) => {
      this.openNearby(trade);
      const initiatorAccepted = trade.initiatorAccepted || characterId === trade.initiatorCharacterId;
      const recipientAccepted = trade.recipientAccepted || characterId === trade.recipientCharacterId;
      if (!initiatorAccepted || !recipientAccepted) {
        await tx.tradeSession.update({ where: { id: tradeId }, data: { initiatorAccepted, recipientAccepted } });
        return;
      }
      await this.lockPlayers(tx, trade.initiatorCharacterId, trade.recipientCharacterId);
      const fresh = await tx.tradeSession.findUniqueOrThrow({ where: { id: tradeId }, include: includeTrade });
      this.openNearby(fresh);
      await this.complete(tx, fresh);
      completed = true;
    });
    await this.broadcast(tradeId);
    if (completed) this.syncOnlineBalances(tradeId);
    return this.snapshot(tradeId, characterId);
  }

  async cancel(userId: string, characterId: string, tradeId: string): Promise<TradeSnapshot> {
    await this.change(tradeId, characterId, userId, async (tx, trade) => {
      if (!ACTIVE.includes(trade.status as (typeof ACTIVE)[number])) this.fail('TRADE_NOT_OPEN', 'errors.trade.notOpen');
      await tx.tradeSession.update({ where: { id: tradeId }, data: { status: 'CANCELLED', initiatorAccepted: false, recipientAccepted: false } });
    });
    await this.broadcast(tradeId);
    return this.snapshot(tradeId, characterId);
  }

  private async complete(tx: Prisma.TransactionClient, trade: Trade): Promise<void> {
    const characters = await tx.character.findMany({ where: { id: { in: [trade.initiatorCharacterId, trade.recipientCharacterId] } }, select: { id: true, silver: true } });
    const balances = new Map(characters.map((character) => [character.id, character.silver]));
    const a = balances.get(trade.initiatorCharacterId); const b = balances.get(trade.recipientCharacterId);
    if (a === undefined || b === undefined || a < trade.initiatorSilver || b < trade.recipientSilver) this.fail('INSUFFICIENT_SILVER', 'errors.items.insufficientSilver');
    const nextA = a - trade.initiatorSilver + trade.recipientSilver; const nextB = b - trade.recipientSilver + trade.initiatorSilver;
    if (nextA > MAX_TRADE_SILVER || nextB > MAX_TRADE_SILVER) this.fail('TRADE_CHANGED', 'errors.trade.changed');
    const transfers = [];
    for (const offer of trade.offers) {
      const item = await tx.inventoryItem.findUnique({ where: { id: offer.inventoryItemId }, include: { itemDefinition: true } });
      if (!item || item.characterId !== offer.offeredByCharacterId || item.equippedSlot || offer.quantity < 1 || offer.quantity > item.quantity) this.fail('TRADE_CHANGED', 'errors.trade.changed');
      transfers.push({ item, quantity: offer.quantity, targetCharacterId: offer.offeredByCharacterId === trade.initiatorCharacterId ? trade.recipientCharacterId : trade.initiatorCharacterId });
    }
    for (const transfer of transfers) {
      if (transfer.quantity === transfer.item.quantity) await tx.inventoryItem.delete({ where: { id: transfer.item.id } });
      else await tx.inventoryItem.update({ where: { id: transfer.item.id }, data: { quantity: { decrement: transfer.quantity } } });
    }
    for (const transfer of transfers) {
      await this.addItem(tx, transfer.targetCharacterId, transfer.item.itemDefinitionId, transfer.item.itemDefinition.stackLimit, transfer.quantity, transfer.item.instanceData);
    }
    await tx.tradeOfferItem.deleteMany({ where: { tradeSessionId: trade.id } });
    await tx.character.update({ where: { id: trade.initiatorCharacterId }, data: { silver: nextA } });
    await tx.character.update({ where: { id: trade.recipientCharacterId }, data: { silver: nextB } });
    for (const [characterId, sent, received, before, after, counterparty] of [[trade.initiatorCharacterId, trade.initiatorSilver, trade.recipientSilver, a, nextA, trade.recipientCharacterId], [trade.recipientCharacterId, trade.recipientSilver, trade.initiatorSilver, b, nextB, trade.initiatorCharacterId]] as const) {
      if (sent) await tx.characterCurrencyLedger.create({ data: { characterId, operationId: `trade:${trade.id}:debit:${characterId}`, currency: 'SILVER', direction: 'DEBIT', amount: sent, reason: 'PLAYER_TRADE_PAYMENT', balanceAfter: before - sent, metadata: { tradeId: trade.id, counterparty } } });
      if (received) await tx.characterCurrencyLedger.create({ data: { characterId, operationId: `trade:${trade.id}:credit:${characterId}`, currency: 'SILVER', direction: 'CREDIT', amount: received, reason: 'PLAYER_TRADE_RECEIPT', balanceAfter: after, metadata: { tradeId: trade.id, counterparty } } });
    }
    await tx.tradeSession.update({ where: { id: trade.id }, data: { status: 'COMPLETED', initiatorAccepted: true, recipientAccepted: true } });
  }

  private async addItem(tx: Prisma.TransactionClient, characterId: string, definitionId: string, stackLimit: number, quantity: number, instanceData: Prisma.JsonValue): Promise<void> {
    let remaining = quantity;
    const stacks = await tx.inventoryItem.findMany({ where: { characterId, itemDefinitionId: definitionId, equippedSlot: null, quantity: { lt: stackLimit } }, orderBy: { slotIndex: 'asc' } });
    for (const stack of stacks) { if (JSON.stringify(stack.instanceData) !== JSON.stringify(instanceData)) continue; const moved = Math.min(remaining, stackLimit - stack.quantity); await tx.inventoryItem.update({ where: { id: stack.id }, data: { quantity: { increment: moved } } }); remaining -= moved; if (!remaining) return; }
    const occupied = new Set((await tx.inventoryItem.findMany({ where: { characterId }, select: { slotIndex: true } })).map((item) => item.slotIndex));
    for (let slotIndex = 0; slotIndex < INVENTORY_CAPACITY && remaining; slotIndex += 1) { if (occupied.has(slotIndex)) continue; const amount = Math.min(remaining, stackLimit); await tx.inventoryItem.create({ data: { characterId, itemDefinitionId: definitionId, quantity: amount, slotIndex, instanceData: instanceData as Prisma.InputJsonValue } }); remaining -= amount; }
    if (remaining) throw new GameError(GAME_ERROR_CODES.INVENTORY_FULL, 'errors.items.inventoryFull');
  }

  private async snapshot(tradeId: string, characterId: string): Promise<TradeSnapshot> {
    const trade = await this.prisma.tradeSession.findUnique({ where: { id: tradeId }, include: includeTrade });
    if (!trade) this.fail('TRADE_NOT_FOUND', 'errors.trade.notFound');
    const inventory = await this.items.getInventory(characterId === trade.initiatorCharacterId ? trade.initiator.userId : trade.recipient.userId, characterId);
    const participant = (id: string) => ({ characterId: id, name: id === trade.initiatorCharacterId ? trade.initiator.name : trade.recipient.name, accepted: id === trade.initiatorCharacterId ? trade.initiatorAccepted : trade.recipientAccepted, silver: id === trade.initiatorCharacterId ? trade.initiatorSilver : trade.recipientSilver, items: trade.offers.filter((offer) => offer.offeredByCharacterId === id).map((offer) => { const metadata = offer.inventoryItem.itemDefinition.metadata as { icon?: unknown; rarity?: unknown }; return { inventoryItemId: offer.inventoryItemId, definitionKey: offer.inventoryItem.itemDefinition.key, name: offer.inventoryItem.itemDefinition.name, description: offer.inventoryItem.itemDefinition.description, icon: typeof metadata.icon === 'string' ? metadata.icon : '◇', rarity: (['COMMON', 'ARTIFACT', 'MYTHIC'].includes(String(metadata.rarity)) ? metadata.rarity : 'COMMON') as ItemRarity, quantity: offer.quantity, stackLimit: offer.inventoryItem.itemDefinition.stackLimit }; }) });
    return { tradeId, status: trade.status, expiresAt: trade.expiresAt.getTime(), initiator: participant(trade.initiatorCharacterId), recipient: participant(trade.recipientCharacterId), inventory };
  }

  private async broadcast(tradeId: string): Promise<void> { const trade = await this.prisma.tradeSession.findUnique({ where: { id: tradeId }, select: { initiatorCharacterId: true, recipientCharacterId: true } }); if (!trade) return; for (const id of [trade.initiatorCharacterId, trade.recipientCharacterId]) { const session = this.world.getByCharacterId(id); if (session?.activeInWorld) this.publisher.emit(session.socketId, 'trade:updated', await this.snapshot(tradeId, id)); } }
  private async change(tradeId: string, characterId: string, userId: string, operation: (tx: Prisma.TransactionClient, trade: Trade) => Promise<void>): Promise<void> { await this.prisma.$transaction(async (tx) => { await tx.$queryRaw`SELECT "id" FROM "TradeSession" WHERE "id" = CAST(${tradeId} AS uuid) FOR UPDATE`; const trade = await tx.tradeSession.findUnique({ where: { id: tradeId }, include: includeTrade }); if (!trade) this.fail('TRADE_NOT_FOUND', 'errors.trade.notFound'); this.owner(trade, characterId, userId); await operation(tx, trade); }); }
  private owner(trade: Trade, characterId: string, userId: string): void { const character = characterId === trade.initiatorCharacterId ? trade.initiator : characterId === trade.recipientCharacterId ? trade.recipient : undefined; if (!character || character.userId !== userId) this.fail('TRADE_FORBIDDEN', 'errors.trade.forbidden'); }
  private openNearby(trade: Trade): void { this.expires(trade); if (trade.status !== 'OPEN') this.fail('TRADE_NOT_OPEN', 'errors.trade.notOpen'); this.near(this.online(trade.initiatorCharacterId), this.online(trade.recipientCharacterId)); }
  private expires(trade: Trade): void { if (trade.expiresAt.getTime() <= Date.now()) this.fail('TRADE_EXPIRED', 'errors.trade.expired'); }
  private online(characterId: string, userId?: string) { const session = this.world.getByCharacterId(characterId); if (!session?.activeInWorld || (userId && session.userId !== userId)) this.fail('TRADE_PARTICIPANT_UNAVAILABLE', 'errors.trade.participantUnavailable'); return session; }
  private near(a: { realmId: string; mapId: string; x: number; y: number }, b: { realmId: string; mapId: string; x: number; y: number }): void { if (a.realmId !== b.realmId || !isTradeDistanceAllowed(a, b)) this.fail('TRADE_TOO_FAR', 'errors.trade.tooFar'); }
  private async reset(tx: Prisma.TransactionClient, tradeId: string): Promise<void> { await tx.tradeSession.update({ where: { id: tradeId }, data: { status: 'OPEN', initiatorAccepted: false, recipientAccepted: false, expiresAt: new Date(Date.now() + TRADE_OPEN_TTL_MS) } }); }
  private async lockPlayers(tx: Prisma.TransactionClient, a: string, b: string): Promise<void> { for (const key of buildTradeLockKeys(a, b)) await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`; }
  private syncOnlineBalances(tradeId: string): void { void this.prisma.tradeSession.findUnique({ where: { id: tradeId }, include: { initiator: { select: { id: true, silver: true } }, recipient: { select: { id: true, silver: true } } } }).then((trade) => { if (!trade) return; for (const character of [trade.initiator, trade.recipient]) { const session = this.world.getByCharacterId(character.id); if (session) { session.silver = character.silver; session.stateRevision += 1; session.dirty = true; } } }); }
  private fail(code: keyof typeof GAME_ERROR_CODES, key: string): never { throw new GameError(GAME_ERROR_CODES[code], key); }
}
