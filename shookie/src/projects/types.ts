/** PostHog 프로젝트 섹션 - 한 제품의 PostHog 연결 정보 + 도메인 지식 */
export interface PostHogProjectSection {
  projectId: string;
  knowledge: string;
}

/** Code Explorer 섹션 (미래 대비 진입점, 현재 사용처 없음) */
export interface CodeExplorerProjectSection {
  repo: string;
  knowledge?: string;
}

/** 단일 제품(프로젝트) 정의 */
export interface ProjectDefinition {
  /** registry key (kebab-case 식별자) */
  name: string;
  /** LLM/사용자 표시명 (도구 입력과 매칭) */
  displayName: string;
  /** 짧은 설명 */
  description: string;
  posthog?: PostHogProjectSection;
  codeExplorer?: CodeExplorerProjectSection;
}

/** 전체 프로젝트 레지스트리 */
export interface ProjectRegistry {
  [key: string]: ProjectDefinition;
}
