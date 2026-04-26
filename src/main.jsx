import { useState, useEffect, useRef, useCallback } from "react";

const APP_KEY = "cinema-vault-v4";
const GIST_FILENAME = "cinema-vault-data.json";
const generateId = () => Math.random().toString(36).slice(2, 10);

// ─── GitHub Gist API ──────────────────────────────────────────────────────────
const gistApi = {
  headers: (token) => ({
    "Authorization": `Bearer ${token}`,
    "Accept": "application/vnd.github+json",
    "Content-Type": "application/json",
  }),
  async find(token) {
    let page = 1;
    while (true) {
      const res = await fetch(`https://api.github.com/gists?per_page=100&page=${page}`, { headers: gistApi.headers(token) });
      if (!res.ok) throw new Error("Token 无效或无权限");
      const gists = await res.json();
      if (gists.length === 0) return null;
      const found = gists.find(g => g.files?.[GIST_FILENAME]);
      if (found) return found.id;
      if (gists.length < 100) return null;
      page++;
    }
  },
  async create(token, data) {
    const res = await fetch("https://api.github.com/gists", {
      method: "POST", headers: gistApi.headers(token),
      body: JSON.stringify({ description: "Cinema Vault 片单数据", public: false, files: { [GIST_FILENAME]: { content: JSON.stringify(data, null, 2) } } }),
    });
    if (!res.ok) throw new Error("创建 Gist 失败");
    return (await res.json()).id;
  },
  async read(token, gistId) {
    const res = await fetch(`https://api.github.com/gists/${gistId}`, { headers: gistApi.headers(token) });
    if (!res.ok) throw new Error("读取失败");
    const raw = (await res.json()).files?.[GIST_FILENAME]?.content;
    return raw ? JSON.parse(raw) : null;
  },
  async write(token, gistId, data) {
    const res = await fetch(`https://api.github.com/gists/${gistId}`, {
      method: "PATCH", headers: gistApi.headers(token),
      body: JSON.stringify({ files: { [GIST_FILENAME]: { content: JSON.stringify(data, null, 2) } } }),
    });
    if (!res.ok) throw new Error("写入失败");
  },
};

// ─── Local storage ────────────────────────────────────────────────────────────
const ls = {
  get: (k, fb = null) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; } catch { return fb; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del: (k) => { try { localStorage.removeItem(k); } catch {} },
};

// ─── Claude API ───────────────────────────────────────────────────────────────
async function parseMovie(input) {
  const isUrl = /douban\.com\/subject\/\d+/i.test(input);
  const prompt = `用户输入了${isUrl ? "豆瓣电影链接" : "电影名称"}："${input}"
识别该电影，只返回JSON，不要其他任何文字：
{
  "title": "中文片名",
  "originalTitle": "原文片名（与中文相同则填null）",
  "year": "年份",
  "genre": "剧情/喜剧/动作/爱情/科幻/动画/悬疑/惊悚/恐怖/纪录片/其他 选一",
  "rating": "豆瓣评分如8.9，不确定填null",
  "director": "导演",
  "description": "一句话简介不超过25字"
}
无法识别则返回 {"error":"unknown"}`;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 600, tools: [{ type: "web_search_20250305", name: "web_search" }], messages: [{ role: "user", content: prompt }] }),
  });
  const data = await res.json();
  const text = (data.content || []).map(b => b.type === "text" ? b.text : "").join("").trim();
  return JSON.parse(text.replace(/```json|```/g, "").trim());
}

// ─── Components ───────────────────────────────────────────────────────────────
const GENRE_EMOJI = { 科幻:"🚀",动作:"💥",爱情:"💕",喜剧:"😂",悬疑:"🔍",动画:"🎨",惊悚:"😱",恐怖:"👻",纪录片:"📽️",剧情:"🎭",其他:"🎬" };

const css = `
  @import url('https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@300;400;600&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
  body { background: #09090f; }
  ::-webkit-scrollbar { width: 4px; }
  ::-webkit-scrollbar-thumb { background: #1f1f2e; border-radius: 2px; }
  .fi { animation: fi .28s ease both; }
  @keyframes fi { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:none; } }
  @keyframes pulse { 0%,100%{opacity:1;} 50%{opacity:.3;} }
  input, button { -webkit-appearance: none; font-family: inherit; }
  input:focus { outline: none; }
`;

