// ============================================================
// BACKEND URL (Railway)
// ============================================================
const BACKEND_URL = 'https://template-auto-production.up.railway.app';

// ============================================================
// AUTH GUARD & ROLE ENFORCEMENT
// ============================================================
const SUPABASE_URL = 'https://ajrtewupbfupxpwwvrcz.supabase.co';
const SUPABASE_KEY = 'sb_publishable_92ZS2ML3dAMDN9inMpjwqA_her1Be4K';
const _sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// Roles: 'super_admin' | 'sales_manager'
window.currentUser = null;

(async function initAuth() {
    // Race against a 3s timeout so the app never hangs if Supabase auth is slow/unreachable
    const timeout = new Promise(resolve =>
        setTimeout(() => resolve({ data: { session: null } }), 3000)
    );
    const { data: { session } } = await Promise.race([_sb.auth.getSession(), timeout]);

    let role, fullName, email, userId;

    if (!session) {
        // No session — redirect to login. Timeout above ensures this is fast.
        window.location.replace('login.html');
        return;
    }

    // Fetch role from profiles table
    const { data: profile } = await _sb
        .from('profiles')
        .select('role, full_name, email')
        .eq('id', session.user.id)
        .single();

    role     = profile?.role      || 'super_admin';
    fullName = profile?.full_name || session.user.email.split('@')[0];
    email    = profile?.email     || session.user.email;
    userId   = session.user.id;

    window.currentUser = { id: userId, email, role, fullName };

    // ── Populate header ──────────────────────────────────────────────────────
    const displayName = document.getElementById('userDisplayName');
    const roleBadge   = document.getElementById('userRoleBadge');
    const avatar      = document.getElementById('userAvatar');

    if (displayName) displayName.textContent = fullName;
    if (avatar)      avatar.textContent       = fullName.charAt(0).toUpperCase();
    if (roleBadge) {
        roleBadge.textContent = role === 'super_admin' ? 'Super Admin' : 'Sales Manager';
        roleBadge.style.color = role === 'super_admin' ? '#8b5cf6' : '#6b7280';
    }

    // ── Role-based UI restrictions ──────────────────────────────────────────
    if (role !== 'super_admin') {
        const deleteBtn = document.getElementById('deleteSelectedBtn');
        const uploadBtn = document.getElementById('uploadBtn');
        if (deleteBtn) deleteBtn.style.display = 'none';
        if (uploadBtn) uploadBtn.style.display  = 'none';
    }
})();

// Logout handler
async function handleLogout() {
    await _sb.auth.signOut();
    window.location.replace('login.html');
}

// ============================================================

let globalLeads = [];
let chartInstance = null;
let editingLeadId = null;
let lastDataFingerprint = '';

let currentSearch = '';
let currentCityFilter = 'All';
let currentStatusFilter = 'All';
let currentPriorityFilter = 'All';
let currentServiceFilter = 'All';
let dueTodayMode = false;

let visuallyFilteredLeads = [];
let currentPage = 1;
let selectedLeadIds = new Set();
const itemsPerPage = 20;

// === TOAST NOTIFICATIONS === //
function showToast(msg, type = 'info', duration = 3000) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.textContent = msg;
    container.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity 0.3s'; setTimeout(() => t.remove(), 300); }, duration);
}

document.addEventListener('DOMContentLoaded', () => {
    initNavigation();
    loadData(false);

    let _searchTimer;
    document.getElementById('searchLeads').addEventListener('input', (e) => {
        clearTimeout(_searchTimer);
        _searchTimer = setTimeout(() => {
            currentSearch = e.target.value.toLowerCase();
            dueTodayMode = false;
            applyFilters();
        }, 300);
    });

    document.getElementById('csvUploadInput').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if(!file) return;
        
        const btn = document.getElementById('uploadBtn');
        btn.innerText = 'Processing...';
        
        fetch('/api/upload', {
            method: 'POST',
            body: file,
            headers: { 'Content-Type': 'text/csv' }
        })
        .then(res => res.json())
        .then(data => {
            if(data.error) throw new Error(data.error);
            showToast(`Imported ${data.added} new leads successfully`, 'success');
            btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: middle; margin-right:6px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg> Upload CSV`;
            document.getElementById('csvUploadInput').value = '';
            loadData(false);
        })
        .catch(err => {
            showToast('Upload failed: ' + err, 'error');
            btn.innerHTML = 'Upload CSV';
        });
    });

    setInterval(() => loadData(true), 15000);
});

function initNavigation() {
    const dBtn = document.getElementById('navDashboardBtn');
    const pBtn = document.getElementById('navPipelineBtn');
    const prBtn = document.getElementById('navProfileBtn');
    if(!dBtn || !pBtn) return;

    function showView(view) {
        document.getElementById('dashboardView').style.display = view === 'dashboard' ? 'block' : 'none';
        document.getElementById('pipelineView').style.display  = view === 'pipeline'  ? 'flex'  : 'none';
        document.getElementById('profileView').style.display   = view === 'profile'   ? 'block' : 'none';
        // Header visibility: hide filters + actions in profile view
        const header = document.querySelector('header');
        const filters = document.getElementById('globalFilters');
        if (view === 'profile') {
            if (header)  header.style.display  = 'none';
            if (filters) filters.style.display = 'none';
        } else {
            if (header)  header.style.display  = '';
            if (filters) filters.style.display = '';
        }
        [dBtn, pBtn, prBtn].forEach(b => b && b.classList.remove('active'));
    }

    dBtn.addEventListener('click', (e) => {
        e.preventDefault();
        showView('dashboard');
        dBtn.classList.add('active');
    });

    pBtn.addEventListener('click', (e) => {
        e.preventDefault();
        showView('pipeline');
        pBtn.classList.add('active');
        renderPipeline();
    });

    if (prBtn) {
        prBtn.addEventListener('click', (e) => {
            e.preventDefault();
            showView('profile');
            prBtn.classList.add('active');
            loadProfileView();
        });
    }
}

function toggleMobileFilters() {
    const filters = document.getElementById('globalFilters');
    const toggleBtn = document.querySelector('.mobile-filter-toggle');
    if(!filters) return;
    
    if(filters.classList.contains('mobile-hidden')) {
        filters.classList.remove('mobile-hidden');
        if(toggleBtn) toggleBtn.classList.add('active');
    } else {
        filters.classList.add('mobile-hidden');
        if(toggleBtn) toggleBtn.classList.remove('active');
    }
}

function loadData(isSilentPolling = false) {
    const tbody = document.getElementById('tableBody');
    if(!isSilentPolling) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 40px;">Fetching records...</td></tr>';
    }
    
    // Bulletproof fetch: no `.order` on network layer to bypass SDK column-name-spacing bugs
    fetch('/api/leads')
    .then(res => res.json())
    .then(data => {
        if(data.error) throw new Error(data.error);
        
        const fingerprint = JSON.stringify(data);
        if(isSilentPolling && fingerprint === lastDataFingerprint) {
            return; 
        }
        lastDataFingerprint = fingerprint;

        globalLeads = data || [];
        // Local sort to avoid ".order('Lead ID')" syntax bugs that might break Supabase SDK
        globalLeads.sort((a,b) => {
            const numA = parseInt((a['Lead ID']||'').split('-')[1]) || 0;
            const numB = parseInt((b['Lead ID']||'').split('-')[1]) || 0;
            return numA - numB;
        });

        populateCityFilter(globalLeads); 
        applyFilters(); 
        renderPipeline(); 
    })
    .catch(err => {
        console.error("SUPABASE FETCH ERROR:", err);
        if(!isSilentPolling) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #ef4444; padding: 40px;">Connection failed. Error: <strong>${err.message || err.toString()}</strong></td></tr>`;
        }
    });
}

