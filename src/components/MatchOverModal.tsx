import React from 'react';
import { MatchSummaryStats } from '../game/types';
import { OPERATIVES } from '../game/weapons';

interface MatchOverModalProps {
  summary: MatchSummaryStats;
  onPlayAgain: () => void;
  onReturnToTitle: () => void;
}

export const MatchOverModal: React.FC<MatchOverModalProps> = ({
  summary,
  onPlayAgain,
  onReturnToTitle,
}) => {
  const isVictory = summary.winner === 'PLAYER';
  const accuracy =
    summary.shotsFired > 0
      ? Math.round((summary.shotsHit / summary.shotsFired) * 100)
      : 0;
  const hsPercent =
    summary.shotsHit > 0
      ? Math.round((summary.headshots / summary.shotsHit) * 100)
      : 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={isVictory ? 'Match Victory' : 'Match Defeat'}
      className="fixed inset-0 z-30 flex items-center justify-center p-4 bg-[#060911]/90 pointer-events-auto"
    >
      <div className="w-full max-w-lg bg-[#0b111e] border border-slate-700 shadow-2xl p-7 flex flex-col gap-6">
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div>
            <span className="text-xs font-mono uppercase tracking-widest text-slate-400">
              1V1 COMPETITIVE DUEL // {OPERATIVES[summary.operative].name}
            </span>
            <h2
              className={`font-display font-bold text-4xl tracking-wider uppercase mt-1 ${
                isVictory ? 'text-emerald-400' : 'text-rose-500'
              }`}
            >
              {isVictory ? 'Match Victory' : 'Match Defeat'}
            </h2>
          </div>

          <div className="text-right bg-[#090d16] px-4 py-2 border border-slate-800">
            <span className="block text-[10px] font-mono text-slate-400">FINAL SCORE</span>
            <span className="font-display font-bold text-3xl text-white tabular-nums">
              {summary.playerRounds} – {summary.aiRounds}
            </span>
          </div>
        </div>

        {/* 3 Mastery & Combat Telemetry Tiles */}
        <div className="grid grid-cols-3 gap-3">
          <div className="p-3.5 bg-[#0f172a] border border-slate-800 flex flex-col">
            <span className="text-[11px] font-mono text-slate-400">ELIMINATIONS / DEATHS</span>
            <span className="font-mono font-bold text-2xl text-white tabular-nums mt-1">
              {summary.playerKills} / {summary.playerDeaths}
            </span>
          </div>

          <div className="p-3.5 bg-[#0f172a] border border-slate-800 flex flex-col">
            <span className="text-[11px] font-mono text-slate-400">ACCURACY / HS%</span>
            <span className="font-mono font-bold text-2xl text-cyan-400 tabular-nums mt-1">
              {accuracy}% · {hsPercent}%
            </span>
          </div>

          <div className="p-3.5 bg-[#0f172a] border border-slate-800 flex flex-col">
            <span className="text-[11px] font-mono text-slate-400">TOTAL DAMAGE</span>
            <span className="font-mono font-bold text-2xl text-amber-400 tabular-nums mt-1">
              {summary.totalDamageDealt}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button
            type="button"
            data-start="true"
            onClick={onPlayAgain}
            className="flex-1 py-3.5 px-6 bg-rose-600 hover:bg-rose-500 text-white font-display font-bold text-sm uppercase tracking-wider cursor-pointer whitespace-nowrap"
          >
            Play Again (Restart Match)
          </button>
          <button
            type="button"
            onClick={onReturnToTitle}
            className="py-3.5 px-5 bg-slate-800 hover:bg-slate-700 text-slate-200 font-mono text-xs font-semibold uppercase tracking-wider border border-slate-700 cursor-pointer whitespace-nowrap"
          >
            Main Menu
          </button>
        </div>
      </div>
    </div>
  );
};
