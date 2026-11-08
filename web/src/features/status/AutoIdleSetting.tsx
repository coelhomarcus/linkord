import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/primitives/select';
import { SettingsRow } from '@/shared/ui/settings-layout';
import { AUTO_IDLE_OPTIONS, setAutoIdleMinutes, useAutoIdleMinutes, type AutoIdleMinutes } from './autoIdlePreference';

export function AutoIdleSetting() {
  const { t } = useTranslation('status');
  const minutes = useAutoIdleMinutes();
  const id = useId();
  const labelFor = (value: AutoIdleMinutes) => (value === 0 ? t('autoIdle.off') : t('autoIdle.minutes', { count: value }));
  return (
    <SettingsRow label={t('autoIdle.label')} description={t('autoIdle.description')} htmlFor={id}>
      <Select value={String(minutes)} onValueChange={(value) => { if (value != null) setAutoIdleMinutes(Number(value) as AutoIdleMinutes); }}>
        <SelectTrigger id={id} className="h-10 w-48 text-body">
          <SelectValue>{() => labelFor(minutes)}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {AUTO_IDLE_OPTIONS.map((value) => <SelectItem key={value} value={String(value)}>{labelFor(value)}</SelectItem>)}
        </SelectContent>
      </Select>
    </SettingsRow>
  );
}
