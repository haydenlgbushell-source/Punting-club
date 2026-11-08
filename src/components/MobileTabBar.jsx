import React from 'react';
import { Home, Trophy, BarChart3, Users, Plus } from 'lucide-react';

// Bottom navigation for phones. The middle button submits this week's bet.
const TABS = [
  ['home', 'Home', Home],
  ['leaderboard', 'Ladder', Trophy],
  null, // bet button
  ['weekly', 'Summary', BarChart3],
  ['team', 'Team', Users],
];

const MobileTabBar = ({ activeNav, onNavigate, onBet, teamBadge = 0 }) => (
  <nav
    aria-label="Main"
    className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white border-t border-gray-200 grid grid-cols-5 px-1 pt-1.5 pb-[calc(0.5rem+env(safe-area-inset-bottom))]"
  >
    {TABS.map((tab, i) => {
      if (!tab) {
        return (
          <button key="bet" type="button" onClick={onBet} className="flex flex-col items-center gap-0.5 text-[11px] font-semibold text-slate-800">
            <span className="-mt-6 w-12 h-12 rounded-full bg-gold-500 text-brand-950 shadow-lg shadow-gold-500/40 flex items-center justify-center">
              <Plus className="w-6 h-6" strokeWidth={3} />
            </span>
            Bet
          </button>
        );
      }
      const [key, label, Icon] = tab;
      const active = activeNav === key;
      return (
        <button
          key={key}
          type="button"
          onClick={() => onNavigate(key)}
          aria-current={active ? 'page' : undefined}
          className={`relative flex flex-col items-center gap-0.5 py-1 text-[11px] font-semibold ${active ? 'text-brand-800' : 'text-slate-500'}`}
        >
          <Icon className="w-5 h-5" strokeWidth={active ? 2.5 : 2} />
          {label}
          {key === 'team' && teamBadge > 0 && (
            <span className="absolute top-0 right-[22%] min-w-[1rem] h-4 px-1 rounded-full bg-red-600 text-white text-[10px] leading-4 text-center">{teamBadge}</span>
          )}
        </button>
      );
    })}
  </nav>
);

export default MobileTabBar;
