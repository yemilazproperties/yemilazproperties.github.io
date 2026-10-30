const $ = (selector, root=document) => root.querySelector(selector);
const $$ = (selector, root=document) => [...root.querySelectorAll(selector)];
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = value => new Intl.NumberFormat('en-NG',{style:'currency',currency:'NGN',maximumFractionDigits:0}).format(Number(value)||0);
const dateText = value => value ? new Intl.DateTimeFormat('en-NG',{dateStyle:'medium',timeZone:'Africa/Lagos'}).format(new Date(`${value}T00:00:00`)) : '—';
const today = () => new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Lagos'}).format(new Date());
const state = {user:null,profile:null,properties:[],units:[],leases:[],profiles:[],assignments:[],agreements:[],maintenance:[],payments:[],allowed:new Set(),propertyImageUrls:new Map(),propertyRenderId:0};
const client = () => window.hearthSupabase;
const overviewGridTemplate = $('#view-overview .content-grid')?.innerHTML || '';

function toast(message){const box=$('#toast');box.textContent=message;box.classList.add('show');setTimeout(()=>box.classList.remove('show'),4800);}
function propertySchemaError(error){
  const message=error?.message||String(error);
  if(message.includes('monthly_rent')||message.includes('image_path'))return new Error(`Supabase is missing a property field required by this version. Run supabase/property-images-migration.sql in the Supabase SQL Editor, then reload. (${message})`);
  return error;
}
function optionMarkup(rows,label){return rows.map(r=>`<option value="${esc(r.id)}">${esc(label(r))}</option>`).join('');}
function propertyBy(id){return state.properties.find(p=>p.id===id);}
function unitBy(id){return state.units.find(u=>u.id===id);}
function leaseBy(id){return state.leases.find(l=>l.id===id);}
function personBy(id){return state.profiles.find(p=>p.id===id);}
function leaseUnit(lease){return unitBy(lease?.unit_id);}
function unitProperty(unit){return propertyBy(unit?.property_id);}
function leaseTenant(lease){return personBy(lease?.tenant_id);}
function unitLabel(unit){const p=unitProperty(unit);return `${p?.name||'Property'} · ${unit?.unit_name||'Unit'}`;}
function leaseLabel(lease){const u=leaseUnit(lease);return `${leaseTenant(lease)?.full_name||leaseTenant(lease)?.email||'Tenant'} · ${unitLabel(u)}`;}
function setView(name){
  if(!state.allowed.has(name)){toast('This section is not available for your account.');return;}
  $$('.view').forEach(v=>v.classList.remove('active'));$(`#view-${name}`)?.classList.add('active');
  $$('.nav-link').forEach(link=>link.classList.toggle('active',link.dataset.view===name));
  const labels={overview:state.profile?.role==='tenant'?'My home':'Overview',properties:'Properties',tenants:'Tenants',agreements:'Agreements',caretakers:'Caretakers',maintenance:'Maintenance',payments:'Payments'};
  $('#crumb').textContent=labels[name]||'Overview';$('#sidebar').classList.remove('open');location.hash=name==='overview'?'overview':name;window.scrollTo(0,0);
}
function setRoleUI(){
  const role=state.profile.role;
  const permissions={landlord:['overview','properties','tenants','agreements','caretakers','maintenance','payments'],caretaker:['overview','properties','tenants','agreements','maintenance'],tenant:['overview','agreements','maintenance','payments']};
  state.allowed=new Set(permissions[role]||[]);
  $$('.nav-link').forEach(link=>{link.hidden=!state.allowed.has(link.dataset.view);});
  $$('.nav-label').forEach(el=>{const group=el.dataset.navLabel;const links=group==='manage'?$$('.nav-link[data-nav-group="manage"]'):$$('.nav-link:not([data-nav-group])');el.hidden=!links.some(link=>!link.hidden);});
  $$('[data-landlord-only]').forEach(el=>el.hidden=role!=='landlord');
  const allowedModals=role==='landlord'?new Set(['propertyModal','tenantModal','caretakerModal','agreementModal','maintenanceModal','paymentModal']):role==='caretaker'?new Set(['maintenanceModal']):new Set(['maintenanceModal','paymentModal']);
  $$('[data-modal]').forEach(el=>el.hidden=!allowedModals.has(el.dataset.modal));
  $('#workspaceTitle').textContent=role==='landlord'?'Landlord workspace':role==='caretaker'?'Caretaker workspace':'Tenant portal';
  const display=state.profile.full_name?.trim()||(role==='landlord'?'Yemilaz Properties':state.profile.email||`${role} account`);
  $$('.profile-name b').forEach(el=>el.textContent=display);
  $$('.profile-name small').forEach(el=>el.textContent=role[0].toUpperCase()+role.slice(1));
  const initials=display.split(/\s+/).slice(0,2).map(s=>s[0]||'').join('').toUpperCase();
  $$('.profile-chip .avatar,#logoutButton').forEach(el=>el.textContent=initials||'YP');
  const profileForm=$('#profileForm');if(profileForm){profileForm.elements.full_name.value=state.profile.full_name||'';$('#profileEmail').value=state.profile.email||'';$('#profileRole').value=role[0].toUpperCase()+role.slice(1);}
  $('#overviewGreeting').textContent=`${role==='tenant'?'Welcome':'Good day'}, ${(display.split(/\s+/)[0]||'Yemilaz')}`;
  $('#overviewSubheading').textContent=role==='tenant'?'Your home, documents, maintenance, and rent records.':role==='caretaker'?'Your assigned properties and active work.':'Your property portfolio and activity.';
  $$('.view').forEach(v=>{const n=v.id.replace('view-','');v.hidden=!state.allowed.has(n);});
  const initial=location.hash.slice(1);setView(state.allowed.has(initial)?initial:(role==='tenant'?'overview':'overview'));
}
function markLoading(){const box=$('#toast');box.textContent='Loading your Supabase records…';box.classList.add('show');setTimeout(()=>box.classList.remove('show'),1300);}

