// === SUPABASE SETUP ===
const SUPABASE_URL = 'https://ajrtewupbfupxpwwvrcz.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_92ZS2ML3dAMDN9inMpjwqA_her1Be4K';
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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
        
        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: async function(results) {
                const newLeads = [];
                let lastId = 1000;
                globalLeads.forEach(l => {
                    if (l['Lead ID']) {
                        let num = parseInt(l['Lead ID'].split('-')[1]);
                        if (!isNaN(num)) lastId = Math.max(lastId, num);
                    }
                });

                results.data.forEach(row => {
                    lastId++;
                    let name = row['business_name'] || row['Name'] || '';
                    let phone = row['phone_number'] || row['Phone'] || '';
                    let email = row['email'] || row['Email'] || '';
                    let location = row['address'] || row['Location'] || '';
                    let category = row['category'] || row['Category'] || '';
                    
                    newLeads.push({
                        'Lead ID': `L-${lastId}`,
                        'Name': name.trim(),
                        'Phone': phone.trim(),
                        'Email': email.trim(),
                        'Source': 'Uploaded CSV',
                        'Location': location.trim(),
                        'Lead Status': 'New',
                        'Combined Score': '',
                        'Category (Pitch Angle)': category.trim(),
                        'Website': row['website'] || '',
                        'Has WhatsApp': row['has_whatsapp'] || '',
                        'Is Website Poor': row['is_website_poor'] || '',
                        'Budget': '',
                        'Requirement Type': '',
                        'Urgency Level': '',
                        'Last Contacted Date': '',
                        'Next Follow-Up Date': '',
                        'Follow-Up Count': '0',
                        'Follow-Up Notes': '',
                        'Preferred Contact': phone ? 'Phone' : 'Email',
                        'Stage': 'New',
                        'Assigned Salesperson': '',
                        'Expected Value': '',
                        'Probability (%)': '',
                        'Days Since Contact': '',
                        'Follow-Up Priority (Auto)': 'Medium',
                        'Reminder Flag (Auto)': 'Scheduled'
                    });
                });

                if (newLeads.length === 0) {
                    showToast('No valid rows found to upload', 'error');
                    btn.innerHTML = 'Upload CSV';
                    return;
                }

                // Chunk uploads max 1000 at a time for performance
                let successCount = 0;
                for (let i = 0; i < newLeads.length; i += 1000) {
                    const chunk = newLeads.slice(i, i + 1000);
                    const { error } = await supabase.from('leads').insert(chunk);
                    if (error) {
                        showToast('❌ Upload failed: ' + error.message, 'error');
                        btn.innerHTML = 'Upload CSV';
                        return;
                    }
                    successCount += chunk.length;
                }

                showToast(`✅ Imported ${successCount} new leads successfully`, 'success');
                btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: middle; margin-right:6px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg> Upload CSV`;
                document.getElementById('csvUploadInput').value = '';
                loadData(false);
            },
            error: function(error) {
                showToast('❌ CSV Parse fail: ' + error.message, 'error');
                btn.innerHTML = 'Upload CSV';
            }
        });
    });

    setInterval(() => loadData(true), 15000);
});

function initNavigation() {
    const dBtn = document.getElementById('navDashboardBtn');
    const pBtn = document.getElementById('navPipelineBtn');
    if(!dBtn || !pBtn) return;
    
    dBtn.addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('dashboardView').style.display = 'block';
        document.getElementById('pipelineView').style.display = 'none';
        dBtn.classList.add('active');
        pBtn.classList.remove('active');
    });

    pBtn.addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('dashboardView').style.display = 'none';
        document.getElementById('pipelineView').style.display = 'flex';
        dBtn.classList.remove('active');
        pBtn.classList.add('active');
        renderPipeline();
    });
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
    
    supabase.from('leads').select('*').order('Lead ID')
    .then(({ data, error }) => {
        if(error) throw new Error(error.message);
        
        const fingerprint = JSON.stringify(data);
        if(isSilentPolling && fingerprint === lastDataFingerprint) {
            return; 
        }
        lastDataFingerprint = fingerprint;

        globalLeads = data || [];
        populateCityFilter(globalLeads); 
        applyFilters(); 
        renderPipeline(); 
    })
    .catch(err => {
        console.error(err);
        if(!isSilentPolling) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #ef4444; padding: 40px;">Connection failed. Is Supabase configured?</td></tr>`;
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
        const matchSearch = 
            (lead.Name && lead.Name.toLowerCase().includes(currentSearch)) || 
            (lead.Phone && lead.Phone.toLowerCase().includes(currentSearch));
            
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
                    ${['New','Contacted','Interested','Not Interested','Closed','Duplicate'].map(s =>
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
            let shortName = lead.Name ? (lead.Name.length > 12 ? lead.Name.substring(0,10)+'..' : lead.Name) : 'Profile';
            let searchLink = `<a href="https://www.google.com/search?q=${searchQuery}" target="_blank" title="Search Google" style="color:var(--brand-primary); background:#eff6ff; padding: 4px 8px; border-radius: 4px; text-decoration:none; display:flex; align-items:center; font-size: 11px; font-weight: 600;">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px;"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                Search ${shortName}
            </a>`;

            const safeName = (lead.Name || 'Unnamed').replace(/'/g, "\\'").replace(/"/g, '&quot;');

            card.innerHTML = `
                <div class="kc-title" onclick="copyTitleAndOpen('${safeName}', '${lead['Lead ID']}'); event.stopPropagation();" style="cursor: pointer;" title="Tap to copy name and view lead">${lead.Name || 'Unnamed'}</div>
                <div class="kc-meta" style="margin-bottom: 12px; border-bottom: 1px solid #f3f4f6; padding-bottom: 8px;">${lead.Phone || lead.Email || 'No contact'}</div>
                <div class="kc-footer" style="border-top: none; padding-top: 0;">
                    <span class="badge ${badgeClass}">${cleanPriority}</span>
                    <div style="display:flex; gap:10px; align-items:center;">
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

    // Fire network request
    supabase.from('leads').update({ 'Lead Status': targetStatus }).eq('Lead ID', leadId)
    .then(({ error }) => {
        if(error) showToast('❌ Network error updating status', 'error');
        else showToast('✅ Status updated', 'success');
    });
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
                    <option value="Not Interested" ${lead['Lead Status']=='Not Interested'?'selected':''}>Not Interested</option>
                    <option value="Closed" ${lead['Lead Status']=='Closed'?'selected':''}>Closed/Won</option>
                    <option value="Duplicate" ${lead['Lead Status']=='Duplicate'?'selected':''}>Duplicate</option>
                </select>
            </div>
            <div class="detail-item"><span class="label">Priority</span>
                <select id="editPriority" class="modal-input">
                    <option value="🔴 High" ${lead['Follow-Up Priority (Auto)'] && lead['Follow-Up Priority (Auto)'].includes('High')?'selected':''}>High</option>
                    <option value="🟡 Medium" ${lead['Follow-Up Priority (Auto)'] && lead['Follow-Up Priority (Auto)'].includes('Medium')?'selected':''}>Medium</option>
                    <option value="🟢 Low" ${!lead['Follow-Up Priority (Auto)'] || lead['Follow-Up Priority (Auto)'].includes('Low')?'selected':''}>Low</option>
                </select>
            </div>
        </div>
        <div class="divider"></div>
        <div class="detail-item" style="grid-column: 1 / -1;">
            <span class="label">Activity Log / Notes</span>
            ${lead['Follow-Up Notes'] ? `<div style="background:#f9fafb; border:1px solid var(--border-color); border-radius:6px; padding:10px 12px; font-size:12px; color:var(--text-muted); white-space:pre-wrap; max-height:100px; overflow-y:auto; margin-bottom:8px; margin-top:6px;">${lead['Follow-Up Notes']}</div>` : ''}
            <textarea id="editNotes" class="modal-input" placeholder="Add a new note (will be timestamped and prepended)..." style="height: 70px; resize: vertical; margin-top:${lead['Follow-Up Notes'] ? '0' : '6px'};"></textarea>
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

    supabase.from('leads').update(leadUpdate).eq('Lead ID', editingLeadId)
    .then(({ error }) => {
        if(!error) {
            showToast('✅ Lead saved successfully', 'success');
            closeModal();
            loadData(); 
        } else {
            showToast('❌ Error: ' + error.message, 'error');
            btn.innerText = 'Save Changes';
        }
    })
    .catch(e => {
        showToast('❌ Network error — could not save', 'error');
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
    
    supabase.from('leads').delete().in('Lead ID', Array.from(selectedLeadIds))
    .then(({ error }) => {
        if(error) throw new Error(error.message);
        showToast(`🗑️ Deleted ${selectedLeadIds.size} leads`, 'success');
        selectedLeadIds.clear();
        updateDeleteBtnVisibility();
        loadData(false);
        btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg><span class="btn-text">Delete (<span id="selectedCount">0</span>)</span>`;
    })
    .catch(e => {
        showToast('❌ Delete failed: ' + e, 'error');
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
        `📋 Lead: ${name}`,
        phone   ? `📞 Phone: ${phone}`  : '',
        email   ? `✉️ Email: ${email}`  : '',
        `🏷 Status: ${status}`,
        `⚡ Priority: ${priority}`,
        `🔍 Search: ${searchUrl}`
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
    showToast(`✅ Exported ${visuallyFilteredLeads.length} leads`, 'success');
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
    showToast(`🔔 ${visuallyFilteredLeads.length} leads due today`, visuallyFilteredLeads.length > 0 ? 'warning' : 'info');
};

// === INLINE STATUS UPDATE === //
window.quickUpdateStatus = function(id, status) {
    const lead = globalLeads.find(l => l['Lead ID'] === id);
    if (!lead || lead['Lead Status'] === status) return;
    lead['Lead Status'] = status; // Optimistic update
    supabase.from('leads').update({ 'Lead Status': status }).eq('Lead ID', id)
    .then(({ error }) => {
        if(error) showToast('❌ Failed to update status', 'error');
        else showToast(`✅ Status → ${status}`, 'success');
    });
};

// === NEW LEAD MODAL === //
window.openNewLeadModal = function() {
    // Clear fields
    ['nlName','nlPhone','nlEmail','nlLocation','nlCategory','nlNotes'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    const p = document.getElementById('nlPriority');
    if (p) p.value = '🟡 Medium';
    document.getElementById('newLeadModal').style.display = 'block';
    setTimeout(() => document.getElementById('nlName').focus(), 100);
};

window.closeNewLeadModal = function() {
    document.getElementById('newLeadModal').style.display = 'none';
};

window.saveNewLead = function() {
    const name = (document.getElementById('nlName').value || '').trim();
    if (!name) { showToast('⚠️ Lead name is required', 'warning'); return; }
    
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

    supabase.from('leads').insert([payload])
    .then(({ error }) => {
        if (error) throw new Error(error.message);
        showToast(`✅ Lead "${name}" created (${newId})`, 'success');
        closeNewLeadModal();
        loadData(false);
    })
    .catch(e => {
        showToast('❌ Failed to create lead: ' + e.message, 'error');
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

