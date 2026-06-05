import React, { useState } from 'react';

// Barlow Condensed — sports-display font (loaded via Google Fonts in index.html)
const BC = "'Barlow Condensed', 'Inter', sans-serif";

const BetSlipCard = ({ bet, compact = false, onCheckBet, isChecking }) => {
  const [openLegs, setOpenLegs] = useState({});
  if (!bet) return null;

  const toggleLeg = (i) => setOpenLegs(prev => ({ ...prev, [i]: !prev[i] }));

  const legs      = bet.legs || [];
  const wonCount  = legs.filter(l => l.status === 'won').length;
  const lostCount = legs.filter(l => l.status === 'lost').length;
  const liveCount = legs.filter(l => l.status === 'in_progress').length;
  const pendCount = legs.filter(l => l.status === 'pending').length;
  const totalLegs = legs.length;

  const status = totalLegs === 0 ? (bet.overallStatus || 'pending')
    : liveCount > 0                       ? 'in_progress'
    : pendCount > 0                       ? 'pending'
    : lostCount > 0 && wonCount > 0       ? 'partial'
    : lostCount > 0                       ? 'lost'
    :                                       'won';

  const allWon         = status === 'won';
  const estimatedReturn = bet.estimatedReturn || bet.return || 'N/A';
  const payoutValue    = status === 'lost' ? '$0.00' : estimatedReturn;
  const payoutLabel    = allWon ? 'WINNINGS' : 'POTENTIAL';
  const payoutColor    = allWon ? '#22c55e' : status === 'lost' ? '#ef4444' : '#94a3b8';

  const titleText  = allWon ? 'WINNER!' : status === 'lost' ? 'BUST' : status === 'partial' ? 'PARTIAL' : status === 'in_progress' ? 'LIVE' : 'PENDING';
  const titleColor = allWon ? '#16a34a' : status === 'lost' ? '#dc2626' : status === 'partial' ? '#ca8a04' : status === 'in_progress' ? '#ea580c' : '#2563eb';
  const cardBorder = allWon ? '#22c55e66' : status === 'lost' ? '#ef444466' : status === 'partial' ? '#eab30866' : status === 'in_progress' ? '#f9731666' : '#cbd5e1';
  const cardBg     = allWon ? '#f0fdf4' : status === 'lost' ? '#fef2f2' : status === 'partial' ? '#fffbeb' : status === 'in_progress' ? '#fff7ed' : '#ffffff';

  return (
    <div style={{ border: `1px solid ${cardBorder}`, background: cardBg, borderRadius: 16, overflow: 'hidden' }}>
      {/* ── Header ── */}
      <div style={{ padding: compact ? '16px 18px 12px' : '22px 22px 14px', borderBottom: '1px solid #e2e8f0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontFamily: BC, fontWeight: 800, fontSize: 12, letterSpacing: '0.15em', color: '#2563eb' }}>
              {(bet.type || 'MULTI').toUpperCase()} BET
            </span>
            {bet.submittedBy && (
              <span style={{ fontSize: 11, color: '#64748b', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 6, padding: '2px 8px', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                {bet.submittedBy}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {bet.submittedAt && (
              <span style={{ fontSize: 11, color: '#6b7280', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                {bet.submittedAt}
              </span>
            )}
          </div>
        </div>
        <div style={{ fontFamily: BC, fontWeight: 800, fontSize: compact ? 30 : 44, lineHeight: 1, color: titleColor, marginBottom: 4 }}>
          {titleText}
        </div>
        <p style={{ color: '#64748b', fontSize: 13, margin: 0 }}>{wonCount} of {totalLegs} leg{totalLegs !== 1 ? 's' : ''} won</p>
      </div>

      {/* ── Stats row ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', borderBottom: '1px solid #e2e8f0' }}>
        {[
          ['STAKE',     bet.stake,                              '#1e293b'],
          ['ODDS',      bet.combinedOdds || bet.odds || 'N/A', '#2563eb'],
          [payoutLabel, payoutValue,                            payoutColor],
        ].map(([label, value, color], i) => (
          <div key={label} style={{ padding: '12px 14px', textAlign: 'center', background: '#f8fafc', borderRight: i < 2 ? '1px solid #e2e8f0' : 'none' }}>
            <div style={{ fontFamily: BC, letterSpacing: '0.12em', fontSize: 10, color: '#6b7280', marginBottom: 3 }}>{label}</div>
            <div style={{ fontFamily: BC, fontWeight: 700, fontSize: compact ? 17 : 21, color }}>{value}</div>
          </div>
        ))}
      </div>

      {/* ── Legs ── */}
      {totalLegs > 0 && (
        <div style={{ padding: '12px 12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontFamily: BC, letterSpacing: '0.14em', fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>
            {totalLegs} LEG{totalLegs !== 1 ? 'S' : ''}
          </div>
          {legs.map((leg, i) => {
            const won  = leg.status === 'won';
            const lost = leg.status === 'lost';
            const live = leg.status === 'in_progress';
            const legColor = won ? '#22c55e' : lost ? '#ef4444' : live ? '#f97316' : '#f59e0b';
            const isOpen = openLegs[i];
            return (
              <div key={i} className="bc-fadeup" style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderLeft: `4px solid ${legColor}`, borderRadius: 10, animationDelay: `${i * 0.07}s` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '12px 14px' }}>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flex: 1, minWidth: 0 }}>
                    <div style={{ width: 26, height: 26, borderRadius: '50%', background: '#eff6ff', border: '1px solid #bfdbfe', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: BC, fontWeight: 700, fontSize: 12, color: '#2563eb', flexShrink: 0, marginTop: 2 }}>
                      {i + 1}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontFamily: BC, fontWeight: 700, fontSize: 16, color: '#1e293b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{leg.selection}</div>
                      <div style={{ fontSize: 12, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{leg.event}{leg.market ? ` · ${leg.market}` : ''}</div>
                      {(leg.eventDate || leg.startTime) && (
                        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
                          {leg.eventDate ? (() => {
                            const [yr, mo, dy] = leg.eventDate.split('-').map(Number);
                            return new Date(yr, mo - 1, dy).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
                          })() : ''}
                          {leg.startTime ? ` · ${String(leg.startTime).substring(0, 5)} AEST` : ''}
                        </div>
                      )}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 5, flexShrink: 0, marginLeft: 10 }}>
                    <div style={{ fontFamily: BC, fontWeight: 700, fontSize: 15, color: '#2563eb' }}>@ {leg.odds}</div>
                    <div style={{ fontFamily: BC, fontWeight: 700, fontSize: 11, letterSpacing: '0.08em', padding: '2px 9px', borderRadius: 5, background: `${legColor}18`, color: legColor, border: `1px solid ${legColor}44` }}>
                      {won ? '✓ WON' : lost ? '✗ LOST' : live ? '● LIVE' : leg.status === 'void' ? '— VOID' : 'WAIT'}
                    </div>
                    {leg.resultNote && (
                      <button onClick={() => toggleLeg(i)} style={{ background: 'none', border: 'none', color: '#4b5563', fontSize: 11, cursor: 'pointer', padding: 0 }}>
                        {isOpen ? '▲ hide' : '▼ details'}
                      </button>
                    )}
                  </div>
                </div>
                {isOpen && leg.resultNote && (
                  <div style={{ borderTop: '1px solid #e5e7eb', padding: '10px 14px 12px', display: 'flex', gap: 7, fontSize: 13, color: '#64748b', lineHeight: 1.5, alignItems: 'flex-start' }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: won ? '#22c55e' : lost ? '#ef4444' : '#eab308', flexShrink: 0, marginTop: 4, display: 'inline-block' }} />
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

export default BetSlipCard;
