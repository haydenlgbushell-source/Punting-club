import React, { useState } from 'react';
import { betStatus } from '../../lib/betMath.js';
import { CheckCircle, AlertCircle, AlertTriangle, Clock, Users, Edit3, Share2, User, ChevronLeft, ChevronDown, Crown, DollarSign, BarChart3, History, Target, Sparkles } from 'lucide-react';
import BetSlipCard from '../BetSlipCard.jsx';
import PermissionBadge from '../PermissionBadge.jsx';
import SwitcherDropdown from '../SwitcherDropdown.jsx';
import { useApp } from '../../context/AppContext.jsx';
import { formatAuDate } from '../../lib/auTime.js';

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

  const [expandedPastBet, setExpandedPastBet] = useState(null);
  const [openMember, setOpenMember] = useState(null); // member whose captain actions are showing

  return (
    <section className="pt-28 pb-16 px-4 sm:px-6">
      <div className="max-w-4xl mx-auto">
        {navHistory.length > 0 && (
          <button onClick={goBack} className="flex items-center gap-1.5 text-slate-500 hover:text-brand-700 text-sm font-semibold mb-6 transition-colors group">
            <ChevronLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" /> Back
          </button>
        )}
        {!isLoggedIn && (
          <div className="bg-brand-500/10 border border-brand-200 rounded-xl p-4 mb-6 text-center">
            <p className="text-brand-700 text-sm">You're not logged in. <button onClick={() => setShowLoginModal(true)} className="underline font-semibold">Log in</button> to see your team.</p>
          </div>
        )}

        {/* Competition & Team dropdowns */}
        {isLoggedIn && (userCompetitions.length > 1 || teamsInViewedComp.length > 1) && (
          <div className="flex flex-col sm:flex-row gap-2 mb-5">
            {userCompetitions.length > 1 && (
              <SwitcherDropdown
                label="Competition"
                items={userCompetitions}
                selectedValue={effectiveViewedCode}
                onSelect={switchViewedCompetition}
              />
            )}
            {teamsInViewedComp.length > 1 && (
              <SwitcherDropdown
                label="Team"
                items={teamsInViewedComp}
                selectedValue={viewedMyTeam?.id}
                onSelect={switchViewedTeam}
                valueKey="id"
                labelKey="team_name"
              />
            )}
          </div>
        )}

        {/* Team header */}
        <div className="flex flex-col sm:flex-row sm:items-start justify-between mb-6 gap-4">
          <div className="min-w-0">
            <h1 className="text-3xl font-black mb-1.5 truncate">{myTeamName}</h1>
            <div className="flex items-center gap-2 flex-wrap text-sm">
              <PermissionBadge role={viewedRole} />
              {myTeamData?.rank && <span className="text-slate-500">#{myTeamData.rank} on leaderboard</span>}
              {effectiveViewedCode && userCompetitions.length <= 1 && (
                <span className="text-xs bg-brand-500/10 border border-brand-500/20 text-brand-600 px-2 py-0.5 rounded-full">{activeCompetitions.find(c => c.code === effectiveViewedCode)?.name || effectiveViewedCode}</span>
              )}
            </div>
            {!allDepositsConfirmed && (
              <span className="inline-flex items-center gap-1 bg-red-100 border border-red-300 text-red-700 text-xs px-2 py-1 rounded-full mt-2"><AlertTriangle className="w-3 h-3" /> Deposits pending</span>
            )}
            {allDepositsConfirmed && (
              <span className="inline-flex items-center gap-1 bg-green-100 border border-green-300 text-green-700 text-xs px-2 py-1 rounded-full mt-2"><CheckCircle className="w-3 h-3" /> All deposits confirmed</span>
            )}
          </div>
          {/* Header keeps team-management only — betting actions live in the bets card below */}
          <div className="flex gap-2 flex-wrap sm:justify-end">
            {!teamFinalised && (
              <button onClick={() => setShowInviteModal(true)} className="bg-brand-500/10 border border-brand-200 hover:bg-brand-500/20 text-brand-600 px-3 py-2 rounded-lg text-xs font-semibold">Invite Member</button>
            )}
          </div>
        </div>

        {/* Captain tip */}
        {viewedRole === 'captain' && teamMembers.length <= 1 && !teamFinalised && (
          <div className="bg-brand-500/10 border border-brand-200 rounded-xl p-4 mb-5 flex items-start gap-3">
            <Crown className="w-5 h-5 text-brand-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-brand-600 text-sm mb-1">Invite your team</p>
              <p className="text-slate-500 text-xs leading-relaxed">Share your Team Code <strong className="text-brand-700">{currentUser?.teamCode}</strong> with friends. Members you invite need your approval before joining.</p>
            </div>
          </div>
        )}

        {/* Season summary */}
        <div className="grid grid-cols-3 gap-2 bg-brand-900 text-white rounded-2xl px-4 py-4 mb-4">
          {[['Position', `#${myTeamData?.rank || 1}`], ['Total won', myTeamData?.total || '$0'], ['Members', teamMembers.length]].map(([l, v]) => (
            <div key={l} className="min-w-0">
              <p className="text-[11px] uppercase tracking-wider font-bold text-brand-200">{l}</p>
              <p className="font-display text-2xl sm:text-3xl font-extrabold leading-tight tabular-nums truncate">{v}</p>
            </div>
          ))}
        </div>

        {/* Deposit banner */}
        {viewedRole === 'captain' && !teamFinalised && (
          <div className="bg-brand-50 border border-brand-200 rounded-xl p-4 mb-5 flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <DollarSign className="w-5 h-5 text-brand-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-bold text-brand-600 text-sm mb-1">Buy-In Not Yet Calculated</p>
                <p className="text-slate-500 text-xs leading-relaxed">Once you've confirmed all members have joined, click <strong className="text-brand-700">Finalise Team</strong> to lock in the roster and automatically calculate each member's deposit amount.</p>
              </div>
            </div>
            <button onClick={() => setShowFinaliseModal(true)} className="flex-shrink-0 bg-brand-700 hover:bg-brand-600 text-white px-3 py-2 rounded-lg text-xs font-bold whitespace-nowrap">Finalise Team</button>
          </div>
        )}

        {/* Betting order tracker */}
        <div className="bg-white border border-gray-200 rounded-xl p-5 mb-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-slate-900 flex items-center gap-1.5"><Target className="w-4 h-4 text-brand-600" /> Betting order</h3>
            {viewedRole === 'captain' && <button onClick={() => setShowOrderModal(true)} className="text-slate-500 hover:text-brand-700 text-xs flex items-center gap-1"><Edit3 className="w-3 h-3" />Edit</button>}
          </div>
          <div className="space-y-2">
            {bettingOrder.map(({ name, user_id }, i) => {
              const isCurrent = i === currentWeekBettorIdx % bettingOrder.length;
              const isPast = i < currentWeekBettorIdx % bettingOrder.length;
              return (
                <div key={user_id || i} className={`flex items-center gap-3 rounded-lg px-3 py-2.5 ${isCurrent ? 'bg-brand-500/15 border border-brand-200' : 'bg-gray-100/30 border border-transparent'}`}>
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${isCurrent ? 'bg-brand-600 text-white' : isPast ? 'bg-green-100 border border-green-300 text-green-700' : 'bg-gray-100 text-slate-500'}`}>
                    {isPast ? '✓' : i + 1}
                  </div>
                  <div className="flex-1">
                    <p className={`text-sm font-semibold ${isCurrent ? 'text-brand-500' : isPast ? 'text-slate-500 line-through' : 'text-slate-700'}`}>{name}</p>
                    <p className="text-slate-400 text-xs">Week {i + 1}</p>
                  </div>
                  {isCurrent && <span className="text-brand-600 text-xs font-bold bg-brand-500/10 px-2 py-0.5 rounded-full">Current</span>}
                  {isPast && <span className="text-green-400 text-xs">Done</span>}
                </div>
              );
            })}
          </div>
        </div>

        {/* This week's bets */}
        <div className="bg-white border border-gray-200 rounded-xl p-5 mb-5">
          {(() => {
            const thisWeekBets = (myTeamData?.bets || []).filter(b => b.weekNumber === currentWeekNum + 1);
            return (
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold text-slate-900 flex items-center gap-1.5"><BarChart3 className="w-4 h-4 text-brand-600" /> This week's bet</h3>
                {thisWeekBets.length > 0 && (
                  <button onClick={() => setShowBetAnalyzer(true)} className="text-xs font-semibold text-brand-600 hover:text-brand-700 border border-brand-200 hover:bg-brand-500/10 px-2.5 py-1.5 rounded-lg transition-all">+ Add Bet</button>
                )}
              </div>
            );
          })()}
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
                        className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-brand-700 border border-gray-300 hover:border-brand-200 bg-gray-100 hover:bg-brand-500/8 px-3 py-1.5 rounded-lg transition-all"
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
                {currentBettor && <p className="text-brand-600 text-xs mb-4">It's <strong>{currentBettor}</strong>'s turn to bet</p>}
                <button onClick={() => setShowBetAnalyzer(true)} className="bg-gold-500 hover:bg-gold-400 text-brand-950 font-bold py-2 px-5 rounded-lg text-sm">Submit Bet</button>
              </div>
            );
          })()}
        </div>

        {/* Previous weeks bet history — one line per bet, tap to see the legs */}
        {(() => {
          const pastBets = (myTeamData?.bets || [])
            .filter(b => b.weekNumber < currentWeekNum + 1 && b.weekNumber > 0)
            .sort((a, b) => b.weekNumber - a.weekNumber);
          if (!pastBets.length) return null;
          return (
            <div className="bg-white border border-gray-200 rounded-xl p-4 sm:p-5 mb-5">
              <h3 className="font-bold text-slate-900 mb-1 flex items-center gap-1.5"><History className="w-4 h-4 text-brand-600" /> Bet history</h3>
              <ul className="divide-y divide-gray-100">
                {pastBets.map((bet, i) => {
                  const status = betStatus(bet.legs, bet.overallStatus);
                  const key = bet.id || i;
                  const isExpanded = expandedPastBet === key;
                  const date = bet.submittedAtIso ? formatAuDate(bet.submittedAtIso) : '';
                  const result = status === 'won'
                    ? { amount: `+${bet.actualReturn || bet.estimatedReturn}`, label: 'Won', cls: 'text-green-700' }
                    : status === 'lost'
                    ? { amount: `−${bet.stake}`, label: 'Lost', cls: 'text-red-700' }
                    : status === 'void'
                    ? { amount: bet.stake, label: 'Refunded', cls: 'text-slate-500' }
                    : { amount: bet.stake, label: status === 'in_progress' ? 'Live' : 'Pending', cls: 'text-slate-500' };
                  return (
                    <li key={key}>
                      <button
                        type="button"
                        onClick={() => setExpandedPastBet(isExpanded ? null : key)}
                        aria-expanded={isExpanded}
                        className="w-full grid grid-cols-[2.25rem_minmax(0,1fr)_auto_1rem] items-center gap-3 py-3 text-left"
                      >
                        <span className="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center text-slate-900 font-black text-xs">W{bet.weekNumber}</span>
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold text-slate-900 truncate">{bet.type || 'Multi'}{bet.submittedBy ? ` · ${bet.submittedBy}` : ''}</span>
                          <span className="block text-xs text-slate-500 truncate">{[date, `${bet.stake} stake`].filter(Boolean).join(' · ')}</span>
                        </span>
                        <span className={`text-right tabular-nums ${result.cls}`}>
                          <span className="block text-sm font-extrabold">{result.amount}</span>
                          <span className="block text-[10px] font-bold uppercase tracking-wide">{result.label}</span>
                        </span>
                        <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                      </button>
                      {isExpanded && (
                        <div className="pb-3">
                          <div className="border border-gray-200 rounded-xl overflow-hidden">
                            <BetSlipCard bet={bet} compact onCheckBet={null} />
                          </div>
                          <div className="flex justify-end mt-2">
                            <button
                              type="button"
                              onClick={() => shareBet(bet)}
                              className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-brand-700 border border-gray-300 px-3 py-1.5 rounded-lg"
                            >
                              <Share2 className="w-3 h-3" /> Share bet
                            </button>
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })()}

        {/* Pending approvals */}
        {pendingMembers.length > 0 && (
          <div className="bg-brand-50 border border-brand-200 rounded-xl p-5 mb-5">
            <h3 className="font-bold text-brand-600 mb-3 flex items-center gap-1.5"><Clock className="w-4 h-4" /> Pending Approvals ({pendingMembers.length})</h3>
            <div className="space-y-2">
              {pendingMembers.map(m => (
                <div key={m.phone} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2.5">
                  <div>
                    <p className="font-semibold text-sm">{m.name}</p>
                    <p className="text-slate-500 text-xs">{m.phone} · Joined {m.joinedAt}</p>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => approveMember(m.user_id)} className="bg-green-50 hover:bg-green-100 border border-green-300 text-green-700 px-3 py-1 rounded-lg text-xs font-semibold flex items-center gap-1"><CheckCircle className="w-3 h-3" />Approve</button>
                    <button onClick={() => rejectMember(m.user_id)} className="bg-red-50 hover:bg-red-100 border border-red-300 text-red-700 px-3 py-1 rounded-lg text-xs font-semibold flex items-center gap-1"><AlertCircle className="w-3 h-3" />Reject</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Team members */}
        {(() => {
          const paidCount = teamMembers.filter(m => m.depositPaid).length;
          const owingCount = teamMembers.length - paidCount;
          const showMoney = teamFinalised && depositPerMember;
          return (
            <div className="bg-white border border-gray-200 rounded-xl p-4 sm:p-5">
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-bold text-slate-900 flex items-center gap-1.5"><Users className="w-4 h-4 text-brand-600" /> Members</h3>
                <div className="flex items-center gap-2">
                  {showMoney && <span className="text-xs text-slate-500 whitespace-nowrap">${depositPerMember.toLocaleString('en-AU')} each</span>}
                  {teamFinalised && viewedRole === 'captain' && (
                    <button type="button" onClick={unfinaliseTeam} className="text-slate-500 hover:text-slate-700 text-xs border border-gray-300 px-2 py-1 rounded-lg whitespace-nowrap">Re-open</button>
                  )}
                </div>
              </div>

              {showMoney && teamMembers.length > 0 && (
                <div className="mt-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-600">{paidCount} of {teamMembers.length} paid · ${(paidCount * depositPerMember).toLocaleString('en-AU')} collected</span>
                    {owingCount === 0
                      ? <span className="text-green-700 font-bold flex items-center gap-1"><Sparkles className="w-3 h-3" /> All paid</span>
                      : <span className="text-red-700 font-bold whitespace-nowrap">${(owingCount * depositPerMember).toLocaleString('en-AU')} owing</span>}
                  </div>
                  <div className="h-1.5 rounded-full bg-gray-100 mt-1.5 overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={teamMembers.length} aria-valuenow={paidCount} aria-label="Members paid">
                    <div className="h-full bg-gold-500 rounded-full" style={{ width: `${(paidCount / teamMembers.length) * 100}%` }} />
                  </div>
                </div>
              )}

              <ul className="divide-y divide-gray-100 mt-2">
                {teamMembers.map(m => {
                  const id = m.user_id || m.phone;
                  const canManage = viewedRole === 'captain' && m.role !== 'captain';
                  const isOpen = openMember === id;
                  const initials = (m.name || '?').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
                  return (
                    <li key={id} className="py-3">
                      <div className="grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-3">
                        <span className="w-9 h-9 rounded-full bg-brand-100 text-brand-800 flex items-center justify-center font-bold text-xs">{initials}</span>
                        <div className="min-w-0">
                          <p className="font-semibold text-sm text-slate-900 flex items-center gap-1.5">
                            <span className="truncate">{m.name}</span>
                            {m.role === 'captain' && <Crown className="w-3.5 h-3.5 text-gold-600 flex-shrink-0" aria-label="Captain" />}
                          </p>
                          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                            <PermissionBadge role={m.role} />
                            {m.depositPaid
                              ? <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-green-50 text-green-700">Paid</span>
                              : <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-red-50 text-red-700">{showMoney ? `$${depositPerMember.toLocaleString('en-AU')} owing` : 'Not paid'}</span>}
                          </div>
                        </div>
                        {canManage ? (
                          <button
                            type="button"
                            onClick={() => setOpenMember(isOpen ? null : id)}
                            aria-expanded={isOpen}
                            aria-label={`Manage ${m.name}`}
                            className="w-9 h-9 rounded-lg border border-gray-200 text-slate-600 hover:bg-gray-50 font-black tracking-widest"
                          >⋯</button>
                        ) : <span />}
                      </div>
                      {canManage && isOpen && (
                        <div className="mt-3 ml-12 flex flex-wrap items-center gap-2">
                          <label className="text-xs text-slate-500" htmlFor={`role-${id}`}>Role</label>
                          <select
                            id={`role-${id}`}
                            value={m.role}
                            onChange={e => updateMemberRole(m.user_id, e.target.value)}
                            className="bg-white border border-gray-300 text-slate-700 text-sm rounded-lg px-2 py-1.5 focus:outline-none focus:border-brand-500"
                          >
                            <option value="member">Member (can bet)</option>
                            <option value="view-only">View only</option>
                          </select>
                          <button
                            type="button"
                            onClick={() => toggleDepositPaid(m.user_id)}
                            className={`text-sm font-semibold px-3 py-1.5 rounded-lg border ${m.depositPaid ? 'border-gray-300 text-slate-600 hover:bg-gray-50' : 'border-green-600 bg-green-600 text-white hover:bg-green-700'}`}
                          >
                            {m.depositPaid ? 'Mark as not paid' : 'Mark as paid'}
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })()}
      </div>
    </section>
  );
};

export default MyTeamView;
