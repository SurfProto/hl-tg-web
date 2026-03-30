import { useEffect, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { getCurrentUserRecord, supabase } from '../../lib/supabase';

const LANGUAGE_KEY = 'hl-tma-language';

export function LanguagePage() {
  const { user } = usePrivy();
  const [language, setLanguage] = useState(() => localStorage.getItem(LANGUAGE_KEY) ?? 'en');

  useEffect(() => {
    localStorage.setItem(LANGUAGE_KEY, language);

    void (async () => {
      const record = await getCurrentUserRecord(user?.wallet?.address);
      if (!record || !supabase) return;
      await supabase.from('users').update({ language }).eq('id', record.id);
    })();
  }, [language, user?.wallet?.address]);

  return (
    <div className="min-h-full bg-background px-4 py-5 space-y-4">
      <h1 className="text-2xl font-bold text-foreground">Language</h1>
      <div className="space-y-3">
        {([
          { key: 'en', label: 'English' },
          { key: 'es', label: 'Español' },
          { key: 'zh', label: '中文' },
        ] as const).map((option) => (
          <button
            key={option.key}
            onClick={() => setLanguage(option.key)}
            className={`flex w-full items-center justify-between rounded-2xl border px-4 py-4 text-left shadow-sm transition-colors ${
              language === option.key
                ? 'border-primary bg-blue-50'
                : 'border-separator bg-white'
            }`}
          >
            <span className="text-sm font-semibold text-foreground">{option.label}</span>
            <span className={`h-4 w-4 rounded-full border ${language === option.key ? 'border-primary bg-primary' : 'border-gray-300 bg-white'}`} />
          </button>
        ))}
      </div>
    </div>
  );
}
