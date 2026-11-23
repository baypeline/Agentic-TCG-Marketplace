import { Agent, Runner, type Model } from '@openai/agents';
import {
  createOpenAIDecisionApi,
  defaultModel,
  intentDecisionSchema,
  type DecisionApi,
} from './decision.js';
import { createCardTools, type CardToolDependencies } from './tools.js';
import { toAgentInput, type AgentTurnOptions } from './turn.js';

export { createOpenAIDecisionApi, type DecisionApi, type IntentDecision } from './decision.js';
export { connectMcpCardServices, type McpCardConnectionOptions } from './mcp.js';
export { createAgentSessionPlugin, type AgentSessionPluginOptions } from './sessions.js';
export type { AgentMessage, AgentTurnOptions } from './turn.js';

export interface AgentRuntimeOptions extends CardToolDependencies {
  model?: string | Model;
  decisionApi?: DecisionApi;
}

const instructions = `
당신은 포켓몬 TCG 카드와 적정가를 조회하는 읽기 전용 도우미입니다.
사용자의 언어로 답하고, 카드 정보와 가격은 이번 턴의 도구 응답을 근거로만 안내하세요.
"그 카드" 같은 참조는 이전 대화에서 대상을 하나로 특정할 수 있을 때만 사용하세요.
search_cards의 query에는 카드 이름만 넣으세요. 예를 들어 "이브이 SV 133 한국판"은
"Eevee"로 검색한 뒤 반환된 세트, 카드 번호와 언어로 필터링하세요.
한국어 카드명을 대응하는 영문 이름으로 알고 있다면 영문 이름으로 검색하세요.
카드명 없이 세트와 번호만 주어져 이름 검색을 할 수 없으면 카드 이름을 물어보세요.
사용자 조건에 맞는 variant가 여럿이면 세트, 카드 번호, 언어, 에디션, 상태를 바탕으로
후보를 안내하고 어느 카드인지 물어보세요. 결과가 없으면 검색 조건을 요청하세요.
적정가 도구가 제공되고 variant가 특정되면 검색 결과의 ID로 가격을 조회하세요.
응답에는 조회한 카드 variant를 표시하세요. 가격을 조회했다면 데이터 출처도 표시하세요.
MOCK은 시연용 합성 시세임을 밝히고, INSUFFICIENT_DATA는 표본 부족으로
가격을 확인할 수 없다고 안내하세요.
estimatedPrice는 USDC 최소 단위 정수 문자열입니다. 소수점 6자리를 적용해 표시하세요.
도구 실패를 가격 또는 검색 결과 없음으로 해석하지 마세요.
`;

const directReplies = {
  needs_clarification: {
    ko: '어떤 포켓몬 카드인지 카드 이름을 알려주세요. 세트와 카드 번호도 있으면 함께 알려주세요.',
    en: 'Which Pokémon card should I look up? Please provide its name and, if available, its set and card number.',
  },
  unsupported: {
    ko: '포켓몬 카드 검색과 적정가 조회를 도와드릴 수 있습니다.',
    en: 'I can search for Pokémon cards and look up their estimated values.',
  },
};

export function createAgentRuntime({
  model = defaultModel,
  decisionApi = createOpenAIDecisionApi(),
  ...dependencies
}: AgentRuntimeOptions) {
  const runner = new Runner({ tracingDisabled: true });

  return {
    async runAgentTurn(input: string, options?: AgentTurnOptions): Promise<string> {
      const message = input.trim();
      if (!message) throw new TypeError('메시지를 입력해 주세요.');

      options?.signal?.throwIfAborted();
      const decision = await decisionApi.classify(message, options);
      options?.signal?.throwIfAborted();
      const { route, language } = intentDecisionSchema.parse(decision);
      if (route === 'needs_clarification' || route === 'unsupported') {
        return directReplies[route][language];
      }

      const agent = new Agent({
        name: 'TCG 카드 조회 도우미',
        instructions,
        model,
        modelSettings: { store: false, parallelToolCalls: false },
        tools: createCardTools(dependencies, route),
      });
      const result = await runner.run(agent, toAgentInput(message, options?.history), { maxTurns: 6, signal: options?.signal });
      const output = result.finalOutput?.trim();
      if (!output) throw new Error('에이전트 응답이 비어 있습니다.');
      return output;
    },
  };
}
