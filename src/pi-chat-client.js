export async function startPiChatClient({ document, fetch, storage }) {
  const el = id => document.getElementById(id);
  let sessionId = null, canSend = false, busy = false, nextCaseId = null;
  const label = text => { el('state').textContent = text; };
  const controls = () => { el('send').disabled = busy || !canSend || !sessionId; el('new-meeting').disabled = busy; el('meeting-select').disabled = busy; };
  async function api(url, value) {
    const response = await fetch("/" + url, { ...Object.fromEntries([['credentials', 'same-origin']]), cache: 'no-store',
      ...(value === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) }) });
    if (response.status === 401) { el('login-view').hidden = false; el('app-view').hidden = true; throw new Error('auth'); }
    if (!response.ok) throw new Error('request');
    return response;
  }
  function render(messages) {
    el('messages').replaceChildren();
    for (const message of messages) {
      const article = document.createElement('article'), name = document.createElement('strong'), text = document.createElement('p');
      name.textContent = message.role === 'assistant' ? '会议助手' : '我'; text.textContent = message.content;
      article.className = message.role; article.append(name, text); el('messages').append(article);
    }
  }
  async function loadSession(id) {
    const value = await (await api(`api/sessions/${id}`)).json();
    sessionId = value.id; storage.setItem('agentmo-pi-session', sessionId);
    el('meeting-select').value = sessionId; render(value.messages);
    const latest = value.turns.at(-1);
    if (latest && ['received', 'reserved', 'sent'].includes(latest.status)) {
      busy = true; controls(); void observe(latest.turnId); return;
    }
    busy = false; controls();
    label(latest && ['failed', 'interrupted'].includes(latest.status) ? '上次请求未完成，可能已有预留。不会自动重发。' : canSend ? '可以发送本次已批准的材料' : '等待本次发送批准');
  }
  async function refresh() {
    const value = await (await api('api/sessions')).json();
    nextCaseId = value.nextCaseId; canSend = value.canSend === true && typeof nextCaseId === 'string';
    el('login-view').hidden = true; el('app-view').hidden = false;
    el('meeting-select').replaceChildren();
    value.sessions.forEach((row, index) => { const option = document.createElement('option'); option.value = row.id; option.textContent = `会议 ${index + 1}`; el('meeting-select').append(option); });
    const saved = storage.getItem('agentmo-pi-session');
    const selected = value.sessions.find(row => row.id === (sessionId ?? saved)) ?? value.sessions[0];
    if (selected) await loadSession(selected.id);
    else { sessionId = null; render([]); label('先新建一个会议'); controls(); }
  }
  async function observe(turnId) {
    try {
      const response = await api(`api/turns/${turnId}/events`), reader = response.body.getReader();
      const decoder = new TextDecoder(); let buffer = '', terminal = false;
      try {
        while (true) {
          const { value, done } = await reader.read(); buffer += decoder.decode(value, { stream: !done });
          if (buffer.length > 256 * 1024) throw new Error('stream');
          let boundary;
          while ((boundary = buffer.indexOf('\n\n')) !== -1) {
            const frame = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
            const data = frame.split('\n').find(line => line.startsWith('data: ')); if (!data) continue;
            const state = JSON.parse(data.slice(6));
            if (state.turnId !== turnId || state.sessionId !== sessionId) throw new Error('route');
            if (['completed', 'failed', 'interrupted'].includes(state.status)) { terminal = true; break; }
            label('正在整理会议，请稍候…');
          }
          if (terminal || done) break;
        }
      } finally { await reader.cancel().catch(() => {}); }
      if (!terminal) throw new Error('uncertain');
      busy = false; await refresh();
    } catch { busy = false; canSend = false; controls(); label('连接中断，请刷新查看已保存结果。不会自动重发。'); }
  }
  el('login-form').addEventListener('submit', async event => {
    event.preventDefault(); const loginInput = el('password').value; el('password').value = '';
    try { await api('api/login', { ['password']: loginInput }); el('login-error').textContent = ''; await refresh(); }
    catch { el('login-error').textContent = '未能登录，请核对本次访问口令。'; }
  });
  el('new-meeting').addEventListener('click', async () => {
    try { const created = await (await api('api/sessions', {})).json(); sessionId = created.id; await refresh(); el('material').focus(); }
    catch { label('未能新建会议，没有发送材料。'); }
  });
  el('meeting-select').addEventListener('change', async () => { try { await loadSession(el('meeting-select').value); } catch { label('未能读取会议，没有发送材料。'); } });
  el('composer').addEventListener('submit', async event => {
    event.preventDefault(); if (busy || !canSend || !sessionId) return;
    const text = el('material').value;
    if (!text.trim() || [...text].length > 8000 || !text.isWellFormed()) { label('请填写完整材料，最多8,000个字符；内容不会被截断。'); return; }
    busy = true; controls(); label('正在提交…');
    try {
      const accepted = await (await api('api/turns', { caseId: nextCaseId, sessionId, turnId: crypto.randomUUID(), text })).json();
      el('material').value = ''; await observe(accepted.turnId);
    } catch { busy = false; canSend = false; controls(); label('请求未确认，可能已有预留。请刷新查看，不会自动重发。'); }
  });
  el('stop').addEventListener('click', async () => { try { await api('api/stop', {}); canSend = false; controls(); label('已请求停止本次服务。'); } catch { label('停止尚未确认，请核对运行状态。'); } });
  try { await refresh(); } catch { el('login-view').hidden = false; el('app-view').hidden = true; }
}

if (typeof window !== 'undefined') void startPiChatClient({ document: window.document, fetch: window.fetch.bind(window), storage: window.sessionStorage });
