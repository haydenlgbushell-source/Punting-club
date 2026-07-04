import React, { useState, useMemo, useEffect } from 'react';
import { Trophy, Users, ChevronLeft, Clock, Crown, ChevronDown } from 'lucide-react';
import Badge from '../Badge.jsx';
import LegDot from '../LegDot.jsx';
import BetSlipCard from '../BetSlipCard.jsx';
import SwitcherDropdown from '../SwitcherDropdown.jsx';
import { useApp } from '../../context/AppContext.jsx';

const parseCurrency = (s) => {
  if (typeof s === 'number') return s;
  return parseFloat(String(s).replace(/[^0-9.\-]/g, '')) || 0;
};

// Live "bets close in …" countdown to the given cutoff Date.
const Countdown = ({ to }) => {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(id);
  }, []);
  const ms = to.getTime() - now;
  if (ms <= 0) return null;
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const parts = d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
  return (
    <span className="inline-flex items-center gap-1 text-brand-700 font-semibold">
      <Clock className="w-3 h-3" /> Closes in {parts}
    </span>
  );
};

// One shimmering placeholder row for the initial leaderboard load.
const SkeletonRow = () => (
  <div className="rounded-xl border border-gray-200 bg-white px-3 py-3 animate-pulse">
    <div className="flex items-center gap-2.5">
      <div className="w-8 h-8 rounded-lg bg-gray-200 flex-shrink-0" />
      <div className="flex-1 space-y-1.5">
        <div className="h-3 bg-gray-200 rounded w-32" />
        <div className="h-2.5 bg-gray-100 rounded w-20" />
      </div>
      <div className="h-4 bg-gray-200 rounded w-16" />
    </div>
  </div>
);

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
  // Show shimmer rows until the first data arrives (or a short grace period lapses).
  const [showSkeleton, setShowSkeleton] = useState(enrichedLeaderboardTeams.length === 0);
  useEffect(() => {
    if (enrichedLeaderboardTeams.length) { setShowSkeleton(false); return; }
    const t = setTimeout(() => setShowSkeleton(false), 1500);
    return () => clearTimeout(t);
  }, [enrichedLeaderboardTeams.length]);

  // Toggle a team row open, usable from click or keyboard.
  const toggleRow = (idx) => setSelectedTeamIdx(prev => (prev === idx ? null : idx));
  const rowKeyDown = (e, idx) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleRow(idx); }
  };

  const leaderTotal = useMemo(() => {
    if (!enrichedLeaderboardTeams.length) return 0;
    return Math.max(...enrichedLeaderboardTeams.map(t => parseCurrency(t.total)));
  }, [enrichedLeaderboardTeams]);

  const getComputedStatus = (weekBet) => {
    const legs = weekBet?.legs || [];
    if (!legs.length) return weekBet?.overallStatus || 'pending';
    if (legs.some(l => l.status === 'in_progress')) return 'in_progress';
    if (legs.some(l => l.status === 'pending')) return 'pending';
    if (!legs.every(l => ['won', 'lost', 'void'].includes(l.status))) return 'pending';
    if (legs.every(l => l.status === 'won')) return 'won';
    if (legs.some(l => l.status === 'lost')) return 'lost';
    return 'partial';
  };

  const getRowBg = (isMe, computedStatus) => {
    if (isMe) return 'border-brand-500/40 bg-brand-500/5';
    if (computedStatus === 'won') return 'border-green-500/20 bg-green-50';
    if (computedStatus === 'lost') return 'border-red-500/20 bg-red-50';
    if (computedStatus === 'partial' || computedStatus === 'in_progress') return 'border-brand-200 bg-brand-50';
    return 'border-gray-200 bg-white';
  };

  const comp = activeCompetitions.find(c => c.code === effectiveViewedCode);
  const weekLabel = (() => {
    const wk = comp?.start_date ? calcCurrentWeek(comp.start_date) : '—';
    const total = comp?.weeks || '—';
    return `Week ${wk} of ${total}`;
  })();
  const cutoffLabel = nextWedCutoff.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });

  return (
    <section className="pt-28 pb-16 px-0 sm:px-0">
      <div className="max-w-5xl mx-auto px-2 sm:px-6">
        {navHistory.length > 0 && (
          <button onClick={goBack} className="flex items-center gap-1.5 text-gray-500 hover:text-brand-700 text-sm font-semibold mb-4 px-2 transition-colors group">
            <ChevronLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" /> Back
          </button>
        )}

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-start justify-between mb-6 gap-4 px-2">
          <div>
            <h1 className="text-3xl font-black mb-1">Live Leaderboard</h1>
            <p className="text-slate-500 text-sm flex items-center gap-1.5 flex-wrap">
              {weekLabel} · <Countdown to={nextWedCutoff} />
              <span className="text-slate-400">(Wed 12:00 AEST, {cutoffLabel})</span>
            </p>
            {lastChecked && (
              <p className="text-slate-400 text-xs mt-0.5" title={resultLog.slice(0, 3).map(l => `${l.time} — ${l.message}`).join('\n')}>
                Results last checked {lastChecked.toLocaleTimeString()}
              </p>
            )}
          </div>
          {isLoggedIn && (
            <div className="flex gap-2 flex-wrap">
              <button onClick={() => setShowBetAnalyzer(true)} className="bg-gold-500 hover:bg-gold-400 text-brand-950 px-4 py-2 rounded-lg font-bold text-xs transition-colors">
                Submit Bet
              </button>
            </div>
          )}
        </div>

        {/* Competition switcher */}
        {activeCompetitions.length > 1 && (
          <SwitcherDropdown
            label="Competition"
            items={activeCompetitions}
            selectedValue={effectiveViewedCode}
            onSelect={switchViewedCompetition}
            className="mb-3 px-2"
          />
        )}

        {/* Team toggle */}
        {isLoggedIn && teamsInViewedComp.length > 1 && (
          <SwitcherDropdown
            label="Team"
            items={teamsInViewedComp}
            selectedValue={viewedMyTeam?.id}
            onSelect={switchViewedTeam}
            valueKey="id"
            labelKey="team_name"
            className="mb-3 px-2"
          />
        )}

        {/* View toggle */}
        <div className="flex gap-1 mb-4 px-2">
          {[['current', 'This Week'], ['season', 'Season View']].map(([v, l]) => (
            <button key={v} onClick={() => setLeaderboardView(v)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border ${leaderboardView === v ? 'bg-brand-50 text-brand-700 border-brand-200' : 'text-slate-500 hover:text-slate-700 border-transparent'}`}>{l}</button>
          ))}
        </div>

        {/* ── DESKTOP COLUMN HEADERS (hidden on mobile) ── */}
        <div className="hidden md:grid grid-cols-12 gap-2 px-4 mb-1 text-xs font-semibold text-slate-400 uppercase tracking-wider">
          <div className="col-span-1">#</div>
          <div className="col-span-3">Team</div>
          <div className="col-span-1 text-right">Total</div>
          <div className="col-span-1 text-right">Behind</div>
          <div className="col-span-6 pl-3 border-l border-gray-200">
            {leaderboardView === 'current' ? "This Week's Bet" : 'Week History'}
          </div>
        </div>

        {/* ── TEAM ROWS ── */}
        <div className="space-y-1.5">
          {enrichedLeaderboardTeams.length === 0 && showSkeleton && (
            <>{[0, 1, 2, 3, 4].map(i => <SkeletonRow key={i} />)}</>
          )}
          {enrichedLeaderboardTeams.length === 0 && !showSkeleton && (
            <div className="text-center py-16">
              <Trophy className="w-16 h-16 text-brand-700/30 mb-4 mx-auto" />
              <p className="text-slate-500 font-semibold text-lg">No teams yet</p>
              <p className="text-slate-500 text-sm mt-1">Teams will appear here once they register and submit bets.</p>
            </div>
          )}
          {enrichedLeaderboardTeams.map((team, idx) => {
            const isMe = isLoggedIn && team.team === myTeamName;
            const currentWeek = currentWeekNum + 1;
            const weekBet = team.bets.find(b => b.weekNumber === currentWeek) || null;
            const isOpen = selectedTeamIdx === idx;
            const computedStatus = getComputedStatus(weekBet);
            const rowBg = getRowBg(isMe, computedStatus);
            const teamTotal = parseCurrency(team.total);
            const behind = leaderTotal - teamTotal;

            return (
              <div key={idx} className={`rounded-xl border overflow-hidden transition-all ${rowBg} ${isMe ? 'ring-1 ring-brand-400/30' : ''}`}>

                {/* ── MOBILE CARD (shown below md) ── */}
                <div
                  className="md:hidden cursor-pointer active:bg-gray-100/60 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                  role="button" tabIndex={0} aria-expanded={isOpen}
                  aria-label={`${team.team}, rank ${team.rank}, ${team.total}. Tap to ${isOpen ? 'collapse' : 'expand'} details`}
                  onClick={() => toggleRow(idx)}
                  onKeyDown={(e) => rowKeyDown(e, idx)}
                >
                  {/* Top row: rank, name, total */}
                  <div className="flex items-center gap-2.5 px-3 pt-3 pb-1">
                    <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${team.color} flex items-center justify-center font-black text-white text-sm flex-shrink-0`}>
                      {team.rank}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-bold text-sm truncate flex items-center gap-1">
                        {team.team}
                        {isMe && <span className="text-brand-600 text-xs flex-shrink-0">(You)</span>}
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="font-black text-brand-700 text-base leading-tight">{team.total}</div>
                    </div>
                  </div>

                  {/* Bottom row: behind, members, status, chevron */}
                  <div className="flex items-center gap-2 px-3 pb-3 pt-0.5">
                    <span className="text-slate-400 text-xs">{team.members} members</span>
                    {behind > 0 && (
                      <>
                        <span className="text-slate-300 text-xs">·</span>
                        <span className="text-slate-500 text-xs font-semibold">
                          ${behind.toFixed(2)} behind
                        </span>
                      </>
                    )}
                    {behind === 0 && team.rank === 1 && (
                      <>
                        <span className="text-slate-300 text-xs">·</span>
                        <span className="text-green-600 text-xs font-bold">Leader</span>
                      </>
                    )}
                    <div className="ml-auto flex items-center gap-1.5">
                      {weekBet && <Badge status={computedStatus} />}
                      <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                    </div>
                  </div>
                </div>

                {/* ── DESKTOP ROW (shown at md+) ── */}
                <div
                  className="hidden md:grid grid-cols-12 gap-2 items-center px-3 py-3 cursor-pointer hover:bg-gray-100/40 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 rounded-lg"
                  role="button" tabIndex={0} aria-expanded={isOpen}
                  aria-label={`${team.team}, rank ${team.rank}, ${team.total}. Activate to ${isOpen ? 'collapse' : 'expand'} details`}
                  onClick={() => toggleRow(idx)}
                  onKeyDown={(e) => rowKeyDown(e, idx)}
                >
                  <div className="col-span-1">
                    <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${team.color} flex items-center justify-center font-black text-white text-sm`}>{team.rank}</div>
                  </div>
                  <div className="col-span-3 min-w-0 pl-1">
                    <div className="font-bold text-sm truncate flex items-center gap-1">
                      {team.team}
                      {isMe && <span className="text-brand-600 text-xs flex-shrink-0">(You)</span>}
                    </div>
                    <div className="text-slate-400 text-xs">{team.members} members</div>
                  </div>
                  <div className="col-span-1 text-right">
                    <div className="font-bold text-brand-600 text-sm">{team.total}</div>
                  </div>
                  <div className="col-span-1 text-right">
                    {behind > 0
                      ? <span className="text-slate-500 text-xs font-semibold">${behind.toFixed(2)}</span>
                      : <span className="text-green-600 text-xs font-bold">{team.rank === 1 ? 'Leader' : '—'}</span>
                    }
                  </div>
                  <div className="col-span-6 pl-3 border-l border-gray-200">
                    {leaderboardView === 'current' ? (
                      weekBet ? (
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge status={computedStatus} />
                          <span className="text-slate-900 text-xs font-semibold">{weekBet.type}</span>
                          <span className="text-slate-500 text-xs">·</span>
                          <span className="text-green-600 text-xs font-semibold">{weekBet.stake}</span>
                          <span className="text-slate-500 text-xs">/</span>
                          <span className="text-green-600 text-xs font-bold">{weekBet.estimatedReturn || weekBet.return || 'N/A'}</span>
                          {weekBet.legs?.length > 0 && (
                            <div className="flex gap-1 flex-wrap">
                              {weekBet.legs.map((leg, li) => <LegDot key={li} leg={leg} />)}
                            </div>
                          )}
                        </div>
                      ) : <span className="text-slate-500 text-xs italic">No bet submitted</span>
                    ) : (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {team.weekHistory?.length > 0 ? team.weekHistory.map((result, wi) => {
                          const cls = result === 'W' ? 'bg-green-100 border-green-400 text-green-700' : result === 'L' ? 'bg-red-100 border-red-400 text-red-700' : result === 'P' ? 'bg-brand-100 border-brand-400 text-brand-700' : 'bg-gray-100 border-gray-300 text-slate-400';
                          return <div key={wi} title={`Week ${wi + 1}`} className={`w-7 h-7 rounded-md border flex items-center justify-center text-xs font-bold ${cls}`}>{result || '–'}</div>;
                        }) : <span className="text-slate-500 text-xs italic">No history yet</span>}
                      </div>
                    )}
                  </div>
                </div>

                {/* ── EXPANDED DETAIL (shared mobile + desktop) ── */}
                {isOpen && (
                  <div className="border-t border-gray-200 bg-gray-50 px-3 py-3">
                    {/* Week-by-week breakdown (mobile: always show; desktop: show in current view) */}
                    {leaderboardView === 'current' && team.weekHistory?.length > 0 && (
                      <div className="mb-3 pb-3 border-b border-gray-200">
                        <p className="text-slate-500 text-xs uppercase tracking-wider mb-2">Week History</p>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {team.weekHistory.map((result, wi) => {
                            const cls = result === 'W' ? 'bg-green-100 border-green-400 text-green-700' : result === 'L' ? 'bg-red-100 border-red-400 text-red-700' : result === 'P' ? 'bg-brand-100 border-brand-400 text-brand-700' : 'bg-gray-100 border-gray-300 text-slate-400';
                            return <div key={wi} title={`Week ${wi + 1}`} className={`w-7 h-7 rounded-md border flex items-center justify-center text-xs font-bold ${cls}`}>{result || '–'}</div>;
                          })}
                        </div>
                      </div>
                    )}

                    {/* All bets grid for mobile season view */}
                    {leaderboardView === 'season' && team.bets?.length > 0 && (
                      <div className="mb-3 pb-3 border-b border-gray-200 md:hidden">
                        <p className="text-slate-500 text-xs uppercase tracking-wider mb-2">Bet History</p>
                        <div className="grid grid-cols-2 gap-2">
                          {team.bets.map((bet, bi) => {
                            const st = getComputedStatus(bet);
                            return (
                              <div key={bi} className="bg-white rounded-lg border border-gray-200 p-2">
                                <div className="flex items-center justify-between mb-1">
                                  <span className="text-xs font-semibold text-slate-600">Wk {bet.weekNumber}</span>
                                  <Badge status={st} />
                                </div>
                                <div className="text-xs text-slate-500">{bet.stake} → {bet.estimatedReturn || 'N/A'}</div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Member roster */}
                    {team.memberList?.length > 0 && (
                      <div className="mb-3 pb-3 border-b border-gray-200">
                        <p className="text-slate-500 text-xs uppercase tracking-wider mb-2 flex items-center gap-1"><Users className="w-3 h-3" /> Members</p>
                        <div className="flex flex-wrap gap-2">
                          {team.memberList.map((m, mi) => (
                            <div key={mi} className="flex items-center gap-1.5 bg-gray-100 rounded-full px-2.5 py-1">
                              <div className="w-5 h-5 rounded-full bg-brand-500/20 border border-brand-200 flex items-center justify-center text-brand-600 font-bold text-xs flex-shrink-0">
                                {(m.name || m).charAt(0).toUpperCase()}
                              </div>
                              <span className="text-xs text-slate-700 font-medium">{m.name || m}</span>
                              {m.role === 'captain' && <Crown className="w-3 h-3 text-brand-600" />}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Current week bet slip */}
                    {weekBet ? <BetSlipCard bet={weekBet} /> : <p className="text-slate-400 text-sm italic text-center py-4">No bet submitted this week</p>}
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
