import { Injectable } from '@nestjs/common';
import { GAME_ERROR_CODES, GameError } from '../../common/errors/game.error.js';
import type { TradeSnapshot } from '../../contracts/socket.events.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { WorldStateService } from '../world/world-state.service.js';

const TRADE_RADIUS = 2;
const REQUEST_TTL_MS = 30_000;
const OPEN_TTL_MS = 5 * 60_000;
const INVENTORY_CAPACITY = 40;
const ACTIVE_STATUSES = ['REQUESTED', 'OPEN', 'LOCKED'] as const;
type OfferInput = { itemId: string; quantity: number };

type TradeParticipantRow = {
  id: string;
  status: string;
  initiatorCharacterId: string;
  recipientCharacterId: string;
  initiatorAccepted: boolean;
  recipientAccepted: boolean;
  initiatorSilver: number;
  recipientSilver: number;
  expiresAt: Date;
};

@Injectable()
export class TradeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly world: WorldStateService,
  ) {}

  async request(initiatorId: string, recipientId: string): Promise<TradeSnapshot> {
    if (initiatorId === recipientId) this.invalid();
    this.requireNearbySessions(initiatorId, recipientId);
    return this.prisma.$transaction(async (tx) => {
      await this.lockParticipants(tx, initiatorId, recipientId);
      this.requireNearbySessions(initiatorId, recipientId);
      await tx.tradeSession.updateMany({ where: { status: { in: ['REQUESTED', 'OPEN'] }, expiresAt: { lte: new Date() } }, data: { status: 'EXPIRED' } });
      const active = await tx.tradeSession.findFirst({
        where: {
          status: { in: [...ACTIVE_STATUSES] },
          OR: [
            { initiatorCharacterId: { in: [initiatorId, recipientId] } },
            { recipientCharacterId: { in: [initiatorId, recipientId] } },
          ],
        },
        select: { id: true },
      });
      if (active) throw new GameError(GAME_ERROR_CODES.TRADE_BUSY, 'errors.trade.busy');
      const session = await tx.tradeSession.create({
        data: { initiatorCharacterId: initiatorId, recipientCharacterId: recipientId, expiresAt: new Date(Date.now() + REQUEST_TTL_MS) },
        select: { id: true },
      });
      return this.snapshotWith(tx, session.id, initiatorId);
    }, { isolationLevel: 'Serializable' });
  }

  async respond(tradeId: string, characterId: string, accept: boolean): Promise<TradeSnapshot> {
    return this.prisma.$transaction(async (tx) => {
      const session = await this.requireParticipant(tx, tradeId, characterId);
      await this.lockParticipants(tx, session.initiatorCharacterId, session.recipientCharacterId);
      const current = await this.requireParticipant(tx, tradeId, characterId);
      if (current.status !== 'REQUESTED' || current.recipientCharacterId !== characterId || current.expiresAt.getTime() <= Date.now()) {
        await tx.tradeSession.updateMany({ where: { id: tradeId, status: 'REQUESTED' }, data: { status: 'EXPIRED' } });
        throw new GameError(GAME_ERROR_CODES.TRADE_INVALID_STATE, 'errors.trade.invalidState');
      }
      this.requireNearbySessions(current.initiatorCharacterId, current.recipientCharacterId);
      await tx.tradeSession.update({
        where: { id: tradeId },
        data: accept
          ? { status: 'OPEN', expiresAt: new Date(Date.now() + OPEN_TTL_MS) }
          : { status: 'CANCELLED', initiatorAccepted: false, recipientAccepted: false },
      });
      return this.snapshotWith(tx, tradeId, characterId);
    }, { isolationLevel: 'Serializable' });
  }

  async setOffer(tradeId: string, characterId: string, items: OfferInput[], silver: number): Promise<TradeSnapshot> {
    this.assertSilver(silver);
    this.assertOffer(items);
    return this.prisma.$transaction(async (tx) => {
      const initial = await this.requireParticipant(tx, tradeId, characterId);
      await this.lockParticipants(tx, initial.initiatorCharacterId, initial.recipientCharacterId);
      const session = await this.requireParticipant(tx, tradeId, characterId);
      this.requireOpen(session);
      this.requireNearbySessions(session.initiatorCharacterId, session.recipientCharacterId);

      const character = await tx.character.findUnique({ where: { id: characterId }, select: { silver: true } });
      if (!character || character.silver < silver) throw new GameError(GAME_ERROR_CODES.INSUFFICIENT_SILVER, 'errors.items.insufficientSilver');
      const ids = items.map((item) => item.itemId);
      const owned = ids.length === 0 ? [] : await tx.inventoryItem.findMany({ where: { id: { in: ids }, characterId }, select: { id: true, quantity: true, equippedSlot: true } });
      if (owned.length !== ids.length) this.invalid();
      const byId = new Map(owned.map((item) => [item.id, item]));
      for (const offer of items) {
        const item = byId.get(offer.itemId);
        if (!item || item.equippedSlot || offer.quantity > item.quantity) this.invalid();
      }

      await tx.tradeOfferItem.deleteMany({ where: { tradeSessionId: tradeId, offeredByCharacterId: characterId } });
      if (items.length > 0) await tx.tradeOfferItem.createMany({ data: items.map((item) => ({ tradeSessionId: tradeId, offeredByCharacterId: characterId, inventoryItemId: item.itemId, quantity: item.quantity })) });
      await tx.tradeSession.update({
        where: { id: tradeId },
        data: {
          initiatorAccepted: false,
          recipientAccepted: false,
          expiresAt: new Date(Date.now() + OPEN_TTL_MS),
          ...(session.initiatorCharacterId === characterId ? { initiatorSilver: silver } : { recipientSilver: silver }),
        },
      });
      return this.snapshotWith(tx, tradeId, characterId);
    }, { isolationLevel: 'Serializable' });
  }

  async confirm(tradeId: string, characterId: string): Promise<TradeSnapshot> {
    return this.prisma.$transaction(async (tx) => {
      const initial = await this.requireParticipant(tx, tradeId, characterId);
      await this.lockParticipants(tx, initial.initiatorCharacterId, initial.recipientCharacterId);
      const session = await this.requireParticipant(tx, tradeId, characterId);
      this.requireOpen(session);
      this.requireNearbySessions(session.initiatorCharacterId, session.recipientCharacterId);
      await tx.tradeSession.update({
        where: { id: tradeId },
        data: session.initiatorCharacterId === characterId ? { initiatorAccepted: true } : { recipientAccepted: true },
      });
      const accepted = await tx.tradeSession.findUniqueOrThrow({ where: { id: tradeId }, select: { initiatorAccepted: true, recipientAccepted: true } });
      if (accepted.initiatorAccepted && accepted.recipientAccepted) {
        const claimed = await tx.tradeSession.updateMany({
          where: { id: tradeId, status: 'OPEN', initiatorAccepted: true, recipientAccepted: true, expiresAt: { gt: new Date() } },
          data: { status: 'LOCKED' },
        });
        if (claimed.count !== 1) throw new GameError(GAME_ERROR_CODES.TRADE_INVALID_STATE, 'errors.trade.invalidState');
        await this.complete(tx, tradeId);
      }
      return this.snapshotWith(tx, tradeId, characterId);
    }, { isolationLevel: 'Serializable' });
  }

  async cancel(tradeId: string, characterId: string): Promise<TradeSnapshot> {
    return this.prisma.$transaction(async (tx) => {
      const initial = await this.requireParticipant(tx, tradeId, characterId);
      await this.lockParticipants(tx, initial.initiatorCharacterId, initial.recipientCharacterId);
      const session = await this.requireParticipant(tx, tradeId, characterId);
      if (!['REQUESTED', 'OPEN'].includes(session.status)) throw new GameError(GAME_ERROR_CODES.TRADE_INVALID_STATE, 'errors.trade.invalidState');
      const updated = await tx.tradeSession.updateMany({ where: { id: tradeId, status: { in: ['REQUESTED', 'OPEN'] } }, data: { status: 'CANCELLED', initiatorAccepted: false, recipientAccepted: false } });
      if (updated.count !== 1) throw new GameError(GAME_ERROR_CODES.TRADE_INVALID_STATE, 'errors.trade.invalidState');
      return this.snapshotWith(tx, tradeId, characterId);
    }, { isolationLevel: 'Serializable' });
  }

  async snapshot(tradeId: string, viewerId: string): Promise<TradeSnapshot> {
    return this.snapshotWith(this.prisma, tradeId, viewerId);
  }

  private async complete(tx: Prisma.TransactionClient, tradeId: string): Promise<void> {
    const session = await tx.tradeSession.findUniqueOrThrow({
      where: { id: tradeId },
      include: { offers: { include: { inventoryItem: { include: { itemDefinition: true } } } }, initiator: { select: { silver: true } }, recipient: { select: { silver: true } } },
    });
    if (session.status !== 'LOCKED') throw new GameError(GAME_ERROR_CODES.TRADE_INVALID_STATE, 'errors.trade.invalidState');
    this.requireNearbySessions(session.initiatorCharacterId, session.recipientCharacterId);
    if (session.initiator.silver < session.initiatorSilver || session.recipient.silver < session.recipientSilver) throw new GameError(GAME_ERROR_CODES.INSUFFICIENT_SILVER, 'errors.items.insufficientSilver');
    for (const offer of session.offers) {
      if (offer.inventoryItem.characterId !== offer.offeredByCharacterId || offer.inventoryItem.equippedSlot || offer.quantity < 1 || offer.quantity > offer.inventoryItem.quantity) this.invalid();
    }

    for (const offer of session.offers) {
      const targetId = offer.offeredByCharacterId === session.initiatorCharacterId ? session.recipientCharacterId : session.initiatorCharacterId;
      await this.removeFromInventory(tx, offer.inventoryItemId, offer.quantity);
      await this.addToInventory(tx, targetId, offer.inventoryItem.itemDefinitionId, offer.inventoryItem.itemDefinition.stackLimit, offer.quantity, offer.inventoryItem.instanceData);
    }

    const initiatorDelta = session.recipientSilver - session.initiatorSilver;
    const recipientDelta = -initiatorDelta;
    const initiator = await tx.character.update({ where: { id: session.initiatorCharacterId }, data: { silver: { increment: initiatorDelta } }, select: { silver: true } });
    const recipient = await tx.character.update({ where: { id: session.recipientCharacterId }, data: { silver: { increment: recipientDelta } }, select: { silver: true } });
    if (session.initiatorSilver > 0) await this.ledger(tx, session.initiatorCharacterId, tradeId, 'DEBIT', session.initiatorSilver, initiator.silver);
    if (session.recipientSilver > 0) await this.ledger(tx, session.recipientCharacterId, tradeId, 'DEBIT', session.recipientSilver, recipient.silver);
    if (session.recipientSilver > 0) await this.ledger(tx, session.initiatorCharacterId, tradeId, 'CREDIT', session.recipientSilver, initiator.silver);
    if (session.initiatorSilver > 0) await this.ledger(tx, session.recipientCharacterId, tradeId, 'CREDIT', session.initiatorSilver, recipient.silver);
    await tx.tradeSession.update({ where: { id: tradeId }, data: { status: 'COMPLETED' } });
  }

  private async removeFromInventory(tx: Prisma.TransactionClient, itemId: string, quantity: number): Promise<void> {
    const item = await tx.inventoryItem.findUniqueOrThrow({ where: { id: itemId }, select: { quantity: true } });
    if (item.quantity === quantity) await tx.inventoryItem.delete({ where: { id: itemId } });
    else await tx.inventoryItem.update({ where: { id: itemId }, data: { quantity: { decrement: quantity } } });
  }

  private async addToInventory(tx: Prisma.TransactionClient, characterId: string, definitionId: string, stackLimit: number, quantity: number, instanceData: Prisma.JsonValue): Promise<void> {
    let remaining = quantity;
    const stackable = stackLimit > 1 && this.isEmptyObject(instanceData);
    if (stackable) {
      const stacks = await tx.inventoryItem.findMany({ where: { characterId, itemDefinitionId: definitionId, equippedSlot: null, quantity: { lt: stackLimit }, instanceData: { equals: {} } }, orderBy: { slotIndex: 'asc' } });
      for (const stack of stacks) {
        const moved = Math.min(remaining, stackLimit - stack.quantity);
        await tx.inventoryItem.update({ where: { id: stack.id }, data: { quantity: { increment: moved } } });
        remaining -= moved;
        if (remaining === 0) return;
      }
    }
    const occupied = new Set((await tx.inventoryItem.findMany({ where: { characterId }, select: { slotIndex: true } })).map((item) => item.slotIndex));
    for (let slot = 0; slot < INVENTORY_CAPACITY && remaining > 0; slot += 1) {
      if (occupied.has(slot)) continue;
      const amount = Math.min(remaining, stackLimit);
      await tx.inventoryItem.create({ data: { characterId, itemDefinitionId: definitionId, quantity: amount, slotIndex: slot, instanceData: instanceData as Prisma.InputJsonValue } });
      occupied.add(slot);
      remaining -= amount;
    }
    if (remaining > 0) throw new GameError(GAME_ERROR_CODES.INVENTORY_FULL, 'errors.items.inventoryFull');
  }

  private async ledger(tx: Prisma.TransactionClient, characterId: string, tradeId: string, direction: 'CREDIT' | 'DEBIT', amount: number, balanceAfter: number): Promise<void> {
    await tx.characterCurrencyLedger.create({ data: { characterId, operationId: `trade:${tradeId}:${characterId}:${direction}`, currency: 'SILVER', direction, amount, reason: 'PLAYER_TRADE', balanceAfter, metadata: { tradeId } } });
  }

  private async snapshotWith(tx: Prisma.TransactionClient | PrismaService, tradeId: string, viewerId: string): Promise<TradeSnapshot> {
    const session = await tx.tradeSession.findUnique({
      where: { id: tradeId },
      include: { initiator: { select: { id: true, name: true } }, recipient: { select: { id: true, name: true } }, offers: { include: { inventoryItem: { include: { itemDefinition: true } } }, orderBy: { createdAt: 'asc' } } },
    });
    if (!session || (session.initiatorCharacterId !== viewerId && session.recipientCharacterId !== viewerId)) throw new GameError(GAME_ERROR_CODES.TRADE_NOT_FOUND, 'errors.trade.notFound');
    return {
      id: session.id,
      status: session.status,
      expiresAt: session.expiresAt.getTime(),
      selfCharacterId: viewerId,
      initiator: { characterId: session.initiator.id, name: session.initiator.name, silver: session.initiatorSilver, accepted: session.initiatorAccepted },
      recipient: { characterId: session.recipient.id, name: session.recipient.name, silver: session.recipientSilver, accepted: session.recipientAccepted },
      items: session.offers.map((offer) => ({ itemId: offer.inventoryItemId, offeredByCharacterId: offer.offeredByCharacterId, definitionKey: offer.inventoryItem.itemDefinition.key, name: offer.inventoryItem.itemDefinition.name, quantity: offer.quantity })),
    };
  }

  private async requireParticipant(tx: Prisma.TransactionClient, tradeId: string, characterId: string): Promise<TradeParticipantRow> {
    const session = await tx.tradeSession.findFirst({ where: { id: tradeId, OR: [{ initiatorCharacterId: characterId }, { recipientCharacterId: characterId }] } });
    if (!session) throw new GameError(GAME_ERROR_CODES.TRADE_NOT_FOUND, 'errors.trade.notFound');
    return session;
  }

  private requireOpen(session: { status: string; expiresAt: Date }): void {
    if (session.status !== 'OPEN' || session.expiresAt.getTime() <= Date.now()) throw new GameError(GAME_ERROR_CODES.TRADE_INVALID_STATE, 'errors.trade.invalidState');
  }

  private requireNearbySessions(firstId: string, secondId: string): void {
    const first = this.world.getByCharacterId(firstId);
    const second = this.world.getByCharacterId(secondId);
    if (!first?.activeInWorld || !second?.activeInWorld || first.mapId !== second.mapId || Math.max(Math.abs(first.x - second.x), Math.abs(first.y - second.y)) > TRADE_RADIUS) throw new GameError(GAME_ERROR_CODES.TRADE_TOO_FAR, 'errors.trade.tooFar');
  }

  private async lockParticipants(tx: Prisma.TransactionClient, firstId: string, secondId: string): Promise<void> {
    const key = [firstId, secondId].sort().join(':');
    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', key);
  }

  private assertSilver(value: number): void { if (!Number.isSafeInteger(value) || value < 0 || value > 2_000_000_000) this.invalid(); }
  private assertOffer(items: OfferInput[]): void {
    if (!Array.isArray(items) || items.length > INVENTORY_CAPACITY || new Set(items.map((item) => item.itemId)).size !== items.length) this.invalid();
    for (const item of items) if (!item || typeof item.itemId !== 'string' || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 9999) this.invalid();
  }
  private isEmptyObject(value: Prisma.JsonValue): boolean { return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).length === 0; }
  private invalid(): never { throw new GameError(GAME_ERROR_CODES.INVALID_PAYLOAD, 'errors.payload.invalid'); }
}
