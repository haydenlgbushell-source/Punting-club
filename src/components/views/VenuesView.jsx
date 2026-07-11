import React from 'react';
import {
  Building2, ArrowRight, Users, CalendarRange, QrCode, Tv, Sparkles,
  ShieldCheck, HandCoins, Megaphone, ClipboardList, Rocket, ChevronDown, ChevronLeft,
} from 'lucide-react';
import { useApp } from '../../context/AppContext.jsx';

// Venue-facing landing page: sells hosting a competition to pubs & clubs.
const VenuesView = ({ openRequestCompModal }) => {
  const { navHistory, goBack } = useApp();

  const steps = [
    {
      icon: <ClipboardList className="w-5 h-5" />,
      title: '1. Tell us about your venue',
      desc: 'Two minutes: your venue name, roughly how many teams, and when you’d like to start. We handle everything else.',
    },
    {
      icon: <Rocket className="w-5 h-5" />,
      title: '2. We set everything up',
      desc: 'Your competition goes live with its own join code, QR poster for the bar, and a live leaderboard for your screens.',
    },
    {
      icon: <Users className="w-5 h-5" />,
      title: '3. Teams sign up and battle all season',
      desc: 'Punters form teams, submit their weekly bets by screenshot, and the leaderboard tracks it all automatically.',
    },
  ];

  const benefits = [
    {
      icon: <CalendarRange className="w-5 h-5" />,
      title: 'Weekly regulars, all season',
      desc: 'Seasons run 8, 16 or 32 weeks. Teams come back to your venue every week to talk tips, watch results and settle bragging rights.',
    },
    {
      icon: <HandCoins className="w-5 h-5" />,
      title: 'Free to host, zero admin',
      desc: 'No cost to the venue and no paperwork. Results are checked automatically by AI — your staff never touch a spreadsheet.',
    },
    {
      icon: <QrCode className="w-5 h-5" />,
      title: 'Marketing kit included',
      desc: 'A printable QR poster for the bar, a shareable join link, and AI-written weekly recaps you can post straight to your socials.',
    },
    {
      icon: <Tv className="w-5 h-5" />,
      title: 'Leaderboard on your screens',
      desc: 'A big-screen TV mode shows live rankings in-venue — turn every settled leg into a moment at the bar.',
    },
  ];

  const compliance = [
    ['No money through the platform', 'Punting Club never holds or handles wagers. Players place bets with their own licensed bookmakers and upload the slip.'],
    ['You control the buy-in and prize', 'The season buy-in and payout structure are set with you before launch — winner-takes-all or split places.'],
    ['Players are verified', 'Every player is KYC-checked by our team. 18+ only, always.'],
    ['Responsible gambling first', 'Weekly bet limits are capped per team, and responsible gambling messaging is built into the product.'],
  ];

  const faqs = [
    { q: 'What does it cost my venue?', a: 'Nothing. Hosting a competition is free for pubs and clubs. The prize pool is funded by team buy-ins, and the payout structure is agreed with you before the season starts.' },
    { q: 'What does my staff have to do?', a: 'Almost nothing. Put the QR poster up, and optionally show the leaderboard on a screen. Bets, results and rankings are all handled automatically in the app.' },
    { q: 'Is this compliant for a licensed venue?', a: 'Punting Club never takes or pays out wagers — players bet with their own licensed bookmakers and upload their bet slips. All players are verified 18+, and weekly limits keep stakes controlled.' },
    { q: 'How do punters join my competition?', a: 'They scan your venue’s QR code or use your join link, create or join a team, and they’re in. Private competitions are also available via a secret code you share.' },
    { q: 'How long does setup take?', a: 'Submit the request form and we’ll confirm within 1–2 business days. Once approved, your competition is created instantly with its join code and poster.' },
    { q: 'Can I run more than one season a year?', a: 'Absolutely. Many venues run back-to-back seasons — 8-week sprints, 16-week footy seasons or a 32-week marathon. You choose.' },
  ];

  return (
    <section className="pt-28 pb-20 px-4 sm:px-6">
      <div className="max-w-5xl mx-auto">
        {navHistory.length > 0 && (
          <button onClick={goBack} className="flex items-center gap-1.5 text-slate-500 hover:text-brand-700 text-sm font-semibold mb-6 transition-colors group">
            <ChevronLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" /> Back
          </button>
        )}

        {/* Hero */}
        <div className="text-center mb-14">
          <div className="inline-flex items-center gap-2 bg-brand-500/10 border border-brand-500/25 rounded-full px-4 py-1.5 mb-5">
            <Building2 className="w-3.5 h-3.5 text-brand-600" />
            <span className="text-brand-600 text-xs font-bold tracking-widest uppercase">For Pubs &amp; Clubs</span>
          </div>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black mb-5 bg-gradient-to-b from-slate-900 via-brand-700 to-brand-600 bg-clip-text text-transparent leading-[1.08]">
            Make your venue the home<br className="hidden sm:block" /> of the local punting league
          </h1>
          <p className="text-base sm:text-lg text-slate-500 mb-8 max-w-2xl mx-auto leading-relaxed">
            Host a season-long betting competition that brings teams of punters back to your bar
            every single week — free to run, fully automated, and set up for you in days.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button
              onClick={openRequestCompModal}
              className="bg-gold-500 hover:bg-gold-400 text-brand-950 px-8 py-3.5 rounded-xl font-bold text-base transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] flex items-center justify-center gap-2 shadow-lg shadow-gold-500/30 cursor-pointer"
            >
              Host a competition <ArrowRight className="w-4 h-4" />
            </button>
            <a
              href="https://wa.me/61419163012"
              target="_blank"
              rel="noopener noreferrer"
              className="border border-gray-300 bg-white hover:bg-gray-50 hover:border-brand-300 text-slate-700 hover:text-brand-700 px-8 py-3.5 rounded-xl font-bold text-base transition-all duration-200 flex items-center justify-center gap-2"
            >
              Talk to us first
            </a>
          </div>
          <p className="text-slate-400 text-xs mt-4">Free for venues · Set up within 1–2 business days · 18+ responsible gambling</p>
        </div>

        {/* How it works */}
        <div className="mb-14">
          <h2 className="text-2xl font-black text-slate-900 mb-6 text-center">How hosting works</h2>
          <div className="grid sm:grid-cols-3 gap-4">
            {steps.map((s) => (
              <div key={s.title} className="bg-white border border-gray-200 border-t-2 border-t-brand-500 rounded-xl p-6">
                <div className="w-10 h-10 bg-brand-500/10 border border-brand-500/20 rounded-lg flex items-center justify-center text-brand-600 mb-4">
                  {s.icon}
                </div>
                <h3 className="font-bold text-sm text-slate-900 mb-1.5">{s.title}</h3>
                <p className="text-slate-500 text-xs leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Why host */}
        <div className="mb-14">
          <h2 className="text-2xl font-black text-slate-900 mb-6 text-center">Why venues host with Punting Club</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            {benefits.map((b) => (
              <div key={b.title} className="bg-white border border-gray-200 rounded-xl p-6 hover:border-brand-500/30 transition-colors flex gap-4">
                <div className="w-10 h-10 bg-gray-100 border border-gray-300 rounded-lg flex items-center justify-center text-brand-600 flex-shrink-0">
                  {b.icon}
                </div>
                <div>
                  <h3 className="font-bold text-sm text-slate-900 mb-1">{b.title}</h3>
                  <p className="text-slate-500 text-xs leading-relaxed">{b.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Compliance */}
        <div className="mb-14 bg-brand-950 rounded-2xl p-6 sm:p-8">
          <div className="flex items-center gap-2.5 mb-5">
            <ShieldCheck className="w-5 h-5 text-gold-400" />
            <h2 className="text-xl font-black text-white">Built for licensed venues</h2>
          </div>
          <div className="grid sm:grid-cols-2 gap-x-8 gap-y-4">
            {compliance.map(([t, d]) => (
              <div key={t} className="flex gap-3">
                <span className="w-1.5 h-1.5 rounded-full bg-gold-400 mt-1.5 flex-shrink-0" />
                <div>
                  <p className="text-white text-sm font-semibold mb-0.5">{t}</p>
                  <p className="text-brand-100/60 text-xs leading-relaxed">{d}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Host FAQ */}
        <div className="mb-14 max-w-3xl mx-auto">
          <h2 className="text-2xl font-black text-slate-900 mb-6 text-center">Venue FAQ</h2>
          <div className="space-y-2">
            {faqs.map(({ q, a }) => (
              <details key={q} className="group bg-white border border-gray-200 rounded-xl overflow-hidden">
                <summary className="flex items-center justify-between gap-3 px-5 py-4 cursor-pointer select-none list-none hover:bg-gray-100/50 transition-colors">
                  <span className="text-sm font-semibold text-slate-900">{q}</span>
                  <ChevronDown className="w-4 h-4 text-slate-500 flex-shrink-0 group-open:rotate-180 transition-transform duration-200" />
                </summary>
                <div className="px-5 pb-4 pt-0">
                  <p className="text-sm text-slate-500 leading-relaxed">{a}</p>
                </div>
              </details>
            ))}
          </div>
        </div>

        {/* Final CTA */}
        <div className="bg-brand-500/10 border border-brand-500/20 rounded-2xl p-8 text-center">
          <div className="flex justify-center mb-3">
            <div className="w-11 h-11 rounded-xl bg-brand-500/15 border border-brand-500/25 flex items-center justify-center">
              <Megaphone className="w-5 h-5 text-brand-600" />
            </div>
          </div>
          <h3 className="font-black text-2xl mb-2 text-slate-900">Ready to pack the bar every week?</h3>
          <p className="text-slate-500 text-sm mb-6 max-w-md mx-auto">
            Tell us about your venue and we’ll have your competition, join code and QR poster ready within days.
          </p>
          <button
            onClick={openRequestCompModal}
            className="bg-brand-700 hover:bg-brand-600 text-white px-8 py-3 rounded-xl font-bold text-sm transition-all hover:scale-105 inline-flex items-center gap-2"
          >
            <Sparkles className="w-4 h-4" /> Request your competition
          </button>
        </div>
      </div>
    </section>
  );
};

export default VenuesView;
