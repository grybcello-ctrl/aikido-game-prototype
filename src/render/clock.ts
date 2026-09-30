/**
 * 실시간(performance.now 계열) → 게임 가상시간 매핑.
 *
 * 구간 선형 함수(breakpoint 목록)라서 입력 이벤트 타임스탬프도 같은 함수로 변환하면
 * 배속·히트스톱·일시정지 중에도 ms 판정이 정확히 유지된다.
 * - setRate: 배속 (연습 모드 슬로)
 * - freeze: 히트스톱 — ms 동안 가상시간 정지 (엔진·애니메이션·거리 이동이 함께 멈춤)
 * - pause/resume: 탭 비활성화
 */
interface Breakpoint { real: number; virt: number; rate: number }

const KEEP = 12;

export class GameClock {
  private bps: Breakpoint[];
  private rate = 1;
  private paused = false;
  private frozenUntil = -Infinity;

  constructor(realNow: number) {
    this.bps = [{ real: realNow, virt: 0, rate: 1 }];
  }

  toVirtual(real: number): number {
    let bp = this.bps[0] as Breakpoint;
    for (const b of this.bps) {
      if (b.real <= real) bp = b;
      else break;
    }
    return bp.virt + (real - bp.real) * bp.rate;
  }

  /** 사용자 배속 (히트스톱·일시정지와 무관) */
  get speed(): number {
    return this.rate;
  }

  isFrozen(real: number): boolean {
    return this.paused || real < this.frozenUntil;
  }

  setRate(rate: number, real: number): void {
    if (!(rate > 0) || !Number.isFinite(rate)) throw new RangeError(`rate 는 양수여야 함 (${rate})`);
    this.rate = rate;
    this.rebuild(real);
  }

  /** 히트스톱: real 부터 ms(실시간) 동안 정지. 겹치면 더 늦게 끝나는 쪽으로 연장 */
  freeze(real: number, ms: number): void {
    if (!(ms > 0)) return;
    this.frozenUntil = Math.max(this.frozenUntil, real + ms);
    this.rebuild(real);
  }

  pause(real: number): void {
    if (this.paused) return;
    this.paused = true;
    this.rebuild(real);
  }

  resume(real: number): void {
    if (!this.paused) return;
    this.paused = false;
    this.rebuild(real);
  }

  /** real 시점부터 미래 구간을 다시 만든다 (과거 구간은 유지 → 늦게 처리되는 입력도 정확히 변환) */
  private rebuild(real: number): void {
    const virt = this.toVirtual(real);
    const past = this.bps.filter((b) => b.real <= real).slice(-KEEP);
    const effective = this.paused || real < this.frozenUntil ? 0 : this.rate;
    past.push({ real, virt, rate: effective });
    if (!this.paused && this.frozenUntil > real) past.push({ real: this.frozenUntil, virt, rate: this.rate });
    this.bps = past;
  }
}
