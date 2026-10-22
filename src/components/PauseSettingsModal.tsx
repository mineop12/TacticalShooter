import React from 'react';
import { GameSettings } from '../game/types';

interface PauseSettingsModalProps {
  isFromTitle: boolean;
  settings: GameSettings;
  onUpdateSettings: (partial: Partial<GameSettings>) => void;
  onResume: () => void;
  onOpenBuyMenu?: () => void;
  onRestartMatch?: () => void;
  onReturnToTitle: () => void;
}

export const PauseSettingsModal: React.FC<PauseSettingsModalProps> = ({
  isFromTitle,
  settings,
  onUpdateSettings,
  onResume,
  onOpenBuyMenu,
  onRestartMatch,
  onReturnToTitle,
}) => {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={isFromTitle ? 'Game Settings' : 'Match Paused & Settings'}
      className="fixed inset-0 z-30 flex items-center justify-center p-4 bg-[#040711]/90 backdrop-blur-md pointer-events-auto"
    >
      <div className="w-full max-w-xl bg-[#080d19] border border-slate-700/80 shadow-2xl p-6 sm:p-7 rounded-xs flex flex-col gap-5">
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div>
            <h2 className="font-display font-bold text-xl sm:text-2xl text-white uppercase tracking-wide">
              {isFromTitle ? 'System Configuration' : 'Tactical Pause'}
            </h2>
            <p className="text-xs font-sans text-slate-400 mt-0.5">
              Input Sensitivity · Field of View · Audio · Telemetry
            </p>
          </div>
          <button
            type="button"
            onClick={onResume}
            className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white font-display font-bold text-xs uppercase tracking-wider cursor-pointer whitespace-nowrap rounded-xs shadow"
          >
            {isFromTitle ? 'Save & Close' : 'Resume Match [Esc]'}
          </button>
        </div>

        {/* Settings Controls */}
        <div className="flex flex-col gap-4">
          {/* 1. Mouse Sensitivity */}
          <label className="flex flex-col gap-1.5 bg-[#0c1424] p-3.5 border border-slate-800 rounded-xs">
            <div className="flex items-center justify-between text-xs font-sans">
              <span className="text-slate-300 font-medium">Mouse Aim Sensitivity</span>
              <span className="text-cyan-400 font-mono font-bold tabular-nums">
                {settings.mouseSensitivity.toFixed(2)}
              </span>
            </div>
            <input
              type="range"
              min="0.2"
              max="3.0"
              step="0.05"
              value={settings.mouseSensitivity}
              onChange={(e) =>
                onUpdateSettings({ mouseSensitivity: parseFloat(e.target.value) })
              }
              className="w-full accent-rose-500 cursor-pointer"
            />
          </label>

          {/* 2. Field of View */}
          <label className="flex flex-col gap-1.5 bg-[#0c1424] p-3.5 border border-slate-800 rounded-xs">
            <div className="flex items-center justify-between text-xs font-sans">
              <span className="text-slate-300 font-medium">Camera Field of View (FOV)</span>
              <span className="text-cyan-400 font-mono font-bold tabular-nums">
                {settings.fov}°
              </span>
            </div>
            <input
              type="range"
              min="70"
              max="110"
              step="1"
              value={settings.fov}
              onChange={(e) => onUpdateSettings({ fov: parseInt(e.target.value, 10) })}
              className="w-full accent-rose-500 cursor-pointer"
            />
          </label>

          {/* 3. Audio Volume */}
          <label className="flex flex-col gap-1.5 bg-[#0c1424] p-3.5 border border-slate-800 rounded-xs">
            <div className="flex items-center justify-between text-xs font-sans">
              <span className="text-slate-300 font-medium">Master Audio Synthesis Volume</span>
              <span className="text-cyan-400 font-mono font-bold tabular-nums">
                {Math.round(settings.masterVolume * 100)}%
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={settings.masterVolume}
              onChange={(e) => onUpdateSettings({ masterVolume: parseFloat(e.target.value) })}
              className="w-full accent-rose-500 cursor-pointer"
            />
          </label>

          {/* 4. Crosshair Color & Toggles */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
            <div className="flex flex-col justify-between gap-2 p-3 bg-[#0c1424] border border-slate-800 rounded-xs">
              <span className="text-xs font-sans text-slate-300 font-medium">Crosshair Color</span>
              <div className="flex items-center gap-2">
                {['#10b981', '#06b6d4', '#f43f5e', '#facc15'].map((hex) => (
                  <button
                    key={hex}
                    type="button"
                    aria-label={`Crosshair color ${hex}`}
                    onClick={() => onUpdateSettings({ crosshairColor: hex })}
                    className={`w-5 h-5 rounded-xs border ${
                      settings.crosshairColor === hex ? 'border-white scale-110 shadow' : 'border-slate-700'
                    } cursor-pointer transition-transform`}
                    style={{ backgroundColor: hex }}
                  />
                ))}
              </div>
            </div>

            <div className="flex flex-col justify-between gap-2 p-3 bg-[#0c1424] border border-slate-800 rounded-xs">
              <span className="text-xs font-sans text-slate-300 font-medium">Tactical Radar</span>
              <button
                type="button"
                onClick={() => onUpdateSettings({ showMinimap: !settings.showMinimap })}
                className={`py-1.5 px-3 text-xs font-sans font-semibold border rounded-xs cursor-pointer transition-colors ${
                  settings.showMinimap
                    ? 'bg-emerald-600/30 border-emerald-500 text-emerald-300'
                    : 'bg-slate-800 border-slate-700 text-slate-400'
                }`}
              >
                {settings.showMinimap ? 'Enabled' : 'Hidden'}
              </button>
            </div>

            <div className="flex flex-col justify-between gap-2 p-3 bg-[#0c1424] border border-slate-800 rounded-xs">
              <span className="text-xs font-sans text-slate-300 font-medium">FPS Telemetry</span>
              <button
                type="button"
                data-testid="toggle-fps-counter"
                onClick={() => onUpdateSettings({ showFps: !settings.showFps })}
                className={`py-1.5 px-3 text-xs font-sans font-semibold border rounded-xs cursor-pointer transition-colors ${
                  settings.showFps
                    ? 'bg-emerald-600/30 border-emerald-500 text-emerald-300'
                    : 'bg-slate-800 border-slate-700 text-slate-400'
                }`}
              >
                {settings.showFps ? 'Enabled' : 'Hidden'}
              </button>
            </div>
          </div>

          {/* 5. Graphics Quality */}
          <div className="flex items-center justify-between p-3.5 bg-[#0c1424] border border-slate-800 rounded-xs">
            <span className="text-xs font-sans text-slate-300 font-medium">Render Profile</span>
            <div className="flex items-center gap-1.5">
              {(['performance', 'balanced', 'ultra'] as const).map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => onUpdateSettings({ graphicsQuality: q })}
                  className={`px-3 py-1 text-xs font-sans font-medium uppercase border rounded-xs cursor-pointer transition-colors ${
                    settings.graphicsQuality === q
                      ? 'bg-cyan-600/30 border-cyan-400 text-cyan-200 font-semibold'
                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Action Buttons when Paused in Match */}
        {!isFromTitle && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-3 border-t border-slate-800">
            {onOpenBuyMenu && (
              <button
                type="button"
                onClick={onOpenBuyMenu}
                className="py-2.5 px-4 bg-slate-800 hover:bg-slate-700 text-amber-300 font-sans text-xs font-semibold uppercase tracking-wider border border-slate-700 rounded-xs cursor-pointer whitespace-nowrap"
              >
                Open Armory [B]
              </button>
            )}
            {onRestartMatch && (
              <button
                type="button"
                onClick={onRestartMatch}
                className="py-2.5 px-4 bg-slate-800 hover:bg-slate-700 text-slate-200 font-sans text-xs font-semibold uppercase tracking-wider border border-slate-700 rounded-xs cursor-pointer whitespace-nowrap"
              >
                Restart Match
              </button>
            )}
            <button
              type="button"
              onClick={onReturnToTitle}
              className="py-2.5 px-4 bg-slate-900 hover:bg-rose-950/80 text-rose-300 font-sans text-xs font-semibold uppercase tracking-wider border border-rose-500/40 rounded-xs cursor-pointer whitespace-nowrap"
            >
              Return to Menu
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
