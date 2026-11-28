'use client';

import type { Currency } from '@tcg/contracts/payment-profile';
import { useState } from 'react';
import Link from 'next/link';
import styled from '@emotion/styled';
import { CardImage } from '../../components/card-image';
import { getCardDisplayName, formatSet } from '../../lib/formatters';
import type { DiscoveryData } from '../../lib/discovery';
import { SellerGuide } from '../trading/seller-guide';

const exampleSteps = [
  { label: '조건 확인', title: '맡길 범위를 먼저 정해요', description: '영문판 피카츄 한 장, 최대 10 USDC. 에이전트는 허용한 카드와 거래 한도 안에서만 구매를 검토해요.', rows: [['찾는 카드', '피카츄 · 영문판'], ['구매 수량', '1장'], ['1회 구매 한도', '10 USDC']], note: '예산과 거래 허용 범위는 에이전트 설정에서 직접 정해요.' },
  { label: '매물 검토', title: '조건에 맞는 매물을 살펴봐요', description: '카드의 세트·번호·언어와 판매 가격을 확인해요. 적정가 조건이 있다면 평가 자료가 충분한지도 함께 검토해요.', rows: [['예시 매물 가격', '8 USDC'], ['구매 한도', '10 USDC 이하'], ['구매 전 확인', '카드 일치 · 예산 · 매물 상태']], note: '8 USDC는 흐름 설명을 위한 가상 금액이며 실제 매물이나 시세가 아니에요.' },
  { label: '결제 확인', title: '결제가 확인돼야 거래가 이어져요', description: '구매 조건이 충족되면 x402로 Base Sepolia 테스트 USDC 결제를 진행해요. 수취인은 플랫폼 수납 지갑이에요.', rows: [['예시 결제 금액', '8 USDC'], ['수취인', '플랫폼 수납 지갑'], ['체결 전 확인', '온체인 정산 성공']], note: '이 화면에서는 서명이나 송금이 발생하지 않아요. 실제 구매는 에이전트 대화에서 금액을 확인한 뒤 진행해요.' },
  { label: '카드 반영', title: '구매 결과를 한곳에서 확인해요', description: '정산 성공을 확인한 뒤 서비스 안에서 카드 소유권을 옮겨요. 구매한 카드는 내 카드에, 처리 과정은 거래 내역과 로그에 남아요.', rows: [['내 카드', '구매 카드 반영'], ['거래 내역', '주문 · 결제 결과'], ['Agent 로그', '판단과 처리 과정']], note: '일반 매물은 서비스 안의 보유 카드에 반영돼요. NFT 매물은 결제와 함께 NFT 소유권도 이전돼요.' },
];

