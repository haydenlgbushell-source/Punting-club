import React, { useState } from 'react';
import { Trophy, Users, ChevronLeft, CheckCircle, Crown } from 'lucide-react';
import Badge from '../Badge.jsx';
import LegDot from '../LegDot.jsx';
import BetSlipCard from '../BetSlipCard.jsx';
import { useApp } from '../../context/AppContext.jsx';

const LeaderboardView = () => {
  const {
    isLoggedIn, navHistory, goBack,
    activeCompetitions, effectiveViewedCode, switchViewedCompetition,
    teamsInViewedComp, viewedMyTeam, switchViewedTeam,
    enrichedLeaderboardTeams, myTeamName, currentWeekNum,
    nextWedCutoff, lastChecked, resultLog,
    setShowBetAnalyzer,
    calcCurrentWeek,
  } = useApp();

  const [leaderboardView, setLeaderboardView] = useState('current');
  const [selectedTeamIdx, setSelectedTeamIdx] = useState(null);

  const tickerItems = enrichedLeaderboardTeams.flatMap(t =>
    (t.bets || []).flatMap(b =>
      (b.legs || [])
        .filter(l => l.resultNote && ['won', 'lost', 'in_progress'].includes(l.status))
        .map(l => `${l.selection} — ${l.resultNote}`)
    )
  );
  const ticker = tickerItems.length > 0 ? tickerItems
    : ['Results update automatically · Click "Check Results" to refresh · Expand a team row to see the full bet slip'];

  return (
    <section className="pt-28 pb-16 px-0 sm:px-0">
      <div className="max-w-5xl mx-auto px-2 sm:px-6">
        {navHistory.length > 0 && (
          <button onClick={goBack} className="flex items-center gap-1.5 text-gray-500 hover:text-sky-400 text-sm font-semibold mb-4 px-2 transition-colors group">
            <ChevronLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" /> Back
          </button>
        )}

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-start justify-between mb-6 gap-4 px-2">
          <div>
            <h1 className="text-3xl font-black mb-1">Live Leaderboard</h1>
            <p className="text-slate-400 text-sm">
              {(() => {
                const comp = activeCompetitions.find(c => c.code === effectiveViewedCode);
                const wk = comp?.start_date ? calcCurrentWeek(comp.start_date) : '—';
                const total = comp?.weeks || '—';
                return `Week ${wk} of ${total} · Closes Wed 12:00 AEST (${nextWedCutoff.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })})`;
              })()}
            </p>
            {lastChecked && <p className="text-slate-600 text-xs mt-0.5">Last checked: {lastChecked.toLocaleTimeString()}</p>}
            {resultLog.slice(0, 2).map((l, i) => (
              <p key={i} className="text-green-400 text-xs mt-0.5 flex items-center gap-1">
                <CheckCircle className="w-3 h-3 text-green-400 inline mr-1" />{l.time} — {l.message}
              </p>
            ))}
          </div>
          <div className="flex gap-2 flex-wrap">
            <button onClick={() => setShowBetAnalyzer(true)} className="bg-blue-600 hover:bg-sky-400 text-black px-4 py-2 rounded-lg font-bold text-xs transition-colors">
              Submit Bet
            </button>
          </div>
        </div>

        {/* Competition switcher */}
        {activeCompetitions.length > 1 && (
          <div className="flex items-center gap-2 flex-wrap mb-3 px-2">
            <span className="text-xs text-slate-400 font-semibold">Competition:</span>
            {activeCompetitions.map(c => (
              <button key={c.code} onClick={() => switchViewedCompetition(c.code)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${effectiveViewedCode === c.code ? 'bg-blue-500/20 text-sky-400 border-blue-500/40' : 'text-slate-400 border-slate-700 hover:border-slate-600 hover:text-slate-200'}`}>
                {c.name}
              </button>
            ))}
          </div>
        )}

        {/* Team toggle */}
        {isLoggedIn && teamsInViewedComp.length > 1 && (
          <div className="flex items-center gap-2 flex-wrap mb-3 px-2">
            <span className="text-xs text-slate-400 font-semibold">Team:</span>
            {teamsInViewedComp.map(t => (
              <button key={t.id} onClick={() => switchViewedTeam(t.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${viewedMyTeam?.id === t.id ? 'bg-blue-500/20 text-blue-400 border-blue-500/40' : 'text-slate-400 border-slate-700 hover:border-slate-600 hover:text-slate-200'}`}>
                {t.team_name}
              </button>
            ))}
          </div>
        )}

        {/* View toggle */}
        <div className="flex gap-1 mb-4 px-2">
          {[['current', 'This Week'], ['season', 'Season View']].map(([v, l]) => (
            <button key={v} onClick={() => setLeaderboardView(v)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border ${leaderboardView === v ? 'bg-slate-800 text-white border-slate-700' : 'text-slate-500 hover:text-slate-300 border-transparent'}`}>{l}</button>
          ))}
        </div>

        {/* Column headers */}
        {leaderboardView === 'current' && (
          <div className="hidden sm:grid grid-cols-12 gap-2 px-4 mb-1 text-xs font-semibold text-slate-600 uppercase tracking-wider">
            <div className="col-span-1">#</div>
            <div className="col-span-3">Team</div>
            <div className="col-span-2 text-center">Total</div>
            <div className="col-span-6 pl-3 border-l border-slate-800">This Week's Bet</div>
          </div>
        )}
        {leaderboardView === 'season' && (
          <div className="hidden sm:grid grid-cols-12 gap-2 px-4 mb-1 text-xs font-semibold text-slate-600 uppercase tracking-wider">
            <div className="col-span-1">#</div>
            <div className="col-span-3">Team</div>
            <div className="col-span-2 text-center">Total</div>
            <div className="col-span-6 pl-3 border-l border-slate-800">Week History</div>
          </div>
        )}

        {/* Rows */}
        <div className="space-y-1.5">
          {enrichedLeaderboardTeams.length === 0 && (
            <div className="text-center py-16">
              <Trophy className="w-16 h-16 text-sky-500/30 mb-4 mx-auto" />
              <p className="text-slate-400 font-semibold text-lg">No teams yet</p>
              <p className="text-slate-500 text-sm mt-1">Teams will appear here once they register and submit bets.</p>
            </div>
          )}
          {enrichedLeaderboardTeams.map((team, idx) => {
            const isMe = isLoggedIn && team.team === myTeamName;
            const currentWeek = currentWeekNum + 1;
            const weekBet = team.bets.find(b => b.weekNumber === currentWeek) || null;
            const isOpen = selectedTeamIdx === idx;

            const computedStatus = (() => {
              const legs = weekBet?.legs || [];
              if (!legs.length) return weekBet?.overallStatus || 'pending';
              if (legs.some(l => l.status === 'in_progress')) return 'in_progress';
              if (legs.some(l => l.status === 'pending'))     return 'pending';
              if (!legs.every(l => ['won', 'lost', 'void'].includes(l.status))) return 'pending';
              if (legs.every(l => l.status === 'won'))  return 'won';
              if (legs.some(l => l.status === 'lost'))  return 'lost';
              return 'partial';
            })();

            const rowBg = isMe
              ? 'border-sky-400/40 bg-blue-500/5'
              : computedStatus === 'won'         ? 'border-green-500/20 bg-green-950/10'
              : computedStatus === 'lost'        ? 'border-red-500/20 bg-red-950/10'
              : computedStatus === 'partial'     ? 'border-indigo-500/20 bg-indigo-950/10'
              : computedStatus === 'in_progress' ? 'border-indigo-500/20 bg-indigo-950/10'
              : 'border-slate-800 bg-slate-900';

            return (
              <div key={idx} className={`rounded-xl border overflow-hidden transition-all ${rowBg} ${isMe ? 'ring-1 ring-sky-400/30' : ''}`}>
                <div className="grid grid-cols-12 gap-2 items-center px-3 py-3 cursor-pointer hover:bg-slate-800/40 transition-colors" onClick={() => setSelectedTeamIdx(isOpen ? null : idx)}>
                  {/* Rank */}
                  <div className="col-span-1">
                    <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${team.color} flex items-center justify-center font-black text-white text-sm`}>{team.rank}</div>
                  </div>
                  {/* Name */}
                  <div className="col-span-4 sm:col-span-3 min-w-0 pl-1">
                    <div className="font-bold text-sm truncate flex items-center gap-1">
                      {team.team}
                      {isMe && <span className="text-sky-400 text-xs">(You)</span>}
                    </div>
                    <div className="text-slate-600 text-xs">{team.members} members</div>
                  </div>
                  {/* Total */}
                  <div className="hidden sm:block col-span-2 text-center">
                    <div className="font-bold text-sky-400 text-sm">{team.total}</div>
                  </div>

                  {/* This week / season */}
                  <div className="col-span-7 sm:col-span-6 pl-0 sm:pl-3 sm:border-l sm:border-slate-800">
                    {leaderboardView === 'current' ? (
                      weekBet ? (
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge status={computedStatus} />
                          <span className="text-slate-100 text-xs font-semibold">{weekBet.type}</span>
                          <span className="text-slate-400 text-xs">·</span>
                          <span className="text-green-400 text-xs font-semibold">{weekBet.stake}</span>
                          <span className="hidden sm:inline text-slate-400 text-xs">/</span>
                          <span className="hidden sm:inline text-green-400 text-xs font-bold">{weekBet.estimatedReturn || weekBet.return || 'N/A'}</span>
                          {weekBet.legs?.length > 0 && (
                            <div className="flex gap-1 ml-auto">
                              {weekBet.legs.map((leg, li) => <LegDot key={li} leg={leg} />)}
                            </div>
                          )}
                        </div>
                      ) : <span className="text-slate-500 text-xs italic">No bet submitted</span>
                    ) : (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {team.weekHistory?.length > 0 ? team.weekHistory.map((result, wi) => {
                          const cls = result === 'W' ? 'bg-green-500/30 border-green-500 text-green-400' : result === 'L' ? 'bg-red-500/30 border-red-500 text-red-400' : result === 'P' ? 'bg-blue-500/20 border-blue-500/50 text-sky-400' : 'bg-slate-800 border-slate-700 text-slate-600';
                          return <div key={wi} title={`Week ${wi + 1}`} className={`w-7 h-7 rounded-md border flex items-center justify-center text-xs font-bold ${cls}`}>{result || '–'}</div>;
                        }) : <span className="text-slate-500 text-xs italic">No history yet</span>}
                        <span className="text-sky-400 font-bold text-sm ml-auto">{team.total}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Expanded bet slip */}
                {isOpen && (
                  <div className="border-t border-slate-800 bg-slate-950 px-3 py-3">
                    {/* Member roster */}
                    {team.memberList?.length > 0 && (
                      <div className="mb-3 pb-3 border-b border-slate-800">
                        <p className="text-slate-500 text-xs uppercase tracking-wider mb-2 flex items-center gap-1"><Users className="w-3 h-3" /> Members</p>
                        <div className="flex flex-wrap gap-2">
                          {team.memberList.map((m, mi) => (
                            <div key={mi} className="flex items-center gap-1.5 bg-slate-800 rounded-full px-2.5 py-1">
                              <div className="w-5 h-5 rounded-full bg-blue-500/20 border border-blue-500/30 flex items-center justify-center text-sky-400 font-bold text-xs flex-shrink-0">
                                {(m.name || m).charAt(0).toUpperCase()}
                              </div>
                              <span className="text-xs text-slate-300 font-medium">{m.name || m}</span>
                              {m.role === 'captain' && <Crown className="w-3 h-3 text-sky-400" />}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {weekBet ? <BetSlipCard bet={weekBet} /> : <p className="text-slate-600 text-sm italic text-center py-4">No bet submitted this week</p>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};

export default LeaderboardView;
