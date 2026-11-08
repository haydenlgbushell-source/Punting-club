import React from 'react';
import { formatCutoff } from '../../lib/auTime.js';
import { Trophy, XCircle, Clock, ChevronLeft } from 'lucide-react';
import SwitcherDropdown from '../SwitcherDropdown.jsx';
import WeeklyRecapCard from '../WeeklyRecapCard.jsx';
import { useApp } from '../../context/AppContext.jsx';
import { Page, PageHeader, BackButton, Card, CardTitle, RankBadge, Countdown } from '../ui.jsx';

const WeeklySummaryView = () => {
  const {
    isLoggedIn, navHistory, goBack,
    activeCompetitions, effectiveViewedCode, switchViewedCompetition,
    teamsInViewedComp, viewedMyTeam, switchViewedTeam,
    leaderboardTeams, myTeamName, currentWeekNum, nextWedCutoff,
    currentBettor,
  } = useApp();

  const comp       = activeCompetitions.find(c => c.code === effectiveViewedCode);
  const totalWeeks = comp?.weeks || 8;
  const thisWeek   = currentWeekNum + 1;
  const prevWeek   = thisWeek - 1;

  const prevWeekData = leaderboardTeams.map(t => {
    const bet = (t.bets || []).find(b => b.weekNumber === prevWeek) || null;
    return { team: t, bet, isMyTeam: t.team === myTeamName };
  });
  const prevBetsSubmitted = prevWeekData.filter(d => d.bet);
  const prevWinners       = prevBetsSubmitted.filter(d => d.bet.overallStatus === 'won');
  const prevLosers        = prevBetsSubmitted.filter(d => d.bet.overallStatus === 'lost');
  const prevPending       = prevBetsSubmitted.filter(d => !['won', 'lost', 'void'].includes(d.bet.overallStatus));
  const prevSettledCount  = prevWinners.length + prevLosers.length;
  const prevWinRate       = prevSettledCount > 0 ? Math.round((prevWinners.length / prevSettledCount) * 100) : null;

  const bestPrevWin = prevWinners
    .slice().sort((a, b) => parseFloat((b.bet.actualReturn || b.bet.estimatedReturn || '0').replace(/[^0-9.]/g, '')) - parseFloat((a.bet.actualReturn || a.bet.estimatedReturn || '0').replace(/[^0-9.]/g, '')))[0];

  const myPrevData = prevWeekData.find(d => d.isMyTeam);

  const allThisWeekBets = leaderboardTeams.flatMap(t =>
    (t.bets || []).filter(b => b.weekNumber === thisWeek)
  );
  const teamsNoBet = leaderboardTeams.filter(t => !(t.bets || []).some(b => b.weekNumber === thisWeek));
  const cutoffStr  = formatCutoff(nextWedCutoff);

  const totalWinnings = leaderboardTeams.reduce((sum, t) => sum + parseFloat((t.total || '$0').replace(/[^0-9.]/g, '')) || 0, 0);
  const leader = leaderboardTeams[0];

  const money = (n) => `$${n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const resultRows = [
    ...prevWinners.map(d => ({ ...d, kind: 'won' })),
    ...prevPending.map(d => ({ ...d, kind: d.bet.overallStatus === 'void' ? 'void' : 'pending' })),
    ...prevBetsSubmitted.filter(d => d.bet.overallStatus === 'void').map(d => ({ ...d, kind: 'void' })),
    ...prevLosers.map(d => ({ ...d, kind: 'lost' })),
    ...prevWeekData.filter(d => !d.bet).map(d => ({ ...d, kind: 'none' })),
  ];
  const resultText = (kind, bet) => {
    if (kind === 'won') return <span className="text-green-700 font-bold">+{bet.actualReturn || bet.estimatedReturn} <span className="text-[11px] uppercase">Won</span></span>;
    if (kind === 'lost') return <span className="text-red-700 font-bold">−{bet.stake} <span className="text-[11px] uppercase">Lost</span></span>;
    if (kind === 'void') return <span className="text-slate-500 font-semibold">Refunded</span>;
    if (kind === 'pending') return <span className="text-slate-500 font-semibold">Pending</span>;
    return <span className="text-slate-400 text-xs">No bet</span>;
  };
  const myStatus = myPrevData?.bet?.overallStatus;

  return (
    <Page>
      {navHistory.length > 0 && <BackButton onClick={goBack} />}

      <PageHeader
        title="Weekly summary"
        subtitle={`Week ${thisWeek} of ${totalWeeks}${comp?.name ? ` · ${comp.name}` : ''}`}
      />

      {(activeCompetitions.length > 1 || (isLoggedIn && teamsInViewedComp.length > 1)) && (
        <div className="flex flex-col sm:flex-row gap-2 mb-5">
          {activeCompetitions.length > 1 && (
            <SwitcherDropdown label="Competition" items={activeCompetitions} selectedValue={effectiveViewedCode} onSelect={switchViewedCompetition} />
          )}
          {isLoggedIn && teamsInViewedComp.length > 1 && (
            <SwitcherDropdown label="Team" items={teamsInViewedComp} selectedValue={viewedMyTeam?.id} onSelect={switchViewedTeam} valueKey="id" labelKey="team_name" />
          )}
        </div>
      )}

      {/* ── AI MATCH REPORT ── */}
      {prevWeek >= 1 && comp?.id && (
        <div className="mb-8"><WeeklyRecapCard competitionId={comp.id} weekNumber={prevWeek} /></div>
      )}

      {/* ── PREVIOUS WEEK REVIEW ── */}
      {prevWeek >= 1 ? (
        <>
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <h2 className="text-2xl font-bold text-slate-900">Week {prevWeek} results</h2>
            {prevWinRate !== null && (
              <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${prevWinRate >= 50 ? 'bg-green-100 text-green-800' : 'bg-red-50 text-red-700'}`}>{prevWinRate}% won</span>
            )}
            {prevPending.length > 0 && (
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-gray-100 text-slate-600">{prevPending.length} pending</span>
            )}
          </div>

          {/* My team callout */}
          {myPrevData && (
            <div className="bg-brand-900 text-white rounded-2xl p-5 mb-4 flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-[11px] uppercase tracking-wider font-bold text-brand-200 mb-1">Your team · {myPrevData.team.team}</p>
                {myPrevData.bet ? (
                  <>
                    <p className={`font-display text-3xl font-bold leading-tight ${myStatus === 'won' ? 'text-gold-400' : 'text-white'}`}>
                      {myStatus === 'won' ? `Won ${myPrevData.bet.actualReturn || myPrevData.bet.estimatedReturn}` : myStatus === 'lost' ? 'Lost' : myStatus === 'void' ? 'Refunded' : 'Pending'}
                    </p>
                    <p className="text-sm text-brand-100 mt-1">
                      {myPrevData.bet.type} · {myPrevData.bet.stake} stake{myPrevData.bet.submittedBy && <> · placed by {myPrevData.bet.submittedBy}</>}
                    </p>
                    {(myPrevData.bet.legs || []).length > 0 && (
                      <div className="flex gap-1.5 mt-3 flex-wrap">
                        {myPrevData.bet.legs.map((leg, li) => {
                          const lc = leg.status === 'won' ? 'bg-green-500/20 text-green-100' : leg.status === 'lost' ? 'bg-red-500/25 text-red-100' : 'bg-white/10 text-white/80';
                          return <span key={li} className={`text-xs px-2 py-0.5 rounded-full ${lc}`}>{leg.selection}</span>;
                        })}
                      </div>
                    )}
                  </>
                ) : (
                  <p className="font-display text-2xl font-bold">No bet went in</p>
                )}
              </div>
              {myPrevData.team.rank && (
                <div className="text-right flex-shrink-0">
                  <p className="text-[11px] uppercase tracking-wider font-bold text-brand-200">Season</p>
                  <p className="font-display text-3xl font-bold leading-tight">#{myPrevData.team.rank}</p>
                  <p className="text-xs text-brand-100 tabular-nums">{myPrevData.team.total}</p>
                </div>
              )}
            </div>
          )}

          {/* All teams results */}
          <Card className="mb-4 overflow-hidden">
            <div className="px-5 pt-4"><CardTitle icon={<Trophy className="w-4 h-4" />}>How everyone did</CardTitle></div>
            {prevBetsSubmitted.length === 0 ? (
              <p className="text-slate-500 text-sm px-5 pb-5">No bets went in for Week {prevWeek}. Results show here once bets settle after the weekend.</p>
            ) : (
              <div className="divide-y divide-gray-100 border-t border-gray-100">
                {resultRows.map(({ team: t, bet, kind }) => (
                  <div key={t.id} className={`flex items-center gap-3 px-5 py-3 ${t.team === myTeamName ? 'bg-[#FBF6E6]' : ''}`}>
                    <div className="min-w-0 flex-1">
                      <p className={`text-sm font-semibold truncate ${kind === 'none' ? 'text-slate-400' : 'text-slate-900'}`}>
                        {t.team}
                        {t.team === myTeamName && <span className="ml-1.5 text-[10px] font-bold uppercase bg-gold-500 text-brand-950 rounded-full px-1.5 py-0.5 align-middle">You</span>}
                      </p>
                      {bet && (
                        <p className="text-xs text-slate-500 truncate">
                          {bet.type} · {(bet.legs || []).length} leg{(bet.legs || []).length !== 1 ? 's' : ''} · {bet.stake}{bet.submittedBy ? ` · ${bet.submittedBy}` : ''}
                        </p>
                      )}
                    </div>
                    <div className="text-sm text-right flex-shrink-0 tabular-nums">{resultText(kind, bet)}</div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Key stat strip (hidden until there is something to show) */}
          {prevBetsSubmitted.length > 0 && (
            <Card className="grid grid-cols-3 divide-x divide-gray-100 mb-8">
              {[
                ['Bets placed', prevBetsSubmitted.length],
                ['Won', prevWinRate !== null ? `${prevWinRate}%` : '—'],
                ['Season pot', totalWinnings > 0 ? money(totalWinnings) : '$0'],
              ].map(([l, v]) => (
                <div key={l} className="p-4 text-center min-w-0">
                  <p className="text-[11px] uppercase tracking-wider font-bold text-slate-500 mb-0.5">{l}</p>
                  <p className="font-display text-xl sm:text-2xl font-bold text-slate-900 tabular-nums truncate">{v}</p>
                </div>
              ))}
            </Card>
          )}
        </>
      ) : (
        <Card className="p-6 mb-8 text-center">
          <p className="text-slate-500 text-sm">This is Week 1, so there's no previous week to review yet.</p>
        </Card>
      )}

      {/* ── THIS WEEK OUTLOOK ── */}
      <h2 className="text-2xl font-bold text-slate-900 mb-3">Week {thisWeek} up next</h2>
      <div className="grid md:grid-cols-2 gap-4">
        <Card className="p-5">
          <CardTitle icon={<Clock className="w-4 h-4" />}>Betting window</CardTitle>
          {currentBettor && <p className="text-slate-800 text-sm">It's <strong>{currentBettor}</strong>'s turn to place your team's bet.</p>}
          <p className="text-sm mt-2"><Countdown to={nextWedCutoff} /></p>
          <p className="text-slate-500 text-xs mt-1">Deadline {cutoffStr}</p>
          {teamsNoBet.length > 0 && <p className="text-slate-500 text-xs mt-1">{teamsNoBet.length} team{teamsNoBet.length !== 1 ? 's' : ''} yet to submit</p>}
        </Card>
        <Card className="p-5">
          <CardTitle icon={<Trophy className="w-4 h-4" />}>Season standings</CardTitle>
          {leaderboardTeams.length === 0 && <p className="text-slate-500 text-sm">The ladder fills in once the first results are in.</p>}
          <div className="divide-y divide-gray-100">
            {leaderboardTeams.slice(0, 3).map((t, i) => (
              <div key={t.id} className="flex items-center gap-3 py-2">
                <RankBadge rank={i + 1} />
                <span className={`text-sm flex-1 truncate font-semibold ${t.team === myTeamName ? 'text-brand-800' : 'text-slate-800'}`}>{t.team}{t.team === myTeamName ? ' (you)' : ''}</span>
                <span className="font-display text-lg font-bold tabular-nums">{t.total}</span>
              </div>
            ))}
          </div>
          {leaderboardTeams.length > 3 && <p className="text-slate-400 text-xs mt-2">+{leaderboardTeams.length - 3} more teams</p>}
        </Card>
      </div>
    </Page>
  );
};

export default WeeklySummaryView;