export function LandingView({ discovery, currency = 'USDC' }: { discovery: DiscoveryData; currency?: Currency }) {
  const [step, setStep] = useState(0);
  const cards = [...discovery.spotlight.map(item => item.card), ...discovery.family]
    .filter((card, index, all) => all.findIndex(item => item.id === card.id) === index).slice(0, 4);
  const featuredName = cards[0] ? getCardDisplayName(cards[0]) : '치라미';
  const featuredLanguage = cards[0]?.language === 'EN' ? '영문판' : '한국어판';
  const text = (value: string) => value.replaceAll('USDC', currency).replaceAll('Base Sepolia', currency === 'tOKRW' ? 'Maroo Testnet' : 'Base Sepolia').replaceAll('영문판 피카츄', `${featuredLanguage} ${featuredName}`).replaceAll('피카츄 · 영문판', `${featuredName} · ${featuredLanguage}`);
  const original = exampleSteps[step]!;
  const current = { ...original, description: text(original.description), note: text(original.note), rows: original.rows.map(row => row.map(text)) };
  return <>
    <Hero>
      <Introduction><h1>카드 구매는<br />AI 에이전트에게</h1><p>원하는 카드와 예산을 정해 구매를 맡겨요. 보유 카드는 내가 정한 가격으로 직접 판매 등록할 수 있어요.</p><HeroActions><PrimaryLink href="/agent">구매 조건 정하기</PrimaryLink><SellerLink href="/collection#owned-cards">보유 카드 판매하기</SellerLink></HeroActions><TextLink href="/cards">카드 먼저 찾아보기</TextLink><Availability>로그인하면 전용 지갑이 생성돼요. 충전과 예산 설정 후 구매를 시작할 수 있어요.</Availability></Introduction>
      <Showcase aria-label="거래할 수 있는 한국어판 카드">{cards.slice(0, 3).map(card => <ShowcaseCard key={card.id} href={`/cards/${card.id}`}><CardImage card={card} /><span>{getCardDisplayName(card)}</span></ShowcaseCard>)}</Showcase>
    </Hero>
      <Example aria-labelledby="example-heading">
        <ExampleHeading><h2 id="example-heading">에이전트에게 구매를 맡기면</h2><span>설명용 예시</span></ExampleHeading>
        <Request><span>내가 원하는 거래</span><p>“{featuredLanguage} {featuredName} 한 장을<br /><strong>10 {currency} 이하</strong>로 구해줘.”</p></Request>
        <StepButtons aria-label="거래 과정 살펴보기">{exampleSteps.map((item, index) => <StepButton key={item.label} type="button" aria-pressed={step === index} aria-controls="trade-example-detail" onClick={() => setStep(index)}><span aria-hidden="true">{index + 1}</span>{item.label}</StepButton>)}</StepButtons>
        <StepDetail id="trade-example-detail" aria-live="polite" aria-atomic="true"><h3>{current.title}</h3><p>{current.description}</p><Facts>{current.rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</Facts><ExampleNote>{current.note}</ExampleNote></StepDetail>
      </Example>
    <SellerGuide currency={currency} live />
    <ControlSection aria-labelledby="control-heading"><SectionIntro><h2 id="control-heading">맡겨도, 기준은 내가 정해요</h2><p>구매 조건부터 거래 결과까지 직접 확인할 수 있어요.</p></SectionIntro><ControlGrid>
      <ControlItem><h3>예산 안에서</h3><p>총예산과 1회 한도, 거래할 카드를 정해 에이전트의 구매 범위를 제한해요.</p><TextLink href="/agent">예산과 정책 설정</TextLink></ControlItem>
      <ControlItem><h3>필요할 때 멈추고</h3><p>실행 상태를 확인하고 신규 거래를 일시중지하거나 중지할 수 있어요.</p><TextLink href="/agent">실행 내역 확인</TextLink></ControlItem>
      <ControlItem><h3>과정까지 확인해요</h3><p>주문과 결제 상태, 에이전트의 판단 기록을 나누어 살펴볼 수 있어요.</p><TextLink href="/activity">거래 내역 확인</TextLink></ControlItem>
    </ControlGrid></ControlSection>
    <CatalogSection aria-labelledby="catalog-heading"><CatalogHeading><SectionIntro><h2 id="catalog-heading">어떤 카드를 맡길지 살펴보세요</h2><p>눈길이 가는 카드를 고르고, 원하는 가격으로 구매를 맡겨 보세요.</p></SectionIntro><TextLink href="/cards">카드 검색으로 이동</TextLink></CatalogHeading><CardGrid>{cards.map(card => <CatalogCard key={card.id}><ArtworkLink href={`/cards/${card.id}?${new URLSearchParams({ q: card.name })}`} aria-label={`${getCardDisplayName(card)} ${formatSet(card.setCode)} ${card.cardNumber} 상세 보기`}><CardImage card={card} /></ArtworkLink><h3><TextLink href={`/cards/${card.id}?${new URLSearchParams({ q: card.name })}`}>{getCardDisplayName(card)}</TextLink></h3><p>{formatSet(card.setCode)} / {card.cardNumber} / {card.language}</p></CatalogCard>)}</CardGrid>{(discovery.spotlightFailed || discovery.familyFailed) && <CatalogNote role="status">일부 카드 정보를 불러오지 못했어요. 카드 검색에서 다시 확인해 주세요.</CatalogNote>}{!cards.length && !discovery.spotlightFailed && !discovery.familyFailed && <CatalogNote>아직 보여드릴 카드가 없어요. 카드 검색에서 이름으로 찾아보세요.</CatalogNote>}<CatalogNote>해외 참고 시세는 판매 희망가·집계가로, 실제 매물 가격이나 적정가와는 구분해요. 출처와 판본·상태는 카드 상세에서 확인해 주세요.</CatalogNote></CatalogSection>
  </>;
}

const Hero = styled.section({ display: 'grid', gridTemplateColumns: 'minmax(0,.9fr) minmax(0,1.1fr)', alignItems: 'center', gap: 48, padding: '16px 0 64px', '@container browse (max-width:880px)': { gridTemplateColumns: 'minmax(0,1fr)', gap: 36 }, '@media(max-width:639px)': { padding: '0 0 40px', gap: 28 } });
const Introduction = styled.div(({ theme }) => ({ minWidth: 0, '& h1': { fontSize: 'clamp(34px,3.5vw,52px)', fontWeight: 600, letterSpacing: '-.045em', lineHeight: 1.22, textWrap: 'balance' }, '& > p': { color: theme.color.muted, fontSize: 16, marginTop: 24, maxWidth: 430, lineHeight: 1.85 } }));
const HeroActions = styled.div({ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px 20px', marginTop: 28 });
const PrimaryLink = styled(Link)(({ theme }) => ({ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minHeight: 48, padding: '10px 22px', borderRadius: theme.radius.control, color: theme.color.surface, background: theme.color.primary, textDecoration: 'none', fontSize: 14, fontWeight: 600, '&:hover': { background: theme.color.primaryHover } }));
const SellerLink = styled(Link)(({ theme }) => ({ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minHeight: 48, padding: '10px 20px', border: `1px solid ${theme.color.input}`, borderRadius: theme.radius.control, color: theme.color.ink, textDecoration: 'none', fontSize: 14, fontWeight: 600, '&:hover': { borderColor: theme.color.primary, color: theme.color.link } }));
const TextLink = styled(Link)(({ theme }) => ({ display: 'inline-flex', alignItems: 'center', minHeight: 44, fontSize: 14, color: theme.color.ink, textUnderlineOffset: 4 }));
const Availability = styled.small(({ theme }) => ({ display: 'block', marginTop: 16, color: theme.color.muted, fontSize: 12, lineHeight: 1.7, maxWidth: 380 }));
const Showcase = styled.div({ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 22, minWidth: 0, padding: '24px 0', '@media(max-width:639px)': { gap: 12, padding: '12px 0 0' } });
const ShowcaseCard = styled(Link)(({ theme }) => ({ width: '30%', minWidth: 0, color: theme.color.ink, textDecoration: 'none', '&:first-of-type': { width: '36%' }, '& > span': { display: 'block', marginTop: 12, fontSize: 14, fontWeight: 550, textAlign: 'center' }, '&:hover span': { textDecoration: 'underline' }, '&:focus-visible': { outlineOffset: 6 } }));
const Example = styled.div(({ theme }) => ({ minWidth: 0, border: `1px solid ${theme.color.line}`, borderRadius: theme.radius.panel, overflow: 'hidden', marginBottom: 40, background: theme.color.surface }));
const ExampleHeading = styled.div(({ theme }) => ({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, padding: '18px 24px', borderBottom: `1px solid ${theme.color.line}`, '& h2': { fontSize: 15, fontWeight: 600 }, '& > span': { fontSize: 12, color: theme.color.demo } }));
const Request = styled.div(({ theme }) => ({ padding: '24px 24px 20px', '& > span': { color: theme.color.muted, fontSize: 12 }, '& p': { marginTop: 10, fontSize: 23, lineHeight: 1.55, letterSpacing: '-.025em' }, '& strong': { fontWeight: 600 } }));
const StepButtons = styled.div(({ theme }) => ({ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', marginInline: 24, borderBottom: `1px solid ${theme.color.line}`, '@media(max-width:639px)': { marginInline: 16 } }));
const StepButton = styled.button(({ theme }) => ({ display: 'flex', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: 6, minHeight: 52, padding: '10px 2px', border: 0, borderBottom: '2px solid transparent', background: theme.color.surface, color: theme.color.muted, font: 'inherit', fontSize: 12, '& > span': { fontSize: 11 }, '&[aria-pressed=true]': { color: theme.color.primary, borderBottomColor: theme.color.primary, fontWeight: 650 }, '&:hover': { color: theme.color.ink } }));
const StepDetail = styled.div(({ theme }) => ({ padding: '24px', minHeight: 240, '& h3': { fontSize: 18, fontWeight: 600, letterSpacing: '-.025em' }, '& > p': { fontSize: 14, lineHeight: 1.8, color: theme.color.muted, marginTop: 12 }, '@media(max-width:639px)': { padding: '20px 16px', minHeight: 280 } }));
const Facts = styled.dl(({ theme }) => ({ marginTop: 20, '& > div': { display: 'flex', justifyContent: 'space-between', gap: 16, paddingBlock: 9, borderBottom: `1px solid ${theme.color.line}`, fontSize: 13, lineHeight: 1.6 }, '& dt': { color: theme.color.muted, flexShrink: 0 }, '& dd': { margin: 0, textAlign: 'right', overflowWrap: 'anywhere', fontWeight: 550 } }));
const ExampleNote = styled.small(({ theme }) => ({ display: 'block', marginTop: 16, fontSize: 12, lineHeight: 1.7, color: theme.color.muted }));
const ControlSection = styled.section(({ theme }) => ({ borderTop: `1px solid ${theme.color.line}`, padding: '36px 0 48px' }));
const SectionIntro = styled.div(({ theme }) => ({ '& h2': { fontSize: 25, fontWeight: 550, letterSpacing: '-.035em', textWrap: 'balance' }, '& > p': { fontSize: 14, color: theme.color.muted, marginTop: 12, lineHeight: 1.8 } }));
const ControlGrid = styled.div({ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 32, marginTop: 32, '@container browse (max-width:650px)': { gridTemplateColumns: 'minmax(0,1fr)', gap: 24 } });
const ControlItem = styled.div(({ theme }) => ({ '& h3': { fontSize: 17, fontWeight: 600 }, '& p': { marginTop: 10, color: theme.color.muted, fontSize: 14, lineHeight: 1.85, maxWidth: 320 }, '& > a': { marginTop: 8 } }));
const CatalogSection = styled.section(({ theme }) => ({ borderTop: `1px solid ${theme.color.line}`, paddingTop: 36 }));
const CatalogHeading = styled.div({ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16, marginBottom: 28 });
const CardGrid = styled.div({ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 28, '@container browse (max-width:650px)': { gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: '24px 20px' } });
const CatalogCard = styled.article(({ theme }) => ({ minWidth: 0, maxWidth: 190, width: '100%', '& h3': { marginTop: 10, fontWeight: 550, '& a': { fontSize: 16 } }, '& p': { fontSize: 12, color: theme.color.muted, lineHeight: 1.7 } }));
const ArtworkLink = styled(Link)({ display: 'block', minWidth: 0 });
const CatalogNote = styled.p(({ theme }) => ({ marginTop: 24, maxWidth: 760, color: theme.color.muted, fontSize: 12, lineHeight: 1.8 }));
