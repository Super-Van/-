/* ═══════════════════════════════════════════════════════════════
   掌上董事会 · Supabase 接入版
   ═══════════════════════════════════════════════════════════════ */

// ── ★ 配置区域：替换为你的 Supabase 项目信息 ★ ──
const SUPABASE_URL = 'https://qaxkmtidftirdobtiwag.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFheGttdGlkZnRpcmRvYnRpd2FnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk3MDc0NzAsImV4cCI6MjEwNTI4MzQ3MH0.DCO9EbON3jGF-Nxw444dCXUP64G7oPExBcZSUiJ0v4A';
// ───────────────────────────────────────────────

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── 职级定义 ──
const LEVELS = [
  {lv:'L1', title:'董事', minCount:0,  minRate:0},
  {lv:'L2', title:'执行董事', minCount:5,  minRate:50},
  {lv:'L3', title:'专业委员会主任', minCount:10, minRate:55},
  {lv:'L4', title:'副董事长', minCount:20, minRate:60},
  {lv:'L5', title:'董事长', minCount:35, minRate:65},
  {lv:'L6', title:'董事局主席', minCount:50, minRate:70},
];

// ── 头像颜色池 ──
const AV = ['#B8935A','#5A7A8A','#6A8A6A','#8A6A5A','#7A5A8A','#5A8A7A','#8A7A5A','#6A5A8A','#8A5A6A','#5A6A8A'];

// ── 全局轻量状态 ──
const state = {
  currentUser: null,       // {id, name, email, avatar_url, phone}
  currentBoardId: null,
  currentView: 'login',
  filterType: 'all',
  historyFilter: 'all',
  selectedType: 'consume',
  selectedDeadline: '24h',
  proposalImages: [],      // base64 临时预览
  voteReasonImages: [],
  pendingInvite: null,     // {boardId, boardName, inviteCode}
  notifications: [],
  userVotes: {},           // {proposalId: 'yes'|'no'}
};

// ── 缓存：避免重复查询 ──
const cache = {
  boards: [],
  currentBoard: null,
  members: [],
  proposals: [],
  history: [],
};

/* ═══════════════════════════════════════════════════════════════
   1. 认证模块
   ═══════════════════════════════════════════════════════════════ */

async function initAuth() {
  const { data: { session } } = await supabase.auth.getSession();
  if (session) {
    await loadUserProfile(session.user.id);
    await loadBoards();
    go('board-home');
  } else {
    // 检查URL是否有邀请码
    checkInviteInUrl();
    go('login');
  }

  // 监听认证状态变化
  supabase.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_OUT') {
      state.currentUser = null;
      state.currentBoardId = null;
      cache.boards = [];
      go('login');
    }
  });
}

async function loadUserProfile(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();
  if (data) {
    const { data: authData } = await supabase.auth.getUser();
    state.currentUser = {
      id: userId,
      name: data.name || '用户',
      email: authData.user.email,
      avatar_url: data.avatar_url,
      phone: data.phone,
    };
  }
}

async function doLogin() {
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPwd').value;
  if (!email || !password) { toast('请输入邮箱和密码', 'info'); return; }

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    toast(error.message === 'Invalid login credentials' ? '邮箱或密码错误' : error.message, 'danger');
    return;
  }
  toast('登录成功，欢迎回来', 'success');
  await loadUserProfile((await supabase.auth.getUser()).data.user.id);
  await loadBoards();
  setTimeout(() => go('board-home'), 500);
}

async function doRegister() {
  const name = document.getElementById('regName').value.trim();
  const email = document.getElementById('regEmail').value.trim();
  const password = document.getElementById('regPwd').value;
  if (!name || !email || !password) { toast('请填写完整信息', 'info'); return; }
  if (password.length < 6) { toast('密码至少 6 位', 'info'); return; }

  const { error } = await supabase.auth.signUp({
    email, password,
    options: { data: { name } }
  });
  if (error) { toast(error.message, 'danger'); return; }

  toast('注册成功！请查收邮箱验证链接', 'success');
  // 如果有邀请，记录下来等验证后处理
  if (state.pendingInvite) {
    localStorage.setItem('pendingInvite', JSON.stringify(state.pendingInvite));
  }
  setTimeout(() => go('login'), 1500);
}

async function doLogout() {
  await supabase.auth.signOut();
  toast('已退出登录', 'info');
}

function verifyForgotEmail() {
  const email = document.getElementById('forgotEmail').value.trim();
  if (!email) { toast('请输入邮箱地址', 'info'); return; }
  supabase.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + window.location.pathname
  }).then(({ error }) => {
    if (error) { toast(error.message, 'danger'); return; }
    toast('重置链接已发送到你的邮箱', 'success');
    setTimeout(() => go('login'), 1500);
  });
}

// 处理密码恢复回调
async function handlePasswordRecovery() {
  const hash = window.location.hash;
  if (hash.includes('type=recovery') || hash.includes('type=recovery')) {
    go('forgot');
    document.getElementById('forgotStep1').style.display = 'none';
    document.getElementById('forgotStep2').style.display = 'block';
  }
}

async function resetPassword() {
  const p1 = document.getElementById('newPwd').value;
  const p2 = document.getElementById('confirmNewPwd').value;
  if (!p1 || p1.length < 6) { toast('密码至少 6 位', 'info'); return; }
  if (p1 !== p2) { toast('两次输入的密码不一致', 'info'); return; }
  const { error } = await supabase.auth.updateUser({ password: p1 });
  if (error) { toast(error.message, 'danger'); return; }
  toast('密码重置成功，请使用新密码登录', 'success');
  setTimeout(() => go('login'), 800);
}

/* ═══════════════════════════════════════════════════════════════
   2. 数据加载模块
   ═══════════════════════════════════════════════════════════════ */

async function loadBoards() {
  const { data, error } = await supabase
    .from('board_members')
    .select('board_id, boards(*)')
    .eq('user_id', state.currentUser.id);
  if (error) { console.error(error); return; }
  cache.boards = data.map(d => d.boards);
  if (cache.boards.length > 0) {
    // 优先使用上次选中的董事会
    const lastBoard = localStorage.getItem('lastBoardId');
    state.currentBoardId = lastBoard && cache.boards.find(b => b.id === lastBoard)
      ? lastBoard : cache.boards[0].id;
  }
  // 处理待处理的邀请
  await processPendingInvite();
}

async function processPendingInvite() {
  const pending = localStorage.getItem('pendingInvite');
  if (pending) {
    const inv = JSON.parse(pending);
    localStorage.removeItem('pendingInvite');
    // 检查是否已在该董事会
    const already = cache.boards.find(b => b.id === inv.boardId);
    if (!already) {
      await joinBoardByCode(inv.inviteCode);
    }
  }
}

async function loadCurrentBoard() {
  const { data, error } = await supabase
    .from('boards')
    .select('*')
    .eq('id', state.currentBoardId)
    .single();
  if (error) { console.error(error); return; }
  cache.currentBoard = data;
  localStorage.setItem('lastBoardId', state.currentBoardId);
}

async function loadMembers() {
  const { data, error } = await supabase
    .from('board_members')
    .select('*, profiles(name, avatar_url)')
    .eq('board_id', state.currentBoardId)
    .order('joined_at', { ascending: true });
  if (error) { console.error(error); return; }
  cache.members = data.map(m => ({
    userId: m.user_id,
    name: m.profiles?.name || '用户',
    avatar: m.profiles?.avatar_url || AV[m.user_id.charCodeAt(0) % AV.length],
    role: m.role,
    level: m.level,
    proposalsCount: m.proposals_count,
    passRate: m.pass_rate,
    joined: m.joined_at?.slice(0, 10) || '—',
  }));
}

async function loadProposals() {
  const { data, error } = await supabase
    .from('proposals')
    .select('*, proposal_images(public_url), votes(vote, user_id, reason, vote_images(public_url), profiles:user_id(name, avatar_url))')
    .eq('board_id', state.currentBoardId)
    .eq('status', 'voting')
    .order('created_at', { ascending: false });
  if (error) { console.error(error); return; }

  cache.proposals = data.map(p => formatProposal(p));
  // 记录当前用户的投票
  cache.proposals.forEach(p => {
    const myVote = p.voters?.find(v => v.userId === state.currentUser.id);
    if (myVote) state.userVotes[p.id] = myVote.vote;
  });
}

async function loadHistory() {
  const { data, error } = await supabase
    .from('proposals')
    .select('*, proposal_images(public_url), votes(vote, user_id, reason, profiles:user_id(name, avatar_url))')
    .eq('board_id', state.currentBoardId)
    .in('status', ['passed', 'rejected', 'withdrawn'])
    .order('deadline_at', { ascending: false });
  if (error) { console.error(error); return; }
  cache.history = data.map(p => formatProposal(p));
}

function formatProposal(p) {
  const yesVotes = p.votes?.filter(v => v.vote === 'yes') || [];
  const noVotes = p.votes?.filter(v => v.vote === 'no') || [];
  const now = new Date();
  const deadline = new Date(p.deadline_at);
  const diffMs = deadline - now;
  let deadlineStr = p.deadline_at?.slice(0, 10);
  if (p.status === 'voting' && diffMs > 0) {
    const hours = Math.floor(diffMs / 3600000);
    const mins = Math.floor((diffMs % 3600000) / 60000);
    deadlineStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
  }
  return {
    id: p.id,
    type: p.type,
    title: p.title,
    amount: p.amount || '—',
    deadline: deadlineStr,
    desc: p.description || '',
    status: p.status,
    yes: yesVotes.length,
    no: noVotes.length,
    images: p.proposal_images?.map(i => i.public_url) || [],
    creatorId: p.creator_id,
    voters: p.votes?.map(v => ({
      name: v.profiles?.name || '用户',
      avatar: v.profiles?.avatar_url || AV[v.user_id?.charCodeAt(0) % AV.length],
      vote: v.vote,
      reason: v.reason || '',
      reasonImages: v.vote_images?.map(i => i.public_url) || [],
      userId: v.user_id,
    })) || [],
  };
}

