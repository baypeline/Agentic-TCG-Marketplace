'use client';

import { useState, type ReactNode } from 'react';
import createCache from '@emotion/cache';
import { CacheProvider } from '@emotion/react';
import { useServerInsertedHTML } from 'next/navigation';

/** cache를 요청별로 만들고 스트리밍 중 새 규칙만 head로 전달한다. */
export function EmotionRegistry({ children }: { children: ReactNode }) {
  const [{ cache, flush }] = useState(() => {
    const cache = createCache({ key: 'tcg' });
    cache.compat = true;
    const originalInsert = cache.insert;
    let pending: { name: string; global: boolean }[] = [];
    cache.insert = (...args) => {
      const [selector, serialized] = args;
      if (cache.inserted[serialized.name] === undefined) pending.push({ name: serialized.name, global: !selector });
      return originalInsert(...args);
    };
    return { cache, flush() { const rules = pending; pending = []; return rules; } };
  });
  useServerInsertedHTML(() => {
    const rules = flush();
    if (!rules.length) return null;
    let css = ''; let names = '';
    const globals: { name: string; css: string }[] = [];
    for (const rule of rules) {
      const value = cache.inserted[rule.name];
      if (typeof value !== 'string') continue;
      if (rule.global) globals.push({ name: rule.name, css: value });
      else { names += ` ${rule.name}`; css += value; }
    }
    return <>
      {globals.map(rule => <style key={rule.name} data-emotion={`${cache.key}-global ${rule.name}`} dangerouslySetInnerHTML={{ __html: rule.css }} />)}
      {css && <style data-emotion={`${cache.key}${names}`} dangerouslySetInnerHTML={{ __html: css }} />}
    </>;
  });
  return <CacheProvider value={cache}>{children}</CacheProvider>;
}
