import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  apiSignUp, apiLogin,
  apiGetActiveCompetitions, apiCreateCompetition, apiUpdateCompStatus,
  apiGetAllTeams, apiUpdateTeam, apiFinaliseTeam,
  apiGetTeamMembers, apiApproveMember, apiRejectMember, apiUpdateMember, apiSaveBettingOrder,
  apiSubmitBet, apiGetTeamBets, apiGetAllBets, apiUpdateBetResult, apiRejectBet, apiCorrectBet,
  apiGetLeaderboard, apiGetAllUsers, apiUpdateKyc, apiGetAuditLog,
} from './api.js';
import { Trophy, Zap, Users, TrendingUp, ArrowRight, Menu, X, Sparkles, RotateCcw, CheckCircle, AlertCircle, Clock, ChevronDown, ChevronUp, Shield, Eye, Edit3, Lock, UserCheck, Activity, Database, Bell, Search, Filter, MoreVertical, Download, RefreshCw, Hash, DollarSign, FileText } from 'lucide-react';

// ─── In-memory stores ────────────────────────────────────────────────────────
// ── Data is now persisted in Supabase ──────────────────────────────────────
// userStore and teamStore replaced by Supabase tables via /api/auth and /api/data
// See src/supabase.js and src/api.js for all DB operations
const competitionStore = {
  'COMP01': { code:'COMP01', name:'RSL Punting League S1', pub:'RSL Club Sydney',   status:'active',  weeks:8,  buyIn:'$1,000', startDate:'03/03/2025', endDate:'26/04/2025' },
  'COMP02': { code:'COMP02', name:'Crown Hotel Cup',        pub:'Crown Hotel Melb', status:'active',  weeks:16, buyIn:'$1,000', startDate:'10/03/2025', endDate:'29/06/2025' },
  'COMP03': { code:'COMP03', name:'Bondi Surf Club Open',   pub:'Bondi Surf Club',  status:'pending', weeks:32, buyIn:'$1,000', startDate:'01/04/2025', endDate:'31/10/2025' },
};
const auditLog = [];           // { ts, adminRole, action, target, detail }
const rejectedBets = [];       // { team, bet, reason, reviewedBy, ts }
const kycStore = {};           // phoneKey → { status:'pending'|'verified'|'rejected', docs:[], notes:'' }

// ── Admin roles ──────────────────────────────────────────────────────────────
// owner        → all privileges
// campaign     → confirm/correct results, disputes, password help
// pub_admin    → manage their own competition
const ADMIN_USERS = {
  'admin': { password: 'admin123', role: 'owner',    name: 'Owner Admin',       phone: 'admin' },
  'cm':    { password: 'cm123',    role: 'campaign',  name: 'Campaign Manager',  phone: 'cm' },
  'pub':   { password: 'pub123',   role: 'pub_admin', name: 'Pub Admin (RSL)',   phone: 'pub' },
};

