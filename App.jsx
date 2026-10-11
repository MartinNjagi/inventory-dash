import { useCallback, useEffect, useRef, useState } from 'react';
import Admin from './Admin.jsx';
import { account, api, completeLogin, imageUrl, loginWithGoogle, logout } from './appwrite';

export default function App() {
  const [phase, setPhase] = useState('loading'); // loading | login | pending | ready
  const [me, setMe] = useState(null);
  const [loginError, setLoginError] = useState(false);

  useEffect(() => {
    (async () => {
      const p = new URLSearchParams(window.location.search);
      if (p.get('login') === 'failed') setLoginError(true);
      try {
        if (p.get('userId') && p.get('secret')) await completeLogin(p.get('userId'), p.get('secret'));
        if (p.toString()) window.history.replaceState({}, '', window.location.pathname);
        await account.get();
      } catch {
        return setPhase('login');
      }
      try {
        setMe(await api('GET', '/api/me'));
        setPhase('ready');
      } catch (e) {
        setPhase(e.status === 403 ? 'pending' : 'login');
      }
    })();
  }, []);

  if (phase === 'loading') return <Center>Loading…</Center>;
  if (phase === 'login')
    return (
      <Center>
        <h1>Stock Room</h1>
        <p className="muted">Sign in with your company Google account.</p>
        {loginError && <p className="err">Sign-in failed. Use your company account.</p>}
        <button className="btn primary" onClick={loginWithGoogle}>Sign in with Google</button>
      </Center>
    );
  if (phase === 'pending')
    return (
      <Center>
        <h1>Pending admin approval</h1>
        <p className="muted">You're signed in, but an administrator hasn't enabled your account yet.</p>
        <button className="btn" onClick={async () => { await logout(); location.reload(); }}>Sign out</button>
      </Center>
    );
  return <Shell me={me} />;
}

const Center = ({ children }) => <div className="center">{children}</div>;

function Shell({ me }) {
  const canRequest = me.role === 'MAKER' || me.role === 'ADMIN';
  const canApprove = me.role === 'CHECKER' || me.role === 'ADMIN';
  const [tab, setTab] = useState('inventory');
  return (
    <>
      <header className="bar">
        <strong>Stock Room</strong>
        <nav>
          <button className={tab === 'inventory' ? 'tab on' : 'tab'} onClick={() => setTab('inventory')}>Inventory</button>
          {me.role === 'ADMIN' && (
            <button className={tab === 'admin' ? 'tab on' : 'tab'} onClick={() => setTab('admin')}>Admin</button>
          )}
          {canApprove && (
            <button className={tab === 'approvals' ? 'tab on' : 'tab'} onClick={() => setTab('approvals')}>Approvals</button>
          )}
        </nav>
        <span className="muted">{me.name} · {me.role}</span>
        <button className="btn" onClick={async () => { await logout(); location.reload(); }}>Sign out</button>
      </header>
      <main>
        {tab === 'inventory' && <Inventory canRequest={canRequest} />}
        {tab === 'approvals' && <Approvals me={me} />}
        {tab === 'admin' && <Admin me={me} />}
      </main>
    </>
  );
}