function populateCityFilter(leads) {
    const citySet = new Set();
    leads.forEach(l => {
        let cityText = 'Unknown';
        if(l.Location) {
            const parts = l.Location.split(',');
            if(parts.length >= 2) {
                let pot = parts[parts.length - 2].trim();
                cityText = pot;
            } else {
                cityText = l.Location.trim();
            }
        }
        l._computedCity = cityText; 
        if(cityText.length > 2 && cityText.length < 50) {
            citySet.add(cityText);
        }
    });

    const select = document.getElementById('filterCity');
    if(!select) return;
    
    const currentVal = select.value;
    select.innerHTML = '<option value="All">All Regions</option>';
    
    const sortedCities = Array.from(citySet).sort();
    sortedCities.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c;
        opt.innerText = c;
        if(c === currentVal) opt.selected = true;
        select.appendChild(opt);
    });
}

function applyFilters() {
    const citySelect = document.getElementById('filterCity');
    const statusSelect = document.getElementById('filterStatus');
    const prioritySelect = document.getElementById('filterPriority');
    const serviceSelect = document.getElementById('filterService');
    
    currentCityFilter = citySelect ? citySelect.value : 'All';
    currentStatusFilter = statusSelect ? statusSelect.value : 'All';
    currentPriorityFilter = prioritySelect ? prioritySelect.value : 'All';
    currentServiceFilter = serviceSelect ? serviceSelect.value : 'All';

    visuallyFilteredLeads = globalLeads.filter(lead => {
        let matchSearch = true;
        if (currentSearch && currentSearch.trim() !== '') {
            matchSearch = 
                (lead.Name && lead.Name.toLowerCase().includes(currentSearch)) || 
                (lead.Phone && lead.Phone.toLowerCase().includes(currentSearch));
        }
            
        const matchCity = (currentCityFilter === 'All') || (lead._computedCity === currentCityFilter);
        
        const leadStatus = lead['Lead Status'] || 'New';
        const matchStatus = (currentStatusFilter === 'All') || (leadStatus === currentStatusFilter);
        
        let priority = lead['Follow-Up Priority (Auto)'] || 'Low';
        let cleanPriority = priority.replace(/[^a-zA-Z]/g, '').trim();
        if(cleanPriority === '') cleanPriority = 'Scheduled';
        const matchPriority = (currentPriorityFilter === 'All') || (cleanPriority === currentPriorityFilter);

        let matchService = true;
        if(currentServiceFilter === 'Needs Website') {
            matchService = (lead['Is Website Poor'] === 'True' || lead['Is Website Poor'] === 'true' || !lead['Website']);
        } else if (currentServiceFilter === 'Has WhatsApp') {
            matchService = (lead['Has WhatsApp'] === 'True' || lead['Has WhatsApp'] === 'true');
        }

        return matchSearch && matchCity && matchStatus && matchPriority && matchService;
    });

    const maxPage = Math.ceil(visuallyFilteredLeads.length / itemsPerPage);
    if(currentPage > maxPage) currentPage = maxPage;
    if(currentPage < 1) currentPage = 1;

    updateDashboard(visuallyFilteredLeads);
    renderChart(visuallyFilteredLeads);
    renderTable();
    
    // Automatically redraw Pipeline Graphics & Cards if matching filters
    if(document.getElementById('pipelineView').style.display !== 'none') {
        renderPipeline();
    }
}

function updateDashboard(leads) {
    document.getElementById('totalLeads').innerText = leads.length.toLocaleString();
    const highPriority = leads.filter(l => l['Follow-Up Priority (Auto)'] && l['Follow-Up Priority (Auto)'].includes('High')).length;
    document.getElementById('highPriorityLeads').innerText = highPriority;
    const hotStr = new Date().toISOString().split('T')[0];
    const dueTodayCount = globalLeads.filter(l => {
        let flag = l['Reminder Flag (Auto)'] || '';
        let nextD = l['Next Follow-Up Date'] || '';
        return flag.includes('DUE TODAY') || nextD.startsWith(hotStr);
    }).length;
    document.getElementById('dueTodayLeads').innerText = dueTodayCount;
    // Update the Due Today badge in filter bar
    const badge = document.getElementById('dueTodayBadge');
    if (badge) {
        badge.textContent = dueTodayCount;
        badge.style.display = dueTodayCount > 0 ? 'inline' : 'none';
    }
    let closedLeads = leads.filter(l => l['Lead Status'] === 'Closed').length;
    let rate = '0%';
    if(leads.length > 0) rate = ((closedLeads / leads.length) * 100).toFixed(1) + '%';
    document.getElementById('conversionRate').innerText = rate;
}

function renderTable() {
    const tbody = document.getElementById('tableBody');
    if(!tbody) return;
    tbody.innerHTML = '';
    
    if(visuallyFilteredLeads.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 40px;">No leads exactly match your filters.</td></tr>';
        updatePagination(1, 1, 0);
        return;
    }

    const totalPages = Math.ceil(visuallyFilteredLeads.length / itemsPerPage);
    updatePagination(currentPage, totalPages, visuallyFilteredLeads.length);

    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const pageLeads = visuallyFilteredLeads.slice(startIndex, endIndex);

    pageLeads.forEach(lead => { 
        let tr = document.createElement('tr');
        
        let priorityText = lead['Follow-Up Priority (Auto)'] || 'Low';
        let badgeClass = 'low';
        if(priorityText.includes('High')) badgeClass = 'high';
        if(priorityText.includes('Medium')) badgeClass = 'medium';

        let cleanPriority = priorityText.replace(/[^a-zA-Z]/g, '').trim();
        if(cleanPriority === '') cleanPriority = 'Scheduled';

        let statusText = lead['Lead Status'] || 'New';
        let region = lead._computedCity || 'Unknown';
        if(region.length > 15) region = region.substring(0, 15) + '..';
        
        let actionsHtml = `<button class="btn-primary" onclick="viewLead('${lead['Lead ID']}')">Edit</button>`;
        if (lead['Demo Site URL']) {
            actionsHtml += `<button class="btn-outline" onclick="window.open('${lead['Demo Site URL']}','_blank')" style="margin-left:8px; border-color:#8b5cf6; color:#8b5cf6; font-weight:600;" title="View live demo site">View Demo</button>`;
            actionsHtml += `<button class="btn-send-demo" onclick="sendDemo('${lead['Lead ID']}')" style="margin-left:8px;" title="Send demo link to lead">Send Demo</button>`;
        } else if (lead['Lead Status'] === 'Demo Requested') {
            const isAdmin = window.currentUser?.role === 'super_admin';
            actionsHtml += isAdmin
                ? `<button class="btn-outline" onclick="confirmDemoGeneration('${lead['Lead ID']}')" style="margin-left:8px; border-color:#8b5cf6; color:#8b5cf6; font-weight:600;" title="Customize and generate demo website">Generate Demo</button>`
                : `<span style="margin-left:8px; padding:5px 10px; border:1px solid #d1d5db; border-radius:6px; font-size:12px; color:#9ca3af; font-weight:500;">Awaiting Demo</span>`;
        }
        if(lead.Phone && lead.Phone.trim().length >= 4) {
             let cleanPhone = lead.Phone.replace(/[^0-9+]/g, '');
             actionsHtml += `<a href="tel:${cleanPhone}" class="btn-success" style="text-decoration:none; margin-left:8px;">Call</a>`;
             actionsHtml += `<a href="https://wa.me/${cleanPhone}" target="_blank" class="btn-outline" style="text-decoration:none; margin-left:8px; color:#25D366; border-color:#25D366;" title="WhatsApp">
                 <svg width="14" height="14" viewBox="0 0 24 24" fill="#25D366" stroke="none"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
             </a>`;
        }

        const isChecked = selectedLeadIds.has(lead['Lead ID']) ? 'checked' : '';
        const safeName = (lead.Name || 'Unnamed Lead').replace(/'/g, "\\'").replace(/"/g, '&quot;');
        tr.innerHTML = `
            <td style="text-align: center;"><input type="checkbox" class="lead-checkbox" value="${lead['Lead ID']}" ${isChecked} onchange="toggleLeadSelection(this)" style="cursor:pointer;"></td>
            <td data-label="Lead Name" onclick="copyTitleAndOpen('${safeName}', '${lead['Lead ID']}')" style="cursor:pointer;" title="Click to copy name and view lead">
                <strong style="color:var(--brand-primary);">${lead.Name || 'Unnamed Lead'}</strong>
            </td>
            <td data-label="Contact"><div style="font-size:13px;">${lead.Phone || lead.Email || 'No info'}</div></td>
            <td data-label="Region"><span style="color:var(--text-muted); font-size: 13px;">${region}</span></td>
            <td data-label="Priority"><span class="badge ${badgeClass}">${cleanPriority}</span></td>
            <td data-label="Status">
                <select class="inline-select" onchange="quickUpdateStatus('${lead['Lead ID']}', this.value)">
                    ${['New','Contacted','Interested','Demo Requested','Not Interested','Closed','Duplicate'].map(s =>
                        `<option value="${s}" ${s===statusText?'selected':''}>${s}</option>`
                    ).join('')}
                </select>
            </td>
            <td data-label="Manage" style="display:flex; justify-content:flex-end;">${actionsHtml}</td>
        `;
        tbody.appendChild(tr);
    });
}