function Btn({ children, onClick, variant = "ghost", disabled, full, style: sx }) {
  const v = {
    primary: { background: "#c8a96e", color: "#09090f", fontWeight: 700, border: "none" },
    ghost:   { background: "transparent", color: "#666", border: "1px solid #1f1f2e" },
    gold:    { background: "linear-gradient(135deg,#c8a96e,#dfc080)", color: "#09090f", fontWeight: 700, border: "none", boxShadow: "0 4px 18px rgba(200,169,110,.2)" },
    danger:  { background: "transparent", color: "#555", border: "1px solid #1f1f2e" },
  }[variant] || {};
  return (
    <button disabled={disabled} onClick={onClick} style={{ cursor: disabled ? "not-allowed" : "pointer", borderRadius: 10, fontSize: 14, fontWeight: 500, padding: "10px 20px", transition: "opacity .18s", opacity: disabled ? .4 : 1, width: full ? "100%" : undefined, ...v, ...sx }}>
      {children}
    </button>
  );
}

function TInput({ value, onChange, onKeyDown, placeholder, autoFocus, type = "text" }) {
  return (
    <input type={type} value={value} onChange={onChange} onKeyDown={onKeyDown} placeholder={placeholder} autoFocus={autoFocus}
      style={{ width: "100%", background: "#0d0d16", border: "1px solid #1f1f2e", borderRadius: 10, padding: "13px 14px", fontSize: 15, color: "#e8e0d0", transition: "border-color .2s" }}
      onFocus={e => e.target.style.borderColor = "#3a3a5a"}
      onBlur={e => e.target.style.borderColor = "#1f1f2e"}
    />
  );
}

function SyncBadge({ status, onSync }) {
  const cfg = { idle: ["#555","已同步"], syncing: ["#c8a96e","同步中…"], error: ["#e57373","同步失败"], }[status] || ["#555","已同步"];
  return (
    <button onClick={onSync} style={{ cursor: "pointer", background: "transparent", border: "none", display: "flex", alignItems: "center", gap: 5, padding: "4px 8px", borderRadius: 8 }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: cfg[0], display: "inline-block", animation: status === "syncing" ? "pulse 1s ease infinite" : "none" }} />
      <span style={{ fontSize: 11, color: cfg[0] }}>{cfg[1]}</span>
    </button>
  );
}

