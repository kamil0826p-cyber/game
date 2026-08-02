import type { SocketAck } from './socket.events.js';
import type {
  SocialAnnouncementCreatePayload,
  SocialBankDepositPayload,
  SocialBankWithdrawPayload,
  SocialBlockPayload,
  SocialContactPayload,
  SocialEventCreatePayload,
  SocialEventRsvpPayload,
  SocialFinderApplyPayload,
  SocialFinderCreatePayload,
  SocialFinderMutationPayload,
  SocialFinderReadyPayload,
  SocialFinderRespondPayload,
  SocialGuildCreateObjectivePayload,
  SocialGuildPermissionPayload,
  SocialGuildSettlePayload,
  SocialMentorProfilePayload,
  SocialMentorshipCompletePayload,
  SocialMentorshipStartPayload,
} from './social.schemas.js';
import type { SocialDashboardView } from '../modules/social/social.types.js';

declare module './socket.events.js' {
  interface ClientToServerEvents {
    'social:get': (payload: { requestId: string }, acknowledgement?: (response: SocketAck<SocialDashboardView>) => void) => void;
    'social:finderCreate': (payload: SocialFinderCreatePayload, acknowledgement?: (response: SocketAck<SocialDashboardView>) => void) => void;
    'social:finderApply': (payload: SocialFinderApplyPayload, acknowledgement?: (response: SocketAck<SocialDashboardView>) => void) => void;
    'social:finderRespond': (payload: SocialFinderRespondPayload, acknowledgement?: (response: SocketAck<SocialDashboardView>) => void) => void;
    'social:finderReady': (payload: SocialFinderReadyPayload, acknowledgement?: (response: SocketAck<SocialDashboardView>) => void) => void;
    'social:finderStart': (payload: SocialFinderMutationPayload, acknowledgement?: (response: SocketAck<SocialDashboardView>) => void) => void;
    'social:finderCancel': (payload: SocialFinderMutationPayload, acknowledgement?: (response: SocketAck<SocialDashboardView>) => void) => void;
    'social:contactAdd': (payload: SocialContactPayload, acknowledgement?: (response: SocketAck<SocialDashboardView>) => void) => void;
    'social:blockSet': (payload: SocialBlockPayload, acknowledgement?: (response: SocketAck<SocialDashboardView>) => void) => void;
    'social:mentorProfile': (payload: SocialMentorProfilePayload, acknowledgement?: (response: SocketAck<SocialDashboardView>) => void) => void;
    'social:mentorshipStart': (payload: SocialMentorshipStartPayload, acknowledgement?: (response: SocketAck<SocialDashboardView>) => void) => void;
    'social:mentorshipComplete': (payload: SocialMentorshipCompletePayload, acknowledgement?: (response: SocketAck<SocialDashboardView>) => void) => void;
    'social:contractCreate': (payload: SocialGuildCreateObjectivePayload, acknowledgement?: (response: SocketAck<SocialDashboardView>) => void) => void;
    'social:contractSettle': (payload: SocialGuildSettlePayload, acknowledgement?: (response: SocketAck<SocialDashboardView>) => void) => void;
    'social:projectCreate': (payload: SocialGuildCreateObjectivePayload, acknowledgement?: (response: SocketAck<SocialDashboardView>) => void) => void;
    'social:projectSettle': (payload: SocialGuildSettlePayload, acknowledgement?: (response: SocketAck<SocialDashboardView>) => void) => void;
    'social:guildPermission': (payload: SocialGuildPermissionPayload, acknowledgement?: (response: SocketAck<SocialDashboardView>) => void) => void;
    'social:bankDeposit': (payload: SocialBankDepositPayload, acknowledgement?: (response: SocketAck<SocialDashboardView>) => void) => void;
    'social:bankWithdraw': (payload: SocialBankWithdrawPayload, acknowledgement?: (response: SocketAck<SocialDashboardView>) => void) => void;
    'social:announcementCreate': (payload: SocialAnnouncementCreatePayload, acknowledgement?: (response: SocketAck<SocialDashboardView>) => void) => void;
    'social:eventCreate': (payload: SocialEventCreatePayload, acknowledgement?: (response: SocketAck<SocialDashboardView>) => void) => void;
    'social:eventRsvp': (payload: SocialEventRsvpPayload, acknowledgement?: (response: SocketAck<SocialDashboardView>) => void) => void;
  }

  interface ServerToClientEvents {
    'social:updated': (payload: SocialDashboardView) => void;
  }
}
