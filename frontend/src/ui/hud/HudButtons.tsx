import { useEffect, useState } from 'react';
import type { TranslationKey } from '../../i18n/dictionaries';
import { useI18n } from '../../i18n/I18nProvider';
import {
  CLOSE_GUILD_WINDOW_EVENT,
  TOGGLE_GUILD_WINDOW_EVENT,
} from '../../game/guilds/guildUiEvents';
import { useGameConnection } from '../../game/realtime/GameConnectionProvider';
import {
  CLOSE_REWARD_CLAIMS_WINDOW_EVENT,
  REWARD_CLAIMS_INVALIDATED_EVENT,
  REWARD_CLAIMS_UPDATED_EVENT,
  TOGGLE_REWARD_CLAIMS_WINDOW_EVENT,
  type RewardClaimsUpdatedDetail,
} from '../../game/rewards/rewardClaimsUiEvents';
import { gameStore, useGameState, type ModalKey } from '../../game/state/gameStore';
import {
  CLOSE_SETTINGS_WINDOW_EVENT,
  TOGGLE_SETTINGS_WINDOW_EVENT,
} from '../settings/settingsUiEvents';

const buttons: Array<{
  key: Exclude<ModalKey, null> | 'guild' | 'rewards' | 'settings';
  icon: string;
  labelKey?: TranslationKey;
  hotkey: string;
}> = [
  { key: 'character', icon: '◆', labelKey: 'hud.character', hotkey: 'C' },
  { key: 'inventory', icon: '▦', labelKey: 'hud.inventory', hotkey: 'I' },
  { key: 'rewards', icon: '◇', hotkey: 'R' },
  { key: 'quests', icon: '▱', labelKey: 'hud.quests', hotkey: 'Q' },
  { key: 'skills', icon: '✦', labelKey: 'hud.skills', hotkey: 'K' },
  { key: 'guild', icon: '♜', hotkey: 'G' },
  { key: 'settings', icon: '⚙', hotkey: 'O' },
];

export function HudButtons(): React.JSX.Element {
  const { t, locale } = useI18n();
  const connection = useGameConnection();
  const state = useGameState();
  const [rewardCount, setRewardCount] = useState(0);
  const [expiringSoonCount, setExpiringSoonCount] = useState(0);

  useEffect(() => {
    const updated = (event: Event) => {
      const detail = (event as CustomEvent<RewardClaimsUpdatedDetail>).detail;
      if (!detail) return;
      setRewardCount(detail.count);
      setExpiringSoonCount(detail.expiringSoonCount);
    };
    const refresh = () => {
      if (state.phase !== 'in-world' || !state.socketConnected) return;
      void connection.getRewardClaims().catch(() => undefined);
    };
    window.addEventListener(REWARD_CLAIMS_UPDATED_EVENT, updated);
    window.addEventListener(REWARD_CLAIMS_INVALIDATED_EVENT, refresh);
    refresh();
    const interval = window.setInterval(refresh, 30_000);
    return () => {
      window.removeEventListener(REWARD_CLAIMS_UPDATED_EVENT, updated);
      window.removeEventListener(REWARD_CLAIMS_INVALIDATED_EVENT, refresh);
      window.clearInterval(interval);
    };
  }, [connection, state.phase, state.socketConnected]);

  return (
    <nav className="hud-panel hud-tooltip-container pointer-events-auto flex flex-col gap-1.5 p-2" aria-label="HUD windows">
      {buttons.map((button) => {
        const label =
          button.key === 'guild'
            ? locale === 'pl'
              ? 'Gildia'
              : 'Guild'
            : button.key === 'rewards'
              ? locale === 'pl'
                ? 'Kolejka nagród'
                : 'Reward queue'
              : button.key === 'settings'
                ? locale === 'pl'
                  ? 'Ustawienia'
                  : 'Settings'
                : t(button.labelKey!);
        return (
          <button
            key={button.key}
            type="button"
            className="hud-window-button hud-tooltip-anchor relative"
            onClick={() => {
              if (button.key === 'settings') {
                window.dispatchEvent(new Event(CLOSE_GUILD_WINDOW_EVENT));
                window.dispatchEvent(new Event(CLOSE_REWARD_CLAIMS_WINDOW_EVENT));
                window.dispatchEvent(new Event(TOGGLE_SETTINGS_WINDOW_EVENT));
              } else if (button.key === 'guild') {
                window.dispatchEvent(new Event(CLOSE_SETTINGS_WINDOW_EVENT));
                window.dispatchEvent(new Event(CLOSE_REWARD_CLAIMS_WINDOW_EVENT));
                window.dispatchEvent(new Event(TOGGLE_GUILD_WINDOW_EVENT));
              } else if (button.key === 'rewards') {
                window.dispatchEvent(new Event(CLOSE_SETTINGS_WINDOW_EVENT));
                window.dispatchEvent(new Event(CLOSE_GUILD_WINDOW_EVENT));
                gameStore.setActiveModal(null);
                window.dispatchEvent(new Event(TOGGLE_REWARD_CLAIMS_WINDOW_EVENT));
              } else {
                window.dispatchEvent(new Event(CLOSE_SETTINGS_WINDOW_EVENT));
                window.dispatchEvent(new Event(CLOSE_GUILD_WINDOW_EVENT));
                window.dispatchEvent(new Event(CLOSE_REWARD_CLAIMS_WINDOW_EVENT));
                gameStore.setActiveModal(button.key);
              }
            }}
            aria-label={`${label} (${button.hotkey})`}
          >
            <span>{button.icon}</span><kbd>{button.hotkey}</kbd>
            {button.key === 'rewards' && rewardCount > 0 ? (
              <span
                className={`absolute -right-1.5 -top-1.5 min-w-5 rounded-full px-1 text-center text-[10px] font-bold leading-5 ${
                  expiringSoonCount > 0
                    ? 'bg-red-600 text-white'
                    : 'bg-amber-400 text-slate-950'
                }`}
                aria-label={
                  locale === 'pl'
                    ? `${rewardCount} nagród, ${expiringSoonCount} wkrótce wygasa`
                    : `${rewardCount} rewards, ${expiringSoonCount} expiring soon`
                }
              >
                {rewardCount > 99 ? '99+' : rewardCount}
              </span>
            ) : null}
            <span className="hud-tooltip-bubble hud-tooltip-bubble-left" role="tooltip">
              <span>
                {label}
                {button.key === 'rewards' && rewardCount > 0 ? ` (${rewardCount})` : ''}
              </span><kbd>{button.hotkey}</kbd>
            </span>
          </button>
        );
      })}
    </nav>
  );
}