function updatePagination(curr, total, totalCount) {
    const el = document.getElementById('pageIndicator');
    if(!el) return;
    el.innerText = `Page ${curr} of ${total} (${totalCount} hits)`;
    
    const prevBtn = document.getElementById('prevPageBtn');
    const nextBtn = document.getElementById('nextPageBtn');
    
    if (prevBtn) prevBtn.disabled = curr <= 1;
    if (nextBtn) nextBtn.disabled = curr >= total;
}

function changePage(offset) {
    const totalPages = Math.ceil(visuallyFilteredLeads.length / itemsPerPage);
    const newPage = currentPage + offset;
    
    if(newPage >= 1 && newPage <= totalPages) {
        currentPage = newPage;
        renderTable();
    }
}

// === KANBAN PIPELINE LOGIC === //
function renderPipeline() {
    const board = document.getElementById('kanbanBoard');
    if(!board) return;
    if(document.getElementById('pipelineView').style.display === 'none') return;
    board.innerHTML = '';

    const funnelContainer = document.getElementById('pipelineFunnel');
    const columns = [
        { id: 'New', title: 'New', color: 'var(--brand-primary)' },
        { id: 'Contacted', title: 'Contacted', color: '#eab308' },
        { id: 'Interested', title: 'Interested', color: '#84cc16' },
        { id: 'Demo Requested', title: 'Demo Requested', color: '#0ea5e9' },
        { id: 'Not Interested', title: 'Not Interested', color: 'var(--accent-red)' },
        { id: 'Closed', title: 'Closed', color: '#10b981' },
        { id: 'Duplicate', title: 'Duplicate', color: '#8b5cf6' }
    ];

    let counts = {};
    columns.forEach(c => counts[c.id] = 0);
    
    visuallyFilteredLeads.forEach(lead => {
        let st = lead['Lead Status'] || 'New';
        if(counts[st] !== undefined) counts[st]++;
    });

    if(funnelContainer) {
        let funnelHTML = `<div class="pipeline-roadmap">`;
        columns.forEach(c => {
            funnelHTML += `
                <div class="roadmap-step" style="border-top: 3px solid ${c.color};">
                    <span class="roadmap-count">${counts[c.id]}</span>
                    <span class="roadmap-label">${c.id}</span>
                </div>
            `;
        });
        funnelHTML += `</div>`;
        funnelContainer.innerHTML = funnelHTML;
    }
    
    columns.forEach(c => {
        let status = c.id;
        let col = document.createElement('div');
        col.className = 'kanban-column';
        col.setAttribute('ondrop', `dropLead(event, '${status}')`);
        col.setAttribute('ondragover', 'allowDrop(event)');
        
        // Very important bugfix: sync kanban dragging accurately against filters!
        let leadsInStatus = visuallyFilteredLeads.filter(l => (l['Lead Status'] || 'New') === status);
        if(status === 'New') col.classList.add('expanded');
        
        col.innerHTML = `
            <div class="kanban-column-header" onclick="this.parentElement.classList.toggle('expanded')" style="cursor:pointer; user-select:none; border-left: 4px solid ${c.color};">
                <div style="display:flex; align-items:center; gap:8px;">
                    <span style="color: ${c.color};">${c.title}</span>
                    <span class="kanban-count" style="background: ${c.color}; color: #ffffff;">${leadsInStatus.length}</span>
                </div>
                <div class="mobile-chevron">▼</div>
            </div>
            <div class="kanban-cards" id="kcol_${status.replace(' ', '_')}"></div>
        `;
        
        let container = col.querySelector('.kanban-cards');
        
        leadsInStatus.slice(0, 100).forEach(lead => {
            let card = document.createElement('div');
            card.className = 'kanban-card';
            card.draggable = true;
            card.id = `kc_${lead['Lead ID']}`;
            card.setAttribute('ondragstart', `dragLead(event, '${lead['Lead ID']}')`);
            
            let priorityText = lead['Follow-Up Priority (Auto)'] || 'Low';
            let cleanPriority = priorityText.replace(/[^a-zA-Z]/g, '').trim();
            if(cleanPriority === '') cleanPriority = 'Scheduled';
            let badgeClass =  cleanPriority.includes('High') ? 'high' : (cleanPriority.includes('Medium') ? 'medium' : 'low');
            
            let callLink = '';
            let waLink = '';
            if(lead.Phone && lead.Phone.trim().length >= 4) {
                let cleanPhone = lead.Phone.replace(/[^0-9+]/g, '');
                callLink = `<a href="tel:${cleanPhone}" title="Call" style="color:var(--accent-green); text-decoration:none; display:flex; align-items:center;">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>
                </a>`;
                waLink = `<a href="https://wa.me/${cleanPhone}" target="_blank" title="WhatsApp" style="color:#25D366; text-decoration:none; display:flex; align-items:center;">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="#25D366" stroke="none"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                </a>`;
            }

            let searchQuery = encodeURIComponent(lead.Name || lead.Phone || lead.Email || '');
            let searchLink = `<a href="https://www.google.com/search?q=${searchQuery}" target="_blank" title="Search Google" style="color:var(--brand-primary); background:#eff6ff; padding: 4px 8px; border-radius: 4px; text-decoration:none; display:flex; align-items:center; font-size: 11px; font-weight: 600;">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px;"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                Search
            </a>`;

            const safeName = (lead.Name || 'Unnamed').replace(/'/g, "\\'").replace(/"/g, '&quot;');

            card.innerHTML = `
                <div class="kc-title" onclick="copyTitleAndOpen('${safeName}', '${lead['Lead ID']}'); event.stopPropagation();" style="cursor: pointer;" title="Tap to copy name and view lead">${lead.Name || 'Unnamed'}</div>
                <div class="kc-meta" style="margin-bottom: 12px; border-bottom: 1px solid #f3f4f6; padding-bottom: 8px;">${lead.Phone || lead.Email || 'No contact'}</div>
                <div class="kc-footer" style="border-top: none; padding-top: 0;">
                    <span class="badge ${badgeClass}">${cleanPriority}</span>
                    <div style="display:flex; gap:5px; align-items:center; flex-wrap: wrap;">
                        ${lead['Demo Site URL']
                            ? `<button onclick="window.open('${lead['Demo Site URL']}','_blank'); return false;" style="background:#8b5cf6; color:#fff; border:none; border-radius:4px; padding:4px 8px; font-size:12px; font-weight:600; cursor:pointer;" title="View live demo site">View Demo</button>
                               <button onclick="sendDemo('${lead['Lead ID']}'); return false;" style="background:#059669; color:#fff; border:none; border-radius:4px; padding:4px 8px; font-size:12px; font-weight:600; cursor:pointer;" title="Send demo link">Send</button>`
                            : lead['Lead Status'] === 'Demo Requested'
                                ? (window.currentUser?.role === 'super_admin'
                                    ? `<button onclick="confirmDemoGeneration('${lead['Lead ID']}'); return false;" style="background:#8b5cf6; color:#fff; border:none; border-radius:4px; padding:4px 8px; font-size:12px; font-weight:600; cursor:pointer;" title="Customize and generate demo">Generate Demo</button>`
                                    : `<span style="padding:3px 8px; border:1px solid #d1d5db; border-radius:4px; font-size:11px; color:#9ca3af;">Awaiting Demo</span>`)
                                : ''
                        }
                        ${searchLink}
                        ${waLink}
                        ${callLink}
                        <button onclick="viewLead('${lead['Lead ID']}'); return false;" style="background:var(--brand-primary); color:#fff; border:none; border-radius:4px; padding:4px 12px; font-size:12px; font-weight:600; cursor:pointer;">Edit</button>
                    </div>
                </div>
            `;
            container.appendChild(card);
        });
        
        if(leadsInStatus.length > 100) {
            let limitNotice = document.createElement('div');
            limitNotice.style.textAlign = 'center';
            limitNotice.style.fontSize = '11px';
            limitNotice.style.color = 'var(--text-muted)';
            limitNotice.innerText = `+${leadsInStatus.length - 100} more hidden`;
            container.appendChild(limitNotice);
        }

        board.appendChild(col);
    });
}

