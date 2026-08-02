import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type {
  GuildRole,
  GuildSnapshot,
  GuildTreasuryTransactionType,
} from '../../contracts/guild';
import { canGuildInvite, canGuildKick, canGuildSetRole } from '../../game/guilds/guildPermissions';
import { useGameConnection } from '../../game/realtime/GameConnectionProvider';
import { useGameState } from '../../game/state/gameStore';
import { useI18n } from '../../i18n/I18nProvider';
import { Modal } from '../modals/Modal';

const roleOrder: Record<GuildRole, number> = { LEADER: 0, OFFICER: 1, MEMBER: 2 };
const upgradeCosts = [
  25_000,
  60_000,
  125_000,
  225_000,
  375_000,
  600_000,
  900_000,
  1_300_000,
  1_800_000,
  2_500_000,
] as const;

function parseSilver(value: string): number | null {
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

export function GuildModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const connection = useGameConnection();
  const state = useGameState();
  const { locale } = useI18n();
  const pl = locale === 'pl';
  const [snapshot, setSnapshot] = useState<GuildSnapshot>({ guild: null, invites: [], characterSilver: 0 });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [name, setName] = useState('');
  const [tag, setTag] = useState('');
  const [description, setDescription] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [depositAmount, setDepositAmount] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');
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
    () => guild ? [...guild.members].sort((a, b) => roleOrder[a.role] - roleOrder[b.role] || Number(b.online) - Number(a.online) || b.contributedSilver - a.contributedSilver || a.name.localeCompare(b.name)) : [],
    [guild],
  );
  const ownRole = guild?.role;
  const selfId = state.self?.characterId;
  const numberFormatter = useMemo(() => new Intl.NumberFormat(pl ? 'pl-PL' : 'en-US'), [pl]);
  const dateFormatter = useMemo(() => new Intl.DateTimeFormat(pl ? 'pl-PL' : 'en-US', {
    dateStyle: 'short',
    timeStyle: 'short',
  }), [pl]);
  const formatNumber = (value: number): string => numberFormatter.format(value);
  const roleLabel = (role: GuildRole): string => role === 'LEADER' ? (pl ? 'Przywódca' : 'Leader') : role === 'OFFICER' ? (pl ? 'Oficer' : 'Officer') : (pl ? 'Członek' : 'Member');
  const transactionLabel = (type: GuildTreasuryTransactionType): string => {
    if (type === 'DEPOSIT') return pl ? 'Wpłata' : 'Deposit';
    if (type === 'WITHDRAWAL') return pl ? 'Wypłata' : 'Withdrawal';
    return pl ? 'Ulepszenie' : 'Upgrade';
  };

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
  const deposit = (event: FormEvent) => {
    event.preventDefault();
    const amount = parseSilver(depositAmount);
    if (!amount) return;
    void run(async () => {
      const next = await connection.depositGuildSilver(amount);
      setDepositAmount('');
      return next;
    });
  };
  const withdraw = (event: FormEvent) => {
    event.preventDefault();
    const amount = parseSilver(withdrawAmount);
    if (!amount) return;
    void run(async () => {
      const next = await connection.withdrawGuildSilver(amount);
      setWithdrawAmount('');
      return next;
    });
  };

  return (
    <Modal title={pl ? 'Gildia' : 'Guild'} subtitle={pl ? 'Skarbiec, rozwój, statystyki i członkowie' : 'Treasury, progression, statistics and members'} icon="♜" onClose={onClose} widthClass="max-w-6xl">
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
              {snapshot.invites.length === 0 ? <p className="text-sm text-slate-500">{pl ? 'Nie masz aktywnych zaproszeń.' : 'You have no active invitations.'}</p> : snapshot.invites.map((inviteEntry) => (
                <article key={inviteEntry.inviteId} className="rounded-lg border border-white/10 bg-white/5 p-3">
                  <strong className="text-amber-100">[{inviteEntry.guildTag}] {inviteEntry.guildName}</strong>
                  <p className="mt-1 text-xs text-slate-400">{pl ? `Zaprasza: ${inviteEntry.inviterName}` : `Invited by: ${inviteEntry.inviterName}`}</p>
                  <div className="mt-3 flex gap-2">
                    <button disabled={busy} onClick={() => void run(() => connection.respondGuildInvite(inviteEntry.inviteId, true))} className="rounded border border-emerald-300/30 px-3 py-1 text-xs text-emerald-200">{pl ? 'Dołącz' : 'Join'}</button>
                    <button disabled={busy} onClick={() => void run(() => connection.respondGuildInvite(inviteEntry.inviteId, false))} className="rounded border border-white/15 px-3 py-1 text-xs text-slate-300">{pl ? 'Odrzuć' : 'Decline'}</button>
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
            <div>
              <p className="eyebrow">[{guild.tag}] · {roleLabel(guild.role)}</p>
              <h3 className="font-display mt-1 text-3xl text-amber-100">{guild.name}</h3>
              <p className="mt-2 text-xs text-slate-500">{pl ? 'Założona' : 'Founded'}: {dateFormatter.format(guild.createdAt)}</p>
            </div>
            <div className="text-right text-xs text-slate-400">
              <strong className="block text-lg text-amber-200">{pl ? 'Poziom' : 'Level'} {guild.level}</strong>
              {guild.statistics.onlineMemberCount} / {guild.statistics.memberCount} online
            </div>
          </header>

          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <article className="rounded-xl border border-amber-300/20 bg-slate-950/45 p-4">
              <p className="text-[10px] uppercase tracking-[.18em] text-slate-500">{pl ? 'Skarbiec' : 'Treasury'}</p>
              <strong className="mt-2 block text-xl text-amber-100">{formatNumber(guild.treasury.silver)} ◈</strong>
              <span className="text-xs text-slate-500">{pl ? `Portfel: ${formatNumber(snapshot.characterSilver)} ◈` : `Wallet: ${formatNumber(snapshot.characterSilver)} ◈`}</span>
            </article>
            <article className="rounded-xl border border-amber-300/20 bg-slate-950/45 p-4">
              <p className="text-[10px] uppercase tracking-[.18em] text-slate-500">{pl ? 'Bonus doświadczenia' : 'Experience bonus'}</p>
              <strong className="mt-2 block text-xl text-emerald-200">+{guild.treasury.experienceBonusPercent}% XP</strong>
              <span className="text-xs text-slate-500">{pl ? `Stopień ${guild.treasury.experienceUpgradeLevel}/10` : `Tier ${guild.treasury.experienceUpgradeLevel}/10`}</span>
            </article>
            <article className="rounded-xl border border-amber-300/20 bg-slate-950/45 p-4">
              <p className="text-[10px] uppercase tracking-[.18em] text-slate-500">{pl ? 'Pokonane moby' : 'Mobs defeated'}</p>
              <strong className="mt-2 block text-xl text-amber-100">{formatNumber(guild.statistics.mobKills)}</strong>
              <span className="text-xs text-slate-500">+{formatNumber(guild.statistics.bonusExperienceGranted)} XP {pl ? 'z gildii' : 'from guild'}</span>
            </article>
            <article className="rounded-xl border border-amber-300/20 bg-slate-950/45 p-4">
              <p className="text-[10px] uppercase tracking-[.18em] text-slate-500">{pl ? 'Średni poziom' : 'Average level'}</p>
              <strong className="mt-2 block text-xl text-amber-100">{guild.statistics.averageMemberLevel}</strong>
              <span className="text-xs text-slate-500">{guild.statistics.memberCount} / 60 {pl ? 'członków' : 'members'}</span>
            </article>
          </section>

          <div className="grid gap-5 xl:grid-cols-[1fr_1.3fr]">
            <aside className="space-y-4">
              <section className="rounded-xl border border-amber-300/20 bg-slate-950/45 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="eyebrow">{pl ? 'Rozwój gildii' : 'Guild progression'}</p>
                    <h4 className="mt-2 text-lg font-semibold text-amber-100">{pl ? 'Wiedza łowców' : 'Hunter knowledge'}</h4>
                  </div>
                  <span className="rounded border border-emerald-300/25 bg-emerald-400/10 px-2 py-1 text-xs text-emerald-200">+{guild.treasury.experienceBonusPercent}% XP</span>
                </div>
                <p className="mt-3 text-sm leading-6 text-slate-300">
                  {pl
                    ? 'Każdy z 10 stopni daje wszystkim członkom +2% doświadczenia za zabijanie mobów. Maksymalny bonus wynosi +20%.'
                    : 'Each of 10 tiers gives every member +2% experience from mob kills, up to +20%.'}
                </p>
                <div className="mt-4 grid grid-cols-5 gap-2">
                  {upgradeCosts.map((cost, index) => {
                    const level = index + 1;
                    const unlocked = guild.treasury.experienceUpgradeLevel >= level;
                    return <div key={level} title={`${formatNumber(cost)} silver`} className={`rounded border p-2 text-center ${unlocked ? 'border-emerald-300/30 bg-emerald-400/10 text-emerald-200' : 'border-white/10 bg-black/20 text-slate-500'}`}>
                      <strong className="block text-xs">{level}</strong>
                      <span className="text-[9px]">+{level * 2}%</span>
                    </div>;
                  })}
                </div>
                {guild.treasury.nextUpgradeCost !== null ? (
                  <div className="mt-4 rounded-lg border border-amber-300/15 bg-amber-950/15 p-3">
                    <p className="text-xs text-slate-400">{pl ? 'Następny stopień' : 'Next tier'}: <strong className="text-amber-100">{formatNumber(guild.treasury.nextUpgradeCost)} ◈</strong></p>
                    {ownRole === 'LEADER' ? <button disabled={busy || guild.treasury.silver < guild.treasury.nextUpgradeCost} onClick={() => void run(() => connection.buyGuildExperienceUpgrade())} className="mt-3 w-full rounded border border-amber-300/35 bg-amber-400/10 px-3 py-2 text-xs font-bold uppercase tracking-wider text-amber-100 hover:bg-amber-400/20 disabled:opacity-40">{pl ? 'Kup ulepszenie ze skarbca' : 'Buy upgrade from treasury'}</button> : <p className="mt-2 text-xs text-slate-500">{pl ? 'Ulepszenia kupuje przywódca.' : 'Only the leader can buy upgrades.'}</p>}
                  </div>
                ) : <p className="mt-4 rounded-lg border border-emerald-300/20 bg-emerald-400/10 p-3 text-sm text-emerald-200">{pl ? 'Osiągnięto maksymalny bonus +20% XP.' : 'Maximum +20% XP bonus reached.'}</p>}
              </section>

              <section className="rounded-xl border border-white/10 bg-slate-950/45 p-4">
                <p className="eyebrow">{pl ? 'Operacje skarbca' : 'Treasury operations'}</p>
                <form onSubmit={deposit} className="mt-3 grid grid-cols-[1fr_auto] gap-2">
                  <input type="number" min={1} max={snapshot.characterSilver} step={1} value={depositAmount} onChange={(event) => setDepositAmount(event.target.value)} placeholder={pl ? 'Kwota wpłaty' : 'Deposit amount'} className="min-w-0 rounded border border-amber-300/20 bg-black/30 px-3 py-2 text-sm text-amber-50 outline-none" />
                  <button disabled={busy || !parseSilver(depositAmount)} className="rounded border border-emerald-300/30 px-3 py-2 text-xs text-emerald-200 disabled:opacity-40">{pl ? 'Wpłać' : 'Deposit'}</button>
                </form>
                {ownRole === 'LEADER' ? <form onSubmit={withdraw} className="mt-2 grid grid-cols-[1fr_auto] gap-2">
                  <input type="number" min={1} max={guild.treasury.silver} step={1} value={withdrawAmount} onChange={(event) => setWithdrawAmount(event.target.value)} placeholder={pl ? 'Kwota wypłaty' : 'Withdrawal amount'} className="min-w-0 rounded border border-amber-300/20 bg-black/30 px-3 py-2 text-sm text-amber-50 outline-none" />
                  <button disabled={busy || !parseSilver(withdrawAmount)} className="rounded border border-rose-300/30 px-3 py-2 text-xs text-rose-200 disabled:opacity-40">{pl ? 'Wypłać' : 'Withdraw'}</button>
                </form> : null}
                <div className="mt-4 grid grid-cols-3 gap-2 text-center text-[10px] text-slate-500">
                  <div><strong className="block text-xs text-slate-300">{formatNumber(guild.treasury.totalSilverDeposited)}</strong>{pl ? 'wpłacono' : 'deposited'}</div>
                  <div><strong className="block text-xs text-slate-300">{formatNumber(guild.treasury.totalSilverSpentOnUpgrades)}</strong>{pl ? 'wydano' : 'spent'}</div>
                  <div><strong className="block text-xs text-slate-300">{formatNumber(guild.treasury.totalSilverWithdrawn)}</strong>{pl ? 'wypłacono' : 'withdrawn'}</div>
                </div>
              </section>

              <section className="rounded-xl border border-white/10 bg-slate-950/45 p-4">
                <p className="eyebrow">{pl ? 'Historia skarbca' : 'Treasury history'}</p>
                <div className="scrollbar-thin mt-3 max-h-52 space-y-2 overflow-y-auto pr-1">
                  {guild.treasury.recentTransactions.length === 0 ? <p className="text-sm text-slate-500">{pl ? 'Brak operacji.' : 'No operations yet.'}</p> : guild.treasury.recentTransactions.map((transaction) => (
                    <article key={transaction.id} className="rounded-lg border border-white/10 bg-white/5 p-2.5">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <strong className={transaction.type === 'DEPOSIT' ? 'text-emerald-200' : transaction.type === 'WITHDRAWAL' ? 'text-rose-200' : 'text-amber-200'}>{transactionLabel(transaction.type)}</strong>
                        <span className="text-slate-300">{formatNumber(transaction.amount)} ◈</span>
                      </div>
                      <p className="mt-1 text-[10px] text-slate-500">{transaction.actorName} · {dateFormatter.format(transaction.createdAt)} · {pl ? 'saldo' : 'balance'} {formatNumber(transaction.balanceAfter)}</p>
                    </article>
                  ))}
                </div>
              </section>

              <section className="rounded-xl border border-white/10 bg-slate-950/45 p-4">
                <p className="eyebrow">{pl ? 'Opis gildii' : 'Guild description'}</p>
                {ownRole !== 'MEMBER' ? <>
                  <textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={280} rows={4} className="mt-3 w-full resize-none rounded border border-amber-300/20 bg-black/30 px-3 py-2 text-sm text-slate-200 outline-none" />
                  <button disabled={busy || description === guild.description} onClick={() => void run(() => connection.updateGuildDescription(description))} className="mt-2 rounded border border-amber-300/30 px-3 py-1.5 text-xs text-amber-200 disabled:opacity-40">{pl ? 'Zapisz opis' : 'Save description'}</button>
                </> : <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-300">{guild.description || (pl ? 'Brak opisu.' : 'No description.')}</p>}
              </section>

              {ownRole && canGuildInvite(ownRole) ? <form onSubmit={invite} className="rounded-xl border border-white/10 bg-slate-950/45 p-4">
                <p className="eyebrow">{pl ? 'Rekrutacja' : 'Recruitment'}</p>
                <input value={inviteName} onChange={(event) => setInviteName(event.target.value)} placeholder={pl ? 'Nazwa postaci' : 'Character name'} maxLength={24} className="mt-3 w-full rounded border border-amber-300/20 bg-black/30 px-3 py-2 text-sm text-amber-50 outline-none" />
                <button disabled={busy || !inviteName.trim()} className="mt-2 w-full rounded border border-amber-300/30 px-3 py-2 text-xs font-semibold uppercase text-amber-200 disabled:opacity-40">{pl ? 'Wyślij zaproszenie' : 'Send invitation'}</button>
              </form> : null}

              <section className="rounded-xl border border-rose-300/15 bg-rose-950/10 p-4">
                {ownRole === 'LEADER' ? <button disabled={busy} onClick={() => { if (window.confirm(pl ? 'Na pewno rozwiązać gildię? Srebro pozostające w skarbcu przepadnie.' : 'Disband this guild? Any silver left in the treasury will be lost.')) void run(() => connection.disbandGuild()); }} className="w-full rounded border border-rose-300/30 px-3 py-2 text-xs text-rose-200">{pl ? 'Rozwiąż gildię' : 'Disband guild'}</button> : <button disabled={busy} onClick={() => { if (window.confirm(pl ? 'Opuścić gildię?' : 'Leave this guild?')) void run(() => connection.leaveGuild()); }} className="w-full rounded border border-rose-300/30 px-3 py-2 text-xs text-rose-200">{pl ? 'Opuść gildię' : 'Leave guild'}</button>}
              </section>
            </aside>

            <section className="rounded-xl border border-white/10 bg-slate-950/45 p-4">
              <div className="mb-3 flex items-center justify-between gap-3"><p className="eyebrow">{pl ? 'Członkowie i wkład' : 'Members and contribution'}</p><span className="text-xs text-slate-500">{pl ? 'zielona kropka = online' : 'green dot = online'}</span></div>
              <div className="scrollbar-thin max-h-[980px] space-y-2 overflow-y-auto pr-1">
                {members.map((member) => {
                  const isSelf = member.characterId === selfId;
                  const mayKick = ownRole ? canGuildKick(ownRole, member.role) && !isSelf : false;
                  const maySetRole = ownRole ? canGuildSetRole(ownRole, member.role, member.role === 'OFFICER' ? 'MEMBER' : 'OFFICER') : false;
                  return <article key={member.characterId} className="rounded-lg border border-white/10 bg-white/5 p-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className={`h-2.5 w-2.5 rounded-full ${member.online ? 'bg-emerald-400' : 'bg-slate-600'}`} aria-label={member.online ? 'online' : 'offline'} />
                      <div className="min-w-0 flex-1"><strong className="text-amber-50">{member.name}{isSelf ? (pl ? ' (ty)' : ' (you)') : ''}</strong><p className="text-xs text-slate-400">{roleLabel(member.role)} · {pl ? 'poziom' : 'level'} {member.level}</p></div>
                      {!isSelf && ownRole === 'LEADER' ? <button disabled={busy} onClick={() => { if (window.confirm(pl ? `Przekazać przywództwo graczowi ${member.name}?` : `Transfer leadership to ${member.name}?`)) void run(() => connection.transferGuildLeadership(member.characterId)); }} className="rounded border border-yellow-300/25 px-2 py-1 text-[10px] text-yellow-200">{pl ? 'Przywództwo' : 'Leadership'}</button> : null}
                      {maySetRole ? <button disabled={busy} onClick={() => void run(() => connection.setGuildRole(member.characterId, member.role === 'OFFICER' ? 'MEMBER' : 'OFFICER'))} className="rounded border border-amber-300/25 px-2 py-1 text-[10px] text-amber-200">{member.role === 'OFFICER' ? (pl ? 'Degraduj' : 'Demote') : (pl ? 'Awansuj' : 'Promote')}</button> : null}
                      {mayKick ? <button disabled={busy} onClick={() => { if (window.confirm(pl ? `Wyrzucić gracza ${member.name}?` : `Kick ${member.name}?`)) void run(() => connection.kickGuildMember(member.characterId)); }} className="rounded border border-rose-300/25 px-2 py-1 text-[10px] text-rose-200">{pl ? 'Wyrzuć' : 'Kick'}</button> : null}
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2 border-t border-white/5 pt-3 text-center">
                      <div><strong className="block text-xs text-amber-100">{formatNumber(member.contributedSilver)} ◈</strong><span className="text-[9px] uppercase tracking-wider text-slate-500">{pl ? 'wpłaty' : 'deposits'}</span></div>
                      <div><strong className="block text-xs text-slate-200">{formatNumber(member.mobKills)}</strong><span className="text-[9px] uppercase tracking-wider text-slate-500">{pl ? 'moby' : 'mobs'}</span></div>
                      <div><strong className="block text-xs text-emerald-200">+{formatNumber(member.bonusExperienceEarned)} XP</strong><span className="text-[9px] uppercase tracking-wider text-slate-500">bonus</span></div>
                    </div>
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
