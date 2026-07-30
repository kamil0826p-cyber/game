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

export function GroupPanel(): React.JSX.Element {
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

  return (
    <section className="hud-panel pointer-events-auto w-[min(390px,calc(100vw-24px))] overflow-hidden" aria-label={pl ? 'Grupa' : 'Group'}>
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition hover:bg-white/5"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="grid size-7 shrink-0 place-items-center rounded-md border border-amber-300/20 bg-amber-300/10 text-sm text-amber-200" aria-hidden="true">♟</span>
          <span>
            <span className="block font-display text-sm text-amber-100">{pl ? 'Grupa' : 'Group'}</span>
            <span className="block text-[9px] uppercase tracking-[0.15em] text-slate-500">
              {group
                ? `${group.members.length} / ${group.maxMembers}`
                : invites.length > 0
                  ? pl ? `${invites.length} zaproszenie` : `${invites.length} invitation`
                  : pl ? 'Brak grupy' : 'No group'}
            </span>
          </span>
        </span>
        <span className={`text-sm text-amber-200 transition-transform ${expanded ? 'rotate-180' : ''}`} aria-hidden="true">⌄</span>
      </button>

      {expanded ? (
        <div className="border-t border-white/5 px-3 pb-3 pt-2">
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
              <div className="space-y-2">
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
              <button
                type="button"
                onClick={() => void leave()}
                disabled={leaving || Boolean(busyMemberId)}
                className="mt-3 w-full rounded-md border border-rose-300/20 bg-rose-400/10 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-rose-200 transition hover:bg-rose-400/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {leaving ? (pl ? 'Opuszczanie…' : 'Leaving…') : (pl ? 'Opuść grupę' : 'Leave group')}
              </button>
            </>
          ) : invites.length === 0 ? (
            <p className="py-2 text-center text-xs text-slate-400">
              {pl ? 'Podejdź do gracza i wybierz „Dodaj do grupy”.' : 'Approach a player and choose “Add to group”.'}
            </p>
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
        <div className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-md border border-emerald-300/20 bg-slate-950/70">
          <OutfitPreview
            outfitKey={invite.inviterOutfitKey}
            characterClass={invite.inviterClass}
            size="small"
            animated
            className="!h-16 !w-11"
          />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-emerald-100">{invite.inviterName}</p>
          <p className="text-[9px] uppercase tracking-[0.13em] text-emerald-200/70">
            Lv. {invite.inviterLevel} · {pl ? 'zaprasza do grupy' : 'group invitation'}
          </p>
          <p className="mt-0.5 text-[9px] text-slate-500">{pl ? 'Wygasa za' : 'Expires in'} {formatSeconds(remaining)}</p>
        </div>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void onRespond(invite, true)}
          className="rounded-md border border-emerald-300/25 bg-emerald-400/15 px-2 py-1.5 text-[10px] font-semibold text-emerald-100 hover:bg-emerald-400/25 disabled:opacity-50"
        >
          {pl ? 'Akceptuj' : 'Accept'}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void onRespond(invite, false)}
          className="rounded-md border border-slate-300/15 bg-slate-400/10 px-2 py-1.5 text-[10px] font-semibold text-slate-300 hover:bg-slate-400/20 disabled:opacity-50"
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
  return (
    <div className={`flex items-center gap-2.5 rounded-lg border px-2.5 py-2 ${member.online ? 'border-white/10 bg-white/[0.035]' : 'border-white/5 bg-black/10 opacity-60'}`}>
      <div className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-md border border-amber-300/15 bg-slate-950/65">
        <OutfitPreview
          outfitKey={member.outfitKey}
          characterClass={member.characterClass}
          size="small"
          animated={member.online}
          className="!h-16 !w-11"
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-xs font-semibold text-slate-100">
            {member.admin ? <span className="mr-1 text-amber-300" title={pl ? 'Administrator' : 'Administrator'}>♛</span> : null}
            {member.name}
          </p>
          <span className={`size-2 shrink-0 rounded-full ${member.online ? 'bg-emerald-400' : 'bg-slate-600'}`} title={member.online ? (pl ? 'Online' : 'Online') : (pl ? 'Offline' : 'Offline')} />
        </div>
        <div className="mt-0.5 flex items-center justify-between text-[9px] uppercase tracking-[0.12em] text-slate-500">
          <span>Lv. {member.level}</span>
          <span>{member.hp} / {member.maxHp} HP</span>
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-black/50">
          <div className="h-full bg-rose-500" style={{ width: `${healthPercent}%` }} />
        </div>
        {canKick ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void onKick(member)}
            className="mt-2 rounded-md border border-rose-300/20 bg-rose-400/10 px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-rose-200 transition hover:bg-rose-400/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? (pl ? 'Wyrzucanie…' : 'Removing…') : (pl ? 'Wyrzuć' : 'Remove')}
          </button>
        ) : null}
      </div>
    </div>
  );
}
