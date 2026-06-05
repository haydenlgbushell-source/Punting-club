import React from 'react';
import { Trophy, Zap, Users, TrendingUp, ArrowRight, Settings2, CalendarRange, Building2, ChevronLeft } from 'lucide-react';
import { useApp } from '../../context/AppContext.jsx';

const HomeView = ({
  setCreateTeamForm, setCreateTeamError,
  setJoinTeamCode, setJoinTeamError, setJoinTeamSuccess,
  setTeamModalTab, setPrivateCompLookup, setPrivateCompLookupError,
  setShowCreateTeamModal,
  setRequestCompStep, setRequestCompForm, setRequestCompSuccess,
  setRequestCompError, setShowRequestCompModal,
}) => {
  const { isLoggedIn, currentUser, viewedRole, navigateTo, setShowSignupModal, setSignupMode } = useApp();

  return (
    <>
      <section className="relative pt-28 pb-16 px-4 sm:px-6 overflow-hidden">
        {/* Background radials */}
        <div className="absolute inset-0 bg-gradient-to-b from-amber-900/12 via-transparent to-transparent pointer-events-none" />
        <div className="absolute top-16 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-amber-500/5 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute top-32 right-0 w-72 h-72 bg-amber-600/4 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute top-32 left-0 w-72 h-72 bg-orange-600/4 rounded-full blur-3xl pointer-events-none" />

        <div className="max-w-5xl mx-auto text-center relative z-10">
          {/* Live badge */}
          <div className="inline-flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-4 py-1.5 mb-6">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse flex-shrink-0" />
            <span className="text-emerald-400 text-xs font-bold tracking-widest uppercase">Live Competitions Running</span>
          </div>

          <h1 className="text-5xl sm:text-6xl lg:text-7xl font-black mb-5 bg-gradient-to-b from-white via-amber-200 to-amber-500 bg-clip-text text-transparent leading-[1.08]">
            The Ultimate<br />Sports Betting League
          </h1>
          <p className="text-base sm:text-lg text-slate-400 mb-8 max-w-xl mx-auto leading-relaxed">
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
                className="bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-black px-8 py-3.5 rounded-xl font-bold text-base transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] flex items-center justify-center gap-2 shadow-lg shadow-amber-500/25 cursor-pointer"
              >
                {viewedRole === 'captain' ? 'Enter Another Competition' : 'Join a Competition'} <ArrowRight className="w-4 h-4" />
              </button>
            ) : (
              <>
                <button onClick={() => { setSignupMode('create'); setShowSignupModal(true); }} className="bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-black px-8 py-3.5 rounded-xl font-bold text-base transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] flex items-center justify-center gap-2 shadow-lg shadow-amber-500/25 cursor-pointer">
                  Create a Team <ArrowRight className="w-4 h-4" />
                </button>
                <button onClick={() => { setSignupMode('join'); setShowSignupModal(true); }} className="border border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white px-8 py-3.5 rounded-xl font-bold text-base transition-all duration-200 cursor-pointer">
                  Join a Team
                </button>
              </>
            )}
          </div>

          {/* Secondary CTAs */}
          <div className="flex flex-col sm:flex-row justify-center gap-2.5 mb-12">
            <button
              onClick={() => {
                setRequestCompStep(1);
                setRequestCompForm({
                  contactName: isLoggedIn ? `${currentUser?.first_name || ''} ${currentUser?.last_name || ''}`.trim() : '',
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
              className="border border-slate-700 hover:border-amber-500/30 bg-slate-900 hover:bg-amber-500/5 text-slate-400 hover:text-amber-400 px-5 py-2 rounded-lg text-sm font-medium transition-all duration-200 flex items-center justify-center gap-2 cursor-pointer"
            >
              <Building2 className="w-3.5 h-3.5 flex-shrink-0" /> Run a competition at your pub/club
            </button>
            <a
              href="https://wa.me/61419163012"
              target="_blank"
              rel="noopener noreferrer"
              className="border border-slate-700 hover:border-green-500/30 bg-slate-900 hover:bg-green-500/5 text-slate-400 hover:text-green-400 px-5 py-2 rounded-lg text-sm font-medium transition-all duration-200 flex items-center justify-center gap-2"
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
              <div key={l} className="bg-slate-900 border border-slate-800 hover:border-amber-500/25 rounded-xl p-4 transition-colors group">
                <div className="text-amber-400/60 mb-1.5 flex justify-center group-hover:text-amber-400 transition-colors">{icon}</div>
                <div className="text-xl font-black text-amber-400 leading-tight" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>{v}</div>
                <div className="text-slate-400 text-xs mt-0.5 font-semibold">{l}</div>
                <div className="text-slate-600 text-[10px] mt-0.5 leading-tight">{sub}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Feature cards */}
      <section className="pb-20 px-4 sm:px-6">
        <div className="max-w-5xl mx-auto">
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { icon: <Trophy className="w-6 h-6" />, title: 'Live Leaderboard', desc: 'Real-time rankings update as results come in', topBorder: 'border-t-amber-500', iconColor: 'text-amber-400', nav: 'leaderboard' },
              { icon: <Zap className="w-6 h-6" />, title: 'AI Bet Analysis', desc: 'Upload a screenshot — AI reads and tracks every leg', topBorder: 'border-t-blue-500', iconColor: 'text-blue-400', nav: null },
              { icon: <Users className="w-6 h-6" />, title: 'Team Management', desc: 'Captain roles, betting order, member approvals', topBorder: 'border-t-green-500', iconColor: 'text-green-400', nav: 'team' },
              { icon: <TrendingUp className="w-6 h-6" />, title: 'Season Tracking', desc: 'Weekly summaries across quarter, half and full seasons', topBorder: 'border-t-purple-500', iconColor: 'text-purple-400', nav: 'weekly' },
            ].map((f, i) => (
              <div
                key={i}
                onClick={f.nav ? () => navigateTo(f.nav) : undefined}
                className={`bg-slate-900 border border-slate-800 border-t-2 ${f.topBorder} rounded-xl p-5 hover:border-slate-700 hover:bg-slate-800/60 transition-all duration-200 group ${f.nav ? 'cursor-pointer' : ''}`}
              >
                <div className={`w-10 h-10 bg-slate-800 border border-slate-700 rounded-lg flex items-center justify-center ${f.iconColor} mb-4 group-hover:scale-105 transition-transform duration-200`}>
                  {f.icon}
                </div>
                <h3 className="font-bold text-sm text-slate-100 mb-1.5">{f.title}</h3>
                <p className="text-slate-500 text-xs leading-relaxed">{f.desc}</p>
                {f.nav && (
                  <div className={`mt-3 flex items-center gap-1 text-xs font-semibold ${f.iconColor} opacity-0 group-hover:opacity-100 transition-opacity duration-200`}>
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
