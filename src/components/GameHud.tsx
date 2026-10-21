import React, { useEffect, useRef, useState } from 'react';
import {
  AnimatedKillFeedEntry,
  reconcileAnimatedKillFeed,
  resolveKillFeedWeaponId,
} from '../game/rules';
import { HudSnapshot, WeaponId } from '../game/types';
import { OPERATIVES, WEAPON_ORDER, WEAPONS } from '../game/weapons';
import { HeadshotSvgIcon, ShieldSvgIcon, WeaponSvgIcon } from './WeaponIcons';

interface GameHudProps {
  hud: HudSnapshot;
  crosshairColor: string;
  showMinimap: boolean;
  muted: boolean;
  onToggleMute: () => void;
  onOpenBuyMenu: () => void;
  onInspectWeapon: () => void;
  onPause: () => void;
  onRestartMatch: () => void;
  onEquipWeapon: (id: WeaponId) => void;
  onDeployNow: () => void;
  onInteractObjective: () => void;
  onPracticeAction: (
    action: 'refill_credits' | 'spawn_bot_mid' | 'sim_round_win' | 'sim_match_win' | 'heal_player'
  ) => void;
}

export const GameHud: React.FC<GameHudProps> = ({
  hud,
  crosshairColor,
  showMinimap,
  muted,
  onToggleMute,
  onOpenBuyMenu,
  onInspectWeapon,
  onPause,
  onRestartMatch,
  onEquipWeapon,
  onDeployNow,
  onInteractObjective,
  onPracticeAction,
}) => {
  const activeWeaponSpec = WEAPONS[hud.activeWeapon.id];
  const op = OPERATIVES[hud.operative];

  const mins = Math.floor(hud.phaseTimeRemaining / 60);
  const secs = Math.floor(hud.phaseTimeRemaining % 60);
  const formattedTimer = `${mins}:${secs < 10 ? '0' : ''}${secs}`;

  const now = performance.now();
  const recentHit =
    hud.lastHitFeedback && now - hud.lastHitFeedback.timestamp < 550
      ? hud.lastHitFeedback
      : null;

  // Reconcile kill feed items with entry & exit animation states
  const animatedFeedRef = useRef<AnimatedKillFeedEntry[]>([]);
  const [, setAnimTick] = useState(0);
  animatedFeedRef.current = reconcileAnimatedKillFeed(
    animatedFeedRef.current,
    hud.killFeed,
    now
  );
  const animatedKillFeed = animatedFeedRef.current;

  useEffect(() => {
    if (animatedKillFeed.length === 0) return;
    const timer = window.setInterval(() => {
      setAnimTick((t) => t + 1);
    }, 100);
    return () => window.clearInterval(timer);
  }, [animatedKillFeed.length]);

  // Map world coordinates (-28..28, -26..26) to 140x140 minimap SVG
  const worldToMini = (wx: number, wz: number) => ({
    x: 70 + (wx / 28) * 60,
    y: 70 + (wz / 26) * 60,
  });
  const pMini = worldToMini(hud.playerPosition.x, hud.playerPosition.z);
  const aiMini = worldToMini(hud.aiPosition.x, hud.aiPosition.z);

  const stanceLabel = hud.isSliding
    ? 'SLIDING'
    : hud.isCrouching
      ? 'CROUCH'
      : hud.isWalking
        ? 'WALK'
        : hud.isAiming
          ? 'ADS FOCUS'
          : 'READY';

  return (
    <div className="fixed inset-0 z-10 pointer-events-none select-none overflow-hidden">
      {/* Critical Low-HP Peripheral Screen Vignette */}
      {hud.playerHealth <= 35 && (
        <div
          aria-hidden="true"
          className="fixed inset-0 pointer-events-none"
          style={{
            boxShadow: 'inset 0 0 110px 32px rgba(225, 29, 72, 0.42)',
          }}
        />
      )}

      {/* Sniper High-Magnification Scope Overlay when ADS with Operator-SR */}
      {hud.isAiming && hud.activeWeapon.id === 'sniper' && (
        <div
          aria-hidden="true"
          className="fixed inset-0 flex items-center justify-center pointer-events-none"
        >
          <svg viewBox="0 0 800 800" className="w-full h-full max-w-[85vh] max-h-[85vh]">
            <circle
              cx="400"
              cy="400"
              r="340"
              fill="none"
              stroke="#a855f7"
              strokeWidth="3"
              strokeOpacity="0.85"
            />
            <line x1="60" y1="400" x2="740" y2="400" stroke="#e2e8f0" strokeWidth="1" strokeOpacity="0.6" />
            <line x1="400" y1="60" x2="400" y2="740" stroke="#e2e8f0" strokeWidth="1" strokeOpacity="0.6" />
            <circle cx="400" cy="400" r="4" fill="#f43f5e" />
          </svg>
        </div>
      )}

      {/* ====================================================================
          CENTER CROSSHAIR, HITMARKER & RELOAD RING (0,0 Gaze Routing)
      ==================================================================== */}
      <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none flex items-center justify-center">
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none" aria-hidden="true">
          {/* Standard Tactical Crosshair */}
          <line x1="24" y1="11" x2="24" y2="19" stroke={crosshairColor} strokeWidth="2" />
          <line x1="24" y1="29" x2="24" y2="37" stroke={crosshairColor} strokeWidth="2" />
          <line x1="11" y1="24" x2="19" y2="24" stroke={crosshairColor} strokeWidth="2" />
          <line x1="29" y1="24" x2="37" y2="24" stroke={crosshairColor} strokeWidth="2" />
          <circle cx="24" cy="24" r="1.5" fill={crosshairColor} />

          {/* Hitmarker X Flash on Enemy Impact */}
          {recentHit && (
            <g stroke={recentHit.isHeadshot ? '#fbbf24' : '#f43f5e'} strokeWidth="2.5">
              <line x1="14" y1="14" x2="20" y2="20" />
              <line x1="34" y1="14" x2="28" y2="20" />
              <line x1="14" y1="34" x2="20" y2="28" />
              <line x1="34" y1="34" x2="28" y2="28" />
            </g>
          )}

          {/* Reload Progress Ring */}
          {hud.isReloading && (
            <circle
              cx="24"
              cy="24"
              r="18"
              stroke="#38bdf8"
              strokeWidth="2.5"
              strokeDasharray={113}
              strokeDashoffset={113 * (1 - hud.reloadProgress)}
              transform="rotate(-90 24 24)"
            />
          )}
        </svg>

        {/* Floating Hit Damage Callout near Crosshair */}
        {recentHit && (
          <div
            className={`absolute -top-9 left-1/2 -translate-x-1/2 whitespace-nowrap font-mono font-bold text-xs px-2 py-0.5 ${
              recentHit.isHeadshot
                ? 'text-amber-300 bg-[#090d16]/90 border border-amber-400/60'
                : 'text-rose-300 bg-[#090d16]/85'
            }`}
          >
            -{recentHit.damage} {recentHit.isHeadshot ? 'HEADSHOT' : 'HIT'}
          </div>
        )}

        {hud.isReloading && (
          <div
            data-testid="hud-reload-banner"
            className="absolute top-10 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1 font-mono text-[10px] font-semibold tracking-wider text-cyan-300 bg-[#090d16]/90 border border-cyan-400/70 px-3 py-1 whitespace-nowrap hud-panel-glow-cyan"
          >
            <span>
              {hud.reloadProgress < 0.35
                ? 'RELOAD // EJECTING MAG'
                : hud.reloadProgress < 0.68
                  ? 'RELOAD // INSERTING MAG'
                  : 'RELOAD // CHAMBERING'}
            </span>
            <div className="w-28 h-1 bg-slate-800 overflow-hidden">
              <div
                className="h-full bg-cyan-400 transition-all duration-75"
                style={{ width: `${Math.round(hud.reloadProgress * 100)}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* ====================================================================
          TOP PERIMETER ROW: Minimap (Left) · Scoreboard (Center) · Utilities (Right)
      ==================================================================== */}
      <div className="w-full flex items-start justify-between p-4 md:px-6">
        {/* Top-Left: Real Geometry Minimap & Practice Range Controls */}
        <div className="flex flex-col gap-2">
          {showMinimap && (
            <div className="bg-[#090d16]/92 border border-slate-700/85 p-2 shadow-xl">
              <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 mb-1 px-0.5">
                <span className="text-slate-200 font-semibold">HAVEN-ZERO</span>
                <span className="text-cyan-400 uppercase">
                  {hud.isMultiplayer
                    ? `CODE:${hud.multiplayerRoomCode || 'ONLINE'}`
                    : hud.aiVisibleOnRadar
                      ? `AI:${hud.aiState.toUpperCase()}`
                      : `${hud.difficulty} AI`}
                </span>
              </div>
              <svg
                width="140"
                height="140"
                viewBox="0 0 140 140"
                className="bg-[#0d1424] border border-slate-800"
                aria-label="Tactical Minimap"
              >
                {/* Arena Boundary & Sector Guides */}
                <rect x="8" y="8" width="124" height="124" fill="#111a2e" stroke="#334155" strokeWidth="1.5" />
                <line x1="8" y1="70" x2="132" y2="70" stroke="#06b6d4" strokeWidth="0.7" strokeDasharray="3 3" strokeOpacity="0.5" />
                {/* West A-Long & East B-Link Lane Dividers */}
                <rect x="40" y="26" width="4" height="30" fill="#475569" />
                <rect x="40" y="84" width="4" height="30" fill="#475569" />
                <rect x="96" y="26" width="4" height="30" fill="#475569" />
                <rect x="96" y="84" width="4" height="30" fill="#475569" />
                {/* Spawn Wing Walls */}
                <rect x="52" y="101" width="10" height="3" fill="#64748b" />
                <rect x="78" y="101" width="10" height="3" fill="#64748b" />
                <rect x="52" y="36" width="10" height="3" fill="#64748b" />
                <rect x="78" y="36" width="10" height="3" fill="#64748b" />
                {/* Central Radianite Obelisk */}
                <rect x="65" y="65" width="10" height="10" fill="#0284c7" stroke="#38bdf8" strokeWidth="1" />
                {/* Sector Callout Labels */}
                <text x="14" y="73" fill="#f43f5e" fontSize="7" fontFamily="monospace" fontWeight="700">A</text>
                <text x="120" y="73" fill="#10b981" fontSize="7" fontFamily="monospace" fontWeight="700">B</text>
                {/* AI / Rival Opponent Blip (shown when in LOS, Recon active, or Practice) */}
                {hud.aiHealth > 0 && hud.aiVisibleOnRadar && (
                  <circle
                    cx={aiMini.x}
                    cy={aiMini.y}
                    r="4.5"
                    fill="#f43f5e"
                    stroke="#ffffff"
                    strokeWidth="1"
                  />
                )}
                {/* Player Position & Heading */}
                <g
                  transform={`translate(${pMini.x}, ${pMini.y}) rotate(${
                    (-hud.playerPosition.yaw * 180) / Math.PI
                  })`}
                >
                  <polygon points="0,-6 4.5,5 -4.5,5" fill="#10b981" stroke="#090d16" strokeWidth="1" />
                </g>
              </svg>
            </div>
          )}

          {/* Practice Range Sandbox Quick Bar */}
          {hud.isPracticeMode && (
            <div className="flex flex-wrap items-center gap-1.5 bg-[#090d16]/90 p-2 border border-cyan-500/40 pointer-events-auto max-w-[280px]">
              <span className="w-full text-[10px] font-mono text-cyan-400 font-semibold uppercase">
                Practice Sandbox Controls
              </span>
              <button
                type="button"
                tabIndex={-1}
                onClick={(e) => {
                  e.currentTarget.blur();
                  onPracticeAction('spawn_bot_mid');
                }}
                className="px-2 py-1 text-[11px] font-mono bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 cursor-pointer whitespace-nowrap"
              >
                Spawn Bot Mid
              </button>
              <button
                type="button"
                tabIndex={-1}
                onClick={(e) => {
                  e.currentTarget.blur();
                  onPracticeAction('refill_credits');
                }}
                className="px-2 py-1 text-[11px] font-mono bg-slate-800 hover:bg-slate-700 text-emerald-300 border border-slate-700 cursor-pointer whitespace-nowrap"
              >
                +9000 Credits
              </button>
              <button
                type="button"
                tabIndex={-1}
                data-testid="practice-heal-player"
                onClick={(e) => {
                  e.currentTarget.blur();
                  onPracticeAction('heal_player');
                }}
                className="px-2 py-1 text-[11px] font-mono bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 cursor-pointer whitespace-nowrap"
              >
                Heal + Shield
              </button>
              <button
                type="button"
                tabIndex={-1}
                data-testid="practice-sim-round"
                onClick={(e) => {
                  e.currentTarget.blur();
                  onPracticeAction('sim_round_win');
                }}
                className="px-2 py-1 text-[11px] font-mono bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-700 cursor-pointer whitespace-nowrap"
              >
                Sim Elimination
              </button>
            </div>
          )}
        </div>

        {/* Top-Center: Round Score, Timer & Phase Banner */}
        <div className="flex flex-col items-center gap-2">
          <div className="flex items-center bg-[#090d16]/94 border-t-2 border-t-rose-500 border-x border-b border-slate-700/90 shadow-2xl">
            {/* Player Score */}
            <div className="flex items-center gap-3 px-4 py-2 border-r border-slate-800">
              <div className="text-right">
                <span className="block text-[10px] font-mono text-emerald-400 uppercase tracking-wider font-semibold">
                  YOU // {op.id.toUpperCase()}
                </span>
                <span className="block text-[11px] font-mono text-slate-400 tabular-nums">
                  {hud.playerHealth} HP
                </span>
              </div>
              <span
                data-testid="hud-player-score"
                className="font-display font-bold text-3xl text-white tabular-nums hud-text-stroke"
              >
                {hud.playerScore}
              </span>
            </div>

            {/* Center Round & Timer */}
            <div className="flex flex-col items-center justify-center px-5 py-1.5 min-w-[120px] bg-slate-900/60">
              <span className="text-[10px] font-mono text-slate-400 uppercase tracking-widest">
                {hud.isPracticeMode ? 'PRACTICE' : `ROUND ${hud.roundNumber}`}
              </span>
              <span
                data-testid="hud-round-timer"
                className={`font-mono font-bold text-xl tabular-nums ${
                  hud.roundPhase === 'buy' ? 'text-amber-400' : 'text-white'
                }`}
              >
                {formattedTimer}
              </span>
              <span className="text-[9px] font-mono text-slate-400">
                FIRST TO {hud.targetRounds}
              </span>
            </div>

            {/* Opponent Score */}
            <div className="flex items-center gap-3 px-4 py-2 border-l border-slate-800">
              <span
                data-testid="hud-ai-score"
                className="font-display font-bold text-3xl text-rose-400 tabular-nums hud-text-stroke hud-glow-rose"
              >
                {hud.aiScore}
              </span>
              <div className="text-left">
                <span
                  data-testid="hud-opponent-callsign"
                  className="block text-[10px] font-mono text-rose-400 uppercase tracking-wider font-semibold"
                >
                  {hud.isMultiplayer ? hud.opponentCallsign || 'WAITING...' : 'RIVAL AI'}
                </span>
                <span className="block text-[11px] font-mono text-slate-300 tabular-nums">
                  {hud.aiHealth} HP ·{' '}
                  <strong data-testid="hud-ai-weapon" className="text-amber-300 uppercase">
                    {WEAPONS[hud.aiWeaponId].name}
                  </strong>
                </span>
              </div>
            </div>
          </div>

          {/* Live 1v1 Online Room Code & Telemetry Strip */}
          {hud.isMultiplayer && (
            <div
              data-testid="hud-multiplayer-banner"
              className="flex items-center gap-3 bg-[#091326]/94 border border-cyan-500/60 px-3.5 py-1 text-[11px] font-mono tracking-wider text-cyan-200 shadow-md"
            >
              <span>
                ROOM CODE: <strong className="text-white select-all">{hud.multiplayerRoomCode}</strong>
              </span>
              <span aria-hidden="true">·</span>
              <span className={hud.opponentConnected ? 'text-emerald-400 font-semibold' : 'text-amber-300'}>
                {hud.opponentConnected ? '2/2 CONNECTED' : 'WAITING FOR CHALLENGER (1/2)'}
              </span>
              <span aria-hidden="true">·</span>
              <span className="text-slate-300 tabular-nums">PING {hud.pingMs ?? 18}ms</span>
            </div>
          )}

          {/* Round Phase / Announcement Strip */}
          {hud.roundAnnouncement && (
            <div className="flex items-center gap-3 bg-[#090d16]/92 border border-slate-700 px-4 py-1.5 text-xs font-mono tracking-wider text-slate-100 pointer-events-auto shadow-lg">
              <span>{hud.roundAnnouncement}</span>
              {hud.roundPhase === 'buy' && (
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={(e) => {
                    e.currentTarget.blur();
                    onDeployNow();
                  }}
                  className="px-2.5 py-0.5 bg-rose-600 hover:bg-rose-500 text-white font-semibold uppercase text-[11px] cursor-pointer whitespace-nowrap"
                >
                  Start Combat Now
                </button>
              )}
            </div>
          )}

          {/* Active 3D Weapon Inspection Telemetry Banner */}
          {hud.isInspecting && (
            <div
              data-testid="hud-weapon-inspect-banner"
              className="flex flex-col gap-1 bg-[#090d16]/94 border border-cyan-400/80 px-4 py-2 text-xs font-mono text-slate-100 hud-panel-glow-cyan min-w-[300px]"
            >
              <div className="flex items-center justify-between gap-4">
                <span className="text-cyan-300 font-bold uppercase tracking-wider hud-glow-cyan">
                  INSPECTING // {activeWeaponSpec.name.toUpperCase()}
                </span>
                <span className="text-[10px] text-slate-400 uppercase">
                  {activeWeaponSpec.codeName}
                </span>
              </div>
              <div className="flex items-center justify-between text-[11px] text-slate-300 tabular-nums">
                <span>
                  DMG: <strong className="text-amber-300">{activeWeaponSpec.headDamage}</strong> HD /{' '}
                  <strong>{activeWeaponSpec.bodyDamage}</strong> BD
                </span>
                <span>ROF: {activeWeaponSpec.fireRate}/s</span>
                <span>MAG: {activeWeaponSpec.magSize}</span>
              </div>
              <div className="w-full h-1 bg-slate-800 overflow-hidden mt-0.5">
                <div
                  className="h-full bg-cyan-400 transition-all duration-75"
                  style={{ width: `${Math.round(hud.inspectProgress * 100)}%` }}
                />
              </div>
            </div>
          )}

          {/* Nearby Interactive Objective Prompt ([E]) */}
          {hud.nearbyObjective && (
            <button
              type="button"
              tabIndex={-1}
              onClick={(e) => {
                e.currentTarget.blur();
                onInteractObjective();
              }}
              className="px-4 py-1.5 bg-emerald-950/90 border border-emerald-500/70 text-emerald-300 font-mono text-xs pointer-events-auto cursor-pointer hover:bg-emerald-900/90"
            >
              {hud.nearbyObjective.actionHint}
            </button>
          )}
        </div>

        {/* Top-Right: Compact Utility Icon Controls + Kill Feed */}
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-1.5 pointer-events-auto">
            <button
              type="button"
              tabIndex={-1}
              data-testid="hud-inspect-weapon-btn"
              aria-label="Inspect Equipped Weapon"
              onClick={(e) => {
                e.currentTarget.blur();
                onInspectWeapon();
              }}
              className={`px-3 h-9 flex items-center gap-1.5 border font-mono text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors ${
                hud.isInspecting
                  ? 'bg-cyan-950/90 border-cyan-400 text-cyan-200'
                  : 'bg-[#090d16]/90 hover:bg-slate-800 text-cyan-300 border-slate-700'
              }`}
            >
              <span>Inspect [Y]</span>
            </button>

            <button
              type="button"
              tabIndex={-1}
              aria-label="Open Buy Armory"
              onClick={(e) => {
                e.currentTarget.blur();
                onOpenBuyMenu();
              }}
              className="px-3 h-9 flex items-center gap-1.5 bg-[#090d16]/90 hover:bg-slate-800 text-amber-300 border border-slate-700 font-mono text-xs font-semibold cursor-pointer whitespace-nowrap"
            >
              <span>Armory [B]</span>
            </button>

            <button
              type="button"
              tabIndex={-1}
              aria-label={muted ? 'Unmute Audio' : 'Mute Audio'}
              onClick={(e) => {
                e.currentTarget.blur();
                onToggleMute();
              }}
              className="w-9 h-9 flex items-center justify-center bg-[#090d16]/90 hover:bg-slate-800 text-slate-200 border border-slate-700 cursor-pointer"
            >
              {muted ? (
                <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M11 5L6 9H2v6h4l5 4V5z" />
                  <line x1="23" y1="9" x2="17" y2="15" />
                  <line x1="17" y1="9" x2="23" y2="15" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M11 5L6 9H2v6h4l5 4V5z" />
                  <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                  <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                </svg>
              )}
            </button>

            <button
              type="button"
              tabIndex={-1}
              aria-label="Restart Match"
              onClick={(e) => {
                e.currentTarget.blur();
                onRestartMatch();
              }}
              className="w-9 h-9 flex items-center justify-center bg-[#090d16]/90 hover:bg-slate-800 text-slate-200 border border-slate-700 cursor-pointer"
            >
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
              </svg>
            </button>

            <button
              type="button"
              tabIndex={-1}
              aria-label="Pause Game"
              onClick={(e) => {
                e.currentTarget.blur();
                onPause();
              }}
              className="px-3 h-9 flex items-center gap-1.5 bg-[#090d16]/90 hover:bg-slate-800 text-slate-200 border border-slate-700 font-mono text-xs font-semibold cursor-pointer whitespace-nowrap"
            >
              <span>Pause [Esc]</span>
            </button>
          </div>

          {/* Kill Feed Notifications with Tactical Weapon SVG Icons & CSS Entry/Exit Animations */}
          {animatedKillFeed.length > 0 && (
            <div
              data-testid="hud-killfeed"
              className="flex flex-col items-end gap-1.5 mt-1"
            >
              {animatedKillFeed.map((entry) => {
                const isPlayerKill = entry.killer === 'PLAYER';
                const weaponId = resolveKillFeedWeaponId(entry);
                const weaponSpec = WEAPONS[weaponId];
                const animClass =
                  entry.phase === 'exiting' ? 'killfeed-item-exit' : 'killfeed-item-enter';
                return (
                  <div
                    key={entry.id}
                    data-testid="hud-killfeed-item"
                    data-phase={entry.phase}
                    data-weapon-id={weaponId}
                    className={`flex items-center gap-2.5 px-3 py-1.5 bg-[#090d16]/94 border-y border-r border-slate-800 border-l-2 ${
                      isPlayerKill ? 'border-l-emerald-400' : 'border-l-rose-500'
                    } text-xs font-mono shadow-lg ${animClass}`}
                  >
                    <span
                      className={
                        isPlayerKill ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'
                      }
                    >
                      {isPlayerKill
                        ? 'YOU'
                        : hud.isMultiplayer
                          ? hud.opponentCallsign || 'RIVAL'
                          : 'RIVAL AI'}
                    </span>

                    <span
                      data-testid="hud-killfeed-weapon-icon"
                      data-weapon-id={weaponId}
                      title={weaponSpec.name}
                      aria-label={weaponSpec.name}
                      className="inline-flex items-center justify-center px-1.5 py-0.5 bg-slate-900/90 border border-slate-800/90"
                    >
                      <WeaponSvgIcon
                        weaponId={weaponId}
                        className={`w-12 h-4 ${
                          isPlayerKill ? 'text-slate-100' : 'text-rose-200'
                        }`}
                      />
                    </span>

                    {entry.isHeadshot && (
                      <span
                        data-testid="hud-killfeed-headshot"
                        title="Headshot Elimination"
                        className="inline-flex items-center gap-1 text-amber-400 font-bold text-[10px] tracking-tight"
                      >
                        <HeadshotSvgIcon className="w-3.5 h-3.5" />
                        <span>HS</span>
                      </span>
                    )}

                    <span
                      className={
                        entry.victim === 'PLAYER' ? 'text-emerald-400' : 'text-rose-400'
                      }
                    >
                      {entry.victim === 'PLAYER'
                        ? 'YOU'
                        : hud.isMultiplayer
                          ? hud.opponentCallsign || 'RIVAL'
                          : 'RIVAL AI'}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ====================================================================
          BOTTOM PERIMETER ROW: Vitality & Armor (Left) · Weapons & Ammo (Right)
      ==================================================================== */}
      <div className="fixed bottom-0 inset-x-0 flex items-end justify-between p-4 md:px-6 pointer-events-none">
        {/* Bottom-Left: Vitality Pips, Health, Ballistic Shield & Stance Cluster */}
        <div className="flex items-center gap-5 bg-[#090d16]/94 border-l-4 border-l-emerald-400 border-y border-r border-slate-700/90 px-5 py-3 shadow-2xl">
          {/* Health Readout (3:1 Hero-to-Kicker hierarchy) */}
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono text-slate-400 uppercase tracking-widest">
                HP // {op.name}
              </span>
              <span
                data-testid="hud-player-stance"
                className={`text-[9px] font-mono px-1.5 py-0.2 border ${
                  hud.isSliding
                    ? 'bg-cyan-950 text-cyan-200 border-cyan-400 font-bold'
                    : 'bg-slate-800 text-cyan-300 border-slate-700'
                }`}
              >
                {stanceLabel}
              </span>
            </div>
            <div className="flex items-baseline gap-2">
              <span
                data-testid="hud-player-health"
                className={`font-display font-bold text-4xl tabular-nums hud-text-stroke ${
                  hud.playerHealth <= 30 ? 'text-rose-500' : 'text-white'
                }`}
              >
                {Math.round(hud.playerHealth)}
              </span>
              {/* 5 Discrete Vitality Pips */}
              <div className="flex items-center gap-1 ml-1">
                {[20, 40, 60, 80, 100].map((threshold) => {
                  const full = hud.playerHealth >= threshold;
                  const partial = !full && hud.playerHealth > threshold - 20;
                  return (
                    <span
                      key={threshold}
                      className={`w-3 h-2.5 border ${
                        full
                          ? 'bg-emerald-400 border-emerald-300'
                          : partial
                            ? 'bg-amber-400 border-amber-300'
                            : 'bg-slate-900 border-slate-700'
                      }`}
                    />
                  );
                })}
              </div>
            </div>
          </div>

          <div className="h-10 w-px bg-slate-800" />

          {/* Ballistic Shield Readout */}
          <div className="flex items-center gap-2.5">
            <ShieldSvgIcon type={hud.playerArmorType} className="w-8 h-8" />
            <div className="flex flex-col">
              <span className="text-[10px] font-mono text-slate-400 uppercase tracking-widest">
                SHIELD
              </span>
              <span
                data-testid="hud-player-armor"
                className="font-display font-bold text-2xl text-cyan-400 tabular-nums hud-text-stroke hud-glow-cyan"
              >
                {Math.round(hud.playerArmor)}
              </span>
            </div>
          </div>
        </div>

        {/* Bottom-Right: Equipped Weapon, Magazine/Reserve & Slot Switcher */}
        <div className="flex flex-col items-end gap-2">
          {/* Owned Weapon Slots Strip + Inspect Trigger */}
          <div className="flex items-center gap-1.5 pointer-events-auto">
            {WEAPON_ORDER.map((wid) => {
              const spec = WEAPONS[wid];
              const inst = hud.ownedWeapons[wid];
              const isEquipped = hud.activeWeapon.id === wid;
              return (
                <button
                  key={wid}
                  type="button"
                  tabIndex={-1}
                  disabled={!inst}
                  onClick={(e) => {
                    e.currentTarget.blur();
                    if (inst) onEquipWeapon(wid);
                  }}
                  className={`px-2.5 py-1 text-xs font-mono border transition-colors ${
                    isEquipped
                      ? 'bg-rose-600/90 border-rose-400 text-white font-bold cursor-pointer hud-panel-glow-rose'
                      : inst
                        ? 'bg-[#090d16]/90 border-slate-700 text-slate-200 hover:border-slate-500 cursor-pointer'
                        : 'bg-[#090d16]/50 border-slate-800/60 text-slate-600 cursor-not-allowed'
                  }`}
                >
                  [{spec.slot}] {spec.name}
                </button>
              );
            })}
          </div>

          {/* Primary Ammo, Silhouette & Credits Cluster */}
          <div className="flex items-center gap-5 bg-[#090d16]/94 border-r-4 border-r-rose-500 border-y border-l border-slate-700/90 px-5 py-3 shadow-2xl">
            <div className="flex flex-col items-end">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono text-cyan-400 uppercase tracking-wider">
                  [Y] INSPECT
                </span>
                <span className="text-[10px] font-mono text-slate-300 font-semibold uppercase tracking-widest">
                  {activeWeaponSpec.codeName}
                </span>
              </div>
              <div className="flex items-baseline gap-1.5">
                <span
                  data-testid="hud-ammo-mag"
                  className={`font-display font-bold text-4xl tabular-nums hud-text-stroke ${
                    hud.activeWeapon.ammoInMag <= Math.ceil(activeWeaponSpec.magSize * 0.25)
                      ? 'text-amber-400'
                      : 'text-white'
                  }`}
                >
                  {hud.activeWeapon.ammoInMag}
                </span>
                <span className="font-mono text-lg text-slate-400 tabular-nums">
                  / {hud.activeWeapon.ammoReserve}
                </span>
              </div>
            </div>

            <WeaponSvgIcon
              weaponId={hud.activeWeapon.id}
              className="w-28 h-11 text-slate-100"
            />

            <div className="h-10 w-px bg-slate-800" />

            <div className="flex flex-col items-end">
              <span className="text-[10px] font-mono text-slate-400 uppercase tracking-widest">
                CREDITS
              </span>
              <span
                data-testid="hud-player-credits"
                className="font-mono font-bold text-xl text-emerald-400 tabular-nums"
              >
                ¤ {hud.playerCredits}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
