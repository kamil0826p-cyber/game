import type { CombatSnapshot, SocketAck } from './socket.events.js';
import type {
  PvpBountyActionPayload,
  PvpBountyCreatePayload,
  PvpEngagePayload,
  PvpGetPayload,
  PvpNormalizationPreviewPayload,
  PvpRedeemPayload,
  PvpReplayGetPayload,
  PvpReportPayload,
  PvpSetOptInPayload,
} from './pvp.schemas.js';
import type { PvpBountyView, PvpOverview } from '../modules/pvp/pvp.service.js';
import type { PvpModeDefinition, PvpNormalizationPreview } from '../modules/pvp/pvp.types.js';

export interface PvpNormalizationPreviewResult {
  mode: PvpModeDefinition;
  preview: PvpNormalizationPreview;
}

export interface PvpReplayResult {
  checksum: string;
  replay: unknown;
}

export interface PvpReportResult {
  reportId: string;
}

declare module './socket.events.js' {
  interface ClientToServerEvents {
    'pvp:get': (
      payload: PvpGetPayload,
      acknowledgement?: (response: SocketAck<PvpOverview>) => void,
    ) => void;
    'pvp:setOptIn': (
      payload: PvpSetOptInPayload,
      acknowledgement?: (response: SocketAck<PvpOverview>) => void,
    ) => void;
    'pvp:redeem': (
      payload: PvpRedeemPayload,
      acknowledgement?: (response: SocketAck<PvpOverview>) => void,
    ) => void;
    'pvp:engage': (
      payload: PvpEngagePayload,
      acknowledgement?: (response: SocketAck<CombatSnapshot>) => void,
    ) => void;
    'pvp:normalizationPreview': (
      payload: PvpNormalizationPreviewPayload,
      acknowledgement?: (response: SocketAck<PvpNormalizationPreviewResult>) => void,
    ) => void;
    'pvp:bountyCreate': (
      payload: PvpBountyCreatePayload,
      acknowledgement?: (response: SocketAck<PvpBountyView>) => void,
    ) => void;
    'pvp:bountyAccept': (
      payload: PvpBountyActionPayload,
      acknowledgement?: (response: SocketAck<PvpBountyView>) => void,
    ) => void;
    'pvp:bountyCancel': (
      payload: PvpBountyActionPayload,
      acknowledgement?: (response: SocketAck<PvpBountyView>) => void,
    ) => void;
    'pvp:replayGet': (
      payload: PvpReplayGetPayload,
      acknowledgement?: (response: SocketAck<PvpReplayResult>) => void,
    ) => void;
    'pvp:report': (
      payload: PvpReportPayload,
      acknowledgement?: (response: SocketAck<PvpReportResult>) => void,
    ) => void;
  }

  interface ServerToClientEvents {
    'pvp:updated': (payload: PvpOverview) => void;
  }
}
