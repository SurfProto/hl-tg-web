import { useEffect, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { getCurrentUserRecord, supabase } from '../../lib/supabase';

type NotificationPrefs = {
  liquidation_alerts: boolean;
  order_fills: boolean;
  usdc_deposits: boolean;
};

const DEFAULT_PREFS: NotificationPrefs = {
  liquidation_alerts: true,
  order_fills: true,
  usdc_deposits: true,
};

export function NotificationsPage() {
  const { user } = usePrivy();
  const walletAddress = user?.wallet?.address;
  const [prefs, setPrefs] = useState<NotificationPrefs>(DEFAULT_PREFS);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const record = await getCurrentUserRecord(walletAddress);
      if (!record) return;
      setUserId(record.id);

      if (!supabase) return;
      const { data } = await supabase
        .from('notification_preferences')
        .select('liquidation_alerts, order_fills, usdc_deposits')
        .eq('user_id', record.id)
        .maybeSingle();

      if (data) {
        setPrefs({
          liquidation_alerts: data.liquidation_alerts,
          order_fills: data.order_fills,
          usdc_deposits: data.usdc_deposits,
        });
      }
    })();
  }, [walletAddress]);

  const updatePref = async (key: keyof NotificationPrefs) => {
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    if (!supabase || !userId) return;
    await supabase.from('notification_preferences').upsert({ user_id: userId, ...next }, { onConflict: 'user_id' });
  };

  return (
    <div className="min-h-full bg-background px-4 py-5 space-y-4">
      <h1 className="text-2xl font-bold text-foreground">Notifications</h1>
      <p className="text-sm text-muted">Notifications are sent through the Telegram bot linked to this app.</p>

      <div className="overflow-hidden rounded-2xl border border-separator bg-white shadow-sm">
        {([
          ['liquidation_alerts', 'Liquidation alerts'],
          ['order_fills', 'Order fills'],
          ['usdc_deposits', 'USDC deposits'],
        ] as const).map(([key, label], index) => (
          <button
            key={key}
            onClick={() => updatePref(key)}
            className={`flex w-full items-center justify-between px-4 py-4 text-left ${index < 2 ? 'border-b border-separator' : ''}`}
          >
            <span className="text-sm font-semibold text-foreground">{label}</span>
            <span className={`inline-flex h-7 w-12 items-center rounded-full p-1 transition-colors ${prefs[key] ? 'bg-primary justify-end' : 'bg-gray-200 justify-start'}`}>
              <span className="h-5 w-5 rounded-full bg-white shadow-sm" />
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
