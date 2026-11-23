import { config } from 'dotenv';

// 서버 포트 결정 전에 루트 환경변수를 로드한다.
config({ path: new URL('../../../.env', import.meta.url), quiet: true });
await import('next/dist/bin/next');
