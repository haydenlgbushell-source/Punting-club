import React from 'react';
import { Trophy, XCircle, Clock, ChevronLeft } from 'lucide-react';
import { useApp } from '../../context/AppContext.jsx';

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
  const prevPending       = prevBetsSubmitted.filter(d => !['won', 'lost', 'partial'].includes(d.bet.overallStatus));
  const prevSettledCount  = prevWinners.length + prevLosers.length;
  const prevWinRate       = prevSettledCount > 0 ? Math.round((prevWinners.length / prevSettledCount) * 100) : null;

  const bestPrevWin = prevWinners
    .sort((a, b) => parseFloat((b.bet.estimatedReturn || '0').replace(/[^0-9.]/g, '')) - parseFloat((a.bet.estimatedReturn || '0').replace(/[^0-9.]/g, '')))[0];

  const myPrevData = prevWeekData.find(d => d.isMyTeam);

  const allThisWeekBets = leaderboardTeams.flatMap(t =>
    (t.bets || []).filter(b => b.weekNumber === thisWeek)
  );
  const teamsNoBet = leaderboardTeams.filter(t => !(t.bets || []).some(b => b.weekNumber === thisWeek));
  const cutoffStr  = nextWedCutoff.toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });

  const totalWinnings = leaderboardTeams.reduce((sum, t) => sum + parseFloat((t.total || '$0').replace(/[^0-9.]/g, '')) || 0, 0);
  const leader = leaderboardTeams[0];

  return (
    <section className="pt-28 pb-16 px-4 sm:px-6">
      <div className="max-w-5xl mx-auto">

        {navHistory.length > 0 && (
          <button onClick={goBack} className="flex items-center gap-1.5 text-slate-500 hover:text-teal-700 text-sm font-semibold mb-6 transition-colors group">
            <ChevronLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" /> Back
          </button>
        )}

        <h1 className="text-3xl font-black mb-1">Weekly Summary</h1>
        <p className="text-slate-500 mb-4 text-sm">
          Week {thisWeek} of {totalWeeks}{comp?.name ? ` · ${comp.name}` : ''}
        </p>

        {activeCompetitions.length > 1 && (
          <div className="flex items-center gap-2 flex-wrap mb-3">
            <span className="text-xs text-slate-500 font-semibold">Competition:</span>
            {activeCompetitions.map(c => (
              <button key={c.code} onClick={() => switchViewedCompetition(c.code)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${effectiveViewedCode === c.code ? 'bg-teal-500/20 text-teal-600 border-teal-500/40' : 'text-slate-500 border-gray-300 hover:border-gray-400 hover:text-slate-800'}`}>
                {c.name}
              </button>
            ))}
          </div>
        )}

        {isLoggedIn && teamsInViewedComp.length > 1 && (
          <div className="flex items-center gap-2 flex-wrap mb-8">
            <span className="text-xs text-slate-500 font-semibold">Team:</span>
            {teamsInViewedComp.map(t => (
              <button key={t.id} onClick={() => switchViewedTeam(t.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${viewedMyTeam?.id === t.id ? 'bg-teal-500/20 text-teal-600 border-teal-500/40' : 'text-slate-500 border-gray-300 hover:border-gray-400 hover:text-slate-800'}`}>
                {t.team_name}
              </button>
            ))}
          </div>
        )}

        {/* ── PREVIOUS WEEK REVIEW ── */}
        {prevWeek >= 1 ? (
          <>
            <div className="flex items-center gap-3 mb-4">
              <h2 className="text-xl font-black text-slate-900">Week {prevWeek} Review</h2>
              {prevWinRate !== null && (
                <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${prevWinRate >= 50 ? 'bg-green-500/15 border-green-500/40 text-green-400' : 'bg-red-500/15 border-red-500/40 text-red-400'}`}>
                  {prevWinRate}% win rate
                </span>
              )}
              {prevPending.length > 0 && (
                <span className="text-xs text-teal-600 bg-teal-500/10 border border-teal-500/20 px-2 py-0.5 rounded-full">{prevPending.length} pending</span>
              )}
            </div>

            {/* My team callout */}
            {myPrevData && (
              <div className={`rounded-xl p-5 mb-4 border-2 ${
                myPrevData.bet?.overallStatus === 'won'  ? 'bg-green-50 border-green-500/40' :
                myPrevData.bet?.overallStatus === 'lost' ? 'bg-red-50 border-red-500/30' :
                myPrevData.bet ? 'bg-teal-50 border-teal-500/20' : 'bg-gray-50 border-gray-200'
              }`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Your Team — {myPrevData.team.team}</p>
                    {myPrevData.bet ? (
                      <>
                        <div className="flex items-center gap-2 mb-2">
                          <span className={`text-2xl font-black ${myPrevData.bet.overallStatus === 'won' ? 'text-green-400' : myPrevData.bet.overallStatus === 'lost' ? 'text-red-400' : 'text-teal-600'}`}>
                            {myPrevData.bet.overallStatus === 'won' ? 'WON!' : myPrevData.bet.overallStatus === 'lost' ? 'Lost' : myPrevData.bet.overallStatus === 'partial' ? 'Partial' : 'Pending'}
                          </span>
                        </div>
                        <p className="text-sm text-slate-700">
                          {myPrevData.bet.type} · Stake: <span className="text-slate-900 font-semibold">{myPrevData.bet.stake}</span>
                          {myPrevData.bet.overallStatus === 'won' && <> · Return: <span className="text-green-400 font-bold">{myPrevData.bet.estimatedReturn}</span></>}
                          {myPrevData.bet.submittedBy && <> · Placed by <span className="text-teal-600">{myPrevData.bet.submittedBy}</span></>}
                        </p>
                        {(myPrevData.bet.legs || []).length > 0 && (
                          <div className="flex gap-1 mt-2 flex-wrap">
                            {myPrevData.bet.legs.map((leg, li) => {
                              const lc = leg.status === 'won' ? 'bg-green-50 border-green-300 text-green-700' : leg.status === 'lost' ? 'bg-red-50 border-red-300 text-red-700' : 'bg-gray-100 border-gray-200 text-gray-600';
                              return <span key={li} className={`text-xs px-2 py-0.5 rounded border ${lc}`}>{leg.selection}</span>;
                            })}
                          </div>
                        )}
                      </>
                    ) : (
                      <p className="text-gray-500 text-sm italic">No bet submitted for Week {prevWeek}</p>
                    )}
                  </div>
                  {myPrevData.team.rank && (
                    <div className="text-right flex-shrink-0">
                      <p className="text-xs text-slate-500">Season rank</p>
                      <p className="text-2xl font-black text-teal-600">#{myPrevData.team.rank}</p>
                      <p className="text-xs text-slate-500">{myPrevData.team.total}</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* All teams results */}
            <div className="bg-white border border-gray-200 rounded-xl p-5 mb-6">
              <h3 className="font-bold text-teal-600 mb-4">How Everyone Did — Week {prevWeek}</h3>
              {prevBetsSubmitted.length === 0 ? (
                <p className="text-slate-400 text-sm italic">No bets were submitted last week.</p>
              ) : (
                <div className="space-y-3">
                  {prevWinners.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-green-400 uppercase tracking-wider mb-2 flex items-center gap-1"><Trophy className="w-3 h-3" /> Winners</p>
                      <div className="space-y-2">
                        {prevWinners.map(({ team: t, bet }) => (
                          <div key={t.id} className="bg-green-50 border border-green-200 rounded-lg px-3 py-2.5 flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-semibold text-sm text-slate-900">{t.team}</span>
                                {t.team === myTeamName && <span className="text-xs bg-teal-500/20 text-teal-600 px-1.5 py-0.5 rounded">You</span>}
                                <span className="text-xs text-slate-500">{bet.type} · {(bet.legs || []).length} leg{(bet.legs || []).length !== 1 ? 's' : ''}</span>
                                {bet.submittedBy && <span className="text-xs text-slate-400">by {bet.submittedBy}</span>}
                              </div>
                              {(bet.legs || []).length > 0 && (
                                <div className="flex gap-1 mt-1.5 flex-wrap">
                                  {bet.legs.map((leg, li) => (
                                    <span key={li} className="text-xs bg-green-100 border border-green-200 text-green-700 px-1.5 py-0.5 rounded">{leg.selection}</span>
                                  ))}
                                </div>
                              )}
                            </div>
                            <div className="text-right flex-shrink-0">
                              <p className="text-green-400 font-bold text-sm">{bet.estimatedReturn}</p>
                              <p className="text-slate-400 text-xs">from {bet.stake}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {prevLosers.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-red-400 uppercase tracking-wider mb-2 flex items-center gap-1"><XCircle className="w-3 h-3" /> Bust</p>
                      <div className="space-y-2">
                        {prevLosers.map(({ team: t, bet }) => (
                          <div key={t.id} className="bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-semibold text-sm text-slate-900">{t.team}</span>
                              {t.team === myTeamName && <span className="text-xs bg-teal-500/20 text-teal-600 px-1.5 py-0.5 rounded">You</span>}
                              <span className="text-xs text-slate-400">{bet.type} · {(bet.legs || []).length} legs</span>
                              {bet.submittedBy && <span className="text-xs text-slate-400">by {bet.submittedBy}</span>}
                            </div>
                            <p className="text-red-400 text-sm font-semibold flex-shrink-0">{bet.stake} lost</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {prevPending.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-teal-600 uppercase tracking-wider mb-2 flex items-center gap-1"><Clock className="w-3 h-3" /> Still Pending</p>
                      <div className="space-y-1">
                        {prevPending.map(({ team: t, bet }) => (
                          <div key={t.id} className="bg-teal-50 border border-teal-200 rounded-lg px-3 py-2 flex items-center justify-between gap-3">
                            <span className="text-sm text-slate-700">{t.team}</span>
                            <span className="text-xs text-teal-600">{bet.type}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {prevWeekData.filter(d => !d.bet).length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">— No Bet Submitted</p>
                      <div className="flex flex-wrap gap-2">
                        {prevWeekData.filter(d => !d.bet).map(({ team: t }) => (
                          <span key={t.id} className="text-xs text-slate-400 bg-white border border-gray-200 rounded px-2 py-1">{t.team}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Key stat strip */}
            <div className="grid grid-cols-3 gap-4 mb-8">
              {[
                ['Week ' + prevWeek + ' Bets', prevBetsSubmitted.length || '—', 'text-teal-600'],
                ['Win Rate', prevWinRate !== null ? `${prevWinRate}%` : '—', prevWinRate !== null && prevWinRate >= 50 ? 'text-green-400' : 'text-red-400'],
                ['Season Pot', totalWinnings > 0 ? `$${totalWinnings.toLocaleString()}` : '$0', 'text-teal-600'],
              ].map(([l, v, c]) => (
                <div key={l} className="bg-white border border-gray-200 rounded-xl p-4 text-center">
                  <p className="text-slate-500 text-xs mb-1">{l}</p>
                  <p className={`text-2xl font-black ${c}`}>{v}</p>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="bg-white border border-gray-200 rounded-xl p-6 mb-8 text-center">
            <p className="text-slate-500 text-sm">This is Week 1 — no previous week to review yet.</p>
          </div>
        )}

        {/* ── THIS WEEK OUTLOOK ── */}
        <div className="flex items-center gap-3 mb-4">
          <h2 className="text-xl font-black text-slate-900">Week {thisWeek} — Up Next</h2>
          <span className="text-xs text-slate-500 bg-gray-100 border border-gray-300 px-2 py-0.5 rounded-full">Deadline {cutoffStr}</span>
        </div>
        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <div className="bg-teal-50 border border-teal-200 rounded-xl p-5">
            <h3 className="font-bold text-teal-600 mb-2 flex items-center gap-1.5"><Clock className="w-4 h-4" /> Betting Window Open</h3>
            {currentBettor && <p className="text-slate-700 text-sm">It's <strong className="text-slate-900">{currentBettor}</strong>'s turn to place the bet.</p>}
            <p className="text-slate-500 text-xs mt-2">Deadline: <span className="text-slate-700 font-medium">{cutoffStr}</span></p>
            {teamsNoBet.length > 0 && <p className="text-slate-400 text-xs mt-1">{teamsNoBet.length} team{teamsNoBet.length !== 1 ? 's' : ''} yet to submit</p>}
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <h3 className="font-bold text-teal-600 mb-2 flex items-center gap-1.5"><Trophy className="w-4 h-4" /> Season Standings</h3>
            {leaderboardTeams.slice(0, 3).map((t, i) => (
              <div key={t.id} className="flex items-center gap-2 py-1">
                <span className={`text-xs font-black w-5 ${i === 0 ? 'text-teal-600' : 'text-slate-500'}`}>#{i + 1}</span>
                <span className={`text-sm flex-1 truncate ${t.team === myTeamName ? 'text-teal-500 font-bold' : 'text-slate-700'}`}>{t.team}{t.team === myTeamName ? ' (You)' : ''}</span>
                <span className="text-teal-600 text-xs font-bold">{t.total}</span>
              </div>
            ))}
            {leaderboardTeams.length > 3 && <p className="text-slate-400 text-xs mt-1">+{leaderboardTeams.length - 3} more teams</p>}
          </div>
        </div>
      </div>
    </section>
  );
};

export default WeeklySummaryView;
