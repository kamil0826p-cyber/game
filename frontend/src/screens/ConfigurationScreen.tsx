import { LocaleToggle } from '../components/common/LocaleToggle';
import { Panel } from '../components/common/Panel';
import { useI18n } from '../i18n/I18nProvider';

interface ConfigurationScreenProps {
  errors: string[];
}

export function ConfigurationScreen({ errors }: ConfigurationScreenProps): React.JSX.Element {
  const { t } = useI18n();
  return (
    <main className="auth-background flex h-dvh items-center justify-center overflow-y-auto p-6 text-slate-100">
      <Panel elevated className="w-full max-w-2xl p-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="eyebrow">Client configuration</p>
            <h1 className="font-display mt-2 text-3xl text-amber-100">
              {t('auth.configuration')}
            </h1>
          </div>
          <LocaleToggle />
        </div>
        <p className="mt-4 text-sm leading-6 text-slate-300">
          {t('auth.configurationHelp')}
        </p>
        <pre className="mt-6 overflow-auto rounded-lg border border-rose-500/30 bg-rose-950/30 p-4 text-xs text-rose-100">
          {errors.join('\n')}
        </pre>
      </Panel>
    </main>
  );
}