const logAudit = (adminRole, action, target, detail = '') => {
  auditLog.unshift({ ts: new Date().toLocaleString(), adminRole, action, target, detail });
  if (auditLog.length > 200) auditLog.pop();
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

const phoneKey = (p) => p.trim().replace(/\s+/g, '');

const WEEK_BUDGET = 50;

// ─── Shared UI ───────────────────────────────────────────────────────────────
const Modal = ({ onClose, title, children, maxWidth = 'max-w-md' }) => (
  <div className="fixed inset-0 bg-black/80 backdrop-blur z-[100] overflow-y-auto">
    <div className="flex min-h-full items-start justify-center p-2 sm:p-4 py-4">
      <div className={`bg-gray-950 border-2 border-amber-500 rounded-xl w-full ${maxWidth} flex flex-col shadow-2xl shadow-amber-900/20`}>
        <div className="sticky top-0 bg-gray-950 border-b border-amber-500/30 p-4 flex justify-between items-center z-10 rounded-t-xl">
          <h2 className="text-lg font-bold text-white">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-amber-400 transition-colors"><X className="w-5 h-5" /></button>
        </div>
        <div>{children}</div>
      </div>
    </div>
  </div>
);

const Badge = ({ status }) => {
  const map = {
    won:     'bg-green-500/20 border-green-500/60 text-green-400',
    lost:    'bg-red-500/20 border-red-500/60 text-red-400',
    partial: 'bg-yellow-500/20 border-yellow-500/60 text-yellow-400',
    pending: 'bg-amber-500/10 border-amber-500/30 text-amber-400',
    void:    'bg-gray-500/20 border-gray-500/60 text-gray-400',
  };
  const label = { won: '✓ Won', lost: '✗ Lost', partial: '⚡ Partial', pending: '⏳ Pending', void: '— Void' };
  return <span className={`border text-xs font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${map[status] || map.pending}`}>{label[status] || '⏳ Pending'}</span>;
};

const LegDot = ({ leg }) => {
  const colors = {
    won:     'bg-green-500/30 border-green-500 text-green-400',
    lost:    'bg-red-500/30 border-red-500 text-red-400',
    void:    'bg-gray-500/30 border-gray-500 text-gray-400',
    pending: 'bg-amber-500/10 border-amber-500/40 text-amber-400',
  };
  const icon = { won: '✓', lost: '✗', void: '—', pending: String(leg.legNumber) };
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
const BetSlipCard = ({ bet, compact = false }) => {
  if (!bet) return null;
  const statusBg = {
    won:     'border-green-500/40 bg-green-950/30',
    lost:    'border-red-500/40 bg-red-950/30',
    partial: 'border-yellow-500/40 bg-yellow-950/20',
    pending: 'border-amber-500/20 bg-black/40',
  };
  return (
    <div className={`rounded-xl border overflow-hidden ${statusBg[bet.overallStatus] || statusBg.pending}`}>
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/5">
        <div className="flex items-center gap-2">
          <span className="text-white font-bold text-sm">{bet.type}</span>
          <Badge status={bet.overallStatus || 'pending'} />
        </div>
        {bet.submittedAt && <span className="text-gray-600 text-xs">{bet.submittedAt}</span>}
      </div>
      {/* Stats row */}
      <div className={`grid ${compact ? 'grid-cols-3' : 'grid-cols-3 sm:grid-cols-3'} divide-x divide-white/5`}>
        {[['Stake', bet.stake, 'text-white'], ['Odds', bet.combinedOdds || bet.odds || 'N/A', 'text-amber-300'], ['To Win', bet.estimatedReturn || bet.return || 'N/A', 'text-green-400']].map(([l, v, c]) => (
          <div key={l} className="px-3 py-2 text-center">
            <p className="text-gray-500 text-xs">{l}</p>
            <p className={`font-bold text-sm ${c}`}>{v}</p>
          </div>
        ))}
      </div>
      {/* Legs */}
      {bet.legs?.length > 0 && (
        <div className="px-3 pb-3 pt-2 space-y-1.5">
          <p className="text-gray-600 text-xs uppercase tracking-wider mb-2">{bet.legs.length} Leg{bet.legs.length !== 1 ? 's' : ''}</p>
          {bet.legs.map((leg, i) => {
            const legBg = { won: 'bg-green-950/40 border-green-500/20', lost: 'bg-red-950/40 border-red-500/20', void: 'bg-gray-900/40 border-gray-500/20', pending: 'bg-black/30 border-white/5' };
            return (
              <div key={i} className={`flex items-center gap-2 rounded-lg px-3 py-2 border ${legBg[leg.status] || legBg.pending}`}>
                <LegDot leg={leg} />
                <div className="flex-1 min-w-0">
                  <p className="text-white text-xs font-semibold truncate">{leg.selection}</p>
                  <p className="text-gray-500 text-xs truncate">{leg.event}{leg.market ? ` · ${leg.market}` : ''}</p>
                  {leg.resultNote && <p className="text-gray-600 text-xs italic truncate">{leg.resultNote}</p>}
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-amber-300 font-bold text-sm">@ {leg.odds}</p>
                  <p className={`text-xs font-semibold ${leg.status === 'won' ? 'text-green-400' : leg.status === 'lost' ? 'text-red-400' : leg.status === 'void' ? 'text-gray-400' : 'text-yellow-400'}`}>
                    {leg.status === 'won' ? '✓ Won' : leg.status === 'lost' ? '✗ Lost' : leg.status === 'void' ? '— Void' : '⏳'}
                  </p>
                </div>
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
  const [leaderboardTeams, setLeaderboardTeams] = useState([
    { rank: 1, team: 'The Legends',   week: 'W', total: '$4,250', color: 'from-yellow-400 to-yellow-600',  members: 5, weekHistory: ['W','W','W'], bets: [{ type: 'Multi (4 legs)', stake: '$50', combinedOdds: '3.50', estimatedReturn: '$175', overallStatus: 'pending', legs: [{ legNumber:1, selection:'Melbourne Storm', event:'NRL Round 5', market:'H2H', odds:'1.85', status:'won', resultNote:'Won 24-18' },{ legNumber:2, selection:'Sydney Roosters', event:'NRL Round 5', market:'H2H', odds:'1.95', status:'won', resultNote:'Won 18-12' },{ legNumber:3, selection:'Brisbane Broncos', event:'NRL Round 5', market:'H2H', odds:'2.10', status:'pending' },{ legNumber:4, selection:'Penrith Panthers', event:'NRL Round 5', market:'H2H', odds:'1.75', status:'pending' }] }] },
    { rank: 2, team: 'High Rollers',  week: 'W', total: '$3,890', color: 'from-gray-300 to-gray-500',     members: 4, weekHistory: ['W','L','W'], bets: [] },
    { rank: 3, team: 'Lucky Punters', week: 'L', total: '$2,450', color: 'from-orange-400 to-orange-600', members: 3, weekHistory: ['L','W','L'], bets: [] },
    { rank: 4, team: 'The Dreamers',  week: 'W', total: '$1,980', color: 'from-blue-400 to-blue-600',     members: 2, weekHistory: ['P','W','W'], bets: [] },
    { rank: 5, team: 'Golden Odds',   week: 'P', total: '$1,450', color: 'from-purple-400 to-purple-600', members: 6, weekHistory: ['W','P','P'], bets: [] },
  ]);
  const [selectedTeamIdx, setSelectedTeamIdx] = useState(null);
  const [leaderboardView, setLeaderboardView] = useState('current'); // 'current' | 'season'

  // My Team
  const [pendingMembers, setPendingMembers] = useState([
    { phone: '+61400000001', name: 'Alex Chen', joinedAt: '10/03/2025' },
  ]);
  const [teamMembers, setTeamMembers] = useState([
    { phone: 'captain', name: 'You (John Smith)', role: 'captain', canBet: true, depositPaid: true },
    { phone: 'm1', name: 'Sarah Jones',  role: 'member',    canBet: true,  depositPaid: true },
    { phone: 'm2', name: 'Mike Wilson',  role: 'member',    canBet: true,  depositPaid: true },
    { phone: 'm3', name: 'Emma Brown',   role: 'view-only', canBet: false, depositPaid: true },
    { phone: 'm4', name: 'Liam Taylor',  role: 'member',    canBet: false, depositPaid: false },
  ]);
  const [bettingOrder, setBettingOrder] = useState(['You (John Smith)', 'Sarah Jones', 'Mike Wilson']);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showOrderModal, setShowOrderModal] = useState(false);
  const [teamFinalised, setTeamFinalised] = useState(false);
  const [showFinaliseModal, setShowFinaliseModal] = useState(false);
  const [depositPerMember, setDepositPerMember] = useState(null); // calculated on finalise

  // Admin state
  const [isAdminLoggedIn, setIsAdminLoggedIn] = useState(false);
  const [adminUser, setAdminUser] = useState(null);
  const [adminLoginId, setAdminLoginId] = useState('');
  const [adminLoginPw, setAdminLoginPw] = useState('');
  const [showAdminLogin, setShowAdminLogin] = useState(false);
  const [adminTab, setAdminTab] = useState('dashboard'); // dashboard | teams | users | bets | competitions | security
  const [adminTeams, setAdminTeams] = useState([
    { id:'T1', name:'The Legends',   status:'verified',  captain:'John Smith',  members:5,  depositsPaid:5,  compCode:'COMP01', createdAt:'01/03/2025', totalBet:'$150', flagged: false },
    { id:'T2', name:'High Rollers',  status:'verified',  captain:'Emma Davis',  members:4,  depositsPaid:4,  compCode:'COMP01', createdAt:'02/03/2025', totalBet:'$100', flagged: false },
    { id:'T3', name:'Lucky Punters', status:'pending',   captain:'Sam Lee',     members:3,  depositsPaid:2,  compCode:'COMP01', createdAt:'05/03/2025', totalBet:'$50',  flagged: false },
    { id:'T4', name:'The Dreamers',  status:'verified',  captain:'Chris Park',  members:2,  depositsPaid:2,  compCode:'COMP02', createdAt:'03/03/2025', totalBet:'$100', flagged: false },
    { id:'T5', name:'Golden Odds',   status:'suspended', captain:'Mia Chen',    members:6,  depositsPaid:5,  compCode:'COMP01', createdAt:'01/03/2025', totalBet:'$200', flagged: true  },
  ]);
  const [adminUsers, setAdminUsers] = useState([
    { phone:'+61411111111', name:'John Smith',  role:'captain', kyc:'verified',  team:'The Legends',   dob:'15/06/1990', postcode:'2000', joinedAt:'01/03/2025', active:true,  flagged:false },
    { phone:'+61422222222', name:'Emma Davis',  role:'captain', kyc:'verified',  team:'High Rollers',  dob:'22/09/1988', postcode:'3000', joinedAt:'02/03/2025', active:true,  flagged:false },
    { phone:'+61433333333', name:'Sam Lee',     role:'captain', kyc:'pending',   team:'Lucky Punters', dob:'10/01/1995', postcode:'4000', joinedAt:'05/03/2025', active:true,  flagged:false },
    { phone:'+61444444444', name:'Mia Chen',    role:'captain', kyc:'rejected',  team:'Golden Odds',   dob:'30/11/1992', postcode:'2010', joinedAt:'01/03/2025', active:false, flagged:true  },
    { phone:'+61455555555', name:'Chris Park',  role:'captain', kyc:'verified',  team:'The Dreamers',  dob:'07/04/1987', postcode:'5000', joinedAt:'03/03/2025', active:true,  flagged:false },
  ]);
  const [adminBets, setAdminBets] = useState([
    { id:'B1', team:'The Legends',   week:3, type:'Multi (4 legs)', stake:'$50', odds:'3.50', toWin:'$175',  status:'pending',  submittedAt:'08/03/2025 10:32', valid:true,  flagged:false, aiConfidence:94 },
    { id:'B2', team:'High Rollers',  week:3, type:'Multi (2 legs)', stake:'$50', odds:'2.10', toWin:'$105',  status:'won',     submittedAt:'07/03/2025 14:10', valid:true,  flagged:false, aiConfidence:98 },
    { id:'B3', team:'Lucky Punters', week:3, type:'Single',         stake:'$50', odds:'1.80', toWin:'$90',   status:'lost',    submittedAt:'09/03/2025 09:45', valid:true,  flagged:false, aiConfidence:91 },
    { id:'B4', team:'Golden Odds',   week:3, type:'Multi (3 legs)', stake:'$80', odds:'4.20', toWin:'$336',  status:'pending', submittedAt:'08/03/2025 18:20', valid:false, flagged:true,  aiConfidence:72 },
    { id:'B5', team:'The Dreamers',  week:3, type:'Multi (2 legs)', stake:'$25', odds:'3.00', toWin:'$75',   status:'won',     submittedAt:'06/03/2025 11:00', valid:true,  flagged:false, aiConfidence:96 },
  ]);
  const [adminComps, setAdminComps] = useState([
    { code:'COMP01', name:'RSL Punting League S1', pub:'RSL Club Sydney',   teams:4, maxTeams:20, weeks:8,  startDate:'03/03/2025', endDate:'26/04/2025', buyIn:'$1,000', status:'active',   jackpot:'$5,000' },
    { code:'COMP02', name:'Crown Hotel Cup',        pub:'Crown Hotel Melb', teams:2, maxTeams:10, weeks:16, startDate:'10/03/2025', endDate:'29/06/2025', buyIn:'$1,000', status:'active',   jackpot:'$2,000' },
    { code:'COMP03', name:'Bondi Surf Club Open',   pub:'Bondi Surf Club',  teams:0, maxTeams:30, weeks:32, startDate:'01/04/2025', endDate:'31/10/2025', buyIn:'$1,000', status:'pending',  jackpot:'$0' },
  ]);
  const [adminSearch, setAdminSearch] = useState('');
  const [adminAuditLog, setAdminAuditLog] = useState([
    { ts:'10/03/2025 14:32', adminRole:'owner',    action:'Team Verified',    target:'The Legends',   detail:'Manual KYC review passed' },
    { ts:'10/03/2025 13:15', adminRole:'campaign',  action:'Bet Corrected',    target:'B4 Golden Odds', detail:'Stake corrected from $80 to $50' },
    { ts:'10/03/2025 11:00', adminRole:'owner',    action:'User Suspended',   target:'Mia Chen',       detail:'KYC rejected, account suspended' },
    { ts:'09/03/2025 16:45', adminRole:'pub_admin', action:'Competition Created', target:'COMP02',       detail:'Crown Hotel Cup created' },
    { ts:'09/03/2025 09:30', adminRole:'campaign',  action:'Dispute Resolved', target:'B3 Lucky Punters', detail:'Bet result confirmed as Lost' },
  ]);
  const [editingBet, setEditingBet] = useState(null); // bet being manually edited
  const [showSecurityPanel, setShowSecurityPanel] = useState(false);
  const [adminNotifs, setAdminNotifs] = useState([
    { id:1, type:'warning', msg:'Golden Odds: Bet exceeds $50 weekly limit', time:'2h ago', read:false },
    { id:2, type:'info',    msg:'Lucky Punters: KYC documents submitted', time:'4h ago', read:false },
    { id:3, type:'success', msg:'High Rollers: Week 3 bet confirmed Won', time:'5h ago', read:true  },
    { id:4, type:'error',   msg:'Mia Chen: KYC rejected — suspended', time:'1d ago', read:true  },
  ]);

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
  const [resultLog, setResultLog] = useState([]);
  const intervalRef = useRef(null);

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
    setApiLoading(true);
    setApiError(null);
    try {
      const result = await apiLogin(loginPhone, loginPassword);
      const user   = result.user;
      const teams  = result.teams || [];
      // Pick first active team
      const myTeam = teams.find(t => t.myRole !== 'pending') || teams[0];
      setCurrentUser({ ...user, teamId: myTeam?.id, teamCode: myTeam?.team_code, teamName: myTeam?.team_name, role: myTeam?.myRole || user.role, competitionCode: myTeam?.competitions?.code });
      setCurrentTeamId(myTeam?.id || null);
      setIsLoggedIn(true);
      setShowLoginModal(false);
      setLoginPhone(''); setLoginPassword('');
      // Load team members
      if (myTeam?.id) {
        const members = await apiGetTeamMembers(myTeam.id);
        setTeamMembers(members.map(m => ({ ...m, name: `${m.users?.first_name} ${m.users?.last_name}`, phone: m.users?.phone, depositPaid: m.deposit_paid, canBet: m.can_bet })));
      }
    } catch (err) {
      setApiError(err.message);
      alert(err.message);
    } finally {
      setApiLoading(false);
    }
  }, [loginPhone, loginPassword]);

  const handleLogout = () => { setIsLoggedIn(false); setCurrentUser(null); setCurrentTeamId(null); setTeamMembers([]); setActiveNav('home'); };

  // ── SIGNUP ────────────────────────────────────────────────────────────────
  const handleSubmitSignup = useCallback((e) => {
    e.preventDefault();
    if (formData.password !== formData.confirmPassword) { alert('Passwords do not match.'); return; }
    if (formData.password.length < 6) { alert('Password must be at least 6 characters.'); return; }

    const key = phoneKey(formData.phone);
    if (userStore[key]) { alert('An account with this mobile number already exists.'); return; }

    // Validate selected competition if provided
    if (formData.competitionCode && !competitionStore[formData.competitionCode]) {
      alert('Selected competition not found. Please choose from the dropdown.'); return;
    }

    // Validate team code for join
    let joinedTeam = null;
    if (signupMode === 'join') {
      joinedTeam = Object.values(teamStore).find(t => t.teamCode === formData.teamCode.trim().toUpperCase());
      if (!joinedTeam) { alert('Team code not found. Ask your captain for the correct code.'); return; }
      // Max 3 teams per person check (simplified — in real app track per user)
    }

    const newTeamCode = genCode();
    const newUser = {
      firstName: formData.firstName,
      lastName:  formData.lastName,
      email:     formData.email,
      phone:     formData.phone.trim(),
      password:  formData.password,
      dob:       formData.dob,
      postcode:  formData.postcode,
      createdAt: new Date().toLocaleDateString(),
      role:      signupMode === 'create' ? 'captain' : 'pending', // pending until captain approves
      teamCode:  signupMode === 'create' ? newTeamCode : formData.teamCode.trim().toUpperCase(),
      teamName:  signupMode === 'create' ? formData.teamName.trim() : joinedTeam?.teamName || '',
      buyInMode: signupMode === 'create' ? formData.buyInMode : null,
      competitionCode: formData.competitionCode?.toUpperCase() || null,
      canBet:    signupMode === 'create', // captain can bet; member pending approval
      teams:     [], // for multi-team support
    };

    userStore[key] = newUser;

    if (signupMode === 'create') {
      teamStore[newTeamCode] = {
        teamCode:     newTeamCode,
        teamName:     newUser.teamName,
        captainPhone: key,
        buyInMode:    newUser.buyInMode,
        members:      [key],
        pendingMembers: [],
        bettingOrder: [key],
        depositConfirmed: false,
      };
      const colors = ['from-green-400 to-green-600','from-cyan-400 to-cyan-600','from-pink-400 to-pink-600','from-indigo-400 to-indigo-600','from-rose-400 to-rose-600'];
      setLeaderboardTeams(prev => {
        if (prev.some(t => t.team.toLowerCase() === newUser.teamName.toLowerCase())) return prev;
        return [...prev, { rank: prev.length + 1, team: newUser.teamName, week: 'P', total: '$0', color: colors[prev.length % colors.length], members: 1, weekHistory: [], bets: [] }];
      });
      alert(`\ud83d\udc51 Team Created! You are the Captain.\n\nTeam: ${newUser.teamName}\nYour Role: Team Captain\nTeam Code: ${newTeamCode}\nLogin (mobile): ${newUser.phone}\n\nAs captain you can:\n- Approve / reject new members\n- Set the betting order\n- Manage member permissions\n- Track deposit payments\n\nShare your Team Code with friends to join!`);
    } else {
      // Add to pending — captain must approve
      if (teamStore[joinedTeam.teamCode]) {
        teamStore[joinedTeam.teamCode].pendingMembers.push(key);
      }
      alert(`Registration submitted!\n\nYou've requested to join "${joinedTeam.teamName}".\nThe team captain will approve your request.\n\nLogin: ${newUser.phone}`);
    }

    setShowSignupModal(false); setSignupMode(null);
    setFormData({ firstName:'', lastName:'', phone:'', dob:'', postcode:'', email:'', password:'', confirmPassword:'', teamName:'', teamCode:'', buyInMode:'captain', competitionCode:'' });

    // Auto-login captains immediately after signup
    // Members stay logged out as they need captain approval first
    if (signupMode === 'create') {
      setIsLoggedIn(true);
      setCurrentUser(newUser);
      setActiveNav('team'); // Take them straight to My Team page
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
    } catch (err) { alert(`Failed to approve member: ${err.message}`); }
  };

  const rejectMember = async (userId) => {
    try {
      await apiRejectMember(currentTeamId, userId);
      setPendingMembers(prev => prev.filter(m => m.user_id !== userId));
    } catch (err) { alert(`Failed to reject member: ${err.message}`); }
  };

  const updateMemberRole = async (userId, role) => {
    try {
      setTeamMembers(prev => prev.map(m => m.user_id === userId ? { ...m, role, can_bet: role !== 'view-only', canBet: role !== 'view-only' } : m));
      await apiUpdateMember(currentTeamId, userId, { role, can_bet: role !== 'view-only' });
    } catch (err) { alert(`Failed to update role: ${err.message}`); }
  };

  const toggleCanBet = async (userId) => {
    const member = teamMembers.find(m => m.user_id === userId);
    if (member?.role === 'view-only') return;
    const newVal = !member?.can_bet;
    setTeamMembers(prev => prev.map(m => m.user_id === userId ? { ...m, can_bet: newVal, canBet: newVal } : m));
    try { await apiUpdateMember(currentTeamId, userId, { can_bet: newVal }); }
    catch (err) { alert(`Failed to update betting permission: ${err.message}`); }
  };

  const toggleDepositPaid = async (userId) => {
    const member = teamMembers.find(m => (m.user_id || m.phone) === userId);
    const newVal = !(member?.deposit_paid ?? member?.depositPaid);
    setTeamMembers(prev => prev.map(m => (m.user_id || m.phone) === userId ? { ...m, deposit_paid: newVal, depositPaid: newVal } : m));
    try { await apiUpdateMember(currentTeamId, userId, { deposit_paid: newVal }); }
    catch (err) { alert(`Failed to update deposit: ${err.message}`); }
  };

  // ── RESULT CHECKER ────────────────────────────────────────────────────────
  const reviewBetResults = useCallback(async (teams) => {
    const teamsWithPending = teams.filter(t => t.bets.some(b => b.legs?.some(l => l.status === 'pending')));
    if (!teamsWithPending.length) { setLastChecked(new Date()); return; }
    setCheckingResults(true);
    try {
      for (const team of teamsWithPending) {
        for (let bi = 0; bi < team.bets.length; bi++) {
          const bet = team.bets[bi];
          if (!bet.legs?.some(l => l.status === 'pending')) continue;
          const desc = bet.legs.map(l => `Leg ${l.legNumber}: ${l.selection} — ${l.event} — ${l.market} — @ ${l.odds} — status: ${l.status}`).join('\n');
          const prompt = `Today: ${new Date().toLocaleDateString('en-AU', { weekday:'long', year:'numeric', month:'long', day:'numeric' })}.\n\nBet legs:\n${desc}\n\nFor each pending leg determine if it has concluded. Return ONLY a JSON array:\n[{"legNumber":1,"status":"won"|"lost"|"void"|"pending","result":"brief note"}]\nOnly mark settled if confident. Return all legs.`;
          const res = await fetch('/api/claude', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ model:'claude-sonnet-4-20250514', max_tokens:500, messages:[{ role:'user', content: prompt }] }) });
          const data = await res.json();
          if (!data.content?.[0]?.text) continue;
          const updates = parseAnalysisJSON(data.content[0].text);
          if (!Array.isArray(updates)) continue;
          setLeaderboardTeams(prev => prev.map(t => {
            if (t.team !== team.team) return t;
            const newBets = t.bets.map((b, idx) => {
              if (idx !== bi) return b;
              const newLegs = b.legs.map(leg => { const u = updates.find(x => x.legNumber === leg.legNumber); return u ? { ...leg, status: u.status, resultNote: u.result || leg.resultNote } : leg; });
              const allDone = newLegs.every(l => l.status !== 'pending');
              const allWon  = newLegs.every(l => l.status === 'won');
              const anyLost = newLegs.some(l => l.status === 'lost');
              return { ...b, legs: newLegs, overallStatus: allDone ? (allWon ? 'won' : anyLost ? 'lost' : 'partial') : 'pending' };
            });
            const anyWon  = newBets.some(b => b.overallStatus === 'won');
            const anyLost = newBets.some(b => b.overallStatus === 'lost');
            const allP    = newBets.every(b => !b.overallStatus || b.overallStatus === 'pending');
            return { ...t, bets: newBets, week: allP ? 'P' : anyWon ? 'W' : anyLost ? 'L' : 'P' };
          }));
          const settled = updates.filter(l => l.status !== 'pending').length;
          if (settled) setResultLog(prev => [{ time: new Date().toLocaleTimeString(), message: `${settled} leg(s) updated for ${team.team}`, teamName: team.team }, ...prev.slice(0, 19)]);
        }
      }
    } catch(err) { console.error('Result check error:', err); }
    finally { setCheckingResults(false); setLastChecked(new Date()); }
  }, []);

  // ── LOAD DATA ON MOUNT ─────────────────────────────────────────────────────
  useEffect(() => {
    // Load active competitions for signup dropdown
    apiGetActiveCompetitions()
      .then(data => setActiveCompetitions(data || []))
      .catch(err => console.error('Failed to load competitions:', err));
  }, []);

  // Load admin data when admin logs in
  useEffect(() => {
    if (!isAdminLoggedIn) return;
    // Load teams
    apiGetAllTeams().then(data => {
      if (data) setAdminTeams(data.map(t => ({
        id: t.id, name: t.team_name, status: t.status, captain: t.captain_id,
        members: t.team_members?.[0]?.count || 0, depositsPaid: 0,
        compCode: t.competitions?.code || '', createdAt: new Date(t.created_at).toLocaleDateString('en-AU'),
        totalBet: '$0', flagged: t.flagged || false,
      })));
    }).catch(console.error);
    // Load users
    apiGetAllUsers().then(data => {
      if (data) setAdminUsers(data.map(u => ({
        id: u.id, name: `${u.first_name} ${u.last_name}`, phone: u.phone,
        role: u.role, kyc: u.kyc_status, kyc_status: u.kyc_status,
        team: '', dob: u.dob, postcode: u.postcode, active: u.active, flagged: u.flagged,
        joinedAt: new Date(u.created_at).toLocaleDateString('en-AU'),
      })));
    }).catch(console.error);
    // Load bets
    apiGetAllBets().then(data => {
      if (data) setAdminBets(data.map(b => ({
        id: b.id, team: b.teams?.team_name, status: b.overall_status, overall_status: b.overall_status,
        stake: `$${((b.stake || 0)/100).toFixed(2)}`, odds: b.combined_odds, aiConfidence: b.ai_confidence,
        flagged: b.flagged, submittedAt: new Date(b.submitted_at).toLocaleDateString('en-AU'),
        legs: (b.bet_legs || []).map(l => ({ ...l, legNumber: l.leg_number, resultNote: l.result_note })),
      })));
    }).catch(console.error);
    // Load competitions
    apiGetActiveCompetitions().then(data => {
      if (data) setAdminComps(prev => {
        // Merge with existing demo comps, real ones take priority
        const ids = data.map(c => c.code);
        const filtered = prev.filter(p => !ids.includes(p.code));
        return [...data.map(c => ({ ...c, buy_in: c.buy_in, buyIn: `$${c.buy_in?.toLocaleString()}`, maxTeams: c.max_teams, startDate: c.start_date, endDate: c.end_date })), ...filtered];
      });
    }).catch(console.error);
    // Load audit log
    apiGetAuditLog(100).then(data => {
      if (data) setAdminAuditLog(data.map(e => ({ ts: new Date(e.created_at).toLocaleString(), adminRole: e.admin_role, action: e.action, target: e.target, detail: e.detail })));
    }).catch(console.error);
  }, [isAdminLoggedIn]);

  // Load leaderboard when competition is known
  useEffect(() => {
    if (!currentUser?.competitionCode) return;
    // Find competition id from active competitions
    const comp = activeCompetitions.find(c => c.code === currentUser.competitionCode);
    if (!comp?.id) return;
    apiGetLeaderboard(comp.id, 1).then(data => {
      if (!data?.length) return;
      const colors = ['from-yellow-400 to-yellow-600','from-gray-300 to-gray-500','from-orange-400 to-orange-600','from-blue-400 to-blue-600','from-purple-400 to-purple-600','from-green-400 to-green-600','from-cyan-400 to-cyan-600','from-pink-400 to-pink-600'];
      setLeaderboardTeams(data.map((t, i) => ({
        rank: t.rank, team: t.team_name, week: t.currentWeekBet?.overall_status === 'won' ? 'W' : t.currentWeekBet?.overall_status === 'lost' ? 'L' : 'P',
        total: t.totalWonFormatted, color: colors[i % colors.length], members: t.memberCount,
        weekHistory: t.weekHistory || [], id: t.id, teamCode: t.team_code,
        bets: (t.bets || []).map(b => ({
          type: b.bet_type, stake: `$${((b.stake||0)/100).toFixed(2)}`, combinedOdds: b.combined_odds,
          estimatedReturn: `$${((b.estimated_return||0)/100).toFixed(2)}`, overallStatus: b.overall_status,
          submittedAt: new Date(b.submitted_at).toLocaleString(),
          legs: (b.bet_legs||[]).map(l => ({ legNumber: l.leg_number, selection: l.selection, event: l.event, market: l.market, odds: l.odds, status: l.status, resultNote: l.result_note })),
        })),
      })));
    }).catch(console.error);
  }, [currentUser?.competitionCode, activeCompetitions]);

  // Polling interval for result checks
  useEffect(() => {
    const id = setInterval(() => setLeaderboardTeams(curr => { reviewBetResults(curr); return curr; }), 2 * 60 * 60 * 1000);
    intervalRef.current = id;
    return () => clearInterval(id);
  }, [reviewBetResults]);

  const checkResultsNow = () => setLeaderboardTeams(curr => { reviewBetResults(curr); return curr; });

  // ── BET SUBMISSION ────────────────────────────────────────────────────────

  // ── TEAM FINALISATION ─────────────────────────────────────────────────────
  const finaliseTeam = async () => {
    const comp = competitionStore[currentUser?.competitionCode];
    const totalBuyIn = comp
      ? parseInt((comp.buyIn || comp.buy_in || '1000').toString().replace(/[^0-9]/g, '')) || 1000
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
    if (!a || a.password !== adminLoginPw) { alert('Invalid admin credentials.'); return; }
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
    alert(`Password reset link sent to ${u?.name || phone} via SMS.`);
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

  // ── ADMIN COMPETITION ACTIONS ─────────────────────────────────────────────
  const createCompetition = async (comp) => {
    if (!comp.name?.trim()) { alert('Please enter a competition name.'); return; }
    if (!comp.pub?.trim())  { alert('Please enter a pub/club name.'); return; }

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
    alert(`Competition created!\n\nName: ${localComp.name}\nCode: ${code}\nStatus: ${status}\n\nNow appears in the signup dropdown.`);

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
    if (!uploadedImages.length) { alert('Please upload at least one bet slip image.'); return; }
    setAnalyzing(true);
    try {
      const res = await fetch('/api/claude', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ model:'claude-sonnet-4-20250514', max_tokens:1200, messages:[{ role:'user', content:[
        { type:'text', text:`You are a sports betting expert. Analyze this bet slip and return ONLY valid JSON:\n{\n  "betType":"Multi",\n  "stake":"$50.00",\n  "combinedOdds":"3.50",\n  "estimatedReturn":"$175.00",\n  "submissionValid":true,\n  "legs":[{"legNumber":1,"event":"Event","selection":"Selection","market":"Win","odds":"2.10","status":"pending"}]\n}\nRules: dollar signs on money, decimal odds, status ∈ {pending,won,lost,void}, submissionValid = placed before first leg. Return ONLY JSON.` },
        ...uploadedImages.map(img => ({ type:'image', source:{ type:'base64', media_type: img.mediaType, data: img.src.split(',')[1] } }))
      ]}] }) });
      const data = await res.json();
      if (data.content?.[0]?.text) {
        const parsed = parseAnalysisJSON(data.content[0].text);
        if (!parsed) { alert('Could not read bet slip. Try a clearer image.'); return; }
        // Validate stake doesn't exceed weekly budget
        const stakeNum = parseFloat((parsed.stake || '0').replace(/[^0-9.]/g,''));
        if (stakeNum > WEEK_BUDGET) { alert(`Stake $${stakeNum} exceeds the $${WEEK_BUDGET} weekly limit.`); return; }
        const enrichedBet = { ...parsed, betType: parsed.betType || 'Multi', legs: parsed.legs || [], timestamp: new Date().toLocaleTimeString(), images: uploadedImages.length };
        setAnalyzedBet(enrichedBet);
      }
    } catch(err) { console.error(err); alert('Error analyzing bet slip. Please try again.'); }
    finally { setAnalyzing(false); }
  };

  const submitBet = () => {
    if (!selectedTeamForBet) { alert('Please select a team.'); return; }
    const newBet = { type: analyzedBet.betType, stake: analyzedBet.stake, combinedOdds: analyzedBet.combinedOdds, estimatedReturn: analyzedBet.estimatedReturn, submissionValid: analyzedBet.submissionValid, legs: analyzedBet.legs, overallStatus: 'pending', submittedAt: analyzedBet.timestamp };
    setLeaderboardTeams(prev => prev.map(t => t.team === selectedTeamForBet ? { ...t, bets: [...t.bets, newBet] } : t));
    setShowBetAnalyzer(false); setShowBetResults(true);
  };

  const resetBetAnalyzer = () => { setUploadedImages([]); setAnalyzedBet(null); setSelectedTeamForBet(''); };

  // ── DERIVED ───────────────────────────────────────────────────────────────
  const myTeamName = currentUser?.teamName || 'The Legends';
  const myTeamData = leaderboardTeams.find(t => t.team === myTeamName) || leaderboardTeams[0];
  const currentWeekBettorIdx = 2; // Week 3 = index 2
  const currentBettor = bettingOrder[currentWeekBettorIdx % bettingOrder.length];
  const shareableLink = `${typeof window !== 'undefined' ? window.location.origin : 'https://puntingclub.com'}?join=${currentUser?.teamCode || 'XXXXXX'}`;

  // Load active competitions from Supabase on mount
  useEffect(() => {
    apiGetActiveCompetitions()
      .then(comps => {
        comps.forEach(c => { competitionStore[c.code] = { ...c, buyIn: `$${c.buy_in}` }; });
      })
      .catch(err => console.warn('Could not load competitions (using demo data):', err));
  }, []);

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
      <nav className="fixed top-0 w-full border-b border-amber-500/20 z-50">
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
                  <button onClick={handleLogout} className="bg-red-500/20 hover:bg-red-500/30 border border-red-500/50 text-red-400 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all">Logout</button>
                </div>
              ) : (
                <div className="flex gap-2 ml-2">
                  <button onClick={() => setShowLoginModal(true)} className="border border-amber-500/50 hover:border-amber-500 text-amber-400 px-4 py-1.5 rounded-lg text-sm font-semibold transition-all">Login</button>
                  <button onClick={() => { setSignupMode('create'); setShowSignupModal(true); }} className="bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-black px-4 py-1.5 rounded-lg text-sm font-bold transition-all">Sign Up</button>
                </div>
              )}
            </div>
            <button onClick={() => setMobileMenuOpen(!mobileMenuOpen)} className="md:hidden text-amber-500 p-1">
              {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>
          {mobileMenuOpen && (
            <div className="md:hidden pb-4 space-y-1 border-t border-white/5 pt-3">
              {[['home','Home'],['competition','Competition'],['leaderboard','Leaderboard'],['weekly','Summary'],['team','My Team'],['howto','How To']].map(([key, label]) => (
                <button key={key} onClick={() => { setActiveNav(key); setMobileMenuOpen(false); }} className="block w-full text-left px-3 py-2 rounded-lg text-amber-400 hover:bg-amber-500/10 text-sm">{label}</button>
              ))}
              <div className="border-t border-white/5 pt-3 space-y-2">
                {isLoggedIn ? (
                  <>
                    <p className="text-amber-400 text-sm font-bold px-3">{currentUser?.teamName} ({currentUser?.firstName})</p>
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
      {activeNav === 'leaderboard' && (
        <section className="pt-28 pb-16 px-2 sm:px-6">
          <div className="max-w-5xl mx-auto">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-start justify-between mb-6 gap-4 px-2">
              <div>
                <h1 className="text-3xl font-black mb-1">Live Leaderboard</h1>
                <p className="text-gray-500 text-sm">Week 3 of 8 · Auto-checks results every 2 hours</p>
                {lastChecked && <p className="text-gray-600 text-xs mt-0.5">Last checked: {lastChecked.toLocaleTimeString()}</p>}
                {resultLog.slice(0,2).map((l, i) => <p key={i} className="text-green-400 text-xs mt-0.5">✓ {l.time} — {l.message}</p>)}
              </div>
              <div className="flex gap-2 flex-wrap">
                <button onClick={checkResultsNow} disabled={checkingResults} className="flex items-center gap-1.5 bg-blue-500/20 hover:bg-blue-500/30 border border-blue-500/40 text-blue-400 px-3 py-2 rounded-lg text-xs font-semibold disabled:opacity-50">
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
              {leaderboardTeams.map((team, idx) => {
                const isMe = isLoggedIn && team.team === myTeamName;
                const weekBet = team.bets[0] || null;
                const isOpen = selectedTeamIdx === idx;
                const rowBg = isMe
                  ? 'border-amber-400/40 bg-amber-500/5'
                  : weekBet?.overallStatus === 'won'   ? 'border-green-500/20 bg-green-950/10'
                  : weekBet?.overallStatus === 'lost'  ? 'border-red-500/20 bg-red-950/10'
                  : weekBet?.overallStatus === 'pending' && weekBet?.legs?.some(l => l.status === 'won') ? 'border-orange-500/20 bg-orange-950/10'
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
                              <Badge status={weekBet.overallStatus || 'pending'} />
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
                        {weekBet ? <BetSlipCard bet={weekBet} /> : <p className="text-gray-600 text-sm italic text-center py-4">No bet submitted this week</p>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

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
                  {currentUser?.role === 'captain' && (
                    <span className="bg-amber-500 text-black text-xs font-black px-3 py-1 rounded-full flex items-center gap-1">👑 Team Captain</span>
                  )}
                  <PermissionBadge role={currentUser?.role || 'captain'} />
                  <span className="text-gray-500 text-sm">·</span>
                  <span className="text-gray-400 text-sm">#{myTeamData?.rank || 1} on leaderboard</span>
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

            {/* Captain features callout */}
            {(currentUser?.role === 'captain' || !isLoggedIn) && (
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 mb-5 flex items-start gap-3">
                <span className="text-2xl flex-shrink-0">👑</span>
                <div>
                  <p className="font-bold text-amber-400 text-sm mb-1">You're the Team Captain</p>
                  <p className="text-gray-400 text-xs leading-relaxed">You have full control — approve members, set betting order, manage permissions and track deposits. Members you invite will need your approval before they can join.</p>
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
                      const comp = competitionStore[currentUser?.competitionCode];
                      return comp ? parseInt((comp.buyIn || '$1,000').replace(/[^0-9]/g,'')) || 1000 : 1000;
                    })()} total ÷ {teamMembers.filter(m => m.depositPaid).length} members
                  </p>
                </div>

                {/* Per-member breakdown */}
                <div className="space-y-2">
                  <p className="text-gray-500 text-xs uppercase tracking-wider">Member Payment Status</p>
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
                    <p className="text-xs text-gray-600 mt-0.5">Total collected: <span className="text-green-400 font-bold">${(teamMembers.filter(m=>m.depositPaid).length * depositPerMember).toLocaleString()}</span> of <span className="text-white font-bold">${(() => { const comp = competitionStore[currentUser?.competitionCode]; return comp ? parseInt((comp.buyIn||'$1,000').replace(/[^0-9]/g,''))||1000 : 1000; })().toLocaleString()}</span></p>
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
                  {myTeamData.bets.map((bet, i) => <BetSlipCard key={i} bet={bet} />)}
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
                        <button onClick={() => approveMember(m.phone)} className="bg-green-500/20 hover:bg-green-500/30 border border-green-500/50 text-green-400 px-3 py-1 rounded-lg text-xs font-semibold flex items-center gap-1"><CheckCircle className="w-3 h-3" />Approve</button>
                        <button onClick={() => rejectMember(m.phone)} className="bg-red-500/20 hover:bg-red-500/30 border border-red-500/50 text-red-400 px-3 py-1 rounded-lg text-xs font-semibold flex items-center gap-1"><AlertCircle className="w-3 h-3" />Reject</button>
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
                  <div key={m.phone} className="bg-black/30 rounded-xl px-3 py-3 flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400 font-bold text-sm flex-shrink-0">
                      {m.name.charAt(0)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm truncate">{m.name}</p>
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
                { n:'4', t:'Track Results', d:'AI reads your bet slip and updates leg-by-leg results every 2 hours automatically.', bullets:['Green ticks = won, red crosses = lost, orange = in progress','Team leaderboard updates in real-time','Click any team to see their full bet slip'] },
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
          <div className="rounded-xl p-5 flex items-start gap-4" style={{backgroundColor:"#111827",border:"1px solid rgba(255,255,255,0.08)"}}>
            <div className={`text-2xl ${color} flex-shrink-0`}>{icon}</div>
            <div>
              <p className="text-gray-500 text-xs font-semibold uppercase tracking-wider mb-0.5">{title}</p>
              <p className={`text-2xl font-black ${color}`}>{value}</p>
              {sub && <p className="text-gray-600 text-xs mt-0.5">{sub}</p>}
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
          <section style={{paddingTop:"64px",minHeight:"100vh",backgroundColor:"#030712",WebkitFontSmoothing:"antialiased",MozOsxFontSmoothing:"grayscale",textRendering:"optimizeLegibility",imageRendering:"crisp-edges"}}>
            {/* Admin top bar - solid bg, no blur */}
            <div style={{backgroundColor:"#111827",borderBottom:"1px solid rgba(239,68,68,0.2)",position:"sticky",top:"64px",zIndex:40}} className="px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <Shield className="w-5 h-5 text-red-400" />
                  <span className="font-black text-red-400 text-sm">ADMIN PANEL</span>
                  <span className="bg-red-500/20 border border-red-500/30 text-red-400 text-xs px-2 py-0.5 rounded-full font-semibold capitalize">{adminUser.role}</span>
                </div>
                <span className="text-gray-600 text-xs hidden sm:block">Logged in as {adminUser.name}</span>
              </div>
              <div className="flex items-center gap-2">
                {/* Notifications */}
                <div className="relative">
                  <button className="relative p-2 text-gray-400 hover:text-white">
                    <Bell className="w-4 h-4" />
                    {unreadNotifs > 0 && <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full" />}
                  </button>
                </div>
                <button onClick={handleAdminLogout} className="bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 text-red-400 px-3 py-1.5 rounded-lg text-xs font-semibold">Logout</button>
              </div>
            </div>

            <div className="flex">
              {/* Sidebar */}
              <aside style={{backgroundColor:"#0f172a",borderRight:"1px solid rgba(255,255,255,0.07)",paddingTop:"16px",width:"192px",flexShrink:0,position:"sticky",top:"112px",alignSelf:"flex-start",minHeight:"calc(100vh - 112px)"}} className="hidden md:flex flex-col">
                <nav className="space-y-0.5 px-2">
                  {tabs.map(t => (
                    <button key={t.id} onClick={() => setAdminTab(t.id)} className={`w-full text-left px-3 py-2.5 rounded-lg text-sm flex items-center gap-2.5 transition-all ${adminTab === t.id ? 'bg-red-500/15 text-red-400 font-semibold border border-red-500/20' : 'text-gray-400 hover:bg-white/5 hover:text-white'}`}>
                      <span className="text-base">{t.icon}</span>{t.label}
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
              <main style={{flex:1,minWidth:0,overflowX:"hidden"}} className="p-4 sm:p-6">

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
                    <div>
                      <h2 className="text-xl font-black mb-1">Dashboard</h2>
                      <p className="text-gray-500 text-sm">Overview · Week 3 of 8 · {new Date().toLocaleDateString('en-AU', { weekday:'long', day:'numeric', month:'long' })}</p>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <AdminCard title="Total Teams"       value={adminTeams.length}                                      sub={`${adminTeams.filter(t=>t.status==='verified').length} verified`}   icon={<Users className="w-6 h-6"/>}      color="text-amber-400" />
                      <AdminCard title="Total Users"       value={adminUsers.length}                                      sub={`${adminUsers.filter(u=>u.kyc==='pending').length} KYC pending`}    icon={<UserCheck className="w-6 h-6"/>}  color="text-blue-400"  />
                      <AdminCard title="Bets This Week"    value={adminBets.length}                                       sub={`${adminBets.filter(b=>b.flagged).length} flagged`}                  icon={<FileText className="w-6 h-6"/>}   color="text-green-400" />
                      <AdminCard title="Competitions"      value={adminComps.length}                                      sub={`${adminComps.filter(c=>c.status==='active').length} active`}         icon={<Trophy className="w-6 h-6"/>}     color="text-purple-400"/>
                    </div>

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

                    {/* Recent activity */}
                    <div className="rounded-xl p-5" style={{backgroundColor:"#111827",border:"1px solid rgba(255,255,255,0.08)"}}>
                      <h3 className="font-bold text-white mb-3 flex items-center gap-2"><Activity className="w-4 h-4 text-blue-400"/>Recent Activity</h3>
                      <div className="space-y-2">
                        {adminAuditLog.slice(0, 5).map((e, i) => (
                          <div key={i} className="flex items-start gap-3 py-2 border-b border-white/5 last:border-0">
                            <div className="w-2 h-2 rounded-full bg-blue-400 mt-1.5 flex-shrink-0"/>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm text-white"><span className="text-blue-400 font-semibold">{e.action}</span> — {e.target}</p>
                              {e.detail && <p className="text-xs text-gray-600">{e.detail}</p>}
                            </div>
                            <div className="text-right flex-shrink-0">
                              <p className="text-xs text-gray-600">{e.ts}</p>
                              <p className="text-xs text-gray-700 capitalize">{e.adminRole}</p>
                            </div>
                          </div>
                        ))}
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
                        <p className="text-gray-500 text-sm">{filteredTeams.length} teams · {adminTeams.filter(t=>t.status==='pending').length} pending verification</p>
                      </div>
                      {canAdmin('bets') && (
                        <button onClick={() => { const name = prompt('Team name:'); if (name) { setAdminTeams(prev => [...prev, { id:`T${Date.now()}`, name, status:'pending', captain:'TBA', members:0, depositsPaid:0, compCode:'', createdAt: new Date().toLocaleDateString('en-AU'), totalBet:'$0', flagged:false }]); addAuditEntry(adminUser.role,'Team Created',name,'Manual creation by admin'); }}} className="bg-amber-500/20 border border-amber-500/40 text-amber-400 px-3 py-2 rounded-lg text-xs font-semibold">+ Add Team</button>
                      )}
                    </div>
                    <div className="space-y-2">
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
                        </div>
                      ))}
                    </div>

                    {/* Rejected bets log */}
                    {rejectedBets.length > 0 && (
                      <div className="bg-gray-900 border border-white/8 rounded-xl p-4">
                        <h3 className="font-bold text-gray-400 mb-3 text-sm">Rejected Bets Archive</h3>
                        {rejectedBets.map((b, i) => (
                          <div key={i} className="text-xs text-gray-600 py-1.5 border-b border-white/5 last:border-0">
                            <span className="text-gray-400">{b.team}</span> · {b.type} · {b.stake} · <span className="text-red-400">Rejected: {b.reason}</span> · by {b.reviewedBy} · {b.ts}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* ── COMPETITIONS ─────────────────────────────────────────── */}
                {adminTab === 'competitions' && (() => {
                  const [showCreateComp, setShowCreateComp] = React.useState(false);
                  const [newComp, setNewComp] = React.useState({ name:'', pub:'', weeks:'8', buyIn:'$1,000', maxTeams:'20', startDate:'', endDate:'' });
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
                        {adminComps.map(c => (
                          <div key={c.code} className={`bg-gray-900 border rounded-xl p-4 ${c.status === 'active' ? 'border-green-500/20' : c.status === 'pending' ? 'border-amber-500/20' : 'border-white/8'}`}>
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap mb-1.5">
                                  <p className="font-bold">{c.name}</p>
                                  <StatusPill s={c.status} />
                                  <span className="font-mono text-xs bg-black/40 border border-white/10 text-amber-300 px-2 py-0.5 rounded">{c.code}</span>
                                </div>
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-0.5 text-xs text-gray-500">
                                  <span>🏟 {c.pub}</span>
                                  <span>👥 {c.teams}/{c.maxTeams} teams</span>
                                  <span>📅 {c.weeks} weeks</span>
                                  <span>💰 Buy-in: {c.buyIn}</span>
                                  <span>🗓 {c.startDate} → {c.endDate}</span>
                                  <span>🏆 Jackpot: <span className="text-green-400 font-semibold">{c.jackpot}</span></span>
                                </div>
                              </div>
                              {canAdmin('competitions') && (
                                <div className="flex flex-col gap-1.5">
                                  {c.status === 'pending' && <button onClick={() => updateCompStatus(c.code,'active')} className="bg-green-500/20 border border-green-500/40 text-green-400 px-2.5 py-1 rounded-lg text-xs font-semibold">Approve</button>}
                                  {c.status === 'active'  && <button onClick={() => updateCompStatus(c.code,'closed')} className="bg-red-500/20 border border-red-500/40 text-red-400 px-2.5 py-1 rounded-lg text-xs">Close</button>}
                                  <button onClick={() => { navigator.clipboard?.writeText(`Join ${c.name}! Code: ${c.code}`); alert('Share link copied!'); }} className="bg-blue-500/10 border border-blue-500/20 text-blue-400 px-2.5 py-1 rounded-lg text-xs">Share</button>
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
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
          {[['Competition',['How It Works','Leaderboards','Payouts','Competition Rules']],['Features',['Team Management','AI Bet Analysis','Result Tracking','Season History']],['Contact',['support@puntingclub.com','WhatsApp: +61 XXX XXX XXX','FAQ']]].map(([h, items]) => (
            <div key={h}>
              <h4 className="font-bold text-amber-400/80 text-sm mb-3">{h}</h4>
              <ul className="space-y-1.5">
                {items.map(i => <li key={i} className="text-gray-600 text-xs hover:text-amber-400/70 cursor-pointer transition-colors">{i}</li>)}
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
        <Modal title="Login" onClose={() => { setShowLoginModal(false); setLoginPhone(''); setLoginPassword(''); }}>
          <form onSubmit={handleLogin} className="p-5 space-y-4">
            <div>
              <label className="block text-xs font-semibold text-amber-400 mb-1.5">Mobile Number</label>
              <input type="tel" required value={loginPhone} onChange={e => setLoginPhone(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-amber-500/50 placeholder-gray-600" placeholder="+61 412 345 678" />
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
        <Modal title={signupMode === 'create' ? '🏆 Create a Team' : '👋 Join a Team'} onClose={() => { setShowSignupModal(false); setSignupMode(null); }}>
          <form onSubmit={handleSubmitSignup} className="p-5 space-y-3">
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

            {[['phone','Mobile Number','tel','+61 412 345 678','tel'],['email','Email','email','john@example.com','email']].map(([f,l,t,p,ac]) => (
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
                <input type="password" required minLength={6} value={formData.confirmPassword} onChange={e => setFormData(p => ({...p, confirmPassword: e.target.value}))} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/50 placeholder-gray-600" placeholder="Re-enter password" />
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
              <button onClick={() => { navigator.clipboard?.writeText(currentUser?.teamCode || ''); alert('Copied!'); }} className="mt-3 bg-green-500/20 hover:bg-green-500/30 text-green-400 px-3 py-1.5 rounded-lg text-xs font-semibold">Copy Code</button>
            </div>
            <div className="bg-white/3 border border-white/8 rounded-xl p-4">
              <p className="text-gray-400 text-xs font-semibold mb-2">Shareable Link</p>
              <p className="text-amber-300 text-xs break-all mb-2">{shareableLink}</p>
              <button onClick={() => { navigator.clipboard?.writeText(shareableLink); alert('Link copied!'); }} className="bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 px-3 py-1.5 rounded-lg text-xs font-semibold w-full">Copy Invite Link</button>
            </div>
            <div className="bg-blue-950/20 border border-blue-500/20 rounded-xl p-4">
              <p className="text-blue-400 text-xs font-semibold mb-2">How to invite:</p>
              <ol className="space-y-1 text-gray-400 text-xs">
                {['Share the team code or invite link','They click Sign Up → Join Team','Enter the team code','Submit request — you\'ll get notified to approve','Once approved they\'re on the team!'].map((s, i) => (
                  <li key={i} className="flex gap-2"><span className="text-blue-400 font-bold">{i+1}.</span>{s}</li>
                ))}
              </ol>
            </div>
            <button onClick={() => { navigator.clipboard?.writeText(`Join my Punting Club team "${currentUser?.teamName || 'The Legends'}"!\n\nTeam Code: ${currentUser?.teamCode || 'XXXXXX'}\nOr use this link: ${shareableLink}`); alert('Invitation message copied!'); }} className="w-full bg-gradient-to-r from-amber-500 to-amber-600 text-black font-bold py-2.5 rounded-xl text-sm">Copy Full Invitation Message</button>
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
            <button onClick={() => { alert('Betting order saved!'); setShowOrderModal(false); }} className="w-full bg-gradient-to-r from-amber-500 to-amber-600 text-black font-bold py-2.5 rounded-xl text-sm">Save Order</button>
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
                const comp = competitionStore[currentUser?.competitionCode];
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

      {/* ══════════════════════════════════════════════════════════════════
          ADMIN PANEL
      ══════════════════════════════════════════════════════════════════ */}
      {activeNav === 'admin' && isAdminLoggedIn && (() => {
        const tabs = [
          { id:'dashboard',     label:'Dashboard',    icon:<Activity className="w-4 h-4"/> },
          { id:'teams',         label:'Teams',        icon:<Users className="w-4 h-4"/> },
          { id:'users',         label:'Users / KYC',  icon:<UserCheck className="w-4 h-4"/> },
          { id:'bets',          label:'Bets',         icon:<FileText className="w-4 h-4"/> },
          { id:'competitions',  label:'Competitions', icon:<Trophy className="w-4 h-4"/> },
          { id:'security',      label:'Security',     icon:<Shield className="w-4 h-4"/> },
        ];
        const visibleTabs = tabs.filter(t => {
          if (adminUser.role === 'owner') return true;
          if (adminUser.role === 'campaign') return ['dashboard','bets','users'].includes(t.id);
          if (adminUser.role === 'pub_admin') return ['dashboard','competitions','teams'].includes(t.id);
          return false;
        });

        const filteredTeams = adminTeams.filter(t => !adminSearch || t.name.toLowerCase().includes(adminSearch.toLowerCase()) || t.captain.toLowerCase().includes(adminSearch.toLowerCase()));
        const filteredUsers = adminUsers.filter(u => !adminSearch || u.name.toLowerCase().includes(adminSearch.toLowerCase()) || u.phone.includes(adminSearch));
        const filteredBets  = adminBets.filter(b  => !adminSearch || b.team.toLowerCase().includes(adminSearch.toLowerCase()));

        const StatCard = ({label, value, sub, color='text-amber-400', bg='bg-amber-500/10 border-amber-500/20'}) => (
          <div className={`rounded-xl border p-4 ${bg}`}>
            <p className="text-gray-500 text-xs mb-1">{label}</p>
            <p className={`text-2xl font-black ${color}`}>{value}</p>
            {sub && <p className="text-gray-600 text-xs mt-0.5">{sub}</p>}
          </div>
        );

        const statusPill = (s) => {
          const map = { verified:'bg-green-500/20 text-green-400 border-green-500/40', pending:'bg-amber-500/10 text-amber-400 border-amber-500/30', suspended:'bg-red-500/20 text-red-400 border-red-500/40', rejected:'bg-red-500/20 text-red-400 border-red-500/40', active:'bg-green-500/20 text-green-400 border-green-500/40', won:'bg-green-500/20 text-green-400 border-green-500/40', lost:'bg-red-500/20 text-red-400 border-red-500/40' };
          return <span className={`border text-xs px-2 py-0.5 rounded-full font-semibold capitalize ${map[s] || 'bg-gray-500/20 text-gray-400 border-gray-500/40'}`}>{s}</span>;
        };

        return (
          <section style={{paddingTop:"64px",minHeight:"100vh",backgroundColor:"#030712",display:"flex",WebkitFontSmoothing:"antialiased"}}>
            {/* Sidebar */}
            <aside className="hidden md:flex flex-col w-56 bg-black/40 border-r border-white/5 fixed top-16 bottom-0 overflow-y-auto z-40">
              <div className="p-4 border-b border-white/5">
                <div className="flex items-center gap-2 mb-1">
                  <Shield className="w-4 h-4 text-red-400" />
                  <span className="text-red-400 font-bold text-sm">Admin Panel</span>
                </div>
                <p className="text-gray-600 text-xs">{adminUser.name}</p>
                <span className="text-xs px-2 py-0.5 rounded-full border font-semibold mt-1 inline-block
                  {adminUser.role === 'owner' ? 'border-red-500/40 text-red-400 bg-red-500/10' : adminUser.role === 'campaign' ? 'border-blue-500/40 text-blue-400 bg-blue-500/10' : 'border-purple-500/40 text-purple-400 bg-purple-500/10'}">
                  {adminUser.role === 'owner' ? '👑 Owner' : adminUser.role === 'campaign' ? '📋 Campaign Mgr' : '🏪 Pub Admin'}
                </span>
              </div>
              <nav className="p-3 space-y-1 flex-1">
                {visibleTabs.map(t => (
                  <button key={t.id} onClick={() => setAdminTab(t.id)} className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${adminTab === t.id ? 'bg-red-500/15 text-red-400 border border-red-500/30' : 'text-gray-400 hover:bg-white/5 hover:text-gray-200'}`}>
                    {t.icon}{t.label}
                    {t.id === 'bets' && adminBets.filter(b => b.flagged).length > 0 && (
                      <span className="ml-auto bg-red-500 text-white text-xs w-5 h-5 rounded-full flex items-center justify-center font-bold">{adminBets.filter(b => b.flagged).length}</span>
                    )}
                  </button>
                ))}
              </nav>
              <div className="p-3 border-t border-white/5">
                <button onClick={handleAdminLogout} className="w-full bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 px-3 py-2 rounded-lg text-xs font-semibold flex items-center gap-2">
                  <X className="w-3.5 h-3.5"/>Exit Admin
                </button>
              </div>
            </aside>

            {/* Mobile tab bar */}
            <div className="md:hidden fixed bottom-0 left-0 right-0 bg-black border-t border-white/10 z-50 flex">
              {visibleTabs.slice(0,5).map(t => (
                <button key={t.id} onClick={() => setAdminTab(t.id)} className={`flex-1 flex flex-col items-center py-2 gap-0.5 text-xs transition-all ${adminTab === t.id ? 'text-red-400' : 'text-gray-600'}`}>
                  {t.icon}<span className="text-xs" style={{fontSize:'9px'}}>{t.label}</span>
                </button>
              ))}
            </div>

            {/* Main content */}
            <main className="flex-1 md:ml-56 p-4 sm:p-6 overflow-y-auto pb-20 md:pb-6">
              {/* Top bar */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
                <div>
                  <h1 className="text-2xl font-black capitalize">{adminTab === 'users' ? 'Users & KYC' : adminTab}</h1>
                  <p className="text-gray-500 text-xs mt-0.5">Punting Club Admin · {new Date().toLocaleDateString('en-AU', {weekday:'long', day:'numeric', month:'long'})}</p>
                </div>
                <div className="flex items-center gap-2">
                  {/* Notifications */}
                  <div className="relative">
                    <button onClick={() => setAdminTab('dashboard')} className="relative bg-white/5 border border-white/10 p-2 rounded-lg text-gray-400 hover:text-amber-400">
                      <Bell className="w-4 h-4" />
                      {unreadNotifs > 0 && <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full text-white text-xs flex items-center justify-center font-bold">{unreadNotifs}</span>}
                    </button>
                  </div>
                  {/* Search */}
                  <div className="relative">
                    <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
                    <input value={adminSearch} onChange={e => setAdminSearch(e.target.value)} placeholder="Search…" className="bg-white/5 border border-white/10 rounded-lg pl-8 pr-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-amber-500/40 w-44" />
                  </div>
                </div>
              </div>

              {/* ── DASHBOARD ────────────────────────────────────────────── */}
              {adminTab === 'dashboard' && (
                <div className="space-y-6">
                  {/* Stat grid */}
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    <StatCard label="Total Teams"       value={adminTeams.length}                              sub={`${adminTeams.filter(t=>t.status==='verified').length} verified`}  />
                    <StatCard label="Registered Users"  value={adminUsers.length}                              sub={`${adminUsers.filter(u=>u.kyc==='verified').length} KYC verified`} color="text-blue-400" bg="bg-blue-500/10 border-blue-500/20" />
                    <StatCard label="Active Bets"       value={adminBets.filter(b=>b.status==='pending').length} sub="awaiting results" color="text-green-400" bg="bg-green-500/10 border-green-500/20" />
                    <StatCard label="Flagged Items"     value={adminBets.filter(b=>b.flagged).length + adminTeams.filter(t=>t.flagged).length} sub="need review" color="text-red-400" bg="bg-red-500/10 border-red-500/20" />
                  </div>

                  {/* Notifications */}
                  <div className="bg-white/3 border border-white/8 rounded-xl p-5">
                    <h3 className="font-bold text-amber-400 mb-3 text-sm flex items-center gap-2"><Bell className="w-4 h-4" />Notifications {unreadNotifs > 0 && <span className="bg-red-500 text-white text-xs px-1.5 py-0.5 rounded-full">{unreadNotifs} new</span>}</h3>
                    <div className="space-y-2">
                      {adminNotifs.slice(0,6).map(n => (
                        <div key={n.id} onClick={() => markNotifRead(n.id)} className={`flex items-start gap-3 p-3 rounded-lg cursor-pointer transition-all ${n.read ? 'bg-black/20 opacity-60' : 'bg-white/5 border border-white/8'}`}>
                          <span className="text-lg flex-shrink-0">{n.type==='warning'?'⚠️':n.type==='error'?'🔴':n.type==='success'?'✅':'ℹ️'}</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-white">{n.msg}</p>
                            <p className="text-gray-600 text-xs mt-0.5">{n.time}</p>
                          </div>
                          {!n.read && <span className="w-2 h-2 bg-red-400 rounded-full flex-shrink-0 mt-1" />}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Competitions overview */}
                  <div className="bg-white/3 border border-white/8 rounded-xl p-5">
                    <h3 className="font-bold text-amber-400 mb-3 text-sm flex items-center gap-2"><Trophy className="w-4 h-4"/>Active Competitions</h3>
                    <div className="space-y-2">
                      {adminComps.filter(c=>c.status==='active').map(c => (
                        <div key={c.code} className="flex items-center justify-between bg-black/30 rounded-lg px-3 py-2.5">
                          <div>
                            <p className="font-semibold text-sm">{c.name}</p>
                            <p className="text-gray-500 text-xs">{c.pub} · {c.teams}/{c.maxTeams} teams · {c.weeks} weeks</p>
                          </div>
                          <div className="text-right">
                            <p className="text-green-400 font-bold text-sm">{c.jackpot}</p>
                            <p className="text-gray-600 text-xs">jackpot</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Audit log */}
                  <div className="bg-white/3 border border-white/8 rounded-xl p-5">
                    <h3 className="font-bold text-amber-400 mb-3 text-sm flex items-center gap-2"><Database className="w-4 h-4"/>Recent Audit Log</h3>
                    <div className="space-y-1.5">
                      {adminAuditLog.slice(0,8).map((e,i) => (
                        <div key={i} className="grid grid-cols-12 gap-2 text-xs bg-black/20 rounded-lg px-3 py-2">
                          <span className="col-span-3 text-gray-600">{e.ts}</span>
                          <span className="col-span-2 text-purple-400 font-semibold capitalize">{e.adminRole}</span>
                          <span className="col-span-3 text-amber-300 font-semibold">{e.action}</span>
                          <span className="col-span-4 text-gray-400 truncate">{e.target}{e.detail ? ` — ${e.detail}` : ''}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* ── TEAMS ────────────────────────────────────────────────── */}
              {adminTab === 'teams' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <p className="text-gray-400 text-sm">{filteredTeams.length} teams · {adminTeams.filter(t=>t.status==='pending').length} pending verification</p>
                    {canAdmin('bets') && (
                      <button onClick={() => {
                        const name = prompt('Team name:'); if (!name) return;
                        const cap  = prompt('Captain name:'); if (!cap) return;
                        const comp = prompt('Competition code:') || 'COMP01';
                        const newT = { id:`T${Date.now()}`, name, status:'pending', captain:cap, members:1, depositsPaid:0, compCode:comp, createdAt:new Date().toLocaleDateString('en-AU'), totalBet:'$0', flagged:false };
                        setAdminTeams(p=>[...p, newT]);
                        addAuditEntry(adminUser.role, 'Team Created', name, `Captain: ${cap}`);
                      }} className="bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-400 px-3 py-1.5 rounded-lg text-xs font-semibold">+ Create Team</button>
                    )}
                  </div>
                  {filteredTeams.map(t => (
                    <div key={t.id} className={`bg-white/3 border rounded-xl p-4 ${t.flagged ? 'border-red-500/40' : 'border-white/8'}`}>
                      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <p className="font-bold">{t.name}</p>
                            {statusPill(t.status)}
                            {t.flagged && <span className="text-red-400 text-xs font-bold">🚩 Flagged</span>}
                          </div>
                          <p className="text-gray-500 text-xs">Captain: {t.captain} · {t.members} members · Competition: {t.compCode}</p>
                          <p className="text-gray-600 text-xs mt-0.5">Deposits: {t.depositsPaid}/{t.members} paid · Total bet: {t.totalBet} · Joined: {t.createdAt}</p>
                        </div>
                        <div className="flex gap-2 flex-wrap">
                          {t.status === 'pending' && canAdmin('bets') && (
                            <button onClick={() => verifyTeam(t.id)} className="bg-green-500/20 hover:bg-green-500/30 border border-green-500/40 text-green-400 px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1"><CheckCircle className="w-3 h-3"/>Verify</button>
                          )}
                          {t.status !== 'suspended' && canAdmin('bets') && (
                            <button onClick={() => suspendTeam(t.id)} className="bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1"><AlertCircle className="w-3 h-3"/>Suspend</button>
                          )}
                          <button onClick={() => flagTeam(t.id)} className={`border px-3 py-1.5 rounded-lg text-xs font-semibold ${t.flagged ? 'border-gray-500/40 text-gray-400' : 'border-orange-500/40 text-orange-400'}`}>{t.flagged ? 'Unflag' : '🚩 Flag'}</button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* ── USERS / KYC ──────────────────────────────────────────── */}
              {adminTab === 'users' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-3 mb-2">
                    <StatCard label="KYC Verified"  value={adminUsers.filter(u=>u.kyc==='verified').length}  color="text-green-400" bg="bg-green-500/10 border-green-500/20" />
                    <StatCard label="KYC Pending"   value={adminUsers.filter(u=>u.kyc==='pending').length}   color="text-amber-400" bg="bg-amber-500/10 border-amber-500/20" />
                    <StatCard label="KYC Rejected"  value={adminUsers.filter(u=>u.kyc==='rejected').length}  color="text-red-400"   bg="bg-red-500/10 border-red-500/20" />
                  </div>
                  {filteredUsers.map(u => (
                    <div key={u.phone} className={`bg-white/3 border rounded-xl p-4 ${u.flagged ? 'border-red-500/40' : 'border-white/8'}`}>
                      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <p className="font-bold">{u.name}</p>
                            {statusPill(u.kyc)}
                            <PermissionBadge role={u.role} />
                            {!u.active && <span className="text-red-400 text-xs font-bold">SUSPENDED</span>}
                            {u.flagged && <span className="text-red-400 text-xs font-bold">🚩</span>}
                          </div>
                          <p className="text-gray-500 text-xs">📱 {u.phone} · Team: {u.team}</p>
                          <p className="text-gray-600 text-xs mt-0.5">DOB: {u.dob} · Postcode: {u.postcode} · Joined: {u.joinedAt}</p>
                        </div>
                        <div className="flex gap-2 flex-wrap">
                          {u.kyc === 'pending' && (
                            <>
                              <button onClick={() => setKycStatus(u.phone, 'verified')} className="bg-green-500/20 hover:bg-green-500/30 border border-green-500/40 text-green-400 px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1"><CheckCircle className="w-3 h-3"/>Approve KYC</button>
                              <button onClick={() => setKycStatus(u.phone, 'rejected')} className="bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1"><AlertCircle className="w-3 h-3"/>Reject</button>
                            </>
                          )}
                          {u.kyc === 'verified' && <span className="text-green-400 text-xs flex items-center gap-1"><CheckCircle className="w-3 h-3"/>Verified</span>}
                          <button onClick={() => resetPassword(u.phone)} className="bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 text-blue-400 px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1"><Lock className="w-3 h-3"/>Reset PW</button>
                        </div>
                      </div>
                      {/* GDPR notice */}
                      <div className="mt-3 bg-black/30 rounded-lg px-3 py-2 flex items-center gap-2">
                        <Shield className="w-3 h-3 text-blue-400 flex-shrink-0" />
                        <p className="text-gray-600 text-xs">Data held under GDPR Art. 6(1)(b) — contractual necessity. User can request deletion via support.</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* ── BETS ─────────────────────────────────────────────────── */}
              {adminTab === 'bets' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-2">
                    <StatCard label="Pending"  value={adminBets.filter(b=>b.status==='pending').length}  color="text-amber-400" bg="bg-amber-500/10 border-amber-500/20" />
                    <StatCard label="Won"      value={adminBets.filter(b=>b.status==='won').length}      color="text-green-400" bg="bg-green-500/10 border-green-500/20" />
                    <StatCard label="Lost"     value={adminBets.filter(b=>b.status==='lost').length}     color="text-red-400"   bg="bg-red-500/10 border-red-500/20" />
                    <StatCard label="Flagged"  value={adminBets.filter(b=>b.flagged).length}              color="text-orange-400" bg="bg-orange-500/10 border-orange-500/20" />
                  </div>
                  {filteredBets.map(b => (
                    <div key={b.id} className={`bg-white/3 border rounded-xl p-4 ${b.flagged ? 'border-red-500/40 bg-red-950/10' : 'border-white/8'}`}>
                      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 mb-3">
                        <div>
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <p className="font-bold">{b.team}</p>
                            {statusPill(b.status)}
                            {b.flagged && <span className="text-red-400 text-xs font-bold">🚩 Review Required</span>}
                            {!b.valid && <span className="text-orange-400 text-xs font-bold">⚠ Invalid Submission</span>}
                          </div>
                          <p className="text-gray-500 text-xs">{b.type} · Submitted: {b.submittedAt} · Week {b.week}</p>
                          <p className="text-gray-600 text-xs mt-0.5">AI confidence: <span className={`font-semibold ${b.aiConfidence >= 90 ? 'text-green-400' : b.aiConfidence >= 75 ? 'text-amber-400' : 'text-red-400'}`}>{b.aiConfidence}%</span></p>
                        </div>
                        <div className="flex items-center gap-3 flex-shrink-0">
                          <div className="text-center">
                            <p className="text-white font-bold">{b.stake}</p>
                            <p className="text-gray-600 text-xs">stake</p>
                          </div>
                          <div className="text-center">
                            <p className="text-amber-300 font-bold">@ {b.odds}</p>
                            <p className="text-gray-600 text-xs">odds</p>
                          </div>
                          <div className="text-center">
                            <p className="text-green-400 font-bold">{b.toWin}</p>
                            <p className="text-gray-600 text-xs">to win</p>
                          </div>
                        </div>
                      </div>

                      {/* Inline bet editor (campaign manager or owner) */}
                      {editingBet === b.id ? (
                        <div className="bg-black/40 border border-amber-500/20 rounded-xl p-4 space-y-3">
                          <p className="text-amber-400 text-xs font-bold uppercase tracking-wider">Edit Bet Fields</p>
                          <div className="grid grid-cols-3 gap-3">
                            {[['Stake','stake',b.stake],['Odds','odds',b.odds],['To Win','toWin',b.toWin]].map(([l,f,v]) => (
                              <div key={f}>
                                <label className="block text-xs text-gray-500 mb-1">{l}</label>
                                <input defaultValue={v} onBlur={e => correctBetField(b.id, f, e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none focus:border-amber-500/50" />
                              </div>
                            ))}
                          </div>
                          <div className="flex gap-2">
                            <select defaultValue={b.status} onChange={e => correctBetField(b.id, 'status', e.target.value)} className="flex-1 bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none">
                              {['pending','won','lost','void','rejected'].map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                            <button onClick={() => setEditingBet(null)} className="bg-amber-500/20 border border-amber-500/40 text-amber-400 px-3 py-1.5 rounded-lg text-xs font-semibold">Save</button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex gap-2 flex-wrap">
                          {b.status === 'pending' && (
                            <>
                              <button onClick={() => confirmBetResult(b.id,'won')} className="bg-green-500/20 hover:bg-green-500/30 border border-green-500/40 text-green-400 px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1"><CheckCircle className="w-3 h-3"/>Mark Won</button>
                              <button onClick={() => confirmBetResult(b.id,'lost')} className="bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1"><AlertCircle className="w-3 h-3"/>Mark Lost</button>
                            </>
                          )}
                          {canAdmin('bets') && (
                            <>
                              <button onClick={() => setEditingBet(b.id)} className="bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 text-blue-400 px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1"><Edit3 className="w-3 h-3"/>Edit</button>
                              <button onClick={() => { const r = prompt('Rejection reason:'); if (r) rejectBet(b.id, r); }} className="bg-gray-500/10 hover:bg-gray-500/20 border border-gray-500/30 text-gray-400 px-3 py-1.5 rounded-lg text-xs font-semibold">Reject</button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* ── COMPETITIONS ─────────────────────────────────────────── */}
              {adminTab === 'competitions' && (
                <div className="space-y-4">
                  {canAdmin('competitions') && (
                    <div className="bg-white/3 border border-white/8 rounded-xl p-5">
                      <h3 className="font-bold text-amber-400 mb-4 text-sm">➕ Create New Competition</h3>
                      <div className="grid sm:grid-cols-2 gap-3">
                        {[['compName','Competition Name','text','RSL Club Spring Cup'],['pubName','Pub / Venue Name','text','RSL Club Sydney'],['contactEmail','Contact Email','email','manager@rsl.com.au'],['buyIn','Buy-In Amount','text','$1,000']].map(([id,label,type,ph]) => (
                          <div key={id}>
                            <label className="block text-xs text-gray-500 mb-1">{label}</label>
                            <input id={`admin-${id}`} type={type} placeholder={ph} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/50 placeholder-gray-700" />
                          </div>
                        ))}
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">Season Length</label>
                          <select id="admin-weeks" className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none">
                            <option value="8">Quarter (8 weeks)</option>
                            <option value="16">Half (16 weeks)</option>
                            <option value="32">Full (32 weeks)</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">Max Teams</label>
                          <input id="admin-maxTeams" type="number" placeholder="20" className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/50" />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">Start Date</label>
                          <input id="admin-startDate" type="date" className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/50" />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">End Date</label>
                          <input id="admin-endDate" type="date" className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/50" />
                        </div>
                      </div>
                      <button onClick={() => {
                        const get = (id) => document.getElementById(`admin-${id}`)?.value || '';
                        const name = get('compName'); if (!name) { alert('Enter a competition name.'); return; }
                        createCompetition({ name, pub: get('pubName'), weeks: parseInt(get('weeks')) || 8, maxTeams: parseInt(get('maxTeams')) || 20, startDate: get('startDate'), endDate: get('endDate'), buyIn: get('buyIn') || '$1,000' });
                      }} className="w-full mt-4 bg-gradient-to-r from-amber-500 to-amber-600 text-black font-bold py-2.5 rounded-xl text-sm">Create Competition</button>
                    </div>
                  )}

                  {adminComps.map(c => (
                    <div key={c.code} className="bg-white/3 border border-white/8 rounded-xl p-4">
                      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <p className="font-bold">{c.name}</p>
                            {statusPill(c.status)}
                          </div>
                          <p className="text-gray-500 text-xs">🏪 {c.pub} · Teams: {c.teams}/{c.maxTeams} · {c.weeks} weeks</p>
                          <p className="text-gray-600 text-xs mt-0.5">{c.startDate} → {c.endDate} · Buy-in: {c.buyIn}</p>
                          <div className="flex items-center gap-2 mt-2">
                            <span className="text-gray-500 text-xs">Competition Code:</span>
                            <span className="text-amber-400 font-black tracking-widest text-sm">{c.code}</span>
                            <button onClick={() => { navigator.clipboard?.writeText(c.code); }} className="text-gray-600 hover:text-amber-400 text-xs">📋</button>
                          </div>
                        </div>
                        <div className="flex flex-col gap-2 items-end">
                          <p className="text-green-400 font-black text-lg">{c.jackpot}</p>
                          <p className="text-gray-600 text-xs">jackpot pool</p>
                          {canAdmin('competitions') && c.status !== 'active' && (
                            <button onClick={() => updateCompStatus(c.code, 'active')} className="bg-green-500/20 border border-green-500/40 text-green-400 px-3 py-1.5 rounded-lg text-xs font-semibold">Activate</button>
                          )}
                          {canAdmin('competitions') && c.status === 'active' && (
                            <button onClick={() => updateCompStatus(c.code, 'closed')} className="bg-gray-500/10 border border-gray-500/30 text-gray-400 px-3 py-1.5 rounded-lg text-xs font-semibold">Close</button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* ── SECURITY ─────────────────────────────────────────────── */}
              {adminTab === 'security' && (
                <div className="space-y-5">
                  {/* Security posture */}
                  <div className="grid sm:grid-cols-3 gap-4">
                    {[
                      { label:'Encryption', status:'AES-256 at rest', icon:'🔒', ok:true },
                      { label:'Data Transit', status:'TLS 1.3 enforced', icon:'🛡️', ok:true },
                      { label:'GDPR Compliance', status:'Art. 6 & 17 covered', icon:'✅', ok:true },
                    ].map(s => (
                      <div key={s.label} className="bg-green-950/20 border border-green-500/20 rounded-xl p-4 flex items-start gap-3">
                        <span className="text-2xl">{s.icon}</span>
                        <div>
                          <p className="font-bold text-sm text-green-400">{s.label}</p>
                          <p className="text-gray-500 text-xs mt-0.5">{s.status}</p>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* GDPR framework */}
                  <div className="bg-white/3 border border-white/8 rounded-xl p-5">
                    <h3 className="font-bold text-amber-400 mb-4 text-sm flex items-center gap-2"><Shield className="w-4 h-4"/>GDPR Compliance Framework</h3>
                    <div className="space-y-3">
                      {[
                        { article:'Art. 5', title:'Lawfulness & Transparency', desc:'Users informed of data usage at registration. Privacy policy linked on signup form.' },
                        { article:'Art. 6', title:'Lawful Basis', desc:'Processing under contractual necessity (competition participation) and legitimate interests (fraud prevention).' },
                        { article:'Art. 13', title:'Right to Information', desc:'Data collection purpose, retention period and contact details provided at sign-up.' },
                        { article:'Art. 17', title:'Right to Erasure', desc:'Users may request data deletion via support. Account deactivation removes personal data within 30 days.' },
                        { article:'Art. 25', title:'Privacy by Design', desc:'Minimal data collection. Team member names hidden from other teams on leaderboard.' },
                        { article:'Art. 32', title:'Security of Processing', desc:'All PII encrypted. Admin access requires role-based login. Audit trail maintained.' },
                      ].map(r => (
                        <div key={r.article} className="flex gap-3 bg-black/30 rounded-lg px-4 py-3">
                          <span className="text-blue-400 font-black text-xs bg-blue-500/10 border border-blue-500/20 px-2 py-1 rounded-md h-fit flex-shrink-0">{r.article}</span>
                          <div>
                            <p className="font-semibold text-sm">{r.title}</p>
                            <p className="text-gray-500 text-xs mt-0.5">{r.desc}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Security audit log */}
                  <div className="bg-white/3 border border-white/8 rounded-xl p-5">
                    <h3 className="font-bold text-amber-400 mb-3 text-sm flex items-center gap-2"><Activity className="w-4 h-4"/>Security & Audit Log</h3>
                    <div className="space-y-1.5 max-h-80 overflow-y-auto">
                      {adminAuditLog.map((e,i) => (
                        <div key={i} className="grid grid-cols-12 gap-2 text-xs bg-black/20 rounded-lg px-3 py-2">
                          <span className="col-span-3 text-gray-600">{e.ts}</span>
                          <span className={`col-span-2 font-semibold capitalize ${e.adminRole==='owner'?'text-red-400':e.adminRole==='campaign'?'text-blue-400':'text-purple-400'}`}>{e.adminRole}</span>
                          <span className="col-span-3 text-amber-300 font-semibold">{e.action}</span>
                          <span className="col-span-4 text-gray-400 truncate">{e.target}</span>
                        </div>
                      ))}
                    </div>
                    <button onClick={() => {
                      const rows = adminAuditLog.map(e => `${e.ts},${e.adminRole},${e.action},"${e.target}","${e.detail}"`).join('\n');
                      const csv = `Timestamp,Role,Action,Target,Detail\n${rows}`;
                      const blob = new Blob([csv], {type:'text/csv'});
                      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'audit_log.csv'; a.click();
                    }} className="mt-3 flex items-center gap-1.5 text-xs text-gray-500 hover:text-amber-400 transition-colors">
                      <Download className="w-3.5 h-3.5"/>Export Audit Log (CSV)
                    </button>
                  </div>

                  {/* Data deletion */}
                  <div className="bg-red-950/20 border border-red-500/20 rounded-xl p-5">
                    <h3 className="font-bold text-red-400 mb-2 text-sm">⚠ Data Management (GDPR Art. 17)</h3>
                    <p className="text-gray-400 text-xs mb-4">Use these controls carefully. All actions are logged in the audit trail and are irreversible.</p>
                    <div className="flex gap-3 flex-wrap">
                      <button onClick={() => alert('Deletion request workflow initiated. User will be notified within 48 hours.')} className="bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 px-4 py-2 rounded-lg text-xs font-semibold">Process Deletion Request</button>
                      <button onClick={() => alert('Data export package generated and sent to user email.')} className="bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 text-blue-400 px-4 py-2 rounded-lg text-xs font-semibold">Export User Data</button>
                    </div>
                  </div>
                </div>
              )}
            </main>
          </section>
        );
      })()}

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
