'use client';

import { useEffect, useId, useRef, useState, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import type { CardVariant } from '@tcg/contracts';
import { CardImage } from '../../../components/card-image';
import { formatSet, getCardDisplayName } from '../../../lib/formatters';
import { startCardSparks } from './card-sparks';
import styles from './card-opening.module.css';

type OpeningPhase = 'sealed' | 'opening' | 'revealed';

export default function CardOpening({ card, onDismiss }: { card: CardVariant; onDismiss: () => void }) {
  const [phase, setPhase] = useState<OpeningPhase>('sealed');
  const dialog = useRef<HTMLDialogElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const openButton = useRef<HTMLButtonElement>(null);
  const revealLink = useRef<HTMLAnchorElement>(null);
  const skip = useRef<HTMLButtonElement>(null);
  const heading = useId();
  const name = getCardDisplayName(card);

  useEffect(() => {
    const modal = dialog.current;
    modal?.showModal();
    openButton.current?.focus();
    return () => { modal?.close(); };
  }, []);

  useEffect(() => {
    if (phase !== 'opening' || !canvas.current) return;
    skip.current?.focus();
    return startCardSparks(canvas.current);
  }, [phase]);

  useEffect(() => {
    if (phase === 'revealed') revealLink.current?.focus();
  }, [phase]);

  function openPack() {
    setPhase(window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'revealed' : 'opening');
  }

  function tilt(event: PointerEvent<HTMLDivElement>) {
    if (phase !== 'revealed' || event.pointerType !== 'mouse') return;
    const scene = event.currentTarget;
    const bounds = scene.getBoundingClientRect();
    scene.style.setProperty('--tilt-x', `${(0.5 - (event.clientY - bounds.top) / bounds.height) * 20}deg`);
    scene.style.setProperty('--tilt-y', `${((event.clientX - bounds.left) / bounds.width - 0.5) * 28}deg`);
    scene.style.setProperty('--shine-x', `${(event.clientX - bounds.left) / bounds.width * 100}%`);
  }

  function resetTilt(event: PointerEvent<HTMLDivElement>) {
    event.currentTarget.style.removeProperty('--tilt-x');
    event.currentTarget.style.removeProperty('--tilt-y');
    event.currentTarget.style.removeProperty('--shine-x');
  }

  if (typeof document === 'undefined') return null;

  return createPortal(
    <dialog
      ref={dialog}
      className={styles.dialog}
      data-phase={phase}
      aria-labelledby={heading}
      onCancel={event => { event.preventDefault(); onDismiss(); }}
      onKeyDown={event => { if (event.key === 'Escape') event.stopPropagation(); }}
    >
      <header className={styles.header}>
        <div>
          <p>구매 완료</p>
          <h2 id={heading}>카드 오픈</h2>
        </div>
        <button type="button" className={styles.close} aria-label="카드 오픈 닫기" onClick={onDismiss}>×</button>
      </header>

      <div className={styles.stage} aria-hidden="true" onPointerMove={tilt} onPointerLeave={resetTilt}>
        <div className={styles.nebula} />
        <div className={styles.orbit} />
        <div className={styles.floor} />
        <div className={styles.burst} />
        <div
          className={styles.rig}
          onAnimationEnd={event => {
            if (event.target === event.currentTarget && phase === 'opening') setPhase('revealed');
          }}
        >
          <div className={styles.card}>
            <div className={styles.back}>
              <span />
              <b>AGENTIC TCG</b>
            </div>
            <div className={styles.front}>
              <CardImage card={card} variant="detail" priority />
            </div>
          </div>
        </div>
        <div className={styles.pack}>
          <div className={styles.foil}>
            <div className={styles.emblem}><span /></div>
            <div className={styles.wordmark}>AGENTIC<span>TCG</span></div>
          </div>
          <div className={styles.seal} />
        </div>
        <canvas ref={canvas} className={styles.sparks} />
      </div>

      <footer className={styles.footer}>
        {phase === 'revealed' ? (
          <>
            <div className={styles.identity} aria-live="polite">
              <h3>{name}</h3>
              <p>{formatSet(card.setCode)} · {card.cardNumber} · {card.language} · {card.condition}</p>
            </div>
            <Link ref={revealLink} className={styles.primary} href="/collection" onClick={onDismiss}>내 카드 보기 <span aria-hidden="true">↗</span></Link>
          </>
        ) : (
          <>
            {phase === 'sealed' ? (
              <button ref={openButton} type="button" className={styles.primary} onClick={openPack}>팩 열기 <span aria-hidden="true">✦</span></button>
            ) : <p className={styles.progress} role="status">팩을 열고 있어요</p>}
            <button ref={skip} type="button" className={styles.skip} onClick={() => setPhase('revealed')}>바로 카드 보기</button>
          </>
        )}
      </footer>
    </dialog>,
    document.body,
  );
}