// ─── Setup screen ─────────────────────────────────────────────────────────────
function SetupScreen({ onConnect }) {
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleConnect = async () => {
    const t = token.trim();
    if (!t) return;
    setLoading(true); setError("");
    try {
      const res = await fetch("https://api.github.com/user", { headers: { "Authorization": `Bearer ${t}`, "Accept": "application/vnd.github+json" } });
      if (!res.ok) throw new Error("Token 无效，请检查是否复制完整");
      const user = await res.json();
      onConnect(t, user.login);
    } catch (e) { setError(e.message); }
    setLoading(false);
  };

  return (
    <div style={{ maxWidth: 440, margin: "0 auto", padding: "64px 24px 40px" }}>
      <div style={{ textAlign: "center", marginBottom: 48 }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🎬</div>
        <div style={{ fontSize: 26, fontWeight: 600, color: "#ede5d4", marginBottom: 8 }}>Cinema Vault</div>
        <div style={{ fontSize: 14, color: "#444", lineHeight: 1.8 }}>连接 GitHub，在所有设备上同步你的片单</div>
      </div>

      <div style={{ background: "#0f0f1a", border: "1px solid #1a1a2a", borderRadius: 16, padding: "28px 24px" }}>
        <div style={{ fontSize: 13, color: "#555", marginBottom: 16, lineHeight: 1.9 }}>
          需要 GitHub Personal Access Token<br />
          权限只需勾选 <code style={{ background: "#1a1a2a", padding: "1px 7px", borderRadius: 4, color: "#c8a96e", fontSize: 12 }}>gist</code>
        </div>

        <div style={{ marginBottom: 14 }}>
          <TInput value={token} onChange={e => setToken(e.target.value)} onKeyDown={e => e.key === "Enter" && handleConnect()} placeholder="ghp_xxxxxxxxxxxxxxxxxxxx" type="password" />
        </div>

        {error && <div style={{ color: "#e57373", fontSize: 13, marginBottom: 12 }}>{error}</div>}

        <Btn variant="gold" full disabled={!token.trim() || loading} onClick={handleConnect} style={{ padding: "13px" }}>
          {loading ? "连接中…" : "连接 GitHub"}
        </Btn>

        <div style={{ marginTop: 20, padding: "14px 16px", background: "#0a0a14", borderRadius: 10, border: "1px solid #141420" }}>
          <div style={{ fontSize: 12, color: "#444", lineHeight: 2 }}>
            <div style={{ color: "#555", fontWeight: 500, marginBottom: 4 }}>如何获取 Token</div>
            <div>1. 打开 <a href="https://github.com/settings/tokens/new" target="_blank" rel="noreferrer" style={{ color: "#c8a96e" }}>GitHub Token 页面</a></div>
            <div>2. Expiration 选「No expiration」</div>
            <div>3. 只勾 <code style={{ background: "#1a1a2a", padding: "0 5px", borderRadius: 3, color: "#aaa" }}>gist</code> 权限</div>
            <div>4. Generate → 复制粘贴到上方</div>
            <div style={{ marginTop: 8, color: "#333" }}>Token 只存在你设备本地，不经过任何服务器。</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Home screen ──────────────────────────────────────────────────────────────
function HomeScreen({ data, onOpenList, onNewList, onUnarchiveList }) {
  const active   = data.lists.filter(l => !l.archived);
  const archived = data.lists.filter(l => l.archived);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 28 }}>
        <div style={{ fontSize: 20, fontWeight: 600, color: "#ede5d4" }}>我的片单</div>
        <Btn variant="primary" onClick={onNewList} style={{ padding: "8px 18px", fontSize: 13 }}>＋ 新建</Btn>
      </div>

      {active.length === 0 && (
        <div style={{ textAlign: "center", color: "#2a2a3a", padding: "80px 0", fontSize: 14 }}>还没有片单，点「新建」开始吧</div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12, marginBottom: 40 }}>
        {active.map((list, i) => {
          const done = list.movies.filter(m => m.watched).length;
          const total = list.movies.length;
          const pct = total === 0 ? 0 : Math.round(done / total * 100);
          return (
            <div key={list.id} onClick={() => onOpenList(list.id)} className="fi"
              style={{ background: "#0f0f1a", border: "1px solid #1a1a2a", borderRadius: 16, padding: "20px 18px", cursor: "pointer", animationDelay: `${i*40}ms`, transition: "border-color .2s, transform .2s", userSelect: "none" }}
              onMouseEnter={e => { e.currentTarget.style.borderColor="#c8a96e55"; e.currentTarget.style.transform="translateY(-3px)"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor="#1a1a2a"; e.currentTarget.style.transform=""; }}>
              <div style={{ fontSize: 28, marginBottom: 10 }}>{list.cover || "🎬"}</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: "#ede5d4", marginBottom: 4 }}>{list.name}</div>
              {list.desc && <div style={{ fontSize: 12, color: "#3a3a4a", marginBottom: 12, lineHeight: 1.6 }}>{list.desc}</div>}
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <div style={{ flex: 1, height: 3, background: "#1a1a2a", borderRadius: 2 }}>
                  <div style={{ width: `${pct}%`, height: "100%", background: pct===100 ? "#81c784" : "#c8a96e", borderRadius: 2, transition: "width .4s" }} />
                </div>
                <span style={{ fontSize: 11, color: "#444" }}>{done}/{total}</span>
              </div>
              <div style={{ fontSize: 11, color: "#444" }}>
                {total - done > 0 ? `${total-done} 部待看` : <span style={{ color: "#81c784" }}>全部看完 ✓</span>}
              </div>
            </div>
          );
        })}
      </div>

      {archived.length > 0 && (
        <>
          <div style={{ fontSize: 11, color: "#2a2a3a", letterSpacing: "0.18em", marginBottom: 12 }}>── 已归档 ──</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {archived.map(list => (
              <div key={list.id} style={{ background: "#0a0a12", border: "1px solid #141420", borderRadius: 12, padding: "14px 16px", display: "flex", alignItems: "center", gap: 12, opacity: .6 }}>
                <span style={{ fontSize: 20 }}>{list.cover || "🎬"}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, color: "#555" }}>{list.name}</div>
                  <div style={{ fontSize: 11, color: "#333" }}>{list.movies.length} 部 · 已看完</div>
                </div>
                <Btn variant="ghost" onClick={() => onOpenList(list.id)} style={{ padding: "5px 12px", fontSize: 12 }}>查看</Btn>
                <Btn variant="ghost" onClick={e => { e.stopPropagation(); onUnarchiveList(list.id); }} style={{ padding: "5px 12px", fontSize: 12 }}>恢复</Btn>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─── New list ─────────────────────────────────────────────────────────────────
function NewListScreen({ onSave, onCancel }) {
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [cover, setCover] = useState("🎬");
  const emojis = ["🎬","🎭","🚀","💕","😂","🔍","🎨","👻","📽️","⚔️","🌊","🏆","🌙","🔥","❄️","🎪","🧩","🎯","🌸","🦋"];
  return (
    <div className="fi">
      <div style={{ fontSize: 18, fontWeight: 600, color: "#ede5d4", marginBottom: 24 }}>新建片单</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 20 }}>
        {emojis.map(e => (
          <button key={e} onClick={() => setCover(e)} style={{ width: 42, height: 42, fontSize: 20, cursor: "pointer", borderRadius: 10, background: cover===e ? "#1f1f2e" : "transparent", border: `1px solid ${cover===e ? "#c8a96e55" : "#1a1a2a"}`, transition: "all .15s" }}>{e}</button>
        ))}
      </div>
      <div style={{ marginBottom: 12 }}><TInput value={name} onChange={e => setName(e.target.value)} placeholder="片单名称，如「诺兰全集」" autoFocus /></div>
      <div style={{ marginBottom: 28 }}><TInput value={desc} onChange={e => setDesc(e.target.value)} placeholder="简介（选填）" /></div>
      <div style={{ display: "flex", gap: 10 }}>
        <Btn variant="ghost" onClick={onCancel}>取消</Btn>
        <Btn variant="primary" disabled={!name.trim()} onClick={() => onSave({ name: name.trim(), desc, cover })}>创建片单</Btn>
      </div>
    </div>
  );
}

// ─── List screen ──────────────────────────────────────────────────────────────
function ListScreen({ list, onBack, onUpdateList, onArchiveList, onDeleteList }) {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [errMsg, setErrMsg] = useState("");
  const [okMsg, setOkMsg]   = useState("");
  const [picked, setPicked]  = useState(null);
  const [spinning, setSpinning] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [confirmDelete,  setConfirmDelete]  = useState(false);
  const [editName, setEditName] = useState(false);
  const [nameVal, setNameVal]   = useState(list.name);
  const spinRef = useRef(null);

  const showErr = m => { setErrMsg(m); setTimeout(() => setErrMsg(""), 4000); };
  const showOk  = m => { setOkMsg(m);  setTimeout(() => setOkMsg(""),  3000); };

  const handleAdd = async () => {
    const val = input.trim();
    if (!val || loading) return;
    setLoading(true); setErrMsg("");
    try {
      const info = await parseMovie(val);
      if (info.error) showErr("无法识别，请检查输入");
      else {
        const movie = { ...info, id: generateId(), watched: false, addedAt: Date.now() };
        onUpdateList({ ...list, movies: [movie, ...list.movies] });
        setInput(""); showOk(`「${info.title}」已加入 ✓`);
      }
    } catch { showErr("解析失败，请重试"); }
    setLoading(false);
  };

  const handlePick = () => {
    const pool = list.movies.filter(m => !m.watched);
    if (!pool.length) { showErr("全部看完了！"); return; }
    clearInterval(spinRef.current);
    setSpinning(true); setPicked(pool[0]);
    let n = 0;
    spinRef.current = setInterval(() => {
      setPicked(pool[Math.floor(Math.random() * pool.length)]);
      if (++n >= 22) { clearInterval(spinRef.current); setPicked(pool[Math.floor(Math.random() * pool.length)]); setSpinning(false); }
    }, 80);
  };

  const markWatched = id => {
    onUpdateList({ ...list, movies: list.movies.map(m => m.id===id ? {...m, watched:true} : m) });
    if (picked?.id === id) setPicked(p => ({...p, watched:true}));
  };
  const removeMovie = id => {
    onUpdateList({ ...list, movies: list.movies.filter(m => m.id!==id) });
    if (picked?.id === id) setPicked(null);
  };
  const saveName = () => { if (nameVal.trim()) onUpdateList({...list, name:nameVal.trim()}); setEditName(false); };

  const unwatched = list.movies.filter(m => !m.watched);
  const watched   = list.movies.filter(m => m.watched);
  const allDone   = list.movies.length > 0 && unwatched.length === 0;

  return (
    <div className="fi">
      {/* Header */}
      <div style={{ display:"flex", alignItems:"flex-start", gap:10, marginBottom:28 }}>
        <button onClick={onBack} style={{ cursor:"pointer", background:"transparent", border:"none", color:"#555", fontSize:26, padding:"0 6px 0 0", lineHeight:1, marginTop:6, transition:"color .15s" }}
          onMouseEnter={e=>e.currentTarget.style.color="#ede5d4"} onMouseLeave={e=>e.currentTarget.style.color="#555"}>‹</button>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:28, marginBottom:4 }}>{list.cover || "🎬"}</div>
          {editName
            ? <input value={nameVal} onChange={e=>setNameVal(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")saveName();if(e.key==="Escape")setEditName(false);}} onBlur={saveName} autoFocus style={{ fontSize:20, fontWeight:600, background:"transparent", border:"none", borderBottom:"1px solid #c8a96e", color:"#ede5d4", fontFamily:"inherit", outline:"none", width:"100%" }} />
            : <div style={{ fontSize:20, fontWeight:600, color:"#ede5d4", cursor:"text" }} onClick={()=>setEditName(true)}>{list.name}</div>
          }
          {list.desc && <div style={{ fontSize:12, color:"#3a3a4a", marginTop:3 }}>{list.desc}</div>}
          <div style={{ fontSize:12, color:"#3a3a4a", marginTop:4 }}>
            {watched.length}/{list.movies.length} 部已看
            {allDone && <span style={{ color:"#81c784", marginLeft:8 }}>· 全部看完了 ✓</span>}
          </div>
        </div>
        <div style={{ display:"flex", gap:6, marginTop:4 }}>
          {allDone && !list.archived && <Btn variant="ghost" onClick={()=>setConfirmArchive(true)} style={{ fontSize:12, padding:"6px 12px", color:"#81c784", borderColor:"#81c78444" }}>归档</Btn>}
          <Btn variant="danger" onClick={()=>setConfirmDelete(true)} style={{ fontSize:12, padding:"6px 12px" }}>删除</Btn>
        </div>
      </div>

      {confirmArchive && (
        <div className="fi" style={{ background:"#0f1a0f", border:"1px solid #81c78433", borderRadius:12, padding:"16px 18px", marginBottom:20 }}>
          <div style={{ fontSize:14, color:"#81c784", marginBottom:12 }}>🎉 全部看完了！要归档这个片单吗？</div>
          <div style={{ display:"flex", gap:8 }}>
            <Btn variant="ghost" onClick={()=>setConfirmArchive(false)} style={{ fontSize:12 }}>取消</Btn>
            <Btn variant="ghost" onClick={()=>{onArchiveList(list.id);onBack();}} style={{ fontSize:12, color:"#81c784", borderColor:"#81c78444" }}>确认归档</Btn>
          </div>
        </div>
      )}
      {confirmDelete && (
        <div className="fi" style={{ background:"#1a0f0f", border:"1px solid #e5737333", borderRadius:12, padding:"16px 18px", marginBottom:20 }}>
          <div style={{ fontSize:14, color:"#e57373", marginBottom:12 }}>删除「{list.name}」？此操作不可撤销。</div>
          <div style={{ display:"flex", gap:8 }}>
            <Btn variant="ghost" onClick={()=>setConfirmDelete(false)} style={{ fontSize:12 }}>取消</Btn>
            <Btn variant="ghost" onClick={()=>{onDeleteList(list.id);onBack();}} style={{ fontSize:12, color:"#e57373", borderColor:"#e5737344" }}>确认删除</Btn>
          </div>
        </div>
      )}

      {/* Pick result */}
      {picked && (
        <div className="fi" style={{ marginBottom:24 }}>
          <div style={{ background:"linear-gradient(160deg,#13131f,#0e0e18)", border:`1px solid ${spinning?"#1f1f2e":"#c8a96e44"}`, borderRadius:18, padding:"28px 24px", textAlign:"center", position:"relative", overflow:"hidden", transition:"border-color .4s" }}>
            <div style={{ position:"absolute", inset:0, background:"radial-gradient(ellipse at 50% 0%,rgba(200,169,110,.05),transparent 65%)", pointerEvents:"none" }} />
            <div style={{ fontSize:10, letterSpacing:"0.25em", color:"#c8a96e77", marginBottom:14 }}>{spinning ? "— 命运转动中 —" : "— 今晚就看这部 —"}</div>
            <div style={{ fontSize:26, fontWeight:600, color:spinning?"#2a2a3a":"#ede5d4", transition:"color .08s", marginBottom:8 }}>{picked.title}</div>
            {!spinning && <>
              <div style={{ fontSize:12, color:"#555", marginBottom:picked.description?8:20 }}>
                {picked.year}{picked.genre?` · ${picked.genre}`:""}
                {picked.director?` · ${picked.director}`:""}
                {picked.rating&&<span style={{ color:"#c8a96e", marginLeft:8 }}>⭐ {picked.rating}</span>}
              </div>
              {picked.description && <div style={{ fontSize:12, color:"#444", fontStyle:"italic", marginBottom:20 }}>{picked.description}</div>}
              <div style={{ display:"flex", gap:10, justifyContent:"center" }}>
                <Btn variant="ghost" onClick={handlePick} style={{ borderColor:"#c8a96e44", color:"#c8a96e" }}>🎲 再抽</Btn>
                {!picked.watched && <Btn variant="gold" onClick={()=>markWatched(picked.id)}>✓ 看完了</Btn>}
                {picked.watched  && <span style={{ color:"#81c784", fontSize:13, padding:"10px 0" }}>已标记 ✓</span>}
              </div>
            </>}
          </div>
        </div>
      )}

      {/* Add */}
      {!list.archived && (
        <div style={{ marginBottom:20 }}>
          <div style={{ display:"flex", gap:8 }}>
            <div style={{ flex:1 }}><TInput value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleAdd()} placeholder="粘贴豆瓣链接，或输入片名…" /></div>
            <Btn variant="primary" disabled={loading||!input.trim()} onClick={handleAdd} style={{ padding:"13px 18px", flexShrink:0 }}>{loading?"…":"+"}</Btn>
          </div>
          <div style={{ minHeight:20, marginTop:6 }}>
            {errMsg && <span style={{ fontSize:12, color:"#e57373" }}>{errMsg}</span>}
            {okMsg  && <span style={{ fontSize:12, color:"#81c784" }}>{okMsg}</span>}
          </div>
        </div>
      )}

      {unwatched.length > 0 && (
        <div style={{ marginBottom:24 }}>
          <Btn variant="gold" full onClick={handlePick} style={{ padding:"13px", fontSize:15 }}>🎲 随机抽一部</Btn>
        </div>
      )}

      {unwatched.length > 0 && (
        <div style={{ marginBottom:24 }}>
          <div style={{ fontSize:11, color:"#2a2a3a", letterSpacing:"0.15em", marginBottom:10 }}>待看 · {unwatched.length}</div>
          <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
            {unwatched.map((m,i) => <MovieRow key={m.id} movie={m} onWatch={markWatched} onRemove={removeMovie} i={i} />)}
          </div>
        </div>
      )}
      {watched.length > 0 && (
        <div>
          <div style={{ fontSize:11, color:"#2a2a3a", letterSpacing:"0.15em", marginBottom:10 }}>已看 · {watched.length}</div>
          <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
            {watched.map((m,i) => <MovieRow key={m.id} movie={m} onWatch={markWatched} onRemove={removeMovie} i={i} isWatched />)}
          </div>
        </div>
      )}
      {list.movies.length === 0 && (
        <div style={{ textAlign:"center", color:"#2a2a3a", padding:"48px 0", fontSize:13 }}>这个片单是空的，快去添加电影吧 ↑</div>
      )}
    </div>
  );
}

