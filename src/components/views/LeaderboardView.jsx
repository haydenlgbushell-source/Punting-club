import React, { useState } from 'react';
import { Trophy, Users } from 'lucide-react';
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
          <button onClick={goBack} className="flex items-center gap-1.5 text-gray-500 hover:text-amber-400 text-sm font-semibold mb-4 px-2 transition-colors group">
            <span className="text-lg leading-none group-hover:-translate-x-0.5 transition-transform">←</span> Back
          </button>
        )}

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-start justify-between mb-6 gap-4 px-2">
          <div>
            <h1 className="text-3xl font-black mb-1">Live Leaderboard</h1>
            <p className="text-gray-500 text-sm">
              {(() => {
                const comp = activeCompetitions.find(c => c.code === effectiveViewedCode);
                const wk = comp?.start_date ? calcCurrentWeek(comp.start_date) : '—';
                const total = comp?.weeks || '—';
                return `Week ${wk} of ${total} · Closes Wed 12:00 AEST (${nextWedCutoff.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })})`;
              })()}
            </p>
            {lastChecked && <p className="text-gray-600 text-xs mt-0.5">Last checked: {lastChecked.toLocaleTimeString()}</p>}
            {resultLog.slice(0, 2).map((l, i) => <p key={i} className="text-green-400 text-xs mt-0.5">✓ {l.time} — {l.message}</p>)}
          </div>
          <div className="flex gap-2 flex-wrap">
            <button onClick={() => setShowBetAnalyzer(true)} className="bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white px-4 py-2 rounded-lg font-bold text-xs">
              Submit Bet
            </button>
          </div>
        </div>

        {/* Competition switcher */}
        {activeCompetitions.length > 1 && (
          <div className="flex items-center gap-2 flex-wrap mb-3 px-2">
            <span className="text-xs text-gray-500 font-semibold">Competition:</span>
            {activeCompetitions.map(c => (
              <button key={c.code} onClick={() => switchViewedCompetition(c.code)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${effectiveViewedCode === c.code ? 'bg-amber-500/20 text-amber-400 border-amber-500/40' : 'text-gray-400 border-white/10 hover:border-white/20 hover:text-gray-200'}`}>
                {c.name}
              </button>
            ))}
          </div>
        )}

        {/* Team toggle */}
        {isLoggedIn && teamsInViewedComp.length > 1 && (
          <div className="flex items-center gap-2 flex-wrap mb-3 px-2">
            <span className="text-xs text-gray-500 font-semibold">Team:</span>
            {teamsInViewedComp.map(t => (
              <button key={t.id} onClick={() => switchViewedTeam(t.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${viewedMyTeam?.id === t.id ? 'bg-blue-500/20 text-blue-400 border-blue-500/40' : 'text-gray-400 border-white/10 hover:border-white/20 hover:text-gray-200'}`}>
                {t.team_name}
              </button>
            ))}
          </div>
        )}

        {/* View toggle */}
        <div className="flex gap-1 mb-4 px-2">
          {[['current', 'This Week'], ['season', 'Season View']].map(([v, l]) => (
            <button key={v} onClick={() => setLeaderboardView(v)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${leaderboardView === v ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40' : 'text-gray-500 hover:text-gray-300'}`}>{l}</button>
          ))}
        </div>

        {/* Column headers */}
        {leaderboardView === 'current' && (
          <div className="hidden sm:grid grid-cols-12 gap-2 px-4 mb-1 text-xs font-semibold text-gray-600 uppercase tracking-wider">
            <div className="col-span-1">#</div>
            <div className="col-span-3">Team</div>
            <div className="col-span-2 text-center">Total</div>
            <div className="col-span-6 pl-3 border-l border-white/5">This Week's Bet</div>
          </div>
        )}
        {leaderboardView === 'season' && (
          <div className="hidden sm:grid grid-cols-12 gap-2 px-4 mb-1 text-xs font-semibold text-gray-600 uppercase tracking-wider">
            <div className="col-span-1">#</div>
            <div className="col-span-3">Team</div>
            <div className="col-span-2 text-center">Total</div>
            <div className="col-span-6 pl-3 border-l border-white/5">Week History</div>
          </div>
        )}

        {/* Rows */}
        <div className="space-y-1.5">
          {enrichedLeaderboardTeams.length === 0 && (
            <div className="text-center py-16">
              <Trophy className="w-16 h-16 text-amber-500/30 mb-4 mx-auto" />
              <p className="text-gray-400 font-semibold text-lg">No teams yet</p>
              <p className="text-gray-600 text-sm mt-1">Teams will appear here once they register and submit bets.</p>
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
              ? 'border-amber-400/40 bg-amber-500/5'
              : computedStatus === 'won'         ? 'border-green-500/20 bg-green-950/10'
              : computedStatus === 'lost'        ? 'border-red-500/20 bg-red-950/10'
              : computedStatus === 'partial'     ? 'border-yellow-500/20 bg-yellow-950/10'
              : computedStatus === 'in_progress' ? 'border-orange-500/20 bg-orange-950/10'
              : 'border-white/5 bg-white/2';

            return (
              <div key={idx} className={`rounded-xl border overflow-hidden transition-all ${rowBg} ${isMe ? 'ring-1 ring-amber-400/30' : ''}`}>
                <div className="grid grid-cols-12 gap-2 items-center px-3 py-3 cursor-pointer hover:bg-white/3 transition-colors" onClick={() => setSelectedTeamIdx(isOpen ? null : idx)}>
                  {/* Rank */}
                  <div className="col-span-1">
                    <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${team.color} flex items-center justify-center font-black text-white text-sm`}>{team.rank}</div>
                  </div>
                  {/* Name */}
                  <div className="col-span-4 sm:col-span-3 min-w-0 pl-1">
                    <div className="font-bold text-sm truncate flex items-center gap-1">
                      {team.team}
                      {isMe && <span className="text-amber-400 text-xs">(You)</span>}
                    </div>
                    <div className="text-gray-600 text-xs">{team.members} members</div>
                  </div>
                  {/* Total */}
                  <div className="hidden sm:block col-span-2 text-center">
                    <div className="font-bold text-amber-400 text-sm">{team.total}</div>
                  </div>

                  {/* This week / season */}
                  <div className="col-span-7 sm:col-span-6 pl-0 sm:pl-3 sm:border-l sm:border-white/5">
                    {leaderboardView === 'current' ? (
                      weekBet ? (
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge status={computedStatus} />
                          <span className="text-white text-xs font-semibold">{weekBet.type}</span>
                          <span className="text-gray-500 text-xs">·</span>
                          <span className="text-green-400 text-xs font-semibold">{weekBet.stake}</span>
                          <span className="hidden sm:inline text-gray-500 text-xs">→</span>
                          <span className="hidden sm:inline text-green-400 text-xs font-bold">{weekBet.estimatedReturn || weekBet.return || 'N/A'}</span>
                          {weekBet.legs?.length > 0 && (
                            <div className="flex gap-1 ml-auto">
                              {weekBet.legs.map((leg, li) => <LegDot key={li} leg={leg} />)}
                            </div>
                          )}
                        </div>
                      ) : <span className="text-gray-700 text-xs italic">No bet submitted</span>
                    ) : (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {team.weekHistory?.length > 0 ? team.weekHistory.map((result, wi) => {
                          const cls = result === 'W' ? 'bg-green-500/30 border-green-500 text-green-400' : result === 'L' ? 'bg-red-500/30 border-red-500 text-red-400' : result === 'P' ? 'bg-amber-500/20 border-amber-500/50 text-amber-400' : 'bg-white/5 border-white/10 text-gray-600';
                          return <div key={wi} title={`Week ${wi + 1}`} className={`w-7 h-7 rounded-md border flex items-center justify-center text-xs font-bold ${cls}`}>{result || '–'}</div>;
                        }) : <span className="text-gray-700 text-xs italic">No history yet</span>}
                        <span className="text-amber-400 font-bold text-sm ml-auto">{team.total}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Expanded bet slip */}
                {isOpen && (
                  <div className="border-t border-white/5 bg-black/30 px-3 py-3">
                    {/* Member roster */}
                    {team.memberList?.length > 0 && (
                      <div className="mb-3 pb-3 border-b border-white/5">
                        <p className="text-gray-500 text-xs uppercase tracking-wider mb-2 flex items-center gap-1"><Users className="w-3 h-3" /> Members</p>
                        <div className="flex flex-wrap gap-2">
                          {team.memberList.map((m, mi) => (
                            <div key={mi} className="flex items-center gap-1.5 bg-white/5 rounded-full px-2.5 py-1">
                              <div className="w-5 h-5 rounded-full bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400 font-bold text-xs flex-shrink-0">
                                {(m.name || m).charAt(0).toUpperCase()}
                              </div>
                              <span className="text-xs text-gray-300 font-medium">{m.name || m}</span>
                              {m.role === 'captain' && <span className="text-amber-400 text-xs">👑</span>}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {weekBet ? <BetSlipCard bet={weekBet} /> : <p className="text-gray-600 text-sm italic text-center py-4">No bet submitted this week</p>}
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
