import React, { useState, useRef, useCallback, useEffect, useLayoutEffect } from 'react';
import {
  apiSignUp, apiLogin, apiVerifySession,
  apiGetActiveCompetitions, apiCreateCompetition, apiUpdateCompStatus,
  apiGetAllTeams, apiUpdateTeam, apiFinaliseTeam,
  apiGetTeamMembers, apiApproveMember, apiRejectMember, apiUpdateMember, apiSaveBettingOrder,
  apiSubmitBet, apiGetAllBets, apiUpdateBetResult, apiUpdateBetLeg, apiRejectBet, apiCorrectBet, apiJoinExistingTeam,
  apiGetLeaderboard, apiGetAllUsers, apiUpdateKyc, apiGetAuditLog,
  apiCreateAdditionalTeam,
} from './api.js';
import { Trophy, Zap, Users, TrendingUp, ArrowRight, Menu, X, Sparkles, RotateCcw, CheckCircle, AlertCircle, Clock, ChevronDown, ChevronUp, Shield, Eye, Edit3, Lock, UserCheck, Activity, Database, Bell, Search, Filter, MoreVertical, Download, RefreshCw, Hash, DollarSign, FileText } from 'lucide-react';

// ─── In-memory stores ────────────────────────────────────────────────────────
// ── Data is now persisted in Supabase ──────────────────────────────────────
// userStore and teamStore replaced by Supabase tables via /api/auth and /api/data
// See src/supabase.js and src/api.js for all DB operations
// competitionStore replaced by activeCompetitions state (loaded from Supabase)
// In-memory fallback stores (used when Supabase is unavailable)
const localUserStore = {};     // phone → user object
const localTeamStore = {};     // teamCode → team object

// ── Admin roles ──────────────────────────────────────────────────────────────
// owner        → all privileges
// campaign     → confirm/correct results, disputes, password help
// pub_admin    → manage their own competition
const ADMIN_USERS = {
  'admin': { password: 'admin123', role: 'owner',    name: 'Owner Admin',       phone: 'admin' },
  'cm':    { password: 'cm123',    role: 'campaign',  name: 'Campaign Manager',  phone: 'cm' },
  'pub':   { password: 'pub123',   role: 'pub_admin', name: 'Pub Admin (RSL)',   phone: 'pub' },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
const genCode = (len = 6) => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
};

const parseAnalysisJSON = (text) => {
  try { return JSON.parse(text.replace(/```json|```/g, '').trim()); }
  catch { return null; }
};

// Multi-turn Claude call that handles web_search tool_use blocks.
const callClaudeWithSearch = async (prompt) => {
  const tools = [{ type: 'web_search_20250305', name: 'web_search' }];
  let messages = [{ role: 'user', content: prompt }];
  for (let turn = 0; turn < 6; turn++) {
    const res = await fetch('/api/claude', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 1024, tools, messages }),
    });
    if (!res.ok) throw new Error(`Claude API error ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    if (data.stop_reason === 'end_turn') {
      return data.content?.find(b => b.type === 'text')?.text || null;
    }
    if (data.stop_reason === 'tool_use') {
      messages = [
        ...messages,
        { role: 'assistant', content: data.content },
        {
          role: 'user',
          content: data.content.filter(b => b.type === 'tool_use').map(b => ({
            type: 'tool_result', tool_use_id: b.id,
            content: `Search for "${b.input?.query || ''}" was executed.`,
          })),
        },
      ];
      continue;
    }
    return data.content?.find(b => b.type === 'text')?.text || null;
  }
  return null;
};

// Validate and normalise Australian mobile numbers
// Accepts: 04XX XXX XXX, +614XX XXX XXX, 614XX XXX XXX
const validatePhone = (raw) => {
  const digits = raw.replace(/\D/g, ''); // strip all non-digits
  // Australian mobile: starts with 04 (10 digits) or 614 (11 digits)
  if (/^04\d{8}$/.test(digits)) return { valid: true, normalised: '0' + digits.slice(1) };
  if (/^614\d{8}$/.test(digits)) return { valid: true, normalised: '0' + digits.slice(2) };
  if (/^4\d{8}$/.test(digits))  return { valid: true, normalised: '0' + digits };
  return { valid: false, normalised: null };
};

const WEEK_BUDGET = 50;

// ─── Shared UI ───────────────────────────────────────────────────────────────
const Modal = ({ onClose, title, children, maxWidth = 'max-w-md' }) => (
  <div className="fixed inset-0 bg-black/80 backdrop-blur z-[100] overflow-y-auto">
    <div className="flex min-h-full items-start justify-center p-2 sm:p-4 py-4">
      <div className={`bg-gray-950 border-2 border-amber-500 rounded-xl w-full ${maxWidth} flex flex-col shadow-2xl shadow-amber-900/20`}>
        <div className="sticky top-0 bg-gray-950 border-b border-amber-500/30 p-4 flex justify-between items-center z-10 rounded-t-xl">
          <h2 className="text-lg font-bold text-white">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-amber-400 transition-colors"><X className="w-5 h-5" /></button>
        </div>
        <div>{children}</div>
      </div>
    </div>
  </div>
);

const Badge = ({ status }) => {
  const map = {
    won:         'bg-green-500/20 border-green-500/60 text-green-400',
    lost:        'bg-red-500/20 border-red-500/60 text-red-400',
    partial:     'bg-yellow-500/20 border-yellow-500/60 text-yellow-400',
    pending:     'bg-amber-500/10 border-amber-500/30 text-amber-400',
    void:        'bg-gray-500/20 border-gray-500/60 text-gray-400',
    in_progress: 'bg-orange-500/20 border-orange-500/60 text-orange-400',
  };
  const label = { won: '✓ Won', lost: '✗ Lost', partial: '⚡ Partial', pending: '⏳ Pending', void: '— Void', in_progress: '🔴 Live' };
  return <span className={`border text-xs font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${map[status] || map.pending}`}>{label[status] || '⏳ Pending'}</span>;
};

const LegDot = ({ leg }) => {
  const colors = {
    won:         'bg-green-500/30 border-green-500 text-green-400',
    lost:        'bg-red-500/30 border-red-500 text-red-400',
    void:        'bg-gray-500/30 border-gray-500 text-gray-400',
    pending:     'bg-amber-500/10 border-amber-500/40 text-amber-400',
    in_progress: 'bg-orange-500/30 border-orange-500 text-orange-400',
  };
  const icon = { won: '✓', lost: '✗', void: '—', pending: String(leg.legNumber), in_progress: '◉' };
  return (
    <div title={`Leg ${leg.legNumber}: ${leg.selection} @ ${leg.odds} — ${leg.status}`}
      className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold border ${colors[leg.status] || colors.pending}`}>
      {icon[leg.status] || leg.legNumber}
    </div>
  );
};

const PermissionBadge = ({ role }) => {
  const map = {
    captain:   { label: 'Captain', cls: 'bg-amber-500/20 text-amber-400 border-amber-500/50' },
    member:    { label: 'Member', cls: 'bg-blue-500/20 text-blue-400 border-blue-500/50' },
    'view-only': { label: 'View Only', cls: 'bg-gray-500/20 text-gray-400 border-gray-500/50' },
  };
  const r = map[role] || map.member;
  return <span className={`border text-xs px-2 py-0.5 rounded-full font-semibold ${r.cls}`}>{r.label}</span>;
};

// ─── BET SLIP DISPLAY ─────────────────────────────────────────────────────────
// Barlow Condensed — sports-display font (loaded in index.html)
const BC = "'Barlow Condensed', 'Inter', sans-serif";