async function fetchRows(table,query='*'){
  const {data,error}=await client().from(table).select(query);
  if(error)throw new Error(`${table}: ${error.message}`);
  return data||[];
}
async function loadWorkspace(){
  markLoading();
  const tables=['properties','units','leases','profiles','property_caretakers','agreements','maintenance_requests','payments'];
  const results=await Promise.allSettled(tables.map(t=>fetchRows(t)));
  const failed=results.map((r,i)=>r.status==='rejected'?`${tables[i]}: ${r.reason.message}`:null).filter(Boolean);
  results.forEach((r,i)=>{if(r.status==='fulfilled')state[{properties:'properties',units:'units',leases:'leases',profiles:'profiles',property_caretakers:'assignments',agreements:'agreements',maintenance_requests:'maintenance',payments:'payments'}[tables[i]]]=r.value;});
  if(failed.length)toast(`Some records could not load. ${failed.join(' | ')}`);
  populateSelects();renderAll();
}

async function propertyImageUrl(path){
  if(!path)return '';
  const cached=state.propertyImageUrls.get(path);
  if(cached&&cached.expiresAt>Date.now()+30000)return cached.url;
  const {data,error}=await client().storage.from('property-images').createSignedUrl(path,3600);
  if(error){console.warn('Could not load property photo:',error.message);return '';}
  const result={url:data.signedUrl,expiresAt:Date.now()+3500000};state.propertyImageUrls.set(path,result);return result.url;
}
async function renderProperties(filter=''){
  const cards=$('#propertyCards');if(!cards)return;
  const q=filter.trim().toLowerCase();const list=state.properties.filter(p=>`${p.name} ${p.address} ${p.city} ${p.property_type}`.toLowerCase().includes(q));
  const renderId=++state.propertyRenderId;
  const imageUrls=await Promise.all(list.map(p=>propertyImageUrl(p.image_path)));
  if(renderId!==state.propertyRenderId)return;
  cards.innerHTML=list.map((p,i)=>{
    const units=state.units.filter(u=>u.property_id===p.id);const occupied=new Set(state.leases.filter(l=>l.status==='active').map(l=>l.unit_id));
    const caretakers=state.assignments.filter(a=>a.property_id===p.id).map(a=>personBy(a.caretaker_id)?.full_name).filter(Boolean).join(', ')||'No caretaker assigned';
    const photo=imageUrls[i];
    return `<article class="property-card"><div class="card-image thumb-${['one','two','three'][i%3]}${photo?' has-photo':''}">${photo?`<img src="${esc(photo)}" alt="Photo of ${esc(p.name)}" loading="lazy">`:''}<span class="card-type">${esc((p.property_type||'residential').replace('_',' ').toUpperCase())}</span>${state.profile?.role==='landlord'?`<button class="property-edit-button" type="button" data-action="property-edit" data-id="${esc(p.id)}">Edit</button>`:''}</div><div class="property-card-body"><h3>${esc(p.name)}</h3><p>⌖ &nbsp;${esc([p.address,p.city].filter(Boolean).join(', '))}</p><div class="card-stats"><span><b>${units.length}</b> total units</span><span><b>${units.filter(u=>occupied.has(u.id)).length}</b> occupied</span></div><div class="card-footer"><span>${money(p.monthly_rent)} <small style="font-weight:400;color:#929a92">/ month</small></span><small>${esc(caretakers)}</small></div></div></article>`;
  }).join('')||'<p class="muted">No properties yet. Use “Add property” to create your first record.</p>';
  $('#propertyCount').textContent=`${list.length} properties`;
  const count=$('.nav-link[data-view="properties"] em');if(count)count.textContent=state.properties.length;
  const filterTypes=$('#propertyTypeFilter')?.value||'';const filterCity=$('#propertyCityFilter')?.value||'';
  $$('.property-card',cards).forEach((card,i)=>{const p=list[i];if(p&&((filterTypes&&p.property_type!==filterTypes)||(filterCity&&p.city!==filterCity)))card.hidden=true;});
  const citySel=$('#propertyCityFilter');if(citySel){const current=citySel.value;const cities=[...new Set(state.properties.map(p=>p.city).filter(Boolean))].sort();citySel.innerHTML='<option value="">All locations</option>'+cities.map(c=>`<option>${esc(c)}</option>`).join('');citySel.value=current;}
}
function renderTenants(filter=''){
  const root=$('#tenantRows');if(!root)return;const q=filter.trim().toLowerCase();
  const rows=state.profiles.filter(p=>p.role==='tenant').map(p=>({p,lease:state.leases.find(l=>l.tenant_id===p.id&&l.status!=='ended')})).filter(x=>`${x.p.full_name} ${x.p.email} ${unitLabel(leaseUnit(x.lease))}`.toLowerCase().includes(q));
  root.innerHTML=rows.map(({p,lease})=>{const u=leaseUnit(lease);return `<tr><td><div class="tenant-cell"><span class="avatar avatar-blue">${esc((p.full_name||p.email||'?').split(/\s+/).map(a=>a[0]).slice(0,2).join('').toUpperCase())}</span><span><b>${esc(p.full_name||'Tenant')}</b><small class="tenant-email">${esc(p.email)}</small></span></div></td><td><b>${esc(unitProperty(u)?.name||'Not assigned')}</b><small class="table-sub">${esc(u?.unit_name||'—')}</small></td><td>${lease?`${dateText(lease.start_date)} – ${dateText(lease.end_date)}`:'No active lease'}</td><td>${lease?money(lease.annual_rent):'—'}</td><td><span class="activity-tag ${lease?.status==='active'?'tag-done':'tag-pending'}">${esc(lease?.status||'Invited')}</span></td><td></td></tr>`;}).join('')||'<tr><td colspan="6">No tenant profiles found.</td></tr>';
  $('#tenantCount').textContent=`${rows.length} tenants`;
  const navCount=$('.nav-link[data-view="tenants"] em');if(navCount)navCount.textContent=String(rows.length);
}
function renderCaretakers(){
  const root=$('#caretakerCards');if(!root)return;
  const people=state.profiles.filter(p=>p.role==='caretaker');
  root.innerHTML=people.map(p=>{const assigned=state.assignments.filter(a=>a.caretaker_id===p.id).map(a=>propertyBy(a.property_id)).filter(Boolean);const units=state.units.filter(u=>assigned.some(x=>x.id===u.property_id)).length;return `<article class="caretaker-card"><div class="caretaker-top"><span class="avatar avatar-blue">${esc((p.full_name||p.email).split(/\s+/).map(x=>x[0]).slice(0,2).join('').toUpperCase())}</span><div><h3>${esc(p.full_name||'Caretaker')}</h3><p>${esc(p.email)}</p></div></div><div class="caretaker-property"><span>Assigned units</span><b>${units}</b></div><div class="caretaker-contact">${esc(assigned.map(a=>a.name).join(', ')||'No assigned property')}</div></article>`;}).join('')||'<p class="muted">No caretakers invited yet.</p>';
}
function renderAgreements(){
  const root=$('#agreementRows');if(!root)return;
  const rows=state.agreements.map(a=>{const l=leaseBy(a.lease_id);return {a,l};}).filter(x=>x.l&& (state.profile.role==='landlord'||state.profile.role==='caretaker'||x.l.tenant_id===state.user.id));
  root.innerHTML=rows.map(({a,l})=>{const tenant=leaseTenant(l);let action=`<button class="text-button" data-action="agreement-open" data-id="${a.id}">Open</button>`;
    if(state.profile.role==='tenant'&&a.status==='sent')action+=` <button class="text-button" data-action="agreement-sign" data-id="${a.id}">Review & sign</button>`;
    if(state.profile.role==='landlord'&&a.status==='tenant_signed')action+=` <button class="text-button" data-action="agreement-activate" data-id="${a.id}">Mark active</button>`;
    return `<tr><td><b>${esc(tenant?.full_name||tenant?.email||'Tenant')}</b></td><td><b>${esc(unitProperty(leaseUnit(l))?.name||'Property')}</b><small class="table-sub">${esc(leaseUnit(l)?.unit_name||'Unit')}</small></td><td>${dateText(a.sent_at?.slice(0,10))}</td><td>${dateText(l.start_date)}</td><td><span class="activity-tag ${a.status==='active'?'tag-done':'tag-pending'}">${esc(a.status.replace('_',' '))}</span></td><td>${action}</td></tr>`;}).join('')||'<tr><td colspan="6">No agreements yet.</td></tr>';
  const dot=$('.nav-link[data-view="agreements"] .nav-dot');if(dot)dot.hidden=!rows.some(({a})=>['sent','tenant_signed'].includes(a.status));
}
function renderMaintenance(){
  const root=$('#maintenanceRows');if(!root)return;
  const list=state.maintenance.slice().sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
  root.innerHTML=list.map(r=>{const u=unitBy(r.unit_id),p=unitProperty(u),reporter=personBy(r.reported_by);const action=state.profile.role==='tenant'?'':`<select data-action="maintenance-status" data-id="${r.id}"><option value="open" ${r.status==='open'?'selected':''}>Open</option><option value="in_progress" ${r.status==='in_progress'?'selected':''}>In progress</option><option value="resolved" ${r.status==='resolved'?'selected':''}>Resolved</option></select>`;return `<tr><td><b>${esc(r.title)}</b><small class="table-sub">${esc(r.description||'')}</small></td><td>${esc(p?.name||'Property')} · ${esc(u?.unit_name||'Unit')}</td><td>${esc(reporter?.full_name||reporter?.email||'User')}</td><td>${dateText(r.created_at?.slice(0,10))}</td><td><span class="activity-tag ${r.priority==='urgent'?'tag-pending':'tag-paid'}">${esc(r.priority)}</span></td><td><span class="activity-tag ${r.status==='resolved'?'tag-done':'tag-pending'}">${esc(r.status.replace('_',' '))}</span> ${action}</td></tr>`;}).join('')||'<tr><td colspan="6">No maintenance requests yet.</td></tr>';
  const count=$('.nav-link[data-view="maintenance"] em');if(count)count.textContent=String(list.filter(r=>r.status!=='resolved').length);
  $('#maintenanceOpen').textContent=list.filter(x=>x.status==='open').length;$('#maintenanceProgress').textContent=list.filter(x=>x.status==='in_progress').length;$('#maintenanceResolved').textContent=list.filter(x=>x.status==='resolved').length;
}
function renderPayments(){
  const root=$('#paymentRows');if(!root)return;const list=state.payments.slice().sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
  root.innerHTML=list.map(p=>{const l=leaseBy(p.lease_id),tenant=leaseTenant(l),u=leaseUnit(l);let action='';if(state.profile.role==='landlord'&&p.status==='pending')action=`<button class="text-button" data-action="payment-confirm" data-id="${p.id}">Confirm</button> <button class="text-button" data-action="payment-reject" data-id="${p.id}">Reject</button>`;return `<tr><td>${esc(tenant?.full_name||tenant?.email||'Tenant')}</td><td>${esc(unitProperty(u)?.name||'Property')} · ${esc(u?.unit_name||'Unit')}</td><td>${dateText(p.due_date)}</td><td>${money(p.amount)}</td><td>${esc(p.method.replace('_',' '))}<small class="table-sub">${esc(p.reference||'—')}</small></td><td><span class="activity-tag ${p.status==='confirmed'?'tag-done':'tag-pending'}">${esc(p.status)}</span> ${action}</td></tr>`;}).join('')||'<tr><td colspan="6">No payment records yet.</td></tr>';
  const confirmed=list.filter(p=>p.status==='confirmed').reduce((s,p)=>s+Number(p.amount),0);const pending=list.filter(p=>p.status==='pending').reduce((s,p)=>s+Number(p.amount),0);
  $('#paymentsConfirmed').textContent=money(confirmed);$('#paymentsPending').textContent=money(pending);$('#paymentsCount').textContent=String(list.length);
}
function renderOverview(){
  const cards=$$('#view-overview .stats-grid .stat-card');if(!cards.length)return;
  const role=state.profile.role;
  const unitCount=state.units.length, activeLeases=state.leases.filter(l=>l.status==='active');
  const mainGrid=$('#view-overview .content-grid');
  if(role==='tenant'){
    const lease=state.leases.find(l=>l.tenant_id===state.user.id&&l.status!=='ended');
    const unit=leaseUnit(lease),property=unitProperty(unit);
    cards[0].querySelector('.stat-head span').textContent='My rental';cards[0].querySelector('.stat-number').innerHTML=`${esc(unit?.unit_name||'Not assigned')} <small>${esc(property?.name||'unit')}</small>`;cards[0].querySelector('.stat-foot').textContent=lease?`Lease ${lease.status.replace('_',' ')}`:'No lease assigned yet';
    cards[1].querySelector('.stat-head span').textContent='Annual rent';cards[1].querySelector('.stat-number').textContent=money(lease?.annual_rent||0);cards[1].querySelector('.occupancy-track').hidden=true;cards[1].querySelector('.stat-foot').textContent=lease?`${dateText(lease.start_date)} – ${dateText(lease.end_date)}`:'Your lease dates will appear here';
    cards[2].querySelector('.stat-head span').textContent='Payment records';cards[2].querySelector('.stat-number').textContent=String(state.payments.length);cards[2].querySelector('.stat-foot').textContent=`${state.payments.filter(p=>p.status==='confirmed').length} confirmed · ${state.payments.filter(p=>p.status==='pending').length} awaiting confirmation`;
    cards[3].querySelector('.stat-head span').textContent='Maintenance requests';cards[3].querySelector('.stat-number').textContent=String(state.maintenance.filter(r=>r.status!=='resolved').length);cards[3].querySelector('.stat-foot').textContent='Open requests on your account';
    if(mainGrid)mainGrid.innerHTML=`<section class="panel properties-panel"><div class="panel-heading"><div><h2>My home</h2><p>Your current rental details</p></div></div>${lease?`<div class="property-row"><div class="property-thumb thumb-one"><span>RENTAL</span></div><div class="property-main"><h3>${esc(property?.name||'Property')}</h3><p>${esc([property?.address,property?.city].filter(Boolean).join(', '))}</p></div><div class="property-status">${esc(unit?.unit_name||'Unit')}</div><div class="property-rent">${money(lease.annual_rent)} <small>/ year</small></div></div>`:'<p class="muted">Your landlord has not assigned a unit yet.</p>'}<p class="subheading" style="margin-top:16px">Use the menu to open your agreement, report maintenance, or submit a rent payment record.</p></section>`;
    $('#view-overview .activity-panel')?.setAttribute('hidden','');return;
  }
  if(mainGrid){if(!$('.property-list',mainGrid))mainGrid.innerHTML=overviewGridTemplate;mainGrid.hidden=false;}
  $('#view-overview .activity-panel')?.setAttribute('hidden','');
  cards[0].querySelector('.stat-number').innerHTML=`${state.properties.length} <small>properties</small>`;cards[0].querySelector('.stat-foot').textContent='Live Supabase records';
  cards[1].querySelector('.stat-number').innerHTML=`${activeLeases.length} <small>of ${unitCount} units</small>`;cards[1].querySelector('.occupancy-track').hidden=true;cards[1].querySelector('.stat-foot').textContent=`${Math.max(0,unitCount-activeLeases.length)} available units`;
  const collected=state.payments.filter(p=>p.status==='confirmed').reduce((s,p)=>s+Number(p.amount),0);cards[2].querySelector('.stat-number').textContent=money(collected);cards[2].querySelector('.stat-foot').textContent='Confirmed rent payment records';
  const needs=state.maintenance.filter(r=>r.status!=='resolved').length+state.agreements.filter(a=>['sent','tenant_signed'].includes(a.status)).length;cards[3].querySelector('.stat-number').innerHTML=`${needs} <small>items</small>`;cards[3].querySelector('.stat-foot').textContent=`${state.agreements.filter(a=>['sent','tenant_signed'].includes(a.status)).length} agreements · ${state.maintenance.filter(r=>r.status!=='resolved').length} requests`;
  const list=$('#view-overview .property-list');if(list)list.innerHTML=state.properties.slice(0,3).map(p=>`<article class="property-row"><div class="property-thumb thumb-one"><span>${esc((p.property_type||'').toUpperCase())}</span></div><div class="property-main"><h3>${esc(p.name)}</h3><p>${esc([p.address,p.city].filter(Boolean).join(', '))} · ${state.units.filter(u=>u.property_id===p.id).length} units</p></div><div class="property-status">${state.units.filter(u=>u.property_id===p.id).length} units</div><div class="property-rent">${money(p.monthly_rent)} <small>/ month</small></div></article>`).join('')||'<p class="muted">No properties yet. Add your first property.</p>';
  $('#todayLabel').textContent=new Intl.DateTimeFormat('en-NG',{weekday:'long',day:'2-digit',month:'long',year:'numeric',timeZone:'Africa/Lagos'}).format(new Date()).toUpperCase();
}
function populateSelects(){
  const vacant=state.units.filter(u=>!state.leases.some(l=>l.unit_id===u.id&&l.status!=='ended'));
  const tenantUnit=$('#tenantUnitSelect');if(tenantUnit)tenantUnit.innerHTML=optionMarkup(vacant,u=>unitLabel(u))||'<option value="">No vacant units available</option>';
  const caretakerProps=$('#caretakerPropertySelect');if(caretakerProps)caretakerProps.innerHTML=optionMarkup(state.properties,p=>p.name)||'<option value="">Add a property first</option>';
  const leaseOptions=state.leases.filter(l=>l.status!=='ended');
  ['agreementLeaseSelect','paymentLeaseSelect'].forEach(id=>{const el=$(`#${id}`);if(el)el.innerHTML=optionMarkup(leaseOptions,l=>leaseLabel(l))||'<option value="">No lease available</option>';});
  const maintenanceUnits=$('#maintenanceUnitSelect');if(maintenanceUnits)maintenanceUnits.innerHTML=optionMarkup(state.units,u=>unitLabel(u))||'<option value="">Add a property and unit first</option>';
}
function renderAll(){renderProperties($('#propertySearch')?.value||'');renderTenants($('#tenantSearch')?.value||'');renderCaretakers();renderAgreements();renderMaintenance();renderPayments();renderOverview();}

