import { useI18n } from '../i18n/I18nProvider';

interface LoadingScreenProps {
  message?: string;
}

export function LoadingScreen({ message }: LoadingScreenProps): React.JSX.Element {
  const { t } = useI18n();
  return (
    <main className="auth-background flex min-h-screen items-center justify-center p-6 text-slate-100">
      <section className="fantasy-panel w-full max-w-md p-8 text-center">
        <div className="mx-auto mb-5 grid size-20 place-items-center rounded-full border border-amber-300/30 bg-amber-500/5">
          <span className="loading-rune size-10" aria-hidden="true" />
        </div>
        <h1 className="font-display text-2xl text-amber-100">{t('app.title')}</h1>
        <p className="mt-3 text-sm text-slate-300">{message ?? t('common.loading')}</p>
      </section>
    </main>
  );
}
