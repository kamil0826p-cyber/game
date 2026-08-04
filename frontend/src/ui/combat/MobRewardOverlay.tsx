import { useEffect, useState } from 'react';
import { ItemTooltip, rarityClasses } from '../../components/common/ItemTooltip';
import type { MobRewardPayload } from '../../contracts/mob';
import { MOB_REWARD_EVENT } from '../../game/realtime/mobSocketBridge';
import { useI18n } from '../../i18n/I18nProvider';

export function MobRewardOverlay(): React.JSX.Element | null {
  const { locale } = useI18n();
  const [reward, setReward] = useState<MobRewardPayload>();

  useEffect(() => {
    const show = (event: Event) => {
      const detail = (event as CustomEvent<MobRewardPayload>).detail;
      if (detail) setReward(detail);
    };
    window.addEventListener(MOB_REWARD_EVENT, show);
    return () => window.removeEventListener(MOB_REWARD_EVENT, show);
  }, []);

  if (!reward) return null;
  const hasLoot = reward.loot.length > 0;

  return (
    <div className="pointer-events-auto fixed inset-0 z-[90] grid place-items-center bg-black/70 p-4 backdrop-blur-sm">
      <section className="w-full max-w-xl rounded-md border border-amber-300/40 bg-slate-950/[0.98] p-5 text-slate-100 shadow-2xl">
        <header className="text-center">
          <span className="text-3xl">♛</span>
          <h2 className="mt-1 font-serif text-2xl text-amber-200">
            {locale === 'pl' ? 'Zwycięstwo' : 'Victory'}
          </h2>
          <p className="mt-1 text-sm text-slate-400">{reward.mobName}</p>
        </header>

        <div className="mt-5 grid grid-cols-3 gap-2 text-center text-xs">
          <div className="rounded border border-white/10 bg-white/5 p-3">
            <strong className="block text-lg text-amber-200">+{reward.experienceGained}</strong>
            <span className="text-slate-400">XP</span>
          </div>
          <div className="rounded border border-white/10 bg-white/5 p-3">
            <strong className="block text-lg text-emerald-300">+{reward.levelsGained}</strong>
            <span className="text-slate-400">{locale === 'pl' ? 'poziomy' : 'levels'}</span>
          </div>
          <div className="rounded border border-white/10 bg-white/5 p-3">
            <strong className="block text-lg text-sky-300">+{reward.skillPointsGained}</strong>
            <span className="text-slate-400">{locale === 'pl' ? 'punkty skilli' : 'skill points'}</span>
          </div>
        </div>

        <h3 className="mt-5 text-xs font-bold uppercase tracking-[0.18em] text-amber-200">
          {locale === 'pl' ? 'Zdobyte przedmioty' : 'Loot received'}
        </h3>
        <div className="mt-2 space-y-2">
          {!hasLoot ? (
            <p className="rounded border border-white/10 bg-black/20 p-4 text-center text-sm text-slate-400">
              {locale === 'pl' ? 'Tym razem nic nie wypadło.' : 'No items dropped this time.'}
            </p>
          ) : null}
          {reward.loot.map((item, index) => (
            <ItemTooltip
              key={`${item.itemKey}:${index}`}
              item={item}
              currentLevel={reward.self.level}
            >
              <div className={`flex items-center gap-3 rounded border bg-black/30 p-3 ${rarityClasses(item.rarity)}`}>
                <span className="text-2xl">{item.icon}</span>
                <div className="min-w-0 flex-1">
                  <strong className="block truncate">{item.name}</strong>
                  <p className="text-xs text-slate-400">
                    {locale === 'pl' ? 'Ilość' : 'Quantity'}: {item.quantity}
                  </p>
                </div>
                {item.equipmentSlot && item.minimumLevel > reward.self.level ? (
                  <span className="text-xs font-bold text-red-300">
                    Lv. {item.minimumLevel}
                  </span>
                ) : null}
              </div>
            </ItemTooltip>
          ))}
        </div>

        {reward.claimQueuedLoot.length > 0 ? (
          <div className="mt-3 rounded border border-sky-400/30 bg-sky-950/30 p-3 text-xs text-sky-100">
            <strong className="block">
              {locale === 'pl'
                ? 'Pełny ekwipunek — łup zapisany do odbioru'
                : 'Inventory full — loot saved for claim'}
            </strong>
            <p className="mt-1 text-sky-200/80">
              {locale === 'pl'
                ? 'Żaden przedmiot nie przepadł. Zwolnij miejsce i odbierz go z kolejki nagród.'
                : 'No item was lost. Free inventory space and collect it from the reward queue.'}
            </p>
            <ul className="mt-2 space-y-1">
              {reward.claimQueuedLoot.map((item, index) => (
                <ItemTooltip
                  key={`${item.itemKey}:claim:${index}`}
                  item={item}
                  currentLevel={reward.self.level}
                >
                  <li className={`rounded border bg-black/20 px-2 py-1 ${rarityClasses(item.rarity)}`}>
                    {item.icon} {item.name} ×{item.quantity}
                  </li>
                </ItemTooltip>
              ))}
            </ul>
          </div>
        ) : null}

        {reward.skippedLoot.length > 0 ? (
          <p className="mt-3 rounded border border-red-400/30 bg-red-950/30 p-3 text-xs text-red-200">
            {locale === 'pl'
              ? 'Nie udało się rozliczyć części łupu. Zgłoś ten przypadek administracji.'
              : 'Some loot could not be settled. Please report this case to an administrator.'}
          </p>
        ) : null}

        <button
          type="button"
          className="combat-primary-button mx-auto mt-5 block"
          onClick={() => setReward(undefined)}
        >
          {locale === 'pl' ? 'Zamknij' : 'Close'}
        </button>
      </section>
    </div>
  );
}