function propertyPhotoFile(form){
  const file=new FormData(form).get('photo');
  if(!(file instanceof File)||!file.size)return null;
  if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw new Error('Choose a JPG, PNG, or WebP property photo.');
  if(file.size>5*1024*1024)throw new Error('Property photos must be 5 MB or smaller.');
  return file;
}
async function uploadPropertyPhoto(propertyId,file){
  if(!file)return null;
  const ext={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[file.type];
  const path=`${propertyId}/${crypto.randomUUID()}.${ext}`;
  const {error}=await client().storage.from('property-images').upload(path,file,{contentType:file.type,upsert:false,cacheControl:'3600'});
  if(error)throw error;
  return path;
}
async function resizePropertyUnits(propertyId,count,monthlyRent){
  const existing=state.units.filter(unit=>unit.property_id===propertyId);
  if(count===existing.length)return;
  if(count>existing.length){
    const names=new Set(existing.map(unit=>unit.unit_name));const additions=[];
    while(existing.length+additions.length<count){let n=1;while(names.has(`Unit ${n}`))n++;const unitName=`Unit ${n}`;names.add(unitName);additions.push({property_id:propertyId,unit_name:unitName,monthly_rent:count?monthlyRent/count:0});}
    const {error}=await client().from('units').insert(additions);if(error)throw error;return;
  }
  const canRemove=existing.filter(unit=>!state.leases.some(lease=>lease.unit_id===unit.id)&&!state.maintenance.some(request=>request.unit_id===unit.id)).sort((a,b)=>b.unit_name.localeCompare(a.unit_name,'en',{numeric:true}));
  const removeCount=existing.length-count;
  if(canRemove.length<removeCount)throw new Error('The unit count cannot be reduced because the extra units have lease or maintenance records. Their history has been kept.');
  const ids=canRemove.slice(0,removeCount).map(unit=>unit.id);const {error}=await client().from('units').delete().in('id',ids);if(error)throw error;
}
function showPropertyPhotoPreview(url){
  const image=$('#propertyImagePreview');if(!image)return;
  if(url){image.src=url;image.hidden=false;}else{image.removeAttribute('src');image.hidden=true;}
}
function prepareAddProperty(){
  const form=$('#propertyForm');form.reset();delete form.dataset.editId;
  $('#propertyModalTitle').textContent='Add a property';$('#propertyUnitsField').hidden=false;
  $('#propertyPhotoHint').textContent='Optional. JPG, PNG, or WebP, up to 5 MB.';
  $('#savePropertyButton').textContent='Save property';showPropertyPhotoPreview('');
}
async function prepareEditProperty(property){
  const form=$('#propertyForm');form.reset();form.dataset.editId=property.id;
  form.elements.name.value=property.name||'';form.elements.type.value=property.property_type||'residential';
  form.elements.address.value=property.address||'';form.elements.city.value=property.city||'';
  form.elements.rent.value=Number(property.monthly_rent)||0;
  $('#propertyModalTitle').textContent='Edit property';$('#propertyUnitsField').hidden=false;
  form.elements.units.value=String(state.units.filter(unit=>unit.property_id===property.id).length||1);
  $('#propertyPhotoHint').textContent='Choose a new photo to replace the current one. Leave blank to keep it.';
  $('#savePropertyButton').textContent='Save changes';showPropertyPhotoPreview('');
  if(property.image_path)showPropertyPhotoPreview(await propertyImageUrl(property.image_path));
  $('#propertyModal').showModal();
}
async function submitProperty(form){
  const d=new FormData(form),file=propertyPhotoFile(form),editId=form.dataset.editId;
  const values={name:String(d.get('name')||'').trim(),property_type:d.get('type'),address:String(d.get('address')||'').trim(),city:String(d.get('city')||'').trim()||null,monthly_rent:Number(d.get('rent'))||0};
  if(editId){
    const unitCount=Math.min(200,Math.max(1,Number(d.get('units'))||1));
    const current=propertyBy(editId);if(!current)throw new Error('This property is no longer available. Refresh the page and try again.');
    let newPath=null;
    if(file)newPath=await uploadPropertyPhoto(editId,file);
    const {error}=await client().from('properties').update({...values,...(newPath?{image_path:newPath}:{})}).eq('id',editId);
    if(error){if(newPath)await client().storage.from('property-images').remove([newPath]);throw propertySchemaError(error);}
    if(newPath&&current.image_path){state.propertyImageUrls.delete(current.image_path);const removed=await client().storage.from('property-images').remove([current.image_path]);if(removed.error)console.warn('Old property photo could not be removed:',removed.error.message);}
    try{await resizePropertyUnits(editId,unitCount,values.monthly_rent);}catch(error){await loadWorkspace();throw new Error(`Property details were saved, but its unit count was not changed. ${error.message}`);}
    await loadWorkspace();toast('Property details updated. Existing tenant agreements are unchanged.');return;
  }
  const unitCount=Math.min(200,Math.max(1,Number(d.get('units'))||1));
  const {data:p,error}=await client().from('properties').insert({landlord_id:state.user.id,...values}).select().single();
  if(error)throw propertySchemaError(error);
  const units=Array.from({length:unitCount},(_,i)=>({property_id:p.id,unit_name:`Unit ${i+1}`,monthly_rent:unitCount?(values.monthly_rent/unitCount):0}));
  const unitResult=await client().from('units').insert(units);
  if(unitResult.error)throw new Error(`Property saved, but unit creation failed: ${unitResult.error.message}`);
  if(file){
    let path;
    try{path=await uploadPropertyPhoto(p.id,file);const {error:imageError}=await client().from('properties').update({image_path:path}).eq('id',p.id);if(imageError)throw imageError;}
    catch(error){if(path)await client().storage.from('property-images').remove([path]);await loadWorkspace();throw new Error(`Property and units were saved, but its photo was not. You can edit the property and try again. ${propertySchemaError(error).message}`);}
  }
  await loadWorkspace();toast('Property and units saved.');
}
async function invokeFunction(name,body){const {data,error}=await client().functions.invoke(name,{body});if(error)throw new Error(`${name} function: ${error.message}. Deploy the function and set its Supabase secrets.`);if(data?.error)throw new Error(data.error);return data;}
async function submitTenant(form){
  const d=new FormData(form);if(!d.get('unit_id'))throw new Error('Add a property and unit before inviting a tenant.');
  await invokeFunction('invite-member',{role:'tenant',email:d.get('email').trim(),full_name:d.get('name').trim(),unit_id:d.get('unit_id'),start_date:d.get('start_date'),end_date:d.get('end_date'),annual_rent:Number(d.get('annual_rent'))});
  await loadWorkspace();toast('Tenant invitation sent by email and lease created.');
}
async function submitCaretaker(form){const d=new FormData(form),property_ids=d.getAll('property_ids');if(!property_ids.length)throw new Error('Choose at least one property for the caretaker.');await invokeFunction('invite-member',{role:'caretaker',email:d.get('email').trim(),full_name:d.get('name').trim(),property_ids});await loadWorkspace();toast('Caretaker invitation sent and access assigned.');}
async function submitAgreement(form){
  const d=new FormData(form),lease=leaseBy(d.get('lease_id')),file=d.get('document');if(!lease)throw new Error('Choose an active lease.');if(!(file instanceof File)||!file.size)throw new Error('Choose a PDF agreement.');if(file.size>15*1024*1024)throw new Error('Agreement PDFs must be 15 MB or smaller.');
  const safeName=file.name.replace(/[^a-zA-Z0-9._-]/g,'_');const path=`${lease.id}/${crypto.randomUUID()}_${safeName}`;
  const uploaded=await client().storage.from('rental-agreements').upload(path,file,{contentType:'application/pdf',upsert:false});if(uploaded.error)throw uploaded.error;
  const {data:agreement,error}=await client().from('agreements').insert({lease_id:lease.id,uploaded_by:state.user.id,storage_path:path,status:'sent',sent_at:new Date().toISOString()}).select().single();
  if(error){await client().storage.from('rental-agreements').remove([path]);throw error;}
  await loadWorkspace();
  try{await invokeFunction('notify-agreement',{agreement_id:agreement.id});toast('Agreement uploaded privately and email notification sent.');}
  catch(e){toast(`Agreement is saved in the tenant portal, but email was not sent: ${e.message}`);}
}
async function submitMaintenance(form){const d=new FormData(form);const {error}=await client().from('maintenance_requests').insert({unit_id:d.get('unit_id'),reported_by:state.user.id,title:d.get('title').trim(),description:d.get('description').trim()||null,priority:d.get('priority'),status:'open'});if(error)throw error;await loadWorkspace();toast('Maintenance request saved.');}
async function submitPayment(form){const d=new FormData(form),tenant=state.profile.role==='tenant';const record={lease_id:d.get('lease_id'),amount:Number(d.get('amount')),due_date:d.get('due_date'),method:d.get('method'),reference:d.get('reference').trim()||null,reported_by:state.user.id,status:tenant?'pending':'confirmed'};if(!tenant){record.paid_at=new Date().toISOString();record.verified_by=state.user.id;}const {error}=await client().from('payments').insert(record);if(error)throw error;await loadWorkspace();toast(tenant?'Payment details submitted for landlord confirmation.':'Payment recorded as confirmed.');}

async function actionClick(event){const button=event.target.closest('[data-action]');if(!button)return;const {action,id}=button.dataset;
  try{
    if(action==='property-edit'){if(state.profile?.role!=='landlord')throw new Error('Only the landlord can edit properties.');const property=propertyBy(id);if(!property)throw new Error('Property not found.');await prepareEditProperty(property);}
    if(action==='agreement-open'){const a=state.agreements.find(x=>x.id===id);if(!a)throw new Error('Agreement not found.');const tab=window.open('about:blank','_blank');const {data,error}=await client().storage.from('rental-agreements').createSignedUrl(a.storage_path,120);if(error){tab?.close();throw error;}if(tab){tab.opener=null;tab.location=data.signedUrl;}else toast('Your browser blocked the new tab. Allow pop-ups and try again.');}
    if(action==='agreement-sign'){const signedName=prompt('Type your full legal name to acknowledge this agreement:');if(!signedName?.trim())return;const {error}=await client().from('agreements').update({status:'tenant_signed',signed_name:signedName.trim()}).eq('id',id);if(error)throw error;await loadWorkspace();toast('Your acknowledgement was recorded.');}
    if(action==='agreement-activate'){const agreement=state.agreements.find(a=>a.id===id);const {error:leaseError}=await client().from('leases').update({status:'active'}).eq('id',agreement?.lease_id);if(leaseError)throw leaseError;const {error}=await client().from('agreements').update({status:'active'}).eq('id',id);if(error)throw error;await loadWorkspace();toast('Lease and agreement marked active.');}
    if(action==='payment-confirm'||action==='payment-reject'){const status=action==='payment-confirm'?'confirmed':'rejected';const {error}=await client().from('payments').update({status,verified_by:state.user.id,paid_at:status==='confirmed'?new Date().toISOString():null}).eq('id',id);if(error)throw error;await loadWorkspace();toast(`Payment ${status}.`);}
  }catch(e){toast(e.message||'Could not complete this action.');}
}
async function actionChange(event){const el=event.target.closest('[data-action="maintenance-status"]');if(!el)return;try{const {error}=await client().from('maintenance_requests').update({status:el.value,resolved_at:el.value==='resolved'?new Date().toISOString():null}).eq('id',el.dataset.id);if(error)throw error;await loadWorkspace();toast('Maintenance status updated.');}catch(e){toast(e.message||'Could not update the request.');}}

function showAuthError(message){$('#authError').textContent=message||'';}
async function handleSession(session){
  state.user=session.user;
  const {data:profile,error}=await client().from('profiles').select('id,full_name,email,role').eq('id',session.user.id).maybeSingle();
  if(error||!profile){$('#loginForm').hidden=true;$('#authSetup').hidden=true;$('#roleMessage').hidden=false;$('#roleMessageText').textContent=error?`Could not load your profile: ${error.message}`:'Your profile row is missing. Ask the landlord to invite this account again.';return;}
  if(!['landlord','caretaker','tenant'].includes(profile.role)){showAuthError('This account has an unsupported role. Ask the landlord to update it.');return;}
  state.profile=profile;$('#authGate').hidden=true;document.body.classList.remove('auth-loading');document.body.classList.add('connected-mode');setRoleUI();await loadWorkspace();
}
async function initializeAuth(){
  const db=client();if(!db){$('#authGate').hidden=false;$('#loginForm').hidden=true;$('#authSetup').hidden=false;return;}
  $('#authGate').hidden=false;document.body.classList.add('auth-loading');
  $('#loginForm').addEventListener('submit',async e=>{e.preventDefault();showAuthError('');const d=new FormData(e.currentTarget);const {error}=await db.auth.signInWithPassword({email:d.get('email'),password:d.get('password')});if(error)showAuthError(error.message);});
  $('#resetPassword').addEventListener('click',async()=>{const email=$('#loginForm [name=email]').value;if(!email){showAuthError('Enter your email address first.');return;}const {error}=await db.auth.resetPasswordForEmail(email,{redirectTo:`${location.origin}${location.pathname}`});showAuthError(error?`Could not send reset email: ${error.message}`:'Password reset email sent.');});
  $('#recoveryForm').addEventListener('submit',async e=>{e.preventDefault();const d=new FormData(e.currentTarget),err=$('#recoveryError');err.textContent='';if(d.get('password')!==d.get('confirmPassword')){err.textContent='Passwords do not match.';return;}const {error}=await db.auth.updateUser({password:d.get('password')});if(error){err.textContent=error.message;return;}await db.auth.signOut();err.textContent='Password updated. Sign in again.';});
  db.auth.onAuthStateChange((event,session)=>{setTimeout(()=>{if(event==='PASSWORD_RECOVERY'){$('#loginForm').hidden=true;$('#recoveryForm').hidden=false;$('#authTitle').textContent='Choose a new password';$('#authSubtitle').textContent='Use at least eight characters.';}else if(session)handleSession(session);else{state.user=null;state.profile=null;document.body.classList.remove('connected-mode');$('#roleMessage').hidden=true;$('#recoveryForm').hidden=true;$('#loginForm').hidden=false;$('#authGate').hidden=false;document.body.classList.add('auth-loading');}},0);});
  $('#signOutButton').addEventListener('click',()=>db.auth.signOut());$('#logoutButton').addEventListener('click',()=>db.auth.signOut());
  const {data:{session}}=await db.auth.getSession();if(session)await handleSession(session);
}

$$('[data-view]').forEach(link=>link.addEventListener('click',e=>{e.preventDefault();setView(link.dataset.view);}));
$$('[data-view-link]').forEach(el=>el.addEventListener('click',()=>setView(el.dataset.viewLink)));
$$('[data-modal]').forEach(button=>button.addEventListener('click',()=>{if(button.hidden)return;populateSelects();const d=$(`#${button.dataset.modal}`);if(d&&!d.hidden){if(d.id==='propertyModal')prepareAddProperty();d.showModal();}}));
$('#mobileMenu').addEventListener('click',()=>$('#sidebar').classList.toggle('open'));
$('#profileButton').addEventListener('click',()=>$('#profileModal').showModal());
$('#propertySearch').addEventListener('input',e=>renderProperties(e.target.value));$('#propertyTypeFilter').addEventListener('change',()=>renderProperties($('#propertySearch').value));$('#propertyCityFilter').addEventListener('change',()=>renderProperties($('#propertySearch').value));$('#tenantSearch').addEventListener('input',e=>renderTenants(e.target.value));
let propertyPreviewUrl='';
$('#propertyPhotoInput').addEventListener('change',e=>{if(propertyPreviewUrl)URL.revokeObjectURL(propertyPreviewUrl);propertyPreviewUrl='';const file=e.target.files?.[0];if(file){propertyPreviewUrl=URL.createObjectURL(file);showPropertyPhotoPreview(propertyPreviewUrl);}else if(!$('#propertyForm').dataset.editId)showPropertyPhotoPreview('');});
$('.modal-close', $('#propertyModal')).addEventListener('click',()=>{if(propertyPreviewUrl)URL.revokeObjectURL(propertyPreviewUrl);propertyPreviewUrl='';prepareAddProperty();$('#propertyModal').close();});
$('#propertyForm').addEventListener('submit',async e=>{const form=e.currentTarget;if(e.submitter?.value==='cancel'){if(propertyPreviewUrl)URL.revokeObjectURL(propertyPreviewUrl);propertyPreviewUrl='';prepareAddProperty();return;}e.preventDefault();try{await submitProperty(form);form.closest('dialog').close();if(propertyPreviewUrl)URL.revokeObjectURL(propertyPreviewUrl);propertyPreviewUrl='';prepareAddProperty();}catch(error){toast(error.message||'Could not save property.');}});
$('#tenantForm').addEventListener('submit',async e=>{if(e.submitter?.value==='cancel')return;e.preventDefault();try{await submitTenant(e.currentTarget);e.currentTarget.closest('dialog').close();e.currentTarget.reset();}catch(error){toast(error.message||'Could not invite tenant.');}});
$('#caretakerForm').addEventListener('submit',async e=>{if(e.submitter?.value==='cancel')return;e.preventDefault();try{await submitCaretaker(e.currentTarget);e.currentTarget.closest('dialog').close();e.currentTarget.reset();}catch(error){toast(error.message||'Could not invite caretaker.');}});
$('#agreementForm').addEventListener('submit',async e=>{if(e.submitter?.value==='cancel')return;e.preventDefault();const button=e.submitter;button.disabled=true;try{await submitAgreement(e.currentTarget);e.currentTarget.closest('dialog').close();e.currentTarget.reset();}catch(error){toast(error.message||'Could not send agreement.');}finally{button.disabled=false;}});
$('#maintenanceForm').addEventListener('submit',async e=>{if(e.submitter?.value==='cancel')return;e.preventDefault();try{await submitMaintenance(e.currentTarget);e.currentTarget.closest('dialog').close();e.currentTarget.reset();}catch(error){toast(error.message||'Could not save request.');}});
$('#paymentForm').addEventListener('submit',async e=>{if(e.submitter?.value==='cancel')return;e.preventDefault();try{await submitPayment(e.currentTarget);e.currentTarget.closest('dialog').close();e.currentTarget.reset();}catch(error){toast(error.message||'Could not save payment.');}});
$('#profileForm').addEventListener('submit',async e=>{if(e.submitter?.value==='cancel')return;e.preventDefault();const name=new FormData(e.currentTarget).get('full_name').trim();try{const {error}=await client().from('profiles').update({full_name:name}).eq('id',state.user.id);if(error)throw error;state.profile.full_name=name;const own=state.profiles.find(p=>p.id===state.user.id);if(own)own.full_name=name;setRoleUI();e.currentTarget.closest('dialog').close();toast('Profile saved.');}catch(error){toast(error.message||'Could not save profile.');}});
document.addEventListener('click',actionClick);document.addEventListener('change',actionChange);

initializeAuth();
