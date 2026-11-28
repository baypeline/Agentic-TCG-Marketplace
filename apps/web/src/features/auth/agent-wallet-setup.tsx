'use client';

import { useState } from 'react';
import Link from 'next/link';
import styled from '@emotion/styled';
import { useQuery } from '@tanstack/react-query';
import { demoStatusSchema } from '@tcg/contracts';
import { getWalletSession as readWalletSession, walletQueryKey } from './wallet-client';

type User = NonNullable<Awaited<ReturnType<typeof readWalletSession>>['user']>;
type Demo = ReturnType<typeof demoStatusSchema.parse>;

export function AgentWalletSetup() {
  const session = useQuery({ queryKey: walletQueryKey, queryFn: readWalletSession, staleTime: 30_000, retry: false });
  const demo = useQuery({ queryKey: ['demo-status'], queryFn: async () => { const response = await fetch('/api/demo'); if (!response.ok) throw new Error('Unavailable'); return demoStatusSchema.parse(await response.json()); }, staleTime: 30_000, retry: false, enabled: !!session.data?.user });
  if (session.isPending) return <State role="status">로그인 상태를 확인하고 있어요.</State>;
  if (session.isError) return <State><p role="alert">로그인 상태를 확인하지 못했어요.</p><QuietButton type="button" onClick={() => void session.refetch()}>다시 확인</QuietButton></State>;
  return <AgentWalletSetupView user={session.data?.user ?? null} demo={demo.data} infoFailed={demo.isError} onRefresh={() => void demo.refetch()} />;
}

export function AgentWalletSetupView({ user, demo, infoFailed = false, onRefresh }: { user: User | null; demo?: Demo; infoFailed?: boolean; onRefresh(): void }) {
  const [copyState, setCopyState] = useState('');
  const linked = user?.agentWalletLinked === true;
  const payer = linked ? demo?.payer : null;
  const network = demo ? demo.paymentChain === 'maroo' ? 'Maroo Testnet' : 'Base Sepolia' : '확인 중';
  async function copyAddress() {
    if (!payer) return;
    try { await navigator.clipboard.writeText(payer); setCopyState('지갑 주소를 복사했어요.'); }
    catch { setCopyState('복사하지 못했어요. 표시된 주소를 직접 복사해 주세요.'); }
  }
  return <Page>
    <BackLink href="/agent">← 에이전트 설정</BackLink>
    <Introduction><h1>{linked ? '에이전트 지갑' : '구매를 맡길 지갑을 준비해 주세요'}</h1><p>로그인 지갑은 내 계정을 확인하고, 에이전트 지갑은 내가 정한 예산 안에서 구매를 진행해요.</p></Introduction>
    {!user ? <Card><h2>먼저 지갑으로 로그인해 주세요</h2><p>화면 상단의 ‘지갑 로그인’을 누르면 내 계정의 연결 상태를 확인할 수 있어요.</p><TextLink href="/cards">카드 먼저 둘러보기 →</TextLink></Card> : <Layout>
      <MainCard aria-label="지갑 연결 상태">
        <Step><StepMark aria-label="완료">✓</StepMark><StepContent><StepTitle><h2>로그인 지갑</h2><Status data-linked>로그인됨</Status></StepTitle><Address>{user.address}</Address><Description>카드와 거래 내역, 예산 설정이 이 계정에 저장돼요.</Description></StepContent></Step>
        <Step><StepMark data-active={!linked} aria-hidden="true">{linked ? '✓' : '2'}</StepMark><StepContent><StepTitle><h2>에이전트 전용 지갑</h2><Status data-linked={linked}>{linked ? '연결됨' : '미연결'}</Status></StepTitle>
          {linked ? <><Description>이 계정에 연결된 지갑으로 구매 금액과 가스비를 지급해요.</Description>{payer ? <><Address>{payer}</Address><QuietButton type="button" onClick={() => void copyAddress()}>주소 복사</QuietButton>{copyState && <Small role="status">{copyState}</Small>}</> : <><Description>{infoFailed || demo ? '연결된 지갑 주소를 불러오지 못했어요.' : '연결된 지갑 주소를 확인하고 있어요.'}</Description><QuietButton type="button" onClick={onRefresh}>지갑 정보 다시 확인</QuietButton></>}</> : <><Description>구매에 사용할 별도의 지갑이에요. 로그인 지갑의 자금이 자동으로 옮겨지지는 않아요.</Description><PrimaryButton type="button" disabled aria-describedby="wallet-setup-availability">전용 지갑 만들기</PrimaryButton><Small id="wallet-setup-availability">지갑 생성·연결 기능을 준비하고 있어요. 지금은 카드를 둘러보거나 예산을 먼저 설정할 수 있어요.</Small></>}
        </StepContent></Step>
        <BottomActions>{linked ? <PrimaryLink href="/agent">구매 예산 설정하기</PrimaryLink> : <TextLink href="/cards">나중에 하고 카드 둘러보기 →</TextLink>}</BottomActions>
      </MainCard>
      <Aside><h2>{linked ? '구매 전에 확인해 주세요' : '연결한 뒤에는 이렇게 사용해요'}</h2><NextSteps><li><strong>구매 금액과 가스비 충전</strong><p>에이전트 지갑에 결제에 사용할 금액을 준비해요.</p></li><li><strong>총예산과 건당 한도 설정</strong><p>지갑 잔액과 구매 예산은 별도로 관리해요. 예산은 먼저 설정해 둘 수 있어요.</p><TextLink href="/agent">예산 설정으로 →</TextLink></li><li><strong>에이전트에게 카드 요청</strong><p>원하는 카드와 가격을 말하고, 구매할 매물을 확인해요.</p></li></NextSteps><Network><dt>사용 네트워크</dt><dd>{infoFailed ? '확인하지 못했어요' : network}</dd>{demo && <><dt>결제 통화</dt><dd>{demo.currency}</dd></>}</Network></Aside>
    </Layout>}
  </Page>;
}

