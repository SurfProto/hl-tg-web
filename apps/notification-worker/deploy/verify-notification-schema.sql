select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'notification_preferences',
    'notification_channels',
    'notification_events',
    'notification_runtime_state'
  )
order by table_name;

select
  count(*) filter (where telegram_id is not null) as users_with_telegram_id,
  count(*) as total_users
from public.users;

select
  count(*) as notification_pref_rows
from public.notification_preferences;
