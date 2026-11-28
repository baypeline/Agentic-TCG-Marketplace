import type { AgentInputItem } from '@openai/agents';
import type { CardVariant, AgentPurchaseOffer, AgentBudgetPatch, AgentBudgetProposal } from '@tcg/contracts';

export interface AgentMessage {
  role: 'user' | 'assistant';
  content: string;
  cardChoices?: CardVariant[];
  purchaseOffers?: AgentPurchaseOffer[];
  budgetProposal?: AgentBudgetProposal;
}

export interface AgentTurnOptions {
  history?: readonly AgentMessage[];
  signal?: AbortSignal;
  onCardChoices?: (cards: CardVariant[]) => void;
  onPurchaseOffers?: (offers: AgentPurchaseOffer[]) => void;
  onBudgetChange?: (patch: AgentBudgetPatch) => Promise<AgentBudgetProposal>;
  onTextDelta?: (delta: string) => void | Promise<void>;
}

export function toAgentInput(message: string, history?: readonly AgentMessage[]): string | AgentInputItem[] {
  if (!history?.length) return message;

  const input = history.map((item): AgentInputItem => {
    if (item.role === 'user') return { role: 'user', content: item.content };
    return {
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'output_text', text: item.content }],
    };
  });
  return [...input, { role: 'user', content: message }];
}