function MovieRow({ movie, onWatch, onRemove, i, isWatched }) {
  return (
    <div className="fi" style={{ background:"#0f0f1a", border:"1px solid #141420", borderRadius:12, padding:"12px 14px", display:"flex", alignItems:"center", gap:12, animationDelay:`${i*30}ms`, opacity:isWatched?.45:1, transition:"opacity .3s" }}>
      <span style={{ fontSize:18, flexShrink:0 }}>{GENRE_EMOJI[movie.genre]||"🎬"}</span>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:14, fontWeight:500, color:isWatched?"#444":"#ddd5c4", textDecoration:isWatched?"line-through":"none", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{movie.title}</div>
        <div style={{ fontSize:11, color:"#3a3a4a", marginTop:2 }}>
          {movie.year}{movie.genre?` · ${movie.genre}`:""}
          {movie.rating&&<span style={{ color:isWatched?"#3a3a4a":"#c8a96e77", marginLeft:6 }}>⭐ {movie.rating}</span>}
        </div>
      </div>
      <div style={{ display:"flex", gap:5, flexShrink:0 }}>
        {!isWatched && (
          <button onClick={()=>onWatch(movie.id)} style={{ cursor:"pointer", padding:"5px 10px", background:"transparent", border:"1px solid #1f1f2e", color:"#555", borderRadius:7, fontSize:11, fontFamily:"inherit", transition:"all .15s" }}
            onMouseEnter={e=>{e.currentTarget.style.borderColor="#81c784";e.currentTarget.style.color="#81c784";}}
            onMouseLeave={e=>{e.currentTarget.style.borderColor="#1f1f2e";e.currentTarget.style.color="#555";}}>看完了</button>
        )}
        <button onClick={()=>onRemove(movie.id)} style={{ cursor:"pointer", padding:"5px 8px", background:"transparent", border:"1px solid #141420", color:"#2a2a3a", borderRadius:7, fontSize:12, fontFamily:"inherit", transition:"all .15s" }}
          onMouseEnter={e=>{e.currentTarget.style.borderColor="#e57373";e.currentTarget.style.color="#e57373";}}
          onMouseLeave={e=>{e.currentTarget.style.borderColor="#141420";e.currentTarget.style.color="#2a2a3a";}}>✕</button>
      </div>
    </div>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [auth, setAuth] = useState(() => ({ token: ls.get("cv-token"), username: ls.get("cv-username"), gistId: ls.get("cv-gist-id") }));
  const [data, setData] = useState({ lists: [] });
  const [screen, setScreen] = useState("home");
  const [activeId, setActiveId] = useState(null);
  const [syncStatus, setSyncStatus] = useState("idle");
  const writeTimer = useRef(null);

  const isLoggedIn = !!auth.token;

  useEffect(() => {
    if (!isLoggedIn) return;
    (async () => {
      setSyncStatus("syncing");
      try {
        let gistId = auth.gistId;
        if (!gistId) {
          gistId = await gistApi.find(auth.token);
          if (!gistId) gistId = await gistApi.create(auth.token, { lists: [] });
          ls.set("cv-gist-id", gistId);
          setAuth(a => ({...a, gistId}));
        }
        const remote = await gistApi.read(auth.token, gistId);
        if (remote) setData(remote);
        setSyncStatus("idle");
      } catch {
        const local = ls.get(APP_KEY);
        if (local) setData(local);
        setSyncStatus("error");
      }
    })();
  }, [isLoggedIn]);

  const syncToGist = useCallback(async (d) => {
    ls.set(APP_KEY, d);
    if (!auth.token || !auth.gistId) return;
    setSyncStatus("syncing");
    try { await gistApi.write(auth.token, auth.gistId, d); setSyncStatus("idle"); }
    catch { setSyncStatus("error"); }
  }, [auth.token, auth.gistId]);

  const updateData = useCallback((d) => {
    setData(d);
    clearTimeout(writeTimer.current);
    writeTimer.current = setTimeout(() => syncToGist(d), 800);
  }, [syncToGist]);

  const handleConnect = (token, username) => {
    ls.set("cv-token", token); ls.set("cv-username", username);
    setAuth({ token, username, gistId: null });
  };
  const handleDisconnect = () => {
    ls.del("cv-token"); ls.del("cv-username"); ls.del("cv-gist-id");
    setAuth({ token:null, username:null, gistId:null });
    setData({ lists:[] }); setScreen("home");
  };

  const updateList   = u  => updateData({...data, lists: data.lists.map(l => l.id===u.id ? u : l)});
  const handleNew    = ({name,desc,cover}) => { const l={id:generateId(),name,desc,cover,movies:[],archived:false,createdAt:Date.now()}; updateData({...data,lists:[l,...data.lists]}); setActiveId(l.id); setScreen("list"); };
  const handleArchive   = id => updateData({...data, lists:data.lists.map(l=>l.id===id?{...l,archived:true}:l)});
  const handleUnarchive = id => updateData({...data, lists:data.lists.map(l=>l.id===id?{...l,archived:false}:l)});
  const handleDelete    = id => updateData({...data, lists:data.lists.filter(l=>l.id!==id)});

  const activeList = data.lists.find(l => l.id===activeId);

  const wrap = (children) => (
    <div style={{ fontFamily:"'Noto Serif SC','-apple-system','PingFang SC',Georgia,serif", minHeight:"100vh", background:"#09090f", color:"#e8e0d0" }}>
      <style>{css}</style>
      {children}
    </div>
  );

  if (!isLoggedIn) return wrap(<SetupScreen onConnect={handleConnect} />);

  return wrap(<>
    {/* Topbar */}
    <div style={{ borderBottom:"1px solid #0f0f18", padding:"14px 20px", display:"flex", alignItems:"center", justifyContent:"space-between", background:"rgba(9,9,15,.97)", position:"sticky", top:0, zIndex:100, backdropFilter:"blur(16px)" }}>
      <button onClick={()=>setScreen("home")} style={{ cursor:"pointer", background:"transparent", border:"none", display:"flex", alignItems:"center", gap:8 }}>
        <span style={{ fontSize:16 }}>🎬</span>
        <span style={{ fontSize:14, fontWeight:600, color:"#ede5d4" }}>Cinema Vault</span>
      </button>
      <div style={{ display:"flex", alignItems:"center", gap:8 }}>
        <SyncBadge status={syncStatus} onSync={()=>syncToGist(data)} />
        <div style={{ width:1, height:14, background:"#1f1f2e" }} />
        <span style={{ fontSize:11, color:"#2a2a3a" }}>{auth.username}</span>
        <button onClick={handleDisconnect} style={{ cursor:"pointer", background:"transparent", border:"none", color:"#2a2a3a", fontSize:11, fontFamily:"inherit", padding:"2px 6px", borderRadius:6, transition:"color .15s" }}
          onMouseEnter={e=>e.currentTarget.style.color="#e57373"} onMouseLeave={e=>e.currentTarget.style.color="#2a2a3a"}>退出</button>
      </div>
    </div>

    <div style={{ maxWidth:640, margin:"0 auto", padding:"28px 16px 100px" }}>
      {screen==="home" && <HomeScreen data={data} onOpenList={id=>{setActiveId(id);setScreen("list");}} onNewList={()=>setScreen("new")} onUnarchiveList={handleUnarchive} />}
      {screen==="new"  && <NewListScreen onSave={handleNew} onCancel={()=>setScreen("home")} />}
      {screen==="list" && activeList && <ListScreen list={activeList} onBack={()=>setScreen("home")} onUpdateList={updateList} onArchiveList={handleArchive} onDeleteList={handleDelete} />}
    </div>
  </>);
}
