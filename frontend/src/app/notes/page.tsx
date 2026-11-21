'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { IoCall, IoChatbubble, IoEllipsisHorizontal, IoLogoWhatsapp, IoRefresh } from 'react-icons/io5';

import { AudioPlayer } from '@/components/AudioPlayer';
import { Conversation } from '@/components/Conversation';
import { AccountButton } from '@/components/AccountButton';
import { LargeTitle } from '@/components/ScreenHeader';
import { distanceKm, type VoiceNote } from '@/lib/types';
import { useNotes } from '@/store/notes';
import { useProfile } from '@/store/session';

const dateFmt = (t: number) => new Date(t).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function headline(n: VoiceNote) {
  if (n.status === 'analyzing') return 'Envoi en cours…';
  if (n.status === 'error' || !n.kind) return 'Non envoyé';
  return `${n.kind === 'offer' ? 'Je vends' : 'Je cherche'} ${n.product?.toLowerCase()}${n.quantity ? ` · ${n.quantity}` : ''}`;
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');

export default function NotesPage() {
  const me = useProfile();
  const { notes, deleteNote, retryNote, markSeen } = useNotes();
  const [openId, setOpenId] = useState<string | null>(null);

  // Tout est marqué comme vu en quittant l'onglet, pour que le badge reste visible à l'arrivée.
  useEffect(() => () => markSeen(), [markSeen]);

  useEffect(() => {
    if (!openId) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpenId(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openId]);

  const confirmDelete = (n: VoiceNote) => {
    const extra = n.partner ? `\nLa mise en relation avec ${n.partner.name} sera aussi supprimée.` : '';
    if (window.confirm(`Supprimer cette annonce ?${extra}`)) deleteNote(n.id);
  };

  if (openId) return <Conversation id={openId} onBack={() => setOpenId(null)} />;

  return (
    <div className="screen-col">
      <div className="scroll">
        <LargeTitle title="Mes vocaux" action={<AccountButton />} />

        {notes.length === 0 ? (
          <div className="empty">
            <h3>Aucune annonce</h3>
            <p>Dites ce que vous vendez ou cherchez : nous trouvons la bonne personne.</p>
            <Link href="/" className="btn primary">
              Faire un vocal
            </Link>
          </div>
        ) : (
          <div className="list">
            {notes.map((n) => {
              const p = n.partner;
              const km = p ? distanceKm(me, p) : null;
              return (
                <article key={n.id} className={`note${n.seen ? '' : ' unseen'}`}>
                  <div className="note-head">
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <h3 className="note-product">{headline(n)}</h3>
                      <div className="note-date">
                        {dateFmt(n.createdAt)}
                        {n.place ? ` · ${n.place}` : ''}
                      </div>
                    </div>
                    <button type="button" className="icon-btn" onClick={() => confirmDelete(n)} aria-label="Supprimer l’annonce" title="Supprimer">
                      <IoEllipsisHorizontal size={18} />
                    </button>
                  </div>

                  {n.audioUrl || n.audioId ? (
                    <AudioPlayer src={n.audioUrl} blobId={n.audioId} durationMs={n.durationMs} />
                  ) : (
                    <p className="note-text">{n.text}</p>
                  )}
                  {n.transcript && <p className="note-transcript">{n.transcript}</p>}

                  {n.status === 'matched' && p ? (
                    <div className="match">
                      <div className="match-tag">{p.kind === 'offer' ? 'Vendeur trouvé' : 'Acheteur trouvé'}</div>
                      <div className="person">
                        <div className="avatar">{initials(p.name)}</div>
                        <div style={{ minWidth: 0 }}>
                          <div className="person-name">{p.name}</div>
                          <div className="person-info">
                            {[p.place, km != null ? `${km < 1 ? '< 1' : Math.round(km)} km` : null, p.quantity].filter(Boolean).join(' · ')}
                          </div>
                        </div>
                      </div>
                      <p className="match-quote">{p.transcript_fr}</p>
                      <div className="actions">
                        <a className="action" href={`tel:${p.phone}`}>
                          <IoCall size={20} />
                          Appeler
                        </a>
                        <a className="action" href={`https://wa.me/${p.phone.replace(/\D/g, '')}`} target="_blank" rel="noreferrer">
                          <IoLogoWhatsapp size={20} />
                          WhatsApp
                        </a>
                        <button type="button" className="action" onClick={() => setOpenId(n.id)}>
                          <IoChatbubble size={20} />
                          {n.messagesCount ? `Messages (${n.messagesCount})` : 'Message'}
                          {!n.seen && <span className="dot-new" aria-label="Nouveau" />}
                        </button>
                      </div>
                    </div>
                  ) : n.status === 'error' ? (
                    <div className="status error">
                      <p>{n.error}</p>
                      <button type="button" className="link-btn" onClick={() => retryNote(n.id)}>
                        <IoRefresh size={16} /> Réessayer
                      </button>
                    </div>
                  ) : (
                    <p className="status wait">
                      {n.status === 'analyzing' ? 'Nous écoutons votre message…' : 'En attente d’une personne intéressée. Vous serez prévenu.'}
                    </p>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
