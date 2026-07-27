import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { WorldEventsPublisher } from '../world/world-events.publisher.js';
import { WorldStateService } from '../world/world-state.service.js';
import { AddCurrencyAdminCommand } from './add-currency.admin-command.js';
import { parseAdminCommand } from './admin-command.parser.js';
import { AdminCommandError, type AdminCommandContext, type AdminCommandHandler, type AdminCommandMutationResult } from './admin-command.types.js';

@Injectable()
export class AdminCommandService {
  private readonly logger = new Logger(AdminCommandService.name);
  private readonly handlers: ReadonlyMap<string, AdminCommandHandler>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly worldState: WorldStateService,
    private readonly publisher: WorldEventsPublisher,
    addCurrency: AddCurrencyAdminCommand,
  ) {
    this.handlers = new Map([[addCurrency.name, addCurrency]]);
  }

  async execute(context: AdminCommandContext, text: string): Promise<AdminCommandMutationResult> {
    const parsed = parseAdminCommand(text);
    const result = await this.prisma.$transaction(async (transaction) => {
      const actor = await transaction.user.findUnique({ where: { id: context.actorUserId }, select: { role: true } });
      if (actor?.role !== 'ADMIN') {
        this.logger.warn(`Rejected admin command from user ${context.actorUserId}.`);
        throw new AdminCommandError('ADMIN_COMMAND_FORBIDDEN', 'Nie masz uprawnień administratora.');
      }
      const handler = this.handlers.get(parsed.name);
      if (!handler) throw new AdminCommandError('ADMIN_COMMAND_UNKNOWN', `Nieznana komenda: /${parsed.name}.`);
      return handler.execute(transaction, context, parsed.rawArguments);
    }, { isolationLevel: 'Serializable' });

    this.synchronizeOnlineTarget(result);
    return result;
  }

  private synchronizeOnlineTarget(result: AdminCommandMutationResult): void {
    if (!result.targetCharacterId || !result.currencyUpdate) return;
    const session = this.worldState.getByCharacterId(result.targetCharacterId);
    if (!session) return;
    if (result.currencyUpdate.currency === 'SILVER') session.silver = result.currencyUpdate.balance;
    else session.gold = result.currencyUpdate.balance;
    this.publisher.emit(session.socketId, 'character:currencyUpdated', {
      characterId: session.characterId,
      ...result.currencyUpdate,
    });
    this.publisher.emit(session.socketId, 'notification', {
      code: 'ADMIN_CURRENCY_RECEIVED',
      message: `Otrzymano ${result.currencyUpdate.amount} ${result.currencyUpdate.currency === 'SILVER' ? 'srebra' : 'złota'}. Nowe saldo: ${result.currencyUpdate.balance}.`,
      details: result.currencyUpdate,
    });
  }
}