async function loadNotifications() {
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('user_id', state.currentUser.id)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) { console.error(error); return; }
  state.notifications = data.map(n => ({
    id: n.id,
    type: n.type,
    title: n.title,
    detail: n.detail,
    unread: n.unread,
    time: formatTime(n.created_at),
    boardId: n.board_id,
  }));
}

function formatTime(iso) {
  const d = new Date(iso);
  const now = new Date();
  const diff = (now - d) / 1000;
  if (diff < 60) return '刚刚';
  if (diff < 3600) return Math.floor(diff / 60) + '分钟前';
  if (diff < 86400) return Math.floor(diff / 3600) + '小时前';
  return d.toLocaleDateString('zh-CN');
}

/* ═══════════════════════════════════════════════════════════════
   3. 视图切换 & 导航
   ═══════════════════════════════════════════════════════════════ */

async function go(view) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const target = document.getElementById('view-' + view);
  if (target) { target.classList.add('active'); state.currentView = view; }

  const appViews = ['board-home','create-proposal','proposal-detail','history','members','invite','profile','account','my-level','my-boards'];
  if (appViews.includes(view)) {
    injectAppNav(); injectSidebar(view);
    if (!state.currentBoardId && cache.boards.length > 0) {
      state.currentBoardId = cache.boards[0].id;
    }
    if (state.currentBoardId) {
      await loadCurrentBoard();
      await loadMembers();
      updateBoardContext();
    }
  }

  const tabbar = document.getElementById('mobileTabbar');
  if (tabbar) {
    document.body.classList.toggle('is-app-page', appViews.includes(view));
    tabbar.querySelectorAll('.mtab').forEach(t => {
      t.classList.remove('active');
      if (t.dataset.view === view) t.classList.add('active');
    });
  }
  closeModal();
  document.getElementById('notifPanel').classList.remove('active');
  window.scrollTo(0, 0);

  // 按需加载数据
  if (view === 'board-home') { await loadProposals(); renderProposals(); }
  if (view === 'history') { await loadHistory(); renderHistory(); }
  if (view === 'members') { renderMembers(); }
  if (view === 'profile') { renderProfile(); }
  if (view === 'account') { renderAccount(); }
  if (view === 'my-level') { renderMyLevel(); }
  if (view === 'my-boards') { renderMyBoards(); }
  if (view === 'invite') { renderInvite(); }
  if (view === 'board-home' || view === 'profile') { await loadNotifications(); renderNotifs(); }
}

function injectAppNav() {
  const slots = ['appNavSlot1','appNavSlot2','appNavSlot3','appNavSlot4','appNavSlot5','appNavSlot6','appNavSlot7','appNavSlot8','appNavSlot9','appNavSlot10'];
  const template = document.getElementById('appNavTemplate');
  slots.forEach(id => {
    const slot = document.getElementById(id);
    if (slot && slot.children.length === 0) slot.appendChild(template.content.cloneNode(true));
  });
  updateNavAvatar();
}

function injectSidebar(view) {
  const source = document.querySelector('#view-board-home .app-sidebar');
  if (!source) return;
  const targets = ['sidebarSlot2','sidebarSlot3','sidebarSlot4','sidebarSlot5','sidebarSlot6','sidebarSlot7','sidebarSlot8','sidebarSlot9','sidebarSlot10'];
  targets.forEach(id => {
    const slot = document.getElementById(id);
    if (slot && slot.children.length === 0) {
      const clone = source.cloneNode(true);
      clone.querySelectorAll('.side-link').forEach(l => l.classList.remove('active'));
      const linkMap = {'create-proposal':0,'proposal-detail':0,'history':1,'members':2,'invite':3,'account':4,'my-level':5,'my-boards':6,'profile':4};
      const idx = linkMap[view];
      if (idx !== undefined && clone.querySelectorAll('.side-link')[idx]) clone.querySelectorAll('.side-link')[idx].classList.add('active');
      slot.appendChild(clone);
    }
  });
}

function updateBoardContext() {
  const b = cache.currentBoard;
  if (!b) return;
  const me = cache.members.find(m => m.userId === state.currentUser.id);
  const totalProps = (cache.proposals?.length || 0) + (cache.history?.length || 0);

  document.querySelectorAll('.nav-board-name').forEach(el => el.textContent = b.name);
  document.querySelectorAll('.nav-board-level').forEach(el => el.textContent = me ? me.level : 'L1');

  document.querySelectorAll('.side-board-name').forEach(el => {
    el.innerHTML = `${b.name} <span class="tag tag-gold side-board-tag" style="font-size:.6rem;padding:2px 7px">${me ? me.level : 'L1'}</span>`;
  });
  document.querySelectorAll('.side-board-role').forEach(el => el.textContent = me ? me.level + ' ' + (LEVELS.find(l => l.lv === me.level)?.title || '董事') : '董事');
  document.querySelectorAll('.side-board-count').forEach(el => el.textContent = `${cache.members.length} 名成员 · ${totalProps} 份提案`);
  document.querySelectorAll('.side-proposal-count').forEach(el => el.textContent = cache.proposals?.length || 0);
  document.querySelectorAll('.side-history-count').forEach(el => el.textContent = cache.history?.length || 0);
  document.querySelectorAll('.side-member-count').forEach(el => el.textContent = cache.members.length);

  const sub = document.querySelector('.page-head-sub');
  if (sub) sub.textContent = `${cache.proposals?.length || 0} 个提案正在投票中 · 达到门槛即自动出决议`;
  const msub = document.querySelector('.page-member-sub');
  if (msub) msub.textContent = `${cache.members.length} / 50 名成员 · 创建者可移除成员`;
}

function updateNavAvatar() {
  document.querySelectorAll('.nav-avatar').forEach(el => {
    if (state.currentUser?.avatar_url) {
      el.style.backgroundImage = `url(${state.currentUser.avatar_url})`;
      el.style.backgroundSize = 'cover';
      el.style.backgroundPosition = 'center';
      el.textContent = '';
    } else {
      el.style.backgroundImage = '';
      el.textContent = state.currentUser?.name?.[0] || 'U';
    }
  });
}

/* ═══════════════════════════════════════════════════════════════
   4. 董事会管理
   ═══════════════════════════════════════════════════════════════ */

async function createBoardFromOnboarding() {
  const name = document.getElementById('boardName').value.trim();
  const desc = document.getElementById('boardDesc').value.trim();
  if (!name) { toast('请输入董事会名称', 'info'); return; }

  // 生成邀请码
  const inviteCode = 'PALM-' + Math.random().toString(36).substr(2, 4).toUpperCase();
  const dotColor = '#' + Math.floor(Math.random() * 0x888888 + 0x444444).toString(16);

  const { data, error } = await supabase
    .from('boards')
    .insert({ name, description: desc, creator_id: state.currentUser.id, invite_code: inviteCode, dot_color: dotColor })
    .select()
    .single();
  if (error) { toast(error.message, 'danger'); return; }

  state.currentBoardId = data.id;
  await loadBoards();
  toast('董事会创建成功！', 'success');
  setTimeout(() => go('board-home'), 600);
}

function showBoardSwitcher() {
  const items = cache.boards.map(bd => {
    const me = cache.members.find(m => m.userId === state.currentUser.id) ||
               bd._myLevel ? { level: bd._myLevel } : { level: 'L1' };
    const total = bd._totalProps || 0;
    const isActive = bd.id === state.currentBoardId;
    return `<div class="bs-item ${isActive?'active':''}" onclick="switchBoard('${bd.id}')">
      <span class="bs-dot" style="background:${bd.dot_color}"></span>
      <div class="bs-info">
        <div class="bs-name">${bd.name}${bd.creator_id===state.currentUser.id?'<span class="tag tag-muted" style="font-size:.6rem;padding:1px 6px">我创建的</span>':''}</div>
        <div class="bs-meta">${bd._memberCount || 0} 名成员 · ${total} 份提案</div>
      </div>
      ${isActive?'<span class="bs-current-tag">当前</span>':`<span class="bs-level">${me.level}</span>`}
    </div>`;
  }).join('');
  showModal(`
    <div class="board-switch-modal">
      <h3>切换董事会</h3>
      ${items}
      <div class="bs-create-btn" onclick="closeModal();go('onboarding')">
        <svg width="16" height="16" viewBox="0 0 256 256" fill="currentColor"><path d="M224,128a8,8,0,0,1-8,8H136v80a8,8,0,0,1-16,0V136H40a8,8,0,0,1,0-16h80V40a8,8,0,0,1,16,0v80h80A8,8,0,0,1,224,128Z"/></svg>
        创建新董事会
      </div>
    </div>
  `);
  // 异步加载各董事会统计
  loadBoardsStats();
}