function allowDrop(ev) {
    ev.preventDefault();
}

function dragLead(ev, id) {
    ev.dataTransfer.setData("leadId", id);
}

function dropLead(ev, targetStatus) {
    ev.preventDefault();
    var leadId = ev.dataTransfer.getData("leadId");
    
    const lead = globalLeads.find(l => l['Lead ID'] === leadId);
    if(!lead || lead['Lead Status'] === targetStatus) return; // Ignore drops into same column

    const leadUpdate = { 'Lead ID': leadId, 'Lead Status': targetStatus };

    // Fire network request. Polling automatically repaints. 
    fetch('/api/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(leadUpdate)
    })
    .then(() => showToast('Status updated', 'success'))
    .catch(e => showToast('Network error updating status', 'error'));
}

// === MODAL === //
function viewLead(id) {
    editingLeadId = id;
    const lead = globalLeads.find(l => l['Lead ID'] === id);
    if(!lead) return;

    let searchQ = encodeURIComponent(lead.Name || lead.Phone || '');
    document.getElementById('modalName').innerHTML = `
        <span style="vertical-align: middle;">${lead.Name || 'Unnamed Lead'}</span>
        <a href="https://www.google.com/search?q=${searchQ}" target="_blank" style="margin-left:12px; font-size:13px; font-weight:600; padding:6px 12px; background:#eff6ff; color:var(--brand-primary); border-radius:6px; text-decoration:none; display:inline-flex; align-items:center; vertical-align: middle;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px;"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>Google Search
        </a>
        <button onclick="shareLead('${id}')" style="margin-left:8px; font-size:13px; font-weight:600; padding:6px 12px; background:#f0fdf4; color:#16a34a; border:none; border-radius:6px; cursor:pointer; display:inline-flex; align-items:center; vertical-align: middle;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px;"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg>Share
        </button>
    `;
    const body = document.getElementById('modalBody');
    
    body.innerHTML = `
        <div class="detail-grid">
            <div class="detail-item"><span class="label">Phone Number</span><input id="editPhone" class="modal-input" value="${lead.Phone || ''}" /></div>
            <div class="detail-item"><span class="label">Email Address</span><input id="editEmail" class="modal-input" value="${lead.Email || ''}" /></div>
            <div class="detail-item"><span class="label">Lead Status</span>
                <select id="editStatus" class="modal-input">
                    <option value="New" ${lead['Lead Status']=='New'?'selected':''}>New</option>
                    <option value="Contacted" ${lead['Lead Status']=='Contacted'?'selected':''}>Contacted</option>
                    <option value="Interested" ${lead['Lead Status']=='Interested'?'selected':''}>Interested</option>
                    <option value="Demo Requested" ${lead['Lead Status']=='Demo Requested'?'selected':''}>Demo Requested</option>
                    <option value="Not Interested" ${lead['Lead Status']=='Not Interested'?'selected':''}>Not Interested</option>
                    <option value="Closed" ${lead['Lead Status']=='Closed'?'selected':''}>Closed/Won</option>
                    <option value="Duplicate" ${lead['Lead Status']=='Duplicate'?'selected':''}>Duplicate</option>
                </select>
            </div>
            <div class="detail-item"><span class="label">Priority</span>
                <select id="editPriority" class="modal-input">
                    <option value="High" ${lead['Follow-Up Priority (Auto)'] && lead['Follow-Up Priority (Auto)'].includes('High')?'selected':''}>High</option>
                    <option value="Medium" ${lead['Follow-Up Priority (Auto)'] && lead['Follow-Up Priority (Auto)'].includes('Medium')?'selected':''}>Medium</option>
                    <option value="Low" ${!lead['Follow-Up Priority (Auto)'] || lead['Follow-Up Priority (Auto)'].includes('Low')?'selected':''}>Low</option>
                </select>
            </div>
        </div>
        <div class="divider"></div>
        <div class="detail-item" style="grid-column: 1 / -1;">
            <span class="label">Activity Log / Notes</span>
            ${lead['Follow-Up Notes'] ? `<div style="background:#f9fafb; border:1px solid var(--border-color); border-radius:6px; padding:10px 12px; font-size:12px; color:var(--text-muted); white-space:pre-wrap; max-height:100px; overflow-y:auto; margin-bottom:8px; margin-top:6px;">${lead['Follow-Up Notes']}</div>` : ''}
            <textarea id="editNotes" class="modal-input" placeholder="Add a new note (will be timestamped and prepended)..." style="height: 70px; resize: vertical; margin-top:${lead['Follow-Up Notes'] ? '0' : '6px'};"></textarea>
        </div>
        <div class="divider"></div>
        <div style="margin-top:16px; padding-bottom: 4px;">
            <span class="label" style="display:block; margin-bottom:10px;">Demo Website</span>
            ${lead['Demo Site URL'] ? `
                <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
                    <span style="font-size:12px; color:var(--text-muted); flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${lead['Demo Site URL']}">${lead['Demo Site URL']}</span>
                    <button type="button" onclick="window.open('${lead['Demo Site URL']}','_blank')" style="background:#8b5cf6; color:#fff; border:none; border-radius:6px; padding:7px 14px; font-size:13px; font-weight:600; cursor:pointer;">View Demo</button>
                    <button type="button" class="btn-send-demo" onclick="sendDemo('${lead['Lead ID']}')" style="padding:7px 14px; font-size:13px;">Send Demo</button>
                    ${window.currentUser?.role === 'super_admin'
                        ? `<button type="button" onclick="requestDemoSite('${lead['Lead ID']}', this, true)" style="background:#f3f4f6; color:#6b7280; border:1px solid #e5e7eb; border-radius:6px; padding:7px 14px; font-size:13px; font-weight:600; cursor:pointer;" title="Regenerate the demo site">Regenerate</button>
                           <button type="button" onclick="deleteDemoSite('${lead['Lead ID']}', this)" style="background:#fee2e2; color:#dc2626; border:1px solid #fca5a5; border-radius:6px; padding:7px 14px; font-size:13px; font-weight:600; cursor:pointer;" title="Delete this demo site permanently">Delete Site</button>`
                        : ''}

                </div>
            ` : `
                <div style="display:flex; align-items:center; gap:10px;">
                    <span style="font-size:12px; color:var(--text-muted);">No demo site deployed yet.</span>
                    <button type="button" id="generateDemoBtn"
                        onclick="confirmDemoGeneration('${lead['Lead ID']}', true)"
                        style="${window.currentUser?.role === 'super_admin'
                            ? 'background:#8b5cf6; color:#fff; border:none; cursor:pointer;'
                            : 'background:#f3f4f6; color:#9ca3af; border:1px solid #e5e7eb; cursor:not-allowed;'}
                               border-radius:6px; padding:7px 16px; font-size:13px; font-weight:600;"
                        ${window.currentUser?.role !== 'super_admin' ? 'disabled title="Only Super Admins can generate demos"' : ''}>
                        ${window.currentUser?.role === 'super_admin' ? 'Generate &amp; Deploy' : 'Awaiting Demo'}
                    </button>
                </div>
            `}
        </div>
        <div style="margin-top: 24px; padding-bottom: 30px; display:flex; justify-content: flex-end;">
            <button type="button" class="btn-primary" id="saveLeadBtn" onclick="saveLead()" ontouchstart="saveLead()">Save Changes</button>
        </div>
    `;

    document.getElementById('leadModal').style.display = 'block';
}

