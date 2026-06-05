import React from 'react';
import { ChevronRight, ChevronLeft } from 'lucide-react';

const STEPS = [
  { n: '1', t: 'Create or Join a Team', d: 'Scan the QR code at your pub or click Sign Up. Choose to create your own team or join one with a team code.', bullets: ['Buy-in set by your competition — paid by captain or split among members', 'Invite up to 10+ members via your unique team code', 'Members must be approved by the captain before joining'] },
  { n: '2', t: 'Confirm Buy-In', d: "Before the season starts all team members must confirm their deposit contribution.", bullets: ['Buy-in amount is set by the competition host', "Captain can track who has and hasn't paid", "Competition doesn't officially start until all deposits confirmed"] },
  { n: '3', t: 'Submit Your Weekly Bet', d: 'Place your bet on any platform, then submit the screenshot via the website.', bullets: ['Weekly bet limit set per competition — split how you like across legs', 'Must submit before first leg starts', 'Final week has a boosted bet limit for a big finish', 'You keep all your winnings!'] },
  { n: '4', t: 'Track Results', d: 'AI reads your bet slip and updates leg-by-leg results every 3 hours from the first event start.', bullets: ['Green = won, Red = lost, Orange = in progress (live)', 'Team leaderboard updates in real-time', 'Click any team to see their full bet slip'] },
  { n: '5', t: 'Win the Jackpot', d: 'Highest total winnings at season end takes the prize pool.', bullets: ['Payout depends on number of teams', 'Final week has $200 bet for big finish', 'Top 2-3 teams paid depending on competition size'] },
];

const BETTING_RULES = [
  ['Flexible buy-in', 'set per competition — goes to the jackpot'],
  ['Custom weekly limit', 'split how you like across multiple bets'],
  ['Any sport or racing', 'you choose the platform and bookmaker'],
  ['Submit before', 'the first leg of your bet starts'],
  ['Final week', 'boosted bet limit for the big finish'],
  ['You keep', 'all winnings from your bets'],
];

const SEASONS = [
  ['Full Season',    '32 weeks', 'border-blue-500'],
  ['Half Season',    '16 weeks', 'border-sky-400/60'],
  ['Quarter Season', '8 weeks',  'border-blue-300/40'],
];

const CompetitionView = ({ navHistory, goBack, setSignupMode, setShowSignupModal }) => (
  <section className="pt-28 pb-16 px-4 sm:px-6">
    <div className="max-w-5xl mx-auto">
      {navHistory.length > 0 && (
        <button onClick={goBack} className="flex items-center gap-1.5 text-slate-500 hover:text-sky-400 text-sm font-semibold mb-6 transition-colors group">
          <ChevronLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" /> Back
        </button>
      )}

      <h1 className="text-4xl font-black mb-2 text-slate-900">How to Play</h1>
      <p className="text-slate-500 mb-10">Everything you need to know about joining and winning the Punting Club.</p>

      {/* Steps */}
      <div className="space-y-4 mb-12">
        {STEPS.map(s => (
          <div key={s.n} className="bg-white border border-gray-200 rounded-xl p-5 flex gap-4">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center font-black text-black text-base flex-shrink-0">{s.n}</div>
            <div>
              <h3 className="font-bold text-base mb-1 text-slate-900">{s.t}</h3>
              <p className="text-slate-500 text-sm mb-2">{s.d}</p>
              <ul className="space-y-1">
                {s.bullets.map((b, i) => (
                  <li key={i} className="text-slate-500 text-xs flex gap-1.5 items-start">
                    <ChevronRight className="w-3 h-3 text-sky-500 flex-shrink-0 mt-0.5" />{b}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ))}
      </div>

      {/* Competition Rules */}
      <h2 className="text-2xl font-black mb-2 text-slate-900">Competition Rules</h2>
      <p className="text-slate-500 mb-8">The detailed rules that govern how each season runs.</p>
      <div className="grid md:grid-cols-2 gap-6 mb-8">
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <h3 className="text-lg font-bold mb-4 text-sky-400">Betting Rules</h3>
          <ul className="space-y-3 text-sm text-slate-700">
            {BETTING_RULES.map(([b, r], i) => (
              <li key={i} className="flex gap-2 items-start">
                <ChevronRight className="w-3.5 h-3.5 text-sky-500 flex-shrink-0 mt-0.5" />
                <span><strong className="text-slate-900">{b}</strong> {r}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <h3 className="text-lg font-bold mb-4 text-sky-400">Season Lengths</h3>
          <div className="space-y-3">
            {SEASONS.map(([n, w, b]) => (
              <div key={n} className={`bg-gray-100/60 rounded-lg p-4 border-l-4 ${b}`}>
                <div className="font-bold text-sm text-slate-900">{n}</div>
                <div className="text-slate-500 text-xs mt-1">{w} of competition</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="bg-white border border-gray-300 rounded-xl p-6 mb-8">
        <h3 className="text-lg font-bold mb-3 text-sky-400">The Punting Week</h3>
        <p className="text-slate-700 text-sm">
          Every competition week finishes <strong className="text-slate-900">11:59PM Tuesday</strong> and starts{' '}
          <strong className="text-slate-900">12:00AM every Wednesday</strong>. Bets must be submitted before the first leg
          of your multi starts. Teams can split their weekly allowance across multiple bets. The final week has a{' '}
          <strong className="text-slate-900">boosted bet limit</strong> — exact amounts are set by your competition host.
        </p>
      </div>

      <div className="bg-white border border-gray-300 rounded-xl p-6 text-center">
        <h3 className="font-bold text-lg mb-2 text-slate-900">Ready to play?</h3>
        <p className="text-slate-500 text-sm mb-4">Get your mates together and start this week!</p>
        <button
          onClick={() => { setSignupMode('create'); setShowSignupModal(true); }}
          className="bg-gradient-to-r from-blue-600 to-blue-700 text-white px-8 py-3 rounded-xl font-bold transition-all hover:scale-105"
        >
          Create Team Now
        </button>
      </div>
    </div>
  </section>
);

export default CompetitionView;
