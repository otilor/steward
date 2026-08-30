# Local memory schema (SQLite)

- `kv` — book, book_place, prayer_theme, study_topic, startup_north_star, week_bet, wake_hour, wake_minute, recap_hour, recap_minute, last_heard_at
- `messages` — chat thread (role, content, created_at)
- `day_plans` — one JSON plan per `date` (YYYY-MM-DD)
- `check_ins` — pending/answered check-ins tied to a plan block
- `recaps` — kept, slipped, tomorrow_first per date
- `refusals` — suggestions they declined