function saveLead() {
    if(!editingLeadId) return;
    const btn = document.getElementById('saveLeadBtn');
    btn.innerText = 'Saving...';

    const lead = globalLeads.find(l => l['Lead ID'] === editingLeadId);
    const newNoteText = (document.getElementById('editNotes').value || '').trim();
    let combinedNotes = lead ? (lead['Follow-Up Notes'] || '') : '';
    if (newNoteText) {
        const timestamp = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true });
        const entry = `[${timestamp}] ${newNoteText}`;
        combinedNotes = combinedNotes ? `${entry}\n---\n${combinedNotes}` : entry;
    }
    
    const leadUpdate = {
        'Lead ID': editingLeadId,
        'Phone': document.getElementById('editPhone').value,
        'Email': document.getElementById('editEmail').value,
        'Lead Status': document.getElementById('editStatus').value,
        'Follow-Up Priority (Auto)': document.getElementById('editPriority').value,
        'Follow-Up Notes': combinedNotes
    };

    fetch('/api/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(leadUpdate)
    })
    .then(r => r.json())
    .then(data => {
        if(data.status === 'success') {
            showToast('Lead saved successfully', 'success');
            closeModal();
            loadData(); 
        } else {
            showToast('Error: ' + data.error, 'error');
            btn.innerText = 'Save Changes';
        }
    })
    .catch(e => {
        showToast('Network error — could not save', 'error');
        btn.innerText = 'Save Changes';
    });
}

function closeModal() {
    document.getElementById('leadModal').style.display = 'none';
}

window.onclick = function(event) {
    if (event.target == document.getElementById('leadModal')) {
        closeModal();
    }
}

function renderChart(leads) {
    const sources = {};
    leads.forEach(l => {
        let cat = l['Category (Pitch Angle)'] || 'General';
        if(cat.length > 25) cat = cat.substring(0, 25) + '...';
        if(cat.trim() !== '') {
             sources[cat] = (sources[cat] || 0) + 1;
        }
    });

    const sorted = Object.entries(sources).sort((a,b) => b[1]-a[1]).slice(0, 5);
    const labels = sorted.map(i => i[0]);
    const data = sorted.map(i => i[1]);

    const ctx = document.getElementById('sourceChart').getContext('2d');
    if(chartInstance) chartInstance.destroy();

    chartInstance = new Chart(ctx, {
        type: 'pie',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: ['#3b82f6', '#60a5fa', '#93c5fd', '#bfdbfe', '#e0f2fe'],
                borderWidth: 1,
                borderColor: '#ffffff',
                hoverOffset: 4
            }]
        },
        options: { plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, padding: 15, font: {family: '-apple-system'} } } }, cutout: '0%', layout: { padding: 10 } }
    });
}

function toggleLeadSelection(cb) {
    if(cb.checked) selectedLeadIds.add(cb.value);
    else selectedLeadIds.delete(cb.value);
    updateDeleteBtnVisibility();
}

function toggleSelectAll(cb) {
    const checkboxes = document.querySelectorAll('.lead-checkbox');
    checkboxes.forEach(c => {
        c.checked = cb.checked;
        if(cb.checked) selectedLeadIds.add(c.value);
        else selectedLeadIds.delete(c.value);
    });
    updateDeleteBtnVisibility();
}

function updateDeleteBtnVisibility() {
    const btn = document.getElementById('deleteSelectedBtn');
    const count = document.getElementById('selectedCount');
    if(!btn) return;
    if(selectedLeadIds.size > 0) {
        btn.style.display = 'flex';
        if(count) count.innerText = selectedLeadIds.size;
    } else {
        btn.style.display = 'none';
        const selectAll = document.getElementById('selectAllLeads');
        if(selectAll) selectAll.checked = false;
    }
}

function deleteSelectedLeads() {
    if(selectedLeadIds.size === 0) return;
    if(!confirm(`Are you sure you want to permanently delete ${selectedLeadIds.size} leads?`)) return;
    
    const btn = document.getElementById('deleteSelectedBtn');
    btn.innerHTML = 'Deleting...';
    
    fetch('/api/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selectedLeadIds) })
    })
    .then(r => r.json())
    .then(data => {
        if(data.error) throw new Error(data.error);
        showToast(`Deleted ${selectedLeadIds.size} leads`, 'success');
        selectedLeadIds.clear();
        updateDeleteBtnVisibility();
        loadData(false);
        btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg><span class="btn-text">Delete (<span id="selectedCount">0</span>)</span>`;
    })
    .catch(e => {
        showToast('Delete failed: ' + e, 'error');
        btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg><span class="btn-text">Delete (<span id="selectedCount">${selectedLeadIds.size}</span>)</span>`;
    });
}

window.copyTitleAndOpen = function(text, id) {
    if (navigator.clipboard) {
        navigator.clipboard.writeText(text).then(() => {
            viewLead(id);
        }).catch(err => {
            console.error('Failed to copy text: ', err);
            viewLead(id);
        });
    } else {
        let ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        try { document.execCommand('copy'); } catch(e) {}
        document.body.removeChild(ta);
        viewLead(id);
    }
};

// === DEMO CONFIRM MODAL === //
let _demoConfirmLeadId  = null;   // lead being confirmed
let _demoConfirmFromModal = false; // came from lead modal?

window.confirmDemoGeneration = function(leadId, fromModal = false) {
    const lead = globalLeads.find(l => l['Lead ID'] === leadId);
    if (!lead) return;

    _demoConfirmLeadId   = leadId;
    _demoConfirmFromModal = fromModal;

    const name = lead.Name || '';

    // Pre-fill all fields from lead data
    document.getElementById('dm_title').value   = name;
    document.getElementById('dm_contact').value = lead.Phone    || '';
    document.getElementById('dm_email').value   = lead.Email    || '';
    document.getElementById('dm_location').value = lead.Location || '';
    document.getElementById('dm_details').value = lead['Category (Pitch Angle)'] || lead.Notes || '';
    document.getElementById('dm_logo').value    = name.substring(0, 2).toUpperCase();
    buildTemplateCards('4');

    const modal = document.getElementById('demoConfirmModal');
    modal.style.display = 'flex';
};

