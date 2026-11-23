import type { AgentInputItem } from '@openai/agents';

export interface AgentMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AgentTurnOptions {
  history?: readonly AgentMessage[];
  signal?: AbortSignal;
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
