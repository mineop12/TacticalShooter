import React from 'react';
import { ArmorType, WeaponId } from '../game/types';

export const WeaponSvgIcon: React.FC<{ weaponId: WeaponId; className?: string }> = ({
  weaponId,
  className = 'w-16 h-8',
}) => {
  switch (weaponId) {
    case 'pistol':
      return (
        <svg viewBox="0 0 112 48" fill="none" className={className} aria-hidden="true">
          {/* Upper Machined Slide & Threaded Barrel */}
          <path
            d="M20 13H74L79 17V24H48L41 42H26L31 24H20V13Z"
            fill="currentColor"
            fillOpacity="0.92"
            stroke="#0f172a"
            strokeWidth="1.8"
          />
          {/* Threaded Barrel Tip & Under-Barrel Laser Module */}
          <rect x="79" y="15" width="9" height="5" fill="#94a3b8" />
          <rect x="52" y="24" width="20" height="5" fill="#334155" stroke="#0f172a" strokeWidth="1" />
          <circle cx="74" cy="26.5" r="2" fill="#38bdf8" />
          {/* Ejection Port & Radianite Trim */}
          <rect x="38" y="14.5" width="14" height="3.5" fill="#94a3b8" />
          <rect x="25" y="19" width="44" height="2.5" fill="#fbbf24" />
          {/* Trigger Guard & Mag Base */}
          <path d="M43 24H52V31H41L43 24Z" fill="currentColor" fillOpacity="0.45" />
          <polygon points="24,41 42,41 40,44 23,44" fill="#fbbf24" />
        </svg>
      );
    case 'smg':
      return (
        <svg viewBox="0 0 136 48" fill="none" className={className} aria-hidden="true">
          {/* Skeleton Stock, Upper Receiver & Foregrip */}
          <path
            d="M8 18H28V12H82V16H122V23H82V27H66L62 44H51L54 27H40L34 40H23L27 24H8V18Z"
            fill="currentColor"
            fillOpacity="0.92"
            stroke="#0f172a"
            strokeWidth="1.8"
          />
          {/* Holo Reflex Sight */}
          <path d="M44 6H62L60 12H42L44 6Z" fill="#1e293b" stroke="#38bdf8" strokeWidth="1.4" />
          {/* Baffled Suppressor Heat Ring & Radianite Conduit */}
          <rect x="85" y="15" width="5" height="9" fill="#38bdf8" />
          <rect x="34" y="16" width="42" height="3" fill="#38bdf8" />
          <rect x="54" y="30" width="4" height="11" fill="#38bdf8" />
        </svg>
      );
    case 'shotgun':
      return (
        <svg viewBox="0 0 144 48" fill="none" className={className} aria-hidden="true">
          {/* Stock, Heavy Receiver, Barrel & Mag Tube */}
          <path
            d="M6 22L24 15H104V19H134V23H126V27H98V30H68V27H34L21 38H8V22Z"
            fill="currentColor"
            fillOpacity="0.92"
            stroke="#0f172a"
            strokeWidth="1.8"
          />
          {/* Perforated Heat Shield & Pump Forend */}
          <rect x="74" y="12" width="44" height="3" fill="#94a3b8" />
          <rect x="80" y="23" width="28" height="6" fill="#1e293b" stroke="#fb923c" strokeWidth="1.4" />
          {/* 8-Shell Rotating Drum Magazine */}
          <circle cx="58" cy="29" r="9.5" fill="#1e293b" stroke="#0f172a" strokeWidth="2" />
          <circle cx="58" cy="29" r="5" fill="#f97316" />
          <rect x="32" y="18" width="38" height="3" fill="#fb923c" />
        </svg>
      );
    case 'rifle':
      return (
        <svg viewBox="0 0 152 48" fill="none" className={className} aria-hidden="true">
          {/* Precision Carbine Stock, Receiver, Handguard & Fluted Barrel */}
          <path
            d="M6 18L26 15V12H96L104 15H128V18H146V22H128V25H94L84 27H72L78 44H65L60 27H44L37 41H26L31 26H16L6 29V18Z"
            fill="currentColor"
            fillOpacity="0.94"
            stroke="#0f172a"
            strokeWidth="1.8"
          />
          {/* Reflex Optic & Picatinny Rail */}
          <polygon points="48,5 68,5 65,12 45,12" fill="#1e293b" stroke="#f43f5e" strokeWidth="1.5" />
          {/* Radianite Barrel Conduit & Vandal Accent Strip */}
          <rect x="34" y="16.5" width="54" height="3" fill="#f43f5e" />
          <rect x="94" y="17.5" width="28" height="2.5" fill="#38bdf8" />
          <polygon points="65,30 70,30 74,42 69,42" fill="#f43f5e" />
        </svg>
      );
    case 'sniper':
      return (
        <svg viewBox="0 0 168 48" fill="none" className={className} aria-hidden="true">
          {/* Operator Anti-Materiel Chassis, Free-Float Barrel & Muzzle Brake */}
          <path
            d="M4 19H26V14H96V17H150V14H164V25H150V22H98L88 26H72V37H56V26H40L34 40H23L27 26H14L4 30V19Z"
            fill="currentColor"
            fillOpacity="0.94"
            stroke="#0f172a"
            strokeWidth="1.8"
          />
          {/* Dual-Ring High-Magnification Telescopic Scope */}
          <path d="M36 4H92L87 11H41L36 4Z" fill="#a855f7" stroke="#0f172a" strokeWidth="1.2" />
          <rect x="48" y="10" width="5" height="4" fill="#e2e8f0" />
          <rect x="74" y="10" width="5" height="4" fill="#e2e8f0" />
          {/* Folded Under-Barrel Bipod & Radianite Core Channel */}
          <rect x="94" y="23" width="26" height="2.5" fill="#94a3b8" />
          <rect x="32" y="18" width="58" height="2.8" fill="#38bdf8" />
        </svg>
      );
  }
};

