import type { HTMLAttributes } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { Icon } from './Icon';

export function SortControls({
  name,
  index,
  count,
  disabled,
  handleProps,
  move,
}: {
  name: string;
  index: number;
  count: number;
  disabled: boolean;
  handleProps: HTMLAttributes<HTMLButtonElement>;
  move: (offset: number) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="sort-controls">
      <button
        type="button"
        className="icon-button sort-handle"
        tabIndex={-1}
        {...handleProps}
        draggable={count > 1 && handleProps.draggable}
        disabled={disabled || count < 2}
        aria-label={t('sort.drag', { name })}
        title={t('sort.drag', { name })}
      >
        <Icon name="grip" size={16} />
      </button>
      <button
        type="button"
        className="icon-button"
        disabled={disabled || index === 0}
        aria-label={t('sort.up', { name })}
        title={t('sort.up', { name })}
        onClick={() => move(-1)}
      >
        <Icon name="up" size={16} />
      </button>
      <button
        type="button"
        className="icon-button"
        disabled={disabled || index === count - 1}
        aria-label={t('sort.down', { name })}
        title={t('sort.down', { name })}
        onClick={() => move(1)}
      >
        <Icon name="down" size={16} />
      </button>
    </div>
  );
}
