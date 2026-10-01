import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  Adapter, AppState, InvoiceFacts, PayResult,
} from './types';
import { connect } from './api';
import { BASE_INVOICE, buildScenarioDocument } from '../engine/documents.mjs';
import { factsSourceAfterEdit, normalizeFacts, sha256Hex } from '../engine/engine.mjs';
import Header from './components/Header';
import InvoiceDetailsCard from './components/InvoiceDetailsCard';
import InvoiceDocumentCard from './components/InvoiceDocumentCard';
import VerdictCard, { type VerdictView } from './components/VerdictCard';
import LedgerCard from './components/LedgerCard';
import EvidenceModal from './components/EvidenceModal';

const TAB_ID = `Tab ${Math.random().toString(36).slice(2, 5).toUpperCase()}`;

interface CurrentDoc {
  filename: string;
  bytes: Uint8Array;
  readable: boolean;
  text: string;
  kind: 'sample' | 'upload';
}

export default function App() {
  const [adapter, setAdapter] = useState<Adapter | null>(null);
  const [state, setState] = useState<AppState | null>(null);
  const [facts, setFacts] = useState<InvoiceFacts>(() =>
    normalizeFacts({ ...BASE_INVOICE, filename: 'northline_inv1042.pdf', factsSource: 'generated' }));
  const [amountText, setAmountText] = useState('480.00');
  const [doc, setDoc] = useState<CurrentDoc | null>(null);
  const [scenario, setScenario] = useState<string>('renamed');
  const [verdict, setVerdict] = useState<VerdictView | null>(null);
  const [evidenceFacts, setEvidenceFacts] = useState<InvoiceFacts | null>(null);
  const [busy, setBusy] = useState(false);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [bannerOpen, setBannerOpen] = useState(true);
  const [uploadNote, setUploadNote] = useState('');
  const lastRequestId = useRef<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async (a?: Adapter | null) => {
    const ad = a ?? adapter;
    if (!ad) return;
    setState(await ad.getState());
  }, [adapter]);

  useEffect(() => {
    (async () => {
      const ad = await connect();
      setAdapter(ad);
      await refresh(ad);
      const canonical = buildScenarioDocument('renamed', facts);
      setDoc({ filename: canonical.filename, bytes: canonical.bytes, readable: true, text: '', kind: 'sample' });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const factsWithDoc = useCallback(async (): Promise<InvoiceFacts> => {
    const docHash = doc?.bytes?.length ? await sha256Hex(doc.bytes) : '';
    const f = normalizeFacts({ ...facts, docHash, filename: doc?.filename || '', docSupported: doc?.readable !== false });
    setEvidenceFacts(f);
    return f;
  }, [facts, doc]);

  const applyScenario = useCallback(async (id: string) => {
    setScenario(id);
    setVerdict(null);
    setUploadNote('');
    if (id === 'burst') {
      setDoc((d) => d); // keep current document; the burst fires on current facts
      return;
    }
    const built = buildScenarioDocument(id, facts);
    setDoc({ filename: built.filename, bytes: built.bytes, readable: built.facts.docSupported, text: '', kind: 'sample' });
    setFacts(built.facts);
    setAmountText(built.facts.amountCents != null ? (built.facts.amountCents / 100).toFixed(2) : '');
  }, [facts]);

  const doValidate = useCallback(async () => {
    if (!adapter || busy) return;
    setBusy(true);
    try {
      const f = await factsWithDoc();
      const { verdict: v } = await adapter.validate(f, TAB_ID);
      setVerdict({ kind: 'verdict', verdict: v });
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [adapter, busy, factsWithDoc, refresh]);

  const doBurst = useCallback(async () => {
    if (!adapter || busy) return;
    setBusy(true);
    try {
      const f = await factsWithDoc();
      const results = await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          adapter.pay(`burst-${crypto.randomUUID()}-${i}`, `${TAB_ID} · req ${i + 1}`, f))
      );
      const recorded = results.filter((r) => r.outcome === 'recorded');
      const blocked = results.filter((r) => r.outcome === 'duplicate');
      const other = results.length - recorded.length - blocked.length;
      setVerdict({
        kind: 'burst',
        total: results.length,
        recorded: recorded.length,
        blocked: blocked.length,
        other,
        paymentUid: recorded[0]?.paymentUid ?? null,
      });
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [adapter, busy, factsWithDoc, refresh]);

  const doPay = useCallback(async () => {
    if (!adapter || busy) return;
    setBusy(true);
    try {
      const f = await factsWithDoc();
      const requestId = `pay-${crypto.randomUUID()}`;
      lastRequestId.current = requestId;
      const result: PayResult = await adapter.pay(requestId, TAB_ID, f);
      setVerdict({ kind: 'pay', result, requestId });
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [adapter, busy, factsWithDoc, refresh]);

  const doReplay = useCallback(async () => {
    if (!adapter || busy || !lastRequestId.current) return;
    setBusy(true);
    try {
      const f = await factsWithDoc();
      const result = await adapter.pay(lastRequestId.current, TAB_ID, f);
      setVerdict({ kind: 'pay', result, requestId: lastRequestId.current });
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [adapter, busy, factsWithDoc, refresh]);

  const doReset = useCallback(async () => {
    if (!adapter || busy) return;
    setBusy(true);
    try {
      const next = await adapter.reset();
      setState(next);
      setFacts(normalizeFacts({ ...BASE_INVOICE, filename: 'northline_inv1042.pdf', factsSource: 'generated' }));
      setAmountText('480.00');
      const canonical = buildScenarioDocument('renamed', { ...BASE_INVOICE });
      setDoc({ filename: canonical.filename, bytes: canonical.bytes, readable: true, text: '', kind: 'sample' });
      setScenario('renamed');
      setVerdict(null);
      lastRequestId.current = null;
      setUploadNote('');
    } finally {
      setBusy(false);
    }
  }, [adapter, busy]);

  const doUpload = useCallback(async (file: File) => {
    if (!adapter) return;
    setBusy(true);
    setUploadNote('');
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const res = await adapter.ingestDocument(file.name, bytes);
      setDoc({
        filename: res.filename,
        bytes,
        readable: res.supported,
        text: res.textPreview,
        kind: 'upload',
      });
      if (res.supported && res.fields) {
        // Fields the document did not state stay empty — never keep a
        // previous/sample value for a required fact.
        const f = res.fields;
        const merged = normalizeFacts({
          supplier: f.supplier ?? '',
          invoiceNumber: f.invoiceNumber ?? '',
          currency: f.currency ?? '',
          amountCents: f.amountCents ?? null,
          period: f.period ?? '',
          items: f.items ?? [],
          filename: res.filename,
          factsSource: 'extracted',
          docSupported: true,
        });
        setFacts(merged);
        setAmountText(merged.amountCents != null ? (merged.amountCents / 100).toFixed(2) : '');
        const missing = [
          !merged.supplier && 'supplier',
          !merged.invoiceNumber && 'invoice number',
          !merged.currency && 'currency',
          merged.amountCents == null && 'amount',
        ].filter(Boolean).join(', ');
        setUploadNote(missing
          ? `Extracted ${res.found.length} field(s) from ${res.filename} — it does not state ${missing}. Fill those in to validate; no prior values were kept.`
          : `Extracted ${res.found.length} field(s) from ${res.filename} — confirm or edit before validating.`);
      } else {
        setFacts(normalizeFacts({
          supplier: '', invoiceNumber: '', currency: '', amountCents: null,
          period: '', items: [], filename: res.filename,
          factsSource: 'manual', docSupported: false,
        }));
        setAmountText('');
        setUploadNote('No readable text found. Nothing was guessed — enter the invoice facts manually to validate.');
      }
      setScenario('upload');
      setVerdict(null);
    } finally {
      setBusy(false);
    }
  }, [adapter, facts]);

  const stats = state?.stats;
  // A required fact missing means the current document didn't state it and
  // nothing was kept from before — the user must complete it before validating.
  const factsComplete = !!(facts.supplier && facts.invoiceNumber && facts.amountCents != null && facts.currency);

  return (
    <div className="page">
      <Header
        onReset={doReset}
        busy={busy}
        modeLabel={adapter?.modeLabel ?? 'Connecting…'}
      />
      <main>
        <h1 className="headline">Pay once, even when a request arrives twice.</h1>
        <p className="subhead">Test how we detect duplicate invoices and prevent repeated payments.</p>

        {bannerOpen && (
          <div className="intro-banner" role="note">
            <p>
              <strong>The challenge:</strong> this sample $480 invoice from Northline Studio has already
              been paid. Pick an attack and try to make the sandbox pay it again — sample data only.
            </p>
            <button className="banner-dismiss" onClick={() => setBannerOpen(false)} aria-label="Dismiss">×</button>
          </div>
        )}

        <section className="grid3" aria-label="Invoice validation workspace">
          <InvoiceDetailsCard
            facts={facts}
            amountText={amountText}
            scenario={scenario}
            busy={busy}
            uploadNote={uploadNote}
            canValidate={factsComplete}
            canReplay={!!lastRequestId.current}
            onFactsChange={(patch) =>
              setFacts((f) => ({ ...f, ...patch, factsSource: factsSourceAfterEdit(f.factsSource) }))
            }
            onAmountChange={(text, cents) => {
              setAmountText(text);
              setFacts((f) => ({ ...f, amountCents: cents, factsSource: factsSourceAfterEdit(f.factsSource) }));
            }}
            onScenario={applyScenario}
            onValidate={scenario === 'burst' ? doBurst : doValidate}
            onPay={doPay}
            onReplay={doReplay}
            onUploadClick={() => fileInput.current?.click()}
          />
          <input
            ref={fileInput}
            type="file"
            accept=".pdf,.txt,.png,.jpg,.jpeg"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void doUpload(f);
              e.target.value = '';
            }}
          />
          <InvoiceDocumentCard doc={doc} facts={facts} />
          <VerdictCard
            view={verdict}
            busy={busy}
            onInspect={() => setEvidenceOpen(true)}
          />
        </section>

        <LedgerCard state={state} stats={stats} />
      </main>
      <footer className="footer">
        <span><strong>Pay Me Twice</strong>&ensp;|&ensp;Built for safer accounting. Powered by validation, not hope.</span>
        <span className="footer-mode">
          {adapter?.modeLabel ?? ''} · {adapter?.limitation ?? ''} Sandbox dollars. No real payments.
        </span>
      </footer>
      {evidenceOpen && verdict && (
        <EvidenceModal
          view={verdict}
          facts={evidenceFacts ?? facts}
          doc={doc}
          payments={state?.payments ?? []}
          onClose={() => setEvidenceOpen(false)}
        />
      )}
    </div>
  );
}