const Page = styled.div({ maxWidth: 1040, margin: '0 auto' });
const BackLink = styled(Link)(({ theme }) => ({ display: 'inline-flex', minHeight: 44, alignItems: 'center', color: theme.color.muted, textDecoration: 'none', fontSize: 13, '&:hover': { color: theme.color.link } }));
const Introduction = styled.div(({ theme }) => ({ margin: '24px 0 36px', '& h1': { maxWidth: 640, fontSize: 'clamp(28px,3vw,38px)', lineHeight: 1.3, fontWeight: 600, letterSpacing: '-.035em', textWrap: 'balance' }, '& p': { maxWidth: 620, marginTop: 16, color: theme.color.muted, lineHeight: 1.85, fontSize: 15 } }));
const Layout = styled.div({ display: 'grid', gridTemplateColumns: 'minmax(0,1.6fr) minmax(240px,1fr)', gap: 40, alignItems: 'start', '@container browse (max-width:800px)': { gridTemplateColumns: 'minmax(0,1fr)', gap: 28 }, '@media(max-width:767px)': { gridTemplateColumns: 'minmax(0,1fr)', gap: 28 } });
const Card = styled.section(({ theme }) => ({ padding: 28, border: `1px solid ${theme.color.line}`, borderRadius: theme.radius.panel, '& h2': { fontSize: 18 }, '& > p': { marginBlock: 16, color: theme.color.muted, lineHeight: 1.8 } }));
const MainCard = styled(Card)({ padding: '32px 28px', '@media(max-width:479px)': { padding: '24px 18px' } });
const Step = styled.div(({ theme }) => ({ display: 'grid', gridTemplateColumns: '32px minmax(0,1fr)', gap: 16, '& + &': { marginTop: 28, paddingTop: 28, borderTop: `1px solid ${theme.color.line}` } }));
const StepMark = styled.span(({ theme }) => ({ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: '50%', background: theme.color.successBg, color: theme.color.success, fontSize: 14, fontWeight: 650, '&[data-active=true]': { background: theme.color.soft, color: theme.color.primary } }));
const StepContent = styled.div({ minWidth: 0 });
const StepTitle = styled.div({ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12, minHeight: 32, '& h2': { fontSize: 17, fontWeight: 600, margin: 0 } });
const Status = styled.span(({ theme }) => ({ fontSize: 12, color: theme.color.muted, '&[data-linked=true]': { color: theme.color.success } }));
const Address = styled.p(({ theme }) => ({ margin: '14px 0 8px', padding: '12px 14px', background: theme.color.soft, color: theme.color.ink, borderRadius: 6, fontFamily: 'monospace', fontSize: 13, lineHeight: 1.7, overflowWrap: 'anywhere', userSelect: 'all' }));
const Description = styled.p(({ theme }) => ({ marginTop: 12, color: theme.color.muted, fontSize: 14, lineHeight: 1.85 }));
const Small = styled.p(({ theme }) => ({ fontSize: 12, color: theme.color.muted, lineHeight: 1.8, marginTop: 12 }));
const PrimaryButton = styled.button(({ theme }) => ({ minHeight: 46, padding: '10px 18px', border: 0, borderRadius: 6, color: theme.color.surface, background: theme.color.primary, marginTop: 20, fontSize: 14, fontWeight: 600, '&:disabled': { background: theme.color.line, color: theme.color.muted, cursor: 'not-allowed' } }));
const QuietButton = styled.button(({ theme }) => ({ minHeight: 44, padding: '8px 12px', marginTop: 8, background: theme.color.surface, color: theme.color.ink, border: `1px solid ${theme.color.line}`, borderRadius: 6, fontSize: 13, '&:hover': { borderColor: theme.color.input } }));
const TextLink = styled(Link)(({ theme }) => ({ display: 'inline-flex', minHeight: 44, alignItems: 'center', color: theme.color.link, textUnderlineOffset: 4, fontSize: 13 }));
const PrimaryLink = styled(TextLink)(({ theme }) => ({ padding: '8px 18px', borderRadius: 6, background: theme.color.primary, color: theme.color.surface, textDecoration: 'none', fontWeight: 600, '&:hover': { background: theme.color.primaryHover } }));
const BottomActions = styled.div(({ theme }) => ({ marginTop: 28, paddingTop: 20, borderTop: `1px solid ${theme.color.line}` }));
const Aside = styled.aside({ paddingTop: 8, '& > h2': { fontSize: 17, fontWeight: 600 } });
const NextSteps = styled.ol(({ theme }) => ({ listStyle: 'none', padding: 0, margin: '24px 0', display: 'grid', gap: 24, '& strong': { fontSize: 14, fontWeight: 600 }, '& p': { fontSize: 13, lineHeight: 1.85, color: theme.color.muted, marginTop: 6 } }));
const Network = styled.dl(({ theme }) => ({ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 16px', marginTop: 28, paddingTop: 20, borderTop: `1px solid ${theme.color.line}`, fontSize: 12, '& dt': { color: theme.color.muted }, '& dd': { margin: 0, textAlign: 'right' } }));
const State = styled.div({ maxWidth: 1040, margin: '24px auto', lineHeight: 1.8 });