function Inventory({ canRequest }) {
  const [items, setItems] = useState(null);
  const [cart, setCart] = useState({}); // item_id -> qty
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const idemKey = useRef(crypto.randomUUID()); // reused on retry so a double-tap can't reserve twice

  const load = useCallback(async () => {
    try { setItems((await api('GET', '/api/inventory')).items); }
    catch (e) { setMsg(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const byId = Object.fromEntries((items || []).map((i) => [i.id, i]));
  const count = Object.values(cart).reduce((a, b) => a + b, 0);
  const setQty = (id, q) =>
    setCart((c) => {
      const max = byId[id]?.available ?? 0;
      const n = Math.max(0, Math.min(q, max));
      const next = { ...c };
      if (n === 0) delete next[id]; else next[id] = n;
      return next;
    });

  async function submit() {
    setBusy(true); setMsg('');
    try {
      const lines = Object.entries(cart).map(([id, quantity]) => ({ item_id: Number(id), quantity }));
      await api('POST', '/api/checkout', { idempotency_key: idemKey.current, note, lines });
      setCart({}); setNote(''); setOpen(false); idemKey.current = crypto.randomUUID();
      setMsg('Request submitted for approval.');
    } catch (e) {
      setMsg(e.status === 409 && e.data?.item_id
        ? `Not enough stock for ${byId[e.data.item_id]?.name || 'an item'} (only ${e.data.available} left). Adjust your cart.`
        : e.message);
    } finally { setBusy(false); load(); }
  }

  if (!items) return <p className="muted pad">{msg || 'Loading inventory…'}</p>;
  return (
    <>
      {msg && <p className="notice">{msg}</p>}
      <div className="grid">
        {items.map((it) => (
          <article key={it.id} className={it.low_stock ? 'card low' : 'card'}>
            {imageUrl(it.image_file_id)
              ? <img src={imageUrl(it.image_file_id)} alt={it.name} loading="lazy" />
              : <div className="noimg">No image</div>}
            {it.low_stock && <span className="badge">Low stock</span>}
            <h3>{it.name}</h3>
            <p className="muted">{it.sku} · {it.available} {it.unit} available</p>
            {canRequest && (
              <div className="stepper">
                <button className="btn" onClick={() => setQty(it.id, (cart[it.id] || 0) - 1)} disabled={!cart[it.id]}>−</button>
                <span>{cart[it.id] || 0}</span>
                <button className="btn" onClick={() => setQty(it.id, (cart[it.id] || 0) + 1)} disabled={it.available <= (cart[it.id] || 0)}>+</button>
              </div>
            )}
          </article>
        ))}
      </div>

      {canRequest && count > 0 && !open && (
        <button className="fab btn primary" onClick={() => setOpen(true)}>Cart · {count}</button>
      )}
      {open && (
        <aside className="drawer">
          <h2>Your request</h2>
          {Object.entries(cart).map(([id, q]) => (
            <div key={id} className="row"><span>{byId[id]?.name}</span><strong>× {q}</strong></div>
          ))}
          <textarea placeholder="Note (optional)" maxLength={255} value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="row">
            <button className="btn" onClick={() => setOpen(false)}>Back</button>
            <button className="btn primary" disabled={busy || count === 0} onClick={submit}>
              {busy ? 'Submitting…' : 'Submit for approval'}
            </button>
          </div>
        </aside>
      )}
    </>
  );
}

function Approvals({ me }) {
  const [reqs, setReqs] = useState(null);
  const [msg, setMsg] = useState('');
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    try { setReqs((await api('GET', '/api/requests')).requests); }
    catch (e) { setMsg(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function resolve(id, action) {
    const reason = action === 'REJECT' ? window.prompt('Reason for rejection (optional)') : '';
    if (reason === null) return;
    setBusyId(id); setMsg('');
    try { await api('POST', '/api/resolve', { disbursement_id: id, action, reason }); }
    catch (e) { setMsg(e.message); }
    finally { setBusyId(null); load(); }
  }

  if (!reqs) return <p className="muted pad">{msg || 'Loading queue…'}</p>;
  return (
    <>
      {msg && <p className="notice">{msg}</p>}
      {reqs.length === 0 && <p className="muted pad">No pending requests.</p>}
      <div className="queue">
        {reqs.map((r) => (
          <article key={r.id} className="card">
            <h3>Request #{r.id} · {r.requester}</h3>
            <p className="muted">{new Date(r.created_at).toLocaleString()}{r.note ? ` · “${r.note}”` : ''}</p>
            {r.lines.map((l) => (
              <div key={l.item_id} className="row"><span>{l.name}</span><strong>× {l.quantity}</strong></div>
            ))}
            {me.role === 'CHECKER' ? (
              <div className="row">
                <button className="btn" disabled={busyId === r.id} onClick={() => resolve(r.id, 'REJECT')}>Reject</button>
                <button className="btn primary" disabled={busyId === r.id} onClick={() => resolve(r.id, 'APPROVE')}>Approve</button>
              </div>
            ) : <p className="muted">Only Checkers can approve or reject.</p>}
          </article>
        ))}
      </div>
    </>
  );
}