async function loadBoardsStats() {
  for (const bd of cache.boards) {
    const [{ count: mCount }, { count: pCount }] = await Promise.all([
      supabase.from('board_members').select('*', { count: 'exact', head: true }).eq('board_id', bd.id),
      supabase.from('proposals').select('*', { count: 'exact', head: true }).eq('board_id', bd.id),
    ]);
    bd._memberCount = mCount || 0;
    bd._totalProps = pCount || 0;
  }
}

async function switchBoard(boardId) {
  state.currentBoardId = boardId;
  closeModal();
  const b = cache.boards.find(x => x.id === boardId);
  toast(`已切换到「${b?.name || '董事会'}」`, 'success');
  await go(state.currentView);
}

/* ═══════════════════════════════════════════════════════════════
   5. 提案列表 & 详情
   ═══════════════════════════════════════════════════════════════ */

function renderProposals() {
  const list = document.getElementById('proposalList');
  let filtered = cache.proposals || [];
  if (state.filterType !== 'all') filtered = filtered.filter(p => p.type === state.filterType);
  if (filtered.length === 0) {
    list.innerHTML = `<div class="empty-state"><div class="es-icon"><svg width="28" height="28" viewBox="0 0 256 256" fill="currentColor"><path d="M213.66,82.34l-56-56A8,8,0,0,0,152,24H56A16,16,0,0,0,40,40V216a16,16,0,0,0,16,16H200a16,16,0,0,0,16-16V88A8,8,0,0,0,213.66,82.34Z"/></svg></div><h3>暂无投票中的提案</h3><p>发起第一个提案，让董事会帮你拍板</p><button class="btn btn-gold btn-sm" onclick="go('create-proposal')">发起提案</button></div>`;
    return;
  }
  const typeIcon = { consume: '🛒', travel: '✈️', other: '📋' };
  const total = cache.members.length;
  list.innerHTML = filtered.map(p => {
    const voted = state.userVotes[p.id];
    const yesPct = Math.round(p.yes / total * 100);
    const noPct = Math.round(p.no / total * 100);
    const btnText = voted ? '修改投票' : '参与投票';
    const btnClass = voted ? 'btn-outline-gold' : 'btn-gold';
    return `<div class="proposal-row" onclick="openProposal('${p.id}')">
      <div class="pr-type ${p.type}">${typeIcon[p.type]}</div>
      <div class="pr-info">
        <div class="pr-title">${p.title}</div>
        <div class="pr-meta"><span>${p.amount}</span><span>截止 ${p.deadline}</span>${voted?`<span style="color:var(--accent-dark);font-weight:600">已投${voted==='yes'?'通过':'反对'}</span>`:''}</div>
      </div>
      <div class="pr-vote">
        <div class="pr-vote-bar"><div class="yes" style="width:${yesPct}%"></div><div class="no" style="width:${noPct}%"></div></div>
        <div class="pr-vote-text">${p.yes} 通过 · ${p.no} 反对 · ${total-p.yes-p.no} 未投</div>
      </div>
      <button class="btn ${btnClass} btn-sm pr-action" onclick="event.stopPropagation();openProposal('${p.id}')">${btnText}</button>
    </div>`;
  }).join('');
}

function filterProps(el, type) {
  document.querySelectorAll('#view-board-home .filter-chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active'); state.filterType = type; renderProposals();
}

function renderHistory() {
  const list = document.getElementById('historyList');
  let filtered = cache.history || [];
  if (state.historyFilter !== 'all') filtered = filtered.filter(p => p.status === state.historyFilter);
  const typeIcon = { consume: '🛒', travel: '✈️', other: '📋' };
  const total = cache.members.length;
  if (filtered.length === 0) {
    list.innerHTML = `<div class="empty-state"><div class="es-icon"><svg width="28" height="28" viewBox="0 0 256 256" fill="currentColor"><path d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216Z"/></svg></div><h3>暂无历史决议</h3><p>已完成的提案会归档在这里</p></div>`;
    return;
  }
  list.innerHTML = filtered.map(p => {
    const yesPct = Math.round(p.yes / total * 100);
    const noPct = Math.round(p.no / total * 100);
    const statusTag = p.status === 'passed' ? '<span class="tag tag-success">已通过</span>' : p.status === 'withdrawn' ? '<span class="tag tag-muted">已撤回</span>' : '<span class="tag tag-danger">未通过</span>';
    return `<div class="proposal-row" onclick="openHistoryProposal('${p.id}')">
      <div class="pr-type ${p.type}">${typeIcon[p.type]}</div>
      <div class="pr-info"><div class="pr-title">${p.title}</div><div class="pr-meta"><span>${p.amount}</span><span>${p.deadline} 决议</span></div></div>
      <div class="pr-vote"><div class="pr-vote-bar"><div class="yes" style="width:${yesPct}%"></div><div class="no" style="width:${noPct}%"></div></div><div class="pr-vote-text">${p.yes} 通过 · ${p.no} 反对</div></div>
      ${statusTag}
    </div>`;
  }).join('');
}

function filterHistory(el, type) {
  document.querySelectorAll('#view-history .filter-chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active'); state.historyFilter = type; renderHistory();
}

function openProposal(id) {
  const p = cache.proposals.find(x => x.id === id);
  if (!p) return;
  state.detailFromHistory = false;
  renderProposalDetail(p, 'voting'); go('proposal-detail');
}

function openHistoryProposal(id) {
  const p = cache.history.find(x => x.id === id);
  if (!p) return;
  state.detailFromHistory = true;
  renderProposalDetail(p, p.status); go('proposal-detail');
}

