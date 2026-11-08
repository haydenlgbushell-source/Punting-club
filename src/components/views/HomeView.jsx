import React from 'react';
import { Trophy, Zap, Users, TrendingUp, ArrowRight, Settings2, CalendarRange, Building2, BookOpen, HelpCircle, MessageCircle, PlusCircle } from 'lucide-react';
import { Page, PageHeader, Card, CardTitle, RankBadge, btn, useCountdown } from '../ui.jsx';
import WeeklyRecapCard from '../WeeklyRecapCard.jsx';
import { useApp } from '../../context/AppContext.jsx';

const HomeView = ({
  setCreateTeamForm, setCreateTeamError,
  setJoinTeamCode, setJoinTeamError, setJoinTeamSuccess,
  setTeamModalTab, setPrivateCompLookup, setPrivateCompLookupError,
  setShowCreateTeamModal,
  setRequestCompStep, setRequestCompForm, setRequestCompSuccess,
  setRequestCompError, setShowRequestCompModal,
}) => {
  const {
    isLoggedIn, currentUser, viewedRole, navigateTo, setShowSignupModal, setSignupMode, activeCompetitions,
    effectiveViewedCode, myTeamName, myTeamData, enrichedLeaderboardTeams, teamMembers,
    currentWeekNum, currentBettor, nextWedCutoff, setShowBetAnalyzer, calcCurrentWeek,
  } = useApp();
  const closesIn = useCountdown(nextWedCutoff);

  const openCompetitionModal = () => {
    setCreateTeamForm({ teamName: currentUser?.teamName || '', competitionCode: '', buyInMode: 'split' });
    setCreateTeamError(null);
    setJoinTeamCode('');
    setJoinTeamError(null);
    setJoinTeamSuccess(null);
    setTeamModalTab(viewedRole === 'captain' ? 'create' : 'join');
    setPrivateCompLookup(null);
    setPrivateCompLookupError(null);
    setShowCreateTeamModal(true);
  };
  const openRequestComp = () => {
    setRequestCompStep(1);
    setRequestCompForm({
      contactName: isLoggedIn ? `${currentUser?.firstName || currentUser?.first_name || ''} ${currentUser?.lastName || currentUser?.last_name || ''}`.trim() : '',
      contactPhone: isLoggedIn ? (currentUser?.phone || '') : '',
      contactEmail: isLoggedIn ? (currentUser?.email || '') : '',
      pubName: '', compName: '', estimatedTeams: '',
      preferredStartDate: '', preferredEndDate: '',
      buyIn: '', isPrivate: false, notes: '',
    });
    setRequestCompSuccess(false);
    setRequestCompError(null);
    setShowRequestCompModal(true);
  };

  const featuredComp =
    (isLoggedIn && activeCompetitions.find(c => c.code === (effectiveViewedCode || currentUser?.competitionCode))) ||
    activeCompetitions[0];

  // ── Logged-in home: a dashboard for this week ──────────────────────────
  if (isLoggedIn) {
    const comp = activeCompetitions.find(c => c.code === effectiveViewedCode);
    const weekNo = comp?.start_date ? calcCurrentWeek(comp.start_date) : null;
    const thisWeekBets = (myTeamData?.bets || []).filter(b => b.weekNumber === currentWeekNum + 1);
    const myName = `${currentUser?.firstName || ''} ${currentUser?.lastName || ''}`.trim();
    const myTurn = currentBettor && myName && currentBettor === myName;
    const ladder = enrichedLeaderboardTeams.slice(0, 5);
    const meOnLadder = enrichedLeaderboardTeams.find(t => t.team === myTeamName);
    return (
      <Page>
        <PageHeader
          eyebrow={`G'day ${currentUser?.firstName || ''}`.trim()}
          title={myTeamName || 'Your team'}
          subtitle={[comp?.name, weekNo && comp?.weeks ? `Week ${weekNo} of ${comp.weeks}` : null].filter(Boolean).join(' · ')}
        />

        {/* This week */}
        <div className="bg-brand-900 text-white rounded-2xl p-5 sm:p-6 mb-4 grid sm:grid-cols-[1fr_auto] gap-5 sm:items-center">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-wider font-bold text-brand-200 mb-1">This week</p>
            {thisWeekBets.length > 0 ? (
              <p className="font-display text-2xl sm:text-3xl font-bold leading-tight">Bet's in. {thisWeekBets.length === 1 ? '1 bet' : `${thisWeekBets.length} bets`} placed.</p>
            ) : myTurn ? (
              <p className="font-display text-2xl sm:text-3xl font-bold leading-tight">It's your turn to bet</p>
            ) : (
              <p className="font-display text-2xl sm:text-3xl font-bold leading-tight">{currentBettor ? `It's ${currentBettor}'s turn to bet` : 'No bet in yet'}</p>
            )}
            <p className="text-brand-100 text-sm mt-1">{closesIn ? `Bets close in ${closesIn}` : 'Bets are closed for this week'}</p>
            <div className="flex gap-2 flex-wrap mt-4">
              <button onClick={() => setShowBetAnalyzer(true)} className={btn.primary}>{thisWeekBets.length > 0 ? 'Add another bet' : 'Submit bet'}</button>
              <button onClick={() => navigateTo('team')} className="inline-flex items-center justify-center gap-1.5 border border-white/25 hover:border-white/50 text-white font-semibold rounded-full px-5 py-2.5 text-sm transition-colors">My team <ArrowRight className="w-4 h-4" /></button>
            </div>
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-1 gap-3 sm:gap-2 sm:text-right sm:border-l sm:border-white/10 sm:pl-6">
            {[['Position', meOnLadder ? `#${meOnLadder.rank}` : '—'], ['Total won', myTeamData?.total || '$0.00'], ['Members', teamMembers.length || '—']].map(([l, v]) => (
              <div key={l} className="min-w-0">
                <p className="text-[11px] uppercase tracking-wider font-bold text-brand-200">{l}</p>
                <p className="font-display text-2xl font-bold leading-tight tabular-nums truncate">{v}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-4 mb-4">
          {/* Ladder snapshot */}
          <Card className="p-5">
            <CardTitle icon={<Trophy className="w-4 h-4" />} right={<button onClick={() => navigateTo('leaderboard')} className="text-sm font-semibold text-brand-700 hover:text-brand-900 flex items-center gap-1">Full ladder <ArrowRight className="w-3.5 h-3.5" /></button>}>Ladder</CardTitle>
            {ladder.length === 0 ? (
              <p className="text-slate-500 text-sm py-6 text-center">The ladder fills in once teams have joined.</p>
            ) : (
              <div className="divide-y divide-gray-100">
                {ladder.map(t => {
                  const isMe = t.team === myTeamName;
                  return (
                    <div key={t.id || t.team} className={`flex items-center gap-3 py-2.5 ${isMe ? 'bg-[#FBF6E6] -mx-5 px-5' : ''}`}>
                      <RankBadge rank={t.rank} />
                      <span className="flex-1 min-w-0 truncate font-semibold text-sm text-slate-900">{t.team}</span>
                      {isMe && <span className="text-[10px] font-bold uppercase bg-gold-500 text-brand-950 rounded-full px-1.5 py-0.5">You</span>}
                      <span className="font-display text-lg font-bold tabular-nums text-slate-900">{t.total}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          {/* Latest match report */}
          {featuredComp ? (
            <div>
              <WeeklyRecapCard key={featuredComp.id} competitionId={featuredComp.id} />
            </div>
          ) : <div />}
        </div>

        {/* Shortcuts */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { icon: <BookOpen className="w-5 h-5" />, label: 'Rules', onClick: () => navigateTo('competition') },
            { icon: <HelpCircle className="w-5 h-5" />, label: 'FAQ', onClick: () => navigateTo('faq') },
            { icon: <PlusCircle className="w-5 h-5" />, label: viewedRole === 'captain' ? 'Enter another competition' : 'Join another team', onClick: openCompetitionModal },
            { icon: <Building2 className="w-5 h-5" />, label: 'Run a comp at your pub', onClick: openRequestComp },
          ].map(x => (
            <button key={x.label} onClick={x.onClick} className="bg-white border border-gray-200 hover:border-brand-300 rounded-2xl p-4 text-left flex flex-col gap-2 transition-colors">
              <span className="text-brand-600">{x.icon}</span>
              <span className="text-sm font-semibold text-slate-800 leading-snug">{x.label}</span>
            </button>
          ))}
        </div>
      </Page>
    );
  }


  return (
    <>
      <section className="relative pt-10 sm:pt-16 pb-12 px-4 sm:px-6 overflow-hidden">

        <div className="max-w-5xl mx-auto text-center relative z-10">
          {/* Live badge */}
          <div className="inline-flex items-center gap-2 bg-white border border-gray-200 rounded-full px-3.5 py-1.5 mb-6">
            <span className="w-2 h-2 rounded-full bg-green-600 animate-pulse flex-shrink-0" />
            <span className="text-slate-700 text-xs font-bold tracking-wider uppercase">Competitions running now</span>
          </div>

          <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold mb-5 text-brand-950 leading-[1.02]">
            The Ultimate<br /><span className="text-brand-600">Sports Betting League</span>
          </h1>
          <p className="text-base sm:text-lg text-slate-500 mb-8 max-w-xl mx-auto leading-relaxed">
            Form a team, place weekly multi-bets, and compete for the jackpot. Flexible buy-ins, custom bet limits, and seasons from 8 to 32 weeks — set by your competition host.
          </p>

          {/* Primary CTAs */}
          <div className="flex flex-col sm:flex-row gap-3 justify-center mb-4">
            {(
              <>
                <button onClick={() => { setSignupMode('create'); setShowSignupModal(true); }} className={`${btn.primary} !px-8 !py-3.5 !text-base`}>
                  Create a team <ArrowRight className="w-4 h-4" />
                </button>
                <button onClick={() => { setSignupMode('join'); setShowSignupModal(true); }} className={`${btn.ghost} !px-8 !py-3.5 !text-base`}>
                  Join with a team code
                </button>
              </>
            )}
          </div>

          {/* Secondary CTAs */}
          <div className="flex flex-row flex-wrap justify-center gap-2.5 mb-12">
            <button
              onClick={openRequestComp}
              className="text-slate-600 hover:text-brand-800 px-3 py-2 text-sm font-semibold flex items-center justify-center gap-2 underline-offset-4 hover:underline"
            >
              <Building2 className="w-3.5 h-3.5 flex-shrink-0" /> Run a competition at your pub/club
            </button>
            <a
              href="https://wa.me/61419163012"
              target="_blank"
              rel="noopener noreferrer"
              className="text-slate-600 hover:text-brand-800 px-3 py-2 text-sm font-semibold flex items-center justify-center gap-2 underline-offset-4 hover:underline"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="14" height="14" style={{ flexShrink: 0 }}>
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
              </svg>
              Message us on WhatsApp
            </a>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-3 gap-3 max-w-md mx-auto">
            {[
              { v: 'Flexible', l: 'Buy-In',        sub: 'set per competition', icon: <Settings2 className="w-4 h-4" /> },
              { v: 'Any Sport', l: 'Weekly Bets',   sub: 'custom limit',        icon: <TrendingUp className="w-4 h-4" /> },
              { v: '8–32 Wks', l: 'Season Length', sub: '8, 16 or 32 weeks',   icon: <CalendarRange className="w-4 h-4" /> },
            ].map(({ v, l, sub, icon }) => (
              <div key={l} className="bg-white border border-gray-200 rounded-2xl p-4">
                <div className="text-brand-600 mb-1.5 flex justify-center">{icon}</div>
                <div className="font-display text-xl font-bold text-slate-900 leading-tight">{v}</div>
                <div className="text-slate-500 text-xs mt-0.5 font-semibold">{l}</div>
                <div className="text-slate-400 text-[10px] mt-0.5 leading-tight">{sub}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {featuredComp && (
        <section className="pb-8 px-4 sm:px-6">
          <div className="max-w-5xl mx-auto">
            <h2 className="text-2xl font-bold text-slate-900 mb-3">Latest match report</h2>
            <WeeklyRecapCard key={featuredComp.id} competitionId={featuredComp.id} />
          </div>
        </section>
      )}

      {/* Feature cards */}
      <section className="pb-20 px-4 sm:px-6">
        <div className="max-w-5xl mx-auto">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            {[
              { icon: <Trophy className="w-6 h-6" />, title: 'Live Leaderboard', desc: 'Real-time rankings update as results come in', nav: 'leaderboard' },
              { icon: <Zap className="w-6 h-6" />, title: 'AI Bet Analysis', desc: 'Upload a screenshot — AI reads and tracks every leg', nav: null },
              { icon: <Users className="w-6 h-6" />, title: 'Team Management', desc: 'Captain roles, betting order, member approvals', nav: 'team' },
              { icon: <TrendingUp className="w-6 h-6" />, title: 'Season Tracking', desc: 'Weekly summaries across quarter, half and full seasons', nav: 'weekly' },
            ].map((f, i) => (
              <div
                key={i}
                onClick={f.nav ? () => navigateTo(f.nav) : undefined}
                role={f.nav ? 'button' : undefined}
                tabIndex={f.nav ? 0 : undefined}
                onKeyDown={f.nav ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigateTo(f.nav); } } : undefined}
                className={`bg-white border border-gray-200 rounded-2xl p-4 sm:p-5 hover:border-brand-300 transition-colors group focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${f.nav ? 'cursor-pointer' : ''}`}
              >
                <div className="w-10 h-10 bg-brand-50 rounded-xl flex items-center justify-center text-brand-700 mb-4">
                  {f.icon}
                </div>
                <h3 className="font-bold text-sm text-slate-900 mb-1.5">{f.title}</h3>
                <p className="text-slate-500 text-xs leading-relaxed">{f.desc}</p>
                {f.nav && (
                  <div className="mt-3 flex items-center gap-1 text-xs font-semibold text-brand-600 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                    View <ArrowRight className="w-3 h-3" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
};

export default HomeView;
