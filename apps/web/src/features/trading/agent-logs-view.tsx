'use client';

import { useState } from 'react';
import Link from 'next/link';
import { formatUtc } from '../../lib/formatters';
import { useDemoTrading } from './demo-provider';
import { EmptyRows, Filters, PreviewPage, RecordTable, StateBadge } from './trading-ui';

export function AgentLogsView() {
  const { state } = useDemoTrading();
  const [level, setLevel] = useState('ALL');
  const [query, setQuery] = useState('');
  const rows = state.logs.filter(row => (level === 'ALL' || row.level === level) && `${row.event} ${row.message} ${row.referenceId ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <PreviewPage title="Agent 로그" description="설정 변경과 실행·주문·결제 상태를 확인하는 화면이에요. 실제 Agent가 생성한 로그가 아닌 예시 기록입니다." actions={<Link href="/agent">에이전트 설정</Link>}>
    <Filters><label>수준<select value={level} onChange={e => setLevel(e.target.value)}><option value="ALL">전체</option><option value="INFO">안내</option><option value="WARN">주의</option><option value="ERROR">오류</option></select></label><label>로그 검색<input value={query} onChange={e => setQuery(e.target.value)} placeholder="이벤트·내용·참조 번호" /></label></Filters>
    <RecordTable label={`예시 로그 ${rows.length}건`} headings={['시각 (UTC)', '수준', '이벤트·내용']}>
      {rows.map(row => <tr key={row.id}><td data-label="시각"><time dateTime={row.at}>{formatUtc(row.at)}</time></td><td data-label="수준"><StateBadge status={row.level} /></td><td data-label="내용"><strong>{row.event}</strong><p>{row.message}</p><details><summary>로그 상세</summary><p>출처: UI_DEMO</p>{row.referenceId && <p>참조 번호: {row.referenceId}</p>}<pre>{JSON.stringify(row, null, 2)}</pre></details></td></tr>)}
    </RecordTable>{!rows.length && <EmptyRows />}
  </PreviewPage>;
}
