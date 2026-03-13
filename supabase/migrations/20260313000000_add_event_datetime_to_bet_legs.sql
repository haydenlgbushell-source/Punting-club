-- Add event date and start time columns to bet_legs
ALTER TABLE bet_legs
  ADD COLUMN IF NOT EXISTS event_date  date,
  ADD COLUMN IF NOT EXISTS start_time  text;
