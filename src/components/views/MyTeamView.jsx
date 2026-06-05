import React from 'react';
import { CheckCircle, AlertCircle, AlertTriangle, Clock, Users, Edit3, Share2, User, ChevronLeft, Crown, DollarSign, BarChart3, History, Target, Sparkles } from 'lucide-react';
import BetSlipCard from '../BetSlipCard.jsx';
import PermissionBadge from '../PermissionBadge.jsx';
import { useApp } from '../../context/AppContext.jsx';

const MyTeamView = ({
  teamFinalised, depositPerMember,
  bettingOrder,
  pendingMembers,
  setShowInviteModal, setShowOrderModal, setShowFinaliseModal,
}) => {
  const {
    isLoggedIn, currentUser, viewedRole, navHistory, goBack,
    activeCompetitions, effectiveViewedCode, switchViewedCompetition,
    teamsInViewedComp, viewedMyTeam, switchViewedTeam, userCompetitions,
    teamMembers, myTeamName, myTeamData, allDepositsConfirmed,
    currentWeekNum, currentBettor, currentWeekBettorIdx,
    setShowBetAnalyzer, setShowLoginModal,
    approveMember, rejectMember, toggleDepositPaid, updateMemberRole,
    unfinaliseTeam, shareBet,
  } = useApp();

  return (
    <section className="pt-28 pb-16 px-4 sm:px-6">
      <div className="max-w-4xl mx-auto">
        {navHistory.length > 0 && (
          <button onClick={goBack} className="flex items-center gap-1.5 text-slate-500 hover:text-amber-400 text-sm font-semibold mb-6 transition-colors group">
            <ChevronLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" /> Back
          </button>
        )}
        {!isLoggedIn && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 mb-6 text-center">
            <p className="text-amber-300 text-sm">Showing demo data. <button onClick={() => setShowLoginModal(true)} className="underline font-semibold">Log in</button> to see your team.</p>
          </div>
        )}

        {/* Competition switcher */}
        {isLoggedIn && userCompetitions.length > 1 && (
          <div className="flex items-center gap-2 flex-wrap mb-3">
            <span className="text-xs text-slate-500 font-semibold">Competition:</span>
            {userCompetitions.map(c => (
              <button key={c.code} onClick={() => switchViewedCompetition(c.code)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${effectiveViewedCode === c.code ? 'bg-amber-500/20 text-amber-400 border-amber-500/40' : 'text-slate-400 border-slate-700 hover:border-slate-600 hover:text-slate-200'}`}>
                {c.name}
              </button>
            ))}
          </div>
        )}

        {/* Team toggle */}
        {isLoggedIn && teamsInViewedComp.length > 1 && (
          <div className="flex items-center gap-2 flex-wrap mb-5">
            <span className="text-xs text-slate-500 font-semibold">Team:</span>
            {teamsInViewedComp.map(t => (
              <button key={t.id} onClick={() => switchViewedTeam(t.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${viewedMyTeam?.id === t.id ? 'bg-blue-500/20 text-blue-400 border-blue-500/40' : 'text-slate-400 border-slate-700 hover:border-slate-600 hover:text-slate-200'}`}>
                {t.team_name}
              </button>
            ))}
          </div>
        )}

        {/* Team header */}
        <div className="flex flex-col sm:flex-row sm:items-start justify-between mb-6 gap-4">
          <div>
            <h1 className="text-3xl font-black mb-1">{myTeamName}</h1>
            <div className="flex items-center gap-2 flex-wrap">
              <PermissionBadge role={viewedRole} />
              <span className="text-slate-600 text-sm">·</span>
              <span className="text-slate-400 text-sm">#{myTeamData?.rank || 1} on leaderboard</span>
              {effectiveViewedCode && (
                <span className="text-xs bg-amber-500/10 border border-amber-500/20 text-amber-400 px-2 py-0.5 rounded-full">{activeCompetitions.find(c => c.code === effectiveViewedCode)?.name || effectiveViewedCode}</span>
              )}
              {!allDepositsConfirmed && <span className="bg-red-500/20 border border-red-500/40 text-red-400 text-xs px-2 py-0.5 rounded-full flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Deposits pending</span>}
              {allDepositsConfirmed && <span className="bg-green-500/20 border border-green-500/40 text-green-400 text-xs px-2 py-0.5 rounded-full flex items-center gap-1"><CheckCircle className="w-3 h-3" /> All deposits confirmed</span>}
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            {!teamFinalised && (
              <button onClick={() => setShowInviteModal(true)} className="bg-amber-500/10 border border-amber-500/30 hover:bg-amber-500/20 text-amber-400 px-3 py-2 rounded-lg text-xs font-semibold">Invite Member</button>
            )}
            {viewedRole === 'captain' && (
              <button onClick={() => setShowOrderModal(true)} className="bg-blue-500/10 border border-blue-500/30 hover:bg-blue-500/20 text-blue-400 px-3 py-2 rounded-lg text-xs font-semibold">Betting Order</button>
            )}
            {viewedRole === 'captain' && !teamFinalised && (
              <button onClick={() => setShowFinaliseModal(true)} className="bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 text-white px-3 py-2 rounded-lg text-xs font-bold flex items-center gap-1">
                <CheckCircle className="w-3.5 h-3.5" />Finalise Team
              </button>
            )}
            {viewedRole === 'captain' && teamFinalised && (
              <button onClick={unfinaliseTeam} className="bg-slate-800 border border-slate-700 text-slate-400 px-3 py-2 rounded-lg text-xs font-semibold">Re-open Team</button>
            )}
            <button onClick={() => setShowBetAnalyzer(true)} className="bg-gradient-to-r from-green-500 to-green-600 text-white px-3 py-2 rounded-lg text-xs font-bold">Submit Bet</button>
          </div>
        </div>

        {/* Captain tip */}
        {viewedRole === 'captain' && teamMembers.length <= 1 && !teamFinalised && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 mb-5 flex items-start gap-3">
            <Crown className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-amber-400 text-sm mb-1">Invite your team</p>
              <p className="text-slate-400 text-xs leading-relaxed">Share your Team Code <strong className="text-amber-300">{currentUser?.teamCode}</strong> with friends. Members you invite need your approval before joining.</p>
            </div>
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          {[['Members', teamMembers.length, 'text-white'], ['Total Won', myTeamData?.total || '$0', 'text-green-400'], ['Position', `#${myTeamData?.rank || 1}`, 'text-amber-400']].map(([l, v, c]) => (
            <div key={l} className="bg-slate-900 border border-slate-800 rounded-xl p-4 text-center">
              <p className="text-slate-500 text-xs mb-1">{l}</p>
              <p className={`text-xl font-black ${c}`}>{v}</p>
            </div>
          ))}
        </div>

        {/* Deposit banner */}
        {viewedRole === 'captain' && !teamFinalised && (
          <div className="bg-amber-950/20 border border-amber-500/30 rounded-xl p-4 mb-5 flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <DollarSign className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-bold text-amber-400 text-sm mb-1">Buy-In Not Yet Calculated</p>
                <p className="text-slate-400 text-xs leading-relaxed">Once you've confirmed all members have joined, click <strong className="text-amber-300">Finalise Team</strong> to lock in the roster and automatically calculate each member's deposit amount.</p>
              </div>
            </div>
            <button onClick={() => setShowFinaliseModal(true)} className="flex-shrink-0 bg-gradient-to-r from-green-600 to-green-700 text-white px-3 py-2 rounded-lg text-xs font-bold whitespace-nowrap">Finalise Team</button>
          </div>
        )}

        {/* Betting order tracker */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 mb-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-amber-400 flex items-center gap-1.5"><Target className="w-4 h-4" /> Betting Order</h3>
            {viewedRole === 'captain' && <button onClick={() => setShowOrderModal(true)} className="text-slate-500 hover:text-amber-400 text-xs flex items-center gap-1"><Edit3 className="w-3 h-3" />Edit</button>}
          </div>
          <div className="space-y-2">
            {bettingOrder.map((name, i) => {
              const isCurrent = i === currentWeekBettorIdx % bettingOrder.length;
              const isPast = i < currentWeekBettorIdx % bettingOrder.length;
              return (
                <div key={i} className={`flex items-center gap-3 rounded-lg px-3 py-2.5 ${isCurrent ? 'bg-amber-500/15 border border-amber-500/30' : 'bg-slate-800/30 border border-transparent'}`}>
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${isCurrent ? 'bg-amber-500 text-black' : isPast ? 'bg-green-500/20 border border-green-500/40 text-green-400' : 'bg-slate-800 text-slate-500'}`}>
                    {isPast ? '✓' : i + 1}
                  </div>
                  <div className="flex-1">
                    <p className={`text-sm font-semibold ${isCurrent ? 'text-amber-300' : isPast ? 'text-slate-400 line-through' : 'text-slate-300'}`}>{name}</p>
                    <p className="text-slate-600 text-xs">Week {i + 1}</p>
                  </div>
                  {isCurrent && <span className="text-amber-400 text-xs font-bold bg-amber-500/10 px-2 py-0.5 rounded-full">Current</span>}
                  {isPast && <span className="text-green-400 text-xs">Done</span>}
                </div>
              );
            })}
          </div>
        </div>

        {/* This week's bets */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 mb-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-green-400 flex items-center gap-1.5"><BarChart3 className="w-4 h-4" /> This Week's Bets</h3>
          </div>
          {(() => {
            const thisWeekBets = (myTeamData?.bets || []).filter(b => b.weekNumber === currentWeekNum + 1);
            return thisWeekBets.length > 0 ? (
              <div className="space-y-3">
                {thisWeekBets.map((bet, i) => (
                  <div key={i}>
                    <BetSlipCard bet={bet} />
                    <div className="flex justify-end mt-1.5">
                      <button
                        onClick={() => shareBet(bet)}
                        className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-amber-400 border border-slate-700 hover:border-amber-500/30 bg-slate-800 hover:bg-amber-500/8 px-3 py-1.5 rounded-lg transition-all"
                      >
                        <Share2 className="w-3 h-3" /> Share Bet
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <p className="text-slate-500 mb-3 text-sm">No bets submitted yet this week</p>
                {currentBettor && <p className="text-amber-400 text-xs mb-4">It's <strong>{currentBettor}</strong>'s turn to bet</p>}
                <button onClick={() => setShowBetAnalyzer(true)} className="bg-gradient-to-r from-green-500 to-green-600 text-white font-bold py-2 px-5 rounded-lg text-sm">Submit Bet</button>
              </div>
            );
          })()}
        </div>

        {/* Previous weeks bet history */}
        {(() => {
          const pastBets = (myTeamData?.bets || [])
            .filter(b => b.weekNumber < currentWeekNum + 1 && b.weekNumber > 0)
            .sort((a, b) => b.weekNumber - a.weekNumber);
          if (!pastBets.length) return null;
          return (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 mb-5">
              <h3 className="font-bold text-purple-400 mb-4 flex items-center gap-1.5"><History className="w-4 h-4" /> Previous Weeks</h3>
              <div className="space-y-3">
                {pastBets.map((bet, i) => {
                  const legs = bet.legs || [];
                  const status = (() => {
                    if (!legs.length) return bet.overallStatus || 'pending';
                    if (legs.some(l => l.status === 'in_progress')) return 'in_progress';
                    if (legs.some(l => l.status === 'pending'))     return 'pending';
                    if (!legs.every(l => ['won', 'lost', 'void'].includes(l.status))) return 'pending';
                    if (legs.every(l => l.status === 'won'))  return 'won';
                    if (legs.some(l => l.status === 'lost'))  return 'lost';
                    return 'partial';
                  })();
                  const resultCls = status === 'won' ? 'text-green-400 bg-green-500/15 border-green-500/40' : status === 'lost' ? 'text-red-400 bg-red-500/15 border-red-500/40' : status === 'partial' ? 'text-amber-400 bg-amber-500/15 border-amber-500/40' : 'text-slate-400 bg-slate-800 border-slate-700';
                  const resultLabel = status === 'won' ? 'WON' : status === 'lost' ? 'LOST' : status === 'partial' ? 'PARTIAL' : status === 'in_progress' ? 'LIVE' : 'PENDING';
                  return (
                    <div key={bet.id || i} className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden">
                      <div className="flex items-center gap-3 px-4 py-3">
                        <div className="w-9 h-9 rounded-lg bg-purple-500/15 border border-purple-500/30 flex items-center justify-center flex-shrink-0">
                          <span className="text-purple-400 font-black text-xs">W{bet.weekNumber}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-white text-sm font-semibold">{bet.type || 'Multi'}</span>
                            <span className={`text-xs font-bold px-2 py-0.5 rounded border ${resultCls}`}>{resultLabel}</span>
                            {bet.submittedBy && (
                              <span className="text-xs text-slate-500 bg-slate-800 border border-slate-700 rounded px-2 py-0.5 inline-flex items-center gap-1"><User className="w-3 h-3" /> {bet.submittedBy}</span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 mt-0.5">
                            <span className="text-slate-500 text-xs">Stake: <span className="text-slate-300">{bet.stake}</span></span>
                            {status === 'won' && <span className="text-green-400 text-xs font-semibold">Return: {bet.estimatedReturn}</span>}
                            <span className="text-slate-600 text-xs">{bet.submittedAt}</span>
                          </div>
                        </div>
                        <button
                          onClick={() => shareBet(bet)}
                          className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-amber-400 border border-slate-700 hover:border-amber-500/30 bg-slate-800 hover:bg-amber-500/8 px-3 py-1.5 rounded-lg transition-all flex-shrink-0"
                          title="Share this bet"
                        >
                          <Share2 className="w-3 h-3" /> Share
                        </button>
                      </div>
                      <div className="border-t border-slate-800">
                        <BetSlipCard bet={bet} compact onCheckBet={null} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* Pending approvals */}
        {pendingMembers.length > 0 && (
          <div className="bg-orange-950/20 border border-orange-500/30 rounded-xl p-5 mb-5">
            <h3 className="font-bold text-orange-400 mb-3 flex items-center gap-1.5"><Clock className="w-4 h-4" /> Pending Approvals ({pendingMembers.length})</h3>
            <div className="space-y-2">
              {pendingMembers.map(m => (
                <div key={m.phone} className="flex items-center justify-between bg-slate-950 rounded-lg px-3 py-2.5">
                  <div>
                    <p className="font-semibold text-sm">{m.name}</p>
                    <p className="text-slate-500 text-xs">{m.phone} · Joined {m.joinedAt}</p>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => approveMember(m.user_id)} className="bg-green-500/20 hover:bg-green-500/30 border border-green-500/50 text-green-400 px-3 py-1 rounded-lg text-xs font-semibold flex items-center gap-1"><CheckCircle className="w-3 h-3" />Approve</button>
                    <button onClick={() => rejectMember(m.user_id)} className="bg-red-500/20 hover:bg-red-500/30 border border-red-500/50 text-red-400 px-3 py-1 rounded-lg text-xs font-semibold flex items-center gap-1"><AlertCircle className="w-3 h-3" />Reject</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Team members */}
        <div className={`border rounded-xl p-5 ${teamFinalised ? 'bg-green-950/10 border-green-500/20' : 'bg-slate-900 border-slate-800'}`}>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              {teamFinalised && <CheckCircle className="w-4 h-4 text-green-400" />}
              <h3 className={`font-bold flex items-center gap-1.5 ${teamFinalised ? 'text-green-400' : 'text-amber-400'}`}><Users className="w-4 h-4" /> Team Members</h3>
              {teamFinalised && depositPerMember && (
                <span className="text-xs bg-green-500/15 border border-green-500/30 text-green-400 px-2 py-0.5 rounded-full font-semibold">${depositPerMember.toLocaleString()} / member</span>
              )}
            </div>
            {teamFinalised && viewedRole === 'captain' && (
              <button onClick={unfinaliseTeam} className="text-slate-600 hover:text-slate-400 text-xs border border-slate-700 px-2 py-1 rounded-lg">Re-open</button>
            )}
          </div>
          <div className="space-y-2">
            {teamMembers.map(m => (
              <div key={m.user_id || m.phone} className={`rounded-xl px-3 py-3 flex items-start gap-3 ${teamFinalised ? (m.depositPaid ? 'bg-green-950/30 border border-green-500/20' : 'bg-red-950/20 border border-red-500/15') : 'bg-slate-950'}`}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0 ${teamFinalised ? (m.depositPaid ? 'bg-green-500 text-black' : 'bg-red-500/20 border border-red-500/40 text-red-400') : 'bg-amber-500/20 border border-amber-500/30 text-amber-400'}`}>
                  {teamFinalised ? (m.depositPaid ? '✓' : '!') : (m.name || '?').charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="font-semibold text-sm truncate">{m.name}</p>
                    {m.role === 'captain' && <Crown className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />}
                  </div>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <PermissionBadge role={m.role} />
                    {teamFinalised && depositPerMember ? (
                      m.depositPaid
                        ? <span className="text-green-400 text-xs font-bold flex items-center gap-0.5"><CheckCircle className="w-3 h-3" />${depositPerMember.toLocaleString()} paid</span>
                        : <span className="text-red-400 text-xs flex items-center gap-0.5"><AlertCircle className="w-3 h-3" />Unpaid — ${depositPerMember.toLocaleString()} owing</span>
                    ) : (
                      m.depositPaid
                        ? <span className="text-green-400 text-xs flex items-center gap-0.5"><CheckCircle className="w-3 h-3" />Deposit paid</span>
                        : <span className="text-red-400 text-xs flex items-center gap-0.5"><AlertCircle className="w-3 h-3" />Deposit pending</span>
                    )}
                    {m.canBet && m.role !== 'view-only' && <span className="text-blue-400 text-xs">Can bet</span>}
                  </div>
                </div>
                {viewedRole === 'captain' && m.role !== 'captain' && (
                  <div className="flex gap-1 flex-shrink-0">
                    <select value={m.role} onChange={e => updateMemberRole(m.phone, e.target.value)} className="bg-slate-950 border border-slate-700 text-slate-300 text-xs rounded px-1.5 py-1 focus:outline-none focus:border-amber-500/50">
                      <option value="member">Member</option>
                      <option value="view-only">View Only</option>
                    </select>
                    <button onClick={() => toggleDepositPaid(m.phone)} className={`text-xs px-2 py-1 rounded border ${m.depositPaid ? 'border-red-500/30 text-red-400 hover:bg-red-500/10' : 'border-green-500/30 text-green-400 hover:bg-green-500/10'}`}>
                      {m.depositPaid ? 'Mark Unpaid' : 'Mark Paid'}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
          {/* Payment summary */}
          {teamFinalised && depositPerMember && teamMembers.length > 0 && (
            <div className="mt-4 pt-3 border-t border-green-500/15 flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-500">{teamMembers.filter(m => m.depositPaid).length} of {teamMembers.length} paid</p>
                <p className="text-xs text-slate-600 mt-0.5">Collected: <span className="text-green-400 font-bold">${(teamMembers.filter(m => m.depositPaid).length * depositPerMember).toLocaleString()}</span></p>
              </div>
              {teamMembers.every(m => m.depositPaid)
                ? <span className="bg-green-500 text-black text-xs font-black px-3 py-1 rounded-full flex items-center gap-1"><Sparkles className="w-3 h-3" /> All Paid!</span>
                : <span className="text-xs text-red-400">{teamMembers.filter(m => !m.depositPaid).length} still owing</span>
              }
            </div>
          )}
        </div>
      </div>
    </section>
  );
};

export default MyTeamView;
