import React, { useState } from 'react';
import { AIDifficulty, OperativeId } from '../game/types';
import { AI_DIFFICULTY_CONFIGS, OPERATIVES, WEAPONS } from '../game/weapons';
import { VanguardTitleLockupSvg, WeaponSvgIcon } from './WeaponIcons';

interface TitleScreenProps {
  selectedOperative: OperativeId;
  selectedDifficulty: AIDifficulty;
  onSelectOperative: (id: OperativeId) => void;
  onSelectDifficulty: (diff: AIDifficulty) => void;
  onStartMatch: (practiceMode: boolean) => void;
  onOpenMultiplayer: () => void;
  onOpenSettings: () => void;
  onResetDefaults: () => void;
}

export const TitleScreen: React.FC<TitleScreenProps> = ({
  selectedOperative,
  selectedDifficulty,
  onSelectOperative,
  onSelectDifficulty,
  onStartMatch,
  onOpenMultiplayer,
  onOpenSettings,
  onResetDefaults,
}) => {
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const currentOp = OPERATIVES[selectedOperative];
  const sigWeapon = WEAPONS[currentOp.signatureWeapon];

  const handleReset = () => {
    onResetDefaults();
    setStatusMessage('Local profile & settings restored to factory defaults.');
    window.setTimeout(() => setStatusMessage(null), 3000);
  };

  return (
    <main
      aria-label="Vanguard 1v1 Main Menu"
      className="fixed inset-0 z-20 flex flex-col justify-between p-3 sm:p-6 md:p-8 pointer-events-none overflow-y-auto"
    >
      {/* Top Status Strip */}
      <div className="flex flex-wrap items-center justify-between gap-2 w-full max-w-[1400px] mx-auto pointer-events-auto">
        <div className="flex items-center gap-2 sm:gap-3 text-[11px] sm:text-xs font-mono tracking-wider text-slate-300 bg-[#090d16]/90 px-3 py-1.5 sm:px-4 sm:py-2 border border-slate-700/80">
          <span className="text-rose-400 font-semibold">1V1 TACTICAL DUEL</span>
          <span aria-hidden="true">·</span>
          <span>FIRST TO 13</span>
          <span className="hidden sm:inline" aria-hidden="true">·</span>
          <span className="hidden sm:inline text-emerald-400">1V1 ONLINE CODE MATCHMAKING & OFFLINE AI</span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onOpenSettings}
            className="px-3 py-1.5 sm:px-4 sm:py-2 text-xs font-mono font-semibold uppercase tracking-wider text-slate-200 bg-[#090d16]/90 hover:bg-slate-800 border border-slate-700 transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            Settings
          </button>
          <button
            type="button"
            onClick={handleReset}
            className="px-3 py-1.5 sm:px-4 sm:py-2 text-xs font-mono font-semibold uppercase tracking-wider text-slate-400 hover:text-white bg-[#090d16]/90 hover:bg-slate-800 border border-slate-800 transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            Reset Profile
          </button>
        </div>
      </div>

      {/* Main Negative-Space Left-Third Command Column */}
      <div className="w-full max-w-[1400px] mx-auto my-2 sm:my-auto grid grid-cols-1 lg:grid-cols-12 gap-4 items-center">
        <div className="lg:col-span-7 xl:col-span-6 flex flex-col gap-3.5 sm:gap-4 bg-[#090d16]/92 p-4 sm:p-6 border border-slate-700/80 shadow-2xl pointer-events-auto">
          <VanguardTitleLockupSvg className="w-full max-w-[440px]" />

          {/* 1. Operative & Loadout Selection */}
          <section aria-label="Operative Selection" className="flex flex-col gap-2">
            <div className="flex items-center justify-between text-xs font-mono text-slate-400">
              <span>01. SELECT OPERATIVE RIG</span>
              <span className="text-slate-300 truncate ml-2">{currentOp.origin}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {(Object.keys(OPERATIVES) as OperativeId[]).map((opId) => {
                const op = OPERATIVES[opId];
                const isSelected = selectedOperative === opId;
                return (
                  <button
                    key={op.id}
                    type="button"
                    onClick={() => onSelectOperative(op.id)}
                    aria-pressed={isSelected}
                    className={`flex sm:flex-col items-center sm:items-start justify-between sm:justify-start p-2.5 sm:p-3 text-left border transition-colors cursor-pointer min-w-0 ${
                      isSelected
                        ? 'bg-slate-800/95 border-rose-500 text-white'
                        : 'bg-[#0f1624]/90 border-slate-800 text-slate-300 hover:border-slate-600'
                    }`}
                  >
                    <span className="font-display font-bold text-xs sm:text-sm tracking-wide truncate w-full">
                      {op.name}
                    </span>
                    <span className="text-[11px] text-slate-400 truncate sm:w-full sm:mt-0.5 ml-2 sm:ml-0 shrink-0 sm:shrink">
                      {op.role}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Selected Operative Spec Strip */}
            <div className="flex items-center justify-between gap-3 p-2.5 sm:p-3 bg-[#0f1624] border border-slate-800/90 text-xs">
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className="font-semibold text-slate-200 truncate">
                  {currentOp.callsign} · {currentOp.role}
                </span>
                <p className="text-slate-400 leading-snug line-clamp-2">{currentOp.bio}</p>
              </div>
              <div className="flex flex-col items-end shrink-0 text-right border-l border-slate-800 pl-3">
                <span className="text-[10px] font-mono text-slate-400">SPECIALTY</span>
                <WeaponSvgIcon weaponId={sigWeapon.id} className="w-16 h-7 text-slate-200 my-0.5" />
                <span className="font-mono text-[11px] text-rose-400 font-semibold">
                  {sigWeapon.name}
                </span>
              </div>
            </div>
          </section>

          {/* 2. AI Opponent Difficulty Selection */}
          <section aria-label="AI Difficulty Selection" className="flex flex-col gap-2">
            <div className="flex items-center justify-between text-xs font-mono text-slate-400">
              <span>02. AI COMBATANT DIFFICULTY</span>
              <span className="text-cyan-400">{AI_DIFFICULTY_CONFIGS[selectedDifficulty].label} AI</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {(['easy', 'normal', 'hard'] as AIDifficulty[]).map((diffKey) => {
                const cfg = AI_DIFFICULTY_CONFIGS[diffKey];
                const active = selectedDifficulty === diffKey;
                return (
                  <button
                    key={diffKey}
                    type="button"
                    onClick={() => onSelectDifficulty(diffKey)}
                    aria-pressed={active}
                    className={`flex flex-col items-start p-2 sm:p-2.5 text-left border transition-colors cursor-pointer min-w-0 ${
                      active
                        ? 'bg-slate-800/95 border-cyan-400 text-white'
                        : 'bg-[#0f1624]/90 border-slate-800 text-slate-300 hover:border-slate-600'
                    }`}
                  >
                    <div className="flex items-center justify-between w-full gap-1">
                      <span className="font-display font-bold text-xs sm:text-sm uppercase tracking-wider truncate">
                        {cfg.label}
                      </span>
                      <span className="font-mono text-[10px] text-slate-400 tabular-nums shrink-0">
                        {cfg.reactionDelayMs}ms
                      </span>
                    </div>
                    <span className="text-[11px] text-slate-400 truncate w-full mt-0.5">
                      {cfg.subtitle}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* 3. Primary Match, 1v1 Online Code Matchmaking & Practice CTAs */}
          <div className="flex flex-col sm:flex-row items-stretch gap-2.5 pt-1">
            <button
              type="button"
              data-start="true"
              onClick={() => onStartMatch(false)}
              className="flex-1 py-3 px-4 bg-rose-600 hover:bg-rose-500 active:bg-rose-700 text-white font-display font-bold text-sm sm:text-base tracking-wider uppercase transition-colors cursor-pointer shadow-lg whitespace-nowrap"
            >
              Play 1v1 vs AI
            </button>
            <button
              type="button"
              data-testid="open-multiplayer-btn"
              onClick={onOpenMultiplayer}
              className="flex-1 py-3 px-4 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white border border-emerald-400/50 font-display font-bold text-sm sm:text-base tracking-wider uppercase transition-colors cursor-pointer shadow-lg whitespace-nowrap"
            >
              1v1 Online (Code)
            </button>
            <button
              type="button"
              onClick={() => onStartMatch(true)}
              className="py-3 px-4 bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-cyan-500/40 font-display font-bold text-xs sm:text-sm tracking-wider uppercase transition-colors cursor-pointer whitespace-nowrap"
            >
              Practice Range
            </button>
          </div>

          {statusMessage && (
            <div
              role="status"
              className="text-xs font-mono text-emerald-400 bg-emerald-950/60 border border-emerald-700/60 px-3 py-2"
            >
              {statusMessage}
            </div>
          )}
        </div>
      </div>

      {/* Bottom Single Flat Control-Hint Line */}
      <div className="w-full max-w-[1400px] mx-auto flex flex-wrap items-center justify-between gap-2 text-[11px] sm:text-xs font-mono text-slate-300 bg-[#090d16]/85 px-3 py-2 sm:px-4 sm:py-2.5 border border-slate-800/80">
        <span>
          WASD Move · Space Jump · Shift Walk · Ctrl Crouch · LMB Shoot · RMB Aim · R Reload · Y Inspect Weapon · 1-5 Weapons · B Armory · E Objective
        </span>
        <span className="text-slate-400 hidden md:inline">PRESS [ENTER] OR [SPACE] TO DEPLOY</span>
      </div>
    </main>
  );
};