function renderProposalDetail(p, status) {
  const total = cache.members.length;
  const backBtn = document.querySelector('#view-proposal-detail .detail-back');
  if (backBtn) {
    if (state.detailFromHistory) {
      backBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 256 256" fill="currentColor"><path d="M221.66,133.66l-72,72a8,8,0,0,1-11.32-11.32L196.69,120H40a8,8,0,0,1,0-16H196.69L138.34,61.66a8,8,0,0,1,11.32-11.32l72,72A8,8,0,0,1,221.66,133.66Z"/></svg>返回已决议';
      backBtn.onclick = () => go('history');
    } else {
      backBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 256 256" fill="currentColor"><path d="M221.66,133.66l-72,72a8,8,0,0,1-11.32-11.32L196.69,120H40a8,8,0,0,1,0-16H196.69L138.34,61.66a8,8,0,0,1,11.32-11.32l72,72A8,8,0,0,1,221.66,133.66Z"/></svg>返回提案大厅';
      backBtn.onclick = () => go('board-home');
    }
  }
  const opinionTitle = state.detailFromHistory ? '董事表决意见' : '董事表决详情';
  const typeLabel = { consume: '消费', travel: '出行', other: '其他' };
  const typeIcon = { consume: '🛒', travel: '✈️', other: '📋' };
  const voted = state.userVotes[p.id];
  const yesPct = Math.round(p.yes / total * 100);
  const noPct = Math.round(p.no / total * 100);
  const pending = total - p.yes - p.no;
  const statusHeader = status === 'voting' ? `<span class="tag tag-gold">投票中 · 截止 ${p.deadline}</span>` : status === 'passed' ? `<span class="tag tag-success">✓ 已通过 · ${p.deadline} 出决议</span>` : status === 'withdrawn' ? `<span class="tag tag-muted">已撤回</span>` : `<span class="tag tag-danger">✗ 未通过 · ${p.deadline} 出决议</span>`;

  let voteActions = '';
  if (status === 'voting') {
    if (voted) {
      const yesDisabled = voted === 'yes';
      const noDisabled = voted === 'no';
      voteActions = `
      <div style="margin-bottom:12px;padding:10px 14px;background:rgba(184,147,90,.06);border-radius:var(--r-control);font-size:.85rem;color:var(--accent-dark);font-weight:600;text-align:center">你已投「${voted==='yes'?'通过':'反对'}」票 · 点击反向按钮可修改意见</div>
      <div class="vote-actions">
        <button class="vote-btn yes ${yesDisabled?'voted-fixed':''}" onclick="${yesDisabled?'':`confirmChangeVote('${p.id}','yes')`}" ${yesDisabled?'disabled':''}><svg width="18" height="18" viewBox="0 0 256 256" fill="currentColor"><path d="M229.66,77.66l-128,128a8,8,0,0,1-11.32,0l-56-56a8,8,0,0,1,11.32-11.32L96,188.69,218.34,66.34a8,8,0,0,1,11.32,11.32Z"/></svg>${yesDisabled?'✓ 已通过':'通过'}</button>
        <button class="vote-btn no ${noDisabled?'voted-fixed':''}" onclick="${noDisabled?'':`confirmChangeVote('${p.id}','no')`}" ${noDisabled?'disabled':''}><svg width="18" height="18" viewBox="0 0 256 256" fill="currentColor"><path d="M205.66,194.34a8,8,0,0,1-11.32,0L128,128l-66.34,66.34a8,8,0,0,1-11.32-11.32L116.69,116.8,50.34,50.34A8,8,0,0,1,61.66,39L128,105.37l66.34-66.34a8,8,0,0,1,11.32,11.32L139.31,116.8l66.35,66.22A8,8,0,0,1,205.66,194.34Z"/></svg>${noDisabled?'✓ 已反对':'反对'}</button>
      </div>`;
    } else {
      voteActions = `
      <div class="vote-actions">
        <button class="vote-btn yes" onclick="castVote('${p.id}','yes')"><svg width="18" height="18" viewBox="0 0 256 256" fill="currentColor"><path d="M229.66,77.66l-128,128a8,8,0,0,1-11.32,0l-56-56a8,8,0,0,1,11.32-11.32L96,188.69,218.34,66.34a8,8,0,0,1,11.32,11.32Z"/></svg>通过</button>
        <button class="vote-btn no" onclick="castVote('${p.id}','no')"><svg width="18" height="18" viewBox="0 0 256 256" fill="currentColor"><path d="M205.66,194.34a8,8,0,0,1-11.32,0L128,128l-66.34,66.34a8,8,0,0,1-11.32-11.32L116.69,116.8,50.34,50.34A8,8,0,0,1,61.66,39L128,105.37l66.34-66.34a8,8,0,0,1,11.32,11.32L139.31,116.8l66.35,66.22A8,8,0,0,1,205.66,194.34Z"/></svg>反对</button>
      </div>`;
    }
  } else if (status === 'rejected') {
    voteActions = `<div style="padding:16px;background:rgba(160,74,58,.06);border-radius:var(--r-control);text-align:center"><p style="font-size:.88rem;color:var(--danger);margin-bottom:12px">截止时未达通过门槛，提案未通过</p><button class="btn btn-gold btn-sm" onclick="repropose('${p.id}')">一键重新发起</button></div>`;
  } else if (status === 'withdrawn') {
    voteActions = `<div style="padding:16px;background:rgba(107,104,96,.06);border-radius:var(--r-control);text-align:center;font-size:.88rem;color:var(--muted);font-weight:600">提案已被发起人撤回</div>`;
  } else {
    voteActions = `<div style="padding:16px;background:rgba(58,122,74,.06);border-radius:var(--r-control);text-align:center;font-size:.88rem;color:var(--success);font-weight:600">✓ 决议已生效，提案归档（只读）</div>`;
  }

  const votersHtml = (p.voters || []).map(v => {
    const st = v.vote === 'yes' ? '<span class="voter-status yes">通过</span>' : v.vote === 'no' ? '<span class="voter-status no">反对</span>' : '<span class="voter-status pending">未表决</span>';
    const reasonImgs = (v.reasonImages && v.reasonImages.length) ? `<div class="voter-reason-imgs">${v.reasonImages.map(src => `<img src="${src}" alt="理由配图" onclick="window.open(this.src)">`).join('')}</div>` : '';
    const avatarStyle = v.avatar?.startsWith('http') ? `background-image:url(${v.avatar});background-size:cover;background-position:center` : `background:${v.avatar}`;
    return `<div class="voter-row"><div class="voter-avatar" style="${avatarStyle}">${v.avatar?.startsWith('http') ? '' : v.name[0]}</div><div class="voter-info"><div class="voter-name">${v.name}</div>${v.reason ? `<div class="voter-reason">"${v.reason}"</div>` : ''}${reasonImgs}</div>${st}</div>`;
  }).join('');

  const creatorName = p.voters?.find(v => v.userId === p.creatorId)?.name || state.currentUser.name;

  document.getElementById('proposalDetailContent').innerHTML = `
    <div class="detail-header">
      <div class="dh-top"><div><div style="margin-bottom:10px"><span class="tag tag-dark">${typeIcon[p.type]} ${typeLabel[p.type]}</span></div><h1>${p.title}</h1></div>${statusHeader}</div>
      <div class="detail-meta"><span class="dm-item"><svg width="14" height="14" viewBox="0 0 256 256" fill="currentColor"><path d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216Zm64-88a8,8,0,0,1-8,8H128a8,8,0,0,1-8-8V72a8,8,0,0,1,16,0v48h48A8,8,0,0,1,192,128Z"/></svg> ${p.amount}</span><span class="dm-item"><svg width="14" height="14" viewBox="0 0 256 256" fill="currentColor"><path d="M117.25,157.92a60,60,0,1,0-66.5,0A95.83,95.83,0,0,0,3.53,195.63a8,8,0,1,0,13.4,8.74,80,80,0,0,1,134.14,0,8,8,0,0,0,13.4-8.74A95.83,95.83,0,0,0,117.25,157.92Z"/></svg> ${total} 名董事</span><span class="dm-item">发起人 ${creatorName}</span></div>
      ${p.desc ? `<div class="detail-desc">${p.desc}</div>` : ''}
      ${p.images && p.images.length ? `<div class="detail-images">${p.images.map(src => `<img src="${src}" alt="提案配图" onclick="window.open(this.src)">`).join('')}</div>` : ''}
    </div>
    <div class="vote-panel">
      <h3>表决进度</h3>
      <div class="vote-result-bar"><div class="vr-yes" style="width:${yesPct}%">${p.yes} 通过</div><div class="vr-no" style="width:${Math.max(noPct, 8)}%">${p.no} 反对</div></div>
      <div class="vote-stats"><span>参与率 <strong>${Math.round((p.yes + p.no) / total * 100)}%</strong></span><span>通过率 <strong>${p.yes + p.no > 0 ? Math.round(p.yes / (p.yes + p.no) * 100) : 0}%</strong></span><span>待表决 <strong>${pending}</strong> 人</span></div>
      ${voteActions}
    </div>
    <div class="card" style="padding:24px 28px"><h3 style="font-size:1rem;font-weight:700;margin-bottom:16px">${opinionTitle}</h3><div class="voter-list">${votersHtml}</div></div>
    ${status === 'voting' && p.creatorId === state.currentUser.id ? `<div style="margin-top:16px;text-align:right"><button class="btn btn-danger btn-sm" onclick="withdrawProposal('${p.id}')">撤回提案</button></div>` : ''}
  `;
}

/* ═══════════════════════════════════════════════════════════════
   6. 投票 & 提案操作
   ═══════════════════════════════════════════════════════════════ */

function confirmChangeVote(id, vote) {
  const oldVote = state.userVotes[id];
  const newLabel = vote === 'yes' ? '通过' : '反对';
  const oldLabel = oldVote === 'yes' ? '通过' : '反对';
  showModal(`<h3>是否要修改意见？</h3><p class="modal-sub">你当前投的是「${oldLabel}」，确认改为「${newLabel}」吗？修改后原票数将同步更新。</p><div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">取消</button><button class="btn btn-gold" onclick="closeModal();castVote('${id}','${vote}',true)">确认修改</button></div>`);
}

function castVote(id, vote, isChange) {
  state.voteReasonImages = [];
  const isYes = vote === 'yes';
  const title = isChange ? (isYes ? '修改为通过（补充理由可选）' : '修改为反对（补充理由可选）') : (isYes ? '补充通过理由（可选）' : '补充反对理由（可选）');
  const placeholder = isYes ? '说说为什么赞成...' : '说说为什么不赞成...';
  const btnClass = isYes ? 'btn-gold' : 'btn-danger';
  const btnText = isChange ? (isYes ? '确认改为通过' : '确认改为反对') : (isYes ? '确认通过' : '确认反对');
  showModal(`<h3>${title}</h3><p class="modal-sub">填写理由可以帮助发起人理解你的想法，让决策更有建设性。也可以直接提交不填理由。</p><textarea class="input-field" id="voteReason" placeholder="${placeholder}" style="min-height:80px"></textarea><div style="margin-top:14px"><div class="img-upload-zone" onclick="document.getElementById('voteImageInput').click()" style="padding:14px"><svg width="22" height="22" viewBox="0 0 256 256" fill="currentColor"><path d="M216,40H40A16,16,0,0,0,24,56V200a16,16,0,0,0,16,16H216a16,16,0,0,0,16-16V56A16,16,0,0,0,216,40Zm0,160H40V56H216V200ZM160,96a8,8,0,0,1,8-8h32a8,8,0,0,1,0,16H168A8,8,0,0,1,160,96Zm-32,16a32,32,0,1,0,32,32A32,32,0,0,0,128,112Zm0,48a16,16,0,1,1,16-16A16,16,0,0,1,128,160Z"/></svg><div class="uz-text" style="font-size:.8rem">添加理由配图（最多3张）</div></div><input type="file" id="voteImageInput" accept="image/jpeg,image/png,image/gif" multiple style="display:none" onchange="handleVoteImages(event)"><div class="img-preview-grid" id="voteImagePreview" style="grid-template-columns:repeat(3,1fr)"></div></div><div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">取消</button><button class="btn btn-ghost" onclick="confirmVote('${id}','${vote}')">直接提交</button><button class="btn ${btnClass}" onclick="confirmVote('${id}','${vote}')">${btnText}</button></div>`);
}

async function confirmVote(id, vote) {
  const reason = document.getElementById('voteReason')?.value || '';
  const reasonImages = [...state.voteReasonImages];

  // 先 upsert 投票
  const { data: voteData, error: voteError } = await supabase
    .from('votes')
    .upsert({ proposal_id: id, user_id: state.currentUser.id, vote, reason }, { onConflict: 'proposal_id,user_id' })
    .select()
    .single();
  if (voteError) { toast(voteError.message, 'danger'); return; }

  // 上传理由图片
  for (const imgData of reasonImages) {
    await uploadImage(imgData, 'proposal-images', `votes/${voteData.id}/${Date.now()}.jpg`, 'vote_images', { vote_id: voteData.id });
  }

  state.userVotes[id] = vote;
  state.voteReasonImages = [];
  closeModal();
  toast(state.userVotes[id] ? `已修改为「${vote === 'yes' ? '通过' : '反对'}」票` : `已投「${vote === 'yes' ? '通过' : '反对'}」票`, 'success');

  // 重新加载提案数据
  await loadProposals();
  const p = cache.proposals.find(x => x.id === id);
  if (p) renderProposalDetail(p, 'voting');
  updateBoardContext();
}

