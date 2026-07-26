import type {
  MovementCommittedPayload,
  MovementRejectedPayload,
} from '../../contracts/socket.events.js';

export type MovementSource = 'DIRECT' | 'PATH';

export type MovementAttemptResult =
  | { accepted: true; payload: MovementCommittedPayload }
  | { accepted: false; error: MovementRejectedPayload };
