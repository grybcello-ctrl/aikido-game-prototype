/** 기술 데이터가 스키마/의미 규칙을 위반 */
export class TechniqueDataError extends Error {
  override readonly name = 'TechniqueDataError';

  constructor(
    readonly techniqueId: string,
    readonly issues: string[],
  ) {
    super(`[${techniqueId}] 기술 데이터 오류 ${issues.length}건:\n - ${issues.join('\n - ')}`);
  }
}

/** 잘못된 인자(시간 값, 진행부 횟수 등) */
export class EngineArgumentError extends RangeError {
  override readonly name = 'EngineArgumentError';
}

/** 현재 상태에서 허용되지 않는 호출 */
export class EngineStateError extends Error {
  override readonly name = 'EngineStateError';
}