const TEMPLATE_LABELS = {
    '1':    'Template 1 — Classic',
    '2':    'Template 2 — Modern',
    '3':    'Template 3 — Bold',
    '4':    'Template 4 — Horizon Dream',
    '5':    'Template 5 — Minimal',
    'r-6':  'r-6 — Real Estate A',
    'r-7':  'r-7 — Real Estate B',
    'r-8':  'r-8 — Interior Studio',
    'r-9':  'r-9 — Furniture',
    'r-10': 'r-10 — Premium Buyers',
};

function buildTemplateCards(defaultSelected = '4') {
    const grid = document.getElementById('templateCardGrid');
    if (!grid) return;
    grid.innerHTML = '';

    Object.entries(TEMPLATE_LABELS).forEach(([id, label]) => {
        const card = document.createElement('div');
        card.className = 'tmpl-card' + (id === defaultSelected ? ' selected' : '');
        card.dataset.templateId = id;
        card.onclick = () => selectTemplateCard(id);

        card.innerHTML = `
            <div class="tmpl-preview">
                <iframe src="${BACKEND_URL}/template/preview/${id}"
                    loading="lazy" sandbox="allow-same-origin allow-scripts"
                    title="${label}"></iframe>
            </div>
            <div class="tmpl-name">${label}</div>
            <div class="tmpl-badge">✓</div>
        `;
        grid.appendChild(card);
    });

    document.getElementById('dm_template').value = defaultSelected;
}

function selectTemplateCard(id) {
    document.querySelectorAll('.tmpl-card').forEach(c => c.classList.remove('selected'));
    const card = document.querySelector(`.tmpl-card[data-template-id="${id}"]`);
    if (card) card.classList.add('selected');
    document.getElementById('dm_template').value = id;
}

window.closeDemoConfirmModal = function() {
    document.getElementById('demoConfirmModal').style.display = 'none';
    _demoConfirmLeadId = null;
};

window.submitDemoGeneration = async function(isAuto = false) {
    if (!_demoConfirmLeadId) return;

    const leadId = _demoConfirmLeadId;
    const fromModal = _demoConfirmFromModal;
    closeDemoConfirmModal();

    const lead = globalLeads.find(l => l['Lead ID'] === leadId);
    if (!lead) return;

    // If auto: use lead data as-is. If custom: read form values.
    const payload = isAuto ? {
        title:     lead.Name      || 'Unnamed Lead',
        contact:   lead.Phone     || 'N/A',
        email:     lead.Email     || '',
        location:  lead.Location  || '',
        address:   lead.Location  || '',
        details:   lead['Category (Pitch Angle)'] || lead.Notes || '',
        logo_text: (lead.Name || 'XX').substring(0, 2).toUpperCase(),
    } : {
        title:     document.getElementById('dm_title').value   || lead.Name || 'Unnamed Lead',
        contact:   document.getElementById('dm_contact').value || lead.Phone || 'N/A',
        email:     document.getElementById('dm_email').value   || lead.Email || '',
        location:  document.getElementById('dm_location').value || lead.Location || '',
        address:   document.getElementById('dm_location').value || lead.Location || '',
        details:   document.getElementById('dm_details').value || '',
        logo_text: document.getElementById('dm_logo').value.toUpperCase() || 'XX',
    };

    const template = document.getElementById('dm_template')?.value || DEFAULT_TEMPLATE;

    await requestDemoSite(leadId, null, fromModal, payload, template);
};

// === DEMO SITE GENERATION === //
const DEFAULT_TEMPLATE = '4';   // Template 4 = Horizon Dream Home


window.requestDemoSite = async function(id, btn, fromModal = false, customPayload = null, template = null) {
    const lead = globalLeads.find(l => l['Lead ID'] === id);
    if (!lead) return;

    const origText = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.innerHTML = 'Deploying...'; }

    const name = lead.Name || 'Unnamed Lead';
    const clientPayload = customPayload || {
        title:     name,
        contact:   lead.Phone    || 'N/A',
        email:     lead.Email    || '',
        location:  lead.Location || '',
        address:   lead.Location || '',
        details:   lead['Category (Pitch Angle)'] || lead.Notes || '',
        logo_text: name.substring(0, 2).toUpperCase()
    };
    const chosenTemplate = template || DEFAULT_TEMPLATE;

    try {
        // ── Step 1: Create client record ─────────────────────────────────
        showToast('Creating demo site...', 'info');
        const createRes = await fetch(`${BACKEND_URL}/client/create`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(clientPayload)
        });
        if (!createRes.ok) throw new Error(`Client create failed: ${createRes.status}`);
        const clientData = await createRes.json();
        const clientId   = clientData.id;

        // ── Step 2: Apply selected template ──────────────────────────────
        showToast('Applying template...', 'info');
        const tplRes = await fetch(`${BACKEND_URL}/template/select`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ client_id: clientId, template_name: chosenTemplate })
        });
        if (!tplRes.ok) throw new Error(`Template apply failed: ${tplRes.status}`);

        // ── Step 3: Deploy to Vercel ──────────────────────────────────────
        showToast('Deploying to Vercel...', 'info');
        const deployRes = await fetch('/api/deploy', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ client_id: clientId })
        });
        if (!deployRes.ok) {
            const deployErr = await deployRes.json().catch(() => ({}));
            throw new Error(deployErr.error || `Deploy failed: ${deployRes.status}`);
        }
        const deployData = await deployRes.json();
        const deployedUrl = deployData.shareable_url || deployData.url;
        if (!deployedUrl) throw new Error('No URL returned from deployment');

        // ── Step 4: Save URL in Supabase and update UI ───────────────────
        await fetch('/api/update', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ 'Lead ID': id, 'Demo Site URL': deployedUrl })
        });
        lead['Demo Site URL'] = deployedUrl;
        lastDataFingerprint = '';  // force next poll to re-read from DB

        showToast('Demo deployed! View Demo and Send Demo are now active.', 'success');
        renderTable();
        if (document.getElementById('pipelineView').style.display !== 'none') renderPipeline();
        const modal = document.getElementById('leadModal');
        if (modal && modal.style.display === 'block' && editingLeadId === id) viewLead(id);

        if (btn) { btn.disabled = false; btn.innerHTML = origText; }
    } catch (err) {
        console.error('requestDemoSite error:', err);
        showToast('Deploy failed: ' + err.message, 'error');
        if (btn) { btn.disabled = false; btn.innerHTML = origText; }
    }
};

// Listen for DEMO_DEPLOYED postMessage from the preview page
window.addEventListener('message', async function(event) {
    if (!event.data || event.data.type !== 'DEMO_DEPLOYED') return;
    const { leadId, url } = event.data;
    if (!url) return;

    // Find the lead in memory and update immediately so buttons show at once
    const lead = globalLeads.find(l => l['Lead ID'] === leadId);
    if (lead) {
        lead['Demo Site URL'] = url;
        renderTable();
        if (document.getElementById('pipelineView').style.display !== 'none') renderPipeline();
        const modal = document.getElementById('leadModal');
        if (modal && modal.style.display === 'block' && editingLeadId === leadId) viewLead(leadId);
    }

    // Persist to Supabase
    if (leadId) {
        try {
            await fetch('/api/update', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ 'Lead ID': leadId, 'Demo Site URL': url })
            });
            // Force reload so fingerprint refreshes and poll won't wipe the URL
            lastDataFingerprint = '';
            loadData(true);
            showToast('Demo deployed! View Demo and Send Demo buttons are now active.', 'success');
        } catch(e) {
            console.error('Failed to save Demo Site URL:', e);
            showToast('Demo live but could not save URL — please refresh.', 'warning');
        }
    }
});



