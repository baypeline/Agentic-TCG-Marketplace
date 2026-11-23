import type { PrismaClient } from '@tcg/db';
import { AppError, idSchema } from '@tcg/contracts';
import { normalizeExternalCardReference, type CardIdentityStore } from './card-identity.js';

/** 연결·종료는 호스트가 담당하며, DB 장애를 메모리 매핑으로 대체하지 않는다. */
export function createPrismaCardIdentityStore(prisma: Pick<PrismaClient, 'externalCardIdentity'>): CardIdentityStore {
  return {
    async getOrCreateId(reference) {
      const normalized = normalizeExternalCardReference(reference);
      // DB 유일성 제약으로 경쟁 요청을 처리한다. 조회 후 별도로 생성하지 않는다.
      await prisma.externalCardIdentity.createMany({ data: [normalized], skipDuplicates: true });
      const identity = await prisma.externalCardIdentity.findUnique({
        where: { externalCardReference: normalized }, select: { id: true },
      });
      if (!identity) throw new AppError('INTERNAL_ERROR', '외부 카드 UUID 매핑을 확인할 수 없습니다.', 500);
      return identity.id;
    },
    async findById(id) {
      if (!idSchema.safeParse(id).success) return null;
      const identity = await prisma.externalCardIdentity.findUnique({
        where: { id }, select: { provider: true, externalId: true, language: true, edition: true, condition: true },
      });
      if (!identity) return null;
      try { return normalizeExternalCardReference(identity); }
      catch { throw new AppError('INTERNAL_ERROR', '저장된 외부 카드 UUID 매핑의 형식이 올바르지 않습니다.', 500); }
    },
  };
}
