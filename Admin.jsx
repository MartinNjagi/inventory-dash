import { useCallback, useEffect, useState } from 'react';
import { api, deleteImage, imageUrl, uploadImage } from './appwrite';

export default function Admin({ me }) {
  const [sub, setSub] = useState('items');
  return (
    <>
      <div className="subtabs">
        <button className={sub === 'items' ? 'tab on' : 'tab'} onClick={() => setSub('items')}>Items</button>
        <button className={sub === 'users' ? 'tab on' : 'tab'} onClick={() => setSub('users')}>People</button>
      </div>
      {sub === 'items' ? <ItemsAdmin /> : <UsersAdmin me={me} />}
    </>
  );
}

// ---------------- Items ----------------

function ItemsAdmin() {
  const [items, setItems] = useState(null);
  const [form, setForm] = useState(null); // null | 'new' | item
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    try { setItems((await api('GET', '/api/admin/items')).items); }
    catch (e) { setMsg(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function adjust(it) {
    const raw = window.prompt(`Adjust stock for ${it.name}.\nEnter a change, e.g. 50 to restock or -5 to write off:`);
    if (raw === null) return;
    const delta = parseInt(raw, 10);
    if (!delta) return setMsg('Enter a non-zero whole number.');
    const reason = window.prompt('Reason (required, kept in the audit log):');
    if (!reason || !reason.trim()) return setMsg('A reason is required.');
    try { await api('POST', `/api/admin/items/${it.id}/stock`, { delta, reason: reason.trim() }); setMsg(''); }
    catch (e) { setMsg(e.message); }
    load();
  }

  if (form) return <ItemForm item={form === 'new' ? null : form} onDone={() => { setForm(null); load(); }} />;
  if (!items) return <p className="muted pad">{msg || 'Loading…'}</p>;
  return (
    <>
      <div className="row"><h2>Items</h2><button className="btn primary" onClick={() => setForm('new')}>+ Add item</button></div>
      {msg && <p className="notice">{msg}</p>}
      <div className="list">
        {items.map((it) => (
          <div key={it.id} className={it.active ? 'li' : 'li off'}>
            {imageUrl(it.image_file_id, 120) ? <img src={imageUrl(it.image_file_id, 120)} alt="" /> : <div className="thumb" />}
            <div className="grow">
              <strong>{it.name}</strong> {!it.active && <span className="tag">Inactive</span>}
              <div className="muted">{it.sku} · on hand {it.quantity_on_hand} · reserved {it.quantity_reserved} · alert at ≤ {it.min_threshold}</div>
            </div>
            <button className="btn" onClick={() => adjust(it)}>Adjust stock</button>
            <button className="btn" onClick={() => setForm(it)}>Edit</button>
          </div>
        ))}
        {items.length === 0 && <p className="muted pad">No items yet.</p>}
      </div>
    </>
  );
}

function ItemForm({ item, onDone }) {
  const isNew = !item;
  const [f, setF] = useState({
    sku: item?.sku || '', name: item?.name || '', unit: item?.unit || 'pcs',
    quantity_on_hand: 0, min_threshold: item?.min_threshold ?? 0, active: item?.active ?? true,
  });
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const preview = file ? URL.createObjectURL(file) : imageUrl(item?.image_file_id, 240);

  async function save(e) {
    e.preventDefault();
    setBusy(true); setErr('');
    let newFileId = null;
    try {
      if (file) newFileId = await uploadImage(file);
      const image_file_id = newFileId || item?.image_file_id || '';
      const num = (v) => Math.max(0, parseInt(v, 10) || 0);
      if (isNew) {
        await api('POST', '/api/admin/items', {
          sku: f.sku, name: f.name, unit: f.unit, image_file_id,
          quantity_on_hand: num(f.quantity_on_hand), min_threshold: num(f.min_threshold),
        });
      } else {
        await api('PUT', `/api/admin/items/${item.id}`, {
          name: f.name, unit: f.unit, image_file_id, min_threshold: num(f.min_threshold), active: f.active,
        });
        if (newFileId && item.image_file_id) deleteImage(item.image_file_id); // free the old image's storage
      }
      onDone();
    } catch (e2) {
      if (newFileId) deleteImage(newFileId); // don't leave an orphaned upload behind
      setErr(e2.message);
      setBusy(false);
    }
  }

  return (
    <form className="form" onSubmit={save}>
      <h2>{isNew ? 'Add item' : `Edit ${item.name}`}</h2>
      {preview && <img className="preview" src={preview} alt="" />}
      <label>Photo<input type="file" accept="image/*" onChange={(e) => setFile(e.target.files[0] || null)} /></label>
      <label>SKU<input value={f.sku} onChange={set('sku')} required maxLength={40} disabled={!isNew} /></label>
      <label>Name<input value={f.name} onChange={set('name')} required maxLength={120} /></label>
      <label>Unit<input value={f.unit} onChange={set('unit')} required maxLength={20} /></label>
      {isNew && <label>Opening stock<input type="number" min="0" value={f.quantity_on_hand} onChange={set('quantity_on_hand')} /></label>}
      <label>Low-stock threshold<input type="number" min="0" value={f.min_threshold} onChange={set('min_threshold')} /></label>
      {!isNew && <label className="check"><input type="checkbox" checked={f.active} onChange={set('active')} /> Active (visible to Makers)</label>}
      {err && <p className="err">{err}</p>}
      <div className="row">
        <button type="button" className="btn" onClick={onDone} disabled={busy}>Cancel</button>
        <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </form>
  );
}

// ---------------- People ----------------

function UsersAdmin({ me }) {
  const [users, setUsers] = useState(null);
  const [msg, setMsg] = useState('');
  const [nu, setNu] = useState({ email: '', name: '', role: 'MAKER' });

  const load = useCallback(async () => {
    try { setUsers((await api('GET', '/api/admin/users')).users); }
    catch (e) { setMsg(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function add(e) {
    e.preventDefault(); setMsg('');
    try { await api('POST', '/api/admin/users', nu); setNu({ email: '', name: '', role: 'MAKER' }); }
    catch (e2) { setMsg(e2.message); }
    load();
  }
  async function patch(u, changes) {
    setMsg('');
    try { await api('PUT', `/api/admin/users/${u.id}`, { name: u.name, role: u.role, active: u.active, ...changes }); }
    catch (e) { setMsg(e.message); }
    load();
  }

  return (
    <>
      <h2>People</h2>
      <p className="muted">Only people listed here can use the system. They sign in with the Google account matching the email.</p>
      <form className="inline" onSubmit={add}>
        <input type="email" placeholder="Google email" required value={nu.email} onChange={(e) => setNu({ ...nu, email: e.target.value })} />
        <input placeholder="Full name" required value={nu.name} onChange={(e) => setNu({ ...nu, name: e.target.value })} />
        <select value={nu.role} onChange={(e) => setNu({ ...nu, role: e.target.value })}>
          <option value="MAKER">Maker</option><option value="CHECKER">Checker</option><option value="ADMIN">Admin</option>
        </select>
        <button className="btn primary">Add</button>
      </form>
      {msg && <p className="notice">{msg}</p>}
      {!users ? <p className="muted pad">Loading…</p> : (
        <div className="list">
          {users.map((u) => {
            const self = u.id === me.id;
            return (
              <div key={u.id} className={u.active ? 'li' : 'li off'}>
                <div className="grow">
                  <strong>{u.name}</strong> {self && <span className="tag">You</span>} {!u.signed_in && <span className="tag">Not signed in yet</span>}
                  <div className="muted">{u.email}</div>
                </div>
                <select value={u.role} disabled={self} onChange={(e) => patch(u, { role: e.target.value })}>
                  <option value="MAKER">Maker</option><option value="CHECKER">Checker</option><option value="ADMIN">Admin</option>
                </select>
                <button className="btn" disabled={self} onClick={() => patch(u, { active: !u.active })}>
                  {u.active ? 'Deactivate' : 'Reactivate'}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