function repropose(id) {
  const p = cache.history.find(x => x.id === id);
  toast(`已复制「${p.title}」为新提案`, 'success');
  setTimeout(() => go('create-proposal'), 500);
}

function withdrawProposal(id) {
  showModal(`<h3>确认撤回提案？</h3><p class="modal-sub">撤回后提案将移入"已撤回"归档，当前投票记录将保留。你可以随时重新发起。</p><div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">再想想</button><button class="btn btn-danger" onclick="confirmWithdraw('${id}')">确认撤回</button></div>`);
}

async function confirmWithdraw(id) {
  const { error } = await supabase
    .from('proposals')
    .update({ status: 'withdrawn' })
    .eq('id', id);
  if (error) { toast(error.message, 'danger'); return; }
  closeModal();
  toast('提案已撤回', 'success');
  setTimeout(() => go('board-home'), 500);
}

/* ═══════════════════════════════════════════════════════════════
   7. 图片上传（Supabase Storage）
   ═══════════════════════════════════════════════════════════════ */

async function uploadImage(base64Data, bucket, path, table, extraFields) {
  try {
    // base64 转 blob
    const res = await fetch(base64Data);
    const blob = await res.blob();

    // 上传到 Storage
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from(bucket)
      .upload(path, blob, { contentType: 'image/jpeg', upsert: true });
    if (uploadError) throw uploadError;

    // 获取公开 URL
    const { data: { publicUrl } } = supabase.storage.from(bucket).getPublicUrl(path);

    // 写入数据库记录
    const insertData = { storage_path: path, public_url: publicUrl, ...extraFields };
    const { error: dbError } = await supabase.from(table).insert(insertData);
    if (dbError) throw dbError;

    return publicUrl;
  } catch (e) {
    console.error('上传失败:', e);
    toast('图片上传失败: ' + e.message, 'danger');
    return null;
  }
}

function handlePropImages(e) {
  const files = Array.from(e.target.files);
  const remaining = 3 - state.proposalImages.length;
  if (files.length > remaining) { toast(`最多上传3张图片，还可添加${remaining}张`, 'info'); }
  files.slice(0, remaining).forEach(file => {
    if (file.size > 5 * 1024 * 1024) { toast(`${file.name}超过5MB，已跳过`, 'info'); return; }
    const reader = new FileReader();
    reader.onload = ev => { state.proposalImages.push(ev.target.result); renderPropImagePreview(); };
    reader.readAsDataURL(file);
  });
  e.target.value = '';
}

function renderPropImagePreview() {
  const grid = document.getElementById('propImagePreview');
  if (!grid) return;
  grid.innerHTML = state.proposalImages.map((src, i) => `
    <div class="img-preview-item">
      <img src="${src}" alt="配图${i + 1}">
      <button class="img-preview-remove" onclick="removePropImage(${i})">×</button>
    </div>`).join('');
}

function removePropImage(i) { state.proposalImages.splice(i, 1); renderPropImagePreview(); }

function handleVoteImages(e) {
  const files = Array.from(e.target.files);
  const remaining = 3 - state.voteReasonImages.length;
  if (files.length > remaining) { toast(`最多上传3张图片，还可添加${remaining}张`, 'info'); }
  files.slice(0, remaining).forEach(file => {
    if (file.size > 5 * 1024 * 1024) { toast(`${file.name}超过5MB，已跳过`, 'info'); return; }
    const reader = new FileReader();
    reader.onload = ev => { state.voteReasonImages.push(ev.target.result); renderVoteImagePreview(); };
    reader.readAsDataURL(file);
  });
  e.target.value = '';
}

function renderVoteImagePreview() {
  const grid = document.getElementById('voteImagePreview');
  if (!grid) return;
  grid.innerHTML = state.voteReasonImages.map((src, i) => `
    <div class="img-preview-item">
      <img src="${src}" alt="理由配图${i + 1}">
      <button class="img-preview-remove" onclick="removeVoteImage(${i})">×</button>
    </div>`).join('');
}

function removeVoteImage(i) { state.voteReasonImages.splice(i, 1); renderVoteImagePreview(); }

/* ═══════════════════════════════════════════════════════════════
   8. 发起提案
   ═══════════════════════════════════════════════════════════════ */

function selectType(el, type) { document.querySelectorAll('.type-option').forEach(o => o.classList.remove('selected')); el.classList.add('selected'); state.selectedType = type; }
function selectDeadline(el, val) { document.querySelectorAll('.deadline-opt').forEach(o => o.classList.remove('selected')); el.classList.add('selected'); state.selectedDeadline = val; }
document.addEventListener('input', function (e) { if (e.target.id === 'propTitle') document.getElementById('titleCount').textContent = e.target.value.length + '/50'; });

async function submitProposal() {
  const title = document.getElementById('propTitle').value.trim();
  if (!title) { toast('请填写提案标题', 'info'); return; }

  const amount = document.getElementById('propAmount').value;
  const desc = document.getElementById('propDesc').value;
  const hoursMap = { '1h': 1, '6h': 6, '24h': 24, '48h': 48 };
  const deadlineAt = new Date(Date.now() + (hoursMap[state.selectedDeadline] || 24) * 3600000).toISOString();

  // 创建提案
  const { data: prop, error } = await supabase
    .from('proposals')
    .insert({
      board_id: state.currentBoardId,
      creator_id: state.currentUser.id,
      type: state.selectedType,
      title,
      amount: amount ? ('¥' + amount) : (state.selectedType === 'travel' ? '待定' : '—'),
      description: desc,
      deadline_hours: hoursMap[state.selectedDeadline] || 24,
      deadline_at: deadlineAt,
    })
    .select()
    .single();
  if (error) { toast(error.message, 'danger'); return; }

  // 上传提案配图
  for (const imgData of state.proposalImages) {
    await uploadImage(imgData, 'proposal-images', `proposals/${prop.id}/${Date.now()}.jpg`, 'proposal_images', { proposal_id: prop.id });
  }

  // 给所有成员发通知
  for (const m of cache.members) {
    if (m.userId !== state.currentUser.id) {
      await supabase.from('notifications').insert({
        user_id: m.userId, board_id: state.currentBoardId, type: 'vote',
        title: '新提案待表决', detail: `「${title}」已发起，请尽快投票。`,
      });
    }
  }

  toast(`提案发布成功！已通知 ${cache.members.length - 1} 名董事`, 'success');

  // 重置表单
  document.getElementById('propTitle').value = '';
  document.getElementById('propAmount').value = '';
  document.getElementById('propDesc').value = '';
  document.getElementById('titleCount').textContent = '0/50';
  state.proposalImages = [];
  renderPropImagePreview();

  // 跳转详情
  await loadProposals();
  updateBoardContext();
  setTimeout(() => openProposal(prop.id), 600);
}

/* ═══════════════════════════════════════════════════════════════
   9. 成员管理 & 邀请
   ═══════════════════════════════════════════════════════════════ */

function renderMembers() {
  const grid = document.getElementById('memberGrid');
  grid.innerHTML = cache.members.map(m => {
    const avatarStyle = m.avatar?.startsWith('http') ? `background-image:url(${m.avatar});background-size:cover;background-position:center` : `background:${m.avatar}`;
    return `<div class="member-card">
      <div class="mc-avatar" style="${avatarStyle}">${m.avatar?.startsWith('http') ? '' : m.name[0]}</div>
      <div class="mc-info">
        <div class="mc-name">${m.name} ${m.role === '创建者' ? '<span class="tag tag-gold" style="font-size:.6rem;padding:1px 6px">创建者</span>' : ''}</div>
        <div class="mc-role">${m.level} ${LEVELS.find(l => l.lv === m.level)?.title || '董事'}</div>
        <div class="mc-joined">加入于 ${m.joined} · 发起 ${m.proposalsCount} 次提案</div>
      </div>
      ${m.userId !== state.currentUser.id && cache.currentBoard?.creator_id === state.currentUser.id ? `<button class="mc-remove" onclick="removeMember('${m.userId}')" title="移除成员"><svg width="16" height="16" viewBox="0 0 256 256" fill="currentColor"><path d="M213.66,101.66l-80,80a8,8,0,0,1-11.32,0l-80-80A8,8,0,0,1,53.66,90.34L128,164.69l74.34-74.35a8,8,0,0,1,11.32,11.32Z"/></svg></button>` : ''}
    </div>`;
  }).join('');
}

function removeMember(userId) {
  const m = cache.members.find(x => x.userId === userId);
  showModal(`<h3>移除成员</h3><p class="modal-sub">确定要将 <strong>${m.name}</strong> 移出「${cache.currentBoard.name}」吗？移除后该成员将失去访问权，历史记录对本人仍可读。</p><div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">取消</button><button class="btn btn-danger" onclick="confirmRemove('${userId}')">确认移除</button></div>`);
}

async function confirmRemove(userId) {
  const { error } = await supabase
    .from('board_members')
    .delete()
    .eq('board_id', state.currentBoardId)
    .eq('user_id', userId);
  if (error) { toast(error.message, 'danger'); return; }
  closeModal();
  toast('成员已移除', 'success');
  await loadMembers();
  renderMembers();
  updateBoardContext();
}

