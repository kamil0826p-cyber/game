import type { PortalTransitionState } from '../../game/state/gameStore';
import { useI18n } from '../../i18n/I18nProvider';

export function PortalTransition({ state }: { state: PortalTransitionState }): React.JSX.Element | null {
  const { t } = useI18n();
  if (state === 'idle') return null;
  return (
    <div className={`portal-transition portal-${state}`} aria-live="polite">
      <div className="text-center">
        <span className="loading-rune mx-auto mb-4 block size-10" />
        <p className="font-display text-xl text-amber-100">{t('game.portal')}</p>
      </div>
    </div>
  );
}
