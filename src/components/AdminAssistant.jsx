import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Loader2, Sparkles, ChevronRight, Bot, Trash2 } from 'lucide-react';
import { apiAdminAssistant } from '../api.js';

const QUICK_PROMPTS = [
  { label: 'Teams not submitted this week', msg: 'Which teams haven\'t submitted a bet this week?' },
  { label: 'Weekly standings report', msg: 'Generate a weekly standings report for all active competitions. Include rankings, total winnings, and this week\'s results.' },
  { label: 'Draft reminder message', msg: 'Draft a friendly reminder message I can send to teams that haven\'t submitted their bet this week. Make it casual and on-brand for an Aussie pub competition.' },
  { label: 'Competition health check', msg: 'Give me a health check on all active competitions — participation rates, pending bets, flagged items, and anything that needs attention.' },
  { label: 'Flagged bets summary', msg: 'Are there any flagged or pending bets that need admin review? List them with details.' },
];

const AdminAssistant = ({ adminToken }) => {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const sendMessage = useCallback(async (text) => {
    if (!text.trim() || loading) return;
    const userMsg = { role: 'user', content: text.trim() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setLoading(true);

    try {
      const data = await apiAdminAssistant(adminToken, newMessages);
      setMessages(prev => [...prev, { role: 'assistant', content: data.reply || 'No response generated.' }]);
    } catch (e) {
      setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${e.message}. Please try again.` }]);
    } finally {
      setLoading(false);
    }
  }, [messages, loading, adminToken]);

  const handleSubmit = (e) => {
    e.preventDefault();
    sendMessage(input);
  };

  const renderMarkdown = (text) => {
    const lines = text.split('\n');
    const elements = [];
    let inTable = false;
    let tableRows = [];

    const flushTable = () => {
      if (tableRows.length < 2) {
        tableRows.forEach(r => elements.push(<p key={elements.length} className="text-sm text-gray-300">{r}</p>));
      } else {
        const headers = tableRows[0].split('|').filter(c => c.trim());
        const rows = tableRows.slice(2).map(r => r.split('|').filter(c => c.trim()));
        elements.push(
          <div key={elements.length} className="overflow-x-auto my-2">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-white/10">
                  {headers.map((h, i) => <th key={i} className="text-left text-gray-400 font-semibold px-2 py-1.5 uppercase tracking-wider">{h.trim()}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, ri) => (
                  <tr key={ri} className="border-b border-white/5 hover:bg-white/3">
                    {row.map((cell, ci) => <td key={ci} className="px-2 py-1.5 text-gray-300">{cell.trim()}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }
      tableRows = [];
      inTable = false;
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const isTableLine = line.trim().startsWith('|') && line.trim().endsWith('|');
      const isSeparator = /^\|[\s\-:|]+\|$/.test(line.trim());

      if (isTableLine || isSeparator) {
        inTable = true;
        tableRows.push(line);
        continue;
      }

      if (inTable) flushTable();

      if (line.startsWith('### ')) {
        elements.push(<h4 key={i} className="text-sm font-bold text-white mt-3 mb-1">{line.slice(4)}</h4>);
      } else if (line.startsWith('## ')) {
        elements.push(<h3 key={i} className="text-base font-bold text-white mt-3 mb-1">{line.slice(3)}</h3>);
      } else if (line.startsWith('# ')) {
        elements.push(<h2 key={i} className="text-lg font-bold text-white mt-3 mb-1">{line.slice(2)}</h2>);
      } else if (line.startsWith('- ') || line.startsWith('* ')) {
        elements.push(<li key={i} className="text-sm text-gray-300 ml-4 list-disc">{renderInline(line.slice(2))}</li>);
      } else if (/^\d+\.\s/.test(line)) {
        elements.push(<li key={i} className="text-sm text-gray-300 ml-4 list-decimal">{renderInline(line.replace(/^\d+\.\s/, ''))}</li>);
      } else if (line.trim() === '') {
        elements.push(<div key={i} className="h-2" />);
      } else {
        elements.push(<p key={i} className="text-sm text-gray-300 leading-relaxed">{renderInline(line)}</p>);
      }
    }

    if (inTable) flushTable();
    return elements;
  };

  const renderInline = (text) => {
    const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g);
    return parts.map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={i} className="font-bold text-white">{part.slice(2, -2)}</strong>;
      }
      if (part.startsWith('*') && part.endsWith('*')) {
        return <em key={i} className="italic">{part.slice(1, -1)}</em>;
      }
      if (part.startsWith('`') && part.endsWith('`')) {
        return <code key={i} className="bg-white/10 px-1 py-0.5 rounded text-brand-300 text-xs font-mono">{part.slice(1, -1)}</code>;
      }
      return part;
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-brand-600 flex items-center justify-center">
            <Bot className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-xl font-black">Admin Assistant</h2>
            <p className="text-gray-500 text-sm">AI-powered competition insights with live data</p>
          </div>
        </div>
        {messages.length > 0 && (
          <button
            onClick={() => setMessages([])}
            className="bg-gray-800 border border-white/10 text-gray-400 hover:text-red-400 px-3 py-2 rounded-lg text-xs flex items-center gap-1 transition-colors"
          >
            <Trash2 className="w-3 h-3" /> Clear
          </button>
        )}
      </div>

      <div className="bg-white/5 border border-white/8 rounded-xl overflow-hidden flex flex-col" style={{ height: '600px' }}>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 && (
            <div className="space-y-4">
              <div className="bg-purple-500/10 border border-purple-500/20 rounded-xl px-4 py-3">
                <div className="flex items-center gap-2 mb-2">
                  <Sparkles className="w-4 h-4 text-purple-400" />
                  <p className="text-sm font-semibold text-purple-300">G'day, boss!</p>
                </div>
                <p className="text-sm text-gray-400 leading-relaxed">
                  I've got live access to all your competition data — teams, bets, standings, users. Ask me anything about your competitions or use a quick prompt below.
                </p>
              </div>
              <div className="space-y-1.5">
                <p className="text-xs text-gray-600 font-semibold uppercase tracking-wider px-1">Quick prompts</p>
                {QUICK_PROMPTS.map(q => (
                  <button
                    key={q.label}
                    onClick={() => sendMessage(q.msg)}
                    className="w-full text-left bg-white/3 border border-white/8 hover:border-purple-500/30 hover:bg-purple-500/5 rounded-lg px-3 py-2.5 text-xs text-gray-400 hover:text-purple-300 transition-all flex items-center justify-between group"
                  >
                    {q.label}
                    <ChevronRight className="w-3 h-3 text-gray-600 group-hover:text-purple-400 transition-colors" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[90%] rounded-xl px-4 py-3 ${
                msg.role === 'user'
                  ? 'bg-purple-600/20 border border-purple-500/30 text-purple-200'
                  : 'bg-white/5 border border-white/10'
              }`}>
                {msg.role === 'user' ? (
                  <p className="text-sm leading-relaxed">{msg.content}</p>
                ) : (
                  <div className="space-y-0.5">{renderMarkdown(msg.content)}</div>
                )}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div className="bg-white/5 border border-white/10 rounded-xl px-4 py-3">
                <div className="flex items-center gap-2 text-gray-500 text-sm">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Analysing live data...
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        <form onSubmit={handleSubmit} className="border-t border-white/8 px-3 py-2.5 flex items-center gap-2 flex-shrink-0">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Ask about competitions, teams, bets..."
            disabled={loading}
            className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/20 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!input.trim() || loading}
            className="w-10 h-10 rounded-lg bg-purple-600 hover:bg-purple-700 disabled:bg-gray-700 text-white flex items-center justify-center transition-colors flex-shrink-0 disabled:cursor-not-allowed"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </form>
      </div>
    </div>
  );
};

export default AdminAssistant;
