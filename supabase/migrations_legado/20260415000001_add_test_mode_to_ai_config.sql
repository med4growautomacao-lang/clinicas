ALTER TABLE ai_config
  ADD COLUMN IF NOT EXISTS test_mode_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS test_numbers text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS test_reset_phrase text NOT NULL DEFAULT '';