function renderInvite() {
  document.getElementById('inviteCodeDisplay').textContent = cache.currentBoard?.invite_code || '—';
  const baseUrl = window.location.origin + window.location.pathname;
  document.getElementById('inviteLinkInput').value = baseUrl + '?invite=' + (cache.currentBoard?.invite_code || '');
}

function copyLink() {
  const input = document.getElementById('inviteLinkInput');
  input.select();
  navigator.clipboard.writeText(input.value).then(() => {
    toast('邀请链接已复制到剪贴板', 'success');
  }).catch(() => {
    document.execCommand('copy');
    toast('邀请链接已复制到剪贴板', 'success');
  });
}

function resetInvite() {
  showModal(`<h3>重置邀请链接？</h3><p class="modal-sub">重置后当前邀请链接和邀请码将立即失效，需要重新生成并分享给新成员。已加入的成员不受影响。</p><div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">取消</button><button class="btn btn-danger" onclick="doResetInvite()">确认重置</button></div>`);
}

async function doResetInvite() {
  const newCode = 'PALM-' + Math.random().toString(36).substr(2, 4).toUpperCase();
  const { error } = await supabase
    .from('boards')
    .update({ invite_code: newCode })
    .eq('id', state.currentBoardId);
  if (error) { toast(error.message, 'danger'); return; }
  cache.currentBoard.invite_code = newCode;
  closeModal();
  renderInvite();
  toast('邀请链接已重置', 'success');
}

function checkInviteInUrl() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('invite');
  if (code) {
    state.pendingInvite = { inviteCode: code.toUpperCase() };
    const banner = document.getElementById('inviteBanner');
    if (banner) {
      banner.style.display = 'block';
      document.getElementById('inviteBannerName').textContent = '受邀董事会';
    }
  }
}

async function joinBoardByCode(code) {
  const { data: board, error } = await supabase
    .from('boards')
    .select('*')
    .eq('invite_code', code)
    .single();
  if (error || !board) { toast('邀请码无效', 'danger'); return false; }

  // 检查是否已加入
  const { data: existing } = await supabase
    .from('board_members')
    .select('*')
    .eq('board_id', board.id)
    .eq('user_id', state.currentUser.id);
  if (existing && existing.length > 0) {
    state.currentBoardId = board.id;
    return true;
  }

  // 加入
  const { error: joinError } = await supabase
    .from('board_members')
    .insert({ board_id: board.id, user_id: state.currentUser.id, role: '成员', level: 'L1' });
  if (joinError) { toast(joinError.message, 'danger'); return false; }

  state.currentBoardId = board.id;
  toast(`已成功加入「${board.name}」`, 'success');
  return true;
}

function simulateFriendJoin() {
  const b = cache.currentBoard;
  const baseUrl = window.location.origin + window.location.pathname;
  const link = baseUrl + '?invite=' + b.invite_code;
  showModal(`<h3>分享邀请链接</h3><p class="modal-sub">将以下链接发送给好友，好友点击后注册即可自动加入「${b.name}」。</p><div class="invite-link"><input type="text" readonly value="${link}"><button class="btn btn-primary btn-sm" onclick="navigator.clipboard.writeText('${link}');toast('已复制','success')">复制</button></div><div class="modal-actions"><button class="btn btn-gold" onclick="closeModal()">完成</button></div>`);
}

/* ═══════════════════════════════════════════════════════════════
   10. 个人中心 & 资料
   ═══════════════════════════════════════════════════════════════ */

async function renderProfile() {
  // 我的董事会列表（需要加载每个董事会的成员信息）
  const myBoardsHtml = await Promise.all(cache.boards.map(async bd => {
    const { data: members } = await supabase
      .from('board_members')
      .select('*, profiles(name)')
      .eq('board_id', bd.id);
    const me = members?.find(m => m.user_id === state.currentUser.id);
    const isCurrent = bd.id === state.currentBoardId;
    const total = await supabase.from('proposals').select('*', { count: 'exact', head: true }).eq('board_id', bd.id);
    return `<div class="my-board-card" onclick="switchBoard('${bd.id}');go('board-home')">
      <span class="mb-dot" style="background:${bd.dot_color}"></span>
      <div class="mb-info">
        <div class="mb-name">${bd.name}${bd.creator_id === state.currentUser.id ? '<span class="tag tag-muted" style="font-size:.6rem;padding:1px 6px">我创建的</span>' : ''}${isCurrent ? '<span class="mb-current">当前</span>' : ''}</div>
        <div class="mb-meta">${members?.length || 0} 名成员 · ${total.count || 0} 份提案 · 加入于 ${me?.joined_at?.slice(0, 10) || '—'}</div>
      </div>
      <div class="mb-level">
        <div class="mbl-tag">${me?.level || 'L1'} ${LEVELS.find(l => l.lv === me?.level)?.title || '董事'}</div>
        <div class="mbl-role">${me?.proposals_count || 0} 次提案 · ${me?.pass_rate || 0}% 通过率</div>
      </div>
    </div>`;
  }));
  document.getElementById('myBoardsList').innerHTML = myBoardsHtml.join('');

  // 当前董事会职级
  const b = cache.currentBoard;
  const me = cache.members.find(m => m.userId === state.currentUser.id);
  const myLevel = me?.level || 'L1';
  const myCount = me?.proposalsCount || 0;
  const myRate = me?.passRate || 0;

  const plEl = document.getElementById('profileCurrentLevel');
  if (plEl) plEl.innerHTML = `<svg width="14" height="14" viewBox="0 0 256 256" fill="currentColor"><path d="M232,64H208V48a8,8,0,0,0-8-8H56a8,8,0,0,0-8,8V64H24A16,16,0,0,0,8,80V96a40,40,0,0,0,40,40h3.65A80.13,80.13,0,0,0,120,191.61V216H96a8,8,0,0,0,0,16h64a8,8,0,0,0,0-16H136V191.58c31.94-3.23,58.44-25.64,68.08-55.58H208a40,40,0,0,0,40-40V80A16,16,0,0,0,232,64Z"/></svg>当前董事会：${myLevel} ${LEVELS.find(l => l.lv === myLevel)?.title || '董事'}`;

  const curIdx = LEVELS.findIndex(l => l.lv === myLevel);
  const next = LEVELS[curIdx + 1];
  if (next) {
    document.getElementById('levelFromTo').textContent = `${myLevel} ${LEVELS[curIdx].title} → ${next.lv} ${next.title}`;
    document.getElementById('levelGap').textContent = myCount >= next.minCount ? `通过率还差 ${Math.max(0, next.minRate - myRate)}%` : `距 ${next.lv} 还差 ${next.minCount - myCount} 次提案`;
    const pct = Math.min(100, Math.round(myCount / next.minCount * 100));
    document.getElementById('levelFill').style.width = pct + '%';
    document.getElementById('levelThreshold').innerHTML = `<strong style="color:var(--accent-dark)">下一级门槛（${next.lv} ${next.title}）：</strong>本董事会内累计已出决议提案 ≥ ${next.minCount} 次（当前 ${myCount} 次）且通过率 ≥ ${next.minRate}%（当前 ${myRate}%）。达标后系统提示确认升级。`;
  } else {
    document.getElementById('levelFromTo').textContent = `${myLevel} ${LEVELS[curIdx].title}（最高级）`;
    document.getElementById('levelGap').textContent = '已达最高职级';
    document.getElementById('levelFill').style.width = '100%';
    document.getElementById('levelThreshold').innerHTML = `<strong style="color:var(--accent-dark)">恭喜！</strong>你已达到最高职级 L6 董事局主席。`;
  }
  document.getElementById('levelCards').innerHTML = LEVELS.map((l, i) => `
    <div class="level-card-mini ${i < curIdx ? 'reached' : ''} ${i === curIdx ? 'current' : ''}">
      <div class="lcm-lv">${l.lv}</div><div class="lcm-title">${l.title}</div>
    </div>`).join('');

  // 全局统计
  let totalProps = 0, createdBoards = 0;
  for (const bd of cache.boards) {
    const m = cache.members.find(x => x.userId === state.currentUser.id);
    if (m) totalProps += m.proposalsCount;
    if (bd.creator_id === state.currentUser.id) createdBoards++;
  }
  document.getElementById('profileTotalProposals').textContent = totalProps;
  document.getElementById('profileBoardsCount').textContent = createdBoards;
  document.getElementById('profileName').textContent = state.currentUser.name;

  // 头像
  const av = document.getElementById('profileAvatar');
  if (av) {
    if (state.currentUser.avatar_url) {
      av.style.backgroundImage = `url(${state.currentUser.avatar_url})`;
      av.style.backgroundSize = 'cover';
      av.style.backgroundPosition = 'center';
      av.textContent = '';
    } else {
      av.style.backgroundImage = '';
      av.textContent = state.currentUser.name[0];
    }
  }

  // 表单
  document.getElementById('editName').value = state.currentUser.name;
  document.getElementById('editEmail').value = state.currentUser.email;
  document.getElementById('editPhone').value = state.currentUser.phone || '';
}

