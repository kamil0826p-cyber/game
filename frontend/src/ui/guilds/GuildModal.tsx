import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { GuildRole, GuildSnapshot } from '../../contracts/guild';
import { canGuildInvite, canGuildKick, canGuildSetRole } from '../../game/guilds/guildPermissions';
import { useGameConnection } from '../../game/realtime/GameConnectionProvider';
import { useGameState } from '../../game/state/gameStore';
import { useI18n } from '../../i18n/I18nProvider';
import { Modal } from '../modals/Modal';

const roleOrder: Record<GuildRole, number> = { LEADER: 0, OFFICER: 1, MEMBER: 2 };

export function GuildModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const connection = useGameConnection();
  const state = useGameState();
  const { locale } = useI18n();
  const pl = locale === 'pl';
  const [snapshot, setSnapshot] = useState<GuildSnapshot>({ guild: null, invites: [] });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [name, setName] = useState('');
  const [tag, setTag] = useState('');
  const [description, setDescription] = useState('');
  const [inviteName, setInviteName] = useState('');
  const guild = snapshot.guild;

  useEffect(() => {
    let active = true;
    const unsubscribe = connection.subscribeGuild((next) => {
      if (active) setSnapshot(next);
    });
    void connection.getGuild()
      .then((next) => { if (active) setSnapshot(next); })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : String(reason)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; unsubscribe(); };
  }, [connection]);

  useEffect(() => {
    if (guild) setDescription(guild.description);
  }, [guild]);

  const run = async (operation: () => Promise<GuildSnapshot>): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      setSnapshot(await operation());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const members = useMemo(
    () => guild ? [...guild.members].sort((a, b) => roleOrder[a.role] - roleOrder[b.role] || Number(b.online) - Number(a.online) || a.name.localeCompare(b.name)) : [],
    [guild],
  );
  const ownRole = guild?.role;
  const selfId = state.self?.characterId;
  const roleLabel = (role: GuildRole): string => role === 'LEADER' ? (pl ? 'Przywódca' : 'Leader') : role === 'OFFICER' ? (pl ? 'Oficer' : 'Officer') : (pl ? 'Członek' : 'Member');

  const createGuild = (event: FormEvent) => {
    event.preventDefault();
    void run(() => connection.createGuild({ name, tag, description }));
  };
  const invite = (event: FormEvent) => {
    event.preventDefault();
    const candidate = inviteName.trim();
    if (!candidate) return;
    void run(async () => {
      const next = await connection.inviteToGuild(candidate);
      setInviteName('');
      return next;
    });
  };

  return (
    <Modal title={pl ? 'Gildia' : 'Guild'} subtitle={pl ? 'Klan, członkowie i wspólna organizacja' : 'Clan, members and organization'} icon="♜" onClose={onClose} widthClass="max-w-5xl">
      {loading ? <p className="py-12 text-center text-sm text-slate-400">{pl ? 'Wczytywanie gildii…' : 'Loading guild…'}</p> : null}
      {error ? <p className="mb-4 rounded-lg border border-rose-400/25 bg-rose-950/30 p-3 text-sm text-rose-200">{error}</p> : null}
      {!loading && !snapshot.guild ? (
        <div className="grid gap-5 md:grid-cols-[1.2fr_.8fr]">
          <form onSubmit={createGuild} className="space-y-4 rounded-xl border border-amber-300/20 bg-slate-950/45 p-5">
            <div>
              <p className="eyebrow">{pl ? 'Załóż własny klan' : 'Found your own clan'}</p>
              <h3 className="font-display mt-2 text-2xl text-amber-100">{pl ? 'Utwórz gildię' : 'Create a guild'}</h3>
            </div>
            <label className="block text-xs text-slate-300">{pl ? 'Nazwa' : 'Name'}
              <input value={name} onChange={(event) => setName(event.target.value)} minLength={3} maxLength={32} required className="mt-1 w-full rounded border border-amber-300/20 bg-black/30 px-3 py-2 text-amber-50 outline-none focus:border-amber-300/50" />
            </label>
            <label className="block text-xs text-slate-300">{pl ? 'Tag (2–5 znaków)' : 'Tag (2–5 characters)'}
              <input value={tag} onChange={(event) => setTag(event.target.value.toUpperCase())} minLength={2} maxLength={5} required className="mt-1 w-full rounded border border-amber-300/20 bg-black/30 px-3 py-2 uppercase text-amber-50 outline-none focus:border-amber-300/50" />
            </label>
            <label className="block text-xs text-slate-300">{pl ? 'Opis' : 'Description'}
              <textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={280} rows={4} className="mt-1 w-full resize-none rounded border border-amber-300/20 bg-black/30 px-3 py-2 text-amber-50 outline-none focus:border-amber-300/50" />
            </label>
            <button disabled={busy} type="submit" className="w-full rounded border border-amber-300/40 bg-amber-400/10 px-4 py-2 text-xs font-bold uppercase tracking-wider text-amber-100 hover:bg-amber-400/20 disabled:opacity-50">
              {pl ? 'Utwórz gildię' : 'Create guild'}
            </button>
          </form>
          <section className="rounded-xl border border-white/10 bg-slate-950/45 p-5">
            <p className="eyebrow">{pl ? 'Zaproszenia' : 'Invitations'}</p>
            <div className="mt-4 space-y-3">
              {snapshot.invites.length === 0 ? <p className="text-sm text-slate-500">{pl ? 'Nie masz aktywnych zaproszeń.' : 'You have no active invitations.'}</p> : snapshot.invites.map((invite) => (
                <article key={invite.inviteId} className="rounded-lg border border-white/10 bg-white/5 p-3">
                  <strong className="text-amber-100">[{invite.guildTag}] {invite.guildName}</strong>
                  <p className="mt-1 text-xs text-slate-400">{pl ? `Zaprasza: ${invite.inviterName}` : `Invited by: ${invite.inviterName}`}</p>
                  <div className="mt-3 flex gap-2">
                    <button disabled={busy} onClick={() => void run(() => connection.respondGuildInvite(invite.inviteId, true))} className="rounded border border-emerald-300/30 px-3 py-1 text-xs text-emerald-200">{pl ? 'Dołącz' : 'Join'}</button>
                    <button disabled={busy} onClick={() => void run(() => connection.respondGuildInvite(invite.inviteId, false))} className="rounded border border-white/15 px-3 py-1 text-xs text-slate-300">{pl ? 'Odrzuć' : 'Decline'}</button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>
      ) : null}
      {!loading && guild ? (
        <div className="space-y-5">
          <header className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-amber-300/20 bg-amber-950/15 p-5">
            <div><p className="eyebrow">[{guild.tag}] · {roleLabel(guild.role)}</p><h3 className="font-display mt-1 text-3xl text-amber-100">{guild.name}</h3></div>
            <div className="text-right text-xs text-slate-400"><strong className="block text-lg text-amber-200">{pl ? 'Poziom' : 'Level'} {guild.level}</strong>{members.length} / 60 {pl ? 'członków' : 'members'}</div>
          </header>
          <div className="grid gap-5 lg:grid-cols-[1fr_1.5fr]">
            <aside className="space-y-4">
              <section className="rounded-xl border border-white/10 bg-slate-950/45 p-4">
                <p className="eyebrow">{pl ? 'Opis gildii' : 'Guild description'}</p>
                {ownRole !== 'MEMBER' ? <>
                  <textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={280} rows={5} className="mt-3 w-full resize-none rounded border border-amber-300/20 bg-black/30 px-3 py-2 text-sm text-slate-200 outline-none" />
                  <button disabled={busy || description === guild.description} onClick={() => void run(() => connection.updateGuildDescription(description))} className="mt-2 rounded border border-amber-300/30 px-3 py-1.5 text-xs text-amber-200 disabled:opacity-40">{pl ? 'Zapisz opis' : 'Save description'}</button>
                </> : <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-300">{guild.description || (pl ? 'Brak opisu.' : 'No description.')}</p>}
              </section>
              {ownRole && canGuildInvite(ownRole) ? <form onSubmit={invite} className="rounded-xl border border-white/10 bg-slate-950/45 p-4">
                <p className="eyebrow">{pl ? 'Rekrutacja' : 'Recruitment'}</p>
                <input value={inviteName} onChange={(event) => setInviteName(event.target.value)} placeholder={pl ? 'Nazwa postaci' : 'Character name'} maxLength={24} className="mt-3 w-full rounded border border-amber-300/20 bg-black/30 px-3 py-2 text-sm text-amber-50 outline-none" />
                <button disabled={busy || !inviteName.trim()} className="mt-2 w-full rounded border border-amber-300/30 px-3 py-2 text-xs font-semibold uppercase text-amber-200 disabled:opacity-40">{pl ? 'Wyślij zaproszenie' : 'Send invitation'}</button>
              </form> : null}
              <section className="rounded-xl border border-rose-300/15 bg-rose-950/10 p-4">
                {ownRole === 'LEADER' ? <button disabled={busy} onClick={() => { if (window.confirm(pl ? 'Na pewno rozwiązać gildię?' : 'Disband this guild?')) void run(() => connection.disbandGuild()); }} className="w-full rounded border border-rose-300/30 px-3 py-2 text-xs text-rose-200">{pl ? 'Rozwiąż gildię' : 'Disband guild'}</button> : <button disabled={busy} onClick={() => { if (window.confirm(pl ? 'Opuścić gildię?' : 'Leave this guild?')) void run(() => connection.leaveGuild()); }} className="w-full rounded border border-rose-300/30 px-3 py-2 text-xs text-rose-200">{pl ? 'Opuść gildię' : 'Leave guild'}</button>}
              </section>
            </aside>
            <section className="rounded-xl border border-white/10 bg-slate-950/45 p-4">
              <div className="mb-3 flex items-center justify-between"><p className="eyebrow">{pl ? 'Członkowie' : 'Members'}</p><span className="text-xs text-slate-500">{pl ? 'zielona kropka = online' : 'green dot = online'}</span></div>
              <div className="scrollbar-thin max-h-[440px] space-y-2 overflow-y-auto pr-1">
                {members.map((member) => {
                  const isSelf = member.characterId === selfId;
                  const mayKick = ownRole ? canGuildKick(ownRole, member.role) && !isSelf : false;
                  const maySetRole = ownRole ? canGuildSetRole(ownRole, member.role, member.role === 'OFFICER' ? 'MEMBER' : 'OFFICER') : false;
                  return <article key={member.characterId} className="flex flex-wrap items-center gap-3 rounded-lg border border-white/10 bg-white/5 p-3">
                    <span className={`h-2.5 w-2.5 rounded-full ${member.online ? 'bg-emerald-400' : 'bg-slate-600'}`} aria-label={member.online ? 'online' : 'offline'} />
                    <div className="min-w-0 flex-1"><strong className="text-amber-50">{member.name}{isSelf ? (pl ? ' (ty)' : ' (you)') : ''}</strong><p className="text-xs text-slate-400">{roleLabel(member.role)} · {pl ? 'poziom' : 'level'} {member.level}</p></div>
                    {!isSelf && ownRole === 'LEADER' ? <button disabled={busy} onClick={() => { if (window.confirm(pl ? `Przekazać przywództwo graczowi ${member.name}?` : `Transfer leadership to ${member.name}?`)) void run(() => connection.transferGuildLeadership(member.characterId)); }} className="rounded border border-yellow-300/25 px-2 py-1 text-[10px] text-yellow-200">{pl ? 'Przywództwo' : 'Leadership'}</button> : null}
                    {maySetRole ? <button disabled={busy} onClick={() => void run(() => connection.setGuildRole(member.characterId, member.role === 'OFFICER' ? 'MEMBER' : 'OFFICER'))} className="rounded border border-sky-300/25 px-2 py-1 text-[10px] text-sky-200">{member.role === 'OFFICER' ? (pl ? 'Degraduj' : 'Demote') : (pl ? 'Awansuj' : 'Promote')}</button> : null}
                    {mayKick ? <button disabled={busy} onClick={() => { if (window.confirm(pl ? `Wyrzucić gracza ${member.name}?` : `Kick ${member.name}?`)) void run(() => connection.kickGuildMember(member.characterId)); }} className="rounded border border-rose-300/25 px-2 py-1 text-[10px] text-rose-200">{pl ? 'Wyrzuć' : 'Kick'}</button> : null}
                  </article>;
                })}
              </div>
            </section>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
