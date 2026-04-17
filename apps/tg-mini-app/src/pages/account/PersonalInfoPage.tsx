import { useEffect, useState } from 'react';
import { usePrivy, useToken, useWallets } from '@privy-io/react-auth';
import { useTranslation } from 'react-i18next';
import { useHaptics } from '../../hooks/useHaptics';
import { fetchProfile, updateProfile } from '../../lib/profile';

export function PersonalInfoPage() {
  const haptics = useHaptics();
  const { t } = useTranslation();
  const privy = usePrivy() as any;
  const { getAccessToken } = useToken();
  const { user } = privy;
  const { wallets } = useWallets();
  const walletAddress = user?.wallet?.address ?? wallets[0]?.address;
  const [username, setUsername] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        setUsername(user?.telegram?.username ?? '');
        return;
      }

      try {
        const { profile } = await fetchProfile(accessToken);
        setUsername(profile.username ?? user?.telegram?.username ?? '');
      } catch {
        setUsername(user?.telegram?.username ?? '');
      }
    })();
  }, [getAccessToken, user?.telegram?.username, walletAddress]);

  const saveUsername = async () => {
    const accessToken = await getAccessToken();
    if (!accessToken) return;
    setSaving(true);
    let saved = false;
    try {
      await updateProfile(accessToken, { username });
      saved = true;
    } finally {
      setSaving(false);
    }
    if (saved) haptics.success();
  };

  return (
    <div className="min-h-full bg-background px-4 py-5 space-y-4">
      <h1 className="text-2xl font-bold text-foreground">{t('personalInfo.title')}</h1>

      <div className="rounded-2xl border border-separator bg-white p-4 shadow-sm space-y-4">
        <div>
          <p className="text-xs text-muted">{t('personalInfo.walletAddress')}</p>
          <div className="mt-2 flex items-center justify-between gap-3 rounded-2xl bg-surface px-4 py-3">
            <span className="font-mono text-sm text-foreground break-all">{walletAddress ?? t('personalInfo.noWallet')}</span>
            <button
              type="button"
              onClick={async () => {
                if (!walletAddress) return;
                await navigator.clipboard.writeText(walletAddress);
                haptics.success();
              }}
              className="flex-shrink-0 rounded-full bg-white px-4 py-2 text-sm font-semibold text-foreground border border-separator"
            >
              {t('common.copy')}
            </button>
          </div>
        </div>

        <div>
          <label htmlFor="personal-username" className="text-xs text-muted">{t('personalInfo.username')}</label>
          <div className="mt-2 flex gap-2">
            <input
              id="personal-username"
              name="username"
              value={username}
              spellCheck={false}
              autoCapitalize="none"
              autoComplete="off"
              onChange={(event) => setUsername(event.target.value)}
              placeholder={t('personalInfo.usernamePlaceholder')}
              className="flex-1 rounded-2xl border border-separator bg-surface px-4 py-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            />
            <button type="button" onClick={saveUsername} disabled={saving} className="rounded-2xl bg-primary px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">
              {saving ? t('common.saving') : t('common.save')}
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-muted">{t('personalInfo.email')}</p>
            <p className="mt-1 text-sm text-foreground">{user?.email?.address ?? t('common.notLinked')}</p>
          </div>
          {!user?.email?.address && (
            <button type="button" onClick={() => privy.linkEmail?.()} className="rounded-full bg-surface px-4 py-2 text-sm font-semibold text-foreground">
              {t('common.add')}
            </button>
          )}
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-muted">{t('personalInfo.phone')}</p>
            <p className="mt-1 text-sm text-foreground">{user?.phone?.number ?? t('common.notLinked')}</p>
          </div>
          {!user?.phone?.number && (
            <button type="button" onClick={() => privy.linkPhone?.()} className="rounded-full bg-surface px-4 py-2 text-sm font-semibold text-foreground">
              {t('common.add')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
