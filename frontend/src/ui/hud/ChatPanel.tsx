import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from 'react';
import type { ChatChannel, ChatMessagePayload } from '../../contracts/socket';
import { useGameConnection } from '../../game/realtime/GameConnectionProvider';
import type { ClientNotification } from '../../game/state/gameStore';
import { useI18n } from '../../i18n/I18nProvider';

type ChatTab = 'Global' | 'Local' | 'System';

export function ChatPanel({ notifications }: { notifications: readonly ClientNotification[] }): React.JSX.Element {
  const { t } = useI18n();
  const connection = useGameConnection();
  const [tab, setTab] = useState<ChatTab>('Global');
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [messages, setMessages] = useState<ChatMessagePayload[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const tabs: ChatTab[] = ['Global', 'Local', 'System'];

  useEffect(() => connection.subscribeChat((message) => {
    setMessages((current) => [...current.slice(-99), message]);
  }), [connection]);

  const visibleMessages = useMemo(() => {
    if (tab === 'System') {
      return notifications.slice(-30).map((notification) => ({
        id: notification.id,
        author: notification.code,
        text: notification.message,
        tone: 'warning' as const,
      }));
    }
    const channel: ChatChannel = tab === 'Global' ? 'GLOBAL' : 'LOCAL';
    return messages.filter((message) => message.channel === channel).map((message) => ({
      id: message.id,
      author: message.author,
      text: message.text,
      tone: message.channel === 'LOCAL' ? ('local' as const) : ('player' as const),
    }));
  }, [messages, notifications, tab]);

  useEffect(() => {
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [visibleMessages]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const text = input.trim();
    if (!text || sending || tab === 'System') return;
    setSending(true);
    try {
      await connection.sendChat(tab === 'Local' ? 'LOCAL' : 'GLOBAL', text);
      setInput('');
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="hud-panel chat-console pointer-events-auto flex h-[230px] w-[min(440px,calc(100vw-40px))] flex-col" aria-label="Chat">
      <header className="chat-console-header">
        <div><i /><span>Comms</span></div>
        <small>Live network</small>
      </header>
      <nav className="flex border-b border-white/5">
        {tabs.map((candidate) => (
          <button key={candidate} type="button" onClick={() => setTab(candidate)} className={`chat-tab ${tab === candidate ? 'chat-tab-active' : ''}`}>
            {candidate === 'Global' ? t('chat.global') : candidate === 'Local' ? t('chat.local') : t('chat.system')}
          </button>
        ))}
      </nav>
      <div ref={scrollRef} className="scrollbar-thin flex-1 space-y-1.5 overflow-y-auto px-3 py-2 text-xs">
        {visibleMessages.length === 0 ? <p className="chat-empty">No transmissions received.</p> : visibleMessages.map((message) => (
          <p key={message.id} className="chat-message">
            <strong data-tone={message.tone}>{message.author}</strong><span>{message.text}</span>
          </p>
        ))}
      </div>
      <form onSubmit={(event) => void submit(event)} className="chat-compose">
        <span>&gt;</span>
        <input value={input} onChange={(event: ChangeEvent<HTMLInputElement>) => setInput(event.target.value)} placeholder={tab === 'System' ? 'System channel is read-only' : t('chat.placeholder')} maxLength={160} disabled={tab === 'System' || sending} />
        <button type="submit" disabled={tab === 'System' || sending || input.trim().length === 0}>{sending ? '...' : 'SEND'}</button>
      </form>
    </section>
  );
}
