-- When an admin approves a competition request, the backend now auto-creates
-- the competition. These columns link the request to what was created so the
-- admin UI can surface the join code back to the venue.
ALTER TABLE competition_requests
  ADD COLUMN IF NOT EXISTS competition_id uuid REFERENCES competitions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS competition_code text;
