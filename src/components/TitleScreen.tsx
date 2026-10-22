import React, { useState } from 'react';
import { AIDifficulty, OperativeId } from '../game/types';
import { AI_DIFFICULTY_CONFIGS, OPERATIVES, WEAPONS } from '../game/weapons';
import { WeaponSvgIcon } from './WeaponIcons';

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
      className="fixed inset-0 z-20 flex flex-col justify-between p-4 sm:p-6 md:p-8 pointer-events-none overflow-y-auto"
    >
      {/* Top Navigation & Status Bar */}
      <header className="flex items-center justify-between gap-4 w-full max-w-6xl mx-auto pointer-events-auto bg-[#070b14]/90 backdrop-blur-md px-5 py-3 border border-slate-700/60 shadow-xl">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-sm bg-gradient-to-br from-rose-500 to-rose-700 flex items-center justify-center shadow-lg shadow-rose-950/50">
            <svg viewBox="0 0 24 24" className="w-4 h-4 text-white" fill="currentColor" aria-hidden="true">
              <path d="M12 2L2 7l10 15 10-15-10-5zm0 4.2L18.4 8 12 17.6 5.6 8 12 6.2z" />
            </svg>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-display font-bold text-lg sm:text-xl tracking-wider text-white">
                VANGUARD
              </span>
              <span className="px-1.5 py-0.5 text-[10px] font-mono font-semibold uppercase bg-rose-500/20 text-rose-300 border border-rose-500/40 rounded-xs">
                1V1 DUEL
              </span>
            </div>
            <p className="text-[11px] font-sans text-slate-400 hidden sm:block">
              Haven-Zero Sector 4 · First to 13 Rounds
            </p>
          </div>
        </div>

        <div className="hidden lg:flex items-center gap-3 text-xs font-sans text-slate-300">
          <span>Competitive Duel</span>
          <span className="text-slate-600" aria-hidden="true">·</span>
          <span>Tactical Economy</span>
          <span className="text-slate-600" aria-hidden="true">·</span>
          <span className="text-emerald-400 font-medium">Online P2P & Offline AI</span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onOpenSettings}
            className="px-3.5 py-1.5 text-xs font-sans font-medium text-slate-200 bg-slate-800/80 hover:bg-slate-700 border border-slate-600/70 rounded-xs transition-colors cursor-pointer whitespace-nowrap"
          >
            Settings
          </button>
          <button
            type="button"
            onClick={handleReset}
            className="px-3 py-1.5 text-xs font-sans text-slate-400 hover:text-white bg-slate-900/80 hover:bg-slate-800 border border-slate-800 rounded-xs transition-colors cursor-pointer whitespace-nowrap"
          >
            Reset
          </button>
        </div>
      </header>

      {/* Main Tactical Command Console */}
      <div className="w-full max-w-6xl mx-auto my-auto py-4 pointer-events-auto">
        <div className="bg-[#070b14]/92 backdrop-blur-lg border border-slate-700/80 p-5 sm:p-7 shadow-2xl flex flex-col gap-6">
          
          {/* Section 1: Operative Rig Selection */}
          <section aria-label="Operative Selection" className="flex flex-col gap-3">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono font-bold text-rose-400 uppercase tracking-wider">01</span>
                <h2 className="font-display font-bold text-sm sm:text-base text-white uppercase tracking-wide">
                  Select Operative Rig
                </h2>
              </div>
              <span className="text-xs font-sans text-slate-400">
                {currentOp.origin}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {(Object.keys(OPERATIVES) as OperativeId[]).map((opId) => {
                const op = OPERATIVES[opId];
                const isSelected = selectedOperative === opId;
                const opSig = WEAPONS[op.signatureWeapon];
                
                return (
                  <button
                    key={op.id}
                    type="button"
                    onClick={() => onSelectOperative(op.id)}
                    aria-pressed={isSelected}
                    className={`relative p-4 text-left border rounded-xs transition-all duration-150 cursor-pointer flex flex-col justify-between gap-3 ${
                      isSelected
                        ? 'bg-gradient-to-b from-slate-800/95 to-[#0e1626]/95 border-rose-500 shadow-lg shadow-rose-950/30'
                        : 'bg-[#0a0f1d]/80 border-slate-800/90 hover:border-slate-700 hover:bg-[#0d1426]/90 text-slate-300'
                    }`}
                  >
                    {/* Active Accent Top Indicator */}
                    {isSelected && (
                      <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-rose-500 via-rose-400 to-amber-400" />
                    )}

                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-display font-bold text-base sm:text-lg text-white uppercase tracking-wide">
                            {op.name.split('//')[0].trim()}
                          </span>
                          <span
                            className={`text-[10px] font-mono font-semibold uppercase px-1.5 py-0.5 rounded-xs border ${
                              isSelected
                                ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                                : 'bg-slate-800 text-slate-400 border-slate-700'
                            }`}
                          >
                            {op.role.split('&')[0].trim()}
                          </span>
                        </div>
                        <span className="text-xs font-sans text-slate-400 block mt-1">
                          {op.callsign} · {op.origin.split(' ')[0]}
                        </span>
                      </div>

                      <div className="w-7 h-7 rounded-xs bg-slate-800/80 border border-slate-700 flex items-center justify-center shrink-0">
                        <span className="font-mono text-xs font-bold text-slate-300">
                          {op.id.toUpperCase().slice(0, 2)}
                        </span>
                      </div>
                    </div>

                    <p className="text-xs font-sans text-slate-300/90 leading-relaxed line-clamp-2">
                      {op.bio}
                    </p>

                    {/* Signature Weapon Mini Strip */}
                    <div className="flex items-center justify-between pt-2 border-t border-slate-800/80 text-[11px] font-sans text-slate-400">
                      <span>Specialty: <strong className="text-slate-200">{opSig.name}</strong></span>
                      <WeaponSvgIcon weaponId={opSig.id} className="w-12 h-5 text-slate-400" />
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Section 2: AI Combatant Difficulty */}
          <section aria-label="AI Difficulty Selection" className="flex flex-col gap-3">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono font-bold text-cyan-400 uppercase tracking-wider">02</span>
                <h2 className="font-display font-bold text-sm sm:text-base text-white uppercase tracking-wide">
                  Match Difficulty Calibration
                </h2>
              </div>
              <span className="text-xs font-mono text-cyan-400">
                {AI_DIFFICULTY_CONFIGS[selectedDifficulty].reactionDelayMs}ms Target Reaction
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {(['easy', 'normal', 'hard'] as AIDifficulty[]).map((diffKey) => {
                const cfg = AI_DIFFICULTY_CONFIGS[diffKey];
                const active = selectedDifficulty === diffKey;
                return (
                  <button
                    key={diffKey}
                    type="button"
                    onClick={() => onSelectDifficulty(diffKey)}
                    aria-pressed={active}
                    className={`p-3.5 text-left border rounded-xs transition-all duration-150 cursor-pointer flex flex-col justify-between gap-2 ${
                      active
                        ? 'bg-gradient-to-b from-slate-800/95 to-[#0b172a]/95 border-cyan-400 shadow-md shadow-cyan-950/20'
                        : 'bg-[#0a0f1d]/80 border-slate-800/90 hover:border-slate-700 hover:bg-[#0d1426]/90 text-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-between w-full">
                      <span className="font-display font-bold text-sm sm:text-base uppercase tracking-wider text-white">
                        {cfg.label}
                      </span>
                      <span className="font-mono text-xs font-semibold px-2 py-0.5 bg-slate-900 border border-slate-700/80 text-cyan-300 rounded-xs tabular-nums">
                        {cfg.reactionDelayMs}ms
                      </span>
                    </div>
                    <p className="text-xs font-sans text-slate-400 leading-relaxed">
                      {cfg.subtitle}
                    </p>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Section 3: Match Deployment Actions (Clear Focal Anchor) */}
          <div className="pt-2 flex flex-col sm:flex-row items-stretch gap-3">
            <button
              type="button"
              data-start="true"
              onClick={() => onStartMatch(false)}
              className="flex-2 py-3.5 px-6 bg-gradient-to-r from-rose-600 via-rose-500 to-rose-600 hover:from-rose-500 hover:to-rose-500 text-white font-display font-bold text-base tracking-wider uppercase transition-all duration-150 cursor-pointer shadow-lg shadow-rose-950/50 rounded-xs flex items-center justify-center gap-2"
            >
              <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor" aria-hidden="true">
                <path d="M8 5v14l11-7z" />
              </svg>
              <span>Deploy 1v1 vs AI</span>
            </button>

            <button
              type="button"
              data-testid="open-multiplayer-btn"
              onClick={onOpenMultiplayer}
              className="flex-1 py-3.5 px-5 bg-[#0e1726] hover:bg-[#131f33] active:bg-[#0b1220] text-emerald-300 border border-emerald-500/50 hover:border-emerald-400 font-display font-bold text-sm sm:text-base tracking-wider uppercase transition-colors cursor-pointer rounded-xs flex items-center justify-center gap-2 shadow-md"
            >
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>1v1 Online (Code)</span>
            </button>

            <button
              type="button"
              onClick={() => onStartMatch(true)}
              className="py-3.5 px-5 bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 font-display font-semibold text-xs sm:text-sm tracking-wider uppercase transition-colors cursor-pointer rounded-xs whitespace-nowrap"
            >
              Practice Range
            </button>
          </div>

          {statusMessage && (
            <div
              role="status"
              className="text-xs font-sans text-emerald-300 bg-emerald-950/60 border border-emerald-700/60 px-4 py-2.5 rounded-xs"
            >
              {statusMessage}
            </div>
          )}
        </div>
      </div>

      {/* Bottom Keybind Strip */}
      <footer className="w-full max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-3 text-xs font-sans text-slate-400 bg-[#070b14]/90 backdrop-blur-md px-5 py-2.5 border border-slate-700/60 shadow-lg pointer-events-auto">
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1">
          <span><strong className="text-slate-200 font-mono">WASD</strong> Move</span>
          <span className="text-slate-600">·</span>
          <span><strong className="text-cyan-300 font-mono">Space</strong> Jump / Wall-Run / Wall-Jump</span>
          <span className="text-slate-600">·</span>
          <span><strong className="text-amber-300 font-mono">Q</strong> Swing Rope</span>
          <span className="text-slate-600">·</span>
          <span><strong className="text-slate-200 font-mono">Ctrl</strong> Slide / Crouch</span>
          <span className="text-slate-600">·</span>
          <span><strong className="text-slate-200 font-mono">LMB / RMB</strong> Fire & Aim</span>
          <span className="text-slate-600">·</span>
          <span><strong className="text-slate-200 font-mono">Scroll / 1-5</strong> Switch Gun</span>
          <span className="text-slate-600">·</span>
          <span><strong className="text-slate-200 font-mono">B</strong> Armory</span>
        </div>
        <div className="font-mono text-[11px] text-slate-400 hidden sm:block">
          PRESS <strong className="text-white">[ENTER]</strong> TO QUICK LAUNCH
        </div>
      </footer>
    </main>
  );
};
