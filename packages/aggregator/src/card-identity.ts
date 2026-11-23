import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { idSchema } from '@tcg/contracts';

const normalizedLabel = z.string().trim().min(1).transform(value => value.toUpperCase()).pipe(z.string().max(64));
const referenceSchema = z.object({
  provider: z.literal('TCGDEX'),
  externalId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/),
  language: z.string().trim().toUpperCase().regex(/^[A-Z]{2}(?:-[A-Z]{2})?$/),
  edition: normalizedLabel,
  condition: normalizedLabel,
});

export function normalizeExternalCardReference(reference: ExternalCardReference): ExternalCardReference {
  return referenceSchema.parse(reference);
}

export interface ExternalCardReference {
  provider: 'TCGDEX';
  externalId: string;
  language: string;
  edition: string;
  condition: string;
}

/** 같은 외부 참조에는 같은 UUID를 반환한다. 언어·상태 등은 정규화 후 식별한다. */
export interface CardIdentityStore {
  getOrCreateId(reference: ExternalCardReference): Promise<string>;
  findById(id: string): Promise<ExternalCardReference | null>;
}

/** 독립 시연·테스트 전용. 같은 인스턴스 내에서만 UUID를 보존한다. */
export function createInMemoryCardIdentityStore(): CardIdentityStore {
  const ids = new Map<string, string>();
  const references = new Map<string, ExternalCardReference>();
  return {
    async getOrCreateId(reference) {
      const normalized = normalizeExternalCardReference(reference);
      const key = JSON.stringify([normalized.provider, normalized.externalId, normalized.language, normalized.edition, normalized.condition]);
      const existing = ids.get(key);
      if (existing) return existing;
      const id = randomUUID();
      ids.set(key, id);
      references.set(id, normalized);
      return id;
    },
    async findById(id) {
      if (!idSchema.safeParse(id).success) return null;
      const reference = references.get(id.toLowerCase());
      return reference ? { ...reference } : null;
    },
  };
}
