import {
  useMemo,
  useState,
  type ChangeEvent,
  type FormEvent,
} from 'react';
import type { ClientNotification } from '../../game/state/gameStore';
import { useI18n } from '../../i18n/I18nProvider';
import { MOCK_CHAT_MESSAGES } from '../../mock/mockData';

type ChatTab = keyof typeof MOCK_CHAT_MESSAGES;
interface ChatMessage { author: string; text: string; tone: string; }

export function ChatPanel({ notifications }: { notifications: readonly ClientNotification[] }): React.JSX.Element {
  const { t } = useI18n();
  const [tab, setTab] = useState<ChatTab>('Global');
  const [input, setInput] = useState('');
  const [localMessages, setLocalMessages] = useState<ChatMessage[]>([]);
  const tabs: ChatTab[] = ['Global', 'Local', 'System'];
  const messages = useMemo(() => {
    const base = [...MOCK_CHAT_MESSAGES[tab]] as ChatMessage[];
    if (tab === 'Global') base.push(...localMessages);
    if (tab === 'System') {
      base.push(...notifications.slice(-4).map((notification) => ({ author: notification.code, text: notification.message, tone: 'warning' })));
    }
    return base;
  }, [localMessages, notifications, tab]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const text = input.trim();
    if (!text) return;
    setLocalMessages((current) => [...current.slice(-20), { author: 'You', text, tone: 'player' }]);
    setInput('');
    setTab('Global');
  };

  return (
    <section className="hud-panel pointer-events-auto flex h-[220px] w-[min(430px,calc(100vw-24px))] flex-col" aria-label="Chat mock">
      <nav className="flex border-b border-white/10 bg-slate-950/45">
        {tabs.map((candidate) => (
          <button key={candidate} type="button" onClick={() => setTab(candidate)} className={`chat-tab ${tab === candidate ? 'chat-tab-active' : ''}`}>
            {candidate === 'Global' ? t('chat.global') : candidate === 'Local' ? t('chat.local') : t('chat.system')}
          </button>
        ))}
        <span className="ml-auto self-center pr-3 text-[9px] uppercase tracking-wider text-amber-300/50">Mock</span>
      </nav>
      <div className="scrollbar-thin flex-1 space-y-1.5 overflow-y-auto p-3 text-xs">
        {messages.map((message, index) => (
          <p key={`${message.author}-${index}`} className="leading-5 text-slate-300">
            <strong className={message.tone === 'warning' ? 'text-amber-300' : message.tone === 'system' ? 'text-sky-300' : message.tone === 'npc' ? 'text-emerald-300' : 'text-violet-300'}>
              [{message.author}]
            </strong>{' '}{message.text}
          </p>
        ))}
      </div>
      <form onSubmit={submit} className="flex border-t border-white/10 bg-black/20 p-2">
        <input
          value={input}
          onChange={(event: ChangeEvent<HTMLInputElement>) =>
            setInput(event.target.value)
          }
          className="min-w-0 flex-1 bg-transparent px-2 text-xs text-slate-100 outline-none placeholder:text-slate-600"
          placeholder={t('chat.placeholder')}
          maxLength={160}
        />
        <button type="submit" className="rounded border border-amber-400/30 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-amber-200 hover:bg-amber-400/10">Send</button>
      </form>
    </section>
  );
}
