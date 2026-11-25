'use client';

import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import type { CardVariant } from '@tcg/contracts';
import { CardImage } from '../../../components/card-image';
import { getCardDisplayName } from '../../../lib/formatters';
import { startCardSparks } from './card-sparks';
import styles from './card-opening.module.css';

type OpeningPhase = 'sealed' | 'opening' | 'revealed';

export default function CardOpening({ card, onDismiss }: { card: CardVariant; onDismiss: () => void }) {
  const [phase, setPhase] = useState<OpeningPhase>('sealed');
  const dialog = useRef<HTMLDialogElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const close = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const modal = dialog.current;
    modal?.showModal();
    opener.current?.focus();
    return () => { modal?.close(); };
  }, []);

  useEffect(() => {
    if (phase === 'sealed') return;
    close.current?.focus({ preventScroll: true });
    if (phase === 'opening' && canvas.current) return startCardSparks(canvas.current);
  }, [phase]);

  function openPack() {
    setPhase(window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'revealed' : 'opening');
  }

  function tilt(event: PointerEvent<HTMLDialogElement>) {
    if (phase === 'opening' || event.pointerType !== 'mouse') return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width - 0.5;
    const y = (event.clientY - bounds.top) / bounds.height - 0.5;
    const style = event.currentTarget.style;
    style.setProperty('--tilt-x', `${-y * 32}deg`);
    style.setProperty('--tilt-y', `${x * 46}deg`);
    style.setProperty('--shine-x', `${50 + x * 115}%`);
    style.setProperty('--shine-y', `${50 + y * 115}%`);
  }

  function resetTilt(event: PointerEvent<HTMLDialogElement>) {
    for (const property of ['--tilt-x', '--tilt-y', '--shine-x', '--shine-y']) {
      event.currentTarget.style.removeProperty(property);
    }
  }

  if (typeof document === 'undefined') return null;

  return createPortal(
    <dialog
      ref={dialog}
      className={styles.dialog}
      data-phase={phase}
      aria-label="카드 개봉"
      onCancel={event => { event.preventDefault(); onDismiss(); }}
      onKeyDown={event => { if (event.key === 'Escape') event.stopPropagation(); }}
      onPointerMove={tilt}
      onPointerLeave={resetTilt}
    >
      <div className={styles.stage} aria-hidden="true">
        <div className={styles.stars} />
        <div className={styles.aurora} />
        <div className={styles.rings}><i /><i /><i /></div>
        <div className={styles.horizon} />
        <div className={styles.burst} />
        <div className={styles.wave} />
        <div className={styles.pack}>
          <div className={styles.packTilt}>
            <div className={styles.wrapper}>
              <div className={styles.foil}>
                <div className={styles.gem}><i /></div>
              </div>
              <div className={styles.seal} />
            </div>
          </div>
        </div>
        <div
          className={styles.rig}
          onAnimationEnd={event => {
            if (event.target === event.currentTarget && phase === 'opening') setPhase('revealed');
          }}
        >
          <div className={styles.card}>
            <div className={styles.back}><i /></div>
            <div className={styles.front}>
              <CardImage card={card} variant="detail" priority />
            </div>
          </div>
        </div>
        <canvas ref={canvas} className={styles.sparks} />
      </div>

      {phase === 'sealed' && (
        <button ref={opener} type="button" className={styles.opener} onClick={openPack}>
          <span className={styles.cue}><i aria-hidden="true">✦</i> 클릭해서 개봉</span>
        </button>
      )}
      <p className={styles.live} role="status">
        {phase === 'opening' ? '카드를 개봉하고 있습니다.' : phase === 'revealed' ? `${getCardDisplayName(card)} 카드가 공개됐습니다.` : ''}
      </p>
      <button ref={close} type="button" className={styles.close} aria-label="카드 오픈 닫기" onClick={onDismiss}>×</button>
    </dialog>,
    document.body,
  );
}
