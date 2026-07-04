import React from 'react';
import { Trophy, Zap, Users, TrendingUp, ArrowRight, Settings2, CalendarRange, Building2, ChevronLeft } from 'lucide-react';
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
  const { isLoggedIn, currentUser, viewedRole, navigateTo, setShowSignupModal, setSignupMode, activeCompetitions } = useApp();

  return (
    <>
      <section className="relative pt-28 pb-16 px-4 sm:px-6 overflow-hidden">
        {/* Background radials */}
        <div className="absolute inset-0 bg-gradient-to-b from-brand-900/12 via-transparent to-transparent pointer-events-none" />
        <div className="absolute top-16 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-brand-500/5 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute top-32 right-0 w-72 h-72 bg-brand-600/4 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute top-32 left-0 w-72 h-72 bg-brand-600/4 rounded-full blur-3xl pointer-events-none" />

        <div className="max-w-5xl mx-auto text-center relative z-10">
          {/* Live badge */}
          <div className="inline-flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-4 py-1.5 mb-6">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse flex-shrink-0" />
            <span className="text-emerald-400 text-xs font-bold tracking-widest uppercase">Live Competitions Running</span>
          </div>

          <h1 className="text-5xl sm:text-6xl lg:text-7xl font-black mb-5 bg-gradient-to-b from-slate-900 via-brand-700 to-brand-600 bg-clip-text text-transparent leading-[1.08]">
            The Ultimate<br />Sports Betting League
          </h1>
          <p className="text-base sm:text-lg text-slate-500 mb-8 max-w-xl mx-auto leading-relaxed">
            Form a team, place weekly multi-bets, and compete for the jackpot. Flexible buy-ins, custom bet limits, and seasons from 8 to 32 weeks — set by your competition host.
          </p>

          {/* Primary CTAs */}
          <div className="flex flex-col sm:flex-row gap-3 justify-center mb-4">
            {isLoggedIn ? (
              <button
                onClick={() => {
                  setCreateTeamForm({ teamName: currentUser?.teamName || '', competitionCode: '', buyInMode: 'split' });
                  setCreateTeamError(null);
                  setJoinTeamCode('');
                  setJoinTeamError(null);
                  setJoinTeamSuccess(null);
                  setTeamModalTab(viewedRole === 'captain' ? 'create' : 'join');
                  setPrivateCompLookup(null);
                  setPrivateCompLookupError(null);
                  setShowCreateTeamModal(true);
                }}
                className="bg-gold-500 hover:bg-gold-400 text-brand-950 px-8 py-3.5 rounded-xl font-bold text-base transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] flex items-center justify-center gap-2 shadow-lg shadow-gold-500/30 cursor-pointer"
              >
                {viewedRole === 'captain' ? 'Enter Another Competition' : 'Join a Competition'} <ArrowRight className="w-4 h-4" />
              </button>
            ) : (
              <>
                <button onClick={() => { setSignupMode('create'); setShowSignupModal(true); }} className="bg-gold-500 hover:bg-gold-400 text-brand-950 px-8 py-3.5 rounded-xl font-bold text-base transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] flex items-center justify-center gap-2 shadow-lg shadow-gold-500/30 cursor-pointer">
                  Create a Team <ArrowRight className="w-4 h-4" />
                </button>
                <button onClick={() => { setSignupMode('join'); setShowSignupModal(true); }} className="border border-gray-300 bg-white hover:bg-gray-50 hover:border-brand-300 text-slate-700 hover:text-brand-700 px-8 py-3.5 rounded-xl font-bold text-base transition-all duration-200 cursor-pointer">
                  Join a Team
                </button>
              </>
            )}
          </div>

          {/* Secondary CTAs */}
          <div className="flex flex-row flex-wrap justify-center gap-2.5 mb-12">
            <button
              onClick={() => {
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
              }}
              className="border border-gray-300 hover:border-brand-200 bg-white hover:bg-brand-500/5 text-slate-500 hover:text-brand-700 px-5 py-2 rounded-lg text-sm font-medium transition-all duration-200 flex items-center justify-center gap-2 cursor-pointer"
            >
              <Building2 className="w-3.5 h-3.5 flex-shrink-0" /> Run a competition at your pub/club
            </button>
            <a
              href="https://wa.me/61419163012"
              target="_blank"
              rel="noopener noreferrer"
              className="border border-gray-300 hover:border-green-500/30 bg-white hover:bg-green-500/5 text-slate-500 hover:text-green-400 px-5 py-2 rounded-lg text-sm font-medium transition-all duration-200 flex items-center justify-center gap-2"
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
              <div key={l} className="bg-white border border-gray-200 hover:border-brand-500/25 rounded-xl p-4 transition-colors group">
                <div className="text-brand-600/60 mb-1.5 flex justify-center group-hover:text-brand-700 transition-colors">{icon}</div>
                <div className="text-xl font-black text-brand-600 leading-tight" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>{v}</div>
                <div className="text-slate-500 text-xs mt-0.5 font-semibold">{l}</div>
                <div className="text-slate-400 text-[10px] mt-0.5 leading-tight">{sub}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Latest Match Report — show a single recap: the user's competition if
          logged in, otherwise the most recent active competition. */}
      {(() => {
        const featuredComp =
          (isLoggedIn && activeCompetitions.find(c => c.code === currentUser?.competitionCode)) ||
          activeCompetitions[0];
        if (!featuredComp) return null;
        return (
          <section className="pb-8 px-4 sm:px-6">
            <div className="max-w-5xl mx-auto">
              <h2 className="text-xl font-black text-slate-900 mb-4">Latest Match Report</h2>
              <WeeklyRecapCard key={featuredComp.id} competitionId={featuredComp.id} />
            </div>
          </section>
        );
      })()}

      {/* Feature cards */}
      <section className="pb-20 px-4 sm:px-6">
        <div className="max-w-5xl mx-auto">
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
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
                className={`bg-white border border-gray-200 border-t-2 border-t-brand-500 rounded-xl p-5 hover:border-gray-300 hover:bg-gray-100/60 transition-all duration-200 group focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${f.nav ? 'cursor-pointer' : ''}`}
              >
                <div className="w-10 h-10 bg-gray-100 border border-gray-300 rounded-lg flex items-center justify-center text-brand-600 mb-4 group-hover:scale-105 transition-transform duration-200">
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
