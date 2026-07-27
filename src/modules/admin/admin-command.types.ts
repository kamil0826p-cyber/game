import type { Prisma } from '../../generated/prisma/client.js';
import type { SupportedLocale } from '../../i18n/localization.service.js';

export type AdminCurrency = 'SILVER' | 'GOLD';

export class AdminCommandError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AdminCommandError';
  }
}

export interface AdminCommandContext {
  actorUserId: string;
  actorCharacterId: string;
  realmId: string;
  requestId: string;
  locale: SupportedLocale;
}

export interface AdminCommandMutationResult {
  message: string;
  targetCharacterId?: string;
  currencyUpdate?: { currency: AdminCurrency; amount: number; balance: number };
}

export interface AdminCommandHandler {
  readonly name: string;
  execute(
    transaction: Prisma.TransactionClient,
    context: AdminCommandContext,
    rawArguments: string,
  ): Promise<AdminCommandMutationResult>;
}
