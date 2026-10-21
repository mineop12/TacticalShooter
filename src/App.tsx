/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { BuyMenuModal } from './components/BuyMenuModal';
import { GameHud } from './components/GameHud';
import { MatchOverModal } from './components/MatchOverModal';
import { MultiplayerModal } from './components/MultiplayerModal';
import { PauseSettingsModal } from './components/PauseSettingsModal';
import { TacticalCanvas, TacticalEngineAPI } from './components/TacticalCanvas';
import { TitleScreen } from './components/TitleScreen';
import { MultiplayerRole, MultiplayerRoomState } from './game/multiplayer';
import { STARTING_CREDITS, TARGET_ROUND_WINS } from './game/rules';
import {
  AIDifficulty,
  GameSettings,
  HudSnapshot,
  OperativeId,
} from './game/types';
import { DEFAULT_SETTINGS, WEAPONS } from './game/weapons';

const SETTINGS_STORAGE_KEY = 'vanguard_1v1_settings_v1';
const PROFILE_STORAGE_KEY = 'vanguard_1v1_profile_v1';
const SESSION_PLAYER_ID_KEY = 'vanguard_1v1_session_pid_v1';

function getOrCreateSessionPlayerId(): string {
  try {
    const existing = sessionStorage.getItem(SESSION_PLAYER_ID_KEY);
    if (existing) return existing;
    const created = `op_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    sessionStorage.setItem(SESSION_PLAYER_ID_KEY, created);
    return created;
  } catch {
    return `op_${Math.random().toString(36).slice(2, 10)}`;
  }
}

function loadSavedSettings(): GameSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (raw) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    }
  } catch {}
  return { ...DEFAULT_SETTINGS };
}

function loadSavedProfile(): {
  operative: OperativeId;
  difficulty: AIDifficulty;
  callsign: string;
} {
  try {
    const raw = localStorage.getItem(PROFILE_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.operative && parsed.difficulty) {
        return {
          operative: parsed.operative,
          difficulty: parsed.difficulty,
          callsign: parsed.callsign || 'STRIKER-01',
        };
      }
    }
  } catch {}
  return { operative: 'vex', difficulty: 'normal', callsign: 'STRIKER-01' };
}

const INITIAL_HUD: HudSnapshot = {
  appState: 'title',
  roundPhase: 'buy',
  roundNumber: 1,
  playerScore: 0,
  aiScore: 0,
  targetRounds: TARGET_ROUND_WINS,
  phaseTimeRemaining: 5,
  playerHealth: 100,
  playerMaxHealth: 100,
  playerArmor: 0,
  playerArmorType: 'none',
  playerCredits: STARTING_CREDITS,
  activeWeapon: {
    id: 'pistol',
    ammoInMag: WEAPONS.pistol.magSize,
    ammoReserve: WEAPONS.pistol.maxReserve,
  },
  ownedWeapons: {
    pistol: {
      id: 'pistol',
      ammoInMag: WEAPONS.pistol.magSize,
      ammoReserve: WEAPONS.pistol.maxReserve,
    },
    smg: null,
    shotgun: null,
    rifle: null,
    sniper: null,
  },
  isReloading: false,
  reloadProgress: 0,
  isInspecting: false,
  inspectProgress: 0,
  isAiming: false,
  isCrouching: false,
  isSliding: false,
  isWalking: false,
  aiHealth: 100,
  aiMaxHealth: 100,
  aiArmor: 25,
  aiState: 'patrol',
  aiWeaponId: 'pistol',
  aiVisibleOnRadar: false,
  aiPosition: { x: 0, z: -15 },
  playerPosition: { x: 0, z: 21, yaw: 0 },
  nearbyObjective: null,
  killFeed: [],
  lastHitFeedback: null,
  roundAnnouncement: null,
  roundWinner: null,
  isPracticeMode: false,
  difficulty: 'normal',
  operative: 'vex',
  pointerLocked: false,
  matchSummary: null,
};

export default function App() {
  const [playerId] = useState<string>(getOrCreateSessionPlayerId);
  const [settings, setSettings] = useState<GameSettings>(loadSavedSettings);
  const [profile, setProfile] = useState(loadSavedProfile);
  const [hud, setHud] = useState<HudSnapshot>(INITIAL_HUD);
  const [buyMenuOpen, setBuyMenuOpen] = useState(false);
  const [titleSettingsOpen, setTitleSettingsOpen] = useState(false);
  const [multiplayerModalOpen, setMultiplayerModalOpen] = useState(false);

  const engineApiRef = useRef<TacticalEngineAPI | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    } catch {}
  }, [settings]);

  useEffect(() => {
    try {
      localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
    } catch {}
  }, [profile]);

  const handleUpdateSettings = useCallback((partial: Partial<GameSettings>) => {
    setSettings((prev) => ({ ...prev, ...partial }));
  }, []);

  const handleRegisterApi = useCallback((api: TacticalEngineAPI) => {
    engineApiRef.current = api;
  }, []);

  const handleToggleBuyMenu = useCallback(() => {
    setBuyMenuOpen((prev) => {
      const next = !prev;
      if (next) {
        try {
          document.exitPointerLock?.();
        } catch {}
      }
      return next;
    });
  }, []);

  const handleStartMatch = useCallback(
    (practiceMode: boolean) => {
      setBuyMenuOpen(false);
      setTitleSettingsOpen(false);
      setMultiplayerModalOpen(false);
      engineApiRef.current?.startNewMatch(profile.operative, profile.difficulty, practiceMode);
    },
    [profile.operative, profile.difficulty]
  );

  const handleLaunchMultiplayerMatch = useCallback(
    (room: MultiplayerRoomState, role: MultiplayerRole, callsign: string) => {
      setBuyMenuOpen(false);
      setTitleSettingsOpen(false);
      setMultiplayerModalOpen(false);
      setProfile((p) => ({ ...p, callsign }));
      engineApiRef.current?.startMultiplayerMatch(
        room,
        role,
        playerId,
        callsign,
        profile.operative
      );
    },
    [playerId, profile.operative]
  );

  const handleResetDefaults = useCallback(() => {
    setSettings({ ...DEFAULT_SETTINGS });
    setProfile({ operative: 'vex', difficulty: 'normal', callsign: 'STRIKER-01' });
    try {
      localStorage.removeItem(SETTINGS_STORAGE_KEY);
      localStorage.removeItem(PROFILE_STORAGE_KEY);
    } catch {}
  }, []);

  return (
    <div className="relative w-full h-full overflow-hidden bg-[#0b0f17] select-none">
      {/* Isolated 3D WebGL Canvas Mount */}
      <TacticalCanvas
        settings={settings}
        onHudUpdate={setHud}
        onToggleBuyMenu={handleToggleBuyMenu}
        onRegisterApi={handleRegisterApi}
      />

      {/* State 1: Title Screen */}
      {hud.appState === 'title' && (
        <TitleScreen
          selectedOperative={profile.operative}
          selectedDifficulty={profile.difficulty}
          onSelectOperative={(operative) => setProfile((p) => ({ ...p, operative }))}
          onSelectDifficulty={(difficulty) => setProfile((p) => ({ ...p, difficulty }))}
          onStartMatch={handleStartMatch}
          onOpenMultiplayer={() => setMultiplayerModalOpen(true)}
          onOpenSettings={() => setTitleSettingsOpen(true)}
          onResetDefaults={handleResetDefaults}
        />
      )}

      {/* 1v1 Online Code Matchmaking & Lobby Modal */}
      {hud.appState === 'title' && multiplayerModalOpen && (
        <MultiplayerModal
          playerId={playerId}
          selectedOperative={profile.operative}
          defaultCallsign={profile.callsign}
          onSaveCallsign={(callsign) => setProfile((p) => ({ ...p, callsign }))}
          onLaunchMultiplayerMatch={handleLaunchMultiplayerMatch}
          onClose={() => setMultiplayerModalOpen(false)}
        />
      )}

      {/* Title Screen Settings Modal */}
      {hud.appState === 'title' && titleSettingsOpen && (
        <PauseSettingsModal
          isFromTitle={true}
          settings={settings}
          onUpdateSettings={handleUpdateSettings}
          onResume={() => setTitleSettingsOpen(false)}
          onReturnToTitle={() => setTitleSettingsOpen(false)}
        />
      )}

      {/* State 2: Active Gameplay HUD */}
      {hud.appState === 'playing' && (
        <GameHud
          hud={hud}
          crosshairColor={settings.crosshairColor}
          showMinimap={settings.showMinimap}
          muted={settings.muted}
          onToggleMute={() => handleUpdateSettings({ muted: !settings.muted })}
          onOpenBuyMenu={() => {
            try {
              document.exitPointerLock?.();
            } catch {}
            setBuyMenuOpen(true);
          }}
          onInspectWeapon={() => engineApiRef.current?.inspectWeapon()}
          onPause={() => {
            setBuyMenuOpen(false);
            engineApiRef.current?.pauseGame();
          }}
          onRestartMatch={() => {
            setBuyMenuOpen(false);
            engineApiRef.current?.restartMatch();
          }}
          onEquipWeapon={(wid) => engineApiRef.current?.equipWeapon(wid)}
          onDeployNow={() => engineApiRef.current?.skipBuyPhase()}
          onInteractObjective={() => engineApiRef.current?.interactObjective()}
          onPracticeAction={(action) => engineApiRef.current?.practiceAction(action)}
        />
      )}

      {/* Buy Menu Armory Modal */}
      {hud.appState === 'playing' && buyMenuOpen && (
        <BuyMenuModal
          hud={hud}
          onBuyWeapon={(wid) => engineApiRef.current?.purchaseWeapon(wid)}
          onBuyArmor={(atype) => engineApiRef.current?.purchaseArmor(atype)}
          onClose={() => setBuyMenuOpen(false)}
          onDeployNow={() => engineApiRef.current?.skipBuyPhase()}
        />
      )}

      {/* State 3: Pause & Settings Modal */}
      {hud.appState === 'paused' && (
        <PauseSettingsModal
          isFromTitle={false}
          settings={settings}
          onUpdateSettings={handleUpdateSettings}
          onResume={() => engineApiRef.current?.resumeGame()}
          onOpenBuyMenu={() => {
            engineApiRef.current?.resumeGame();
            setBuyMenuOpen(true);
          }}
          onRestartMatch={() => {
            setBuyMenuOpen(false);
            engineApiRef.current?.restartMatch();
          }}
          onReturnToTitle={() => {
            setBuyMenuOpen(false);
            engineApiRef.current?.returnToTitle();
          }}
        />
      )}

      {/* State 4: Victory / Defeat Match Over Modal */}
      {hud.appState === 'gameover' && hud.matchSummary && (
        <MatchOverModal
          summary={hud.matchSummary}
          onPlayAgain={() => engineApiRef.current?.restartMatch()}
          onReturnToTitle={() => engineApiRef.current?.returnToTitle()}
        />
      )}
    </div>
  );
}
