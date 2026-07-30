import { useEffect, useMemo, useState } from 'react';
import { OutfitPreview } from '../../components/common/OutfitPreview';
import type { GroupInvitePayload, GroupMemberPayload } from '../../contracts/group';
import { canKickGroupMember } from '../../game/groups/groupPermissions';
import { useGameConnection } from '../../game/realtime/GameConnectionProvider';
import { useGameState } from '../../game/state/gameStore';
import { useGroupState } from '../../game/state/groupStore';
import { useI18n } from '../../i18n/I18nProvider';

function formatSeconds(milliseconds: number): string {
  return `${Math.max(0, Math.ceil(milliseconds / 1_000))}s`;
}

export function GroupPanel(): React.JSX.Element | null {
  const connection = useGameConnection();
  const game = useGameState();
  const snapshot = useGroupState();
  const { locale } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [busyInviteId, setBusyInviteId] = useState<string>();
  const [busyMemberId, setBusyMemberId] = useState<string>();
  const [leaving, setLeaving] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (game.phase !== 'in-world' || !game.socketConnected) return;
    const refresh = () => void connection.getGroup().catch(() => undefined);
    refresh();
    if (!snapshot.group && snapshot.invites.length === 0) return;
    const interval = window.setInterval(refresh, 5_000);
    return () => window.clearInterval(interval);
  }, [
    connection,
    game.phase,
    game.socketConnected,
    snapshot.group?.id,
    snapshot.invites.length,
  ]);

  useEffect(() => {
    if (snapshot.invites.length === 0) return;
    setExpanded(true);
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [snapshot.invites.length]);

  const invites = useMemo(
    () => snapshot.invites.filter((invite) => invite.expiresAt > now),
    [now, snapshot.invites],
  );
  const group = snapshot.group;
  const pl = locale === 'pl';

  const respond = async (invite: GroupInvitePayload, accept: boolean): Promise<void> => {
    if (busyInviteId) return;
    setBusyInviteId(invite.inviteId);
    try {
      await connection.respondGroupInvite(invite.inviteId, accept);
    } catch {
      // The bridge publishes localized server errors through the global notification stack.
    } finally {
      setBusyInviteId(undefined);
    }
  };

  const kick = async (member: GroupMemberPayload): Promise<void> => {
    if (busyMemberId || leaving) return;
    setBusyMemberId(member.characterId);
    try {
      await connection.kickGroupMember(member.characterId);
    } catch {
      // The bridge publishes localized server errors through the global notification stack.
    } finally {
      setBusyMemberId(undefined);
    }
  };

  const leave = async (): Promise<void> => {
    if (leaving || busyMemberId || !group) return;
    setLeaving(true);
    try {
      await connection.leaveGroup();
      setExpanded(false);
    } catch {
      // The bridge publishes localized server errors through the global notification stack.
    } finally {
      setLeaving(false);
    }
  };

  if (!group && invites.length === 0) return null;

  return (
    <section
      className="hud-panel pointer-events-auto relative z-40 w-[min(390px,calc(100vw-24px))] overflow-hidden shadow-2xl shadow-black/35"
      aria-label={pl ? 'Grupa' : 'Group'}
    >
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition hover:bg-white/5"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <span
            className="grid size-8 shrink-0 place-items-center rounded-lg border border-amber-300/25 bg-amber-300/10 text-amber-200"
            aria-hidden="true"
          >
            <GroupIcon />
          </span>
          <span className="min-w-0">
            <span className="block font-display text-sm text-amber-100">{pl ? 'Grupa' : 'Group'}</span>
            <span className="block truncate text-[9px] uppercase tracking-[0.15em] text-slate-500">
              {group
                ? `${group.members.length} / ${group.maxMembers}`
                : pl
                  ? `${invites.length} ${invites.length === 1 ? 'zaproszenie' : 'zaproszenia'}`
                  : `${invites.length} ${invites.length === 1 ? 'invitation' : 'invitations'}`}
            </span>
          </span>
        </span>
        <ChevronIcon expanded={expanded} />
      </button>

      {expanded ? (
        <div className="scrollbar-thin max-h-[min(58vh,520px)] overflow-y-auto border-t border-white/5 px-3 pb-3 pt-2 md:max-h-[calc(100vh-470px)]">
          {invites.map((invite) => (
            <InviteCard
              key={invite.inviteId}
              invite={invite}
              pl={pl}
              remaining={invite.expiresAt - now}
              busy={busyInviteId === invite.inviteId}
              onRespond={respond}
            />
          ))}

          {group ? (
            <>
              <div className="space-y-1.5">
                {group.members.map((member) => (
                  <MemberRow
                    key={member.characterId}
                    member={member}
                    pl={pl}
                    canKick={canKickGroupMember(
                      group,
                      game.self?.characterId,
                      member.characterId,
                    )}
                    busy={busyMemberId === member.characterId}
                    onKick={kick}
                  />
                ))}
              </div>
              <div className="mt-2 flex justify-end border-t border-white/5 pt-2">
                <button
                  type="button"
                  onClick={() => void leave()}
                  disabled={leaving || Boolean(busyMemberId)}
                  className="rounded-md px-2.5 py-1.5 text-[9px] font-semibold uppercase tracking-[0.13em] text-rose-200/75 transition hover:bg-rose-400/10 hover:text-rose-100 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {leaving ? (pl ? 'Opuszczanie…' : 'Leaving…') : (pl ? 'Opuść grupę' : 'Leave group')}
                </button>
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function InviteCard({
  invite,
  pl,
  remaining,
  busy,
  onRespond,
}: {
  invite: GroupInvitePayload;
  pl: boolean;
  remaining: number;
  busy: boolean;
  onRespond: (invite: GroupInvitePayload, accept: boolean) => Promise<void>;
}): React.JSX.Element {
  return (
    <div className="mb-2 rounded-lg border border-emerald-300/25 bg-emerald-400/10 p-2.5">
      <div className="flex items-center gap-2.5">
        <div className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-md border border-emerald-300/20 bg-slate-950/70">
          <OutfitPreview
            outfitKey={invite.inviterOutfitKey}
            characterClass={invite.inviterClass}
            size="small"
            animated
            className="!h-14 !w-10"
          />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-emerald-100">{invite.inviterName}</p>
          <p className="text-[9px] uppercase tracking-[0.13em] text-emerald-200/70">
            Lv. {invite.inviterLevel} · {pl ? 'zaprasza do grupy' : 'group invitation'}
          </p>
          <p className="mt-0.5 text-[9px] text-slate-500">
            {pl ? 'Wygasa za' : 'Expires in'} {formatSeconds(remaining)}
          </p>
        </div>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void onRespond(invite, true)}
          className="rounded-md border border-emerald-300/25 bg-emerald-400/15 px-2 py-1.5 text-[10px] font-semibold text-emerald-100 transition hover:bg-emerald-400/25 disabled:opacity-50"
        >
          {pl ? 'Akceptuj' : 'Accept'}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void onRespond(invite, false)}
          className="rounded-md border border-slate-300/15 bg-slate-400/10 px-2 py-1.5 text-[10px] font-semibold text-slate-300 transition hover:bg-slate-400/20 disabled:opacity-50"
        >
          {pl ? 'Odrzuć' : 'Decline'}
        </button>
      </div>
    </div>
  );
}

function MemberRow({
  member,
  pl,
  canKick,
  busy,
  onKick,
}: {
  member: GroupMemberPayload;
  pl: boolean;
  canKick: boolean;
  busy: boolean;
  onKick: (member: GroupMemberPayload) => Promise<void>;
}): React.JSX.Element {
  const healthPercent = member.maxHp > 0
    ? Math.max(0, Math.min(100, (member.hp / member.maxHp) * 100))
    : 0;
  const kickLabel = pl ? `Wyrzuć ${member.name} z grupy` : `Remove ${member.name} from group`;

  return (
    <div
      className={`grid grid-cols-[40px_minmax(0,1fr)_28px] items-center gap-2 rounded-lg border px-2 py-1.5 ${member.online ? 'border-white/10 bg-white/[0.035]' : 'border-white/5 bg-black/10 opacity-60'}`}
    >
      <div className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-md border border-amber-300/15 bg-slate-950/65">
        <OutfitPreview
          outfitKey={member.outfitKey}
          characterClass={member.characterClass}
          size="small"
          animated={member.online}
          className="!h-14 !w-10"
        />
      </div>

      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-1.5">
          <p className="truncate text-xs font-semibold text-slate-100">{member.name}</p>
          {member.admin ? (
            <span
              className="shrink-0 rounded border border-amber-300/20 bg-amber-300/10 px-1 py-0.5 text-[7px] font-bold uppercase tracking-[0.12em] text-amber-300"
              title={pl ? 'Administrator grupy' : 'Group administrator'}
            >
              {pl ? 'Admin' : 'Admin'}
            </span>
          ) : null}
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-2 text-[8px] uppercase tracking-[0.11em] text-slate-500">
          <span>Lv. {member.level}</span>
          <span className="shrink-0">{member.hp} / {member.maxHp} HP</span>
        </div>
        <div className="mt-1 h-1 overflow-hidden rounded-full bg-black/50">
          <div className="h-full bg-rose-500" style={{ width: `${healthPercent}%` }} />
        </div>
      </div>

      <div className="flex h-full flex-col items-center justify-between py-0.5">
        <span
          className={`size-2 rounded-full ${member.online ? 'bg-emerald-400' : 'bg-slate-600'}`}
          title={member.online ? 'Online' : 'Offline'}
        />
        {canKick ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void onKick(member)}
            className="grid size-7 place-items-center rounded-md border border-white/5 text-slate-500 transition hover:border-rose-300/25 hover:bg-rose-400/10 hover:text-rose-200 disabled:cursor-not-allowed disabled:opacity-40"
            title={kickLabel}
            aria-label={kickLabel}
          >
            {busy ? <span className="text-xs">…</span> : <PersonRemoveIcon />}
          </button>
        ) : <span aria-hidden="true" />}
      </div>
    </div>
  );
}

function GroupIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="8" r="3" />
      <path d="M3.8 18.5c.5-3.2 2.2-5 5.2-5s4.7 1.8 5.2 5" />
      <circle cx="16.5" cy="9" r="2.2" />
      <path d="M15.2 13.6c2.8-.3 4.5 1.3 5 4.1" />
    </svg>
  );
}

function PersonRemoveIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="9" cy="8" r="3" />
      <path d="M3.8 18.5c.5-3.2 2.2-5 5.2-5 1.4 0 2.5.4 3.4 1.1" />
      <path d="M15.5 16.5h5" />
    </svg>
  );
}

function ChevronIcon({ expanded }: { expanded: boolean }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 20 20"
      className={`size-4 shrink-0 text-amber-200 transition-transform ${expanded ? 'rotate-180' : ''}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m5 7.5 5 5 5-5" />
    </svg>
  );
}
