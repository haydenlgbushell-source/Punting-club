// Bet status and payout rules — ONE implementation shared by the browser and the
// Netlify functions, so every screen and the leaderboard agree.
//
// Status (from the legs):
//   lost         any leg lost (a multi is busted by one losing leg)
//   in_progress  any leg live
//   pending      any leg not yet settled
//   void         every leg void → stake refunded
//   won          every leg won or void (void legs reduce the odds)
//
// Money is in CENTS, matching the database.

const legsOf = (bet) => bet?.bet_legs || bet?.legs || [];

export function betStatus(legs, fallback = 'pending') {
  if (!legs || !legs.length) return fallback || 'pending';
  if (legs.some(l => l.status === 'lost')) return 'lost';
  if (legs.some(l => l.status === 'in_progress')) return 'in_progress';
  if (legs.some(l => l.status !== 'won' && l.status !== 'void')) return 'pending';
  if (legs.every(l => l.status === 'void')) return 'void';
  return 'won';
}

const num = (v) => { const n = parseFloat(String(v ?? '').replace(/[^0-9.]/g, '')); return isNaN(n) ? null : n; };

// Gross return (stake included) in cents for a bet from the DB/leaderboard.
//   { status, returnCents, reducedForVoids, exact }
// `exact` is false when void legs are missing odds, in which case the full
// estimated return is used and an admin may need to correct it.
export function betReturn(bet) {
  const legs = legsOf(bet);
  const status = betStatus(legs, bet?.overall_status || bet?.overallStatus);
  const stake = Math.round(num(bet?.stake) || 0);
  const est = Math.round(num(bet?.estimated_return ?? bet?.estimatedReturn) || 0);

  if (status === 'void') return { status, returnCents: stake, reducedForVoids: false, exact: true };
  if (status !== 'won') return { status, returnCents: 0, reducedForVoids: false, exact: true };

  const voids = legs.filter(l => l.status === 'void');
  if (!voids.length) return { status, returnCents: est, reducedForVoids: false, exact: true };

  // Preferred: stake × product of the winning legs' odds.
  const wonOdds = legs.filter(l => l.status === 'won').map(l => num(l.odds));
  if (stake > 0 && wonOdds.every(o => o && o >= 1)) {
    return { status, returnCents: Math.round(stake * wonOdds.reduce((a, b) => a * b, 1)), reducedForVoids: true, exact: true };
  }
  // Fallback: divide the estimated return by the void legs' odds.
  const voidOdds = voids.map(l => num(l.odds));
  if (est > 0 && voidOdds.every(o => o && o >= 1)) {
    return { status, returnCents: Math.round(est / voidOdds.reduce((a, b) => a * b, 1)), reducedForVoids: true, exact: true };
  }
  return { status, returnCents: est, reducedForVoids: true, exact: false };
}

// Status as stored in bets.overall_status. 'void' is stored as 'partial' to stay
// within the existing database values.
export function storedOverallStatus(legs) {
  const s = betStatus(legs);
  return s === 'void' ? 'partial' : s;
}

export const STATUS_LABEL = { won: 'WON', lost: 'LOST', void: 'REFUNDED', in_progress: 'LIVE', pending: 'PENDING' };
export const STATUS_SHORT = { won: 'W', lost: 'L', void: 'V', in_progress: '–', pending: '–' };
