import { useCallback, useEffect, useMemo, useState } from 'react';
import { ItemIcon } from '../../components/common/ItemIcon';
import { rarityClasses } from '../../components/common/ItemTooltip';
import type {
  RewardClaimMutationResult,
  RewardClaimPayload,
  RewardClaimsSnapshot,
  RewardClaimSource,
} from '../../contracts/rewardClaims';
import { useGameConnection } from '../../game/realtime/GameConnectionProvider';
import { useI18n } from '../../i18n/I18nProvider';
import { Modal } from '../modals/Modal';

type ClaimsFilter = 'ALL' | 'EXPIRING' | RewardClaimSource;

interface RewardClaimsModalProps {
  onClose: () => void;
}

const statEntries = (
  stats: Record<string, number | undefined>,
): Array<[string, number]> =>
  Object.entries(stats).filter(
    (entry): entry is [string, number] =>
      typeof entry[1] === 'number' && entry[1] !== 0,
  );

const formatRemaining = (expiresAt: number, locale: 'en' | 'pl'): string => {
  const remaining = Math.max(0, expiresAt - Date.now());
  const minutes = Math.max(0, Math.ceil(remaining / 60_000));
  if (minutes < 60) {
    return locale === 'pl' ? `${minutes} min` : `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 48) {
    return locale === 'pl' ? `${hours} godz.` : `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  return locale === 'pl' ? `${days} dni` : `${days}d`;
};

const sourceLabel = (source: RewardClaimSource, locale: 'en' | 'pl'): string => {
  const labels: Record<RewardClaimSource, readonly [string, string]> = {
    MARKET: ['Rynek', 'Market'],
    CRAFTING: ['Rzemiosło', 'Crafting'],
    COMBAT: ['Walka', 'Combat'],
    QUEST: ['Zadanie', 'Quest'],
    LOOT: ['Łup', 'Loot'],
    ADMIN: ['Administracja', 'Administration'],
    OTHER: ['Inne', 'Other'],
  };
  return labels[source][locale === 'pl' ? 0 : 1];
};

function ItemDetails({
  claim,
  locale,
}: {
  claim: RewardClaimPayload;
  locale: 'en' | 'pl';
}): React.JSX.Element {
  const item = claim.item;
  return (
    <div className="space-y-3 text-sm">
      <p className="text-slate-300">{item.description}</p>
      <div className="flex flex-wrap gap-2 text-xs text-slate-400">
        <span>{item.rarity}</span>
        <span>• {item.category}</span>
        <span>• {locale === 'pl' ? 'Moc' : 'Power'} {item.powerLevel}</span>
        <span>• {locale === 'pl' ? 'Jakość' : 'Quality'} {item.craftQuality}</span>
        <span>• {locale === 'pl' ? 'Poziom' : 'Level'} {item.minimumLevel}</span>
        {item.requiredClass ? <span>• {item.requiredClass}</span> : null}
      </div>
      {statEntries(item.statBonuses).length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {statEntries(item.statBonuses).map(([key, value]) => (
            <span
              key={key}
              className="rounded border border-emerald-400/20 bg-emerald-950/25 px-2 py-1 text-xs text-emerald-200"
            >
              {key} {value > 0 ? '+' : ''}{value}
            </span>
          ))}
        </div>
      ) : null}
      {item.affixes.length > 0 ? (
        <div>
          <strong className="text-xs uppercase tracking-wide text-amber-200">
            {locale === 'pl' ? 'Afiksy' : 'Affixes'}
          </strong>
          <div className="mt-1 space-y-1">
            {item.affixes.map((affix, index) => (
              <div key={`${affix.name}-${index}`} className="text-xs text-sky-200">
                T{affix.tier} {affix.name}
                {statEntries(affix.statBonuses)
                  .map(
                    ([key, value]) =>
                      ` · ${key} ${value > 0 ? '+' : ''}${value}`,
                  )
                  .join('')}
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {item.relic ? (
        <div className="rounded border border-violet-400/25 bg-violet-950/25 p-2 text-xs text-violet-100">
          <strong>{item.relic.name}</strong>
          <p className="mt-1 text-violet-200/80">{item.relic.description}</p>
        </div>
      ) : null}
      {item.curse ? (
        <div className="rounded border border-red-400/25 bg-red-950/25 p-2 text-xs text-red-100">
          <strong>{item.curse.name}</strong>
          <p className="mt-1 text-red-200/80">{item.curse.preview}</p>
        </div>
      ) : null}
    </div>
  );
}

function ClaimCard({
  claim,
  locale,
  busy,
  onClaim,
}: {
  claim: RewardClaimPayload;
  locale: 'en' | 'pl';
  busy: boolean;
  onClaim: (claimId: string) => void;
}): React.JSX.Element {
  const capacityText = claim.capacity.canClaim
    ? claim.capacity.requiredSlots === 0
      ? locale === 'pl'
        ? 'Zmieszcza się w istniejącym stosie.'
        : 'Fits in an existing stack.'
      : locale === 'pl'
        ? `Potrzebne sloty: ${claim.capacity.requiredSlots}. Wolne: ${claim.capacity.freeSlots}.`
        : `Slots required: ${claim.capacity.requiredSlots}. Free: ${claim.capacity.freeSlots}.`
    : locale === 'pl'
      ? `Brakuje miejsca. Potrzebne sloty: ${claim.capacity.requiredSlots}, wolne: ${claim.capacity.freeSlots}.`
      : `Not enough space. Slots required: ${claim.capacity.requiredSlots}, free: ${claim.capacity.freeSlots}.`;

  return (
    <article
      className={`rounded border bg-black/25 p-4 ${rarityClasses(claim.item.rarity)} ${
        claim.expiringSoon ? 'ring-1 ring-red-400/60' : ''
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <ItemIcon
            definitionKey={claim.item.definitionKey}
            fallback={claim.item.icon}
            className="h-16 w-16 shrink-0"
          />
          <div className="min-w-0">
            <h3 className="font-display text-xl text-amber-100">
              {claim.quantity} × {claim.item.name}
            </h3>
            <p className="text-xs text-slate-400">
              {sourceLabel(claim.source, locale)} · {locale === 'pl' ? 'Wygasa za' : 'Expires in'}{' '}
              <strong className={claim.expiringSoon ? 'text-red-300' : 'text-slate-200'}>
                {formatRemaining(claim.expiresAt, locale)}
              </strong>
            </p>
            <p className="mt-1 break-all text-[11px] text-slate-600">{claim.reason}</p>
          </div>
        </div>
        <button
          type="button"
          className="hud-utility-button"
          disabled={busy || !claim.capacity.canClaim}
          onClick={() => onClaim(claim.id)}
        >
          {claim.capacity.canClaim
            ? locale === 'pl'
              ? 'Odbierz'
              : 'Claim'
            : locale === 'pl'
              ? 'Brak miejsca'
              : 'No space'}
        </button>
      </div>
      <div className="mt-4">
        <ItemDetails claim={claim} locale={locale} />
      </div>
      <div
        className={`mt-4 rounded border px-3 py-2 text-xs ${
          claim.capacity.canClaim
            ? 'border-emerald-400/20 bg-emerald-950/20 text-emerald-200'
            : 'border-red-400/25 bg-red-950/25 text-red-200'
        }`}
      >
        {capacityText}
        {claim.capacity.matchingStackSpace > 0 ? (
          <span className="ml-2 text-slate-400">
            {locale === 'pl' ? 'Miejsce w stosach' : 'Stack space'}: {claim.capacity.matchingStackSpace}
          </span>
        ) : null}
      </div>
    </article>
  );
}

export function RewardClaimsModal({ onClose }: RewardClaimsModalProps): React.JSX.Element {
  const connection = useGameConnection();
  const { locale } = useI18n();
  const [snapshot, setSnapshot] = useState<RewardClaimsSnapshot>();
  const [filter, setFilter] = useState<ClaimsFilter>('ALL');
  const [busy, setBusy] = useState(false);
  const [lastMutation, setLastMutation] = useState<
    RewardClaimMutationResult['mutation']
  >();

  const refresh = useCallback(async (): Promise<void> => {
    setSnapshot(await connection.getRewardClaims());
  }, [connection]);

  useEffect(() => {
    let mounted = true;
    void connection
      .getRewardClaims()
      .then((value) => {
        if (mounted) setSnapshot(value);
      })
      .catch(onClose);
    return () => {
      mounted = false;
    };
  }, [connection, onClose]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (!busy) void refresh().catch(() => undefined);
    }, 15_000);
    return () => window.clearInterval(interval);
  }, [busy, refresh]);

  const visibleClaims = useMemo(() => {
    if (!snapshot) return [];
    if (filter === 'ALL') return snapshot.claims;
    if (filter === 'EXPIRING') return snapshot.claims.filter((claim) => claim.expiringSoon);
    return snapshot.claims.filter((claim) => claim.source === filter);
  }, [filter, snapshot]);

  const applyMutation = async (
    operation: () => Promise<RewardClaimMutationResult>,
  ): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await operation();
      setSnapshot(result.snapshot);
      setLastMutation(result.mutation);
    } catch {
      try {
        await refresh();
      } catch {
        onClose();
      }
    } finally {
      setBusy(false);
    }
  };

  const mutationMessage = (): string | undefined => {
    if (!lastMutation) return undefined;
    if (lastMutation.kind === 'CLAIMED') {
      return locale === 'pl'
        ? `Odebrano ${lastMutation.claimedQuantity} szt. nagrody.`
        : `Claimed ${lastMutation.claimedQuantity} reward item(s).`;
    }
    const parts = [
      locale === 'pl'
        ? `Odebrano ${lastMutation.claimedCount} nagród (${lastMutation.claimedQuantity} szt.).`
        : `Claimed ${lastMutation.claimedCount} rewards (${lastMutation.claimedQuantity} items).`,
    ];
    if (lastMutation.blockedIds.length > 0) {
      parts.push(
        locale === 'pl'
          ? `${lastMutation.blockedIds.length} nagród pominięto z powodu braku miejsca.`
          : `${lastMutation.blockedIds.length} rewards were skipped because the backpack is full.`,
      );
    }
    if (lastMutation.expiredIds.length > 0) {
      parts.push(
        locale === 'pl'
          ? `${lastMutation.expiredIds.length} nagród zdążyło wygasnąć.`
          : `${lastMutation.expiredIds.length} rewards expired.`,
      );
    }
    return parts.join(' ');
  };

  const filters: ClaimsFilter[] = [
    'ALL',
    'EXPIRING',
    'MARKET',
    'CRAFTING',
    'COMBAT',
    'QUEST',
    'LOOT',
    'OTHER',
  ];

  return (
    <Modal
      title={locale === 'pl' ? 'Kolejka nagród' : 'Reward queue'}
      subtitle={
        locale === 'pl'
          ? 'Nagrody, które nie zmieściły się w plecaku. Odbierz je przed wygaśnięciem.'
          : 'Rewards that did not fit in your backpack. Claim them before they expire.'
      }
      icon="◆"
      onClose={onClose}
      widthClass="max-w-7xl"
    >
      {!snapshot ? (
        <p className="py-12 text-center text-sm text-slate-400">
          {locale === 'pl' ? 'Ładowanie nagród…' : 'Loading rewards…'}
        </p>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <div className="rounded border border-amber-400/20 bg-black/25 p-3">
              <span className="text-xs uppercase text-slate-500">
                {locale === 'pl' ? 'Nagrody' : 'Rewards'}
              </span>
              <strong className="block text-xl text-amber-200">
                {snapshot.summary.totalClaims}
              </strong>
            </div>
            <div className="rounded border border-white/10 bg-black/25 p-3">
              <span className="text-xs uppercase text-slate-500">
                {locale === 'pl' ? 'Łączna ilość' : 'Total quantity'}
              </span>
              <strong className="block text-xl text-slate-200">
                {snapshot.summary.totalQuantity}
              </strong>
            </div>
            <div className="rounded border border-red-400/20 bg-red-950/20 p-3">
              <span className="text-xs uppercase text-red-300/70">
                {locale === 'pl' ? 'Wygasają w 72h' : 'Expiring in 72h'}
              </span>
              <strong className="block text-xl text-red-200">
                {snapshot.summary.expiringSoonCount}
              </strong>
            </div>
            <div className="rounded border border-white/10 bg-black/25 p-3">
              <span className="text-xs uppercase text-slate-500">
                {locale === 'pl' ? 'Plecak' : 'Backpack'}
              </span>
              <strong className="block text-xl text-slate-200">
                {snapshot.summary.inventorySlotsUsed}/{snapshot.summary.inventoryCapacity}
              </strong>
            </div>
            <div className="flex items-center gap-2 rounded border border-white/10 bg-black/25 p-3">
              <button
                type="button"
                className="hud-utility-button flex-1"
                disabled={busy || snapshot.claims.length === 0 || !snapshot.claims.some((claim) => claim.capacity.canClaim)}
                onClick={() => void applyMutation(() => connection.claimAllRewards())}
              >
                {locale === 'pl' ? 'Odbierz wszystko możliwe' : 'Claim everything possible'}
              </button>
              <button
                type="button"
                className="hud-utility-button"
                disabled={busy}
                onClick={() => void refresh()}
              >
                {locale === 'pl' ? 'Odśwież' : 'Refresh'}
              </button>
            </div>
          </div>

          {mutationMessage() ? (
            <div
              className="rounded border border-emerald-400/30 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-100"
              role="status"
            >
              {mutationMessage()}
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2 rounded border border-white/10 bg-black/20 p-3">
            {filters.map((entry) => {
              const label =
                entry === 'ALL'
                  ? locale === 'pl'
                    ? 'Wszystkie'
                    : 'All'
                  : entry === 'EXPIRING'
                    ? locale === 'pl'
                      ? 'Wygasające'
                      : 'Expiring'
                    : sourceLabel(entry, locale);
              return (
                <button
                  key={entry}
                  type="button"
                  className={`hud-utility-button ${filter === entry ? 'ring-1 ring-amber-300/70' : ''}`}
                  onClick={() => setFilter(entry)}
                >
                  {label}
                </button>
              );
            })}
          </div>

          {visibleClaims.length === 0 ? (
            <div className="rounded border border-white/10 bg-black/20 py-16 text-center">
              <div className="text-4xl">◇</div>
              <p className="mt-3 text-sm text-slate-400">
                {snapshot.claims.length === 0
                  ? locale === 'pl'
                    ? 'Kolejka nagród jest pusta.'
                    : 'Your reward queue is empty.'
                  : locale === 'pl'
                    ? 'Brak nagród w wybranym filtrze.'
                    : 'No rewards match this filter.'}
              </p>
            </div>
          ) : (
            <div className="grid gap-4 xl:grid-cols-2">
              {visibleClaims.map((claim) => (
                <ClaimCard
                  key={claim.id}
                  claim={claim}
                  locale={locale}
                  busy={busy}
                  onClaim={(claimId) =>
                    void applyMutation(() => connection.claimReward(claimId))
                  }
                />
              ))}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
