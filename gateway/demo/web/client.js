import {requestPath} from '/mutation.js';
const $=id=>document.getElementById(id),money=n=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(n);
const date=s=>new Intl.DateTimeFormat('en-IN',{day:'numeric',month:'short',year:'numeric',timeZone:'Asia/Kolkata'}).format(new Date(s));
let clientId;try{clientId=localStorage.getItem('encore-client');if(!/^[a-f0-9-]{36}$/.test(clientId||'')){clientId=crypto.randomUUID();localStorage.setItem('encore-client',clientId);}}catch{clientId=crypto.randomUUID();}
const pageId=crypto.randomUUID();let config,offset=0,category='All',searchVersion=0,viewVersion=0,activeEvent=null,selected=new Set(),seatBusy=false,bookingBusy=false,bookingRequest=null,cancelId=null;
let tokenMode='current',modeVersion=0,mutationCount=0;
const modeHelp={
 current:'Valid token: requests are accepted and the website works normally.',
 previous:'Previous token: accepted by the gateway’s one-window grace period.',
 invalid:'Invalid token: requests receive HTTP 404 at the gateway. The backend is not invoked.',
 expired:'Expired token: three windows old; requests are blocked with HTTP 404.',
 future:'Future token: not valid yet; requests are blocked with HTTP 404.',
 missing:'Missing token: plain API URLs are blocked with HTTP 404.'
};
// Also allow changing mode inside the modal to test a booking after selecting seats.
const modeBox=document.createElement('div');modeBox.className='modal-token-mode';
const modeLabel=document.createElement('label');modeLabel.htmlFor='booking-token-mode';modeLabel.textContent='Request token';
const modalMode=$('token-mode').cloneNode(true);modalMode.id='booking-token-mode';modalMode.removeAttribute('aria-describedby');
modeBox.append(modeLabel,modalMode);$('booking-form').prepend(modeBox);
function lockModes(){for(const select of [$('token-mode'),modalMode])select.disabled=mutationCount>0;}
async function changeMode(event){
 tokenMode=event.target.value;modeVersion++;searchVersion++;ticketsVersion++;viewVersion++;
 $('token-mode').value=modalMode.value=tokenMode;$('token-help').textContent=modeHelp[tokenMode];
 notice('');$('booking-error').textContent='';
 // Existing content stays visible but is explicitly identified as previously loaded.
 if(activeEvent){$('booking-error').textContent=modeHelp[tokenMode];if(!seatBusy)await seats();}
 else {await route();if(location.hash!=='#tickets')await showTickets();}
}
$('token-mode').addEventListener('change',changeMode);modalMode.addEventListener('change',changeMode);
function node(tag,text,cls){const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(cls)el.className=cls;return el;}
function notice(message){$('notice').textContent=message;$('notice').hidden=!message;}
async function configure(){const r=await fetch('/demo/client-config',{cache:'no-store',signal:AbortSignal.timeout(5000)});if(!r.ok)throw new Error('The service is unavailable. Please try again.');config=await r.json();offset=config.serverTime-Date.now();}
async function api(method,route,body){
 const mode=tokenMode,version=modeVersion;
 if(!config)await configure();
 const path=await requestPath(config.seed,Math.floor(Date.now()+offset),config.windowSeconds,route,mode);
 const writing=method!=='GET';if(writing){mutationCount++;lockModes();}
 try{
 const r=await fetch(path,{method,headers:{'Content-Type':'application/json','X-Demo-Source':'client','X-Demo-Page-ID':pageId,'X-Demo-Client-ID':clientId,'X-Demo-Request-ID':crypto.randomUUID()},body:body===undefined?undefined:JSON.stringify(body),cache:'no-store',signal:AbortSignal.timeout(10000)});
 const text=await r.text();let data;try{data=JSON.parse(text);}catch{data={error:'The request could not be completed. Please try again.'};}
 if(version!==modeVersion)throw Object.assign(new Error('Token mode changed'),{stale:true});
 if(r.status===404&&['invalid','expired','future','missing'].includes(mode))data.error=modeHelp[mode]+' Previously loaded content is unchanged. Select Valid token to resume.';
 if(!r.ok)throw Object.assign(new Error(data.error||'Request failed'),{status:r.status});return data;
 }finally{if(writing){mutationCount--;lockModes();}}
}
function poster(event){const el=node('div',undefined,'poster '+event.theme);el.append(node('small',event.category.toUpperCase()+' / ENCORE ORIGINALS'),node('strong',event.mark),node('span',event.city.toUpperCase()+' · '+date(event.date).toUpperCase()));return el;}
async function discover(){
 const version=++searchVersion;$('results-label').textContent='Finding experiences…';
 try{
  const data=await api('GET','events?'+new URLSearchParams({q:$('search').value,category,city:$('city').value,month:$('month').value,max:$('budget').value}));
  if(version!==searchVersion)return;
  $('event-grid').replaceChildren();$('empty').hidden=data.events.length>0;$('results-label').textContent=data.events.length+' experiences to make your own';
  for(const event of data.events){
   const card=node('button',undefined,'event-card');card.setAttribute('aria-label','View '+event.title);card.append(poster(event));
   const content=node('div',undefined,'card-content');content.append(node('p',event.category.toUpperCase(),'eyebrow'),node('h3',event.title),node('p',date(event.date)+' · '+event.venue),node('p',event.subtitle));
   const bottom=node('div',undefined,'card-bottom');bottom.append(node('strong',money(event.price)),node('span',event.available?event.available+' seats available ↗':'Sold out'));content.append(bottom);card.append(content);card.addEventListener('click',()=>openEvent(event.id));$('event-grid').append(card);
  }
 }catch(e){if(version===searchVersion&&!e.stale){$('results-label').textContent='Refresh failed — showing previously loaded events, if any.';notice(e.message);}}
}
async function openEvent(id){
 const version=++viewVersion;notice('');
 try{const {event}=await api('GET','events/'+id);if(version!==viewVersion)return;activeEvent=event;selected.clear();bookingRequest=null;
 $('detail-poster').replaceChildren(poster(event));$('detail-title').textContent=event.title;$('detail-category').textContent=event.category.toUpperCase();
 $('detail-meta').textContent=date(event.date)+' · '+new Intl.DateTimeFormat('en-IN',{hour:'numeric',minute:'2-digit',timeZone:'Asia/Kolkata'}).format(new Date(event.date))+' IST · '+event.venue+', '+event.city;
 $('detail-description').textContent=event.description;$('attendee').value='';$('booking-error').textContent='';$('seat-map').replaceChildren();updateTotal();$('event-dialog').showModal();await seats();
 }catch(e){if(!e.stale)notice(e.message);}
}
function updateTotal(){$('selected-seats').textContent=selected.size?'Seats '+[...selected].join(', '):'No seats selected';$('booking-total').textContent=money(selected.size*(activeEvent?.price||0));$('confirm-booking').disabled=!selected.size||bookingBusy;}
async function seats(){
 if(!activeEvent||seatBusy)return;seatBusy=true;const id=activeEvent.id;
 try{const data=await api('GET','events/'+id+'/seats');if(activeEvent?.id!==id||bookingBusy)return;
 const lost=[...selected].some(s=>!data.seats.find(x=>x.id===s)?.available);if(lost){selected=new Set([...selected].filter(s=>data.seats.find(x=>x.id===s)?.available));bookingRequest=null;$('booking-error').textContent='Availability changed. Some selected seats are no longer available.';}
 $('seat-map').replaceChildren();
 for(const seat of data.seats){const button=node('button',seat.id,selected.has(seat.id)?'selected':'');button.type='button';button.disabled=!seat.available;button.setAttribute('aria-label','Seat '+seat.id+(seat.available?'':' booked'));button.setAttribute('aria-pressed',String(selected.has(seat.id)));
 button.addEventListener('click',()=>{if(selected.has(seat.id))selected.delete(seat.id);else if(selected.size<6)selected.add(seat.id);else{$('booking-error').textContent='You can select up to six seats.';return;}bookingRequest=null;button.classList.toggle('selected',selected.has(seat.id));button.setAttribute('aria-pressed',String(selected.has(seat.id)));$('booking-error').textContent='';updateTotal();});$('seat-map').append(button);}updateTotal();
 }catch(e){if(!e.stale)$('booking-error').textContent=e.message;}finally{seatBusy=false;}
}
$('booking-form').addEventListener('submit',async e=>{
 e.preventDefault();if(bookingBusy||!selected.size||!activeEvent)return;bookingBusy=true;updateTotal();$('attendee').disabled=true;$('close-dialog').disabled=true;
 document.querySelectorAll('#seat-map button').forEach(b=>b.disabled=true);bookingRequest??=crypto.randomUUID();
 try{const data=await api('POST','bookings',{eventId:activeEvent.id,seats:[...selected],attendee:$('attendee').value.trim(),requestId:bookingRequest});$('event-dialog').close();activeEvent=null;notice('You’re booked! '+data.booking.reference+' — demo reservation confirmed. No payment collected.');location.hash='tickets';await showTickets();}
 catch(error){$('booking-error').textContent=error.message+(error.status?'':' You can retry safely with the same selection.');if(error.status===409)bookingRequest=null;}
 finally{bookingBusy=false;$('attendee').disabled=false;$('close-dialog').disabled=false;updateTotal();if(activeEvent)await seats();}
});
$('attendee').addEventListener('input',()=>{bookingRequest=null;});
$('close-dialog').addEventListener('click',()=>$('event-dialog').close());
$('event-dialog').addEventListener('cancel',e=>{if(bookingBusy)e.preventDefault();});
$('event-dialog').addEventListener('close',()=>{activeEvent=null;viewVersion++;});
let ticketsVersion=0;
async function showTickets(){
 const version=++ticketsVersion;
 try{const {bookings}=await api('GET','bookings');if(version!==ticketsVersion)return;$('ticket-count').textContent=bookings.filter(b=>b.status==='confirmed').length;$('ticket-list').replaceChildren();
 if(!bookings.length){const empty=node('div',undefined,'empty');empty.append(node('h3','Your next story starts here.'),node('p','Book an experience and your demo tickets will appear here.'));$('ticket-list').append(empty);}
 for(const b of bookings){const card=node('article',undefined,'ticket '+b.status),info=node('div'),side=node('div',undefined,'ticket-side');info.append(node('p',b.status==='confirmed'?'CONFIRMED · DEMO TICKET':'CANCELLED','eyebrow'),node('h3',b.event.title),node('p',date(b.event.date)+' · '+b.event.venue+', '+b.event.city),node('p','Seats '+b.seats.join(', ')+' · '+b.attendee));side.append(node('code',b.reference),node('strong',money(b.total)));
 if(b.status==='confirmed'){const cancel=node('button','Cancel reservation','secondary');cancel.addEventListener('click',()=>{cancelId=b.id;$('cancel-dialog').showModal();});side.append(cancel);}card.append(info,side);$('ticket-list').append(card);}
 }catch(e){if(!e.stale)notice(e.message);}
}
$('keep-booking').addEventListener('click',()=>$('cancel-dialog').close());
$('cancel-booking').addEventListener('click',async()=>{if(!cancelId)return;$('cancel-booking').disabled=true;try{await api('POST','bookings/'+cancelId+'/cancel',{});$('cancel-dialog').close();notice('Reservation cancelled. Your seats are available again.');await showTickets();}catch(e){$('cancel-dialog').close();notice(e.message);}finally{$('cancel-booking').disabled=false;}});
async function route(){const tickets=location.hash==='#tickets';$('tickets').hidden=!tickets;$('discover').hidden=tickets;if(tickets)await showTickets();else await discover();}
window.addEventListener('hashchange',route);
$('search-form').addEventListener('submit',e=>{e.preventDefault();discover();});
$('city').addEventListener('change',discover);
$('month').addEventListener('change',discover);
$('budget').addEventListener('change',discover);
document.querySelectorAll('[data-category]').forEach(button=>button.addEventListener('click',()=>{category=button.dataset.category;document.querySelectorAll('[data-category]').forEach(b=>{b.classList.toggle('active',b===button);b.setAttribute('aria-pressed',String(b===button));});discover();}));
$('reset-search').addEventListener('click',()=>{$('search').value='';$('city').value='All';$('month').value='All';$('budget').value='100000';document.querySelector('[data-category="All"]').click();});
try{await configure();await route();if(location.hash!=='#tickets')await showTickets();}catch(e){notice(e.message);}
setInterval(()=>{if(!document.hidden&&activeEvent&&!bookingBusy)seats();},5000);
setInterval(async()=>{try{const r=await fetch('/demo/time',{cache:'no-store',signal:AbortSignal.timeout(4000)});if(r.ok)offset=(await r.json()).serverTime-Date.now();}catch{}},10000);
