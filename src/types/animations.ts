/** schema/animations.schema.json 과 1:1 대응 */

export type PoseHint =
  | 'stand' | 'windup' | 'strike' | 'step_in' | 'stagger' | 'hit' | 'lead' | 'drawn' | 'off_balance' | 'resist'
  | 'recover' | 'lift_prep' | 'lifted' | 'cut' | 'thrown' | 'weak' | 'whiff' | 'zanshin' | 'roll' | 'sloppy'
  | 'crash' | 'reach' | 'hold' | 'turn' | 'raise' | 'twisted' | 'stuck'
  | 'fx_flash' | 'fx_soft' | 'fx_spark' | 'fx_ring' | 'fx_dust';

export interface SequenceDef {
  /** 1~24 */
  frames: number;
  /** 10~12 (리미티드 애니메이션) */
  frameRate: number;
  /** -1 = 무한 반복, 0 = 1회 후 마지막 프레임 유지 */
  repeat?: number;
  /** { 프레임 인덱스: 틱 수(≥2) } */
  holds?: Record<string, number>;
  pose?: PoseHint;
  /** 단일 이미지 텍스처 키 (예: 'player_idle'). 로드돼 있으면 atlas·pose 보다 우선. frames 는 1로 취급 */
  image?: string;
  atlas?: { texture: string; prefix: string; start?: number; zeroPad?: number };
}

export interface AnimationManifest {
  $schema?: string;
  sequences: Record<string, SequenceDef>;
}