export const ShieldSvgIcon: React.FC<{ type: ArmorType; className?: string }> = ({
  type,
  className = 'w-6 h-6',
}) => {
  const color = type === 'heavy' ? '#38bdf8' : type === 'light' ? '#2dd4bf' : '#64748b';
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M12 2L4 5.5V11.5C4 16.8 7.4 21.6 12 23C16.6 21.6 20 16.8 20 11.5V5.5L12 2Z"
        fill={color}
        fillOpacity={type === 'none' ? 0.15 : 0.28}
        stroke={color}
        strokeWidth="2"
      />
      {type !== 'none' && (
        <path
          d="M12 5.5L7 7.8V11.4C7 15 9.1 18.2 12 19.3C14.9 18.2 17 15 17 11.4V7.8L12 5.5Z"
          fill={color}
          fillOpacity={type === 'heavy' ? 0.85 : 0.45}
        />
      )}
    </svg>
  );
};

export const HeadshotSvgIcon: React.FC<{ className?: string }> = ({
  className = 'w-3.5 h-3.5',
}) => (
  <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden="true">
    <circle cx="10" cy="10" r="6.5" stroke="#fbbf24" strokeWidth="1.8" />
    <line x1="10" y1="1" x2="10" y2="5.5" stroke="#fbbf24" strokeWidth="1.8" />
    <line x1="10" y1="14.5" x2="10" y2="19" stroke="#fbbf24" strokeWidth="1.8" />
    <line x1="1" y1="10" x2="5.5" y2="10" stroke="#fbbf24" strokeWidth="1.8" />
    <line x1="14.5" y1="10" x2="19" y2="10" stroke="#fbbf24" strokeWidth="1.8" />
    <circle cx="10" cy="10" r="2.2" fill="#f43f5e" />
  </svg>
);

export const VanguardTitleLockupSvg: React.FC<{ className?: string }> = ({ className = 'w-full max-w-md' }) => (
  <svg viewBox="0 0 520 112" fill="none" className={className} role="img" aria-label="VANGUARD 1v1 Tactical Duel">
    {/* Outer Tactical Bracket Crest */}
    <path d="M4 22L22 4H126L138 16H512V90L494 108H18L4 94V22Z" fill="#090d16" fillOpacity="0.88" stroke="#334155" strokeWidth="2" />
    <path d="M4 22L22 4H92L82 14H24L14 24V72L4 82V22Z" fill="#f43f5e" />
    <path d="M494 108L512 90V58L504 66V86L490 100H380L372 108H494Z" fill="#06b6d4" />
    {/* Emblem Mark */}
    <g transform="translate(28, 24)">
      <polygon points="28,0 56,14 44,62 28,50 12,62 0,14" fill="#1e293b" stroke="#f43f5e" strokeWidth="2.5" />
      <polygon points="28,10 44,20 36,50 28,42 20,50 12,20" fill="#f43f5e" />
      <polygon points="28,18 34,26 28,38 22,26" fill="#f8fafc" />
    </g>
    {/* Typography Lockup */}
    <text
      x="102"
      y="62"
      fill="#f8fafc"
      fontFamily="'Chakra Petch', sans-serif"
      fontWeight="700"
      fontSize="46"
      letterSpacing="4"
    >
      VANGUARD
    </text>
    <rect x="104" y="74" width="78" height="18" fill="#f43f5e" />
    <text
      x="112"
      y="87"
      fill="#090d16"
      fontFamily="'JetBrains Mono', monospace"
      fontWeight="700"
      fontSize="12"
      letterSpacing="1.5"
    >
      1V1 DUEL
    </text>
    <text
      x="194"
      y="87"
      fill="#94a3b8"
      fontFamily="'JetBrains Mono', monospace"
      fontWeight="600"
      fontSize="12"
      letterSpacing="2.5"
    >
      PROTOCOL // HAVEN-ZERO ARENA
    </text>
  </svg>
);
