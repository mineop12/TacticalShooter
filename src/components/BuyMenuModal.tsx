import React from 'react';
import { canPurchaseArmor, canPurchaseWeapon } from '../game/rules';
import { ArmorType, HudSnapshot, WeaponId } from '../game/types';
import { ARMOR_SPECS, WEAPON_ORDER, WEAPONS } from '../game/weapons';
import { ShieldSvgIcon, WeaponSvgIcon } from './WeaponIcons';

interface BuyMenuModalProps {
  hud: HudSnapshot;
  onBuyWeapon: (weaponId: WeaponId) => void;
  onBuyArmor: (armorType: ArmorType) => void;
  onClose: () => void;
  onDeployNow: () => void;
}

export const BuyMenuModal: React.FC<BuyMenuModalProps> = ({
  hud,
  onBuyWeapon,
  onBuyArmor,
  onClose,
  onDeployNow,
}) => {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Tactical Armory Buy Menu"
      className="fixed inset-0 z-30 flex items-center justify-center p-4 md:p-8 bg-[#060911]/88 pointer-events-auto"
    >
      <div className="w-full max-w-5xl bg-[#0b111e] border border-slate-700 shadow-2xl flex flex-col max-h-[90vh] overflow-y-auto">
        {/* Armory Header */}
        <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-4 bg-[#0f172a] border-b border-slate-800">
          <div className="flex items-center gap-4">
            <h2 className="font-display font-bold text-xl tracking-wider uppercase text-white">
              Tactical Armory // Round {hud.roundNumber}
            </h2>
            <span className="text-xs font-mono text-slate-400">
              Win +3000 · Loss +1900..2900 · Elimination +200
            </span>
          </div>

          <div className="flex items-center gap-5">
            <div className="flex items-center gap-2 bg-[#090d16] px-4 py-2 border border-emerald-500/40">
              <span className="text-xs font-mono text-slate-400 uppercase">CREDITS</span>
              <span
                data-testid="armory-credits"
                className="font-mono font-bold text-lg text-emerald-400 tabular-nums"
              >
                ¤ {hud.playerCredits}
              </span>
            </div>

            {hud.roundPhase === 'buy' && (
              <button
                type="button"
                onClick={() => {
                  onDeployNow();
                  onClose();
                }}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white font-display font-bold text-xs uppercase tracking-wider transition-colors cursor-pointer whitespace-nowrap"
              >
                Deploy Combat Now
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              aria-label="Close Armory"
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-mono text-xs font-semibold uppercase tracking-wider border border-slate-600 transition-colors cursor-pointer whitespace-nowrap"
            >
              Close [B]
            </button>
          </div>
        </div>

        {/* Armory Content Grid */}
        <div className="p-5 grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Weapons Column (8 cols) */}
          <div className="lg:col-span-8 flex flex-col gap-2.5">
            <div className="flex items-center justify-between text-xs font-mono text-slate-400 pb-1 border-b border-slate-800">
              <span>PRIMARY & SIDEARM WEAPONS (KEYS 1–5)</span>
              <span>DAMAGE: HEAD / BODY / LEG</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {WEAPON_ORDER.map((wid) => {
                const spec = WEAPONS[wid];
                const owned = Boolean(hud.ownedWeapons[wid]);
                const isEquipped = hud.activeWeapon.id === wid;
                const check = canPurchaseWeapon(hud.playerCredits, hud.ownedWeapons, wid);

                return (
                  <button
                    key={wid}
                    type="button"
                    data-buy-weapon={wid}
                    aria-label={`Purchase ${spec.name}`}
                    disabled={!check.allowed && !owned}
                    onClick={() => onBuyWeapon(wid)}
                    className={`flex flex-col justify-between p-3 text-left border transition-colors cursor-pointer ${
                      isEquipped
                        ? 'bg-slate-800/95 border-rose-500'
                        : owned
                          ? 'bg-[#111a2e] border-emerald-500/60 hover:border-emerald-400'
                          : check.allowed
                            ? 'bg-[#0f172a] border-slate-700 hover:border-cyan-400'
                            : 'bg-[#090d16]/60 border-slate-800/70 opacity-55 cursor-not-allowed'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2 w-full">
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-xs text-slate-400">[{spec.slot}]</span>
                          <span className="font-display font-bold text-sm text-white tracking-wide">
                            {spec.name}
                          </span>
                        </div>
                        <span className="text-[10px] font-mono text-slate-400">
                          {spec.category} · {spec.automatic ? 'Auto' : 'Semi'}
                        </span>
                      </div>

                      <span
                        className={`font-mono font-bold text-xs tabular-nums ${
                          owned
                            ? 'text-emerald-400'
                            : check.allowed
                              ? 'text-amber-400'
                              : 'text-slate-500'
                        }`}
                      >
                        {owned ? 'OWNED' : spec.cost === 0 ? 'FREE' : `¤ ${spec.cost}`}
                      </span>
                    </div>

                    <div className="my-2 flex items-center justify-center py-1.5 bg-[#090d16]/70 border border-slate-800/80">
                      <WeaponSvgIcon weaponId={wid} className="w-28 h-9 text-slate-100" />
                    </div>

                    <p className="text-[11px] text-slate-300 mb-2 line-clamp-2">{spec.roleDesc}</p>

                    <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-800 text-[10px] font-mono tabular-nums">
                      <div>
                        <span className="text-slate-400 block">DMG H/B/L</span>
                        <span className="text-rose-400 font-semibold">
                          {spec.headDamage}
                        </span>
                        /{spec.bodyDamage}/{spec.legDamage}
                      </div>
                      <div className="text-center">
                        <span className="text-slate-400 block">RATE</span>
                        <span className="text-slate-200">{spec.fireRate}/s</span>
                      </div>
                      <div className="text-right">
                        <span className="text-slate-400 block">MAG</span>
                        <span className="text-slate-200">
                          {spec.magSize}/{spec.maxReserve}
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Armor & Tactical Info Column (4 cols) */}
          <div className="lg:col-span-4 flex flex-col gap-4">
            <div className="flex items-center justify-between text-xs font-mono text-slate-400 pb-1 border-b border-slate-800">
              <span>BALLISTIC SHIELDS</span>
              <span>CURRENT: {hud.playerArmor} AP</span>
            </div>

            {(['light', 'heavy'] as ArmorType[]).map((atype) => {
              const spec = ARMOR_SPECS[atype];
              const check = canPurchaseArmor(
                hud.playerCredits,
                hud.playerArmor,
                hud.playerArmorType,
                atype
              );
              const isEquipped =
                hud.playerArmorType === atype && hud.playerArmor === spec.points;

              return (
                <button
                  key={atype}
                  type="button"
                  disabled={!check.allowed}
                  onClick={() => onBuyArmor(atype)}
                  className={`flex items-center justify-between p-4 text-left border transition-colors cursor-pointer ${
                    isEquipped
                      ? 'bg-slate-800/95 border-cyan-400'
                      : check.allowed
                        ? 'bg-[#0f172a] border-slate-700 hover:border-cyan-400'
                        : 'bg-[#090d16]/60 border-slate-800/70 opacity-55 cursor-not-allowed'
                  }`}
                >
                  <div className="flex items-center gap-3.5">
                    <ShieldSvgIcon type={atype} className="w-10 h-10 shrink-0" />
                    <div>
                      <div className="font-display font-bold text-base text-white">
                        {spec.name}
                      </div>
                      <div className="text-xs text-slate-300 mt-0.5">{spec.desc}</div>
                    </div>
                  </div>
                  <div className="font-mono font-bold text-sm tabular-nums text-cyan-400 shrink-0 ml-2">
                    {isEquipped ? 'MAXED' : `¤ ${spec.cost}`}
                  </div>
                </button>
              );
            })}

            {/* Current Loadout Summary Box */}
            <div className="mt-auto p-4 bg-[#090d16] border border-slate-800 flex flex-col gap-2">
              <span className="text-xs font-mono text-slate-400 uppercase">
                ACTIVE COMBAT LOADOUT
              </span>
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-300">Equipped Primary/Sidearm</span>
                <span className="font-display font-bold text-white">
                  {WEAPONS[hud.activeWeapon.id].name}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-300">Effective Vitality Pool</span>
                <span className="font-mono font-bold text-cyan-400 tabular-nums">
                  {hud.playerHealth + hud.playerArmor} EHP ({hud.playerHealth} HP + {hud.playerArmor} AP)
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
