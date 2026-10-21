import React, { useCallback, useEffect, useState } from 'react';
import {
  isValidRoomCode,
  MultiplayerRole,
  MultiplayerRoomState,
  normalizeRoomCode,
} from '../game/multiplayer';
import { OperativeId } from '../game/types';
import { OPERATIVES } from '../game/weapons';

interface PublicRoomSummary {
  code: string;
  hostCallsign: string;
  hostOperative: OperativeId;
  createdAt: number;
}

interface MultiplayerModalProps {
  playerId: string;
  selectedOperative: OperativeId;
  defaultCallsign: string;
  onSaveCallsign: (callsign: string) => void;
  onLaunchMultiplayerMatch: (
    room: MultiplayerRoomState,
    role: MultiplayerRole,
    callsign: string
  ) => void;
  onClose: () => void;
}

export const MultiplayerModal: React.FC<MultiplayerModalProps> = ({
  playerId,
  selectedOperative,
  defaultCallsign,
  onSaveCallsign,
  onLaunchMultiplayerMatch,
  onClose,
}) => {
  const [callsign, setCallsign] = useState(defaultCallsign || 'STRIKER-01');
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [hostedRoom, setHostedRoom] = useState<MultiplayerRoomState | null>(null);
  const [waitingRooms, setWaitingRooms] = useState<PublicRoomSummary[]>([]);
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);

  const opProfile = OPERATIVES[selectedOperative];

  const fetchWaitingRooms = useCallback(async () => {
    try {
      const res = await fetch('/api/multiplayer/rooms');
      if (!res.ok) return;
      const data = await res.json();
      if (data.ok && Array.isArray(data.waitingRooms)) {
        setWaitingRooms(data.waitingRooms);
      }
    } catch {}
  }, []);

  useEffect(() => {
    fetchWaitingRooms();
    const timer = window.setInterval(fetchWaitingRooms, 2500);
    return () => window.clearInterval(timer);
  }, [fetchWaitingRooms]);

  // If waiting in modal for challenger to join hosted room, poll room status & auto-launch when guest joins
  useEffect(() => {
    if (!hostedRoom) return;
    let active = true;
    const pollRoom = async () => {
      try {
        const res = await fetch(`/api/multiplayer/room/${hostedRoom.code}`);
        if (!res.ok || !active) return;
        const data = await res.json();
        if (data.ok && data.room) {
          setHostedRoom(data.room);
          if (data.room.guest) {
            onLaunchMultiplayerMatch(data.room, 'host', callsign);
          }
        }
      } catch {}
    };
    const interval = window.setInterval(pollRoom, 800);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [hostedRoom, callsign, onLaunchMultiplayerMatch]);

  const handleCallsignChange = (val: string) => {
    const clean = val.toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 14);
    setCallsign(clean);
    onSaveCallsign(clean || 'STRIKER-01');
  };

  const handleCreateRoom = async (isPublicQueue: boolean) => {
    setErrorMsg(null);
    setLoadingAction(isPublicQueue ? 'public' : 'private');
    try {
      const finalCallsign = callsign.trim() || 'ALPHA-01';
      const res = await fetch('/api/multiplayer/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playerId,
          callsign: finalCallsign,
          operative: selectedOperative,
          isPublicQueue,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setErrorMsg(data.error || 'Failed to create tactical room.');
      } else {
        setHostedRoom(data.room);
        fetchWaitingRooms();
      }
    } catch {
      setErrorMsg('Network error while contacting matchmaking server.');
    } finally {
      setLoadingAction(null);
    }
  };

  const handleJoinByCode = async (rawCode: string) => {
    const norm = normalizeRoomCode(rawCode);
    if (!isValidRoomCode(norm)) {
      setErrorMsg('Enter a valid 6-character room code (e.g. 7K9X2M).');
      return;
    }
    setErrorMsg(null);
    setLoadingAction('join');
    try {
      const finalCallsign = callsign.trim() || 'BRAVO-02';
      const res = await fetch('/api/multiplayer/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: norm,
          playerId,
          callsign: finalCallsign,
          operative: selectedOperative,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setErrorMsg(data.error || `Could not join room ${norm}.`);
      } else {
        onLaunchMultiplayerMatch(data.room, data.role, finalCallsign);
      }
    } catch {
      setErrorMsg('Network error while joining room.');
    } finally {
      setLoadingAction(null);
    }
  };

  const handleQuickMatch = async () => {
    setErrorMsg(null);
    setLoadingAction('quickmatch');
    try {
      const finalCallsign = callsign.trim() || 'STRIKER-01';
      const res = await fetch('/api/multiplayer/quickmatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playerId,
          callsign: finalCallsign,
          operative: selectedOperative,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setErrorMsg(data.error || 'Quick-match failed.');
      } else if (data.matchedImmediately || data.room.guest) {
        onLaunchMultiplayerMatch(data.room, data.role, finalCallsign);
      } else {
        setHostedRoom(data.room);
        fetchWaitingRooms();
      }
    } catch {
      setErrorMsg('Network error while entering matchmaking queue.');
    } finally {
      setLoadingAction(null);
    }
  };

  const handleCopyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(true);
      window.setTimeout(() => setCopiedCode(false), 2000);
    } catch {}
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="1v1 Online Multiplayer Matchmaking"
      className="fixed inset-0 z-30 flex items-center justify-center p-4 md:p-6 bg-[#060911]/90 pointer-events-auto"
    >
      <div className="w-full max-w-3xl bg-[#0b111e] border border-slate-700 shadow-2xl flex flex-col max-h-[92vh] overflow-y-auto">
        {/* Modal Header */}
        <div className="flex items-center justify-between gap-4 px-6 py-4 bg-[#0f172a] border-b border-slate-800">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="w-2.5 h-2.5 bg-emerald-400 inline-block" />
              <h2 className="font-display font-bold text-lg sm:text-xl tracking-wider uppercase text-white">
                1v1 Tactical Matchmaking // Code & Queue
              </h2>
            </div>
            <p className="text-xs font-mono text-slate-400 mt-0.5">
              REAL-TIME WEBSOCKET SERVER · FIRST TO 13 ROUNDS · AUTHORITATIVE HIT & ECONOMY SYNC
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 font-mono text-xs font-semibold uppercase tracking-wider border border-slate-600 transition-colors cursor-pointer"
          >
            Back [Esc]
          </button>
        </div>

        <div className="p-5 sm:p-6 flex flex-col gap-5">
          {/* Row 1: Operative Identity & Callsign */}
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-4 items-center bg-[#0f1624] p-4 border border-slate-800">
            <div className="sm:col-span-6 flex flex-col gap-1">
              <label
                htmlFor="mp-callsign-input"
                className="text-[11px] font-mono text-slate-400 uppercase tracking-wider"
              >
                OPERATIVE CALLSIGN (DISPLAYED IN KILLFEED & HUD)
              </label>
              <input
                id="mp-callsign-input"
                data-testid="mp-callsign-input"
                type="text"
                value={callsign}
                onChange={(e) => handleCallsignChange(e.target.value)}
                placeholder="STRIKER-01"
                maxLength={14}
                className="bg-[#090d16] border border-slate-700 focus:border-cyan-400 text-white font-mono font-bold text-sm px-3 py-2 outline-none uppercase tracking-wider"
              />
            </div>

            <div className="sm:col-span-6 flex items-center justify-between sm:justify-end gap-4 border-t sm:border-t-0 sm:border-l border-slate-800 pt-3 sm:pt-0 sm:pl-4">
              <div>
                <span className="text-[10px] font-mono text-slate-400 block uppercase">
                  ACTIVE RIG
                </span>
                <span className="font-display font-bold text-sm text-white uppercase tracking-wide">
                  {opProfile.name}
                </span>
                <span className="text-xs font-mono text-rose-400 block">
                  {opProfile.role}
                </span>
              </div>
              <button
                type="button"
                data-testid="mp-quickmatch-btn"
                disabled={Boolean(loadingAction)}
                onClick={handleQuickMatch}
                className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-display font-bold text-xs uppercase tracking-wider transition-colors cursor-pointer whitespace-nowrap shadow-md"
              >
                {loadingAction === 'quickmatch' ? 'Searching...' : 'Quick Match 1v1'}
              </button>
            </div>
          </div>

          {/* Active Hosted Room Banner (When Waiting for Challenger) */}
          {hostedRoom && (
            <div
              data-testid="mp-hosted-room-panel"
              className="bg-[#091326] border-2 border-cyan-400/80 p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
            >
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono font-bold uppercase tracking-wider text-cyan-300">
                    ROOM READY // SHARE 6-DIGIT CODE WITH OPPONENT
                  </span>
                </div>
                <div className="flex items-center gap-3 mt-1">
                  <span
                    data-testid="mp-room-code-display"
                    className="font-mono font-bold text-3xl sm:text-4xl tracking-[0.22em] text-white bg-[#060911] px-4 py-2 border border-cyan-500/50 select-all"
                  >
                    {hostedRoom.code}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleCopyCode(hostedRoom.code)}
                    className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-cyan-300 font-mono text-xs font-semibold uppercase border border-cyan-500/40 transition-colors cursor-pointer"
                  >
                    {copiedCode ? 'Copied!' : 'Copy Code'}
                  </button>
                </div>
                <span className="text-xs font-mono text-slate-300 mt-1">
                  Status: Waiting for Player 2 to join code{' '}
                  <strong className="text-white">{hostedRoom.code}</strong> (1/2 connected)...
                </span>
              </div>

              <div className="flex flex-col sm:items-end gap-2 w-full sm:w-auto">
                <button
                  type="button"
                  data-testid="mp-enter-arena-host-btn"
                  onClick={() =>
                    onLaunchMultiplayerMatch(
                      hostedRoom,
                      'host',
                      callsign.trim() || 'ALPHA-01'
                    )
                  }
                  className="w-full sm:w-auto px-5 py-3 bg-rose-600 hover:bg-rose-500 text-white font-display font-bold text-sm uppercase tracking-wider transition-colors cursor-pointer whitespace-nowrap"
                >
                  Enter Arena Warmup Now
                </button>
                <span className="text-[11px] font-mono text-slate-400">
                  Match starts automatically when challenger joins
                </span>
              </div>
            </div>
          )}

          {/* Row 2: Two-Column Split -> Create Code Room vs Join By Room Code */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Column A: Create Private / Public Room Code */}
            <div className="bg-[#0f1624] border border-slate-800 p-4 flex flex-col justify-between gap-4">
              <div>
                <div className="text-xs font-mono text-rose-400 font-semibold uppercase tracking-wider">
                  01. HOST 1V1 DUEL ROOM
                </div>
                <h3 className="font-display font-bold text-base text-white uppercase mt-1">
                  Generate Tactical Match Code
                </h3>
                <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                  Create a dedicated 1v1 arena instance with a unique 6-character room code. Share
                  the code with a friend or open it to the public lobby list.
                </p>
              </div>

              <div className="flex flex-col sm:flex-row gap-2">
                <button
                  type="button"
                  data-testid="mp-create-private-btn"
                  disabled={Boolean(loadingAction)}
                  onClick={() => handleCreateRoom(false)}
                  className="flex-1 py-2.5 px-4 bg-rose-600 hover:bg-rose-500 text-white font-display font-bold text-xs uppercase tracking-wider transition-colors cursor-pointer"
                >
                  {loadingAction === 'private' ? 'Creating...' : 'Create Code Room'}
                </button>
                <button
                  type="button"
                  data-testid="mp-create-public-btn"
                  disabled={Boolean(loadingAction)}
                  onClick={() => handleCreateRoom(true)}
                  className="py-2.5 px-4 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-600 font-mono font-semibold text-xs uppercase tracking-wider transition-colors cursor-pointer"
                >
                  Host Public Lobby
                </button>
              </div>
            </div>

            {/* Column B: Join Existing Room by 6-Character Code */}
            <div className="bg-[#0f1624] border border-slate-800 p-4 flex flex-col justify-between gap-4">
              <div>
                <div className="text-xs font-mono text-cyan-400 font-semibold uppercase tracking-wider">
                  02. JOIN BY MATCH CODE
                </div>
                <h3 className="font-display font-bold text-base text-white uppercase mt-1">
                  Enter 6-Digit Room Code
                </h3>
                <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                  Have a room code from another operative? Enter the 6-character code below to
                  deploy directly into their 1v1 arena as Challenger.
                </p>
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleJoinByCode(joinCodeInput);
                }}
                className="flex items-stretch gap-2"
              >
                <input
                  type="text"
                  data-testid="mp-join-code-input"
                  value={joinCodeInput}
                  onChange={(e) => setJoinCodeInput(normalizeRoomCode(e.target.value))}
                  placeholder="E.G. 7K9X2M"
                  maxLength={6}
                  aria-label="6-Character Room Code"
                  className="flex-1 min-w-0 bg-[#090d16] border border-slate-700 focus:border-cyan-400 text-white font-mono font-bold text-base tracking-[0.2em] px-3 py-2 uppercase outline-none"
                />
                <button
                  type="submit"
                  data-testid="mp-join-code-submit"
                  disabled={Boolean(loadingAction)}
                  className="px-5 py-2.5 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-display font-bold text-xs uppercase tracking-wider transition-colors cursor-pointer shrink-0"
                >
                  {loadingAction === 'join' ? 'Joining...' : 'Join Room'}
                </button>
              </form>
            </div>
          </div>

          {/* Error Feedback Banner */}
          {errorMsg && (
            <div
              role="alert"
              data-testid="mp-error-banner"
              className="bg-rose-950/70 border border-rose-500/70 text-rose-200 font-mono text-xs px-4 py-2.5"
            >
              ERROR // {errorMsg}
            </div>
          )}

          {/* Row 3: Live Open Waiting Lobbies */}
          <div className="bg-[#0f1624] border border-slate-800 p-4 flex flex-col gap-2.5">
            <div className="flex items-center justify-between text-xs font-mono text-slate-400 border-b border-slate-800 pb-2">
              <span>03. LIVE WAITING 1V1 LOBBIES ({waitingRooms.length} AVAILABLE)</span>
              <button
                type="button"
                onClick={fetchWaitingRooms}
                className="text-cyan-400 hover:text-cyan-300 cursor-pointer uppercase"
              >
                Refresh List
              </button>
            </div>

            {waitingRooms.length === 0 ? (
              <div className="text-xs font-mono text-slate-400 py-3 text-center">
                No public lobbies waiting right now. Click{' '}
                <strong className="text-slate-200">Create Code Room</strong> or{' '}
                <strong className="text-emerald-400">Quick Match 1v1</strong> to host one.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-36 overflow-y-auto">
                {waitingRooms.map((rm) => {
                  const isOwnRoom = hostedRoom?.code === rm.code;
                  return (
                    <div
                      key={rm.code}
                      className="flex items-center justify-between gap-2 bg-[#090d16] border border-slate-800 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-sm text-cyan-300 tracking-wider">
                            {rm.code}
                          </span>
                          <span className="text-xs font-mono text-white truncate">
                            {rm.hostCallsign}
                          </span>
                        </div>
                        <span className="text-[10px] font-mono text-slate-400 uppercase">
                          HOST RIG: {OPERATIVES[rm.hostOperative]?.name || rm.hostOperative}
                        </span>
                      </div>

                      {isOwnRoom ? (
                        <span className="text-[10px] font-mono text-emerald-400 uppercase px-2 py-1 border border-emerald-500/40">
                          Your Lobby
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleJoinByCode(rm.code)}
                          className="px-3 py-1.5 bg-cyan-500/20 hover:bg-cyan-500 text-cyan-300 hover:text-slate-950 border border-cyan-500/50 font-mono font-bold text-xs uppercase transition-colors cursor-pointer shrink-0"
                        >
                          Join [1/2]
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