window.deleteDemoSite = async function(leadId, btn) {
    if (!confirm('Delete this demo site? The Vercel deployment will remain but the link will be removed from this lead.')) return;

    const lead = globalLeads.find(l => l['Lead ID'] === leadId);
    if (!lead) return;

    const origText = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.innerHTML = 'Deleting...'; }

    try {
        // Extract client_id from the stored URL (darion-demo-{id}.vercel.app)
        // Try to call the delete endpoint if we have the client ID
        // We'll just clear from Supabase since we don't store client_id separately
        await fetch('/api/update', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ 'Lead ID': leadId, 'Demo Site URL': null })
        });

        lead['Demo Site URL'] = null;
        delete lead['Demo Site URL'];

        showToast('Demo site removed from this lead.', 'success');
        viewLead(leadId);   // refresh modal
        renderTable();
        if (document.getElementById('pipelineView').style.display !== 'none') renderPipeline();
    } catch (err) {
        console.error('deleteDemoSite error:', err);
        showToast('Failed to delete: ' + err.message, 'error');
        if (btn) { btn.disabled = false; btn.innerHTML = origText; }
    }
};

window.sendDemo = function(leadId) {
    const lead = globalLeads.find(l => l['Lead ID'] === leadId);
    if (!lead || !lead['Demo Site URL']) {
        showToast('No deployed demo site found for this lead.', 'warning');
        return;
    }
    const demoUrl  = lead['Demo Site URL'];
    const leadName = lead.Name || 'your business';
    const message = `Hi! Here's a demo website we created for ${leadName}: ${demoUrl} — Let us know if you'd like to customize it!`;

    if (lead.Phone && lead.Phone.trim().length >= 4) {
        const cleanPhone = lead.Phone.replace(/[^0-9+]/g, '');
        window.open(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`, '_blank');
        showToast('Opening WhatsApp with demo link...', 'success');
    } else {
        navigator.clipboard.writeText(demoUrl).then(() => {
            showToast('Demo link copied to clipboard.', 'success');
        }).catch(() => {
            let ta = document.createElement('textarea');
            ta.value = demoUrl;
            ta.style.position = 'fixed';
            document.body.appendChild(ta);
            ta.focus(); ta.select();
            try { document.execCommand('copy'); } catch(e) {}
            document.body.removeChild(ta);
            showToast('Demo link copied.', 'success');
        });
    }
};

window.viewDemoWeb = async function(id) {
    const lead = globalLeads.find(l => l['Lead ID'] === id);
    if (!lead) return;
    showToast('Initializing Demo Website...', 'info');

    const name = lead.Name || 'Unnamed Lead';
    const payload = {
        title:     name,
        contact:   lead.Phone    || 'N/A',
        email:     lead.Email    || '',
        location:  lead.Location || '',
        address:   lead.Location || '',
        details:   lead['Category (Pitch Angle)'] || lead.Notes || '',
        logo_text: name.substring(0, 2).toUpperCase()
    };

    try {
        const res = await fetch(`${BACKEND_URL}/client/create`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(payload)
        });

        if (!res.ok) throw new Error(`Server error: ${res.status}`);

        const data = await res.json();
        const clientId = data.id;

        showToast('Demo site ready! Opening...', 'success');
        window.open(`${BACKEND_URL}/select/${clientId}`, '_blank');
    } catch (err) {
        console.error('Demo Web error:', err);
        showToast(`Failed to create demo site: ${err.message}`, 'error');
    }
};

window.shareLead = function(id) {
    const lead = globalLeads.find(l => l['Lead ID'] === id);
    if (!lead) return;

    const name = lead.Name || 'Unnamed Lead';
    const phone = lead.Phone || '';
    const email = lead.Email || '';
    const status = lead['Lead Status'] || 'New';
    const priority = (lead['Follow-Up Priority (Auto)'] || 'Low').replace(/[^a-zA-Z ]/g, '').trim();
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(name)}`;

    const shareText = [
        `Lead: ${name}`,
        phone   ? `Phone: ${phone}`  : '',
        email   ? `Email: ${email}`  : '',
        `Status: ${status}`,
        `Priority: ${priority}`,
        `Search: ${searchUrl}`
    ].filter(Boolean).join('\n');

    if (navigator.share) {
        navigator.share({ title: name, text: shareText })
            .catch(() => {}); // user cancelled – ignore
    } else {
        navigator.clipboard.writeText(shareText).then(() => {
            const btn = document.activeElement;
            const orig = btn.innerHTML;
            btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px;"><polyline points="20 6 9 17 4 12"></polyline></svg>Copied!`;
            setTimeout(() => { btn.innerHTML = orig; }, 2000);
        }).catch(() => {
            // Final fallback: textarea copy
            let ta = document.createElement('textarea');
            ta.value = shareText;
            ta.style.position = 'fixed';
            document.body.appendChild(ta);
            ta.focus(); ta.select();
            try { document.execCommand('copy'); } catch(e) {}
            document.body.removeChild(ta);
        });
    }
};

// === EXPORT CSV === //
window.exportFilteredCSV = function() {
    if (!visuallyFilteredLeads.length) {
        showToast('No leads to export', 'warning');
        return;
    }
    const keys = Object.keys(visuallyFilteredLeads[0]).filter(k => !k.startsWith('_'));
    const rows = [
        keys.map(k => `"${k}"`).join(','),
        ...visuallyFilteredLeads.map(l =>
            keys.map(k => `"${(l[k] || '').replace(/"/g, '""')}"`).join(',')
        )
    ];
    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `leads_export_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showToast(`Exported ${visuallyFilteredLeads.length} leads`, 'success');
};

// === DUE TODAY FILTER === //
window.filterDueToday = function() {
    const today = new Date().toISOString().split('T')[0];
    dueTodayMode = true;
    visuallyFilteredLeads = globalLeads.filter(l =>
        (l['Reminder Flag (Auto)'] || '').includes('DUE TODAY') ||
        (l['Next Follow-Up Date'] || '').startsWith(today)
    );
    currentPage = 1;
    renderTable();
    showToast(`${visuallyFilteredLeads.length} leads due today`, visuallyFilteredLeads.length > 0 ? 'warning' : 'info');
};

// === INLINE STATUS UPDATE === //
window.quickUpdateStatus = function(id, status) {
    const lead = globalLeads.find(l => l['Lead ID'] === id);
    if (!lead || lead['Lead Status'] === status) return;
    lead['Lead Status'] = status; // Optimistic update
    fetch('/api/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 'Lead ID': id, 'Lead Status': status })
    })
    .then(() => showToast(`Status updated to ${status}`, 'success'))
    .catch(() => showToast('Failed to update status', 'error'));
};

// === NEW LEAD MODAL === //
window.openNewLeadModal = function() {
    // Clear fields
    ['nlName','nlPhone','nlEmail','nlLocation','nlCategory','nlNotes'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    const p = document.getElementById('nlPriority');
    if (p) p.value = 'Medium';
    document.getElementById('newLeadModal').style.display = 'block';
    setTimeout(() => document.getElementById('nlName').focus(), 100);
};

window.closeNewLeadModal = function() {
    document.getElementById('newLeadModal').style.display = 'none';
};

window.saveNewLead = function() {
    const name = (document.getElementById('nlName').value || '').trim();
    if (!name) { showToast('Lead name is required.', 'warning'); return; }
    
    const btn = document.getElementById('saveNewLeadBtn');
    btn.innerText = 'Creating...';
    btn.disabled = true;

    const lastIdNum = globalLeads.reduce((max, lead) => {
        if (!lead['Lead ID']) return max;
        const parts = lead['Lead ID'].split('-');
        if(parts.length > 1 && !isNaN(parts[1])) return Math.max(max, parseInt(parts[1]));
        return max;
    }, 1000);
    const newId = `L-${lastIdNum + 1}`;

    const timestamp = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true });
    const notes = document.getElementById('nlNotes').value.trim();
    const initialNote = notes ? `[${timestamp}] ${notes}` : '';
    const phone = document.getElementById('nlPhone').value.trim();

    const payload = {
        'Lead ID': newId,
        'Name':     name,
        'Phone':    phone,
        'Email':    document.getElementById('nlEmail').value.trim(),
        'Source':   'Manual Entry',
        'Location': document.getElementById('nlLocation').value.trim(),
        'Lead Status': 'New',
        'Combined Score': '',
        'Category (Pitch Angle)': document.getElementById('nlCategory').value.trim(),
        'Website': '',
        'Has WhatsApp': '',
        'Is Website Poor': '',
        'Budget': '',
        'Requirement Type': '',
        'Urgency Level': '',
        'Last Contacted Date': '',
        'Next Follow-Up Date': '',
        'Follow-Up Count': '0',
        'Follow-Up Notes': initialNote,
        'Preferred Contact': phone ? 'Phone' : 'Email',
        'Stage': 'New',
        'Assigned Salesperson': '',
        'Expected Value': '',
        'Probability (%)': '',
        'Days Since Contact': '',
        'Follow-Up Priority (Auto)': document.getElementById('nlPriority').value,
        'Reminder Flag (Auto)': 'Scheduled'
    };

    fetch('/api/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    })
    .then(r => r.json())
    .then(data => {
        if (data.error) throw new Error(data.error);
        showToast(`Lead "${name}" created (${newId})`, 'success');
        closeNewLeadModal();
        loadData(false);
    })
    .catch(e => {
        showToast('Failed to create lead: ' + e.message, 'error');
    })
    .finally(() => {
        btn.innerText = 'Create Lead';
        btn.disabled = false;
    });
};

// Close new lead modal on outside click
window.addEventListener('click', function(event) {
    const m = document.getElementById('newLeadModal');
    if (event.target === m) closeNewLeadModal();
});


// ============================================================
// PROFILE PAGE
// ============================================================

function loadProfileView() {
    const user = window.currentUser;
    if (!user) return;

    // Avatar & header chip
    const initial = (user.fullName || user.email || '?').charAt(0).toUpperCase();
    const avatar = document.getElementById('profileAvatar');
    const nameDisplay = document.getElementById('profileNameDisplay');
    const emailDisplay = document.getElementById('profileEmailDisplay');
    const roleDisplay = document.getElementById('profileRoleDisplay');

    if (avatar)      avatar.textContent      = initial;
    if (nameDisplay) nameDisplay.textContent  = user.fullName || user.email;
    if (emailDisplay) emailDisplay.textContent = user.email;
    if (roleDisplay) {
        roleDisplay.textContent = user.role === 'super_admin' ? 'Super Admin' : 'Sales Manager';
        roleDisplay.style.background = user.role === 'super_admin' ? '#f3e8ff' : '#e0f2fe';
        roleDisplay.style.color      = user.role === 'super_admin' ? '#7e22ce' : '#0369a1';
    }

    // Fill editable field
    const fullNameInput = document.getElementById('profileFullName');
    const emailInput    = document.getElementById('profileEmail');
    const roleInput     = document.getElementById('profileRole');
    const sinceInput    = document.getElementById('profileMemberSince');

    if (fullNameInput) fullNameInput.value = user.fullName || '';
    if (emailInput)    emailInput.value    = user.email    || '';
    if (roleInput)     roleInput.value     = user.role === 'super_admin' ? 'Super Admin' : 'Sales Manager';

    // Fetch member since from Supabase auth metadata
    _sb.auth.getUser().then(({ data }) => {
        if (data?.user?.created_at && sinceInput) {
            const d = new Date(data.user.created_at);
            sinceInput.value = d.toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' });
        }
    });

    // Password strength listener
    const passInput = document.getElementById('profileNewPass');
    if (passInput) {
        passInput.removeEventListener('input', _passStrengthHandler);
        passInput.addEventListener('input', _passStrengthHandler);
    }
}

function _passStrengthHandler(e) {
    const val = e.target.value;
    const bar  = document.getElementById('passStrengthBar');
    const fill = document.getElementById('passStrengthFill');
    const lbl  = document.getElementById('passStrengthLabel');
    if (!bar || !fill || !lbl) return;

    if (!val) {
        bar.style.display = 'none';
        lbl.style.display = 'none';
        return;
    }
    bar.style.display = 'block';
    lbl.style.display = 'block';

    let score = 0;
    if (val.length >= 8)  score++;
    if (/[A-Z]/.test(val)) score++;
    if (/[0-9]/.test(val)) score++;
    if (/[^A-Za-z0-9]/.test(val)) score++;

    const levels = [
        { width: '20%', color: '#ef4444', label: 'Very Weak' },
        { width: '40%', color: '#f97316', label: 'Weak' },
        { width: '65%', color: '#eab308', label: 'Moderate' },
        { width: '85%', color: '#22c55e', label: 'Strong' },
        { width: '100%',color: '#10b981', label: 'Very Strong' },
    ];
    const lvl = levels[Math.min(score, 4)];
    fill.style.width      = lvl.width;
    fill.style.background = lvl.color;
    lbl.textContent       = `Password strength: ${lvl.label}`;
    lbl.style.color       = lvl.color;
}

window.saveProfileInfo = async function() {
    const btn  = document.getElementById('saveProfileBtn');
    const name = (document.getElementById('profileFullName').value || '').trim();
    if (!name) { showToast('Full name is required.', 'warning'); return; }

    const origHtml = btn.innerHTML;
    btn.disabled = true;
    btn.textContent = 'Saving...';

    try {
        const { error } = await _sb
            .from('profiles')
            .update({ full_name: name })
            .eq('id', window.currentUser.id);

        if (error) throw error;

        // Update local cache & header chip
        window.currentUser.fullName = name;
        const disp = document.getElementById('userDisplayName');
        const av   = document.getElementById('userAvatar');
        const pnm  = document.getElementById('profileNameDisplay');
        const pav  = document.getElementById('profileAvatar');
        if (disp) disp.textContent = name;
        if (av)   av.textContent   = name.charAt(0).toUpperCase();
        if (pnm)  pnm.textContent  = name;
        if (pav)  pav.textContent  = name.charAt(0).toUpperCase();
        showToast('Profile updated successfully.', 'success');
    } catch (err) {
        showToast('Failed to save: ' + err.message, 'error');
    } finally {
        btn.disabled  = false;
        btn.innerHTML = origHtml;
    }
};

window.changePassword = async function() {
    const btn      = document.getElementById('changePassBtn');
    const newPass  = (document.getElementById('profileNewPass').value  || '');
    const confPass = (document.getElementById('profileConfirmPass').value || '');

    if (!newPass)  { showToast('Please enter a new password.', 'warning'); return; }
    if (newPass.length < 8) { showToast('Password must be at least 8 characters.', 'warning'); return; }
    if (newPass !== confPass) { showToast('Passwords do not match.', 'error'); return; }

    const origHtml = btn.innerHTML;
    btn.disabled = true;
    btn.textContent = 'Updating...';

    try {
        const { error } = await _sb.auth.updateUser({ password: newPass });
        if (error) throw error;
        document.getElementById('profileNewPass').value   = '';
        document.getElementById('profileConfirmPass').value = '';
        // Reset strength bar
        const bar = document.getElementById('passStrengthBar');
        const lbl = document.getElementById('passStrengthLabel');
        if (bar) bar.style.display = 'none';
        if (lbl) lbl.style.display = 'none';
        showToast('Password updated successfully.', 'success');
    } catch (err) {
        showToast('Failed to update password: ' + err.message, 'error');
    } finally {
        btn.disabled  = false;
        btn.innerHTML = origHtml;
    }
};

window.togglePassVis = function(inputId, btn) {
    const input = document.getElementById(inputId);
    if (!input) return;
    const isPass = input.type === 'password';
    input.type = isPass ? 'text' : 'password';
    // Swap icon svg between eye and eye-off
    btn.innerHTML = isPass
        ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`
        : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
};
