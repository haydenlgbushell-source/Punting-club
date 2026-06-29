import React, { useState, useRef, useEffect, useCallback } from 'react';
import { MessageCircle, X, Send, Loader2, Sparkles, ChevronRight } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';

const SYSTEM_PROMPT = `You are the Punting Club support assistant — a friendly, knowledgeable helper embedded in an Australian pub sports betting competition platform.

ABOUT PUNTING CLUB:
- Teams of up to 10+ members compete across a season (8, 16, or 32 weeks)
- Each week, teams place multi-bets (any sport/racing, any bookmaker) up to a weekly limit set by the competition host
- Teams upload a screenshot of their bet slip; AI reads it and tracks results automatically
- The team with the highest total winnings at season end wins the jackpot prize pool funded by buy-ins
- Week runs Wednesday 12:00 AM to Tuesday 11:59 PM AEST
- Results are checked by AI every 3 hours once the first leg starts

KEY RULES:
- Buy-in amount and structure set per competition by the host (pub/club)
- Buy-in can be paid by captain alone or split equally among members
- Bets must be submitted before the first leg starts
- Final week has a boosted bet limit
- You keep all winnings from your bets; the jackpot is separate (funded by buy-ins)
- Payout structure depends on number of teams (winner takes all, top 2, or top 3)

TEAM ROLES:
- Captain: creates team, approves/rejects member requests, sets betting order, confirms deposits
- Member: can place bets when it's their turn in the rotation
- View-only: can see team bets and leaderboard but cannot place bets
- Pending: waiting for captain approval

HOW TO:
- Sign up: tap Sign Up, enter name + mobile + password, then create or join a team
- Join a team: enter the 6-character team code (given by captain)
- Submit a bet: go to Leaderboard → Submit Bet → upload bet slip screenshot
- Check results: AI auto-checks every 3 hrs; manual check available on Leaderboard
- Update profile: tap your initial in the top-right navbar corner
- Reset password: contact your competition admin

CAPTAIN GUIDE:
- Approve members: My Team page → pending requests appear at top
- Set betting order: My Team page → drag to reorder (determines who bets each week)
- Finalise team: confirms deposits and locks the roster for the season
- Track deposits: toggle paid/unpaid for each member on My Team page

TONE: Friendly, casual Australian English. Keep answers concise (2-4 sentences max). Use "mate", "no worries", etc. sparingly — sound natural, not forced. If you don't know something specific to their competition, tell them to check with their competition host or pub admin.

BOUNDARIES:
- Never give gambling advice, tips, or odds analysis
- Never share personal data about other users
- If asked about something outside Punting Club, politely redirect
- For account issues you can't resolve, suggest contacting their competition admin or messaging via WhatsApp`;

const QUICK_ACTIONS = [
  { label: 'How do I sign up?', msg: 'How do I sign up for Punting Club?' },
  { label: 'Submit a bet', msg: 'How do I submit a bet?' },
  { label: 'Join a team', msg: 'How do I join a team with a team code?' },
  { label: 'Betting rules', msg: 'What are the betting rules and weekly limits?' },
  { label: 'Captain guide', msg: "I'm a captain — how do I manage my team?" },
];

