import React from 'react';
import { HelpCircle, Sparkles, FileText, Trophy, Users, DollarSign, Settings2, ChevronDown, ChevronLeft } from 'lucide-react';

const FaqView = ({ navHistory, goBack, navigateTo }) => (
  <section className="pt-28 pb-16 px-4 sm:px-6">
    <div className="max-w-3xl mx-auto">
      {navHistory.length > 0 && (
        <button onClick={goBack} className="flex items-center gap-1.5 text-slate-500 hover:text-sky-400 text-sm font-semibold mb-6 transition-colors group">
          <ChevronLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" /> Back
        </button>
      )}

      <div className="mb-10">
        <div className="inline-flex items-center gap-2 bg-blue-500/10 border border-blue-500/25 rounded-full px-4 py-1.5 mb-4">
          <HelpCircle className="w-3.5 h-3.5 text-sky-400" />
          <span className="text-sky-400 text-xs font-bold tracking-widest uppercase">Help Centre</span>
        </div>
        <h1 className="text-4xl font-black mb-2">Frequently Asked Questions</h1>
        <p className="text-slate-500">Everything you need to know about using Punting Club.</p>
      </div>

      {[
        {
          category: 'Getting Started',
          icon: <Sparkles className="w-4 h-4 text-sky-400" />,
          items: [
            { q: 'How do I sign up?', a: 'Tap Sign Up in the top navigation bar. Enter your first name, mobile number, and password. Once registered you can create a new team or join an existing one using a team code.' },
            { q: 'How do I join a competition?', a: 'You join a competition by creating or joining a team with a valid competition code. Your competition host (pub, group organiser, etc.) will provide you with that code.' },
            { q: 'What is a team code?', a: 'A unique 6-character code that identifies your team. Share it with friends so they can join your team. You can find your team code on the My Team page once your team is created.' },
            { q: 'How many members can a team have?', a: 'Teams can have up to 10+ members. The captain must approve each member before they are officially part of the team.' },
          ],
        },
        {
          category: 'Placing Bets',
          icon: <FileText className="w-4 h-4 text-sky-400" />,
          items: [
            { q: 'How do I submit a bet?', a: 'Go to the Leaderboard page and tap "Submit Bet". Upload a screenshot of your bet slip from your bookmaker. Our AI will read the slip and extract all the details automatically.' },
            { q: 'What is the weekly bet limit?', a: 'The weekly bet limit is set by your competition host. Your team can split that limit across multiple individual bets — you are not limited to one multi per week.' },
            { q: 'When is the deadline to submit a bet?', a: 'You must submit your bet before the first leg (event) starts. The competition week runs Wednesday 12:00 AM to Tuesday 11:59 PM AEST. Late submissions will not be accepted.' },
            { q: 'Can I bet on any sport?', a: 'Yes — any sport or racing, on any bookmaker platform you choose. Just upload the bet slip screenshot after placing the bet.' },
            { q: 'Do I keep my winnings?', a: 'Yes! Any money you win from your bets is yours to keep. The jackpot prize pool is separate — it is funded by the buy-in amounts and awarded to the top teams at season end.' },
          ],
        },
        {
          category: 'Results & Scoring',
          icon: <Trophy className="w-4 h-4 text-sky-400" />,
          items: [
            { q: 'How are results updated?', a: 'Our AI checks bet results automatically every 3 hours once the first leg of a bet has started. You can also trigger a manual check by clicking "Check Results" on the Leaderboard page.' },
            { q: 'What do the leg colours mean?', a: 'Green = Won, Red = Lost, Orange = In Progress (live), Yellow = Partial (some legs settled). The overall bet result is shown in the header of each bet slip card.' },
            { q: 'How is the leaderboard scored?', a: 'Teams are ranked by total winnings across all settled bets for the current week (weekly view) or across the entire season (season view). Highest total winnings wins.' },
            { q: 'What happens if a bet result looks wrong?', a: 'Contact your competition admin or reach out via the pub. Admins have tools to manually correct individual bet leg results if there is a discrepancy.' },
          ],
        },
        {
          category: 'Teams & Captains',
          icon: <Users className="w-4 h-4 text-sky-400" />,
          items: [
            { q: 'What does a captain do?', a: 'The captain is the team manager. They approve or reject member join requests, set the betting order for members, and are responsible for confirming the buy-in deposit.' },
            { q: 'How do I approve a member who wants to join?', a: 'Go to the My Team page. Pending requests will appear at the top with an Approve / Reject option. You will also see a notification badge on the My Team nav link.' },
            { q: 'Can I be in multiple teams?', a: 'Yes. You can create or join additional teams by tapping "+ New Team" in the navigation bar. Each team can be in a different competition.' },
            { q: 'What is the betting order?', a: 'Captains can set a rotating order that determines which team member submits the bet each week. This is optional but helps keep things organised when the team shares the betting responsibility.' },
          ],
        },
        {
          category: 'Buy-Ins & Prizes',
          icon: <DollarSign className="w-4 h-4 text-sky-400" />,
          items: [
            { q: 'How does the buy-in work?', a: 'The buy-in amount and structure are set by your competition host. It can be paid entirely by the captain or split equally among all team members. All buy-ins go into the jackpot prize pool.' },
            { q: 'When and how is the prize paid out?', a: 'Prize payout happens at the end of the season. The number of places paid (1st, 2nd, 3rd) depends on the total number of competing teams — your competition host will confirm the split before the season starts.' },
            { q: 'What is the final week boost?', a: 'The final week of every competition has a boosted bet limit, giving every team a chance to close the gap or extend their lead. The exact boosted amount is set by the competition host.' },
          ],
        },
        {
          category: 'Account & Technical',
          icon: <Settings2 className="w-4 h-4 text-sky-400" />,
          items: [
            { q: 'How do I update my name or password?', a: 'Click or tap your profile chip in the top-right corner of the navbar (your first initial in a circle). From there you can edit your display name and change your password.' },
            { q: 'I forgot my password — what do I do?', a: 'Contact your competition admin or the pub running the competition. An admin can reset your password from the admin panel.' },
            { q: 'The AI misread my bet slip — what do I do?', a: 'After uploading your screenshot, you can review and edit all extracted fields before confirming the submission. Make sure the odds, selection names, and stake are correct before hitting Submit.' },
            { q: 'Which browsers are supported?', a: 'Punting Club works on any modern browser — Chrome, Safari, Firefox, and Edge on both desktop and mobile. For the best experience on iOS, use Safari.' },
          ],
        },
      ].map(({ category, icon, items }) => (
        <div key={category} className="mb-8">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-7 h-7 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center flex-shrink-0">
              {icon}
            </div>
            <h2 className="text-lg font-black text-slate-900">{category}</h2>
          </div>
          <div className="space-y-2">
            {items.map(({ q, a }) => (
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
      ))}

      <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-6 text-center mt-8">
        <h3 className="font-bold text-lg mb-1 text-slate-900">Still have questions?</h3>
        <p className="text-slate-500 text-sm mb-4">Check the Rules page for full competition details, or speak to your competition host.</p>
        <button
          onClick={() => navigateTo('competition')}
          className="bg-gradient-to-r from-blue-600 to-blue-700 text-black px-6 py-2.5 rounded-xl font-bold text-sm transition-all hover:scale-105"
        >
          View Full Rules
        </button>
      </div>
    </div>
  </section>
);

export default FaqView;