async function handleAvatarUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) { toast('头像图片不能超过 5MB', 'info'); return; }

  const reader = new FileReader();
  reader.onload = async ev => {
    const base64 = ev.target.result;
    // 上传到 Supabase Storage
    const path = `avatars/${state.currentUser.id}/${Date.now()}.jpg`;
    const res = await fetch(base64);
    const blob = await res.blob();
    const { error } = await supabase.storage.from('avatars').upload(path, blob, { contentType: 'image/jpeg', upsert: true });
    if (error) { toast('头像上传失败', 'danger'); return; }
    const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(path);

    // 更新 profile
    await supabase.from('profiles').update({ avatar_url: publicUrl }).eq('id', state.currentUser.id);
    state.currentUser.avatar_url = publicUrl;

    updateNavAvatar();
    const av = document.getElementById('profileAvatar');
    if (av) { av.style.backgroundImage = `url(${publicUrl})`; av.style.backgroundSize = 'cover'; av.style.backgroundPosition = 'center'; av.textContent = ''; }
    const av2 = document.getElementById('accountAvatar');
    if (av2) { av2.style.backgroundImage = `url(${publicUrl})`; av2.style.backgroundSize = 'cover'; av2.style.backgroundPosition = 'center'; av2.textContent = ''; }
    toast('头像已更新', 'success');
  };
  reader.readAsDataURL(file);
  e.target.value = '';
}

async function saveProfile() {
  const name = document.getElementById('editName').value.trim();
  const email = document.getElementById('editEmail').value.trim();
  const phone = document.getElementById('editPhone').value.trim();
  if (!name) { toast('昵称不能为空', 'info'); return; }
  if (!email || !email.includes('@')) { toast('请输入有效的邮箱', 'info'); return; }

  // 更新 profile
  const { error } = await supabase.from('profiles').update({ name, phone }).eq('id', state.currentUser.id);
  if (error) { toast(error.message, 'danger'); return; }

  // 更新邮箱（如果变了）
  if (email !== state.currentUser.email) {
    const { error: emailError } = await supabase.auth.updateUser({ email });
    if (emailError) { toast(emailError.message, 'danger'); return; }
    toast('邮箱验证链接已发送，请查收', 'info');
  }

  // 密码修改
  const oldPwd = document.getElementById('editOldPwd').value;
  const newPwd = document.getElementById('editNewPwd').value;
  const confirmPwd = document.getElementById('editConfirmPwd').value;
  if (oldPwd || newPwd || confirmPwd) {
    if (!newPwd || newPwd.length < 6) { toast('新密码至少 6 位', 'info'); return; }
    if (newPwd !== confirmPwd) { toast('两次输入的新密码不一致', 'info'); return; }
    const { error: pwdError } = await supabase.auth.updateUser({ password: newPwd });
    if (pwdError) { toast(pwdError.message, 'danger'); return; }
  }

  state.currentUser.name = name;
  state.currentUser.email = email;
  state.currentUser.phone = phone;
  document.getElementById('profileName').textContent = name;
  updateNavAvatar();
  updateBoardContext();
  toast('资料已保存', 'success');
}

function resetProfileForm() { renderProfile(); toast('已重置为当前资料', 'info'); }

function renderAccount() {
  document.getElementById('acctName').value = state.currentUser.name;
  document.getElementById('acctEmail').value = state.currentUser.email;
  document.getElementById('acctPhone').value = state.currentUser.phone || '';
  document.getElementById('accountName').textContent = state.currentUser.name;
  const av = document.getElementById('accountAvatar');
  if (av) {
    if (state.currentUser.avatar_url) { av.style.backgroundImage = `url(${state.currentUser.avatar_url})`; av.style.backgroundSize = 'cover'; av.style.backgroundPosition = 'center'; av.textContent = ''; }
    else { av.style.backgroundImage = ''; av.textContent = state.currentUser.name[0]; }
  }
}

async function saveAccount() {
  const name = document.getElementById('acctName').value.trim();
  const email = document.getElementById('acctEmail').value.trim();
  const phone = document.getElementById('acctPhone').value.trim();
  if (!name) { toast('昵称不能为空', 'info'); return; }

  await supabase.from('profiles').update({ name, phone }).eq('id', state.currentUser.id);
  state.currentUser.name = name;
  state.currentUser.phone = phone;

  const oldPwd = document.getElementById('acctOldPwd').value;
  const newPwd = document.getElementById('acctNewPwd').value;
  const confirmPwd = document.getElementById('acctConfirmPwd').value;
  if (oldPwd || newPwd || confirmPwd) {
    if (!newPwd || newPwd.length < 6) { toast('新密码至少 6 位', 'info'); return; }
    if (newPwd !== confirmPwd) { toast('两次输入的新密码不一致', 'info'); return; }
    await supabase.auth.updateUser({ password: newPwd });
  }

  document.getElementById('accountName').textContent = name;
  updateNavAvatar(); updateBoardContext();
  toast('资料已保存', 'success');
}

function resetAccountForm() { renderAccount(); toast('已重置为当前资料', 'info'); }

/* ═══════════════════════════════════════════════════════════════
   11. 职级 & 我的董事会
   ═══════════════════════════════════════════════════════════════ */

let levelViewBoardId = null;
function renderMyLevel() {
  if (!levelViewBoardId) levelViewBoardId = state.currentBoardId;
  const b = cache.boards.find(x => x.id === levelViewBoardId);
  if (!b) return;
  const me = cache.members.find(x => x.userId === state.currentUser.id);
  if (!me) return;
  document.getElementById('levelBoardName').textContent = b.name;
  document.getElementById('levelTitle').textContent = `${me.level} · ${LEVELS.find(l => l.lv === me.level)?.title || ''}`;
  document.getElementById('levelProposals').textContent = me.proposalsCount;
  document.getElementById('levelPassRate').textContent = me.passRate + '%';
  document.getElementById('levelBoardSize').textContent = cache.members.length;

  const curIdx = LEVELS.findIndex(l => l.lv === me.level);
  if (curIdx < LEVELS.length - 1) {
    const next = LEVELS[curIdx + 1];
    document.getElementById('levelProgressTitle').textContent = `晋升进度（目标：${next.lv} ${next.title}）`;
    document.getElementById('levelProgressText').textContent = `${me.proposalsCount} / ${next.minCount} 次提案`;
    const pct = Math.min(100, Math.round(me.proposalsCount / next.minCount * 100));
    document.getElementById('levelProgressFill').style.width = pct + '%';
  } else {
    document.getElementById('levelProgressTitle').textContent = '已达最高职级';
    document.getElementById('levelProgressText').textContent = '董事局主席';
    document.getElementById('levelProgressFill').style.width = '100%';
  }

  document.getElementById('levelTableBody').innerHTML = LEVELS.map(l => {
    const reached = me.proposalsCount >= l.minCount && me.passRate >= l.minRate;
    const isCurrent = l.lv === me.level;
    return `<tr style="border-bottom:1px solid var(--line-light)">
      <td style="padding:12px 14px;font-weight:700">${l.lv}</td>
      <td style="padding:12px 14px">${l.title}</td>
      <td style="padding:12px 14px">≥ ${l.minCount} 次</td>
      <td style="padding:12px 14px">≥ ${l.minRate}%</td>
      <td style="padding:12px 14px">${isCurrent ? '<span class="tag tag-gold" style="font-size:.72rem">当前职级</span>' : reached ? '<span class="tag tag-muted" style="font-size:.72rem">已达成</span>' : '<span class="tag tag-muted" style="font-size:.72rem;opacity:.5">未解锁</span>'}</td>
    </tr>`;
  }).join('');
}

function showLevelBoardSwitcher() {
  const options = cache.boards.map(b => {
    const me = cache.members.find(x => x.userId === state.currentUser.id);
    return `<div class="board-switch-item" onclick="switchLevelView('${b.id}')" style="padding:12px 16px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--line-light)">
      <span><strong>${b.name}</strong><br><span style="font-size:.75rem;color:var(--muted)">${me?.level || ''} · ${LEVELS.find(l => l.lv === me?.level)?.title || ''}</span></span>
      ${b.id === levelViewBoardId ? '<span style="color:var(--accent-dark);font-size:.75rem">当前</span>' : ''}
    </div>`;
  }).join('');
  showModal(`<h3>切换董事会视角</h3><div style="max-height:300px;overflow-y:auto;margin:12px -20px 0">${options}</div><div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">取消</button></div>`);
}

function switchLevelView(boardId) {
  levelViewBoardId = boardId;
  closeModal();
  renderMyLevel();
  toast('已切换职级视角', 'success');
}

