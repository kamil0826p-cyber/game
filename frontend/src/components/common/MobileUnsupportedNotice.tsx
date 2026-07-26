import { useEffect, useState } from 'react';
import { useI18n } from '../../i18n/I18nProvider';

const MOBILE_QUERY = '(max-width: 767px)';

export function MobileUnsupportedNotice(): React.JSX.Element | null {
  const { t } = useI18n();
  const [isMobile, setIsMobile] = useState(() => window.matchMedia(MOBILE_QUERY).matches);

  useEffect(() => {
    const mediaQuery = window.matchMedia(MOBILE_QUERY);
    const update = () => setIsMobile(mediaQuery.matches);
    mediaQuery.addEventListener('change', update);
    return () => mediaQuery.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (!isMobile) return;

    const blockKeyboardInput = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopImmediatePropagation();
    };

    window.addEventListener('keydown', blockKeyboardInput, true);
    window.addEventListener('keyup', blockKeyboardInput, true);
    return () => {
      window.removeEventListener('keydown', blockKeyboardInput, true);
      window.removeEventListener('keyup', blockKeyboardInput, true);
    };
  }, [isMobile]);

  if (!isMobile) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/95 p-6 text-center text-slate-100">
      <section className="w-full max-w-sm rounded-2xl border border-amber-400/40 bg-slate-900 p-6 shadow-2xl shadow-black/60">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-amber-300">
          Elderglen Online
        </p>
        <h2 className="font-display mt-3 text-3xl text-amber-100">
          {t('game.mobileUnsupportedTitle')}
        </h2>
        <p className="mt-4 text-sm leading-6 text-slate-300">
          {t('game.mobileUnsupportedMessage')}
        </p>
      </section>
    </div>
  );
}
