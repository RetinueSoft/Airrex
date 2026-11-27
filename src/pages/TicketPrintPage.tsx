// Upload an e-ticket (PDF or image), cover parts you don't want printed (fare, phone, email, PNR…), then print.
// Agents can also add their agency header/footer and auto-hide fares on PDF tickets.
// Everything happens inside the browser: the ticket is never uploaded to any server.

import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { Link } from 'react-router-dom';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { AgentProfile } from '../../shared/types.ts';
import { useAgent } from '../lib/agent.tsx';
import Icon from '../components/Icon.tsx';
import { TRIAL_DAYS } from '../lib/config.ts';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

type MaskColor = 'black' | 'white';
interface Box { x: number; y: number; w: number; h: number } // fractions of page size
interface Mask extends Box { id: number; color: MaskColor }
interface TextItem extends Box { str: string }
interface Page { id: string; src: string; width: number; height: number; masks: Mask[]; text?: TextItem[] }

let nextId = 1;

async function fileToPages(file: File): Promise<Page[]> {
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const pages: Page[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, canvas, viewport }).promise;

      // Text positions, used by "Auto-hide fares".
      const text: TextItem[] = [];
      try {
        const content = await page.getTextContent();
        for (const item of content.items) {
          if (!('str' in item) || !item.str.trim()) continue;
          const tx = pdfjs.Util.transform(viewport.transform, item.transform);
          const fontH = Math.hypot(tx[2], tx[3]);
          const w = item.width * viewport.scale;
          text.push({
            str: item.str,
            x: tx[4] / canvas.width,
            y: (tx[5] - fontH) / canvas.height,
            w: w / canvas.width,
            h: (fontH * 1.25) / canvas.height,
          });
        }
      } catch {
        /* scanned PDF without text: auto-hide unavailable */
      }
      pages.push({ id: `${file.name}-${n}-${nextId++}`, src: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height, masks: [], text });
    }
    await doc.cleanup();
    return pages;
  }
  if (file.type.startsWith('image/')) {
    const src = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
    const img = await loadImage(src);
    return [{ id: `${file.name}-${nextId++}`, src, width: img.naturalWidth, height: img.naturalHeight, masks: [] }];
  }
  throw new Error(`${file.name}: please choose a PDF or an image (JPG, PNG).`);
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// ---- Auto-hide fares ------------------------------------------------------------------------
// Words that appear on fare lines ("Total Airfare", "India CGST", "User Development Fee", "Fuel Surcharge (YQ)"…).
const FARE_WORDS = /fare|total|amount|tax|fee|charge|surcharge|gst|\bk3\b|\byq\b|\byr\b|\bpaid\b|price|cost|discount|\bbase\b|grand|payable|refund/i;
// Headings that start a fare block ("Fare Details", "Payment Details", "Price Summary"…).
const FARE_HEADING = /fare|payment|price|amount|charges|billing/i;
const CURRENCY = /(₹|\bINR\b|\bRs\.?)/i;
const CURRENCY_ONLY = /^\s*(₹|INR|Rs\.?)\s*$/i;
const AMOUNT = /\d[\d,]*(\.\d{1,2})?/;
// Numbers that are not money: times, weights, durations, terminals, dates.
const NOT_MONEY = /(\d{1,2}:\d{2})|\bkgs?\b|\bhrs?\b|\bmins?\b|\bterminal\b|(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i;

export type AutoHideMode = 'section' | 'amounts';

interface Line {
  items: TextItem[];
  top: number;
  bottom: number;
  text: string;
}

function toLines(text: TextItem[]): Line[] {
  const groups: TextItem[][] = [];
  for (const t of [...text].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const g = groups.find((l) => Math.abs(l[0].y - t.y) < t.h * 0.5);
    if (g) g.push(t);
    else groups.push([t]);
  }
  return groups.map((items) => ({
    items: items.sort((a, b) => a.x - b.x),
    top: Math.min(...items.map((t) => t.y)),
    bottom: Math.max(...items.map((t) => t.y + t.h)),
    text: items.map((t) => t.str).join(' '),
  }));
}

function isMoneyItem(t: TextItem, fareLine: boolean) {
  if (NOT_MONEY.test(t.str) || !AMOUNT.test(t.str)) return false;
  return CURRENCY.test(t.str) || (fareLine && t.str.replace(/\D/g, '').length >= 1);
}

/** A line that shows a price: it mentions fare/tax/total or a currency, and has an amount on it. */
function isFareLine(l: Line) {
  const fareish = FARE_WORDS.test(l.text) || CURRENCY.test(l.text);
  return fareish && l.items.some((t) => isMoneyItem(t, true));
}

function bbox(items: Box[]): Box {
  const x0 = Math.min(...items.map((b) => b.x));
  const y0 = Math.min(...items.map((b) => b.y));
  const x1 = Math.max(...items.map((b) => b.x + b.w));
  const y1 = Math.max(...items.map((b) => b.y + b.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * Boxes to cover the fare on a PDF ticket.
 *  - 'amounts': each amount and its ₹ sign.
 *  - 'section': the whole fare block — its heading, every label and amount, and anything printed
 *    beside it in the same rows (e.g. "Mode of Payment / UPI ₹…").
 */
function findFareBoxes(text: TextItem[], mode: AutoHideMode): Box[] {
  const lines = toLines(text);
  const fareLines = lines.filter(isFareLine);
  if (!fareLines.length) return [];

  if (mode === 'amounts') {
    const boxes: Box[] = [];
    for (const l of lines) {
      const fareLine = isFareLine(l);
      l.items.forEach((t, i) => {
        const money = isMoneyItem(t, fareLine);
        // A lone "₹" next to an amount is a separate text piece in many PDFs: cover it too.
        const currencyNextToMoney = CURRENCY_ONLY.test(t.str) && l.items[i + 1] && isMoneyItem(l.items[i + 1], true);
        if (money || currencyNextToMoney) {
          const pad = t.h * 0.15;
          boxes.push({ x: t.x - pad, y: t.y - pad, w: t.w + pad * 2, h: t.h + pad * 2 });
        }
      });
    }
    return boxes;
  }

  // Group fare lines that sit close together into blocks.
  const lineH = Math.min(...fareLines.map((l) => l.bottom - l.top));
  const blocks: Line[][] = [];
  for (const l of fareLines) {
    const last = blocks[blocks.length - 1];
    if (last && l.top - last[last.length - 1].bottom < lineH * 2.5) last.push(l);
    else blocks.push([l]);
  }

  const boxes: Box[] = [];
  for (const block of blocks) {
    let top = block[0].top;
    const bottom = block[block.length - 1].bottom;
    // Include a heading just above the block ("Fare Details") that has no amount itself.
    const heading = [...lines]
      .reverse()
      .find((l) => l.bottom <= top + 0.0001 && top - l.bottom < lineH * 3 && FARE_HEADING.test(l.text) && !isFareLine(l));
    if (heading) top = heading.top;
    // Everything printed in these rows belongs to the section (labels, ₹ signs, payment column).
    const inBand = text.filter((t) => t.y + t.h / 2 >= top && t.y + t.h / 2 <= bottom);
    const b = bbox(inBand);
    const padX = 0.02;
    const padY = lineH * 0.45;
    boxes.push({ x: b.x - padX, y: b.y - padY, w: b.w + padX * 2, h: b.h + padY * 2 });
  }
  return boxes;
}

// ---- Drawing the agency header/footer on the printed page --------------------------------------
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

// Layout units: 1 unit = page width / 1190 (an A4 page rendered at 2× is 1190 px wide).
// The same numbers drive the canvas (print) and the CSS preview (via cqw units), so they match.
const U = 1190;
const BRAND = { pad: 48, logoH: 90, logoW: 240, logoGap: 28, name: 34, nameGap: 44, line: 19, lineGap: 26, rule: 6, footText: 20, footLine: 28, footPadTop: 26 };

interface BrandLayout {
  headerH: number; // in page pixels
  footerH: number;
  headerLines: string[];
  footerLines: string[];
  /** Scale applied to the ticket so page + header + footer fit in the original page size. */
  scale: number;
}

function brandLayout(page: Page, agent: AgentProfile | null, header: boolean, footer: boolean, footerNote: string): BrandLayout {
  const W = page.width;
  const u = W / U;
  const contact = agent
    ? [agent.phone && `Phone ${agent.phone}`, agent.whatsapp && agent.whatsapp !== agent.phone && `WhatsApp ${agent.whatsapp}`, agent.website].filter(Boolean).join('   ·   ')
    : '';
  const headerLines = agent ? ([[agent.address, agent.city].filter(Boolean).join(', '), contact, agent.gstin && `GSTIN: ${agent.gstin}`].filter(Boolean) as string[]) : [];
  const headerH = header && agent ? Math.max(130, 70 + headerLines.length * BRAND.lineGap) * u : 0;

  const measure = document.createElement('canvas').getContext('2d')!;
  measure.font = `400 ${BRAND.footText * u}px "Instrument Sans", system-ui, sans-serif`;
  const footerText = agent ? [footerNote, agent.ticketFooter].filter(Boolean).join('  ·  ') || `Booked through ${agent.agencyName}` : '';
  const footerLines = footer && agent ? wrapText(measure, footerText, W - BRAND.pad * 2 * u) : [];
  const footerH = footerLines.length ? (34 + footerLines.length * BRAND.footLine) * u : 0;

  const scale = (page.height - headerH - footerH) / page.height;
  return { headerH, footerH, headerLines, footerLines, scale };
}

/**
 * The printed page. It keeps the ORIGINAL page size (e.g. A4): the agency header goes at the top,
 * the footer at the bottom, and the ticket is shrunk slightly to fit between them, so one ticket page
 * still prints on exactly one sheet of paper.
 */
async function brandedCanvas(page: Page, agent: AgentProfile | null, header: boolean, footer: boolean, footerNote: string) {
  const img = await loadImage(page.src);
  const W = page.width;
  const H = page.height;
  const u = W / U;
  const font = (size: number, weight = 400) => `${weight} ${Math.round(size * u)}px "Instrument Sans", system-ui, sans-serif`;
  const pad = BRAND.pad * u;
  const { headerH, footerH, headerLines, footerLines, scale } = brandLayout(page, agent, header, footer, footerNote);

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);

  // Ticket, shrunk and centred between header and footer.
  const tw = W * scale;
  const th = H * scale;
  const tx = (W - tw) / 2;
  const ty = headerH;
  ctx.drawImage(img, tx, ty, tw, th);
  for (const m of page.masks) {
    ctx.fillStyle = m.color === 'black' ? '#000' : '#fff';
    ctx.fillRect(tx + m.x * tw, ty + m.y * th, m.w * tw, m.h * th);
  }

  if (headerH && agent) {
    let x = pad;
    if (agent.logo) {
      const logo = await loadImage(agent.logo);
      const s = Math.min((BRAND.logoH * u) / logo.naturalHeight, (BRAND.logoW * u) / logo.naturalWidth);
      const lw = logo.naturalWidth * s;
      const lh = logo.naturalHeight * s;
      ctx.drawImage(logo, x, (headerH - lh) / 2, lw, lh);
      x += lw + BRAND.logoGap * u;
    }
    ctx.fillStyle = agent.brandColor;
    ctx.font = font(BRAND.name, 700);
    ctx.textBaseline = 'top';
    let y = (headerH - (40 + headerLines.length * BRAND.lineGap) * u) / 2;
    ctx.fillText(agent.agencyName, x, y, W - x - pad);
    y += BRAND.nameGap * u;
    ctx.fillStyle = '#434655';
    ctx.font = font(BRAND.line);
    for (const l of headerLines) {
      ctx.fillText(l, x, y, W - x - pad);
      y += BRAND.lineGap * u;
    }
    ctx.fillStyle = agent.brandColor;
    ctx.fillRect(0, headerH - BRAND.rule * u, W, BRAND.rule * u);
  }

  if (footerH && agent) {
    const top = H - footerH;
    ctx.fillStyle = agent.brandColor;
    ctx.fillRect(pad, top + 10 * u, W - pad * 2, 3 * u);
    ctx.fillStyle = '#434655';
    ctx.font = font(BRAND.footText);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    footerLines.forEach((l, i) => ctx.fillText(l, W / 2, top + (BRAND.footPadTop + i * BRAND.footLine) * u));
  }
  return canvas.toDataURL('image/png');
}

/** Screen preview of the header, sized with cqw units so it matches the printed page exactly. */
function PreviewHeader({ agent, layout, width }: { agent: AgentProfile; layout: BrandLayout; width: number }) {
  const cq = (units: number) => `${(units / U) * 100}cqw`;
  return (
    <div className="pv-header" style={{ height: `${(layout.headerH / width) * 100}cqw`, padding: `0 ${cq(BRAND.pad)}`, borderBottom: `${cq(BRAND.rule)} solid ${agent.brandColor}` }}>
      {agent.logo && <img src={agent.logo} alt="" style={{ maxHeight: cq(BRAND.logoH), maxWidth: cq(BRAND.logoW), marginRight: cq(BRAND.logoGap) }} />}
      <div className="pv-lines">
        <div style={{ color: agent.brandColor, fontSize: cq(BRAND.name), fontWeight: 700, lineHeight: cq(BRAND.nameGap) }}>{agent.agencyName}</div>
        {layout.headerLines.map((l) => (
          <div key={l} style={{ fontSize: cq(BRAND.line), lineHeight: cq(BRAND.lineGap) }}>{l}</div>
        ))}
      </div>
    </div>
  );
}

function PreviewFooter({ agent, layout, width }: { agent: AgentProfile; layout: BrandLayout; width: number }) {
  const cq = (units: number) => `${(units / U) * 100}cqw`;
  return (
    <div className="pv-footer" style={{ height: `${(layout.footerH / width) * 100}cqw`, padding: `${cq(10)} ${cq(BRAND.pad)} 0` }}>
      <div style={{ borderTop: `${cq(3)} solid ${agent.brandColor}`, paddingTop: cq(BRAND.footPadTop - 13) }}>
        {layout.footerLines.map((l) => (
          <div key={l} style={{ fontSize: cq(BRAND.footText), lineHeight: cq(BRAND.footLine) }}>{l}</div>
        ))}
      </div>
    </div>
  );
}

export default function TicketPrintPage() {
  const { agent } = useAgent();
  const canBrand = !!agent?.active;
  const [pages, setPages] = useState<Page[]>([]);
  const [color, setColor] = useState<MaskColor>('white');
  const [drawMode, setDrawMode] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [printImages, setPrintImages] = useState<string[]>([]);
  const [draft, setDraft] = useState<{ pageId: string; x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [useHeader, setUseHeader] = useState(true);
  const [useFooter, setUseFooter] = useState(true);
  const [footerNote, setFooterNote] = useState('');
  const [hideMode, setHideMode] = useState<AutoHideMode>('section');
  const history = useRef<Page[][]>([]);

  const header = canBrand && useHeader;
  const footer = canBrand && useFooter;

  function commit(next: Page[]) {
    history.current.push(pages);
    setPages(next);
  }

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setError('');
    setInfo('');
    try {
      const all: Page[] = [];
      for (const f of Array.from(files)) all.push(...(await fileToPages(f)));
      commit([...pages, ...all]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open that file.');
    } finally {
      setBusy(false);
    }
  }

  function autoHide() {
    let count = 0;
    let withText = 0;
    const next = pages.map((p) => {
      if (!p.text?.length) return p;
      withText++;
      const boxes = findFareBoxes(p.text, hideMode);
      count += boxes.length;
      return { ...p, masks: [...p.masks, ...boxes.map((b) => ({ ...b, id: nextId++, color }))] };
    });
    if (!withText) {
      setInfo('Auto-hide works on PDF e-tickets downloaded from the airline. For photos or scans, drag over the fare to hide it.');
      return;
    }
    commit(next);
    const what = hideMode === 'section' ? `fare section${count === 1 ? '' : 's'}` : `price amount${count === 1 ? '' : 's'}`;
    setInfo(
      count
        ? `Hid ${count} ${what}. Please check the ticket: drag to hide anything missed, or tap × on a box to show it again.`
        : 'No fare details found. Drag over the fare to hide it.',
    );
  }

  function point(e: RPointerEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
  }

  function onDown(pageId: string, e: RPointerEvent<HTMLDivElement>) {
    if (!drawMode || (e.target as HTMLElement).closest('.mask')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = point(e);
    setDraft({ pageId, x0: p.x, y0: p.y, x1: p.x, y1: p.y });
  }

  function onMove(e: RPointerEvent<HTMLDivElement>) {
    if (!draft) return;
    const p = point(e);
    setDraft({ ...draft, x1: p.x, y1: p.y });
  }

  function onUp() {
    if (!draft) return;
    const x = Math.min(draft.x0, draft.x1);
    const y = Math.min(draft.y0, draft.y1);
    const w = Math.abs(draft.x1 - draft.x0);
    const h = Math.abs(draft.y1 - draft.y0);
    setDraft(null);
    if (w < 0.01 || h < 0.005) return;
    commit(pages.map((p) => (p.id === draft.pageId ? { ...p, masks: [...p.masks, { id: nextId++, x, y, w, h, color }] } : p)));
  }

  function removeMask(pageId: string, maskId: number) {
    commit(pages.map((p) => (p.id === pageId ? { ...p, masks: p.masks.filter((m) => m.id !== maskId) } : p)));
  }

  function undo() {
    const prev = history.current.pop();
    if (prev) setPages(prev);
  }

  async function print() {
    setBusy(true);
    try {
      setPrintImages(await Promise.all(pages.map((p) => brandedCanvas(p, agent, header, footer, footerNote))));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!printImages.length) return;
    const imgs = Array.from(document.querySelectorAll<HTMLImageElement>('#print-area img'));
    Promise.all(imgs.map((i) => (i.complete ? Promise.resolve() : new Promise((r) => (i.onload = r))))).then(() => {
      window.print();
      setPrintImages([]);
    });
  }, [printImages]);

  const maskCount = pages.reduce((n, p) => n + p.masks.length, 0);

  return (
    <div className="page print-tool">
      <div className="no-print">
        <h1>Print your ticket</h1>
        <p className="muted">
          Upload the e-ticket from the airline (PDF or photo). Drag over anything you want to hide (fare, phone number, email,
          address), then print or "Save as PDF". Your ticket stays on this device; it is not uploaded anywhere.
        </p>

        {!agent && (
          <div className="agent-promo">
            <Icon name="storefront" size={22} />
            <div className="grow">
              <b>Travel agent?</b> Print tickets with your agency logo and contact details, and hide the airline fare in one tap.
            </div>
            <Link className="btn primary" to="/agent/login">Try free for {TRIAL_DAYS} days</Link>
          </div>
        )}
        {agent && !agent.active && (
          <div className="plan-banner expired">
            <Icon name="error" size={22} />
            <div className="grow">Your agent plan has ended, so branding and auto-hide are paused. <Link to="/agent">Renew</Link></div>
          </div>
        )}

        <div className="toolbar">
          <label className="btn primary file-btn">
            <Icon name="upload_file" /> {pages.length ? 'Add more pages' : 'Choose e-ticket'}
            <input type="file" accept="application/pdf,image/*" multiple onChange={(e) => { onFiles(e.target.files); e.target.value = ''; }} />
          </label>
          {pages.length > 0 && (
            <>
              {canBrand && (
                <div className="autohide-group">
                  <button className="btn tonal" onClick={autoHide} title="Find and hide the fare on PDF tickets">
                    <Icon name="auto_fix_high" /> Auto-hide fares
                  </button>
                  <div className="seg small" role="group" aria-label="What auto-hide covers">
                    <button className={hideMode === 'section' ? 'active' : ''} onClick={() => setHideMode('section')} title="Fare heading, all fare lines and the payment column">
                      Whole section
                    </button>
                    <button className={hideMode === 'amounts' ? 'active' : ''} onClick={() => setHideMode('amounts')} title="Only the ₹ amounts, keep labels">
                      Amounts only
                    </button>
                  </div>
                </div>
              )}
              <div className="seg" role="group" aria-label="Cover colour">
                <button className={color === 'white' ? 'active' : ''} onClick={() => setColor('white')}>□ Blank out</button>
                <button className={color === 'black' ? 'active' : ''} onClick={() => setColor('black')}>■ Black bar</button>
              </div>
              <button className={`btn ${drawMode ? 'active' : ''}`} onClick={() => setDrawMode(!drawMode)} title="Turn off to scroll on phones">
                <Icon name={drawMode ? 'edit' : 'pan_tool'} /> {drawMode ? 'Hiding: on' : 'Hiding: off (scroll)'}
              </button>
              <button className="btn" onClick={undo} disabled={!history.current.length}><Icon name="undo" /> Undo</button>
              <button className="btn" onClick={() => commit(pages.map((p) => ({ ...p, masks: [] })))} disabled={!maskCount}>Clear hidden areas</button>
              <button className="btn" onClick={() => { commit([]); setInfo(''); }}>Remove ticket</button>
              <button className="btn primary" onClick={print} disabled={busy}><Icon name="print" /> Print</button>
            </>
          )}
        </div>

        {canBrand && pages.length > 0 && (
          <div className="brand-options">
            <label className="check"><input type="checkbox" checked={useHeader} onChange={(e) => setUseHeader(e.target.checked)} /> Add my agency header (logo, address, contact)</label>
            <label className="check"><input type="checkbox" checked={useFooter} onChange={(e) => setUseFooter(e.target.checked)} /> Add footer</label>
            {useFooter && (
              <input className="note-input" value={footerNote} onChange={(e) => setFooterNote(e.target.value)} maxLength={160}
                placeholder="Note for this ticket (optional), e.g. Customer: Ravi K · Ref 1023" />
            )}
            <Link to="/agent" className="link-btn">Edit branding</Link>
          </div>
        )}

        {busy && <p className="muted">Working…</p>}
        {error && <div className="error-box">{error}</div>}
        {info && <div className="notice">{info}</div>}
        {pages.length === 0 && (
          <label className="dropzone">
            <input type="file" accept="application/pdf,image/*" multiple onChange={(e) => onFiles(e.target.files)} />
            <span><Icon name="description" size={28} /><br />Tap to choose your e-ticket PDF or image</span>
          </label>
        )}

        <div className="sheets">
          {pages.map((p, i) => {
            const layout = brandLayout(p, agent, header, footer, footerNote);
            return (
            <div key={p.id} className="sheet-wrap">
              <div className="muted small-text">
                Page {i + 1} · {p.masks.length} hidden area{p.masks.length === 1 ? '' : 's'}
                {layout.scale < 1 && ` · ticket scaled to ${Math.round(layout.scale * 100)}% to fit the header/footer on the same page`}
              </div>
              {/* Same proportions as the printed page: header + shrunk ticket + footer = original page size. */}
              <div className="sheet-frame" style={{ aspectRatio: `${p.width} / ${p.height}` }}>
                {layout.headerH > 0 && agent && <PreviewHeader agent={agent} layout={layout} width={p.width} />}
                <div
                  className={`sheet ${drawMode ? 'drawing' : ''}`}
                  style={{ aspectRatio: `${p.width} / ${p.height}`, width: `${layout.scale * 100}%` }}
                  onPointerDown={(e) => onDown(p.id, e)}
                  onPointerMove={onMove}
                  onPointerUp={onUp}
                  onPointerCancel={() => setDraft(null)}
                >
                  <img src={p.src} alt={`Ticket page ${i + 1}`} draggable={false} />
                  {p.masks.map((m) => (
                    <div key={m.id} className={`mask ${m.color}`} style={{ left: `${m.x * 100}%`, top: `${m.y * 100}%`, width: `${m.w * 100}%`, height: `${m.h * 100}%` }}>
                      <button className="mask-remove" onClick={() => removeMask(p.id, m.id)} aria-label="Show this area again">×</button>
                    </div>
                  ))}
                  {draft?.pageId === p.id && (
                    <div
                      className={`mask draft ${color}`}
                      style={{
                        left: `${Math.min(draft.x0, draft.x1) * 100}%`,
                        top: `${Math.min(draft.y0, draft.y1) * 100}%`,
                        width: `${Math.abs(draft.x1 - draft.x0) * 100}%`,
                        height: `${Math.abs(draft.y1 - draft.y0) * 100}%`,
                      }}
                    />
                  )}
                </div>
                {layout.footerH > 0 && agent && <PreviewFooter agent={agent} layout={layout} width={p.width} />}
              </div>
            </div>
            );
          })}
        </div>
      </div>

      <div id="print-area" aria-hidden>
        {printImages.map((src, i) => <img key={i} src={src} alt="" />)}
      </div>
    </div>
  );
}
