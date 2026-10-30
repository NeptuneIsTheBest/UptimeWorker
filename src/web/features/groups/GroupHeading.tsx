import { Icon } from '../../components/Icon';
import { useI18n } from '../../i18n/I18nProvider';
import { number } from '../../lib/format';

export function GroupHeading({
  name,
  count,
  collapsed,
  controls,
  toggle,
  variant,
  disabled = false,
  filtering = false,
}: {
  name: string;
  count: number;
  collapsed: boolean;
  controls: string;
  toggle: () => void;
  variant: 'public' | 'admin';
  disabled?: boolean;
  filtering?: boolean;
}) {
  const { t, locale } = useI18n();
  const Heading = variant === 'public' ? 'h3' : 'h2';
  return (
    <Heading className={variant === 'public' ? 'group-heading' : 'admin-group-heading'}>
      <button
        type="button"
        className="group-toggle"
        aria-expanded={!collapsed}
        aria-controls={controls}
        aria-label={t(collapsed ? 'groups.expand' : 'groups.collapse', { name })}
        aria-describedby={filtering ? `${controls}-filter-note` : undefined}
        disabled={disabled || filtering}
        onClick={toggle}
      >
        <Icon name="chevron" size={16} className="group-chevron" />
        <span className="group-title">{name}</span>
        <span className="count-badge">{number(count, locale)}</span>
      </button>
      {filtering && (
        <span className="group-filter-note" id={`${controls}-filter-note`}>
          {t('groups.filterExpanded')}
        </span>
      )}
    </Heading>
  );
}
