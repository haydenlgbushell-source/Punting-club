import React from 'react';
import { ChevronRight } from 'lucide-react';
import { Page, PageHeader, BackButton, Card, btn } from '../ui.jsx';

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
  ['Full Season',    '32 weeks', 'border-brand-500'],
  ['Half Season',    '16 weeks', 'border-brand-500/60'],
  ['Quarter Season', '8 weeks',  'border-brand-300/40'],
];

const CompetitionView = ({ navHistory, goBack, setSignupMode, setShowSignupModal }) => (
  <Page width="max-w-4xl">
      {navHistory.length > 0 && <BackButton onClick={goBack} />}

      <PageHeader eyebrow="Rules" title="How to play" subtitle="Everything you need to know about joining and winning the Punting Club." />

      {/* Steps */}
      <Card className="divide-y divide-gray-100 mb-10">
        {STEPS.map(s => (
          <div key={s.n} className="p-5 flex gap-4">
            <div className="w-9 h-9 rounded-full bg-gold-500 flex items-center justify-center font-display font-bold text-brand-950 text-lg flex-shrink-0">{s.n}</div>
            <div>
              <h3 className="font-bold text-base mb-1 text-slate-900">{s.t}</h3>
              <p className="text-slate-500 text-sm mb-2">{s.d}</p>
              <ul className="space-y-1">
                {s.bullets.map((b, i) => (
                  <li key={i} className="text-slate-500 text-xs flex gap-1.5 items-start">
                    <ChevronRight className="w-3 h-3 text-brand-700 flex-shrink-0 mt-0.5" />{b}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ))}
      </Card>

      {/* Competition Rules */}
      <h2 className="text-2xl font-bold mb-1 text-slate-900">Competition rules</h2>
      <p className="text-slate-500 text-sm mb-4">The detailed rules that govern how each season runs.</p>
      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <Card className="p-5">
          <h3 className="font-bold mb-3 text-slate-900">Betting rules</h3>
          <ul className="space-y-3 text-sm text-slate-700">
            {BETTING_RULES.map(([b, r], i) => (
              <li key={i} className="flex gap-2 items-start">
                <ChevronRight className="w-3.5 h-3.5 text-brand-700 flex-shrink-0 mt-0.5" />
                <span><strong className="text-slate-900">{b}</strong> {r}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card className="p-5">
          <h3 className="font-bold mb-3 text-slate-900">Season lengths</h3>
          <div className="grid grid-cols-3 gap-2">
            {SEASONS.map(([n, w]) => (
              <div key={n} className="bg-[#F4F6F4] rounded-xl p-3 text-center">
                <div className="font-display text-2xl font-bold text-slate-900">{w.split(' ')[0]}</div>
                <div className="text-slate-500 text-xs">weeks</div>
                <div className="text-slate-700 text-xs font-semibold mt-1">{n}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card className="p-5 mb-4">
        <h3 className="font-bold mb-2 text-slate-900">The punting week</h3>
        <p className="text-slate-700 text-sm">
          Each competition week rolls over at{' '}
          <strong className="text-slate-900">12:00 pm (midday) every Wednesday, Sydney time</strong>. Bets must be submitted before the first leg
          of your multi starts. Teams can split their weekly allowance across multiple bets. The final week has a{' '}
          <strong className="text-slate-900">boosted bet limit</strong> — exact amounts are set by your competition host.
        </p>
      </Card>

      <div className="bg-brand-900 text-white rounded-2xl p-6 text-center">
        <h3 className="font-display font-bold text-2xl mb-1">Ready to play?</h3>
        <p className="text-brand-100 text-sm mb-4">Get your mates together and start this week.</p>
        <button onClick={() => { setSignupMode('create'); setShowSignupModal(true); }} className={btn.primary}>
          Create a team
        </button>
      </div>
  </Page>
);

export default CompetitionView;
