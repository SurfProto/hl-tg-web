import { useEffect, useState } from 'react';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { useHaptics } from '../../hooks/useHaptics';
import { getCurrentUserRecord, supabase } from '../../lib/supabase';

export function PersonalInfoPage() {
  const haptics = useHaptics();
  const privy = usePrivy() as any;
  const { user } = privy;
  const { wallets } = useWallets();
  const walletAddress = user?.wallet?.address ?? wallets[0]?.address;
  const [username, setUsername] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      const record = await getCurrentUserRecord(walletAddress);
      setUsername(record?.username ?? user?.telegram?.username ?? '');
    })();
  }, [user?.telegram?.username, walletAddress]);

  const saveUsername = async () => {
    if (!supabase || !walletAddress) return;
    setSaving(true);
    const { error } = await supabase.from('users').update({ username }).eq('wallet_address', walletAddress);
    setSaving(false);
    if (!error) haptics.success();
  };

  return (
    <div className="min-h-full bg-background px-4 py-5 space-y-4">
      <h1 className="text-2xl font-bold text-foreground">Personal information</h1>

      <div className="rounded-2xl border border-separator bg-white p-4 shadow-sm space-y-4">
        <div>
          <p className="text-xs text-muted">Wallet address</p>
          <div className="mt-2 flex items-center justify-between gap-3 rounded-2xl bg-surface px-4 py-3">
            <span className="font-mono text-sm text-foreground break-all">{walletAddress ?? 'No wallet connected'}</span>
            <button
              type="button"
              onClick={async () => {
                if (!walletAddress) return;
                await navigator.clipboard.writeText(walletAddress);
                haptics.success();
              }}
              className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-foreground border border-separator"
            >
              Copy
            </button>
          </div>
        </div>

        <div>
          <label htmlFor="personal-username" className="text-xs text-muted">Username</label>
          <div className="mt-2 flex gap-2">
            <input
              id="personal-username"
              name="username"
              value={username}
              spellCheck={false}
              autoCapitalize="none"
              autoComplete="off"
              onChange={(event) => setUsername(event.target.value)}
              placeholder="@username"
              className="flex-1 rounded-2xl border border-separator bg-surface px-4 py-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            />
            <button type="button" onClick={saveUsername} disabled={saving || !walletAddress} className="rounded-2xl bg-primary px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-muted">Email</p>
            <p className="mt-1 text-sm text-foreground">{user?.email?.address ?? 'Not linked'}</p>
          </div>
          {!user?.email?.address && (
            <button type="button" onClick={() => privy.linkEmail?.()} className="rounded-full bg-surface px-4 py-2 text-sm font-semibold text-foreground">
              Add
            </button>
          )}
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-muted">Phone</p>
            <p className="mt-1 text-sm text-foreground">{user?.phone?.number ?? 'Not linked'}</p>
          </div>
          {!user?.phone?.number && (
            <button type="button" onClick={() => privy.linkPhone?.()} className="rounded-full bg-surface px-4 py-2 text-sm font-semibold text-foreground">
              Add
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
