import type { SocketAck } from './socket.events.js';
import type {
  ExpeditionPrepareInput,
  ExpeditionMutationInput,
} from '../modules/expeditions/expedition.service.js';
import type {
  ExpeditionCatalogView,
  ExpeditionPublicView,
} from '../modules/expeditions/expedition.view.js';

export type ExpeditionCatalogRequestPayload = Record<string, never>;
export type ExpeditionGetPayload = Record<string, never>;
export type ExpeditionPreparePayload = ExpeditionPrepareInput;
export type ExpeditionStartPayload = ExpeditionMutationInput;
export type ExpeditionAdvancePayload = ExpeditionMutationInput & { edgeKey: string };
export type ExpeditionRitualPayload = ExpeditionMutationInput & { choiceKey: string };
export type ExpeditionExtractPayload = ExpeditionMutationInput;
export type ExpeditionAbandonPayload = ExpeditionMutationInput;

declare module './socket.events.js' {
  interface ClientToServerEvents {
    'expedition:catalog': (
      payload: ExpeditionCatalogRequestPayload,
      acknowledgement?: (response: SocketAck<ExpeditionCatalogView[]>) => void,
    ) => void;
    'expedition:get': (
      payload: ExpeditionGetPayload,
      acknowledgement?: (response: SocketAck<ExpeditionPublicView | null>) => void,
    ) => void;
    'expedition:prepare': (
      payload: ExpeditionPreparePayload,
      acknowledgement?: (response: SocketAck<ExpeditionPublicView>) => void,
    ) => void;
    'expedition:start': (
      payload: ExpeditionStartPayload,
      acknowledgement?: (response: SocketAck<ExpeditionPublicView>) => void,
    ) => void;
    'expedition:advance': (
      payload: ExpeditionAdvancePayload,
      acknowledgement?: (response: SocketAck<ExpeditionPublicView>) => void,
    ) => void;
    'expedition:ritual': (
      payload: ExpeditionRitualPayload,
      acknowledgement?: (response: SocketAck<ExpeditionPublicView>) => void,
    ) => void;
    'expedition:extract': (
      payload: ExpeditionExtractPayload,
      acknowledgement?: (response: SocketAck<ExpeditionPublicView>) => void,
    ) => void;
    'expedition:abandon': (
      payload: ExpeditionAbandonPayload,
      acknowledgement?: (response: SocketAck<ExpeditionPublicView>) => void,
    ) => void;
  }

  interface ServerToClientEvents {
    'expedition:updated': (payload: ExpeditionPublicView) => void;
  }
}
