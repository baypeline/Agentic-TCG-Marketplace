import type { ToolAnnotations } from '@modelcontextprotocol/server';
import { z } from 'zod';
import {
  cardSearchResponseSchema,
  idSchema,
  valuationSchema,
  type AggregatorService,
  type AuthContext,
  type ValuationService,
} from '@tcg/contracts';

export interface ToolServices {
  aggregatorService: AggregatorService;
  valuationService: ValuationService;
}

// 호스트가 검증한 인증 정보. 거래 도구를 붙일 때 쓴다.
export interface ToolContext {
  auth: AuthContext | null;
}

export type ToolInvocation =
  | { kind: 'invalid'; issues: string }
  | { kind: 'done'; data: unknown };

export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: z.ZodObject;
  readonly annotations: ToolAnnotations;
  invoke(rawArgs: unknown, context: ToolContext): Promise<ToolInvocation>;
}

const readOnly: ToolAnnotations = { readOnlyHint: true, openWorldHint: false };

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map(issue => (issue.path.length > 0 ? `${issue.path.map(String).join('.')}: ${issue.message}` : issue.message))
    .join('; ');
}

// 입력 검증 실패만 invalid로 돌려준다. 실행 중에 던진 예외(서비스 출력 검증 포함)는 호출한 쪽이 처리한다.
function defineTool<S extends z.ZodObject>(spec: {
  name: string;
  description: string;
  inputSchema: S;
  annotations: ToolAnnotations;
  run: (args: z.output<S>, context: ToolContext) => Promise<unknown>;
}): ToolDefinition {
  const { run, ...definition } = spec;
  return {
    ...definition,
    async invoke(rawArgs, context) {
      const parsed = spec.inputSchema.safeParse(rawArgs);
      if (!parsed.success) return { kind: 'invalid', issues: formatIssues(parsed.error) };
      return { kind: 'done', data: await run(parsed.data, context) };
    },
  };
}

// REST GET /api/cards와 같은 규칙. MCP 인수는 JSON이라 limit을 숫자로 받는다.
const searchCardsInput = z.strictObject({
  query: z.string().trim().max(200).default(''),
  limit: z.number().int().min(1).max(100).default(20),
});
const getValuationInput = z.strictObject({ cardVariantId: idSchema });

export function createTools({ aggregatorService, valuationService }: ToolServices): ToolDefinition[] {
  return [
    defineTool({
      name: 'search_cards',
      description: '카드 이름으로 카드 variant를 검색합니다. 결과의 id를 get_valuation에 넘길 수 있습니다.',
      inputSchema: searchCardsInput,
      annotations: readOnly,
      run: async ({ query, limit }) =>
        cardSearchResponseSchema.parse({ items: await aggregatorService.searchCards({ query, limit }), nextCursor: null }),
    }),
    defineTool({
      name: 'get_valuation',
      description:
        '카드 variant ID로 적정가, 표본 수, 신뢰 수준, 데이터 출처를 조회합니다. 표본이 없으면 status가 INSUFFICIENT_DATA이고 estimatedPrice는 null입니다.',
      inputSchema: getValuationInput,
      annotations: readOnly,
      run: async ({ cardVariantId }) => valuationSchema.parse(await valuationService.getValuation(cardVariantId)),
    }),
  ];
}
