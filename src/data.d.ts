// Hand-written types for the generated src/data.js (see tools/generate_data.py).
export interface BaseStats { hp: number; atk: number; def: number; spe: number; spc: number }
export interface SpeciesEvo { to: number; level: number; random?: boolean }
export interface Species {
  id: number;
  name: string;
  types: string[];
  base: BaseStats;
  catch: number;
  exp: number;
  height: number;
  habitat: string;
  stage: number;
  rarity: string;
  temper: string;
  growth: "fast" | "mediumfast" | "mediumslow" | "slow";
  learnset: [level: number, moveId: number][];
  evos?: SpeciesEvo[];
}
export interface MoveEffect { k: string; t?: string; stat?: string; d?: number; f?: number; s?: string; p?: number }
export interface Move {
  id: number;
  name: string;
  key: string;
  type: string;
  power: number;
  acc: number;
  cls: "phys" | "spec" | "status";
  pri: number;
  pp: number;
  role?: "basic" | "skill" | "burst";
  cd?: number;
  energyGain?: number;
  energyCost?: number;
  effect?: MoveEffect;
  sec?: MoveEffect;
  tags?: Record<string, any>;
  fx?: Record<string, any>;
}
export const POKEDEX: Species[];
export const DEX: Record<number, Species>;
export const MOVES: Record<number, Move>;
export const TYPE_CHART: Record<string, Record<string, number>>;
export const TYPE_COLORS: Record<string, string>;
export const PHYS_TYPES: string[];
export function typeMult(atk: string, defTypes: string[]): number;
export function spriteURL(id: number, back?: boolean): string;
