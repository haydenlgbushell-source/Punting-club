import React, { useState, useEffect } from 'react';
import { Sparkles, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';
import { apiGetLatestRecap, apiGetWeeklyRecap } from '../api.js';

const WeeklyRecapCard = ({ competitionId, weekNumber, showGenerateButton, onGenerate, generating }) => {
  const [recap, setRecap] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!competitionId) return;
    setLoading(true);
    setError(null);

    const fetcher = weekNumber
      ? apiGetWeeklyRecap(competitionId, weekNumber)
      : apiGetLatestRecap(competitionId);

    fetcher
      .then(data => setRecap(data))
      .catch(e => {
        if (!e.message?.includes('No rows') && !e.message?.includes('null')) {
          setError(e.message);
        }
      })
      .finally(() => setLoading(false));
  }, [competitionId, weekNumber]);

  if (loading) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl p-6 mb-6 animate-pulse">
        <div className="h-5 bg-gray-200 rounded w-48 mb-3"></div>
        <div className="h-4 bg-gray-100 rounded w-full mb-2"></div>
        <div className="h-4 bg-gray-100 rounded w-3/4"></div>
      </div>
    );
  }

  if (!recap && !showGenerateButton) return null;

  if (!recap && showGenerateButton) {
    return (
      <div className="bg-brand-50 border border-brand-200 rounded-xl p-5 mb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-brand-600" />
            <p className="text-sm text-slate-600">No recap generated for this week yet.</p>
          </div>
          <button
            onClick={onGenerate}
            disabled={generating}
            className="flex items-center gap-1.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
          >
            {generating ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            {generating ? 'Generating...' : 'Generate Recap'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden mb-6">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <div className="text-left">
            <p className="text-xs font-semibold text-brand-600 uppercase tracking-wider">
              Week {recap.week_number} Match Report
            </p>
            <p className="font-bold text-slate-900 text-sm">{recap.headline}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {recap.stats?.winRate !== null && recap.stats?.winRate !== undefined && (
            <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${
              recap.stats.winRate >= 50
                ? 'bg-green-500/15 border-green-500/40 text-green-700'
                : 'bg-red-500/15 border-red-500/40 text-red-700'
            }`}>
              {recap.stats.winRate}% win rate
            </span>
          )}
          {expanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
        </div>
      </button>

      {expanded && (
        <div className="px-5 pb-5 border-t border-gray-100">
          <div
            className="prose prose-sm max-w-none mt-4 text-slate-700"
            dangerouslySetInnerHTML={{ __html: recap.summary_html }}
          />
          <div className="flex items-center justify-between mt-4 pt-3 border-t border-gray-100">
            <p className="text-xs text-slate-400">
              Generated {new Date(recap.generated_at).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true })}
            </p>
            {showGenerateButton && (
              <button
                onClick={onGenerate}
                disabled={generating}
                className="flex items-center gap-1 text-xs text-brand-600 hover:text-brand-700 font-semibold transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`w-3 h-3 ${generating ? 'animate-spin' : ''}`} />
                Regenerate
              </button>
            )}
          </div>
        </div>
      )}

      {error && (
        <div className="px-5 pb-3">
          <p className="text-xs text-red-500">{error}</p>
        </div>
      )}
    </div>
  );
};

export default WeeklyRecapCard;