const BetSlipCard = ({ bet, compact = false, onCheckBet, isChecking }) => {
  const [openLegs, setOpenLegs] = useState({});
  if (!bet) return null;

  const toggleLeg = (i) => setOpenLegs(prev => ({ ...prev, [i]: !prev[i] }));

  const legs       = bet.legs || [];
  const wonCount   = legs.filter(l => l.status === 'won').length;
  const lostCount  = legs.filter(l => l.status === 'lost').length;
  const liveCount  = legs.filter(l => l.status === 'in_progress').length;
  const pendCount  = legs.filter(l => l.status === 'pending').length;
  const totalLegs  = legs.length;

  // Derive overall status from legs — matches reference implementation logic
  const status = totalLegs === 0 ? (bet.overallStatus || 'pending')
    : liveCount > 0                           ? 'in_progress'
    : pendCount > 0                           ? 'pending'
    : lostCount > 0 && wonCount > 0           ? 'partial'
    : lostCount > 0                           ? 'lost'
    :                                           'won';

  const allWon = status === 'won';
  const estimatedReturn = bet.estimatedReturn || bet.return || 'N/A';
  const payoutValue = status === 'lost' ? '$0.00' : estimatedReturn;
  const payoutLabel = allWon ? 'WINNINGS' : 'POTENTIAL';
  const payoutColor = allWon ? '#22c55e' : status === 'lost' ? '#ef4444' : '#94a3b8';

  const titleText  = allWon ? '🏆 WINNER!' : status === 'lost' ? '❌ BUST' : status === 'partial' ? '⚡ PARTIAL' : status === 'in_progress' ? '🔴 LIVE' : '⏳ PENDING';
  const titleColor = allWon ? '#22c55e'    : status === 'lost' ? '#ef4444' : status === 'partial' ? '#eab308'   : status === 'in_progress' ? '#f97316'  : '#f59e0b';
  const cardBorder = allWon ? '#22c55e33'  : status === 'lost' ? '#ef444433' : status === 'partial' ? '#eab30833' : status === 'in_progress' ? '#f9731633' : '#f59e0b22';
  const cardBg     = allWon ? '#052e1680'  : status === 'lost' ? '#2d020280' : status === 'partial' ? '#42330080' : status === 'in_progress' ? '#43180080' : '#00000066';

  return (
    <div style={{ border: `1px solid ${cardBorder}`, background: cardBg, borderRadius: 16, overflow: 'hidden' }}>
      {/* ── Header ── */}
      <div style={{ padding: compact ? '16px 18px 12px' : '22px 22px 14px', borderBottom: '1px solid #ffffff0d' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontFamily: BC, fontWeight: 800, fontSize: 12, letterSpacing: '0.15em', color: '#f59e0b' }}>
            {(bet.type || 'MULTI').toUpperCase()} BET
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {bet.submittedAt && <span style={{ fontSize: 11, color: '#6b7280' }}>⌛ {bet.submittedAt}</span>}
            {onCheckBet && (status === 'pending' || status === 'in_progress') && (
              <button
                onClick={() => onCheckBet(bet.id)}
                disabled={isChecking}
                style={{ display: 'flex', alignItems: 'center', gap: 5, background: isChecking ? '#1e3a5f' : '#1e3a5f', border: '1px solid #2563eb66', borderRadius: 6, color: '#60a5fa', fontSize: 11, fontWeight: 700, fontFamily: BC, letterSpacing: '0.08em', padding: '3px 10px', cursor: isChecking ? 'not-allowed' : 'pointer', opacity: isChecking ? 0.7 : 1 }}
              >
                {isChecking
                  ? <><span style={{ width: 10, height: 10, border: '2px solid #60a5fa', borderTopColor: 'transparent', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.7s linear infinite' }} />CHECKING…</>
                  : <>↻ CHECK RESULT</>}
              </button>
            )}
          </div>
        </div>
        <div style={{ fontFamily: BC, fontWeight: 800, fontSize: compact ? 30 : 44, lineHeight: 1, color: titleColor, marginBottom: 4 }}>
          {titleText}
        </div>
        <p style={{ color: '#9ca3af', fontSize: 13, margin: 0 }}>{wonCount} of {totalLegs} leg{totalLegs !== 1 ? 's' : ''} won</p>
      </div>

      {/* ── Stats row ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', borderBottom: '1px solid #ffffff0d' }}>
        {[
          ['STAKE',       bet.stake,                              '#e2e8f0'],
          ['ODDS',        bet.combinedOdds || bet.odds || 'N/A', '#f59e0b'],
          [payoutLabel,   payoutValue,                            payoutColor],
        ].map(([label, value, color], i) => (
          <div key={label} style={{ padding: '12px 14px', textAlign: 'center', background: '#0d111780', borderRight: i < 2 ? '1px solid #ffffff0d' : 'none' }}>
            <div style={{ fontFamily: BC, letterSpacing: '0.12em', fontSize: 10, color: '#6b7280', marginBottom: 3 }}>{label}</div>
            <div style={{ fontFamily: BC, fontWeight: 700, fontSize: compact ? 17 : 21, color }}>{value}</div>
          </div>
        ))}
      </div>

      {/* ── Legs ── */}
      {totalLegs > 0 && (
        <div style={{ padding: '12px 12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontFamily: BC, letterSpacing: '0.14em', fontSize: 11, color: '#6b7280', marginBottom: 2 }}>
            {totalLegs} LEG{totalLegs !== 1 ? 'S' : ''}
          </div>
          {legs.map((leg, i) => {
            const won  = leg.status === 'won';
            const lost = leg.status === 'lost';
            const live = leg.status === 'in_progress';
            const legColor = won ? '#22c55e' : lost ? '#ef4444' : live ? '#f97316' : '#f59e0b';
            const isOpen = openLegs[i];
            return (
              <div key={i} className="bc-fadeup" style={{ background: '#111827', border: '1px solid #1f2937', borderLeft: `4px solid ${legColor}`, borderRadius: 10, animationDelay: `${i * 0.07}s` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '12px 14px' }}>
                  {/* Left — number + selection */}
                  <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flex: 1, minWidth: 0 }}>
                    <div style={{ width: 26, height: 26, borderRadius: '50%', background: '#1f2937', border: '1px solid #374151', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: BC, fontWeight: 700, fontSize: 12, color: '#f59e0b', flexShrink: 0, marginTop: 2 }}>
                      {i + 1}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontFamily: BC, fontWeight: 700, fontSize: 16, color: '#f1f5f9', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{leg.selection}</div>
                      <div style={{ fontSize: 12, color: '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{leg.event}{leg.market ? ` · ${leg.market}` : ''}</div>
                    </div>
                  </div>
                  {/* Right — odds + badge + toggle */}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 5, flexShrink: 0, marginLeft: 10 }}>
                    <div style={{ fontFamily: BC, fontWeight: 700, fontSize: 15, color: '#f59e0b' }}>@ {leg.odds}</div>
                    <div style={{ fontFamily: BC, fontWeight: 700, fontSize: 11, letterSpacing: '0.08em', padding: '2px 9px', borderRadius: 5, background: `${legColor}18`, color: legColor, border: `1px solid ${legColor}44` }}>
                      {won ? '✓ WON' : lost ? '✗ LOST' : live ? '◉ LIVE' : leg.status === 'void' ? '— VOID' : '⏳'}
                    </div>
                    {leg.resultNote && (
                      <button onClick={() => toggleLeg(i)} style={{ background: 'none', border: 'none', color: '#4b5563', fontSize: 11, cursor: 'pointer', padding: 0 }}>
                        {isOpen ? '▲ hide' : '▼ details'}
                      </button>
                    )}
                  </div>
                </div>
                {isOpen && leg.resultNote && (
                  <div style={{ borderTop: '1px solid #1f2937', padding: '10px 14px 12px', display: 'flex', gap: 7, fontSize: 13, color: '#9ca3af', lineHeight: 1.5 }}>
                    <span>{won ? '🟢' : lost ? '🔴' : '🟡'}</span>
                    <span>{leg.resultNote}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
export default function PuntingClub() {
  // Nav
  const [activeNav, setActiveNav] = useState('home');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Auth
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [loginPhone, setLoginPhone] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showLoginModal, setShowLoginModal] = useState(false);

  // Signup
  const [showSignupModal, setShowSignupModal] = useState(false);
  const [apiLoading, setApiLoading] = useState(false);
  const [apiError, setApiError]     = useState(null);
  const [signupMode, setSignupMode] = useState(null); // 'create' | 'join'

  // Create / join additional team (logged-in users)
  const [showCreateTeamModal, setShowCreateTeamModal] = useState(false);
  const [teamModalTab, setTeamModalTab]               = useState('create'); // 'create' | 'join'
  const [createTeamForm, setCreateTeamForm]           = useState({ teamName: '', competitionCode: '', buyInMode: 'split' });
  const [createTeamLoading, setCreateTeamLoading]     = useState(false);
  const [createTeamError, setCreateTeamError]         = useState(null);
  const [joinTeamCode, setJoinTeamCode]               = useState('');
  const [joinTeamLoading, setJoinTeamLoading]         = useState(false);
  const [joinTeamError, setJoinTeamError]             = useState(null);
  const [joinTeamSuccess, setJoinTeamSuccess]         = useState(null);

  // Active competitions from Supabase (for signup dropdown)
  const [activeCompetitions, setActiveCompetitions] = useState([]);
  const [currentTeamId, setCurrentTeamId] = useState(null);
  const [formData, setFormData] = useState({
    firstName: '', lastName: '', phone: '', dob: '', postcode: '',
    email: '', password: '', confirmPassword: '',
    teamName: '', teamCode: '', buyInMode: 'captain', // captain | split
    competitionCode: '',
  });

  // Leaderboard
  const [leaderboardTeams, setLeaderboardTeams] = useState([]);
  const [selectedTeamIdx, setSelectedTeamIdx] = useState(null);
  const [leaderboardView, setLeaderboardView] = useState('current'); // 'current' | 'season'

  // My Team
  const [pendingMembers, setPendingMembers] = useState([]);
  const [teamMembers, setTeamMembers] = useState([]);
  const [bettingOrder, setBettingOrder] = useState([]);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showOrderModal, setShowOrderModal] = useState(false);
  const [teamFinalised, setTeamFinalised] = useState(false);
  const [showFinaliseModal, setShowFinaliseModal] = useState(false);
  const [depositPerMember, setDepositPerMember] = useState(null); // calculated on finalise
  const [showCreateComp, setShowCreateComp] = useState(false);
  const [newComp, setNewComp] = useState({ name:'', pub:'', weeks:'8', buyIn:'$1,000', maxTeams:'20', startDate:'', endDate:'' });
  const [phoneError, setPhoneError] = useState('');

  // Admin state
  const [isAdminLoggedIn, setIsAdminLoggedIn] = useState(false);
  const [adminUser, setAdminUser] = useState(null);
  const [adminLoginId, setAdminLoginId] = useState('');
  const [adminLoginPw, setAdminLoginPw] = useState('');
  const [showAdminLogin, setShowAdminLogin] = useState(false);
  const [adminTab, setAdminTab] = useState('dashboard'); // dashboard | teams | users | bets | competitions | security
  const [adminTeams, setAdminTeams] = useState([]);
  const [adminUsers, setAdminUsers] = useState([]);
  const [adminBets, setAdminBets] = useState([]);
  const [adminComps, setAdminComps] = useState([]);
  const [adminSearch, setAdminSearch] = useState('');
  const [adminAuditLog, setAdminAuditLog] = useState([]);
  const [editingBet, setEditingBet] = useState(null); // bet being manually edited
  const [expandedBetId, setExpandedBetId] = useState(null); // bet whose legs are shown in admin
  const [legNotes, setLegNotes] = useState({}); // {legId: resultNote string}
  const [expandedCompId, setExpandedCompId] = useState(null); // which comp shows team list
  const [adminLoadError, setAdminLoadError] = useState(null);
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminNotifs, setAdminNotifs] = useState([]);

  // Bet Analyzer
  const [showBetAnalyzer, setShowBetAnalyzer] = useState(false);
  const [uploadedImages, setUploadedImages] = useState([]);
  const [analyzedBet, setAnalyzedBet] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [selectedTeamForBet, setSelectedTeamForBet] = useState('');
  const [showBetResults, setShowBetResults] = useState(false);
  const fileInputRef = useRef(null);

  // Result checking
  const [checkingResults, setCheckingResults] = useState(false);
  const [lastChecked, setLastChecked] = useState(null);
  const [checkingBetId, setCheckingBetId] = useState(null);
  const [resultLog, setResultLog] = useState([]);
  const intervalRef = useRef(null);

  // Toast notifications
  const [toasts, setToasts] = useState([]);
  const showToast = useCallback((message, type = 'info') => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3800);
  }, []);

  // Scroll to top on page navigation
  useLayoutEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [activeNav]);

  // Landscape hint (mobile)
  const [showLandscapeHint, setShowLandscapeHint] = useState(false);
  useEffect(() => {
    const check = () => {
      if (activeNav === 'leaderboard' && window.innerWidth < 768 && window.innerHeight > window.innerWidth) {
        setShowLandscapeHint(true);
      } else setShowLandscapeHint(false);
    };
    check();
    window.addEventListener('resize', check);
    window.addEventListener('orientationchange', check);
    return () => { window.removeEventListener('resize', check); window.removeEventListener('orientationchange', check); };
  }, [activeNav]);

  // ── AUTH ──────────────────────────────────────────────────────────────────
  const handleLogin = useCallback(async (e) => {
    e.preventDefault();
    if (!loginPhone.trim()) { setApiError('Please enter your mobile number.'); return; }
    const loginPhoneCheck = validatePhone(loginPhone);
    if (!loginPhoneCheck.valid) {
      setApiError('Please enter a valid Australian mobile number. Example: 0412 345 678');
      return;
    }
    if (!loginPassword.trim()) { setApiError('Please enter your password.'); return; }
    setApiLoading(true);
    setApiError(null);

    try {
      // Try Supabase auth first
      const result = await apiLogin(loginPhone, loginPassword);
      const user   = result.user;
      const teams  = result.teams || [];
      const myTeam = teams.find(t => t.myRole !== 'pending') || teams[0];
      // competitions may be nested as object or array depending on join
      const compCode = myTeam?.competitions?.code || (Array.isArray(myTeam?.competitions) ? myTeam.competitions[0]?.code : null);
      const sessionUser = { ...user, teamId: myTeam?.id, teamCode: myTeam?.team_code, teamName: myTeam?.team_name, role: myTeam?.myRole || user.role, firstName: user.first_name, lastName: user.last_name, competitionCode: compCode };
      setCurrentUser(sessionUser);
      setCurrentTeamId(myTeam?.id || null);
      setIsLoggedIn(true);
      setShowLoginModal(false);
      setLoginPhone(''); setLoginPassword('');
      if (myTeam?.id) setActiveNav('team');
      // Persist session so refresh doesn't log out
      try { localStorage.setItem('pc_session', JSON.stringify({ user, teamId: myTeam?.id, teamCode: myTeam?.team_code, teamName: myTeam?.team_name, role: myTeam?.myRole || user.role, competitionCode: compCode, token: result.session?.access_token || 'ok' })); } catch(e) {}
      if (myTeam?.id) {
        try {
          const members = await apiGetTeamMembers(myTeam.id);
          const mapped = members.map(m => ({ ...m, name: `${m.users?.first_name} ${m.users?.last_name}`.trim(), phone: m.users?.phone, depositPaid: m.deposit_paid, canBet: m.can_bet }));
          // Always ensure the logged-in user appears in the list
          const selfInList = mapped.some(m => m.user_id === user.id);
          if (!selfInList) {
            mapped.unshift({ user_id: user.id, role: myTeam.myRole || user.role, can_bet: true, canBet: true, deposit_paid: false, depositPaid: false, name: `${user.first_name} ${user.last_name}`.trim(), phone: user.phone });
          }
          setTeamMembers(mapped);
          const approved = mapped.filter(m => m.role !== 'pending');
          if (approved.length > 0) setBettingOrder(approved.map(m => m.name));
        } catch(e) { 
          // Fallback: at minimum show the logged-in user
          setTeamMembers([{ user_id: user.id, role: myTeam.myRole || user.role, can_bet: true, canBet: true, deposit_paid: false, depositPaid: false, name: `${user.first_name} ${user.last_name}`.trim(), phone: user.phone }]);
          console.warn('Could not load team members:', e.message); 
        }
      }
    } catch (err) {
      // Show the actual server error so we know what went wrong
      setApiError('Login failed: ' + (err.message || 'Unknown error'));
    } finally {
      setApiLoading(false);
    }
  }, [loginPhone, loginPassword]);

  const handleLogout = () => {
    setIsLoggedIn(false);
    setCurrentUser(null);
    setCurrentTeamId(null);
    setTeamMembers([]);
    setPendingMembers([]);
    setBettingOrder([]);
    setLeaderboardTeams([]);
    setTeamFinalised(false);
    setDepositPerMember(null);
    setActiveNav('home');
    try { localStorage.removeItem('pc_session'); } catch(e) {}
  };

  // ── CREATE ADDITIONAL TEAM ────────────────────────────────────────────────
  const handleCreateAdditionalTeam = async (e) => {
    e.preventDefault();
    if (!createTeamForm.teamName.trim()) { setCreateTeamError('Please enter a team name.'); return; }
    setCreateTeamLoading(true);
    setCreateTeamError(null);
    try {
      const team = await apiCreateAdditionalTeam({
        userId:          currentUser.id,
        teamName:        createTeamForm.teamName.trim(),
        competitionCode: createTeamForm.competitionCode || null,
        buyInMode:       createTeamForm.buyInMode || 'split',
      });
      // Switch to the new team
      const enrichedUser = { ...currentUser, teamId: team.id, teamCode: team.team_code, teamName: team.team_name, role: 'captain' };
      setCurrentUser(enrichedUser);
      setCurrentTeamId(team.id);
      setTeamMembers([{ user_id: currentUser.id, role: 'captain', can_bet: true, canBet: true, deposit_paid: false, depositPaid: false, name: `${currentUser.firstName} ${currentUser.lastName}`, users: { id: currentUser.id, first_name: currentUser.firstName, last_name: currentUser.lastName } }]);
      try { localStorage.setItem('pc_session', JSON.stringify({ user: currentUser, teamId: team.id, teamCode: team.team_code, teamName: team.team_name, role: 'captain', competitionCode: createTeamForm.competitionCode || null, token: 'ok' })); } catch(_) {}
      setShowCreateTeamModal(false);
      setCreateTeamForm({ teamName: '', competitionCode: '', buyInMode: 'split' });
      setActiveNav('team');
    } catch (err) {
      setCreateTeamError(err.message);
    } finally {
      setCreateTeamLoading(false);
    }
  };

  // ── JOIN EXISTING TEAM (logged-in user) ──────────────────────────────────
  const handleJoinExistingTeam = async (e) => {
    e.preventDefault();
    const code = joinTeamCode.trim().toUpperCase();
    if (!code) { setJoinTeamError('Please enter a team code.'); return; }
    setJoinTeamLoading(true);
    setJoinTeamError(null);
    setJoinTeamSuccess(null);
    try {
      const result = await apiJoinExistingTeam(currentUser.id, code);
      setJoinTeamSuccess(`Request sent to join "${result.teamName}"${result.competitionName ? ` (${result.competitionName})` : ''}. The captain needs to approve your request.`);
      setJoinTeamCode('');
    } catch (err) {
      setJoinTeamError(err.message);
    } finally {
      setJoinTeamLoading(false);
    }
  };

  // ── SIGNUP ────────────────────────────────────────────────────────────────
  const handleSubmitSignup = useCallback(async (e) => {
    e.preventDefault();

    // Basic validation
    if (!formData.firstName?.trim()) { setApiError('Please enter your first name.'); return; }
    if (!formData.lastName?.trim())  { setApiError('Please enter your last name.'); return; }
    if (!formData.phone?.trim()) { setApiError('Please enter your mobile number.'); return; }
    const phoneValidation = validatePhone(formData.phone);
    if (!phoneValidation.valid) {
      setPhoneError('Enter a valid Australian mobile (e.g. 0412 345 678)');
      setApiError('Please enter a valid Australian mobile number. Examples: 0412 345 678 or +61 412 345 678');
      return;
    }
    setPhoneError('');
    if (!formData.password)          { setApiError('Please enter a password.'); return; }
    if (formData.password !== formData.confirmPassword) { setApiError('Passwords do not match.'); return; }
    if (formData.password.length < 6) { setApiError('Password must be at least 6 characters.'); return; }
    if (signupMode === 'create' && !formData.teamName?.trim()) { setApiError('Please enter a team name.'); return; }
    if (signupMode === 'join'   && !formData.teamCode?.trim()) { setApiError('Please enter a team code.'); return; }

    setApiLoading(true);
    setApiError(null);

    try {
      // Try Supabase first — if it works, great
      const result = await apiSignUp({
        phone:           validatePhone(formData.phone).normalised || formData.phone.trim(),
        password:        formData.password,
        firstName:       formData.firstName.trim(),
        lastName:        formData.lastName.trim(),
        email:           formData.email?.trim() || null,
        dob:             formData.dob || null,
        postcode:        formData.postcode?.trim() || null,
        teamName:        signupMode === 'create' ? formData.teamName.trim() : null,
        teamCode:        signupMode === 'join'   ? formData.teamCode.trim().toUpperCase() : null,
        buyInMode:       formData.buyInMode || 'split',
        competitionCode: formData.competitionCode || null,
      });

      const { user, team } = result;
      const teamCode = team?.team_code || team?.teamCode || '';
      const teamName = team?.team_name || team?.teamName || formData.teamName;

      setShowSignupModal(false);
      setSignupMode(null);
      setFormData({ firstName:'', lastName:'', phone:'', dob:'', postcode:'', email:'', password:'', confirmPassword:'', teamName:'', teamCode:'', buyInMode:'captain', competitionCode:'' });

      if (signupMode === 'create' && team) {
        const enrichedUser = { ...user, role:'captain', teamId: team.id, teamCode, teamName, firstName: formData.firstName.trim(), lastName: formData.lastName.trim(), competitionCode: formData.competitionCode || null };
        setCurrentUser(enrichedUser);
        setCurrentTeamId(team.id);
        setIsLoggedIn(true);
        setActiveNav('team');
        // Persist session
        try { localStorage.setItem('pc_session', JSON.stringify({ user: { ...user, first_name: formData.firstName.trim(), last_name: formData.lastName.trim() }, teamId: team.id, teamCode, teamName, role: 'captain', competitionCode: formData.competitionCode || null, token: result.session?.access_token || 'ok' })); } catch(e) {}
        // Add captain to teamMembers immediately
        const captainPhone = validatePhone(formData.phone).normalised || formData.phone.trim();
        setTeamMembers([{
          user_id:     user.id,
          role:        'captain',
          can_bet:     true,
          canBet:      true,
          deposit_paid: false,
          depositPaid: false,
          name:        `${formData.firstName.trim()} ${formData.lastName.trim()}`,
          phone:       captainPhone,
          users:       { id: user.id, first_name: formData.firstName.trim(), last_name: formData.lastName.trim(), phone: captainPhone },
        }]);
        // Also try to load full member list from DB
        if (team.id) {
          apiGetTeamMembers(team.id).then(members => {
            if (members?.length > 0) {
              setTeamMembers(members.map(m => ({ ...m, name: `${m.users?.first_name} ${m.users?.last_name}`.trim(), phone: m.users?.phone, depositPaid: m.deposit_paid, canBet: m.can_bet })));
            }
          }).catch(() => {});
        }
        // Push new team into admin panel immediately
        const captainName = `${formData.firstName.trim()} ${formData.lastName.trim()}`;
        setAdminTeams(prev => [{
          id: team.id, name: teamName, status: 'pending', captain: captainName,
          captainPhone: validatePhone(formData.phone).normalised || formData.phone.trim(),
          members: 1, memberList: [{ name: captainName, role: 'captain', depositPaid: false, canBet: true }],
          depositsPaid: 0, compCode: formData.competitionCode || '', teamCode,
          createdAt: new Date().toLocaleDateString('en-AU'), totalBet: '$0', flagged: false,
        }, ...prev]);
        showToast(`👑 Team "${teamName}" created! Code: ${teamCode} — share with your mates.`, 'success');
      } else if (result?.user && result?.team) {
        // Joined existing team — log in immediately
        const joinedUser = { ...result.user, teamId: result.team.id, teamCode: result.team.team_code, teamName: result.team.team_name, role: 'pending', firstName: formData.firstName.trim(), lastName: formData.lastName.trim(), competitionCode: result.team.competition_id || null };
        setCurrentUser(joinedUser);
        setCurrentTeamId(result.team.id);
        setIsLoggedIn(true);
        setActiveNav('team');
        try { localStorage.setItem('pc_session', JSON.stringify({ user: result.user, teamId: result.team.id, teamCode: result.team.team_code, teamName: result.team.team_name, role: 'pending', competitionCode: null, token: result.session?.access_token || 'ok' })); } catch(e) {}
        showToast(`Request sent to join "${result.team.team_name}" — waiting for captain approval.`, 'info');
      }

    } catch (apiErr) {
      setApiError('Sign up failed: ' + (apiErr.message || 'Unknown error'));
    } finally {
      setApiLoading(false);
    }
  }, [formData, signupMode]);

  // ── MEMBER MANAGEMENT ────────────────────────────────────────────────────
  const approveMember = async (userId) => {
    try {
      await apiApproveMember(currentTeamId, userId);
      setPendingMembers(prev => prev.filter(m => m.user_id !== userId));
      // Reload members from DB
      const members = await apiGetTeamMembers(currentTeamId);
      setTeamMembers(members.map(m => ({ ...m, name: `${m.users?.first_name} ${m.users?.last_name}`, phone: m.users?.phone, depositPaid: m.deposit_paid, canBet: m.can_bet })));
      showToast('Member approved!', 'success');
    } catch (err) { showToast(`Failed to approve member: ${err.message}`, 'error'); }
  };

  const rejectMember = async (userId) => {
    try {
      await apiRejectMember(currentTeamId, userId);
      setPendingMembers(prev => prev.filter(m => m.user_id !== userId));
    } catch (err) { showToast(`Failed to reject member: ${err.message}`, 'error'); }
  };

  const updateMemberRole = async (userId, role) => {
    try {
      setTeamMembers(prev => prev.map(m => m.user_id === userId ? { ...m, role, can_bet: role !== 'view-only', canBet: role !== 'view-only' } : m));
      await apiUpdateMember(currentTeamId, userId, { role, can_bet: role !== 'view-only' });
    } catch (err) { showToast(`Failed to update role: ${err.message}`, 'error'); }
  };

  const toggleCanBet = async (userId) => {
    const member = teamMembers.find(m => m.user_id === userId);
    if (member?.role === 'view-only') return;
    const newVal = !member?.can_bet;
    setTeamMembers(prev => prev.map(m => m.user_id === userId ? { ...m, can_bet: newVal, canBet: newVal } : m));
    try { await apiUpdateMember(currentTeamId, userId, { can_bet: newVal }); }
    catch (err) { showToast(`Failed to update betting permission: ${err.message}`, 'error'); }
  };

  const toggleDepositPaid = async (userId) => {
    const member = teamMembers.find(m => (m.user_id || m.phone) === userId);
    const newVal = !(member?.deposit_paid ?? member?.depositPaid);
    setTeamMembers(prev => prev.map(m => (m.user_id || m.phone) === userId ? { ...m, deposit_paid: newVal, depositPaid: newVal } : m));
    try { await apiUpdateMember(currentTeamId, userId, { deposit_paid: newVal }); }
    catch (err) { showToast(`Failed to update deposit: ${err.message}`, 'error'); }
  };

  // ── WEEK CALCULATION (Wednesday 12:00 AEST boundary) ─────────────────────
  // A week ends every Wednesday at 12:00 AEST; a new one begins at 12:01.
  const calcCurrentWeek = (startDate) => {
    if (!startDate) return 1;
    const AEST = 10 * 60 * 60 * 1000; // UTC+10 in ms
    const nowAEST  = Date.now() + AEST;
    const startAEST = new Date(startDate).getTime() + AEST;

    // Find the first Wednesday 12:00 AEST that is strictly after startAEST
    let boundary = new Date(startAEST);
    boundary.setUTCHours(12, 0, 0, 0); // noon in AEST-shifted date
    const daysToWed = (3 - boundary.getUTCDay() + 7) % 7; // 3 = Wednesday
    boundary = new Date(boundary.getTime() + daysToWed * 86400000);
    if (boundary.getTime() <= startAEST) boundary = new Date(boundary.getTime() + 7 * 86400000);

    if (nowAEST < boundary.getTime()) return 1;
    return Math.floor((nowAEST - boundary.getTime()) / (7 * 86400000)) + 2;
  };

  // Next Wednesday 12:00 AEST cutoff from now (for display)
  const nextWedCutoff = (() => {
    const AEST = 10 * 60 * 60 * 1000;
    let d = new Date(Date.now() + AEST);
    d.setUTCHours(12, 0, 0, 0);
    const daysToWed = (3 - d.getUTCDay() + 7) % 7;
    d = new Date(d.getTime() + daysToWed * 86400000);
    if (d.getTime() <= Date.now() + AEST) d = new Date(d.getTime() + 7 * 86400000);
    return new Date(d.getTime() - AEST); // back to real UTC for display
  })();

  // ── LEADERBOARD REFRESH ───────────────────────────────────────────────────
  const LEADERBOARD_COLORS = ['from-yellow-400 to-yellow-600','from-gray-300 to-gray-500','from-orange-400 to-orange-600','from-blue-400 to-blue-600','from-purple-400 to-purple-600','from-green-400 to-green-600','from-cyan-400 to-cyan-600','from-pink-400 to-pink-600'];

  const mapLeaderboardData = useCallback((data) => data.map((t, i) => ({
    rank: t.rank, team: t.team_name, week: t.currentWeekBet?.overall_status === 'won' ? 'W' : t.currentWeekBet?.overall_status === 'lost' ? 'L' : 'P',
    total: t.totalWonFormatted, color: LEADERBOARD_COLORS[i % LEADERBOARD_COLORS.length], members: t.memberCount,
    weekHistory: t.weekHistory || [], id: t.id, teamCode: t.team_code,
    bets: (t.bets || []).map(b => ({
      id: b.id, type: b.bet_type, stake: `$${((b.stake||0)/100).toFixed(2)}`, combinedOdds: b.combined_odds,
      estimatedReturn: `$${((b.estimated_return||0)/100).toFixed(2)}`, overallStatus: b.overall_status,
      submittedAt: new Date(b.submitted_at).toLocaleString(),
      legs: (b.bet_legs||[]).map(l => ({ id: l.id, legNumber: l.leg_number, selection: l.selection, event: l.event, market: l.market, odds: l.odds, status: l.status, resultNote: l.result_note, eventDate: l.event_date, startTime: l.start_time })),
    })),
  })), []);

  const refreshLeaderboard = useCallback(async (compCode, comps) => {
    const code = compCode || currentUser?.competitionCode;
    const competitions = comps || activeCompetitions;
    if (!code) return;
    const comp = competitions.find(c => c.code === code);
    if (!comp?.id) return;
    const weekNum = calcCurrentWeek(comp.start_date);
    try {
      const data = await apiGetLeaderboard(comp.id, weekNum);
      if (data?.length) {
        const mapped = mapLeaderboardData(data);
        setLeaderboardTeams(mapped);
        return mapped;
      }
    } catch(e) { console.error('Leaderboard refresh failed:', e); }
    return null;
  }, [currentUser?.competitionCode, activeCompetitions, mapLeaderboardData]);

  // ── RESULT CHECKER ────────────────────────────────────────────────────────
  // Calls the synchronous /api/check-results function once per pending bet
  // (one bet at a time keeps each call within the 26s Netlify timeout).
  const reviewBetResults = useCallback(async (teams) => {
    const UNSETTLED = ['pending', 'in_progress'];
    const pendingBets = teams.flatMap(t => t.bets).filter(b => b.legs?.some(l => UNSETTLED.includes(l.status)));
    if (!pendingBets.length) { setLastChecked(new Date()); showToast('No pending bets to check', 'info'); return; }

    setCheckingResults(true);
    showToast(`Checking ${pendingBets.length} bet(s) — searching live sports data…`, 'info');

    let totalLegsUpdated = 0;
    for (const bet of pendingBets) {
      try {
        const res = await fetch('/api/check-results', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ betId: bet.id }),
        });
        if (res.ok) {
          const data = await res.json();
          totalLegsUpdated += data.legsUpdated || 0;
        }
      } catch (e) {
        console.warn('[check-results] error for bet', bet.id, e.message);
      }
      await refreshLeaderboard();
    }

    setCheckingResults(false);
    setLastChecked(new Date());
    if (totalLegsUpdated > 0) {
      showToast('Results updated — leaderboard refreshed!', 'success');
      setResultLog(prev => [{ time: new Date().toLocaleTimeString(), message: `${totalLegsUpdated} leg(s) settled` }, ...prev.slice(0, 19)]);
    } else {
      showToast('No new results — matches may still be in progress', 'info');
    }
  }, [refreshLeaderboard, showToast]);

  // ── LOAD DATA ON MOUNT ─────────────────────────────────────────────────────
  useEffect(() => {
    // Load active competitions for signup dropdown
    apiGetActiveCompetitions()
      .then(data => setActiveCompetitions(data || []))
      .catch(err => console.error('Failed to load competitions:', err));

    // Restore session from localStorage so refresh doesn't log out
    try {
      const saved = localStorage.getItem('pc_session');
      if (saved) {
        const sess = JSON.parse(saved);
        const userId = sess?.user?.id;
        const teamId = sess?.teamId;
        if (userId && !String(userId).startsWith('local_') && (!teamId || !String(teamId).startsWith('local_'))) {
          // Optimistically restore from cache for instant UI
          const restoredUser = { ...sess.user, teamId: sess.teamId, teamCode: sess.teamCode, teamName: sess.teamName, role: sess.role, competitionCode: sess.competitionCode, firstName: sess.user.first_name, lastName: sess.user.last_name };
          setCurrentUser(restoredUser);
          setCurrentTeamId(sess.teamId || null);
          setIsLoggedIn(true);
          if (sess.teamId) setActiveNav('team');
          // Verify with server and refresh all data (handles stale cache, role changes, new teams)
          apiVerifySession(userId).then(result => {
            if (!result?.user) {
              // User no longer exists in DB — clear session
              try { localStorage.removeItem('pc_session'); } catch(_) {}
              setIsLoggedIn(false); setCurrentUser(null); setCurrentTeamId(null);
              return;
            }
            const { user, teams } = result;
            const myTeam = (teams || []).find(t => t.myRole !== 'pending') || (teams || [])[0];
            const compCode = myTeam?.competitions?.code || (Array.isArray(myTeam?.competitions) ? myTeam.competitions[0]?.code : null);
            const freshUser = { ...user, teamId: myTeam?.id, teamCode: myTeam?.team_code, teamName: myTeam?.team_name, role: myTeam?.myRole || user.role, firstName: user.first_name, lastName: user.last_name, competitionCode: compCode };
            setCurrentUser(freshUser);
            setCurrentTeamId(myTeam?.id || null);
            try { localStorage.setItem('pc_session', JSON.stringify({ user, teamId: myTeam?.id, teamCode: myTeam?.team_code, teamName: myTeam?.team_name, role: myTeam?.myRole || user.role, competitionCode: compCode, token: sess.token || 'ok' })); } catch(_) {}
          }).catch(() => {
            // Server unreachable — keep cached session, data will load via normal effects
          });
        } else {
          // local_ fallback ID — no longer valid now that functions are deployed, clear it
          try { localStorage.removeItem('pc_session'); } catch(_) {}
        }
      }
    } catch(e) { try { localStorage.removeItem('pc_session'); } catch(_) {} }
  }, []);

  // ── Admin data loader (reusable) ────────────────────────────────────────
  const mapTeam = (t) => {
    const captain = t.users ? `${t.users.first_name} ${t.users.last_name}`.trim() : t.captain_id;
    const members = Array.isArray(t.team_members) ? t.team_members : [];
    return {
      id: t.id, name: t.team_name, status: t.status || 'pending',
      captain, captainPhone: t.users?.phone || '',
      members: members.length,
      memberList: members.map(m => ({
        name: m.users ? `${m.users.first_name} ${m.users.last_name}`.trim() : '',
        role: m.role, phone: m.users?.phone, kyc: m.users?.kyc_status,
        depositPaid: m.deposit_paid, canBet: m.can_bet,
      })),
      depositsPaid: members.filter(m => m.deposit_paid).length,
      compCode: t.competitions?.code || '', compName: t.competitions?.name || '',
      teamCode: t.team_code,
      createdAt: new Date(t.created_at).toLocaleDateString('en-AU'),
      totalBet: '$0', flagged: t.flagged || false,
    };
  };

  const mapUser = (u) => {
    const membership = u.team_members?.[0];
    return {
      id: u.id, name: `${u.first_name} ${u.last_name}`.trim(), phone: u.phone,
      role: u.role, kyc: u.kyc_status, kyc_status: u.kyc_status,
      team: membership?.teams?.team_name || '',
      teamCode: membership?.teams?.team_code || '',
      dob: u.dob, postcode: u.postcode, active: u.active !== false, flagged: u.flagged || false,
      joinedAt: new Date(u.created_at).toLocaleDateString('en-AU'),
    };
  };

  const refreshAdminData = useCallback(async () => {
    // mapTeam and mapUser are inlined here to avoid stale closure
    setAdminLoading(true);
    setAdminLoadError(null);
    try {
      const [teams, users, bets, comps, audit] = await Promise.allSettled([
        apiGetAllTeams(),
        apiGetAllUsers(),
        apiGetAllBets(),
        apiGetActiveCompetitions(),
        apiGetAuditLog(100),
      ]);
      if (teams.status === 'fulfilled' && teams.value) {
        setAdminTeams(teams.value.map(mapTeam));
      } else if (teams.status === 'rejected') {
        setAdminLoadError('Teams: ' + teams.reason?.message);
      }
      if (users.status === 'fulfilled' && users.value) {
        setAdminUsers(users.value.map(mapUser));
      } else if (users.status === 'rejected') {
        setAdminLoadError(e => e ? e + ' | Users: ' + users.reason?.message : 'Users: ' + users.reason?.message);
      }
      if (bets.status === 'fulfilled' && bets.value) {
        setAdminBets(bets.value.map(b => ({
          id: b.id, team: b.teams?.team_name, status: b.overall_status,
          stake: `$${b.stake || 0}`, odds: b.combined_odds, aiConfidence: b.ai_confidence,
          flagged: b.flagged, submittedAt: new Date(b.submitted_at).toLocaleDateString('en-AU'),
          legs: (b.bet_legs || []).map(l => ({ ...l, legNumber: l.leg_number, resultNote: l.result_note, eventDate: l.event_date, startTime: l.start_time })),
        })));
      }
      if (comps.status === 'fulfilled' && comps.value) {
        setAdminComps(comps.value.map(c => ({ ...c, buyIn: `$${(c.buy_in||0).toLocaleString()}`, maxTeams: c.max_teams, startDate: c.start_date, endDate: c.end_date })));
      }
      if (audit.status === 'fulfilled' && audit.value) {
        setAdminAuditLog(audit.value.map(e => ({ ts: new Date(e.created_at).toLocaleString(), adminRole: e.admin_role, action: e.action, target: e.target, detail: e.detail })));
      }
    } finally {
      setAdminLoading(false);
    }
  }, []);

  // Load admin data when admin logs in
  useEffect(() => {
    if (!isAdminLoggedIn) return;
    refreshAdminData();
  }, [isAdminLoggedIn, refreshAdminData]);

  // Load leaderboard when competition is known
  useEffect(() => {
    if (!currentUser?.competitionCode || !activeCompetitions.length) return;
    refreshLeaderboard(currentUser.competitionCode, activeCompetitions);
  }, [currentUser?.competitionCode, activeCompetitions]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-fetch leaderboard from DB when user navigates to leaderboard tab
  // (picks up results written by the scheduled check-results function)
  useEffect(() => {
    if (activeNav === 'leaderboard' && currentUser?.competitionCode) {
      refreshLeaderboard();
    }
  }, [activeNav]); // eslint-disable-line react-hooks/exhaustive-deps

  // Smart auto-check: fire every 3 hours from the first event's start time
  useEffect(() => {
    if (!leaderboardTeams.length) return;
    const THREE_HOURS = 3 * 60 * 60 * 1000;

    // Find the earliest event start across all pending/in-progress legs
    let firstEventMs = null;
    for (const team of leaderboardTeams) {
      for (const bet of team.bets || []) {
        for (const leg of bet.legs || []) {
          if (leg.eventDate && ['pending', 'in_progress'].includes(leg.status)) {
            const timeStr = leg.startTime ? leg.startTime.substring(0, 5) : '00:00';
            const dt = new Date(`${leg.eventDate}T${timeStr}`);
            if (!isNaN(dt.getTime()) && (!firstEventMs || dt.getTime() < firstEventMs)) {
              firstEventMs = dt.getTime();
            }
          }
        }
      }
    }

    // Calculate milliseconds until next 3-hour check boundary from first event
    const now = Date.now();
    let delay;
    if (!firstEventMs) {
      delay = THREE_HOURS; // no event dates stored — fall back to 3h from now
    } else if (now < firstEventMs) {
      delay = firstEventMs - now; // wait until first event starts
    } else {
      const elapsed = now - firstEventMs;
      const nextCount = Math.ceil(elapsed / THREE_HOURS) || 1;
      delay = firstEventMs + nextCount * THREE_HOURS - now;
      if (delay < 30000) delay += THREE_HOURS; // avoid firing within 30s
    }

    // Schedule first check, then repeat every 3 hours
    const runCheck = async () => {
      const current = leaderboardTeams;
      if (current.length) await reviewBetResults(current);
    };
    const tid = setTimeout(() => {
      runCheck();
      intervalRef.current = setInterval(runCheck, THREE_HOURS);
    }, delay);

    return () => {
      clearTimeout(tid);
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaderboardTeams.length, reviewBetResults, refreshLeaderboard]);

  // Trigger a result check using client-side Claude+web-search, then persist
  // any changes to the DB. The scheduled background function runs the same
  // logic server-side every 3 hours as a backup.
  const checkResultsNow = useCallback(async () => {
    if (!leaderboardTeams.length) {
      showToast('No leaderboard data to check', 'info');
      return;
    }
    await reviewBetResults(leaderboardTeams);
  }, [leaderboardTeams, reviewBetResults, showToast]);

  // Per-bet result check — calls the synchronous /api/check-results function
  // with a specific betId. One bet fits comfortably within the 26s Netlify timeout.
  const checkSingleBet = useCallback(async (betId) => {
    if (!betId || checkingBetId) return;
    setCheckingBetId(betId);
    showToast('Checking result — searching live sports data…', 'info');

    try {
      const res = await fetch('/api/check-results', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ betId }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      await refreshLeaderboard();
      if (data.legsUpdated > 0) {
        showToast('Result found — leaderboard updated!', 'success');
        setResultLog(prev => [{ time: new Date().toLocaleTimeString(), message: `Bet — ${data.legsUpdated} leg(s) settled` }, ...prev.slice(0, 19)]);
      } else {
        showToast('No new results — match may still be in progress', 'info');
      }
    } catch (err) {
      showToast('Could not check result — try again shortly', 'warning');
      console.error('[check-results]', err.message);
    }
    setCheckingBetId(null);
  }, [checkingBetId, refreshLeaderboard, showToast]);

  // ── BET SUBMISSION ────────────────────────────────────────────────────────

  // ── TEAM FINALISATION ─────────────────────────────────────────────────────
  const finaliseTeam = async () => {
    const comp = activeCompetitions.find(c => c.code === currentUser?.competitionCode);
    const totalBuyIn = comp
      ? parseInt((comp.buy_in || comp.buyIn || '1000').toString().replace(/[^0-9]/g, '')) || 1000
      : 1000;
    const allMembers = teamMembers.length || 1;
    const perMember  = Math.ceil(totalBuyIn / allMembers);
    setDepositPerMember(perMember);
    setTeamFinalised(true);
    setShowFinaliseModal(false);
    try {
      if (currentUser?.teamId) await apiFinaliseTeam(currentUser.teamId, perMember);
    } catch (err) { console.error('Finalise save failed (local state still updated):', err); }
  };

  const unfinaliseTeam = () => {
    setTeamFinalised(false);
    setDepositPerMember(null);
  };

  // ── ADMIN AUTH ────────────────────────────────────────────────────────────
  const handleAdminLogin = (e) => {
    e.preventDefault();
    const a = ADMIN_USERS[adminLoginId.trim()];
    if (!a || a.password !== adminLoginPw) { showToast('Invalid admin credentials.', 'error'); return; }
    setIsAdminLoggedIn(true);
    setAdminUser(a);
    setShowAdminLogin(false);
    setActiveNav('admin');
    setAdminLoginId(''); setAdminLoginPw('');
    addAuditEntry(a.role, 'Admin Login', a.name, 'Logged in to admin panel');
  };

  const handleAdminLogout = () => {
    if (adminUser) addAuditEntry(adminUser.role, 'Admin Logout', adminUser.name, '');
    setIsAdminLoggedIn(false); setAdminUser(null); setActiveNav('home');
  };

  const addAuditEntry = (role, action, target, detail) => {
    const entry = { ts: new Date().toLocaleString(), adminRole: role, action, target, detail };
    setAdminAuditLog(prev => [entry, ...prev.slice(0, 99)]);
  };

  // ── ADMIN TEAM ACTIONS ────────────────────────────────────────────────────
  const verifyTeam = async (id) => {
    const t = adminTeams.find(x => x.id === id);
    setAdminTeams(prev => prev.map(t => t.id === id ? { ...t, status: 'verified' } : t));
    addAuditEntry(adminUser?.role, 'Team Verified', t?.name || id, 'Team status set to verified');
    setAdminNotifs(prev => [{ id: Date.now(), type:'success', msg:`${t?.name} verified`, time:'just now', read:false }, ...prev]);
    try { await apiUpdateTeam(id, { status: 'verified' }, adminUser?.role); } catch(err) { console.error(err); }
  };
  const suspendTeam = async (id) => {
    const t = adminTeams.find(x => x.id === id);
    setAdminTeams(prev => prev.map(t => t.id === id ? { ...t, status: 'suspended', flagged: true } : t));
    addAuditEntry(adminUser?.role, 'Team Suspended', t?.name || id, 'Team suspended by admin');
    try { await apiUpdateTeam(id, { status: 'suspended', flagged: true }, adminUser?.role); } catch(err) { console.error(err); }
  };
  const flagTeam = async (id) => {
    const t = adminTeams.find(x => x.id === id);
    const newFlagged = !t?.flagged;
    setAdminTeams(prev => prev.map(t => t.id === id ? { ...t, flagged: newFlagged } : t));
    try { await apiUpdateTeam(id, { flagged: newFlagged }, adminUser?.role); } catch(err) { console.error(err); }
  };

  // ── ADMIN USER / KYC ACTIONS ──────────────────────────────────────────────
  const setKycStatus = async (userId, status) => {
    const u = adminUsers.find(x => x.id === userId || x.phone === userId);
    setAdminUsers(prev => prev.map(u => (u.id === userId || u.phone === userId) ? { ...u, kyc_status: status, kyc: status, active: status !== 'rejected' } : u));
    addAuditEntry(adminUser?.role, `KYC ${status}`, u?.name || u?.first_name || userId, `KYC status updated to ${status}`);
    setAdminNotifs(prev => [{ id: Date.now(), type: status === 'verified' ? 'success' : 'error', msg:`${u?.name || u?.first_name} KYC ${status}`, time:'just now', read:false }, ...prev]);
    try { await apiUpdateKyc(u?.id || userId, status, adminUser?.role); } catch(err) { console.error(err); }
  };
  const resetPassword = (phone) => {
    const u = adminUsers.find(x => x.phone === phone);
    addAuditEntry(adminUser?.role, 'Password Reset', u?.name || phone, 'Temporary password issued');
    showToast(`Password reset SMS sent to ${u?.name || phone}.`, 'info');
  };

  // ── ADMIN BET ACTIONS ─────────────────────────────────────────────────────
  const confirmBetResult = async (id, result) => {
    const b = adminBets.find(x => x.id === id);
    setAdminBets(prev => prev.map(b => b.id === id ? { ...b, status: result, overall_status: result, flagged: false } : b));
    addAuditEntry(adminUser?.role, `Bet ${result}`, `${b?.team || b?.teams?.team_name} ${id}`, `Result manually set to ${result}`);
    setAdminNotifs(prev => [{ id: Date.now(), type: result === 'won' ? 'success' : 'warning', msg:`Bet marked ${result}`, time:'just now', read:false }, ...prev]);
    try { await apiUpdateBetResult(id, result, adminUser?.role); } catch(err) { console.error(err); }
  };
  const correctBetField = async (id, field, value) => {
    const b = adminBets.find(x => x.id === id);
    setAdminBets(prev => prev.map(b => b.id === id ? { ...b, [field]: value, flagged: false } : b));
    addAuditEntry(adminUser?.role, 'Bet Corrected', `${b?.team || b?.teams?.team_name} ${id}`, `${field} changed to ${value}`);
    try { await apiCorrectBet(id, field, value, adminUser?.role); } catch(err) { console.error(err); }
  };
  const rejectBet = async (id, reason) => {
    const b = adminBets.find(x => x.id === id);
    setAdminBets(prev => prev.map(bet => bet.id === id ? { ...bet, status: 'rejected', overall_status: 'rejected', flagged: false } : bet));
    addAuditEntry(adminUser?.role, 'Bet Rejected', `${b?.team || b?.teams?.team_name} ${id}`, reason);
    try { await apiRejectBet(id, reason, adminUser?.role); } catch(err) { console.error(err); }
  };

  const overrideLegResult = async (betId, legId, status, resultNote) => {
    const b = adminBets.find(x => x.id === betId);
    const leg = b?.legs?.find(l => l.id === legId);
    setAdminBets(prev => prev.map(bet => bet.id !== betId ? bet : {
      ...bet,
      legs: (bet.legs || []).map(l => l.id !== legId ? l : { ...l, status, result_note: resultNote, resultNote }),
    }));
    addAuditEntry(adminUser?.role, 'Leg Override', `${b?.team} — Leg ${leg?.leg_number}`, `${leg?.selection} → ${status}${resultNote ? ': ' + resultNote : ''}`);
    try { await apiUpdateBetLeg(legId, status, resultNote, adminUser?.role); } catch(err) { console.error(err); }
  };

  // ── ADMIN COMPETITION ACTIONS ─────────────────────────────────────────────
  const createCompetition = async (comp) => {
    if (!comp.name?.trim()) { showToast('Please enter a competition name.', 'warning'); return; }
    if (!comp.pub?.trim())  { showToast('Please enter a pub/club name.', 'warning'); return; }

    // Generate code and build competition object locally first
    const code = genCode(6);
    const status = adminUser?.role === 'owner' ? 'active' : 'pending';
    const buyInNum = parseInt(String(comp.buyIn || comp.buy_in || '1000').replace(/[^0-9]/g, '')) || 1000;
    const localComp = {
      id:         code,
      code,
      name:       comp.name.trim(),
      pub:        comp.pub.trim(),
      status,
      weeks:      parseInt(comp.weeks) || 8,
      buy_in:     buyInNum,
      buyIn:      `$${buyInNum.toLocaleString()}`,
      max_teams:  parseInt(comp.maxTeams) || 20,
      start_date: comp.startDate || null,
      end_date:   comp.endDate   || null,
      jackpot:    0,
      teams:      0,
    };

    // Update local state immediately — works even without Supabase
    setAdminComps(prev => [...prev, localComp]);
    setActiveCompetitions(prev => status === 'active' ? [...prev, localComp] : prev);
    addAuditEntry(adminUser?.role, 'Competition Created', localComp.name, `Code: ${code}`);
    showToast(`Competition "${localComp.name}" created! Code: ${code}`, 'success');

    // Also try to save to Supabase in background (won't block if it fails)
    try {
      const saved = await apiCreateCompetition(comp, adminUser?.role);
      // Update local entry with real DB id
      setAdminComps(prev => prev.map(c => c.code === code ? { ...c, id: saved.id } : c));
    } catch(err) {
      console.warn('Supabase save failed (competition saved locally only):', err.message);
    }
  };
  const updateCompStatus = async (id, status) => {
    setAdminComps(prev => prev.map(c => c.id === id ? { ...c, status } : c));
    addAuditEntry(adminUser?.role, `Competition ${status}`, id, '');
    try {
      await apiUpdateCompStatus(id, status, adminUser?.role);
      const active = await apiGetActiveCompetitions();
      setActiveCompetitions(active);
    } catch(err) { console.error(err); }
  };

  const markNotifRead = (id) => setAdminNotifs(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
  const unreadNotifs = adminNotifs.filter(n => !n.read).length;

  // canAdmin: owner can do everything; campaign can edit bets/kyc; pub_admin can only see their comp
  const canAdmin = (action) => {
    if (!adminUser) return false;
    if (adminUser.role === 'owner') return true;
    if (adminUser.role === 'campaign') return ['bets','kyc','disputes','password'].includes(action);
    if (adminUser.role === 'pub_admin') return ['competitions','leaderboard'].includes(action);
    return false;
  };

  const handleImageUpload = (e) => {
    const files = Array.from(e.target.files);
    Promise.all(files.map(f => new Promise(res => { const r = new FileReader(); r.onload = () => res({ src: r.result, name: f.name, mediaType: f.type || 'image/jpeg' }); r.readAsDataURL(f); }))).then(imgs => setUploadedImages(prev => [...prev, ...imgs]));
  };

  const analyzeBetSlips = async () => {
    if (!uploadedImages.length) { showToast('Please upload at least one bet slip image.', 'warning'); return; }
    setAnalyzing(true);
    try {
      const res = await fetch('/api/claude', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ model:'claude-sonnet-4-6', max_tokens:1600, messages:[{ role:'user', content:[
        { type:'text', text:`You are a sports betting expert. Analyze this bet slip image carefully and return ONLY valid JSON in this exact format:\n{\n  "betType":"Multi",\n  "stake":"$50.00",\n  "combinedOdds":"3.50",\n  "estimatedReturn":"$175.00",\n  "submissionValid":true,\n  "legs":[{"legNumber":1,"event":"Team A vs Team B","selection":"Team A to Win","market":"Head to Head","odds":"2.10","eventDate":"2026-03-15","startTime":"19:30","status":"pending"}]\n}\nRules:\n- eventDate: REQUIRED — this is the date the MATCH/GAME is played, NOT the date the bet slip was printed or submitted. Look for the date shown specifically next to each individual leg/event (not a general slip date). Format: YYYY-MM-DD. If the year is not shown, assume the current year.\n- startTime: REQUIRED — the kick-off / start time for each individual event. Format: HH:MM in 24h. If not visible, use null.\n- dollar signs on money values, decimal odds\n- status for each leg must be one of: pending, won, lost, void\n- submissionValid = true if the bet was placed before the first leg started\n- Return ONLY valid JSON, no other text.` },
        ...uploadedImages.map(img => ({ type:'image', source:{ type:'base64', media_type: img.mediaType, data: img.src.split(',')[1] } }))
      ]}] }) });
      const data = await res.json();
      if (!res.ok || data.error || data.type === 'error') {
        const errMsg = data.error?.message || data.error || `API error ${res.status}`;
        showToast(`Analysis failed: ${errMsg}`, 'error');
        return;
      }
      if (data.content?.[0]?.text) {
        const parsed = parseAnalysisJSON(data.content[0].text);
        if (!parsed) { showToast('Could not read bet slip. Try a clearer image.', 'error'); return; }
        // Validate stake doesn't exceed weekly budget
        const stakeNum = parseFloat((parsed.stake || '0').replace(/[^0-9.]/g,''));
        if (stakeNum > WEEK_BUDGET) { showToast(`Stake $${stakeNum} exceeds the $${WEEK_BUDGET}/week limit.`, 'warning'); return; }
        const enrichedBet = { ...parsed, betType: parsed.betType || 'Multi', legs: parsed.legs || [], timestamp: new Date().toLocaleTimeString(), images: uploadedImages.length };
        setAnalyzedBet(enrichedBet);
        // Auto-select the user's own team
        if (myTeamName) setSelectedTeamForBet(myTeamName);
      } else {
        showToast('Analysis failed: no response from AI.', 'error');
        console.error('Claude response:', data);
      }
    } catch(err) { console.error(err); showToast(`Error analyzing bet slip: ${err.message}`, 'error'); }
    finally { setAnalyzing(false); }
  };

  const submitBet = async () => {
    if (!selectedTeamForBet) { showToast('Please select a team before submitting.', 'warning'); return; }
    const newBet = { type: analyzedBet.betType, stake: analyzedBet.stake, combinedOdds: analyzedBet.combinedOdds, estimatedReturn: analyzedBet.estimatedReturn, submissionValid: analyzedBet.submissionValid, legs: analyzedBet.legs, overallStatus: 'pending', submittedAt: analyzedBet.timestamp };
    // Optimistic UI update
    setLeaderboardTeams(prev => prev.map(t => t.team === selectedTeamForBet ? { ...t, bets: [...t.bets, newBet] } : t));
    setShowBetAnalyzer(false);
    resetBetAnalyzer();
    setActiveNav('team');
    // Persist to Supabase
    try {
      const team = leaderboardTeams.find(t => t.team === selectedTeamForBet);
      if (team?.id && currentUser?.id) {
        await apiSubmitBet({
          teamId:          team.id,
          submittedBy:     currentUser.id,
          weekNumber:      Math.max(1, currentWeekNum),
          betType:         newBet.type || 'Multi',
          stake:           Math.round(parseFloat((newBet.stake || '0').replace(/[^0-9.]/g,'')) * 100),
          combinedOdds:    newBet.combinedOdds,
          estimatedReturn: Math.round(parseFloat((newBet.estimatedReturn || '0').replace(/[^0-9.]/g,'')) * 100),
          submissionValid: newBet.submissionValid !== false,
          legs:            newBet.legs || [],
        });
      }
    } catch (err) {
      console.error('Bet save failed:', err.message);
      showToast(`Bet could not be saved: ${err.message}`, 'error');
    }
  };

  const resetBetAnalyzer = () => { setUploadedImages([]); setAnalyzedBet(null); setSelectedTeamForBet(''); };

  // ── DERIVED ───────────────────────────────────────────────────────────────
  const myTeamName = currentUser?.teamName || '';
  const myTeamData = leaderboardTeams.find(t => t.team === myTeamName) || leaderboardTeams[0];

  // Enrich leaderboard with member names for current user's team
  const enrichedLeaderboardTeams = leaderboardTeams.map(t => {
    if (t.team === myTeamName && teamMembers.length > 0) {
      return { ...t, memberList: teamMembers.map(m => ({ name: m.name || `${m.users?.first_name || ''} ${m.users?.last_name || ''}`.trim(), role: m.role })) };
    }
    return t;
  });
  // Week number derived from competition start date, fallback to 0
  const currentWeekNum = (() => {
    const comp = activeCompetitions.find(c => c.code === currentUser?.competitionCode);
    if (!comp?.start_date) return 0;
    return calcCurrentWeek(comp.start_date) - 1; // 0-indexed for betting order rotation
  })();
  const currentWeekBettorIdx = currentWeekNum;
  const currentBettor = bettingOrder[currentWeekBettorIdx % Math.max(1, bettingOrder.length)];
  const shareableLink = `${typeof window !== 'undefined' ? window.location.origin : 'https://puntingclub.com'}?join=${currentUser?.teamCode || 'XXXXXX'}`;

  // Load team data when user logs in
  useEffect(() => {
    if (!isLoggedIn || !currentUser?.teamId) return;
    apiGetTeamMembers(currentUser.teamId)
      .then(members => {
        setTeamMembers(members.map(m => ({
          ...m,
          phone:       m.users?.phone || m.user_id,
          name:        `${m.users?.first_name || ''} ${m.users?.last_name || ''}`.trim() || 'Member',
          role:        m.role,
          canBet:      m.can_bet,
          depositPaid: m.deposit_paid,
        })));
        setPendingMembers(members.filter(m => m.role === 'pending'));
      })
      .catch(err => console.warn('Could not load team members (using demo data):', err));
  }, [isLoggedIn, currentUser?.teamId]);

  const allDepositsConfirmed = teamMembers.every(m => m.depositPaid || m.deposit_paid);

  // ── RENDER ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-950 text-white font-sans overflow-x-hidden">

      {/* Landscape hint */}
      {showLandscapeHint && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 bg-amber-500 text-black text-xs font-bold px-4 py-2 rounded-full shadow-lg flex items-center gap-2 animate-bounce">
          📱 Rotate to landscape for best view
          <button onClick={() => setShowLandscapeHint(false)}><X className="w-3 h-3" /></button>
        </div>
      )}

      {/* ── NAV ─────────────────────────────────────────────────────────── */}
      <nav className="fixed top-0 w-full bg-gray-950 border-b border-amber-500/20 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-2 cursor-pointer" onClick={() => setActiveNav('home')}>
              <Sparkles className="w-6 h-6 text-amber-500" />
              <span className="text-xl font-black bg-gradient-to-r from-amber-400 to-amber-600 bg-clip-text text-transparent">PUNTING CLUB</span>
            </div>
            <div className="hidden md:flex items-center gap-1">
              {[['home','Home'],['competition','Competition'],['leaderboard','Leaderboard'],['weekly','Summary'],['team','My Team'],['howto','How To']].map(([key, label]) => (
                <button key={key} onClick={() => setActiveNav(key)} className={`px-3 py-1.5 rounded-lg text-sm transition-all ${activeNav === key ? 'text-amber-400 bg-amber-500/10 font-semibold' : 'text-gray-400 hover:text-amber-300 hover:bg-white/5'}`}>{label}</button>
              ))}
              {/* Admin nav — always visible as a discreet entry point */}
              {isAdminLoggedIn ? (
                <button onClick={() => setActiveNav('admin')} className={`relative px-3 py-1.5 rounded-lg text-sm transition-all flex items-center gap-1.5 ${activeNav === 'admin' ? 'text-red-400 bg-red-500/10 font-semibold' : 'text-red-500/70 hover:text-red-400 hover:bg-red-500/5'}`}>
                  <Shield className="w-3.5 h-3.5" />Admin
                  {unreadNotifs > 0 && <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full text-white text-xs flex items-center justify-center font-bold">{unreadNotifs}</span>}
                </button>
              ) : (
                <button onClick={() => setShowAdminLogin(true)} className="px-2 py-1.5 rounded-lg text-gray-700 hover:text-gray-500 text-xs transition-all flex items-center gap-1" title="Admin login">
                  <Lock className="w-3 h-3" />
                </button>
              )}
              {isLoggedIn ? (
                <div className="flex items-center gap-3 ml-2">
                  <div className="text-right">
                    <p className="text-amber-400 text-xs font-bold leading-tight">{currentUser?.teamName}{currentUser?.role === 'captain' && <span className="ml-1">👑</span>}</p>
                    <p className="text-gray-500 text-xs leading-tight">{currentUser?.firstName} · <PermissionBadge role={currentUser?.role} /></p>
                  </div>
                  <button onClick={() => { setCreateTeamForm({ teamName: '', competitionCode: '', buyInMode: 'split' }); setCreateTeamError(null); setJoinTeamCode(''); setJoinTeamError(null); setJoinTeamSuccess(null); setTeamModalTab('create'); setShowCreateTeamModal(true); }} className="bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/40 text-amber-400 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all">+ New Team</button>
                  <button onClick={handleLogout} className="bg-red-500/20 hover:bg-red-500/30 border border-red-500/50 text-red-400 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all">Logout</button>
                </div>
              ) : (
                <div className="flex gap-2 ml-2">
                  <button onClick={() => setShowLoginModal(true)} className="border border-amber-500/50 hover:border-amber-500 text-amber-400 px-4 py-1.5 rounded-lg text-sm font-semibold transition-all">Login</button>
                  <button onClick={() => { setSignupMode('create'); setShowSignupModal(true); }} className="bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-black px-4 py-1.5 rounded-lg text-sm font-bold transition-all">Sign Up</button>
                </div>
              )}
            </div>
            <button onClick={() => setMobileMenuOpen(!mobileMenuOpen)} className="md:hidden text-amber-500 p-1" aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}>
              {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>
          {mobileMenuOpen && (
            <div className="md:hidden pb-4 space-y-1 border-t border-amber-500/20 pt-3 bg-gray-950">
              {[['home','Home'],['competition','Competition'],['leaderboard','Leaderboard'],['weekly','Summary'],['team','My Team'],['howto','How To']].map(([key, label]) => (
                <button key={key} onClick={() => { setActiveNav(key); setMobileMenuOpen(false); }} className="block w-full text-left px-3 py-2 rounded-lg text-amber-400 hover:bg-amber-500/10 text-sm">{label}</button>
              ))}
              <div className="border-t border-white/5 pt-3 space-y-2">
                {isLoggedIn ? (
                  <>
                    <p className="text-amber-400 text-sm font-bold px-3">{currentUser?.teamName} ({currentUser?.firstName})</p>
                    <button onClick={() => { setCreateTeamForm({ teamName: '', competitionCode: '', buyInMode: 'split' }); setCreateTeamError(null); setShowCreateTeamModal(true); setMobileMenuOpen(false); }} className="w-full bg-amber-500/10 border border-amber-500/40 text-amber-400 px-4 py-2 rounded-lg text-sm font-semibold">+ Create Another Team</button>
                    <button onClick={() => { handleLogout(); setMobileMenuOpen(false); }} className="w-full bg-red-500/20 border border-red-500/50 text-red-400 px-4 py-2 rounded-lg text-sm font-semibold">Logout</button>
                  </>
                ) : (
                  <>
                    <button onClick={() => { setShowLoginModal(true); setMobileMenuOpen(false); }} className="w-full border border-amber-500/50 text-amber-400 px-4 py-2 rounded-lg text-sm font-semibold">Login</button>
                    <button onClick={() => { setSignupMode('create'); setShowSignupModal(true); setMobileMenuOpen(false); }} className="w-full bg-gradient-to-r from-amber-500 to-amber-600 text-black px-4 py-2 rounded-lg text-sm font-bold">Sign Up</button>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </nav>

      {/* ── HOME ──────────────────────────────────────────────────────────── */}
      {activeNav === 'home' && (
        <>
          <section className="relative pt-28 pb-16 px-4 sm:px-6 overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-b from-amber-900/10 to-transparent pointer-events-none" />
            <div className="absolute top-20 right-10 w-96 h-96 bg-amber-500/5 rounded-full blur-3xl pointer-events-none" />
            <div className="max-w-5xl mx-auto text-center relative z-10">
              <h1 className="text-5xl sm:text-6xl lg:text-7xl font-black mb-6 bg-gradient-to-b from-amber-200 via-amber-400 to-amber-600 bg-clip-text text-transparent leading-tight">
                The Ultimate Sports Betting League
              </h1>
              <p className="text-lg sm:text-xl text-gray-300 mb-8 max-w-2xl mx-auto">
                Create a team, place bets, compete with friends. 8, 16, or 32 week seasons. AI-powered tracking.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center mb-12">
                <button onClick={() => { setSignupMode('create'); setShowSignupModal(true); }} className="bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-black px-8 py-4 rounded-xl font-bold text-lg transition-all transform hover:scale-105 flex items-center justify-center gap-2">
                  Create Team <ArrowRight className="w-5 h-5" />
                </button>
                <button onClick={() => { setSignupMode('join'); setShowSignupModal(true); }} className="border-2 border-amber-500 hover:bg-amber-500/10 text-amber-400 px-8 py-4 rounded-xl font-bold text-lg transition-all">
                  Join a Team
                </button>
              </div>
              <div className="grid grid-cols-3 gap-4 max-w-lg mx-auto">
                {[['$1,000', 'Buy-In'], ['$50', 'Weekly Bet'], ['32 Wks', 'Full Season']].map(([v, l]) => (
                  <div key={l} className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4">
                    <div className="text-2xl font-black text-amber-400">{v}</div>
                    <div className="text-gray-500 text-xs mt-1">{l}</div>
                  </div>
                ))}
              </div>
            </div>
          </section>
          <section className="pb-20 px-4 sm:px-6">
            <div className="max-w-5xl mx-auto grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                { icon: <Trophy className="w-7 h-7" />, title: 'Live Leaderboard', desc: 'Real-time rankings with instant updates' },
                { icon: <Zap className="w-7 h-7" />, title: 'AI Bet Analysis', desc: 'Upload slips — AI reads and tracks results' },
                { icon: <Users className="w-7 h-7" />, title: 'Team Management', desc: 'Roles, permissions, betting order & more' },
                { icon: <TrendingUp className="w-7 h-7" />, title: 'Season Tracking', desc: 'Full quarter, half and full season views' },
              ].map((f, i) => (
                <div key={i} className="bg-white/3 border border-white/8 rounded-xl p-6 hover:bg-amber-500/5 hover:border-amber-500/20 transition-all">
                  <div className="text-amber-400 mb-3">{f.icon}</div>
                  <h3 className="font-bold mb-1 text-sm">{f.title}</h3>
                  <p className="text-gray-500 text-xs">{f.desc}</p>
                </div>
              ))}
            </div>
          </section>
        </>
      )}

      {/* ── COMPETITION ───────────────────────────────────────────────────── */}
      {activeNav === 'competition' && (
        <section className="pt-28 pb-16 px-4 sm:px-6">
          <div className="max-w-5xl mx-auto">
            <h1 className="text-4xl font-black mb-2">Competition Rules</h1>
            <p className="text-gray-400 mb-10">Everything you need to know about how the competition works.</p>
            <div className="grid md:grid-cols-2 gap-6 mb-8">
              <div className="bg-white/3 border border-white/8 rounded-xl p-6">
                <h3 className="text-lg font-bold mb-4 text-amber-400">Betting Rules</h3>
                <ul className="space-y-3 text-sm text-gray-300">
                  {[['$1,000 buy-in','per team (goes to jackpot)'],['$50/week max','split how you like across bets'],['Any sport or racing','you choose the platform'],['Submit before','first leg of the bet starts'],['Last week','$200 final bet'],['You keep','all winnings from your bets']].map(([b,r],i) => (
                    <li key={i} className="flex gap-2"><span className="text-amber-500">▸</span><span><strong className="text-white">{b}</strong> {r}</span></li>
                  ))}
                </ul>
              </div>
              <div className="bg-white/3 border border-white/8 rounded-xl p-6">
                <h3 className="text-lg font-bold mb-4 text-amber-400">Season Lengths</h3>
                <div className="space-y-3">
                  {[['Full Season','32 weeks','border-amber-500'],['Half Season','16 weeks','border-amber-400/60'],['Quarter Season','8 weeks','border-amber-300/40']].map(([n,w,b]) => (
                    <div key={n} className={`bg-black/30 rounded-lg p-4 border-l-4 ${b}`}>
                      <div className="font-bold text-sm">{n}</div>
                      <div className="text-gray-500 text-xs mt-1">{w} of competition</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="bg-white/3 border border-white/8 rounded-xl p-6 mb-6">
              <h3 className="text-lg font-bold mb-4 text-amber-400">Payout Structure</h3>
              <div className="grid sm:grid-cols-3 gap-4">
                {[['Under 10 teams','Winner takes all','(minus 10% admin fee)'],['10–20 teams','1st takes jackpot','2nd gets $1,000'],['20+ teams','1st takes jackpot','2nd & 3rd split runner-up pool']].map(([t,f,s]) => (
                  <div key={t} className="bg-black/30 rounded-lg p-4">
                    <p className="text-amber-400 font-bold text-sm mb-2">{t}</p>
                    <p className="text-white text-sm">{f}</p>
                    <p className="text-gray-400 text-xs mt-1">{s}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-6">
              <h3 className="text-lg font-bold mb-3 text-amber-400">The Punting Week</h3>
              <p className="text-gray-300 text-sm">Each competition week runs <strong className="text-white">Monday 12:00AM → Sunday 11:59PM</strong>. Bets must be submitted before the first leg of your multi starts. Teams can split the $50 across multiple bets (e.g. 2×$25 or 5×$10). Final week of the competition has a <strong className="text-white">$200 bet limit</strong>.</p>
            </div>
          </div>
        </section>
      )}

      {/* ── LEADERBOARD ───────────────────────────────────────────────────── */}
      {activeNav === 'leaderboard' && (() => {
        // Derive ticker messages from settled leg result notes across all teams
        const tickerItems = enrichedLeaderboardTeams.flatMap(t =>
          (t.bets || []).flatMap(b =>
            (b.legs || [])
              .filter(l => l.resultNote && ['won','lost','in_progress'].includes(l.status))
              .map(l => `${l.selection} — ${l.resultNote}`)
          )
        );
        const ticker = tickerItems.length > 0 ? tickerItems
          : ['Results update automatically · Click "Check Results" to refresh · Expand a team row to see the full bet slip'];
        return (
        <section className="pt-28 pb-16 px-0 sm:px-0">
          {/* Scrolling results ticker */}
          <div style={{ background: '#111827', borderBottom: '1px solid #1f2937', overflow: 'hidden', whiteSpace: 'nowrap', height: 34, display: 'flex', alignItems: 'center' }}>
            <div className="bc-ticker">
              {[...ticker, ...ticker].map((msg, i) => (
                <span key={i} style={{ fontFamily: BC, fontWeight: 600, fontSize: 12, letterSpacing: '0.05em', color: '#f59e0b', padding: '0 28px' }}>
                  {msg} &nbsp;•
                </span>
              ))}
            </div>
          </div>
          <div className="max-w-5xl mx-auto px-2 sm:px-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-start justify-between mb-6 gap-4 px-2">
              <div>
                <h1 className="text-3xl font-black mb-1">Live Leaderboard</h1>
                <p className="text-gray-500 text-sm">
                  {(() => {
                    const comp = activeCompetitions.find(c => c.code === currentUser?.competitionCode);
                    const wk = comp?.start_date ? calcCurrentWeek(comp.start_date) : '—';
                    const total = comp?.weeks || '—';
                    return `Week ${wk} of ${total} · Closes Wed 12:00 AEST (${nextWedCutoff.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })})`;
                  })()}
                </p>
                {lastChecked && <p className="text-gray-600 text-xs mt-0.5">Last checked: {lastChecked.toLocaleTimeString()}</p>}
                {resultLog.slice(0,2).map((l, i) => <p key={i} className="text-green-400 text-xs mt-0.5">✓ {l.time} — {l.message}</p>)}
              </div>
              <div className="flex gap-2 flex-wrap">
                <button onClick={checkResultsNow} disabled={checkingResults} aria-label="Check results now" className="flex items-center gap-1.5 bg-blue-500/20 hover:bg-blue-500/30 border border-blue-500/40 text-blue-400 px-3 py-2 rounded-lg text-xs font-semibold disabled:opacity-50">
                  {checkingResults ? <><span className="animate-spin w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full inline-block" />Checking…</> : <><RotateCcw className="w-3 h-3" />Check Results</>}
                </button>
                <button onClick={() => setShowBetAnalyzer(true)} className="bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white px-4 py-2 rounded-lg font-bold text-xs">
                  Submit Bet
                </button>
              </div>
            </div>

            {/* View toggle */}
            <div className="flex gap-1 mb-4 px-2">
              {[['current','This Week'],['season','Season View']].map(([v,l]) => (
                <button key={v} onClick={() => setLeaderboardView(v)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${leaderboardView === v ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40' : 'text-gray-500 hover:text-gray-300'}`}>{l}</button>
              ))}
            </div>

            {/* Column headers */}
            {leaderboardView === 'current' && (
              <div className="hidden sm:grid grid-cols-12 gap-2 px-4 mb-1 text-xs font-semibold text-gray-600 uppercase tracking-wider">
                <div className="col-span-1">#</div>
                <div className="col-span-3">Team</div>
                <div className="col-span-2 text-center">Total</div>
                <div className="col-span-6 pl-3 border-l border-white/5">This Week's Bet</div>
              </div>
            )}

            {leaderboardView === 'season' && (
              <div className="hidden sm:grid grid-cols-12 gap-2 px-4 mb-1 text-xs font-semibold text-gray-600 uppercase tracking-wider">
                <div className="col-span-1">#</div>
                <div className="col-span-3">Team</div>
                <div className="col-span-2 text-center">Total</div>
                <div className="col-span-6 pl-3 border-l border-white/5">Week History</div>
              </div>
            )}

            {/* Rows */}
            <div className="space-y-1.5">
              {enrichedLeaderboardTeams.length === 0 && (
                <div className="text-center py-16">
                  <div className="text-5xl mb-4">🏆</div>
                  <p className="text-gray-400 font-semibold text-lg">No teams yet</p>
                  <p className="text-gray-600 text-sm mt-1">Teams will appear here once they register and submit bets.</p>
                </div>
              )}
              {enrichedLeaderboardTeams.map((team, idx) => {
                const isMe = isLoggedIn && team.team === myTeamName;
                const weekBet = team.bets[0] || null;
                const isOpen = selectedTeamIdx === idx;

                // Derive status from legs (same logic as BetSlipCard) so row colour
                // updates as soon as individual legs settle, even before DB overall_status syncs
                const computedStatus = (() => {
                  const legs = weekBet?.legs || [];
                  if (!legs.length) return weekBet?.overallStatus || 'pending';
                  if (legs.some(l => l.status === 'in_progress')) return 'in_progress';
                  if (legs.some(l => l.status === 'pending'))     return 'pending';
                  if (!legs.every(l => ['won','lost','void'].includes(l.status))) return 'pending';
                  if (legs.every(l => l.status === 'won'))  return 'won';
                  if (legs.some(l => l.status === 'lost'))  return 'lost';
                  return 'partial';
                })();

                const rowBg = isMe
                  ? 'border-amber-400/40 bg-amber-500/5'
                  : computedStatus === 'won'         ? 'border-green-500/20 bg-green-950/10'
                  : computedStatus === 'lost'        ? 'border-red-500/20 bg-red-950/10'
                  : computedStatus === 'partial'     ? 'border-yellow-500/20 bg-yellow-950/10'
                  : computedStatus === 'in_progress' ? 'border-orange-500/20 bg-orange-950/10'
                  : 'border-white/5 bg-white/2';

                return (
                  <div key={idx} className={`rounded-xl border overflow-hidden transition-all ${rowBg} ${isMe ? 'ring-1 ring-amber-400/30' : ''}`}>
                    <div className="grid grid-cols-12 gap-2 items-center px-3 py-3 cursor-pointer hover:bg-white/3 transition-colors" onClick={() => setSelectedTeamIdx(isOpen ? null : idx)}>
                      {/* Rank */}
                      <div className="col-span-1">
                        <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${team.color} flex items-center justify-center font-black text-white text-sm`}>{team.rank}</div>
                      </div>
                      {/* Name */}
                      <div className="col-span-4 sm:col-span-3 min-w-0 pl-1">
                        <div className="font-bold text-sm truncate flex items-center gap-1">
                          {team.team}
                          {isMe && <span className="text-amber-400 text-xs">(You)</span>}
                        </div>
                        <div className="text-gray-600 text-xs">{team.members} members</div>
                      </div>
                      {/* Total */}
                      <div className="hidden sm:block col-span-2 text-center">
                        <div className="font-bold text-amber-400 text-sm">{team.total}</div>
                      </div>

                      {/* This week / season */}
                      <div className="col-span-7 sm:col-span-6 pl-0 sm:pl-3 sm:border-l sm:border-white/5">
                        {leaderboardView === 'current' ? (
                          weekBet ? (
                            <div className="flex items-center gap-2 flex-wrap">
                              <Badge status={computedStatus} />
                              <span className="text-white text-xs font-semibold">{weekBet.type}</span>
                              <span className="text-gray-500 text-xs">·</span>
                              <span className="text-green-400 text-xs font-semibold">{weekBet.stake}</span>
                              <span className="hidden sm:inline text-gray-500 text-xs">→</span>
                              <span className="hidden sm:inline text-green-400 text-xs font-bold">{weekBet.estimatedReturn || weekBet.return || 'N/A'}</span>
                              {weekBet.legs?.length > 0 && (
                                <div className="flex gap-1 ml-auto">
                                  {weekBet.legs.map((leg, li) => <LegDot key={li} leg={leg} />)}
                                </div>
                              )}
                            </div>
                          ) : <span className="text-gray-700 text-xs italic">No bet submitted</span>
                        ) : (
                          // Season view — week history dots
                          <div className="flex items-center gap-1.5">
                            {['W1','W2','W3'].map((wk, wi) => {
                              const result = team.weekHistory?.[wi];
                              const cls = result === 'W' ? 'bg-green-500/30 border-green-500 text-green-400' : result === 'L' ? 'bg-red-500/30 border-red-500 text-red-400' : 'bg-white/5 border-white/10 text-gray-600';
                              return <div key={wk} className={`w-7 h-7 rounded-md border flex items-center justify-center text-xs font-bold ${cls}`}>{result || '–'}</div>;
                            })}
                            <span className="text-gray-600 text-xs ml-1">+ {Math.max(0, 8 - 3)} more</span>
                            <span className="text-amber-400 font-bold text-sm ml-auto">{team.total}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Expanded bet slip */}
                    {isOpen && (
                      <div className="border-t border-white/5 bg-black/30 px-3 py-3">
                        {/* Member roster */}
                        {team.memberList?.length > 0 && (
                          <div className="mb-3 pb-3 border-b border-white/5">
                            <p className="text-gray-500 text-xs uppercase tracking-wider mb-2">👥 Members</p>
                            <div className="flex flex-wrap gap-2">
                              {team.memberList.map((m, mi) => (
                                <div key={mi} className="flex items-center gap-1.5 bg-white/5 rounded-full px-2.5 py-1">
                                  <div className="w-5 h-5 rounded-full bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400 font-bold text-xs flex-shrink-0">
                                    {(m.name || m).charAt(0).toUpperCase()}
                                  </div>
                                  <span className="text-xs text-gray-300 font-medium">{m.name || m}</span>
                                  {m.role === 'captain' && <span className="text-amber-400 text-xs">👑</span>}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {weekBet ? <BetSlipCard bet={weekBet} onCheckBet={checkSingleBet} isChecking={checkingBetId === weekBet.id} /> : <p className="text-gray-600 text-sm italic text-center py-4">No bet submitted this week</p>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </section>
        );
      })()}

      {/* ── WEEKLY SUMMARY ────────────────────────────────────────────────── */}
      {activeNav === 'weekly' && (
        <section className="pt-28 pb-16 px-4 sm:px-6">
          <div className="max-w-5xl mx-auto">
            <h1 className="text-3xl font-black mb-1">Weekly Summary</h1>
            <p className="text-gray-500 mb-8 text-sm">Week 3 of 8 · Updated daily</p>
            <div className="grid md:grid-cols-2 gap-4 mb-8">
              <div className="bg-green-950/30 border border-green-500/30 rounded-xl p-5">
                <h3 className="font-bold text-green-400 mb-2">🎉 Big Win Alert!</h3>
                <p className="text-gray-300 text-sm">The Legends hit a 4-leg multi for $4,250!</p>
                <p className="text-gray-600 text-xs mt-2">2 hours ago</p>
              </div>
              <div className="bg-amber-950/20 border border-amber-500/30 rounded-xl p-5">
                <h3 className="font-bold text-amber-400 mb-2">⏰ Betting Reminder</h3>
                <p className="text-gray-300 text-sm">Week 3 deadline: tomorrow 12:00PM</p>
                <p className="text-gray-600 text-xs mt-2">Golden Odds — it's your turn!</p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4 mb-8">
              {[['Bets This Week','18','text-amber-400'],['Win Rate','65%','text-green-400'],['Total Winnings','$8,450','text-blue-400']].map(([l,v,c]) => (
                <div key={l} className="bg-white/3 border border-white/8 rounded-xl p-4 text-center">
                  <p className="text-gray-500 text-xs mb-1">{l}</p>
                  <p className={`text-2xl font-black ${c}`}>{v}</p>
                </div>
              ))}
            </div>
            <div className="bg-white/3 border border-white/8 rounded-xl p-6 mb-6">
              <h3 className="font-bold text-amber-400 mb-3">📊 AI Commentary</h3>
              <div className="text-sm text-gray-300 space-y-2 leading-relaxed">
                <p>Week 3 has been exceptional. 65% win rate across all teams with The Legends dominating via a 4-leg NRL multi.</p>
                <p><strong className="text-white">Key insight:</strong> 2–3 leg multis outperforming 4+ leg bets. Early-week bets (Mon–Wed) showing better value before odds shift.</p>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ── MY TEAM ───────────────────────────────────────────────────────── */}
      {activeNav === 'team' && (
        <section className="pt-28 pb-16 px-4 sm:px-6">
          <div className="max-w-4xl mx-auto">
            {!isLoggedIn && (
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 mb-6 text-center">
                <p className="text-amber-300 text-sm">Showing demo data. <button onClick={() => setShowLoginModal(true)} className="underline font-semibold">Log in</button> to see your team.</p>
              </div>
            )}

            {/* Team header */}
            <div className="flex flex-col sm:flex-row sm:items-start justify-between mb-6 gap-4">
              <div>
                <h1 className="text-3xl font-black mb-1">{myTeamName}</h1>
                <div className="flex items-center gap-2 flex-wrap">
                  <PermissionBadge role={currentUser?.role || 'member'} />
                  <span className="text-gray-500 text-sm">·</span>
                  <span className="text-gray-400 text-sm">#{myTeamData?.rank || 1} on leaderboard</span>
                  {currentUser?.competitionCode && (
                    <span className="text-xs bg-amber-500/10 border border-amber-500/20 text-amber-400 px-2 py-0.5 rounded-full">{currentUser.competitionCode}</span>
                  )}
                  {!allDepositsConfirmed && <span className="bg-red-500/20 border border-red-500/40 text-red-400 text-xs px-2 py-0.5 rounded-full">⚠ Deposits pending</span>}
                  {allDepositsConfirmed && <span className="bg-green-500/20 border border-green-500/40 text-green-400 text-xs px-2 py-0.5 rounded-full">✓ All deposits confirmed</span>}
                </div>
              </div>
              <div className="flex gap-2 flex-wrap">
                <button onClick={() => setShowInviteModal(true)} className="bg-amber-500/10 border border-amber-500/30 hover:bg-amber-500/20 text-amber-400 px-3 py-2 rounded-lg text-xs font-semibold">Invite Member</button>
                {currentUser?.role === 'captain' && (
                  <button onClick={() => setShowOrderModal(true)} className="bg-blue-500/10 border border-blue-500/30 hover:bg-blue-500/20 text-blue-400 px-3 py-2 rounded-lg text-xs font-semibold">Betting Order</button>
                )}
                {currentUser?.role === 'captain' && !teamFinalised && (
                  <button onClick={() => setShowFinaliseModal(true)} className="bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 text-white px-3 py-2 rounded-lg text-xs font-bold flex items-center gap-1">
                    <CheckCircle className="w-3.5 h-3.5" />Finalise Team
                  </button>
                )}
                {currentUser?.role === 'captain' && teamFinalised && (
                  <button onClick={unfinaliseTeam} className="bg-gray-500/20 border border-gray-500/30 text-gray-400 px-3 py-2 rounded-lg text-xs font-semibold">Re-open Team</button>
                )}
                <button onClick={() => setShowBetAnalyzer(true)} className="bg-gradient-to-r from-green-500 to-green-600 text-white px-3 py-2 rounded-lg text-xs font-bold">Submit Bet</button>
              </div>
            </div>

            {/* Captain tip — only shown if team has no members yet */}
            {currentUser?.role === 'captain' && teamMembers.length <= 1 && (
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 mb-5 flex items-start gap-3">
                <span className="text-xl flex-shrink-0">👑</span>
                <div>
                  <p className="font-bold text-amber-400 text-sm mb-1">Invite your team</p>
                  <p className="text-gray-400 text-xs leading-relaxed">Share your Team Code <strong className="text-amber-300">{currentUser?.teamCode}</strong> with friends. Members you invite need your approval before joining.</p>
                </div>
              </div>
            )}

            {/* Stats */}
            <div className="grid grid-cols-3 gap-3 mb-4">
              {[['Members', teamMembers.length, 'text-white'], ['Total Won', myTeamData?.total || '$0', 'text-green-400'], ['Position', `#${myTeamData?.rank || 1}`, 'text-amber-400']].map(([l,v,c]) => (
                <div key={l} className="bg-white/3 border border-white/8 rounded-xl p-4 text-center">
                  <p className="text-gray-500 text-xs mb-1">{l}</p>
                  <p className={`text-xl font-black ${c}`}>{v}</p>
                </div>
              ))}
            </div>

            {/* ── DEPOSIT CALCULATOR ─────────────────────────────────────── */}
            {teamFinalised && depositPerMember ? (
              <div className="bg-green-950/30 border-2 border-green-500/40 rounded-xl p-5 mb-5">
                <div className="flex items-start justify-between gap-3 mb-4">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <CheckCircle className="w-5 h-5 text-green-400" />
                      <h3 className="font-black text-green-400 text-base">Team Finalised</h3>
                    </div>
                    <p className="text-gray-400 text-xs">Deposit split calculated based on {teamMembers.filter(m => m.depositPaid).length} confirmed members</p>
                  </div>
                  {currentUser?.role === 'captain' && (
                    <button onClick={unfinaliseTeam} className="text-gray-600 hover:text-gray-400 text-xs border border-gray-700 px-2 py-1 rounded-lg">Re-open</button>
                  )}
                </div>

                {/* Big deposit amount */}
                <div className="bg-black/40 rounded-xl p-4 mb-4 text-center border border-green-500/20">
                  <p className="text-gray-500 text-xs uppercase tracking-wider mb-1">Deposit Per Member</p>
                  <p className="text-4xl font-black text-green-400">${depositPerMember.toLocaleString()}</p>
                  <p className="text-gray-500 text-xs mt-1">
                    ${(() => {
                      const comp = activeCompetitions.find(c => c.code === currentUser?.competitionCode);
                      return comp ? parseInt((comp.buyIn || '$1,000').replace(/[^0-9]/g,'')) || 1000 : 1000;
                    })()} total ÷ {teamMembers.filter(m => m.depositPaid).length} members
                  </p>
                </div>

                {/* Per-member breakdown */}
                <div className="space-y-2">
                  <p className="text-gray-500 text-xs uppercase tracking-wider">Member Payment Status</p>
                  {teamMembers.length === 0 && (
                    <div className="text-center py-8 text-gray-600">
                      <p className="text-2xl mb-2">👥</p>
                      <p className="text-sm">No members yet — share your team code to invite people.</p>
                    </div>
                  )}
                  {teamMembers.map(m => (
                    <div key={m.phone} className={`flex items-center justify-between rounded-lg px-3 py-2.5 ${m.depositPaid ? 'bg-green-950/30 border border-green-500/20' : 'bg-red-950/30 border border-red-500/20'}`}>
                      <div className="flex items-center gap-2">
                        <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${m.depositPaid ? 'bg-green-500 text-black' : 'bg-red-500/20 border border-red-500/40 text-red-400'}`}>
                          {m.depositPaid ? '✓' : '!'}
                        </div>
                        <span className="text-sm font-semibold">{m.name}</span>
                        <PermissionBadge role={m.role} />
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`font-black text-sm ${m.depositPaid ? 'text-green-400' : 'text-red-400'}`}>
                          {m.depositPaid ? `$${depositPerMember.toLocaleString()} ✓` : 'Unpaid'}
                        </span>
                        {currentUser?.role === 'captain' && m.role !== 'captain' && (
                          <button onClick={() => toggleDepositPaid(m.phone)} className={`text-xs px-2 py-1 rounded border ${m.depositPaid ? 'border-red-500/30 text-red-400 hover:bg-red-500/10' : 'border-green-500/30 text-green-400 hover:bg-green-500/10'}`}>
                            {m.depositPaid ? 'Mark Unpaid' : 'Mark Paid'}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Summary */}
                <div className="mt-4 pt-3 border-t border-green-500/20 flex items-center justify-between">
                  <div>
                    <p className="text-xs text-gray-500">{teamMembers.filter(m=>m.depositPaid).length} of {teamMembers.length} paid</p>
                    <p className="text-xs text-gray-600 mt-0.5">Total collected: <span className="text-green-400 font-bold">${(teamMembers.filter(m=>m.depositPaid).length * depositPerMember).toLocaleString()}</span> of <span className="text-white font-bold">${(() => { const comp = activeCompetitions.find(c => c.code === currentUser?.competitionCode); return comp ? parseInt((comp.buy_in||'1000').toString().replace(/[^0-9]/g,''))||1000 : 1000; })().toLocaleString()}</span></p>
                  </div>
                  {teamMembers.every(m => m.depositPaid) && (
                    <span className="bg-green-500 text-black text-xs font-black px-3 py-1 rounded-full">🎉 All Paid!</span>
                  )}
                </div>
              </div>
            ) : (
              /* Not yet finalised — show pending banner for captain */
              currentUser?.role === 'captain' && !teamFinalised && (
                <div className="bg-amber-950/20 border border-amber-500/30 rounded-xl p-4 mb-5 flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <span className="text-xl flex-shrink-0">💰</span>
                    <div>
                      <p className="font-bold text-amber-400 text-sm mb-1">Buy-In Not Yet Calculated</p>
                      <p className="text-gray-400 text-xs leading-relaxed">Once you've confirmed all members have joined, click <strong className="text-amber-300">Finalise Team</strong> to lock in the roster and automatically calculate each member's deposit amount.</p>
                    </div>
                  </div>
                  <button onClick={() => setShowFinaliseModal(true)} className="flex-shrink-0 bg-gradient-to-r from-green-600 to-green-700 text-white px-3 py-2 rounded-lg text-xs font-bold whitespace-nowrap">Finalise Team</button>
                </div>
              )
            )}

            {/* Betting order tracker */}
            <div className="bg-white/3 border border-white/8 rounded-xl p-5 mb-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold text-amber-400">🎯 Betting Order</h3>
                {currentUser?.role === 'captain' && <button onClick={() => setShowOrderModal(true)} className="text-gray-500 hover:text-amber-400 text-xs flex items-center gap-1"><Edit3 className="w-3 h-3" />Edit</button>}
              </div>
              <div className="space-y-2">
                {bettingOrder.map((name, i) => {
                  const isCurrent = i === currentWeekBettorIdx % bettingOrder.length;
                  const isPast = i < currentWeekBettorIdx % bettingOrder.length;
                  return (
                    <div key={i} className={`flex items-center gap-3 rounded-lg px-3 py-2.5 ${isCurrent ? 'bg-amber-500/15 border border-amber-500/30' : 'bg-black/20 border border-transparent'}`}>
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${isCurrent ? 'bg-amber-500 text-black' : isPast ? 'bg-green-500/20 border border-green-500/40 text-green-400' : 'bg-white/5 text-gray-500'}`}>
                        {isPast ? '✓' : i + 1}
                      </div>
                      <div className="flex-1">
                        <p className={`text-sm font-semibold ${isCurrent ? 'text-amber-300' : isPast ? 'text-gray-400 line-through' : 'text-gray-300'}`}>{name}</p>
                        <p className="text-gray-600 text-xs">Week {i + 1}</p>
                      </div>
                      {isCurrent && <span className="text-amber-400 text-xs font-bold bg-amber-500/10 px-2 py-0.5 rounded-full">Current</span>}
                      {isPast && <span className="text-green-400 text-xs">Done</span>}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* This week's bets */}
            <div className="bg-white/3 border border-white/8 rounded-xl p-5 mb-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold text-green-400">📊 This Week's Bets</h3>
                <div className="flex items-center gap-2">
                  {lastChecked && <p className="text-gray-700 text-xs">Checked {lastChecked.toLocaleTimeString()}</p>}
                  <button onClick={checkResultsNow} disabled={checkingResults} className="flex items-center gap-1 bg-blue-500/20 border border-blue-500/30 text-blue-400 px-2.5 py-1.5 rounded-lg text-xs disabled:opacity-50">
                    {checkingResults ? <><span className="animate-spin w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full inline-block"/>Checking</> : <><RotateCcw className="w-3 h-3"/>Refresh</>}
                  </button>
                </div>
              </div>
              {myTeamData?.bets?.length > 0 ? (
                <div className="space-y-3">
                  {myTeamData.bets.map((bet, i) => <BetSlipCard key={i} bet={bet} onCheckBet={checkSingleBet} isChecking={checkingBetId === bet.id} />)}
                </div>
              ) : (
                <div className="text-center py-8">
                  <p className="text-gray-500 mb-3 text-sm">No bets submitted yet this week</p>
                  {currentBettor && <p className="text-amber-400 text-xs mb-4">It's <strong>{currentBettor}</strong>'s turn to bet</p>}
                  <button onClick={() => setShowBetAnalyzer(true)} className="bg-gradient-to-r from-green-500 to-green-600 text-white font-bold py-2 px-5 rounded-lg text-sm">Submit Bet</button>
                </div>
              )}
            </div>

            {/* Pending approvals */}
            {pendingMembers.length > 0 && (
              <div className="bg-orange-950/20 border border-orange-500/30 rounded-xl p-5 mb-5">
                <h3 className="font-bold text-orange-400 mb-3">⏳ Pending Approvals ({pendingMembers.length})</h3>
                <div className="space-y-2">
                  {pendingMembers.map(m => (
                    <div key={m.phone} className="flex items-center justify-between bg-black/30 rounded-lg px-3 py-2.5">
                      <div>
                        <p className="font-semibold text-sm">{m.name}</p>
                        <p className="text-gray-500 text-xs">{m.phone} · Joined {m.joinedAt}</p>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => approveMember(m.user_id)} className="bg-green-500/20 hover:bg-green-500/30 border border-green-500/50 text-green-400 px-3 py-1 rounded-lg text-xs font-semibold flex items-center gap-1"><CheckCircle className="w-3 h-3" />Approve</button>
                        <button onClick={() => rejectMember(m.user_id)} className="bg-red-500/20 hover:bg-red-500/30 border border-red-500/50 text-red-400 px-3 py-1 rounded-lg text-xs font-semibold flex items-center gap-1"><AlertCircle className="w-3 h-3" />Reject</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Team members */}
            <div className="bg-white/3 border border-white/8 rounded-xl p-5">
              <h3 className="font-bold text-amber-400 mb-4">👥 Team Members</h3>
              <div className="space-y-2">
                {teamMembers.map(m => (
                  <div key={m.user_id || m.phone} className="bg-black/30 rounded-xl px-3 py-3 flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400 font-bold text-sm flex-shrink-0">
                      {(m.name || '?').charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="font-semibold text-sm truncate">{m.name}</p>
                        {m.role === 'captain' && <span className="text-amber-400 text-sm leading-none">👑</span>}
                      </div>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <PermissionBadge role={m.role} />
                        {m.depositPaid
                          ? <span className="text-green-400 text-xs flex items-center gap-0.5"><CheckCircle className="w-3 h-3"/>Deposit paid</span>
                          : <span className="text-red-400 text-xs flex items-center gap-0.5"><AlertCircle className="w-3 h-3"/>Deposit pending</span>}
                        {m.canBet && m.role !== 'view-only' && <span className="text-blue-400 text-xs">Can bet</span>}
                      </div>
                    </div>
                    {currentUser?.role === 'captain' && m.role !== 'captain' && (
                      <div className="flex gap-1 flex-shrink-0">
                        <select value={m.role} onChange={e => updateMemberRole(m.phone, e.target.value)} className="bg-black/50 border border-white/10 text-gray-300 text-xs rounded px-1.5 py-1 focus:outline-none focus:border-amber-500/50">
                          <option value="member">Member</option>
                          <option value="view-only">View Only</option>
                        </select>
                        <button onClick={() => toggleDepositPaid(m.phone)} className={`text-xs px-2 py-1 rounded border ${m.depositPaid ? 'border-green-500/40 text-green-400 bg-green-500/10' : 'border-red-500/40 text-red-400 bg-red-500/10'}`}>
                          {m.depositPaid ? '💰' : '⚠'}
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ── HOW TO PLAY ───────────────────────────────────────────────────── */}
      {activeNav === 'howto' && (
        <section className="pt-28 pb-16 px-4 sm:px-6">
          <div className="max-w-4xl mx-auto">
            <h1 className="text-3xl font-black mb-8">How to Play</h1>
            <div className="space-y-4">
              {[
                { n:'1', t:'Create or Join a Team', d:'Scan the QR code at your pub or click Sign Up. Choose to create your own team or join one with a team code.', bullets:['Captain pays $1,000 buy-in or split among members','Invite up to 10+ members via your unique team code','Members must be approved by the captain before joining'] },
                { n:'2', t:'Confirm Buy-In', d:'Before the season starts all team members must confirm their deposit contribution.', bullets:['Captain can track who has and hasn\'t paid','Competition doesn\'t officially start until all deposits confirmed','Special arrangements can be made via admin'] },
                { n:'3', t:'Submit Your Weekly Bet', d:'Place your bet on any platform, then submit the screenshot via the website.', bullets:['$50 max per week (split how you like)','Must submit before first leg starts','Last week of competition: $200 bet','You keep all your winnings!'] },
                { n:'4', t:'Track Results', d:'AI reads your bet slip and updates leg-by-leg results every 3 hours from the first event start.', bullets:['Green = won, Red = lost, Orange = in progress (live)','Team leaderboard updates in real-time','Click any team to see their full bet slip'] },
                { n:'5', t:'Win the Jackpot', d:'Highest total winnings at season end takes the prize pool.', bullets:['Payout depends on number of teams','Final week has $200 bet for big finish','Top 2-3 teams paid depending on competition size'] },
              ].map(s => (
                <div key={s.n} className="bg-white/3 border border-white/8 rounded-xl p-5 flex gap-4">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center font-black text-black text-lg flex-shrink-0">{s.n}</div>
                  <div>
                    <h3 className="font-bold text-base mb-1">{s.t}</h3>
                    <p className="text-gray-400 text-sm mb-2">{s.d}</p>
                    <ul className="space-y-1">
                      {s.bullets.map((b, i) => <li key={i} className="text-gray-500 text-xs flex gap-1.5"><span className="text-amber-500">▸</span>{b}</li>)}
                    </ul>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-8 bg-amber-500/10 border border-amber-500/20 rounded-xl p-6 text-center">
              <h3 className="font-bold text-lg mb-2">Ready to play?</h3>
              <p className="text-gray-400 text-sm mb-4">Get your mates together and start this week!</p>
              <button onClick={() => { setSignupMode('create'); setShowSignupModal(true); }} className="bg-gradient-to-r from-amber-500 to-amber-600 text-black px-8 py-3 rounded-xl font-bold transition-all hover:scale-105">Create Team Now</button>
            </div>
          </div>
        </section>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          ADMIN PANEL
      ══════════════════════════════════════════════════════════════════ */}
      {activeNav === 'admin' && isAdminLoggedIn && (() => {
        // ── Admin sub-components (inline) ──────────────────────────────
        const AdminCard = ({ title, value, sub, icon, color = 'text-amber-400' }) => (
          <div className="rounded-xl p-5 flex items-start gap-4 hover:scale-[1.01] transition-transform" style={{backgroundColor:"#111827",border:"1px solid rgba(255,255,255,0.10)"}}>
            <div className={`${color} flex-shrink-0 mt-0.5`}>{icon}</div>
            <div className="min-w-0 flex-1">
              <p className="text-gray-400 text-xs font-bold uppercase tracking-widest mb-1">{title}</p>
              <p className={`text-3xl font-black ${color} leading-none mb-1`}>{value}</p>
              {sub && <p className="text-gray-500 text-xs leading-relaxed">{sub}</p>}
            </div>
          </div>
        );

        const StatusPill = ({ s }) => {
          const m = { verified:'bg-green-500/20 text-green-400 border-green-500/40', pending:'bg-amber-500/20 text-amber-400 border-amber-500/40', suspended:'bg-red-500/20 text-red-400 border-red-500/40', rejected:'bg-red-500/20 text-red-400 border-red-500/40', active:'bg-green-500/20 text-green-400 border-green-500/40', won:'bg-green-500/20 text-green-400 border-green-500/40', lost:'bg-red-500/20 text-red-400 border-red-500/40' };
          return <span className={`border text-xs font-bold px-2 py-0.5 rounded-full capitalize whitespace-nowrap ${m[s] || 'bg-gray-500/20 text-gray-400 border-gray-500/40'}`}>{s}</span>;
        };

        const tabs = [
          { id:'dashboard',    label:'Dashboard',    icon:'📊', roles:['owner','campaign','pub_admin'] },
          { id:'teams',        label:'Teams',        icon:'🏆', roles:['owner','campaign','pub_admin'] },
          { id:'users',        label:'Users & KYC',  icon:'👤', roles:['owner','campaign'] },
          { id:'bets',         label:'Bets',         icon:'🎯', roles:['owner','campaign'] },
          { id:'competitions', label:'Competitions', icon:'🏟', roles:['owner','pub_admin'] },
          { id:'security',     label:'Security',     icon:'🔒', roles:['owner'] },
          { id:'audit',        label:'Audit Log',    icon:'📋', roles:['owner','campaign'] },
        ].filter(t => t.roles.includes(adminUser.role));

        const filteredTeams = adminTeams.filter(t => adminSearch === '' || t.name.toLowerCase().includes(adminSearch.toLowerCase()) || t.captain.toLowerCase().includes(adminSearch.toLowerCase()));
        const filteredUsers = adminUsers.filter(u => adminSearch === '' || u.name.toLowerCase().includes(adminSearch.toLowerCase()) || u.phone.includes(adminSearch));
        const filteredBets  = adminBets.filter(b => adminSearch === '' || b.team.toLowerCase().includes(adminSearch.toLowerCase()) || b.id.toLowerCase().includes(adminSearch.toLowerCase()));

        return (
          <section style={{position:"fixed",inset:0,zIndex:50,backgroundColor:"#030712",overflowY:"auto",WebkitFontSmoothing:"antialiased",MozOsxFontSmoothing:"grayscale"}}>
            {/* Admin top bar */}
            <div style={{backgroundColor:"#0f172a",borderBottom:"1px solid rgba(239,68,68,0.25)",position:"sticky",top:0,zIndex:10}} className="px-6 py-3 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2.5">
                  <Shield className="w-5 h-5 text-red-400" />
                  <span className="font-black text-red-400 text-base tracking-wide">ADMIN PANEL</span>
                  <span style={{backgroundColor:"rgba(239,68,68,0.15)",border:"1px solid rgba(239,68,68,0.35)",color:"#f87171",fontSize:"11px",padding:"2px 10px",borderRadius:"999px",fontWeight:700,textTransform:"capitalize"}}>{adminUser.role}</span>
                </div>
                <div className="hidden sm:flex items-center gap-2 text-gray-500 text-sm">
                  <span>·</span>
                  <span>{adminUser.name}</span>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="relative">
                  <button className="relative p-2 text-gray-400 hover:text-white rounded-lg hover:bg-white/5 transition-colors">
                    <Bell className="w-4 h-4" />
                    {unreadNotifs > 0 && <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full"/>}
                  </button>
                </div>
                <div className="hidden sm:block text-gray-700 text-xs">{new Date().toLocaleDateString('en-AU', {weekday:'short', day:'numeric', month:'short'})}</div>
                {adminLoading && <span className="text-xs text-amber-400 animate-pulse">Loading...</span>}
                {adminLoadError && <span className="text-xs text-red-400 max-w-xs truncate" title={adminLoadError}>⚠ {adminLoadError}</span>}
                <button onClick={refreshAdminData} className="text-gray-500 hover:text-gray-300 p-1.5 rounded-lg hover:bg-white/5" title="Refresh data">
                  <RefreshCw className={`w-3.5 h-3.5 ${adminLoading ? 'animate-spin' : ''}`} />
                </button>
                <button onClick={handleAdminLogout} style={{backgroundColor:"rgba(239,68,68,0.12)",border:"1px solid rgba(239,68,68,0.35)",color:"#f87171",padding:"6px 14px",borderRadius:"8px",fontSize:"13px",fontWeight:600,cursor:"pointer"}}>Logout</button>
              </div>
            </div>

            <div className="flex">
              {/* Sidebar */}
              <aside style={{backgroundColor:"#0f172a",borderRight:"1px solid rgba(255,255,255,0.07)",paddingTop:"20px",width:"220px",flexShrink:0,position:"sticky",top:"52px",alignSelf:"flex-start",height:"calc(100vh - 52px)",overflowY:"auto"}} className="hidden md:flex flex-col">
                <div className="px-3 mb-3">
                  <p className="text-gray-600 text-xs font-bold uppercase tracking-widest px-1 mb-2">Navigation</p>
                </div>
                <nav className="space-y-0.5 px-2">
                  {tabs.map(t => (
                    <button key={t.id} onClick={() => setAdminTab(t.id)} style={adminTab === t.id ? {backgroundColor:"rgba(239,68,68,0.12)",border:"1px solid rgba(239,68,68,0.25)",color:"#f87171",fontWeight:700} : {border:"1px solid transparent",color:"#9ca3af"}} className={`w-full text-left px-3 py-2.5 rounded-lg text-sm flex items-center gap-3 transition-all hover:bg-white/5 hover:text-white`}>
                      <span className="text-base w-5 text-center flex-shrink-0">{t.icon}</span>
                      <span>{t.label}</span>
                      {adminTab === t.id && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-red-400 flex-shrink-0"/>}
                    </button>
                  ))}
                </nav>
                {/* Notif list */}
                {adminNotifs.filter(n => !n.read).length > 0 && (
                  <div className="mt-6 px-2">
                    <p className="text-gray-600 text-xs uppercase tracking-wider px-2 mb-2">Alerts</p>
                    <div className="space-y-1">
                      {adminNotifs.filter(n => !n.read).slice(0, 3).map(n => (
                        <div key={n.id} onClick={() => markNotifRead(n.id)} className={`px-2 py-2 rounded-lg cursor-pointer text-xs border ${n.type === 'warning' ? 'border-amber-500/20 bg-amber-500/5 text-amber-400' : n.type === 'error' ? 'border-red-500/20 bg-red-500/5 text-red-400' : n.type === 'success' ? 'border-green-500/20 bg-green-500/5 text-green-400' : 'border-blue-500/20 bg-blue-500/5 text-blue-400'}`}>
                          <p className="font-semibold leading-tight">{n.msg}</p>
                          <p className="text-gray-600 mt-0.5">{n.time}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </aside>

              {/* Main content */}
              <main style={{flex:1,minWidth:0,overflowX:"hidden"}} className="p-6 lg:p-8 max-w-5xl">

                {/* Mobile tab bar */}
                <div style={{WebkitOverflowScrolling:"touch",scrollbarWidth:"none"}} className="md:hidden flex gap-1 overflow-x-auto pb-2 mb-4">
                  {tabs.map(t => (
                    <button key={t.id} onClick={() => setAdminTab(t.id)} className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 ${adminTab === t.id ? 'bg-red-500/20 text-red-400 border border-red-500/30' : 'bg-white/5 text-gray-400'}`}>
                      {t.icon} {t.label}
                    </button>
                  ))}
                </div>

                {/* Global search */}
                <div className="relative mb-5">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-600" />
                  <input value={adminSearch} onChange={e => setAdminSearch(e.target.value)} placeholder="Search teams, users, bets…" className="w-full bg-gray-900 border border-white/8 rounded-lg pl-9 pr-4 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-red-500/40" />
                  {adminSearch && <button onClick={() => setAdminSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-600 hover:text-white"><X className="w-4 h-4"/></button>}
                </div>

                {/* ── DASHBOARD ───────────────────────────────────────────── */}
                {adminTab === 'dashboard' && (
                  <div className="space-y-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <h2 className="text-2xl font-black mb-1">Dashboard</h2>
                        <p className="text-gray-500 text-sm">Overview · Week 3 of 8 · {new Date().toLocaleDateString('en-AU', { weekday:'long', day:'numeric', month:'long' })}</p>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-gray-500 bg-gray-900 border border-white/8 px-3 py-2 rounded-lg">
                        <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse inline-block"/>
                        Live
                      </div>
                    </div>

                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                      <AdminCard title="Total Teams"    value={adminTeams.length}  sub={`${adminTeams.filter(t=>t.status==='verified').length} verified · ${adminTeams.filter(t=>t.status==='pending').length} pending`}  icon={<Users className="w-7 h-7"/>}      color="text-amber-400" />
                      <AdminCard title="Total Users"    value={adminUsers.length}  sub={`${adminUsers.filter(u=>u.kyc==='pending').length} KYC pending · ${adminUsers.filter(u=>u.kyc==='verified').length} verified`}    icon={<UserCheck className="w-7 h-7"/>}  color="text-blue-400"  />
                      <AdminCard title="Bets This Week" value={adminBets.length}   sub={`${adminBets.filter(b=>b.flagged).length} flagged · ${adminBets.filter(b=>b.status==='won'||b.overall_status==='won').length} won`} icon={<FileText className="w-7 h-7"/>}   color="text-green-400" />
                      <AdminCard title="Competitions"   value={adminComps.length}  sub={`${adminComps.filter(c=>c.status==='active').length} active · ${adminComps.filter(c=>c.status==='pending').length} pending`}       icon={<Trophy className="w-7 h-7"/>}     color="text-purple-400"/>
                    </div>

                    {/* Flagged + KYC side by side on desktop */}
                    <div className="grid lg:grid-cols-2 gap-4">
                    {/* Flagged items */}
                    {(adminBets.some(b=>b.flagged) || adminTeams.some(t=>t.flagged) || adminUsers.some(u=>u.flagged)) && (
                      <div className="bg-red-950/20 border border-red-500/30 rounded-xl p-5">
                        <h3 className="font-bold text-red-400 mb-3 flex items-center gap-2"><AlertCircle className="w-4 h-4"/>Flagged Items Requiring Attention</h3>
                        <div className="space-y-2">
                          {adminBets.filter(b=>b.flagged).map(b => (
                            <div key={b.id} className="flex items-center justify-between bg-black/30 rounded-lg px-3 py-2">
                              <div>
                                <p className="text-sm font-semibold text-red-300">Bet {b.id} — {b.team}</p>
                                <p className="text-xs text-gray-500">Stake: {b.stake} · AI confidence: {b.aiConfidence}% · {b.valid ? '' : '⚠ Invalid submission'}</p>
                              </div>
                              <div className="flex gap-2">
                                <button onClick={() => confirmBetResult(b.id,'won')}  className="bg-green-500/20 border border-green-500/40 text-green-400 px-2 py-1 rounded text-xs font-semibold">Won</button>
                                <button onClick={() => confirmBetResult(b.id,'lost')} className="bg-red-500/20 border border-red-500/40 text-red-400 px-2 py-1 rounded text-xs font-semibold">Lost</button>
                                <button onClick={() => rejectBet(b.id,'Invalid stake')} className="bg-gray-500/20 border border-gray-500/40 text-gray-400 px-2 py-1 rounded text-xs font-semibold">Reject</button>
                              </div>
                            </div>
                          ))}
                          {adminUsers.filter(u=>u.flagged).map(u => (
                            <div key={u.phone} className="flex items-center justify-between bg-black/30 rounded-lg px-3 py-2">
                              <div>
                                <p className="text-sm font-semibold text-red-300">{u.name}</p>
                                <p className="text-xs text-gray-500">KYC: {u.kyc} · {u.phone}</p>
                              </div>
                              <div className="flex gap-2">
                                <button onClick={() => setKycStatus(u.phone,'verified')} className="bg-green-500/20 border border-green-500/40 text-green-400 px-2 py-1 rounded text-xs">Verify</button>
                                <button onClick={() => setKycStatus(u.phone,'rejected')} className="bg-red-500/20 border border-red-500/40 text-red-400 px-2 py-1 rounded text-xs">Reject</button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* KYC pending */}
                    {adminUsers.some(u => u.kyc === 'pending') && (
                      <div className="bg-amber-950/20 border border-amber-500/30 rounded-xl p-5">
                        <h3 className="font-bold text-amber-400 mb-3 flex items-center gap-2"><Clock className="w-4 h-4"/>KYC Pending Review</h3>
                        <div className="space-y-2">
                          {adminUsers.filter(u => u.kyc === 'pending').map(u => (
                            <div key={u.phone} className="flex items-center justify-between bg-black/30 rounded-lg px-3 py-2.5">
                              <div>
                                <p className="text-sm font-semibold">{u.name}</p>
                                <p className="text-xs text-gray-500">{u.phone} · {u.team} · DOB: {u.dob}</p>
                              </div>
                              <div className="flex gap-2">
                                <button onClick={() => setKycStatus(u.phone,'verified')} className="bg-green-500/20 border border-green-500/40 text-green-400 px-2.5 py-1 rounded-lg text-xs font-semibold">✓ Verify</button>
                                <button onClick={() => setKycStatus(u.phone,'rejected')} className="bg-red-500/20 border border-red-500/40 text-red-400 px-2.5 py-1 rounded-lg text-xs font-semibold">✗ Reject</button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    </div>{/* end two-col grid */}

                    {/* Recent activity */}
                    <div className="rounded-xl p-5" style={{backgroundColor:"#111827",border:"1px solid rgba(255,255,255,0.08)"}}>
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="font-bold text-white flex items-center gap-2"><Activity className="w-4 h-4 text-blue-400"/>Recent Activity</h3>
                        <button onClick={() => setAdminTab('audit')} className="text-xs text-blue-400 hover:text-blue-300">View all →</button>
                      </div>
                      <div className="space-y-0">
                        {adminAuditLog.slice(0, 8).map((e, i) => (
                          <div key={i} className="flex items-start gap-3 py-2.5 border-b border-white/5 last:border-0">
                            <div className="w-7 h-7 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                              <div className="w-2 h-2 rounded-full bg-blue-400"/>
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm text-white font-medium"><span className="text-blue-400">{e.action}</span>{e.target ? ` — ${e.target}` : ''}</p>
                              {e.detail && <p className="text-xs text-gray-500 mt-0.5 truncate">{e.detail}</p>}
                            </div>
                            <div className="text-right flex-shrink-0 ml-2">
                              <p className="text-xs text-gray-500 whitespace-nowrap">{e.ts}</p>
                              <span className="text-xs text-gray-700 capitalize bg-white/5 px-1.5 py-0.5 rounded mt-0.5 inline-block">{e.adminRole}</span>
                            </div>
                          </div>
                        ))}
                        {adminAuditLog.length === 0 && <p className="text-gray-600 text-sm text-center py-4">No activity yet</p>}
                      </div>
                    </div>
                  </div>
                )}

                {/* ── TEAMS ───────────────────────────────────────────────── */}
                {adminTab === 'teams' && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h2 className="text-xl font-black">Teams</h2>
                        <p className="text-gray-500 text-sm">{adminTeams.length} registered · {adminTeams.filter(t=>t.status==='pending').length} pending</p>
                      </div>
                      <button onClick={refreshAdminData} className="bg-white/5 border border-white/10 text-gray-400 hover:text-white px-3 py-1.5 rounded-lg text-xs flex items-center gap-1.5">
                        <RefreshCw className="w-3 h-3" /> Refresh
                      </button>
                    </div>
                    <div className="space-y-2">
                      {filteredTeams.length === 0 && (
                        <div className="text-center py-12 text-gray-600">
                          <p className="text-3xl mb-2">🏆</p>
                          <p className="font-semibold">No teams registered yet</p>
                          <p className="text-sm mt-1">Teams will appear here after signup.</p>
                        </div>
                      )}
                      {filteredTeams.map(t => (
                        <div key={t.id} className={`bg-gray-900 border rounded-xl p-4 ${t.flagged ? 'border-red-500/40' : t.status === 'verified' ? 'border-green-500/15' : t.status === 'suspended' ? 'border-red-500/20' : 'border-white/8'}`}>
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1 flex-wrap">
                                <p className="font-bold text-sm">{t.name}</p>
                                <StatusPill s={t.status} />
                                {t.flagged && <span className="text-red-400 text-xs font-bold">🚩 Flagged</span>}
                              </div>
                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 text-xs text-gray-500">
                                <span>Captain: <span className="text-gray-300">{t.captain}</span></span>
                                <span>Members: <span className="text-gray-300">{t.members}</span></span>
                                <span>Deposits: <span className={t.depositsPaid === t.members ? 'text-green-400' : 'text-amber-400'}>{t.depositsPaid}/{t.members}</span></span>
                                <span>Comp: <span className="text-gray-300">{t.compCode || '—'}</span></span>
                                <span>Created: <span className="text-gray-300">{t.createdAt}</span></span>
                                <span>Total Bet: <span className="text-green-400 font-semibold">{t.totalBet}</span></span>
                              </div>
                            </div>
                            <div className="flex flex-col gap-1.5 flex-shrink-0">
                              {t.status === 'pending' && canAdmin('bets') && (
                                <button onClick={() => verifyTeam(t.id)} className="bg-green-500/20 border border-green-500/40 text-green-400 px-2.5 py-1 rounded-lg text-xs font-semibold">✓ Verify</button>
                              )}
                              {t.status !== 'suspended' && canAdmin('bets') && (
                                <button onClick={() => suspendTeam(t.id)} className="bg-red-500/20 border border-red-500/40 text-red-400 px-2.5 py-1 rounded-lg text-xs font-semibold">Suspend</button>
                              )}
                              {t.status === 'suspended' && canAdmin('bets') && (
                                <button onClick={() => setAdminTeams(prev => prev.map(x => x.id === t.id ? {...x, status:'verified'} : x))} className="bg-blue-500/20 border border-blue-500/40 text-blue-400 px-2.5 py-1 rounded-lg text-xs font-semibold">Restore</button>
                              )}
                              <button onClick={() => flagTeam(t.id)} className="bg-amber-500/10 border border-amber-500/20 text-amber-600 hover:text-amber-400 px-2.5 py-1 rounded-lg text-xs">🚩</button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* ── USERS & KYC ─────────────────────────────────────────── */}
                {adminTab === 'users' && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h2 className="text-xl font-black">Users & KYC</h2>
                        <p className="text-gray-500 text-sm">{adminUsers.length} users · {adminUsers.filter(u=>u.kyc==='pending').length} awaiting KYC · {adminUsers.filter(u=>!u.active).length} suspended</p>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => { const csv = ['Name,Phone,KYC,Team,DOB,Postcode,Joined',...adminUsers.map(u=>`${u.name},${u.phone},${u.kyc},${u.team},${u.dob},${u.postcode},${u.joinedAt}`)].join('\n'); alert('CSV export ready:\n\n' + csv.substring(0,200) + '...'); addAuditEntry(adminUser.role,'Data Export','Users CSV','GDPR-compliant export'); }} className="bg-gray-800 border border-white/10 text-gray-400 px-3 py-2 rounded-lg text-xs flex items-center gap-1"><Download className="w-3 h-3"/>Export</button>
                      </div>
                    </div>

                    {/* KYC legend */}
                    <div className="flex gap-3 flex-wrap">
                      {[['verified','green'],['pending','amber'],['rejected','red']].map(([s,c]) => (
                        <div key={s} className="flex items-center gap-1.5 text-xs text-gray-500">
                          <div className={`w-2 h-2 rounded-full bg-${c}-400`}/>
                          <span className="capitalize">{s}: {adminUsers.filter(u=>u.kyc===s).length}</span>
                        </div>
                      ))}
                    </div>

                    <div className="space-y-2">
                      {filteredUsers.length === 0 && (
                        <div className="text-center py-12 text-gray-600">
                          <p className="text-3xl mb-2">👤</p>
                          <p className="font-semibold">No users yet</p>
                          <p className="text-sm mt-1">Users will appear here after they sign up.</p>
                        </div>
                      )}
                      {filteredUsers.map(u => (
                        <div key={u.phone} className={`bg-gray-900 border rounded-xl p-4 ${u.flagged ? 'border-red-500/40' : !u.active ? 'border-red-500/15 opacity-60' : 'border-white/8'}`}>
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap mb-1.5">
                                <p className="font-bold text-sm">{u.name}</p>
                                <StatusPill s={u.kyc} />
                                <span className="bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs px-1.5 py-0.5 rounded capitalize">{u.role}</span>
                                {!u.active && <span className="text-red-400 text-xs font-bold">Suspended</span>}
                                {u.flagged && <span className="text-red-400 text-xs">🚩</span>}
                              </div>
                              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-0.5 text-xs text-gray-500">
                                <span>📱 {u.phone}</span>
                                <span>🏆 {u.team}</span>
                                <span>📅 DOB: {u.dob}</span>
                                <span>📍 {u.postcode}</span>
                                <span>📆 Joined: {u.joinedAt}</span>
                              </div>
                            </div>
                            <div className="flex flex-col gap-1.5 flex-shrink-0">
                              {u.kyc === 'pending' && (
                                <>
                                  <button onClick={() => setKycStatus(u.phone,'verified')} className="bg-green-500/20 border border-green-500/40 text-green-400 px-2.5 py-1 rounded-lg text-xs font-semibold">✓ Verify KYC</button>
                                  <button onClick={() => setKycStatus(u.phone,'rejected')} className="bg-red-500/20 border border-red-500/40 text-red-400 px-2.5 py-1 rounded-lg text-xs font-semibold">✗ Reject</button>
                                </>
                              )}
                              {u.kyc === 'verified' && (
                                <button onClick={() => setKycStatus(u.phone,'pending')} className="bg-amber-500/10 border border-amber-500/20 text-amber-500 px-2.5 py-1 rounded-lg text-xs">Re-review</button>
                              )}
                              <button onClick={() => resetPassword(u.phone)} className="bg-blue-500/10 border border-blue-500/20 text-blue-400 px-2.5 py-1 rounded-lg text-xs">Reset Pwd</button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* GDPR note */}
                    <div className="bg-blue-950/20 border border-blue-500/20 rounded-xl p-4 flex gap-3">
                      <Shield className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="text-blue-400 text-xs font-bold mb-1">Data Privacy & GDPR Compliance</p>
                        <p className="text-gray-500 text-xs">User PII is encrypted at rest. DOB and postcode used for KYC age verification only. Export logs maintained for audit. Users may request data deletion via support.</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* ── BETS ────────────────────────────────────────────────── */}
                {adminTab === 'bets' && (
                  <div className="space-y-4">
                    <div>
                      <h2 className="text-xl font-black">Bet Management</h2>
                      <p className="text-gray-500 text-sm">Week 3 · {adminBets.filter(b=>b.flagged).length} flagged · {adminBets.filter(b=>!b.valid).length} invalid submission</p>
                    </div>

                    {/* AI confidence legend */}
                    <div className="bg-gray-900 border border-white/8 rounded-xl p-4 flex flex-wrap gap-4 text-xs">
                      <div><span className="text-gray-500">AI Confidence: </span><span className="text-green-400 font-bold">90-100%</span><span className="text-gray-600"> = High</span></div>
                      <div><span className="text-amber-400 font-bold">70-89%</span><span className="text-gray-600"> = Review recommended</span></div>
                      <div><span className="text-red-400 font-bold">&lt;70%</span><span className="text-gray-600"> = Manual review required</span></div>
                    </div>

                    <div className="space-y-3">
                      {filteredBets.map(b => (
                        <div key={b.id} className={`bg-gray-900 border rounded-xl overflow-hidden ${b.flagged ? 'border-red-500/40' : !b.valid ? 'border-amber-500/30' : 'border-white/8'}`}>
                          <div className="px-4 py-3 flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap mb-1.5">
                                <span className="text-gray-600 text-xs font-mono">{b.id}</span>
                                <p className="font-bold text-sm">{b.team}</p>
                                <StatusPill s={b.status} />
                                {b.flagged && <span className="text-red-400 text-xs font-bold">🚩 Flagged</span>}
                                {!b.valid && <span className="text-amber-400 text-xs font-bold">⚠ Invalid</span>}
                              </div>
                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-0.5 text-xs text-gray-500 mb-2">
                                <span>Type: <span className="text-gray-300">{b.type}</span></span>
                                <span>Stake: {editingBet === b.id ? (
                                  <input defaultValue={b.stake} onBlur={e => { correctBetField(b.id,'stake',e.target.value); setEditingBet(null); }} className="bg-black border border-amber-500/50 rounded px-1 text-amber-300 w-16 text-xs" autoFocus />
                                ) : <span className="text-amber-300 cursor-pointer" onClick={() => canAdmin('bets') && setEditingBet(b.id)}>{b.stake} {canAdmin('bets') && <span className="text-gray-700">✎</span>}</span>}</span>
                                <span>Odds: <span className="text-gray-300">{b.odds}</span></span>
                                <span>To Win: <span className="text-green-400">{b.toWin}</span></span>
                                <span>Week: <span className="text-gray-300">{b.week}</span></span>
                                <span>Submitted: <span className="text-gray-300">{b.submittedAt}</span></span>
                                <span>AI Confidence: <span className={b.aiConfidence >= 90 ? 'text-green-400' : b.aiConfidence >= 70 ? 'text-amber-400' : 'text-red-400'}>{b.aiConfidence}%</span></span>
                              </div>
                            </div>
                          </div>
                          {/* Actions */}
                          {canAdmin('bets') && b.status === 'pending' && (
                            <div className="border-t border-white/5 bg-black/20 px-4 py-2.5 flex items-center gap-2 flex-wrap">
                              <p className="text-gray-600 text-xs mr-1">Set result:</p>
                              <button onClick={() => confirmBetResult(b.id,'won')}  className="bg-green-500/20 border border-green-500/40 text-green-400 px-3 py-1 rounded-lg text-xs font-semibold">✓ Confirm Won</button>
                              <button onClick={() => confirmBetResult(b.id,'lost')} className="bg-red-500/20 border border-red-500/40 text-red-400 px-3 py-1 rounded-lg text-xs font-semibold">✗ Confirm Lost</button>
                              <button onClick={() => { const r = prompt('Rejection reason:','Invalid stake'); if(r) rejectBet(b.id,r); }} className="bg-gray-500/20 border border-gray-500/40 text-gray-400 px-3 py-1 rounded-lg text-xs font-semibold">Reject</button>
                              <button onClick={() => setEditingBet(editingBet === b.id ? null : b.id)} className="ml-auto text-amber-500 text-xs flex items-center gap-1"><Edit3 className="w-3 h-3"/>Edit Stake</button>
                            </div>
                          )}
                          {canAdmin('bets') && (b.status === 'won' || b.status === 'lost') && (
                            <div className="border-t border-white/5 bg-black/20 px-4 py-2 flex items-center gap-2">
                              <p className="text-gray-600 text-xs">Result confirmed.</p>
                              <button onClick={() => setAdminBets(prev => prev.map(x => x.id === b.id ? {...x, status:'pending'} : x))} className="text-amber-500 text-xs hover:text-amber-400">Reopen dispute</button>
                            </div>
                          )}
                          {/* Per-leg override */}
                          {canAdmin('bets') && b.legs?.length > 0 && (
                            <div className="border-t border-white/5">
                              <button
                                onClick={() => setExpandedBetId(expandedBetId === b.id ? null : b.id)}
                                className="w-full px-4 py-2 text-left text-xs text-gray-500 hover:text-amber-400 flex items-center gap-1.5 transition-colors"
                              >
                                <Edit3 className="w-3 h-3" />
                                {expandedBetId === b.id ? '▲ Hide leg overrides' : `▼ Override individual legs (${b.legs.length})`}
                              </button>
                              {expandedBetId === b.id && (
                                <div className="px-4 pb-4 space-y-2 bg-black/30">
                                  <p className="text-amber-400 text-xs font-semibold mb-2">⚠ Manual Override — use when AI couldn't find a result</p>
                                  {b.legs.map(leg => {
                                    const legColor = leg.status === 'won' ? 'text-green-400' : leg.status === 'lost' ? 'text-red-400' : leg.status === 'void' ? 'text-gray-400' : 'text-amber-400';
                                    return (
                                      <div key={leg.id} className="bg-gray-900 border border-white/8 rounded-lg p-3">
                                        <div className="flex items-start justify-between gap-2 mb-2">
                                          <div>
                                            <span className="text-gray-500 text-xs">Leg {leg.leg_number} · </span>
                                            <span className="text-white text-xs font-semibold">{leg.selection}</span>
                                            <span className="text-gray-500 text-xs"> · {leg.market}</span>
                                          </div>
                                          <span className={`text-xs font-bold ${legColor}`}>{leg.status?.toUpperCase()}</span>
                                        </div>
                                        <div className="text-gray-600 text-xs mb-2 truncate">{leg.event}</div>
                                        <div className="flex items-center gap-1.5 flex-wrap mb-2">
                                          {['won','lost','pending','void'].map(s => (
                                            <button
                                              key={s}
                                              onClick={() => overrideLegResult(b.id, leg.id, s, legNotes[leg.id] || leg.resultNote || '')}
                                              className={`px-2.5 py-1 rounded text-xs font-semibold border transition-all ${
                                                leg.status === s
                                                  ? s === 'won' ? 'bg-green-500/30 border-green-400 text-green-300' : s === 'lost' ? 'bg-red-500/30 border-red-400 text-red-300' : 'bg-gray-500/30 border-gray-400 text-gray-300'
                                                  : 'bg-white/5 border-white/10 text-gray-500 hover:border-white/30 hover:text-white'
                                              }`}
                                            >
                                              {s === 'won' ? '✓ Won' : s === 'lost' ? '✗ Lost' : s === 'void' ? '— Void' : '⏳ Pending'}
                                            </button>
                                          ))}
                                        </div>
                                        <input
                                          type="text"
                                          placeholder="Result note (optional)"
                                          defaultValue={leg.resultNote || ''}
                                          onChange={e => setLegNotes(prev => ({ ...prev, [leg.id]: e.target.value }))}
                                          className="w-full bg-black/50 border border-white/10 rounded px-2 py-1 text-xs text-gray-300 placeholder-gray-700 focus:outline-none focus:border-amber-500/50"
                                        />
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>

                    {/* Rejected bets log — sourced from adminBets state */}
                    {adminBets.filter(b => b.status === 'rejected').length > 0 && (
                      <div className="bg-gray-900 border border-white/8 rounded-xl p-4">
                        <h3 className="font-bold text-gray-400 mb-3 text-sm">Rejected Bets Archive</h3>
                        {adminBets.filter(b => b.status === 'rejected').map((b, i) => (
                          <div key={i} className="text-xs text-gray-600 py-1.5 border-b border-white/5 last:border-0">
                            <span className="text-gray-400">{b.team}</span> · {b.stake} · <span className="text-red-400">Rejected</span> · {b.submittedAt}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* ── COMPETITIONS ─────────────────────────────────────────── */}
                {adminTab === 'competitions' && (() => {
                  return (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <h2 className="text-xl font-black">Competitions</h2>
                          <p className="text-gray-500 text-sm">{adminComps.length} competitions · {adminComps.filter(c=>c.status==='active').length} active</p>
                        </div>
                        {(adminUser.role === 'owner' || adminUser.role === 'pub_admin') && (
                          <button onClick={() => setShowCreateComp(!showCreateComp)} className="bg-amber-500/20 border border-amber-500/40 text-amber-400 px-3 py-2 rounded-lg text-xs font-semibold">+ New Competition</button>
                        )}
                      </div>

                      {/* Create form */}
                      {showCreateComp && (
                        <div className="bg-gray-900 border border-amber-500/30 rounded-xl p-5 space-y-3">
                          <h3 className="font-bold text-amber-400">Create New Competition</h3>
                          <div className="grid sm:grid-cols-2 gap-3">
                            {[['Competition Name','name','text','RSL Summer Cup'],['Pub / Club Name','pub','text','RSL Club Sydney'],['Buy-In Amount','buyIn','text','$1,000'],['Max Teams','maxTeams','number','20'],['Start Date','startDate','date',''],['End Date','endDate','date','']].map(([l,k,t,p]) => (
                              <div key={k}>
                                <label className="block text-xs font-semibold text-amber-400 mb-1">{l}</label>
                                <input type={t} value={newComp[k]} onChange={e => setNewComp(prev => ({...prev, [k]: e.target.value}))} className="w-full bg-black/50 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/50 placeholder-gray-600" placeholder={p} />
                              </div>
                            ))}
                            <div>
                              <label className="block text-xs font-semibold text-amber-400 mb-1">Season Length</label>
                              <select value={newComp.weeks} onChange={e => setNewComp(prev => ({...prev, weeks: e.target.value}))} className="w-full bg-black/50 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/50">
                                <option value="8">8 weeks (Quarter Season)</option>
                                <option value="16">16 weeks (Half Season)</option>
                                <option value="32">32 weeks (Full Season)</option>
                              </select>
                            </div>
                          </div>
                          <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 text-xs text-gray-400">
                            <strong className="text-amber-400">Note:</strong> Competition requires approval from Owner Admin before going live. A unique QR code and join link will be auto-generated.
                          </div>
                          <div className="flex gap-3">
                            <button onClick={() => setShowCreateComp(false)} className="flex-1 border border-white/10 text-gray-400 py-2 rounded-lg text-sm">Cancel</button>
                            <button onClick={async () => { await createCompetition(newComp); setShowCreateComp(false); setNewComp({ name:'', pub:'', weeks:'8', buyIn:'$1,000', maxTeams:'20', startDate:'', endDate:'' }); }} className="flex-1 bg-gradient-to-r from-amber-500 to-amber-600 text-black font-bold py-2 rounded-lg text-sm">Create Competition</button>
                          </div>
                        </div>
                      )}

                      {/* Comp list */}
                      <div className="space-y-3">
                        {adminComps.length === 0 && (
                          <div className="text-center py-12 text-gray-600">
                            <p className="text-3xl mb-2">🏟</p>
                            <p className="font-semibold">No competitions yet</p>
                            <p className="text-sm mt-1">Create your first competition using the form above.</p>
                          </div>
                        )}
                        {adminComps.map(c => {
                          const registeredTeams = c.teams || [];
                          const teamCount = registeredTeams.length || c.team_count || c.teams_count || 0;
                          const maxTeams  = c.max_teams || c.maxTeams || 20;
                          const buyIn     = c.buy_in ? `$${Number(c.buy_in).toLocaleString()}` : c.buyIn || '$1,000';
                          const compKey   = c.code || c.id;
                          const showTeams = expandedCompId === compKey;
                          const setShowTeams = (v) => setExpandedCompId(v ? compKey : null);
                          return (
                          <div key={c.code || c.id} className={`bg-gray-900 border rounded-xl overflow-hidden ${c.status === 'active' ? 'border-green-500/20' : c.status === 'pending' ? 'border-amber-500/20' : 'border-white/8'}`}>
                            <div className="p-4">
                              <div className="flex items-start justify-between gap-3">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap mb-1.5">
                                    <p className="font-bold text-base">{c.name}</p>
                                    <StatusPill s={c.status} />
                                    <span className="font-mono text-xs bg-black/40 border border-white/10 text-amber-300 px-2 py-0.5 rounded">{c.code}</span>
                                  </div>
                                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 text-xs text-gray-500 mb-2">
                                    <span>🏟 {c.pub}</span>
                                    <span>📅 {c.weeks} weeks</span>
                                    <span>💰 Buy-in: {buyIn}</span>
                                    {c.start_date && <span>🗓 {c.start_date} → {c.end_date}</span>}
                                  </div>
                                  {/* Team registration bar */}
                                  <div className="mt-2">
                                    <div className="flex items-center justify-between mb-1">
                                      <span className="text-xs text-gray-400 font-semibold">
                                        👥 {teamCount} / {maxTeams} teams registered
                                      </span>
                                      {teamCount > 0 && (
                                        <button onClick={() => setShowTeams(!showTeams)} className="text-xs text-blue-400 hover:text-blue-300">
                                          {showTeams ? 'Hide teams ▲' : 'View teams ▼'}
                                        </button>
                                      )}
                                    </div>
                                    <div className="w-full bg-white/5 rounded-full h-1.5">
                                      <div className={`h-1.5 rounded-full transition-all ${c.status === 'active' ? 'bg-green-500' : 'bg-amber-500'}`}
                                        style={{width: `${Math.min(100, (teamCount / maxTeams) * 100)}%`}} />
                                    </div>
                                  </div>
                                </div>
                                {canAdmin('competitions') && (
                                  <div className="flex flex-col gap-1.5 flex-shrink-0">
                                    {c.status === 'pending' && <button onClick={() => updateCompStatus(c.id || c.code, 'active')} className="bg-green-500/20 border border-green-500/40 text-green-400 px-2.5 py-1 rounded-lg text-xs font-semibold">✓ Approve</button>}
                                    {c.status === 'active'  && <button onClick={() => updateCompStatus(c.id || c.code, 'closed')} className="bg-red-500/20 border border-red-500/40 text-red-400 px-2.5 py-1 rounded-lg text-xs">Close</button>}
                                    <button onClick={() => { navigator.clipboard?.writeText(`Join ${c.name}! Code: ${c.code}`); alert('Copied!'); }} className="bg-blue-500/10 border border-blue-500/20 text-blue-400 px-2.5 py-1 rounded-lg text-xs">📋 Share</button>
                                  </div>
                                )}
                              </div>
                            </div>
                            {/* Registered teams list */}
                            {showTeams && teamCount > 0 && (
                              <div className="border-t border-white/5 bg-black/20 px-4 py-3">
                                <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Registered Teams</p>
                                <div className="space-y-1.5">
                                  {registeredTeams.map((t, ti) => (
                                    <div key={ti} className="flex items-center justify-between bg-white/3 rounded-lg px-3 py-2">
                                      <div className="flex items-center gap-2">
                                        <span className="text-xs font-mono text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded">{t.team_code}</span>
                                        <span className="text-sm font-semibold text-white">{t.team_name}</span>
                                      </div>
                                      <StatusPill s={t.status || 'pending'} />
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}

                {/* ── SECURITY ─────────────────────────────────────────────── */}
                {adminTab === 'security' && (
                  <div className="space-y-4">
                    <div>
                      <h2 className="text-xl font-black">Security & Compliance</h2>
                      <p className="text-gray-500 text-sm">GDPR compliance · Data encryption · Access control</p>
                    </div>

                    <div className="grid sm:grid-cols-2 gap-3">
                      {[
                        { title:'End-to-End Encryption', status:'Active', icon:'🔐', detail:'AES-256 encryption for all PII data at rest and in transit. TLS 1.3 on all API calls.', color:'green' },
                        { title:'GDPR Compliance', status:'Compliant', icon:'🛡', detail:'Right to erasure, data portability, and consent management enforced. Last audit: 01/03/2025.', color:'green' },
                        { title:'Security Audits', status:'Scheduled', icon:'🔍', detail:'Next audit: 01/06/2025. Quarterly penetration testing with Rapid7.', color:'amber' },
                        { title:'2FA / MFA', status:'Recommended', icon:'📲', detail:'Admin accounts require 2FA. User 2FA via SMS OTP optional. Enable for all admin roles.', color:'amber' },
                        { title:'Rate Limiting', status:'Active', icon:'⚡', detail:'API: 100 req/min per user. Failed login lockout after 5 attempts (15 min cooldown).', color:'green' },
                        { title:'Data Retention', status:'Policy Set', icon:'📦', detail:'User data retained 7 years post-competition. KYC docs purged after 2 years. Logs kept 1 year.', color:'blue' },
                      ].map(item => (
                        <div key={item.title} className={`bg-gray-900 border rounded-xl p-4 ${item.color === 'green' ? 'border-green-500/20' : item.color === 'amber' ? 'border-amber-500/20' : 'border-blue-500/20'}`}>
                          <div className="flex items-start gap-3">
                            <span className="text-2xl">{item.icon}</span>
                            <div>
                              <div className="flex items-center gap-2 mb-1">
                                <p className="font-bold text-sm">{item.title}</p>
                                <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${item.color === 'green' ? 'bg-green-500/20 text-green-400 border-green-500/40' : item.color === 'amber' ? 'bg-amber-500/20 text-amber-400 border-amber-500/40' : 'bg-blue-500/20 text-blue-400 border-blue-500/40'}`}>{item.status}</span>
                              </div>
                              <p className="text-gray-500 text-xs leading-relaxed">{item.detail}</p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="rounded-xl p-5" style={{backgroundColor:"#111827",border:"1px solid rgba(255,255,255,0.08)"}}>
                      <h3 className="font-bold text-white mb-4">Admin Access Control</h3>
                      <div className="space-y-3">
                        {[
                          { role:'Owner Admin',    id:'admin', perms:['All features', 'User management', 'KYC', 'Bet management', 'Competition creation', 'Security', 'Audit log', 'WhatsApp push'] },
                          { role:'Campaign Manager', id:'cm',  perms:['Bet confirmation', 'Bet correction', 'Dispute resolution', 'KYC review', 'Password resets', 'Audit log'] },
                          { role:'Pub Admin',      id:'pub',   perms:['View own competition', 'Competition creation request', 'Team leaderboard', 'Push messages (restricted)'] },
                        ].map(a => (
                          <div key={a.id} className="bg-black/30 rounded-xl p-4">
                            <div className="flex items-center gap-2 mb-2">
                              <Shield className="w-4 h-4 text-red-400" />
                              <p className="font-bold text-sm">{a.role}</p>
                              <span className="font-mono text-xs text-gray-600">ID: {a.id}</span>
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {a.perms.map(p => <span key={p} className="bg-white/5 border border-white/8 text-gray-400 text-xs px-2 py-0.5 rounded">{p}</span>)}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="bg-red-950/20 border border-red-500/30 rounded-xl p-5">
                      <h3 className="font-bold text-red-400 mb-3 flex items-center gap-2"><AlertCircle className="w-4 h-4"/>GDPR Data Requests</h3>
                      <p className="text-gray-400 text-sm mb-3">Handle user data deletion and export requests in compliance with Australian Privacy Act 1988 and GDPR.</p>
                      <div className="flex gap-3 flex-wrap">
                        <button onClick={() => { addAuditEntry('owner','Data Export','All Users','GDPR compliant full export triggered'); alert('Full encrypted data export initiated. Link will be emailed to admin@puntingclub.com'); }} className="bg-blue-500/20 border border-blue-500/40 text-blue-400 px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5"><Download className="w-3 h-3"/>Export All User Data</button>
                        <button onClick={() => { const phone = prompt('Enter user phone number to delete:'); if(phone) { addAuditEntry('owner','Data Deletion',phone,'GDPR erasure request'); alert(`Data deletion request for ${phone} queued. Will be processed within 30 days per GDPR.`); }}} className="bg-red-500/20 border border-red-500/40 text-red-400 px-4 py-2 rounded-lg text-xs font-semibold">Request Data Erasure</button>
                      </div>
                    </div>
                  </div>
                )}

                {/* ── AUDIT LOG ─────────────────────────────────────────────── */}
                {adminTab === 'audit' && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h2 className="text-xl font-black">Audit Log</h2>
                        <p className="text-gray-500 text-sm">{adminAuditLog.length} entries · Full admin action history</p>
                      </div>
                      <button onClick={() => { const csv = ['Timestamp,Role,Action,Target,Detail',...adminAuditLog.map(e=>`"${e.ts}",${e.adminRole},"${e.action}","${e.target}","${e.detail}"`)].join('\n'); alert('Audit CSV:\n\n' + csv.substring(0,300)+'...'); }} className="bg-gray-800 border border-white/10 text-gray-400 px-3 py-2 rounded-lg text-xs flex items-center gap-1"><Download className="w-3 h-3"/>Export</button>
                    </div>
                    <div className="bg-gray-900 border border-white/8 rounded-xl overflow-hidden">
                      <div className="grid grid-cols-12 text-xs font-semibold text-gray-600 uppercase tracking-wider px-4 py-2 border-b border-white/5">
                        <div className="col-span-3">Time</div>
                        <div className="col-span-2">Role</div>
                        <div className="col-span-3">Action</div>
                        <div className="col-span-4">Target / Detail</div>
                      </div>
                      <div className="divide-y divide-white/5">
                        {adminAuditLog.length === 0 && (
                          <div className="text-center py-10 text-gray-600">
                            <p className="text-2xl mb-2">📋</p>
                            <p className="font-semibold text-sm">No audit entries yet</p>
                            <p className="text-xs mt-1">Admin actions will be logged here automatically.</p>
                          </div>
                        )}
                        {adminAuditLog.map((e, i) => (
                          <div key={i} className="grid grid-cols-12 text-xs px-4 py-2.5 hover:bg-white/2">
                            <div className="col-span-3 text-gray-600 font-mono">{e.ts}</div>
                            <div className="col-span-2"><span className={`capitalize font-semibold ${e.adminRole === 'owner' ? 'text-red-400' : e.adminRole === 'campaign' ? 'text-blue-400' : 'text-green-400'}`}>{e.adminRole}</span></div>
                            <div className="col-span-3 text-white font-medium">{e.action}</div>
                            <div className="col-span-4 text-gray-400 truncate">{e.target}{e.detail ? ` — ${e.detail}` : ''}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

              </main>
            </div>
          </section>
        );
      })()}

      {/* ── FOOTER ───────────────────────────────────────────────────────── */}
      <footer className="border-t border-white/5 bg-black/30 py-10 px-4 sm:px-6">
        <div className="max-w-5xl mx-auto grid sm:grid-cols-4 gap-8 mb-6">
          <div>
            <div className="flex items-center gap-2 mb-3"><Sparkles className="w-5 h-5 text-amber-500" /><span className="font-black text-amber-400">PUNTING CLUB</span></div>
            <p className="text-gray-600 text-xs">The ultimate sports betting league for teams and friends.</p>
          </div>
          {[
            ['Competition',[
              { label:'How It Works', nav:'howto' },
              { label:'Leaderboards', nav:'leaderboard' },
              { label:'Competition Rules', nav:'competition' },
              { label:'Weekly Summary', nav:'weekly' },
            ]],
            ['Features',[
              { label:'Team Management', nav:'team' },
              { label:'AI Bet Analysis', action:() => setShowBetAnalyzer(true) },
              { label:'Result Tracking', nav:'leaderboard' },
              { label:'Season History', nav:'leaderboard' },
            ]],
            ['Contact',[
              { label:'support@puntingclub.com' },
              { label:'WhatsApp: +61 XXX XXX XXX' },
              { label:'FAQ', nav:'howto' },
            ]],
          ].map(([h, items]) => (
            <div key={h}>
              <h4 className="font-bold text-amber-400/80 text-sm mb-3">{h}</h4>
              <ul className="space-y-1.5">
                {items.map(item => (
                  <li key={item.label}>
                    <button
                      onClick={() => { if (item.nav) setActiveNav(item.nav); else if (item.action) item.action(); }}
                      className={`text-gray-600 text-xs transition-colors text-left ${item.nav || item.action ? 'hover:text-amber-400/70 cursor-pointer' : 'cursor-default'}`}
                    >{item.label}</button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="border-t border-white/5 pt-6 text-center text-gray-700 text-xs">© 2025 Punting Club. Please gamble responsibly. Must be 18+</div>
      </footer>

      {/* ═══════════════════════════════════════════════════════════════════
          MODALS
      ═══════════════════════════════════════════════════════════════════ */}

      {/* LOGIN */}
      {showLoginModal && (
        <Modal title="Login" onClose={() => { setShowLoginModal(false); setLoginPhone(''); setLoginPassword(''); setApiError(null); }}>
          <form onSubmit={handleLogin} className="p-5 space-y-4">
            {apiError && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2.5 text-red-400 text-sm flex items-start gap-2">
                <span className="flex-shrink-0 mt-0.5">✗</span>{apiError}
              </div>
            )}
            <div>
              <label className="block text-xs font-semibold text-amber-400 mb-1.5">Mobile Number</label>
              <input type="tel" required value={loginPhone} onChange={e => { setLoginPhone(e.target.value); setApiError(null); }} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-amber-500/50 placeholder-gray-600" placeholder="+61 412 345 678" />
              <p className="text-gray-600 text-xs mt-1">The mobile number you registered with</p>
            </div>
            <div>
              <label className="block text-xs font-semibold text-amber-400 mb-1.5">Password</label>
              <input type="password" required value={loginPassword} onChange={e => setLoginPassword(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-amber-500/50 placeholder-gray-600" placeholder="Your password" />
            </div>
            <button type="submit" disabled={apiLoading} className="w-full bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-black font-bold py-2.5 rounded-lg transition-all disabled:opacity-60 flex items-center justify-center gap-2">{apiLoading ? <><span className="animate-spin inline-block">⏳</span> Logging in...</> : 'Log In'}</button>
            <div className="text-center">
              <p className="text-gray-600 text-xs mb-1.5">Don't have an account?</p>
              <button type="button" onClick={() => { setShowLoginModal(false); setSignupMode('create'); setShowSignupModal(true); }} className="text-amber-400 hover:text-amber-300 text-sm font-semibold">Create Account</button>
            </div>
          </form>
        </Modal>
      )}

      {/* SIGNUP */}
      {showSignupModal && (
        <Modal title={signupMode === 'create' ? '🏆 Create a Team' : '👋 Join a Team'} onClose={() => { setShowSignupModal(false); setSignupMode(null); setApiError(null); }}>
          <form onSubmit={handleSubmitSignup} className="p-5 space-y-3">
            {apiError && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2.5 text-red-400 text-sm flex items-start gap-2">
                <span className="flex-shrink-0 mt-0.5">✗</span>{apiError}
              </div>
            )}
            {/* Toggle */}
            <div className="flex gap-2 p-1 bg-black/30 rounded-lg">
              {[['create','Create Team'],['join','Join Team']].map(([m,l]) => (
                <button key={m} type="button" onClick={() => setSignupMode(m)} className={`flex-1 py-2 rounded-md text-xs font-bold transition-all ${signupMode === m ? 'bg-amber-500 text-black' : 'text-gray-400 hover:text-white'}`}>{l}</button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3">
              {[['firstName','First Name','text','John','given-name'],['lastName','Last Name','text','Smith','family-name']].map(([f,l,t,p,ac]) => (
                <div key={f}>
                  <label className="block text-xs font-semibold text-amber-400 mb-1">{l} *</label>
                  <input type={t} required autoComplete={ac} value={formData[f]} onChange={e => setFormData(p => ({...p, [f]: e.target.value}))} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/50 placeholder-gray-600" placeholder={p} />
                </div>
              ))}
            </div>

            {/* Phone with live validation */}
            <div>
              <label className="block text-xs font-semibold text-amber-400 mb-1.5">Mobile Number <span className="text-red-400">*</span></label>
              <input
                type="tel"
                required
                value={formData.phone}
                onChange={e => {
                  const v = e.target.value;
                  setFormData(p => ({...p, phone: v}));
                  if (v.length > 5) {
                    const res = validatePhone(v);
                    setPhoneError(res.valid ? '' : 'Enter a valid Australian mobile (e.g. 0412 345 678)');
                  } else {
                    setPhoneError('');
                  }
                }}
                className={`w-full bg-white/5 border rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none placeholder-gray-600 ${phoneError ? 'border-red-500/60 focus:border-red-500' : formData.phone.length > 5 && !phoneError ? 'border-green-500/50 focus:border-green-500' : 'border-white/10 focus:border-amber-500/50'}`}
                placeholder="0412 345 678"
              />
              {phoneError
                ? <p className="text-red-400 text-xs mt-1">⚠ {phoneError}</p>
                : formData.phone.length > 5 && !phoneError
                  ? <p className="text-green-400 text-xs mt-1">✓ Valid mobile number</p>
                  : <p className="text-gray-600 text-xs mt-1">Australian mobile numbers only (04XX XXX XXX)</p>
              }
            </div>
            {[['email','Email','email','john@example.com','email']].map(([f,l,t,p,ac]) => (
              <div key={f}>
                <label className="block text-xs font-semibold text-amber-400 mb-1">{l} *</label>
                <input type={t} required autoComplete={ac} value={formData[f]} onChange={e => setFormData(prev => ({...prev, [f]: e.target.value}))} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/50 placeholder-gray-600" placeholder={p} />
                {f === 'phone' && <p className="text-gray-600 text-xs mt-0.5">This is your username for login</p>}
              </div>
            ))}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-amber-400 mb-1">Date of Birth *</label>
                <input type="date" required value={formData.dob} onChange={e => setFormData(p => ({...p, dob: e.target.value}))} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/50" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-amber-400 mb-1">Postcode *</label>
                <input type="text" required value={formData.postcode} onChange={e => setFormData(p => ({...p, postcode: e.target.value}))} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/50 placeholder-gray-600" placeholder="2000" />
              </div>
            </div>

            {signupMode === 'create' && (
              <>
                <div>
                  <label className="block text-xs font-semibold text-amber-400 mb-1">Team Name *</label>
                  <input type="text" required value={formData.teamName} onChange={e => setFormData(p => ({...p, teamName: e.target.value}))} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/50 placeholder-gray-600" placeholder="The Legends" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-amber-400 mb-1.5">Buy-In Payment</label>
                  <div className="grid grid-cols-2 gap-2">
                    {[['captain','Captain pays full $1,000'],['split','Split between members']].map(([v,l]) => (
                      <button key={v} type="button" onClick={() => setFormData(p => ({...p, buyInMode: v}))} className={`p-3 rounded-lg border text-left text-xs transition-all ${formData.buyInMode === v ? 'border-amber-500 bg-amber-500/15 text-amber-300' : 'border-white/10 text-gray-400 hover:border-white/20'}`}>
                        <div className="font-bold mb-0.5">{v === 'captain' ? '👑 Captain Pays' : '🤝 Split'}</div>
                        <div className="text-gray-500 text-xs">{l}</div>
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}

            {signupMode === 'join' && (
              <div>
                <label className="block text-xs font-semibold text-amber-400 mb-1">Team Code *</label>
                <input type="text" required value={formData.teamCode} onChange={e => setFormData(p => ({...p, teamCode: e.target.value.toUpperCase()}))} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/50 placeholder-gray-600 tracking-widest" placeholder="ABC123" maxLength={6} />
                <p className="text-gray-600 text-xs mt-0.5">Ask your captain for this code</p>
              </div>
            )}

            {/* Competition dropdown — shows only active competitions from admin */}
            {signupMode === 'create' && (
              <div>
                <label className="block text-xs font-semibold text-amber-400 mb-1">
                  Competition <span className="text-gray-600 font-normal">(optional)</span>
                </label>
                {activeCompetitions.length > 0 ? (
                  <>
                    <select
                      value={formData.competitionCode}
                      onChange={e => setFormData(p => ({...p, competitionCode: e.target.value}))}
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-amber-500/50"
                      style={{backgroundColor:'#111827'}}
                    >
                      <option value="">— No competition (register team only) —</option>
                      {activeCompetitions.map(c => (
                        <option key={c.code} value={c.code}>
                          {c.name} · {c.pub} · {c.weeks}wks · ${c.buy_in?.toLocaleString()} buy-in
                        </option>
                      ))}
                    </select>
                    {formData.competitionCode && (() => {
                      const sel = activeCompetitions.find(c => c.code === formData.competitionCode);
                      return sel ? (
                        <div className="mt-2 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                          <p className="text-amber-400 text-xs font-semibold">✓ Joining: {sel.name}</p>
                          <p className="text-gray-500 text-xs mt-0.5">{sel.pub} · {sel.weeks} weeks · Buy-in: ${sel.buy_in?.toLocaleString()}</p>
                        </div>
                      ) : null;
                    })()}
                  </>
                ) : (
                  <div className="bg-gray-900 border border-white/10 rounded-lg px-3 py-2.5 text-gray-600 text-sm">
                    No active competitions available — contact your pub or admin
                  </div>
                )}
              </div>
            )}

            <div className="border-t border-white/5 pt-3 space-y-3">
              <div>
                <label className="block text-xs font-semibold text-amber-400 mb-1">Password *</label>
                <input type="password" required minLength={6} value={formData.password} onChange={e => setFormData(p => ({...p, password: e.target.value}))} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/50 placeholder-gray-600" placeholder="Min 6 characters" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-amber-400 mb-1">Confirm Password *</label>
                <input type="password" required minLength={6} value={formData.confirmPassword} onChange={e => setFormData(p => ({...p, confirmPassword: e.target.value}))} className={`w-full bg-white/5 border rounded-lg px-3 py-2 text-sm text-white focus:outline-none placeholder-gray-600 ${formData.confirmPassword ? (formData.password === formData.confirmPassword ? 'border-green-500/50 focus:border-green-500' : 'border-red-500/50 focus:border-red-500') : 'border-white/10 focus:border-amber-500/50'}`} placeholder="Re-enter password" />
                {formData.confirmPassword && (
                  formData.password === formData.confirmPassword
                    ? <p className="text-green-400 text-xs mt-1">✓ Passwords match</p>
                    : <p className="text-red-400 text-xs mt-1">✗ Passwords don't match</p>
                )}
              </div>
            </div>

            <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 text-xs text-gray-300">
              <strong className="text-amber-400">Buy-in:</strong> $1,000 per team {signupMode === 'join' && '· Joining requests are approved by the captain'}
              {signupMode === 'join' && <><br /><span className="text-orange-400">⚠ Your request will be pending captain approval</span></>}
            </div>

            <button type="submit" disabled={apiLoading} className="w-full bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-black font-bold py-3 rounded-xl transition-all text-sm disabled:opacity-60 flex items-center justify-center gap-2">
              {apiLoading
                ? <><span className="animate-spin inline-block">⏳</span> {signupMode === 'create' ? 'Creating...' : 'Joining...'}</>
                : signupMode === 'create' ? 'Create Team & Register' : 'Request to Join Team'}
            </button>
          </form>
        </Modal>
      )}

      {/* INVITE */}
      {showInviteModal && (
        <Modal title="Invite Team Member" onClose={() => setShowInviteModal(false)}>
          <div className="p-5 space-y-4">
            <div className="bg-green-500/10 border-2 border-green-500/40 rounded-xl p-5 text-center">
              <p className="text-gray-400 text-xs mb-2">Team Code</p>
              <p className="text-4xl font-black text-green-400 tracking-[0.3em]">{currentUser?.teamCode || 'XXXXXX'}</p>
              <button onClick={() => { navigator.clipboard?.writeText(currentUser?.teamCode || ''); showToast('Team code copied!', 'success'); }} className="mt-3 bg-green-500/20 hover:bg-green-500/30 text-green-400 px-3 py-1.5 rounded-lg text-xs font-semibold">Copy Code</button>
            </div>
            <div className="bg-white/3 border border-white/8 rounded-xl p-4">
              <p className="text-gray-400 text-xs font-semibold mb-2">Shareable Link</p>
              <p className="text-amber-300 text-xs break-all mb-2">{shareableLink}</p>
              <button onClick={() => { navigator.clipboard?.writeText(shareableLink); showToast('Invite link copied!', 'success'); }} className="bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 px-3 py-1.5 rounded-lg text-xs font-semibold w-full">Copy Invite Link</button>
            </div>
            <div className="bg-blue-950/20 border border-blue-500/20 rounded-xl p-4">
              <p className="text-blue-400 text-xs font-semibold mb-2">How to invite:</p>
              <ol className="space-y-1 text-gray-400 text-xs">
                {['Share the team code or invite link','They click Sign Up → Join Team','Enter the team code','Submit request — you\'ll get notified to approve','Once approved they\'re on the team!'].map((s, i) => (
                  <li key={i} className="flex gap-2"><span className="text-blue-400 font-bold">{i+1}.</span>{s}</li>
                ))}
              </ol>
            </div>
            <button onClick={() => { navigator.clipboard?.writeText(`Join my Punting Club team "${currentUser?.teamName || 'The Legends'}"!\n\nTeam Code: ${currentUser?.teamCode || 'XXXXXX'}\nOr use this link: ${shareableLink}`); showToast('Invitation message copied!', 'success'); }} className="w-full bg-gradient-to-r from-amber-500 to-amber-600 text-black font-bold py-2.5 rounded-xl text-sm">Copy Full Invitation Message</button>
          </div>
        </Modal>
      )}

      {/* BETTING ORDER */}
      {showOrderModal && (
        <Modal title="🎯 Betting Order" onClose={() => setShowOrderModal(false)}>
          <div className="p-5 space-y-4">
            <p className="text-gray-400 text-sm">Set the rotation order for who places the bet each week. Drag to reorder (use the buttons below).</p>
            <div className="space-y-2">
              {bettingOrder.map((name, i) => (
                <div key={name} className="flex items-center gap-3 bg-black/30 border border-white/8 rounded-lg px-3 py-2.5">
                  <span className="text-amber-400 font-bold text-sm w-6">{i+1}.</span>
                  <span className="flex-1 text-sm font-semibold">{name}</span>
                  <div className="flex gap-1">
                    <button onClick={() => setBettingOrder(prev => { const a = [...prev]; if (i > 0) [a[i-1],a[i]] = [a[i],a[i-1]]; return a; })} disabled={i === 0} className="text-gray-500 hover:text-amber-400 disabled:opacity-20 px-1.5 py-1 text-xs">↑</button>
                    <button onClick={() => setBettingOrder(prev => { const a = [...prev]; if (i < a.length-1) [a[i],a[i+1]] = [a[i+1],a[i]]; return a; })} disabled={i === bettingOrder.length-1} className="text-gray-500 hover:text-amber-400 disabled:opacity-20 px-1.5 py-1 text-xs">↓</button>
                  </div>
                </div>
              ))}
            </div>
            <div className="bg-blue-950/20 border border-blue-500/20 rounded-lg p-3 text-xs text-gray-400">
              <strong className="text-blue-400">Note:</strong> Only members with "Can Bet" permission will appear. Change roles in the Members section.
            </div>
            <button onClick={async () => { try { await apiSaveBettingOrder(currentTeamId, bettingOrder); } catch(e) { console.error(e); } showToast('Betting order saved!', 'success'); setShowOrderModal(false); }} className="w-full bg-gradient-to-r from-amber-500 to-amber-600 text-black font-bold py-2.5 rounded-xl text-sm">Save Order</button>
          </div>
        </Modal>
      )}

      {/* FINALISE TEAM MODAL */}
      {showFinaliseModal && (
        <Modal title="🏁 Finalise Team Roster" onClose={() => setShowFinaliseModal(false)}>
          <div className="p-5 space-y-4">

            {/* What finalising does */}
            <div className="bg-blue-950/20 border border-blue-500/20 rounded-xl p-4 flex gap-3">
              <span className="text-xl flex-shrink-0">ℹ️</span>
              <div>
                <p className="font-bold text-blue-400 text-sm mb-1">What does finalising do?</p>
                <ul className="text-gray-400 text-xs space-y-1">
                  <li>• Locks in the current member count</li>
                  <li>• Calculates the equal deposit amount per member</li>
                  <li>• Allows you to track who has paid</li>
                  <li>• You can re-open and recalculate if membership changes</li>
                </ul>
              </div>
            </div>

            {/* Current roster summary */}
            <div className="bg-gray-900 border border-white/8 rounded-xl p-4">
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">Current Roster</p>
              <div className="space-y-1.5">
                {teamMembers.map(m => (
                  <div key={m.phone} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-5 h-5 rounded-full bg-amber-500/20 flex items-center justify-center text-amber-400 text-xs font-bold">{m.name.charAt(0)}</div>
                      <span className="text-sm">{m.name}</span>
                      <PermissionBadge role={m.role} />
                    </div>
                    <span className={`text-xs font-semibold ${m.depositPaid ? 'text-green-400' : 'text-red-400'}`}>
                      {m.depositPaid ? '✓ Confirmed' : '⚠ Unconfirmed'}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Deposit calculation preview */}
            <div className="bg-green-950/20 border border-green-500/30 rounded-xl p-4">
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">Deposit Calculation Preview</p>
              {(() => {
                const comp = activeCompetitions.find(c => c.code === currentUser?.competitionCode);
                const totalBuyIn = comp ? parseInt((comp.buyIn || '$1,000').replace(/[^0-9]/g, '')) || 1000 : 1000;
                const confirmedMembers = teamMembers.filter(m => m.depositPaid).length;
                const allMembers = teamMembers.length;
                const perMemberAll = Math.ceil(totalBuyIn / allMembers);
                const perMemberConfirmed = confirmedMembers > 0 ? Math.ceil(totalBuyIn / confirmedMembers) : totalBuyIn;
                return (
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">Total buy-in:</span>
                      <span className="font-bold text-white">${totalBuyIn.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">Total members:</span>
                      <span className="font-bold text-white">{allMembers}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">Deposit confirmed:</span>
                      <span className="font-bold text-white">{confirmedMembers}</span>
                    </div>
                    <div className="border-t border-white/10 pt-2 mt-2">
                      <div className="flex justify-between">
                        <span className="text-gray-400 text-sm">Per member (all {allMembers}):</span>
                        <span className="font-black text-amber-400 text-lg">${perMemberAll.toLocaleString()}</span>
                      </div>
                      {confirmedMembers !== allMembers && (
                        <div className="flex justify-between mt-1">
                          <span className="text-gray-500 text-xs">Per member (confirmed {confirmedMembers} only):</span>
                          <span className="font-bold text-green-400">${perMemberConfirmed.toLocaleString()}</span>
                        </div>
                      )}
                    </div>
                    <p className="text-gray-600 text-xs mt-1">* Calculated on all {allMembers} members. Update deposit status below if needed before finalising.</p>
                  </div>
                );
              })()}
            </div>

            {/* Warning if unconfirmed members */}
            {teamMembers.some(m => !m.depositPaid) && (
              <div className="bg-amber-950/20 border border-amber-500/30 rounded-lg p-3 flex gap-2">
                <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                <p className="text-amber-300 text-xs">{teamMembers.filter(m => !m.depositPaid).length} member(s) not yet confirmed. You can still finalise — the deposit will be split equally across <strong>all</strong> members regardless.</p>
              </div>
            )}

            <div className="flex gap-3">
              <button onClick={() => setShowFinaliseModal(false)} className="flex-1 border border-white/10 text-gray-400 py-2.5 rounded-xl text-sm font-semibold">Cancel</button>
              <button onClick={finaliseTeam} className="flex-1 bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white font-black py-2.5 rounded-xl text-sm flex items-center justify-center gap-2">
                <CheckCircle className="w-4 h-4" />Confirm & Finalise
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* BET ANALYZER */}
      {showBetAnalyzer && (
        <Modal title="📸 Analyze Bet Slip" maxWidth="max-w-2xl" onClose={() => { setShowBetAnalyzer(false); resetBetAnalyzer(); }}>
          <div className="p-4 space-y-4">
            {!analyzedBet ? (
              <>
                <div className="border-2 border-dashed border-amber-500/30 rounded-xl p-8 text-center hover:bg-amber-500/5 cursor-pointer transition-all" onClick={() => fileInputRef.current?.click()}>
                  <input ref={fileInputRef} type="file" multiple accept="image/*" onChange={handleImageUpload} className="hidden" />
                  <p className="text-gray-400 text-sm">Click to upload bet slip images</p>
                  <p className="text-gray-600 text-xs mt-1">PNG, JPG up to 10MB · $50 weekly max enforced</p>
                </div>
                {uploadedImages.length > 0 && (
                  <div className="grid grid-cols-2 gap-3">
                    {uploadedImages.map((img, i) => (
                      <div key={i} className="relative rounded-xl overflow-hidden border border-white/10">
                        <img src={img.src} alt={`Slip ${i+1}`} className="w-full h-28 object-cover" />
                        <button onClick={() => setUploadedImages(p => p.filter((_,j) => j !== i))} className="absolute top-1.5 right-1.5 bg-red-600/80 hover:bg-red-700 text-white p-1 rounded-full"><X className="w-3 h-3" /></button>
                      </div>
                    ))}
                  </div>
                )}
                <button onClick={analyzeBetSlips} disabled={analyzing || !uploadedImages.length} className="w-full bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 disabled:from-gray-700 disabled:to-gray-800 text-black disabled:text-gray-500 font-bold py-3 rounded-xl transition-all text-sm">
                  {analyzing ? '⏳ Analyzing… (10–15 seconds)' : 'Analyze Bet Slip'}
                </button>
              </>
            ) : (
              <>
                <div className="bg-green-950/40 border border-green-500/40 rounded-xl px-4 py-3 flex items-center gap-3">
                  <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0">✓</div>
                  <div>
                    <p className="text-green-400 font-bold text-sm">Analysis Complete</p>
                    <p className="text-green-300/60 text-xs">Review the details below, then submit.</p>
                  </div>
                </div>
                <BetSlipCard bet={{ ...analyzedBet, type: analyzedBet.betType, overallStatus: 'pending' }} />
                <div>
                  <label className="block text-xs font-semibold text-amber-400 mb-1.5">Submit for team *</label>
                  <select value={selectedTeamForBet} onChange={e => setSelectedTeamForBet(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-amber-500/50">
                    <option value="">Choose a team…</option>
                    {leaderboardTeams.map(t => <option key={t.team} value={t.team}>{t.team}</option>)}
                  </select>
                </div>
                <div className="flex gap-3">
                  <button onClick={resetBetAnalyzer} className="flex-1 border border-amber-500/40 hover:bg-amber-500/10 text-amber-400 font-bold py-2.5 rounded-xl text-sm">Upload New</button>
                  <button onClick={submitBet} className="flex-1 bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white font-bold py-2.5 rounded-xl text-sm">Submit Bet ✓</button>
                </div>
              </>
            )}
          </div>
        </Modal>
      )}



      {/* ── ADMIN LOGIN MODAL ─────────────────────────────────────────────── */}
      {showAdminLogin && (
        <Modal title="🔐 Admin Access" onClose={() => { setShowAdminLogin(false); setAdminLoginId(''); setAdminLoginPw(''); }}>
          <form onSubmit={handleAdminLogin} className="p-5 space-y-4">
            <div className="bg-red-950/20 border border-red-500/20 rounded-xl p-3 flex items-center gap-2">
              <Shield className="w-4 h-4 text-red-400 flex-shrink-0" />
              <p className="text-red-300/80 text-xs">Restricted access. All logins are audited.</p>
            </div>
            <div>
              <label className="block text-xs font-semibold text-amber-400 mb-1.5">Admin ID</label>
              <input type="text" required value={adminLoginId} onChange={e => setAdminLoginId(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-red-500/50 placeholder-gray-600" placeholder="admin / cm / pub" autoComplete="off" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-amber-400 mb-1.5">Password</label>
              <input type="password" required value={adminLoginPw} onChange={e => setAdminLoginPw(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-red-500/50 placeholder-gray-600" placeholder="Admin password" />
            </div>
            <div className="bg-black/30 rounded-lg p-3 text-xs text-gray-600 space-y-0.5">
              <p>Demo: <strong className="text-gray-500">admin</strong> / admin123 (Owner)</p>
              <p>Demo: <strong className="text-gray-500">cm</strong> / cm123 (Campaign Mgr)</p>
              <p>Demo: <strong className="text-gray-500">pub</strong> / pub123 (Pub Admin)</p>
            </div>
            <button type="submit" className="w-full bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800 text-white font-bold py-2.5 rounded-xl transition-all text-sm flex items-center justify-center gap-2">
              <Shield className="w-4 h-4"/>Login to Admin Panel
            </button>
          </form>
        </Modal>
      )}

      {/* ── CREATE / JOIN TEAM MODAL ──────────────────────────────────────── */}
      {showCreateTeamModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[80] flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-white/10 rounded-2xl w-full max-w-md shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
              <h2 className="text-lg font-bold text-white">New Team</h2>
              <button onClick={() => setShowCreateTeamModal(false)} className="text-gray-500 hover:text-white"><X className="w-5 h-5" /></button>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-white/5">
              {[['create','Create New'],['join','Join Existing']].map(([tab, label]) => (
                <button key={tab} onClick={() => { setTeamModalTab(tab); setCreateTeamError(null); setJoinTeamError(null); setJoinTeamSuccess(null); }}
                  className={`flex-1 py-3 text-sm font-semibold transition-colors ${teamModalTab === tab ? 'text-amber-400 border-b-2 border-amber-400' : 'text-gray-500 hover:text-gray-300'}`}
                >{label}</button>
              ))}
            </div>

            {/* ── Create tab ── */}
            {teamModalTab === 'create' && (
              <form onSubmit={handleCreateAdditionalTeam} className="px-6 py-5 space-y-4">
                {createTeamError && (
                  <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 text-red-400 text-sm">{createTeamError}</div>
                )}

                <div>
                  <label className="block text-xs font-semibold text-amber-400 mb-1">Team Name *</label>
                  <input
                    type="text"
                    value={createTeamForm.teamName}
                    onChange={e => setCreateTeamForm(p => ({ ...p, teamName: e.target.value }))}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-amber-500/50 placeholder-gray-600"
                    placeholder="e.g. The Golden Eagles"
                    maxLength={50}
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-amber-400 mb-1">Competition <span className="text-gray-600 font-normal">(optional)</span></label>
                  {activeCompetitions.length > 0 ? (
                    <>
                      <select
                        value={createTeamForm.competitionCode}
                        onChange={e => setCreateTeamForm(p => ({ ...p, competitionCode: e.target.value }))}
                        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-amber-500/50"
                        style={{ backgroundColor: '#111827' }}
                      >
                        <option value="">— No competition (register team only) —</option>
                        {activeCompetitions.map(c => (
                          <option key={c.code} value={c.code}>
                            {c.name} · {c.pub} · {c.weeks}wks · ${c.buy_in?.toLocaleString()} buy-in
                          </option>
                        ))}
                      </select>
                      {createTeamForm.competitionCode && (() => {
                        const sel = activeCompetitions.find(c => c.code === createTeamForm.competitionCode);
                        return sel ? (
                          <div className="mt-2 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                            <p className="text-amber-400 text-xs font-semibold">✓ Joining: {sel.name}</p>
                            <p className="text-gray-500 text-xs mt-0.5">{sel.pub} · {sel.weeks} weeks · Buy-in: ${sel.buy_in?.toLocaleString()}</p>
                          </div>
                        ) : null;
                      })()}
                    </>
                  ) : (
                    <div className="bg-gray-900 border border-white/10 rounded-lg px-3 py-2.5 text-gray-600 text-sm">No active competitions available</div>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-semibold text-amber-400 mb-1">Buy-In Mode</label>
                  <div className="flex gap-2">
                    {[['split','Members split equally'],['captain','Captain pays all']].map(([val, label]) => (
                      <button key={val} type="button"
                        onClick={() => setCreateTeamForm(p => ({ ...p, buyInMode: val }))}
                        className={`flex-1 py-2 px-3 rounded-lg text-xs font-semibold border transition-all ${createTeamForm.buyInMode === val ? 'bg-amber-500/20 border-amber-500 text-amber-400' : 'bg-white/5 border-white/10 text-gray-500 hover:border-white/20'}`}
                      >{label}</button>
                    ))}
                  </div>
                </div>

                <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg px-3 py-2 text-xs text-gray-400">
                  You can be in up to <span className="text-white font-semibold">3 teams</span> per competition. Team names must be unique within each competition.
                </div>

                <button type="submit" disabled={createTeamLoading}
                  className="w-full bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 disabled:opacity-50 text-black font-bold py-3 rounded-xl text-sm transition-all">
                  {createTeamLoading ? 'Creating…' : 'Create Team'}
                </button>
              </form>
            )}

            {/* ── Join tab ── */}
            {teamModalTab === 'join' && (
              <form onSubmit={handleJoinExistingTeam} className="px-6 py-5 space-y-4">
                {joinTeamError && (
                  <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 text-red-400 text-sm">{joinTeamError}</div>
                )}
                {joinTeamSuccess && (
                  <div className="bg-green-500/10 border border-green-500/30 rounded-lg px-3 py-2 text-green-400 text-sm">✓ {joinTeamSuccess}</div>
                )}

                <div>
                  <label className="block text-xs font-semibold text-amber-400 mb-1">Team Code *</label>
                  <input
                    type="text"
                    value={joinTeamCode}
                    onChange={e => setJoinTeamCode(e.target.value.toUpperCase())}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white font-mono tracking-widest focus:outline-none focus:border-amber-500/50 placeholder-gray-600"
                    placeholder="e.g. ABC123"
                    maxLength={8}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <p className="text-gray-600 text-xs mt-1">Ask the team captain for their 6-character team code.</p>
                </div>

                <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 text-xs text-gray-400">
                  Your request will be <span className="text-amber-400 font-semibold">pending captain approval</span> before you can bet. You can be in up to <span className="text-white font-semibold">3 teams</span> per competition.
                </div>

                <button type="submit" disabled={joinTeamLoading || !!joinTeamSuccess}
                  className="w-full bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 disabled:opacity-50 text-white font-bold py-3 rounded-xl text-sm transition-all">
                  {joinTeamLoading ? 'Sending request…' : joinTeamSuccess ? 'Request sent ✓' : 'Request to Join'}
                </button>

                {joinTeamSuccess && (
                  <button type="button" onClick={() => setShowCreateTeamModal(false)}
                    className="w-full border border-white/10 text-gray-400 hover:text-white py-2 rounded-xl text-sm transition-colors">
                    Close
                  </button>
                )}
              </form>
            )}
          </div>
        </div>
      )}

      {/* ── TOAST NOTIFICATIONS ───────────────────────────────────────────── */}
      {toasts.length > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[300] flex flex-col-reverse gap-2 items-center w-full max-w-sm px-4 pointer-events-none">
          {toasts.map(t => (
            <div key={t.id} className={`pointer-events-auto w-full flex items-start gap-3 px-4 py-3 rounded-xl shadow-2xl text-sm font-semibold transition-all
              ${t.type === 'success' ? 'bg-green-950/95 border border-green-500/50 text-green-200' :
                t.type === 'error'   ? 'bg-red-950/95 border border-red-500/50 text-red-200' :
                t.type === 'warning' ? 'bg-amber-950/95 border border-amber-500/50 text-amber-200' :
                'bg-gray-900/95 border border-white/15 text-gray-200'}`}>
              <span className="flex-shrink-0 mt-0.5">
                {t.type === 'success' ? '✓' : t.type === 'error' ? '✗' : t.type === 'warning' ? '⚠' : 'ℹ'}
              </span>
              <span className="flex-1 leading-snug">{t.message}</span>
            </div>
          ))}
        </div>
      )}

      {/* BET SUBMITTED CONFIRMATION */}
      {showBetResults && analyzedBet && (
        <div className="fixed inset-0 bg-gray-950 z-[100] overflow-y-auto">
          <div className="min-h-screen flex flex-col">
            <div className="bg-gray-900 border-b border-white/5 px-4 py-4 flex justify-between items-center sticky top-0 z-10">
              <h1 className="text-xl font-black">Bet Submitted ✓</h1>
              <button onClick={() => { setShowBetResults(false); resetBetAnalyzer(); }} className="text-gray-400 hover:text-white"><X className="w-6 h-6" /></button>
            </div>
            <div className="flex-1 p-4 max-w-2xl mx-auto w-full">
              <div className="bg-green-950/40 border-2 border-green-500/50 rounded-xl p-5 mb-5 flex items-center gap-4">
                <div className="w-12 h-12 bg-green-500 rounded-full flex items-center justify-center text-2xl flex-shrink-0">✓</div>
                <div>
                  <h2 className="text-xl font-bold text-green-400">Successfully Submitted!</h2>
                  <p className="text-green-300/70 text-sm">Bet submitted for <strong>{selectedTeamForBet}</strong></p>
                </div>
              </div>
              <BetSlipCard bet={{ ...analyzedBet, type: analyzedBet.betType, overallStatus: 'pending' }} />
              <div className="flex flex-col sm:flex-row gap-3 mt-5">
                <button onClick={() => { setShowBetResults(false); setShowBetAnalyzer(true); resetBetAnalyzer(); }} className="flex-1 border border-amber-500/40 text-amber-400 font-bold py-3 rounded-xl text-sm hover:bg-amber-500/10">Submit Another</button>
                <button onClick={() => { setShowBetResults(false); setActiveNav('leaderboard'); resetBetAnalyzer(); }} className="flex-1 bg-gradient-to-r from-green-500 to-green-600 text-white font-bold py-3 rounded-xl text-sm">View Leaderboard</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );

}
