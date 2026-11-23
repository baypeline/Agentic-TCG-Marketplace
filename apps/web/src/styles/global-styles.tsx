'use client';

import { Global, css } from '@emotion/react';
import { theme } from './theme';

export function GlobalStyles() { return <Global styles={globalStyles} />; }

const globalStyles = css`
  * { box-sizing: border-box; }
  html { height: 100%; overflow: hidden; scroll-padding-top: 96px; }
  body { margin: 0; background: ${theme.color.canvas}; color: ${theme.color.ink};
    font-family: var(--font-pretendard), 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif;
    font-size: 16px; line-height: 1.6; word-break: keep-all; height: 100dvh; overflow: hidden; }
  button, input, select { font: inherit; }
  button, a { touch-action: manipulation; }
  button, a { transition: color ${theme.motion.fast} ease, background-color ${theme.motion.fast} ease, border-color ${theme.motion.fast} ease; }
  button { cursor: pointer; }
  a { color: ${theme.color.link}; text-underline-offset: 4px; }
  :focus-visible { outline: 3px solid ${theme.color.focus}; outline-offset: 4px; }
  h1, h2, h3, p { margin: 0; }
  h1, h2, h3 { line-height: 1.35; }
  img { display: block; }
  button:disabled { cursor: default; }
  ::selection { background: ${theme.color.mat}; color: ${theme.color.ink}; }
  @media (prefers-reduced-motion: reduce) { *, *::before, *::after {
    animation-duration: .01ms !important; transition-duration: .01ms !important; scroll-behavior: auto !important;
  } }
`;