const SupportChat = () => {
  const { isLoggedIn, currentUser, viewedRole, myTeamName, currentWeekNum, activeCompetitions } = useApp();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [hasInteracted, setHasInteracted] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  const buildContextPrefix = useCallback(() => {
    const parts = [];
    if (isLoggedIn && currentUser) {
      parts.push(`The user is logged in as ${currentUser.firstName || 'a member'}.`);
      if (viewedRole) parts.push(`Their role is: ${viewedRole}.`);
      if (myTeamName) parts.push(`Their team is: ${myTeamName}.`);
    } else {
      parts.push('The user is not logged in.');
    }
    if (currentWeekNum !== undefined) parts.push(`Current competition week: ${currentWeekNum + 1}.`);
    if (activeCompetitions?.length) {
      parts.push(`Active competitions: ${activeCompetitions.map(c => c.name).join(', ')}.`);
    }
    return parts.length ? `[Context: ${parts.join(' ')}]\n\n` : '';
  }, [isLoggedIn, currentUser, viewedRole, myTeamName, currentWeekNum, activeCompetitions]);

  const sendMessage = useCallback(async (text) => {
    if (!text.trim() || loading) return;
    setHasInteracted(true);

    const userMsg = { role: 'user', content: text.trim() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const contextPrefix = buildContextPrefix();
      const apiMessages = messages
        .concat(userMsg)
        .map((m, i) => ({
          role: m.role,
          content: i === 0 && m.role === 'user' ? contextPrefix + m.content : m.content,
        }));

      const res = await fetch('/api/claude', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 512,
          system: SYSTEM_PROMPT,
          messages: apiMessages,
        }),
      });

      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error?.message || data.error || 'Failed to get response');

      const reply = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
      setMessages(prev => [...prev, { role: 'assistant', content: reply || "Sorry, I couldn't generate a response. Try again!" }]);
    } catch (e) {
      setMessages(prev => [...prev, { role: 'assistant', content: `Sorry, something went wrong: ${e.message}. Please try again.` }]);
    } finally {
      setLoading(false);
    }
  }, [messages, loading, buildContextPrefix]);

  const handleSubmit = (e) => {
    e.preventDefault();
    sendMessage(input);
  };

  return (
    <>
      {/* Floating button */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-50 w-14 h-14 rounded-full bg-brand-700 hover:bg-brand-600 text-white shadow-xl shadow-brand-900/30 flex items-center justify-center transition-all hover:scale-105 active:scale-95"
          aria-label="Open support chat"
        >
          <MessageCircle className="w-6 h-6" />
        </button>
      )}

      {/* Chat panel */}
      {open && (
        <div className="fixed bottom-5 right-5 z-50 w-[360px] max-w-[calc(100vw-2.5rem)] h-[520px] max-h-[calc(100vh-6rem)] bg-white border border-gray-200 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
          {/* Header */}
          <div className="bg-gradient-to-r from-brand-700 to-brand-600 px-4 py-3 flex items-center justify-between flex-shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
                <Sparkles className="w-4 h-4 text-white" />
              </div>
              <div>
                <p className="text-white font-bold text-sm leading-tight">Punting Club Support</p>
                <p className="text-white/70 text-xs">Ask me anything</p>
              </div>
            </div>
            <button onClick={() => setOpen(false)} className="text-white/80 hover:text-white transition-colors p-1">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {/* Welcome message */}
            {!hasInteracted && (
              <div className="space-y-3">
                <div className="bg-brand-50 border border-brand-100 rounded-xl rounded-tl-sm px-3.5 py-2.5">
                  <p className="text-sm text-slate-700">
                    G'day{isLoggedIn && currentUser?.firstName ? ` ${currentUser.firstName}` : ''}! I'm your Punting Club assistant. Ask me anything about how the competition works, placing bets, team management, or rules.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <p className="text-xs text-slate-400 font-semibold px-1">Quick questions:</p>
                  {QUICK_ACTIONS.map(qa => (
                    <button
                      key={qa.label}
                      onClick={() => sendMessage(qa.msg)}
                      className="w-full text-left bg-white border border-gray-200 hover:border-brand-300 hover:bg-brand-50/50 rounded-lg px-3 py-2 text-xs text-slate-600 hover:text-brand-700 transition-all flex items-center justify-between group"
                    >
                      {qa.label}
                      <ChevronRight className="w-3 h-3 text-slate-300 group-hover:text-brand-500 transition-colors" />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Chat messages */}
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-brand-600 text-white rounded-br-sm'
                    : 'bg-gray-100 text-slate-700 rounded-tl-sm'
                }`}>
                  {msg.content.split('\n').map((line, li) => (
                    <p key={li} className={li > 0 ? 'mt-1.5' : ''}>{line}</p>
                  ))}
                </div>
              </div>
            ))}

            {/* Typing indicator */}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-gray-100 rounded-xl rounded-tl-sm px-4 py-3">
                  <div className="flex gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-2 h-2 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-2 h-2 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <form onSubmit={handleSubmit} className="border-t border-gray-200 px-3 py-2.5 flex items-center gap-2 flex-shrink-0 bg-white">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="Ask a question..."
              disabled={loading}
              className="flex-1 bg-gray-100 border border-gray-200 rounded-lg px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-400/30 disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={!input.trim() || loading}
              className="w-9 h-9 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:bg-gray-300 text-white flex items-center justify-center transition-colors flex-shrink-0 disabled:cursor-not-allowed"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </form>
        </div>
      )}
    </>
  );
};

export default SupportChat;
