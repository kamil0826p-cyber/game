import { ConnectedSocket, MessageBody, SubscribeMessage, WebSocketGateway } from '@nestjs/websockets';
import type { GameSocket, SocketAck } from '../../contracts/socket.events.js';
import { WorldStateService } from '../world/world-state.service.js';
import { AdminCommandService } from './admin-command.service.js';
import { AdminCommandError } from './admin-command.types.js';

interface AdminCommandPayload { requestId: string; text: string; }

@WebSocketGateway({ namespace: '/game', transports: ['websocket'] })
export class AdminGateway {
  constructor(
    private readonly commands: AdminCommandService,
    private readonly worldState: WorldStateService,
  ) {}

  @SubscribeMessage('admin:command')
  async execute(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() payload: AdminCommandPayload,
  ): Promise<SocketAck<{ message: string }>> {
    try {
      const session = this.worldState.getBySocketId(client.id);
      if (!client.data.userId || !session || !session.activeInWorld || client.data.sessionState !== 'IN_WORLD') {
        return { ok: false, error: { code: 'SESSION_NOT_READY', message: 'Sesja gry nie jest gotowa.' } };
      }
      if (!payload || typeof payload.requestId !== 'string' || !/^[A-Za-z0-9:_-]{1,64}$/.test(payload.requestId) || typeof payload.text !== 'string' || payload.text.length > 160) {
        return { ok: false, error: { code: 'INVALID_PAYLOAD', message: 'Wysłane dane są nieprawidłowe.' } };
      }
      const result = await this.commands.execute({
        actorUserId: client.data.userId,
        actorCharacterId: session.characterId,
        realmId: session.realmId,
        requestId: payload.requestId,
        locale: session.locale,
      }, payload.text);
      return { ok: true, data: { message: result.message } };
    } catch (error) {
      if (error instanceof AdminCommandError) return { ok: false, error: { code: error.code, message: error.message, details: error.details } };
      return { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Wystąpił wewnętrzny błąd serwera.' } };
    }
  }
}
