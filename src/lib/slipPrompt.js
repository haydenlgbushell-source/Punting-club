// Prompt used to read bet-slip images. Shared by the app and scripts/compare-haiku.mjs
// so model comparisons test exactly what production sends.
export const buildSlipPrompt = (imgCount) => `You are given ${imgCount} bet slip image${imgCount > 1 ? 's' : ''}. They are parts of ONE bet — combine EVERY leg from ALL images into a single JSON bet. Return JSON only, no other text:
{"betType":"Multi","stake":"$50.00","combinedOdds":"3.50","estimatedReturn":"$175.00","submissionValid":true,"legs":[{"legNumber":1,"event":"Melbourne Storm vs Penrith Panthers","selection":"Melbourne Storm","market":"Head to Head","odds":"2.10","eventDate":"YYYY-MM-DD","startTime":"HH:MM","status":"pending","sport":"rugby_league","competition":"NRL","homeTeam":"Melbourne Storm","awayTeam":"Penrith Panthers","marketType":"head_to_head","line":null,"player":null,"venue":null,"raceNumber":null,"runnerNumber":null}]}
Rules:
- Include one leg object for EVERY selection across all images; number legNumber sequentially from 1.
- eventDate: the date the MATCH/RACE is played — NOT the slip print date. Use the date next to each leg. YYYY-MM-DD, assume current year if missing.
- startTime: start time per leg in 24h HH:MM as shown on the slip (Australian local time), or null if not shown.
- stake/combinedOdds/estimatedReturn: the overall bet totals (usually the "Potential"/payout figure). Include $ on money; odds as decimals.
- status: pending/won/lost/void.
- submissionValid: true if bet was placed before first leg started.
- sport: one of rugby_league, afl, cricket, soccer, rugby_union, basketball, tennis, nfl, combat, horse_racing, harness, greyhounds, or another lowercase word.
- competition: e.g. NRL, AFL, BBL, EPL, A-League, NBA, or the race meeting name.
- homeTeam/awayTeam: full team (or player) names for matches; null for races.
- marketType: one of head_to_head, line, total, anytime_scorer, first_scorer, win, place, other.
- line: the handicap or total number as a signed decimal (e.g. -6.5, 42.5), else null.
- player: the player's full name for scorer/player markets, else null.
- venue/raceNumber/runnerNumber: for races only (e.g. "Flemington", 7, 4), else null.`;
