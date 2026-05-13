import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { setI18nLocale, isSupportedLocale } from '@/ui/i18n';

export function useLocale() {
  const { locale, t } = useI18n();

  const currentLocale = computed(() => locale.value);

  async function setLocale(newLocale: string): Promise<void> {
    if (!isSupportedLocale(newLocale)) return;
    await setI18nLocale(newLocale);
    try {
      const raw = localStorage.getItem('aga_user_settings');
      const parsed = raw ? JSON.parse(raw) : null;
      const settings = (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
        ? parsed as Record<string, unknown>
        : {};
      settings.language = newLocale;
      localStorage.setItem('aga_user_settings', JSON.stringify(settings));
    } catch { /* localStorage unavailable */ }
    window.location.reload();
  }

  function formatDate(date: Date | string | number, style: 'short' | 'long' = 'short'): string {
    const d = new Date(date);
    if (isNaN(d.getTime())) return t('common.fallback.unknownTime');
    const opts: Intl.DateTimeFormatOptions = style === 'long'
      ? { year: 'numeric', month: 'long', day: '2-digit', hour: '2-digit', minute: '2-digit' }
      : { year: 'numeric', month: '2-digit', day: '2-digit' };
    return d.toLocaleDateString(locale.value, opts);
  }

  function formatTime(date: Date | string | number): string {
    const d = new Date(date);
    if (isNaN(d.getTime())) return t('common.fallback.unknownTime');
    return d.toLocaleTimeString(locale.value, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }

  function formatDateTime(date: Date | string | number): string {
    const d = new Date(date);
    if (isNaN(d.getTime())) return t('common.fallback.unknownTime');
    return d.toLocaleString(locale.value);
  }

  function formatRelativeTime(date: Date | string | number): string {
    const d = new Date(date);
    if (isNaN(d.getTime())) return t('common.time.neverSaved');
    const diff = Date.now() - d.getTime();
    if (diff <= 0) return t('common.time.justNow');
    const minutes = Math.floor(diff / 60_000);
    const hours = Math.floor(diff / 3_600_000);
    const days = Math.floor(diff / 86_400_000);

    if (minutes < 1) return t('common.time.justNow');
    if (minutes < 60) return t('common.time.minutesAgo', { n: minutes });
    if (hours < 24) return t('common.time.hoursAgo', { n: hours });
    return t('common.time.daysAgo', { n: days });
  }

  return {
    locale: currentLocale,
    setLocale,
    formatDate,
    formatTime,
    formatDateTime,
    formatRelativeTime,
  };
}
