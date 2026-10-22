import React, { useCallback, useEffect, useState } from 'react';
import {
  isValidRoomCode,
  MultiplayerRole,
  MultiplayerRoomState,
  normalizeRoomCode,
} from '../game/multiplayer';
import {
  createRoomClient,
  fetchWaitingRoomsClient,
  fillWithSimulatedChallengerClient,
  getCustomServerUrl,
  getDetectedTransportMode,
  getRoomByCodeClient,
  isVercelHost,
  joinRoomByCodeClient,
  PublicRoomSummary,
  quickMatchClient,
  setCustomServerUrl,
} from '../game/multiplayerClient';
import { OperativeId } from '../game/types';
import { OPERATIVES } from '../game/weapons';

interface MultiplayerModalProps {
  playerId: string;
  selectedOperative: OperativeId;
  defaultCallsign: string;
  initialRoomCode?: string;
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
  initialRoomCode,
  onSaveCallsign,
  onLaunchMultiplayerMatch,
  onClose,
}) => {
  const [callsign, setCallsign] = useState(defaultCallsign || 'STRIKER-01');
  const [joinCodeInput, setJoinCodeInput] = useState(
    initialRoomCode ? normalizeRoomCode(initialRoomCode) : ''
  );
  const [hostedRoom, setHostedRoom] = useState<MultiplayerRoomState | null>(null);
  const [waitingRooms, setWaitingRooms] = useState<PublicRoomSummary[]>([]);
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [showNetworkSettings, setShowNetworkSettings] = useState(false);
  const [customUrlInput, setCustomUrlInput] = useState(() => getCustomServerUrl());
  const [customUrlSaved, setCustomUrlSaved] = useState(false);

  const isVercel = isVercelHost();
  const transportMode = getDetectedTransportMode();

  const opProfile = OPERATIVES[selectedOperative];

  const fetchWaitingRooms = useCallback(async () => {
    try {
      const res = await fetchWaitingRoomsClient();
      setWaitingRooms(res.waitingRooms);
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
        const res = await getRoomByCodeClient(hostedRoom.code);
        if (!res.ok || !res.room || !active) return;
        setHostedRoom(res.room);
        if (res.room.guest) {
          onLaunchMultiplayerMatch(res.room, 'host', callsign);
        }
      } catch {}
    };
    const interval = window.setInterval(pollRoom, 650);
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
      const data = await createRoomClient({
        playerId,
        callsign: finalCallsign,
        operative: selectedOperative,
        isPublicQueue,
      });
      setHostedRoom(data.room);
      fetchWaitingRooms();
    } catch {
      setErrorMsg('Failed to initialize tactical room.');
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
      const data = await joinRoomByCodeClient({
        code: norm,
        playerId,
        callsign: finalCallsign,
        operative: selectedOperative,
      });
      if (!data.ok) {
        setErrorMsg(data.error || `Could not join room ${norm}.`);
      } else {
        onLaunchMultiplayerMatch(data.room, data.role, finalCallsign);
      }
    } catch {
      setErrorMsg(`Could not join room ${norm}.`);
    } finally {
      setLoadingAction(null);
    }
  };

  const handleQuickMatch = async () => {
    setErrorMsg(null);
    setLoadingAction('quickmatch');
    try {
      const finalCallsign = callsign.trim() || 'STRIKER-01';
      const data = await quickMatchClient({
        playerId,
        callsign: finalCallsign,
        operative: selectedOperative,
      });
      if (data.matchedImmediately || data.room.guest) {
        onLaunchMultiplayerMatch(data.room, data.role, finalCallsign);
      } else {
        setHostedRoom(data.room);
        fetchWaitingRooms();
      }
    } catch {
      setErrorMsg('Failed to enter matchmaking queue.');
    } finally {
      setLoadingAction(null);
    }
  };

  const handleFillSimulatedChallenger = async () => {
    if (!hostedRoom) return;
    setLoadingAction('simfill');
    try {
      const updatedRoom = await fillWithSimulatedChallengerClient(
        hostedRoom.code,
        selectedOperative
      );
      if (updatedRoom) {
        onLaunchMultiplayerMatch(updatedRoom, 'host', callsign.trim() || 'ALPHA-01');
      }
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

  const handleCopyInviteLink = async (code: string) => {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('room', code);
      await navigator.clipboard.writeText(url.toString());
      setCopiedLink(true);
      window.setTimeout(() => setCopiedLink(false), 2000);
    } catch {}
  };

  const handleSaveCustomUrl = (e: React.FormEvent) => {
    e.preventDefault();
    setCustomServerUrl(customUrlInput);
    setCustomUrlSaved(true);
    fetchWaitingRooms();
    window.setTimeout(() => setCustomUrlSaved(false), 2500);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="1v1 Online Multiplayer Matchmaking"
      className="fixed inset-0 z-30 flex items-center justify-center p-4 md:p-6 bg-[#040711]/90 backdrop-blur-md pointer-events-auto"
    >
      <div className="w-full max-w-4xl bg-[#080d19] border border-slate-700/80 shadow-2xl flex flex-col max-h-[90vh] overflow-y-auto">
        {/* Modal Header */}
        <div className="flex items-center justify-between gap-4 px-6 py-4 bg-[#0c1322] border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <h2 className="font-display font-bold text-lg sm:text-xl tracking-wide uppercase text-white">
                  1v1 Online Matchmaking
                </h2>
                <span className="px-2 py-0.5 bg-slate-800/90 border border-slate-700 text-[10px] font-mono text-cyan-300 uppercase rounded-xs">
                  {transportMode === 'webrtc'
                    ? 'WebRTC Cloud P2P'
                    : transportMode === 'server'
                    ? 'Dedicated Server'
                    : 'Mesh Transport'}
                </span>
              </div>
              <p className="text-xs font-sans text-slate-400 mt-0.5">
                First to 13 Rounds · Real-Time Combat Sync · Authoritative Hit Reg
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setShowNetworkSettings((prev) => !prev)}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-sans text-xs uppercase tracking-wider border border-slate-700 rounded-xs transition-colors cursor-pointer"
            >
              {showNetworkSettings ? 'Close Network' : 'Network Settings'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 bg-slate-800 hover:bg-rose-950/60 text-slate-300 hover:text-rose-300 font-sans text-xs font-semibold uppercase tracking-wider border border-slate-700 hover:border-rose-500/50 rounded-xs transition-colors cursor-pointer"
            >
              Back [Esc]
            </button>
          </div>
        </div>

        {/* Network & Server Settings Drawer */}
        {showNetworkSettings && (
          <div className="bg-[#050913] border-b border-slate-800 px-6 py-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-sans text-cyan-300 font-bold uppercase tracking-wider">
                Multiplayer Transport & Server Routing
              </span>
              <span className="text-xs font-mono text-slate-400">
                Transport: <strong className="text-white uppercase">{transportMode}</strong>
              </span>
            </div>
            <form onSubmit={handleSaveCustomUrl} className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={customUrlInput}
                onChange={(e) => setCustomUrlInput(e.target.value)}
                placeholder="Optional custom WebSocket/REST server URL (e.g. https://...)"
                className="flex-1 bg-[#0b101c] border border-slate-700 focus:border-cyan-400 text-white font-mono text-xs px-3 py-2 outline-none rounded-xs"
              />
              <button
                type="submit"
                className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-sans font-bold text-xs uppercase tracking-wider transition-colors cursor-pointer rounded-xs whitespace-nowrap"
              >
                {customUrlSaved ? 'Saved!' : 'Save Server URL'}
              </button>
              {customUrlInput && (
                <button
                  type="button"
                  onClick={() => {
                    setCustomUrlInput('');
                    setCustomServerUrl('');
                    setCustomUrlSaved(true);
                    fetchWaitingRooms();
                    window.setTimeout(() => setCustomUrlSaved(false), 2000);
                  }}
                  className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-sans text-xs uppercase border border-slate-700 transition-colors cursor-pointer rounded-xs"
                >
                  Reset
                </button>
              )}
            </form>
            <p className="text-xs font-sans text-slate-400">
              Default is automatic WebRTC Cloud P2P mesh (works seamlessly across devices and on Vercel with zero setup).
            </p>
          </div>
        )}

        <div className="p-6 flex flex-col gap-5">
          {/* Vercel Hosting Tip Notice */}
          {isVercel && (
            <div className="bg-amber-950/30 border border-amber-500/40 p-3.5 rounded-xs flex flex-col gap-1 text-xs font-sans text-amber-200">
              <div className="font-bold text-amber-400 flex items-center gap-2">
                <span>⚡ Hosted on Vercel · Peer-to-Peer Cloud Matchmaking Active</span>
              </div>
              <p className="text-amber-300/80 leading-relaxed">
                If your opponent is redirected to a login screen when opening your link, go to your <strong>Vercel Dashboard &gt; Settings &gt; Deployment Protection</strong> and turn off <em>Vercel Authentication</em> so any player can join without an account.
              </p>
            </div>
          )}

          {/* Player Identity & Instant Quick Match Row */}
          <div className="bg-[#0c1424] p-4 border border-slate-800 rounded-xs flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 w-full md:w-auto">
              <div className="flex flex-col gap-1 w-full sm:w-64">
                <label
                  htmlFor="mp-callsign-input"
                  className="text-xs font-sans font-medium text-slate-400 uppercase tracking-wide"
                >
                  Your Operative Callsign
                </label>
                <input
                  id="mp-callsign-input"
                  data-testid="mp-callsign-input"
                  type="text"
                  value={callsign}
                  onChange={(e) => handleCallsignChange(e.target.value)}
                  placeholder="STRIKER-01"
                  maxLength={14}
                  className="bg-[#060911] border border-slate-700 focus:border-cyan-400 text-white font-mono font-bold text-sm px-3 py-2 outline-none uppercase tracking-wider rounded-xs"
                />
              </div>

              <div className="sm:border-l sm:border-slate-800 sm:pl-3 pt-2 sm:pt-0">
                <span className="text-[11px] font-sans text-slate-400 block uppercase">
                  Active Rig
                </span>
                <span className="font-display font-bold text-sm text-white uppercase tracking-wide">
                  {opProfile.name.split('//')[0].trim()}
                </span>
                <span className="text-xs font-sans text-rose-400 block">
                  {opProfile.role}
                </span>
              </div>
            </div>

            <button
              type="button"
              data-testid="mp-quickmatch-btn"
              disabled={Boolean(loadingAction)}
              onClick={handleQuickMatch}
              className="w-full md:w-auto px-6 py-3 bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-500 text-white font-display font-bold text-sm uppercase tracking-wider transition-all duration-150 cursor-pointer whitespace-nowrap shadow-lg shadow-emerald-950/40 rounded-xs flex items-center justify-center gap-2"
            >
              <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
              <span>{loadingAction === 'quickmatch' ? 'Searching Match...' : 'Quick Match 1v1'}</span>
            </button>
          </div>

          {/* Active Hosted Room Banner */}
          {hostedRoom && (
            <div
              data-testid="mp-hosted-room-panel"
              className="bg-gradient-to-b from-[#09152b] to-[#060e1d] border-2 border-cyan-400/70 p-5 rounded-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-5 shadow-xl shadow-cyan-950/30"
            >
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
                  <span className="text-xs font-sans font-bold uppercase tracking-wider text-cyan-300">
                    Room Ready · Share Code with Challenger
                  </span>
                </div>
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
                  <span
                    data-testid="mp-room-code-display"
                    className="font-mono font-bold text-3xl sm:text-4xl tracking-[0.25em] text-white bg-[#03060c] px-4 py-2 border border-cyan-500/50 rounded-xs select-all shadow-inner"
                  >
                    {hostedRoom.code}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleCopyCode(hostedRoom.code)}
                      className="px-3.5 py-2.5 bg-slate-800 hover:bg-slate-700 text-cyan-300 font-sans text-xs font-semibold uppercase border border-cyan-500/40 transition-colors cursor-pointer rounded-xs whitespace-nowrap"
                    >
                      {copiedCode ? '✓ Copied' : 'Copy Code'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCopyInviteLink(hostedRoom.code)}
                      className="px-3.5 py-2.5 bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-sans text-xs font-bold uppercase transition-colors cursor-pointer rounded-xs shadow whitespace-nowrap"
                    >
                      {copiedLink ? '✓ Link Copied' : 'Copy Invite Link'}
                    </button>
                  </div>
                </div>
                <p className="text-xs font-sans text-slate-300 mt-0.5">
                  Waiting for Player 2 to join code{' '}
                  <strong className="text-white font-mono">{hostedRoom.code}</strong> (1/2 connected)
                </p>
              </div>

              <div className="flex flex-col sm:items-end gap-2 w-full md:w-auto">
                <div className="flex flex-col sm:flex-row gap-2 w-full md:w-auto">
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
                    className="px-4 py-2.5 bg-rose-600 hover:bg-rose-500 text-white font-display font-bold text-xs uppercase tracking-wider transition-colors cursor-pointer rounded-xs whitespace-nowrap shadow-md"
                  >
                    Enter Arena Warmup
                  </button>
                  <button
                    type="button"
                    data-testid="mp-fill-sim-challenger-btn"
                    disabled={Boolean(loadingAction)}
                    onClick={handleFillSimulatedChallenger}
                    className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 font-sans font-semibold text-xs uppercase tracking-wider transition-colors cursor-pointer rounded-xs whitespace-nowrap"
                  >
                    {loadingAction === 'simfill' ? 'Deploying...' : 'Fill AI Opponent'}
                  </button>
                </div>
                <span className="text-[11px] font-sans text-slate-400">
                  Match automatically initiates once Challenger connects
                </span>
              </div>
            </div>
          )}

          {/* Two-Column Match Actions: Host vs Join */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Host Tactical Arena */}
            <div className="bg-[#0b1220] border border-slate-800/90 p-5 rounded-xs flex flex-col justify-between gap-4">
              <div>
                <div className="text-xs font-mono font-bold text-rose-400 uppercase tracking-wider">
                  01. Host 1v1 Room
                </div>
                <h3 className="font-display font-bold text-base text-white uppercase tracking-wide mt-1">
                  Create Room Code
                </h3>
                <p className="text-xs font-sans text-slate-400 mt-1.5 leading-relaxed">
                  Generate a private 6-character room code to invite a friend, or broadcast your room to the public lobby browser.
                </p>
              </div>

              <div className="flex flex-col sm:flex-row gap-2 pt-2">
                <button
                  type="button"
                  data-testid="mp-create-private-btn"
                  disabled={Boolean(loadingAction)}
                  onClick={() => handleCreateRoom(false)}
                  className="flex-1 py-2.5 px-4 bg-rose-600 hover:bg-rose-500 text-white font-display font-bold text-xs uppercase tracking-wider transition-colors cursor-pointer rounded-xs whitespace-nowrap shadow-md shadow-rose-950/30"
                >
                  {loadingAction === 'private' ? 'Creating...' : 'Create Private Room'}
                </button>
                <button
                  type="button"
                  data-testid="mp-create-public-btn"
                  disabled={Boolean(loadingAction)}
                  onClick={() => handleCreateRoom(true)}
                  className="py-2.5 px-4 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-sans font-medium text-xs uppercase tracking-wider transition-colors cursor-pointer rounded-xs whitespace-nowrap"
                >
                  Host Public Lobby
                </button>
              </div>
            </div>

            {/* Join by Match Code */}
            <div className="bg-[#0b1220] border border-slate-800/90 p-5 rounded-xs flex flex-col justify-between gap-4">
              <div>
                <div className="text-xs font-mono font-bold text-cyan-400 uppercase tracking-wider">
                  02. Join By Code
                </div>
                <h3 className="font-display font-bold text-base text-white uppercase tracking-wide mt-1">
                  Enter 6-Digit Room Code
                </h3>
                <p className="text-xs font-sans text-slate-400 mt-1.5 leading-relaxed">
                  Have a challenge code from another operative? Enter it below to join their 1v1 arena instance immediately.
                </p>
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleJoinByCode(joinCodeInput);
                }}
                className="flex items-stretch gap-2 pt-2"
              >
                <input
                  type="text"
                  data-testid="mp-join-code-input"
                  value={joinCodeInput}
                  onChange={(e) => setJoinCodeInput(normalizeRoomCode(e.target.value))}
                  placeholder="6-DIGIT CODE"
                  maxLength={6}
                  aria-label="6-Character Room Code"
                  className="flex-1 min-w-0 bg-[#060911] border border-slate-700 focus:border-cyan-400 text-white font-mono font-bold text-base tracking-widest px-3.5 py-2.5 uppercase outline-none rounded-xs placeholder:font-normal placeholder:tracking-normal placeholder:text-slate-500"
                />
                <button
                  type="submit"
                  data-testid="mp-join-code-submit"
                  disabled={Boolean(loadingAction)}
                  className="px-5 py-2.5 bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-display font-bold text-xs uppercase tracking-wider transition-colors cursor-pointer shrink-0 rounded-xs shadow"
                >
                  {loadingAction === 'join' ? 'Joining...' : 'Join Match'}
                </button>
              </form>
            </div>
          </div>

          {/* Error Feedback Banner */}
          {errorMsg && (
            <div
              role="alert"
              data-testid="mp-error-banner"
              className="bg-rose-950/70 border border-rose-500/70 text-rose-200 font-sans text-xs px-4 py-2.5 rounded-xs"
            >
              {errorMsg}
            </div>
          )}

          {/* Live Open Waiting Lobbies */}
          <div className="bg-[#0b1220] border border-slate-800/90 p-5 rounded-xs flex flex-col gap-3">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <span className="text-xs font-mono font-bold text-slate-400 uppercase tracking-wider">
                03. Live Public Lobbies ({waitingRooms.length})
              </span>
              <button
                type="button"
                onClick={fetchWaitingRooms}
                className="text-xs font-sans text-cyan-400 hover:text-cyan-300 cursor-pointer uppercase font-medium"
              >
                ↻ Refresh List
              </button>
            </div>

            {waitingRooms.length === 0 ? (
              <div className="text-xs font-sans text-slate-400 py-4 text-center">
                No open public lobbies waiting right now. Use{' '}
                <strong className="text-slate-200">Host Public Lobby</strong> or{' '}
                <strong className="text-emerald-400">Quick Match</strong> to create one.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-40 overflow-y-auto">
                {waitingRooms.map((rm) => {
                  const isOwnRoom = hostedRoom?.code === rm.code;
                  return (
                    <div
                      key={rm.code}
                      className="flex items-center justify-between gap-3 bg-[#060a14] border border-slate-800/90 px-3.5 py-2.5 rounded-xs"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-sm text-cyan-300 tracking-wider">
                            {rm.code}
                          </span>
                          <span className="text-xs font-sans text-white font-medium truncate">
                            {rm.hostCallsign}
                          </span>
                        </div>
                        <span className="text-[11px] font-sans text-slate-400">
                          Operative: {OPERATIVES[rm.hostOperative]?.name.split('//')[0].trim() || rm.hostOperative}
                        </span>
                      </div>

                      {isOwnRoom ? (
                        <span className="text-[10px] font-mono text-emerald-400 uppercase px-2 py-1 border border-emerald-500/40 rounded-xs">
                          Your Room
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleJoinByCode(rm.code)}
                          className="px-3 py-1.5 bg-cyan-600/20 hover:bg-cyan-500 text-cyan-300 hover:text-slate-950 border border-cyan-500/40 font-sans font-semibold text-xs uppercase transition-colors cursor-pointer shrink-0 rounded-xs"
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
