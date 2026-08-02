import type { Socket } from 'socket.io-client';
import type {
  BuildFunction,
  FinderCreateInput,
  SocialDashboard,
} from '../../contracts/social';
import type { ClientToServerEvents, ServerToClientEvents, SocketAck } from '../../contracts/socket';
import { createRequestId } from '../../utils/requestId';
import { gameStore } from '../state/gameStore';
import { socialStore } from '../state/socialStore';
import type { GameSocketClient } from './GameSocketClient';

type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
type SocialListener = (snapshot: SocialDashboard) => void;
interface BridgeClient { socket?: GameSocket; connect(): void; disconnect(): void; }

declare module './GameSocketClient' {
  interface GameSocketClient {
    subscribeSocial(listener: SocialListener): () => void;
    getSocial(): Promise<SocialDashboard>;
    createFinderListing(input: FinderCreateInput): Promise<SocialDashboard>;
    applyToFinder(listingId: string, functions: BuildFunction[]): Promise<SocialDashboard>;
    respondFinderApplication(listingId: string, targetCharacterId: string, accept: boolean): Promise<SocialDashboard>;
    setFinderReady(listingId: string, input: { functions: BuildFunction[]; formation: 'FRONT' | 'BACK'; loadoutReady: boolean; riskAccepted: boolean; consumableSummary: string[] }): Promise<SocialDashboard>;
    startFinderListing(listingId: string): Promise<SocialDashboard>;
    cancelFinderListing(listingId: string): Promise<SocialDashboard>;
    addSocialContact(targetCharacterId: string): Promise<SocialDashboard>;
    setSocialBlock(targetCharacterId: string, blocked: boolean): Promise<SocialDashboard>;
    setMentorProfile(input: { active: boolean; language: string; activityKeys: string[] }): Promise<SocialDashboard>;
    createGuildContract(definitionKey: string): Promise<SocialDashboard>;
    settleGuildContract(instanceId: string): Promise<SocialDashboard>;
    createGuildProject(definitionKey: string): Promise<SocialDashboard>;
    settleGuildProject(instanceId: string): Promise<SocialDashboard>;
    withdrawGuildBank(bankItemId: string, quantity: number): Promise<SocialDashboard>;
    rsvpGuildEvent(eventId: string, response: 'YES' | 'MAYBE' | 'NO'): Promise<SocialDashboard>;
  }
}

const ACK_TIMEOUT_MS = 10_000;

export function installSocialSocketBridge(client: GameSocketClient): void {
  const bridge = client as unknown as BridgeClient;
  const originalConnect = client.connect.bind(client);
  const originalDisconnect = client.disconnect.bind(client);
  const listeners = new Set<SocialListener>();
  let boundSocket: GameSocket | undefined;

  const publish = (snapshot: SocialDashboard): SocialDashboard => {
    socialStore.setSnapshot(snapshot);
    listeners.forEach((listener) => listener(snapshot));
    return snapshot;
  };
  const requireSocket = (): GameSocket => {
    const socket = bridge.socket;
    if (!socket?.connected) throw new Error('The game socket is not connected.');
    return socket;
  };
  const withAck = (emit: (socket: GameSocket, ack: (response: SocketAck<SocialDashboard>) => void) => void): Promise<SocialDashboard> =>
    new Promise<SocketAck<SocialDashboard>>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error('The game server did not acknowledge the social request.')), ACK_TIMEOUT_MS);
      emit(requireSocket(), (response) => { window.clearTimeout(timeout); resolve(response); });
    }).then((response) => {
      if (!response.ok) {
        gameStore.addNotification(response.error);
        throw new Error(response.error.message);
      }
      return publish(response.data);
    });
  const command = (emit: (socket: GameSocket, ack: (response: SocketAck<SocialDashboard>) => void) => void) => withAck(emit);
  const bind = (): void => {
    const socket = bridge.socket;
    if (!socket || socket === boundSocket) return;
    boundSocket = socket;
    socket.on('social:updated', publish);
  };

  bridge.connect = () => { originalConnect(); bind(); };
  bridge.disconnect = () => {
    boundSocket = undefined;
    listeners.clear();
    socialStore.reset();
    originalDisconnect();
  };

  client.subscribeSocial = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };
  client.getSocial = () => command((socket, ack) => socket.emit('social:get', { requestId: createRequestId('social') }, ack));
  client.createFinderListing = (input) => command((socket, ack) => socket.emit('social:finderCreate', { ...input, operationId: createRequestId('finder-create') }, ack));
  client.applyToFinder = (listingId, functions) => command((socket, ack) => socket.emit('social:finderApply', { operationId: createRequestId('finder-apply'), listingId, functions }, ack));
  client.respondFinderApplication = (listingId, targetCharacterId, accept) => command((socket, ack) => socket.emit('social:finderRespond', { operationId: createRequestId('finder-respond'), listingId, targetCharacterId, accept }, ack));
  client.setFinderReady = (listingId, input) => command((socket, ack) => socket.emit('social:finderReady', { operationId: createRequestId('finder-ready'), listingId, ...input }, ack));
  client.startFinderListing = (listingId) => command((socket, ack) => socket.emit('social:finderStart', { operationId: createRequestId('finder-start'), listingId }, ack));
  client.cancelFinderListing = (listingId) => command((socket, ack) => socket.emit('social:finderCancel', { operationId: createRequestId('finder-cancel'), listingId }, ack));
  client.addSocialContact = (targetCharacterId) => command((socket, ack) => socket.emit('social:contactAdd', { operationId: createRequestId('contact-add'), targetCharacterId }, ack));
  client.setSocialBlock = (targetCharacterId, blocked) => command((socket, ack) => socket.emit('social:blockSet', { operationId: createRequestId('block-set'), targetCharacterId, blocked }, ack));
  client.setMentorProfile = (input) => command((socket, ack) => socket.emit('social:mentorProfile', { operationId: createRequestId('mentor-profile'), ...input }, ack));
  client.createGuildContract = (definitionKey) => command((socket, ack) => socket.emit('social:contractCreate', { operationId: createRequestId('contract-create'), definitionKey, definitionVersion: 1 }, ack));
  client.settleGuildContract = (instanceId) => command((socket, ack) => socket.emit('social:contractSettle', { operationId: createRequestId('contract-settle'), instanceId }, ack));
  client.createGuildProject = (definitionKey) => command((socket, ack) => socket.emit('social:projectCreate', { operationId: createRequestId('project-create'), definitionKey, definitionVersion: 1 }, ack));
  client.settleGuildProject = (instanceId) => command((socket, ack) => socket.emit('social:projectSettle', { operationId: createRequestId('project-settle'), instanceId }, ack));
  client.withdrawGuildBank = (bankItemId, quantity) => command((socket, ack) => socket.emit('social:bankWithdraw', { operationId: createRequestId('bank-withdraw'), bankItemId, quantity }, ack));
  client.rsvpGuildEvent = (eventId, response) => command((socket, ack) => socket.emit('social:eventRsvp', { operationId: createRequestId('event-rsvp'), eventId, response }, ack));
}
