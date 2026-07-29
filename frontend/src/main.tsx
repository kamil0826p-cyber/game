import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { AuthProvider } from './auth/AuthProvider';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import './game/realtime/characterRosterClient';
import { I18nProvider } from './i18n/I18nProvider';
import './styles.css';
import './ui-refresh.css';
import './medieval-gold-theme.css';
import './outfit-navigation.css';
import './hud-tooltips.css';
import './combat.css';
import './combat-support-effects.css';

const root = document.getElementById('root');
if (!root) {
  throw new Error('The application root element is missing.');
}

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <I18nProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </I18nProvider>
    </ErrorBoundary>
  </StrictMode>,
);
