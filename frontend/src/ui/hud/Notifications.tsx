import { useEffect } from 'react';
import { gameStore, type ClientNotification } from '../../game/state/gameStore';

function NotificationToast({ notification }: { notification: ClientNotification }): React.JSX.Element {
  useEffect(() => {
    const timer = window.setTimeout(() => gameStore.dismissNotification(notification.id), 5_000);
    return () => window.clearTimeout(timer);
  }, [notification.id]);
  return (
    <button type="button" onClick={() => gameStore.dismissNotification(notification.id)} className="notification-toast text-left">
      <strong>{notification.code.replaceAll('_', ' ')}</strong><span>{notification.message}</span>
    </button>
  );
}

export function Notifications({ notifications }: { notifications: readonly ClientNotification[] }): React.JSX.Element {
  return (
    <div className="pointer-events-auto fixed left-1/2 top-24 z-40 flex w-[min(420px,calc(100vw-24px))] -translate-x-1/2 flex-col gap-2">
      {notifications.slice(-3).map((notification) => <NotificationToast key={notification.id} notification={notification} />)}
    </div>
  );
}
