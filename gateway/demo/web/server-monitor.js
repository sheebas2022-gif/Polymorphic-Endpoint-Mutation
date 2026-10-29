const $=id=>document.getElementById(id);
let busy=false;
async function refreshServer(){
  if(busy)return;busy=true;
  try{
    const response=await fetch('/demo/server',{cache:'no-store',signal:AbortSignal.timeout(3500)});
    if(!response.ok)throw new Error('offline');
    const data=await response.json();
    $('server-health').textContent='● Online';$('server-health').classList.remove('offline');
    $('server-uptime').textContent=`${Math.floor(data.uptimeSeconds/60)}m ${data.uptimeSeconds%60}s`;
    $('server-requests').textContent=`${data.requests} / ${data.failures}`;
    $('server-writes').textContent=`${data.bookingCount} / ${data.writes}`;
    $('server-memory').textContent=`${data.memoryMB} MB memory · ${data.storage}`;
    $('server-log').replaceChildren();
    for(const entry of data.recent.slice(0,10)){
      const row=document.createElement('tr');
      [new Date(entry.time).toLocaleTimeString([],{hour12:false}),entry.method,entry.path,entry.status].forEach(value=>{const td=document.createElement('td');td.textContent=value;row.append(td);});
      $('server-log').append(row);
    }
  }catch{
    $('server-health').textContent='● Unavailable';$('server-health').classList.add('offline');
    for(const id of ['server-uptime','server-requests','server-writes'])$(id).textContent='—';
    $('server-log').replaceChildren();$('server-memory').textContent='Start api-server/server.js to reconnect. Saved bookings remain on disk.';
  }finally{busy=false;}
}
await refreshServer();setInterval(refreshServer,2500);