let expandedBoardId = null;
async function renderMyBoards() {
  const html = await Promise.all(cache.boards.map(async b => {
    const { data: members } = await supabase.from('board_members').select('*, profiles(name, avatar_url)').eq('board_id', b.id);
    const me = members?.find(m => m.user_id === state.currentUser.id);
    const levelName = LEVELS.find(l => l.lv === me?.level)?.title || '';
    const isCurrent = b.id === state.currentBoardId;
    const expanded = b.id === expandedBoardId;
    const { count: total } = await supabase.from('proposals').select('*', { count: 'exact', head: true }).eq('board_id', b.id);

    const membersHtml = members?.map(m => {
      const av = m.profiles?.avatar_url;
      const avStyle = av?.startsWith('http') ? `background-image:url(${av});background-size:cover;background-position:center` : `background:var(--world)`;
      return `<div style="display:flex;align-items:center;gap:10px;padding:8px 0">
        <div style="width:32px;height:32px;border-radius:50%;${avStyle};color:#fff;display:grid;place-items:center;font-size:.75rem;font-weight:700">${av?.startsWith('http') ? '' : (m.profiles?.name || 'U')[0]}</div>
        <div style="flex:1"><div style="font-size:.85rem;font-weight:600">${m.profiles?.name || '用户'} ${m.role === '创建者' ? '<span style="font-size:.7rem;color:var(--accent-dark)">· 创建者</span>' : ''}</div><div style="font-size:.72rem;color:var(--muted)">${m.level} ${LEVELS.find(l => l.lv === m.level)?.title || ''}</div></div>
      </div>`;
    }).join('') || '';

    return `<div class="card" style="padding:0;margin-bottom:14px;overflow:hidden">
      <div onclick="switchToBoard('${b.id}')" style="padding:20px 24px;cursor:pointer;display:flex;align-items:center;gap:16px;${isCurrent ? 'background:rgba(184,147,90,.04)' : ''}">
        <div style="width:44px;height:44px;border-radius:12px;background:${b.dot_color};display:grid;place-items:center;color:#fff;font-weight:800;font-size:1rem">${b.name[0]}</div>
        <div style="flex:1">
          <div style="display:flex;align-items:center;gap:8px"><strong style="font-size:1rem">${b.name}</strong>${isCurrent ? '<span class="tag tag-gold" style="font-size:.7rem">当前活跃</span>' : ''}</div>
          <div style="font-size:.8rem;color:var(--muted);margin-top:2px">${members?.length || 0} 名成员 · ${total || 0} 份提案</div>
        </div>
        <div style="text-align:right"><span class="tag tag-muted" style="font-size:.75rem">${me?.level || ''} ${levelName}</span></div>
        <div onclick="event.stopPropagation();toggleBoardMembers('${b.id}')" style="cursor:pointer;padding:8px;color:var(--muted);transform:rotate(${expanded ? '180deg' : '0deg'});transition:transform .2s">
          <svg width="18" height="18" viewBox="0 0 256 256" fill="currentColor"><path d="M213.66,101.66l-80,80a8,8,0,0,1-11.32,0l-80-80A8,8,0,0,1,53.66,90.34L128,164.69l74.34-74.35a8,8,0,0,1,11.32,11.32Z"/></svg>
        </div>
      </div>
      ${expanded ? `<div style="padding:0 24px 20px;border-top:1px solid var(--line-light);background:var(--canvas)">
        <div style="font-size:.8rem;font-weight:700;color:var(--muted);margin:14px 0 6px">董事会成员（${members?.length || 0}）</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0 24px">${membersHtml}</div>
      </div>` : ''}
    </div>`;
  }));
  document.getElementById('myBoardsPageList').innerHTML = html.join('');
}

function toggleBoardMembers(boardId) {
  expandedBoardId = expandedBoardId === boardId ? null : boardId;
  renderMyBoards();
}

async function switchToBoard(boardId) {
  state.currentBoardId = boardId;
  levelViewBoardId = boardId;
  await go('board-home');
}

function showJoinBoardModal() {
  showModal(`<h3>加入董事会</h3><p class="modal-sub">输入邀请码加入已有的董事会</p><input class="input-field" id="joinCodeInput" placeholder="例如：PALM-2026" style="margin:12px 0"><div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">取消</button><button class="btn btn-gold" onclick="doJoinBoard()">确认加入</button></div>`);
}

async function doJoinBoard() {
  const code = document.getElementById('joinCodeInput').value.trim().toUpperCase();
  if (!code) { toast('请输入邀请码', 'info'); return; }
  const success = await joinBoardByCode(code);
  if (success) {
    closeModal();
    await loadBoards();
    renderMyBoards();
  }
}

/* ═══════════════════════════════════════════════════════════════
   12. 通知
   ═══════════════════════════════════════════════════════════════ */

const notifIcons = {
  vote: '<svg width="16" height="16" viewBox="0 0 256 256" fill="currentColor"><path d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm45.66,85.66-48,48a8,8,0,0,1-11.32,0l-24-24a8,8,0,0,1,11.32-11.32L120,140.69l42.34-42.35a8,8,0,0,1,11.32,11.32Z"/></svg>',
  deadline: '<svg width="16" height="16" viewBox="0 0 256 256" fill="currentColor"><path d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216Zm64-88a8,8,0,0,1-8,8H128a8,8,0,0,1-8-8V72a8,8,0,0,1,16,0v48h48A8,8,0,0,1,192,128Z"/></svg>',
  member: '<svg width="16" height="16" viewBox="0 0 256 256" fill="currentColor"><path d="M117.25,157.92a60,60,0,1,0-66.5,0A95.83,95.83,0,0,0,3.53,195.63a8,8,0,1,0,13.4,8.74,80,80,0,0,1,134.14,0,8,8,0,0,0,13.4-8.74A95.83,95.83,0,0,0,117.25,157.92ZM56,108a44,44,0,1,1,44,44A44.05,44.05,0,0,1,56,108Zm156.61,66.08a8,8,0,0,1-11.16-2.17,79.82,79.82,0,0,0-33.54-26.27,8,8,0,0,1,8.18-13.94,95.71,95.71,0,0,1,40.15,31.45A8,8,0,0,1,212.61,174.08ZM188,96a36,36,0,1,0-36-36A36,36,0,0,0,188,96Zm0-56a20,20,0,1,1-20,20A20,20,0,0,1,188,40Z"/></svg>',
  level: '<svg width="16" height="16" viewBox="0 0 256 256" fill="currentColor"><path d="M232,64H208V48a8,8,0,0,0-8-8H56a8,8,0,0,0-8,8V64H24A16,16,0,0,0,8,80V96a40,40,0,0,0,40,40h3.65A80.13,80.13,0,0,0,120,191.61V216H96a8,8,0,0,0,0,16h64a8,8,0,0,0,0-16H136V191.58c31.94-3.23,58.44-25.64,68.08-55.58H208a40,40,0,0,0,40-40V80A16,16,0,0,0,232,64Z"/></svg>',
  result: '<svg width="16" height="16" viewBox="0 0 256 256" fill="currentColor"><path d="M229.66,77.66l-128,128a8,8,0,0,1-11.32,0l-56-56a8,8,0,0,1,11.32-11.32L96,188.69,218.34,66.34a8,8,0,0,1,11.32,11.32Z"/></svg>',
};
const notifColors = { vote: 'var(--accent-dark)', deadline: '#C47A3A', member: '#5A7A8A', level: 'var(--accent)', result: 'var(--success)' };

function renderNotifs() {
  document.getElementById('notifList').innerHTML = state.notifications.map(n => `
    <div class="notif-item ${n.unread ? 'unread' : ''}" onclick="showNotifDetail('${n.id}')">
      <span class="ni-dot" style="background:${notifColors[n.type] || 'var(--accent)'}">${notifIcons[n.type] || notifIcons.vote}</span>
      <div class="ni-content"><div class="ni-title">${n.title}</div><div class="ni-time">${n.time}</div></div>
    </div>`).join('');
  const unread = state.notifications.filter(n => n.unread).length;
  const dot = document.getElementById('notifDot');
  if (dot) dot.style.display = unread > 0 ? 'block' : 'none';
}

async function showNotifDetail(id) {
  const n = state.notifications.find(x => x.id === id);
  if (!n) return;
  // 标记已读
  await supabase.from('notifications').update({ unread: false }).eq('id', id);
  n.unread = false;
  renderNotifs();
  document.getElementById('notifPanel').classList.remove('active');
  const boardName = n.boardId ? (cache.boards.find(b => b.id === n.boardId)?.name || '') : '';
  showModal(`<h3>通知详情</h3><div style="margin:12px 0"><span class="tag tag-gold" style="font-size:.7rem">${{ vote: '表决动态', deadline: '截止提醒', member: '成员加入', level: '职级晋升', result: '决议结果' }[n.type] || '通知'}</span>${boardName ? `<span class="tag tag-muted" style="font-size:.7rem;margin-left:6px">${boardName}</span>` : ''}</div><p style="font-size:.92rem;line-height:1.7;color:var(--ink);margin:12px 0">${n.detail || n.title}</p><p style="font-size:.78rem;color:var(--muted)">${n.time}</p><div class="modal-actions"><button class="btn btn-gold" onclick="closeModal()">知道了</button></div>`);
}

async function clearNotifs() {
  await supabase.from('notifications').update({ unread: false }).eq('user_id', state.currentUser.id).eq('unread', true);
  state.notifications.forEach(n => n.unread = false);
  renderNotifs();
  toast('所有通知已标记为已读', 'success');
}

document.addEventListener('click', function (e) {
  const panel = document.getElementById('notifPanel');
  if (!e.target.closest('.notif-panel') && !e.target.closest('.nav-icon-btn')) panel.classList.remove('active');
});

/* ═══════════════════════════════════════════════════════════════
   13. 弹窗 & Toast
   ═══════════════════════════════════════════════════════════════ */

function showModal(html) { document.getElementById('modalContent').innerHTML = html; document.getElementById('modalOverlay').classList.add('active'); }
function closeModal() { document.getElementById('modalOverlay').classList.remove('active'); }
document.getElementById('modalOverlay').addEventListener('click', function (e) { if (e.target === this) closeModal(); });

function toast(msg, type = 'info') {
  const container = document.getElementById('toastContainer');
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.innerHTML = `<span>${type === 'success' ? '✓' : type === 'danger' ? '✗' : 'ℹ'}</span><span>${msg}</span>`;
  container.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateX(20px)'; el.style.transition = 'all .3s'; setTimeout(() => el.remove(), 300); }, 3000);
}

/* ═══════════════════════════════════════════════════════════════
   14. 启动
   ═══════════════════════════════════════════════════════════════ */

handlePasswordRecovery();
initAuth();
