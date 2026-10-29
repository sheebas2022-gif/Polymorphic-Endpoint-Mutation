import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export const events = [
 {id:'afterglow',title:'Afterglow',subtitle:'A night of electronic discovery',category:'Music',city:'Bengaluru',venue:'Orion Open Air',date:'2026-11-14T18:30:00+05:30',price:1499,theme:'violet',mark:'AFTER / GLOW',description:'Lose yourself in an evening of luminous sound. Three live sets, an open-air stage, and a city that never stops moving.'},
 {id:'courtside',title:'Courtside Classics',subtitle:'The city basketball showcase',category:'Sports',city:'Mumbai',venue:'Harbour Arena',date:'2026-11-21T16:00:00+05:30',price:799,theme:'orange',mark:'GAME / ON',description:'Get close to the action as local basketball teams take the court for an evening of skill, energy, and friendly rivalry.'},
 {id:'midnight',title:'The Midnight Express',subtitle:'An intimate theatre experience',category:'Theatre',city:'Chennai',venue:'The Playhouse',date:'2026-12-05T19:00:00+05:30',price:999,theme:'blue',mark:'NEXT / STOP',description:'One train. Six strangers. A journey that changes everything. Discover an original stage production in an intimate seated setting.'},
 {id:'form',title:'Made by Hand',subtitle:'A clay & creative practice workshop',category:'Workshops',city:'Bengaluru',venue:'Studio Commons',date:'2026-11-08T10:00:00+05:30',price:1299,theme:'lime',mark:'MAKE / SPACE',description:'Slow down, get your hands into clay, and make something your own. Materials and guided instruction are included; beginners are welcome.'},
 {id:'jazz',title:'Blue Hour Sessions',subtitle:'Jazz beneath the evening sky',category:'Music',city:'Mumbai',venue:'Terrace 42',date:'2026-12-12T18:00:00+05:30',price:1199,theme:'pink',mark:'BLUE / HOUR',description:'An acoustic quartet brings warm grooves and modern jazz to an intimate terrace concert. Settle into a night of music and conversation.'},
 {id:'comedy',title:'Out Loud',subtitle:'A fresh lineup of stand-up comedy',category:'Comedy',city:'Chennai',venue:'The Commons Hall',date:'2026-12-19T19:30:00+05:30',price:599,theme:'yellow',mark:'OUT / LOUD',description:'Big laughs, small room. Discover a new lineup of performers sharing observations, stories, and delightfully unexpected punchlines.'}
];
const allSeats=Array.from({length:48},(_,i)=>String.fromCharCode(65+Math.floor(i/8))+(i%8+1));
export async function createEventAPI(file){
 let bookings=[];
 try{bookings=JSON.parse(await readFile(file,'utf8'));if(!Array.isArray(bookings)||bookings.some(b=>!b.id||!Array.isArray(b.seats)||!events.some(e=>e.id===b.eventId)))throw new Error('Invalid bookings file');}
 catch(e){if(e.code!=='ENOENT')throw e;}
 let queue=Promise.resolve(),writes=0;
 const reserved=id=>new Set(bookings.filter(b=>b.eventId===id&&b.status==='confirmed').flatMap(b=>b.seats));
 const withAvailability=e=>({...e,available:48-reserved(e.id).size});
 async function commit(next){await mkdir(dirname(file),{recursive:true});await writeFile(file+'.tmp',JSON.stringify(next,null,2));await rename(file+'.tmp',file);bookings=next;writes++;}
 return {
  metrics:()=>({bookingCount:bookings.filter(b=>b.status==='confirmed').length,eventCount:events.length,bookingWrites:writes}),
  async handle(req,json,readBody){
   const url=new URL(req.url,'http://localhost'),path=url.pathname;
   if(!/^\/api\/v1\/(events|bookings)(\/|$)/.test(path))return false;
   if(path==='/api/v1/events'&&req.method==='GET'){
    const q=(url.searchParams.get('q')||'').toLowerCase(),category=url.searchParams.get('category')||'All',city=url.searchParams.get('city')||'All',month=url.searchParams.get('month')||'All',max=Number(url.searchParams.get('max')||100000);
    if(!Number.isFinite(max)||max<0){json(400,{error:'Invalid maximum price'});return true;}
    json(200,{events:events.filter(e=>(category==='All'||e.category===category)&&(city==='All'||e.city===city)&&(month==='All'||e.date.startsWith(month))&&e.price<=max&&[e.title,e.subtitle,e.city,e.venue].join(' ').toLowerCase().includes(q)).map(withAvailability)});return true;
   }
   const match=/^\/api\/v1\/events\/([a-z]+)(\/seats)?$/.exec(path);
   if(match&&req.method==='GET'){
    const event=events.find(e=>e.id===match[1]);if(!event){json(404,{error:'Event not found'});return true;}
    json(200,match[2]?{seats:allSeats.map(id=>({id,available:!reserved(event.id).has(id)}))}:{event:withAvailability(event)});return true;
   }
   const clientId=String(req.headers['x-demo-client-id']||'');
   if(!/^[a-f0-9-]{36}$/.test(clientId)){json(400,{error:'A valid demo browser ID is required'});return true;}
   if(path==='/api/v1/bookings'&&req.method==='GET'){json(200,{bookings:bookings.filter(b=>b.clientId===clientId).map(({clientId,...b})=>({...b,event:events.find(e=>e.id===b.eventId)}))});return true;}
   const cancel=/^\/api\/v1\/bookings\/([a-f0-9-]{36})\/cancel$/.exec(path);
   if(req.method!=='POST'||(path!=='/api/v1/bookings'&&!cancel)){json(404,{error:'Route not found'});return true;}
   let body;try{body=JSON.parse(await readBody(req)||'{}');}catch{json(400,{error:'Enter valid JSON'});return true;}
   const operation=queue.then(async()=>{
    if(cancel){
     const found=bookings.find(b=>b.id===cancel[1]&&b.clientId===clientId);if(!found){json(404,{error:'Booking not found'});return;}
     if(found.status==='confirmed')await commit(bookings.map(b=>b===found?{...b,status:'cancelled'}:b));
     json(200,{cancelled:found.id});return;
    }
    const event=events.find(e=>e.id===body?.eventId),seats=body?.seats;
    if(!event||!Array.isArray(seats)||seats.length<1||seats.length>6||new Set(seats).size!==seats.length||seats.some(s=>!allSeats.includes(s))||typeof body?.attendee!=='string'||!body.attendee.trim()||body.attendee.trim().length>80||! /^[a-f0-9-]{36}$/.test(body?.requestId||'')){json(400,{error:'Choose 1–6 valid seats and enter an attendee name (up to 80 characters).'});return;}
    const previous=bookings.find(b=>b.clientId===clientId&&b.requestId===body.requestId);
    if(previous){const {clientId,...booking}=previous;json(200,{booking});return;}
    if(seats.some(s=>reserved(event.id).has(s))){json(409,{error:'Some seats were just booked. Please choose again.'});return;}
    const booking={id:randomUUID(),reference:'ENC-'+randomUUID().slice(0,8).toUpperCase(),eventId:event.id,seats,attendee:body.attendee.trim(),total:seats.length*event.price,status:'confirmed',createdAt:new Date().toISOString(),clientId,requestId:body.requestId};
    await commit([booking,...bookings]);const {clientId:owner,...result}=booking;json(201,{booking:result});
   });
   queue=operation.catch(()=>{});await operation;return true;
  }
 };
}
