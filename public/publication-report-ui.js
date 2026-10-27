const labels={sent:'ارسال شد',failed:'ناموفق',blocked:'ارسال نشد',unknown:'نتیجه نامشخص',sending:'در حال ارسال'};
const stages={preflight:'بررسی پیش از ارسال',upload:'بارگذاری فایل',send:'درخواست ارسال'};
export async function openPublicationReport({postId,api,modalRoot,esc,number,date,writable,isCurrent,setBusy,onChange}){
 let report=await api('/api/posts/'+postId+'/delivery-report'),pending=false;
 if(!isCurrent())return;
 function draw(){
  modalRoot.innerHTML='<div class="modal publication-modal" role="dialog" aria-modal="true" aria-labelledby="publication-title"><h2 id="publication-title" tabindex="-1">گزارش ارسال</h2><p>'+number(report.sent)+' از '+number(report.total)+' مقصد تایید شده است؛ تایید دستی جدا مشخص می‌شود.</p><div class="publication-results">'+report.results.map((row,index)=>{
   const allowed=writable&&report.active&&!report.busy;
   return '<section class="publication-result" data-receipt="'+index+'"><div><strong>'+esc(row.channel_name||row.platform||row.channel_id)+'</strong><span class="tag '+(row.status==='sent'?'green':'amber')+'">'+(row.confirmation==='manual'?'تایید دستی کاربر':labels[row.status]||esc(row.status))+'</span></div><p>'+esc(row.status==='unknown'?'رسید قطعی دریافت نشده؛ ممکن است پیام در کانال باشد. ابتدا کانال را بررسی کنید.':row.message)+'</p><small>آخرین تغییر: '+esc(date(row.updated_at||row.published_at))+'</small>'+(row.target?'<p>مقصد: <bdi>'+esc(row.target)+'</bdi></p>':'')+(row.message_ids?.length?'<p>شناسه پیام: <bdi>'+esc(row.message_ids.join('، '))+'</bdi></p>':'')+(row.code?'<p>کد نتیجه: <bdi>'+esc(row.code)+'</bdi></p>':'')+(allowed&&['failed','blocked'].includes(row.status)?'<button type="button" class="button small" data-retry="'+index+'">تلاش مجدد فقط برای این مقصد</button>':'')+(allowed&&row.status==='unknown'?'<details class="delivery-resolution"><summary>ثبت نتیجه بررسی کانال</summary><p>ارسال دوباره بدون بررسی ممکن است پیام تکراری بسازد. این تصمیم، تایید کاربر است و جای رسید پیام‌رسان را نمی‌گیرد.</p><label class="check-row"><input type="checkbox" data-checked-channel>کانال را بررسی کرده‌ام</label><div class="modal-actions"><button type="button" class="button secondary small" data-resolve="observed_sent" data-row="'+index+'">پیام را در کانال دیده‌ام</button><button type="button" class="button secondary small" data-resolve="observed_absent" data-row="'+index+'">پیام نیست؛ تلاش مجدد باز شود</button></div></details>':'')+'<details class="delivery-history"><summary>تاریخچه پیگیری ('+number(row.history.length)+')</summary>'+(row.history.length?'<ol>'+row.history.map(event=>'<li><strong>'+esc(event.code==='manual_confirmed'?'تایید دستی':event.code==='manual_reopened'?'بازکردن تلاش مجدد':labels[event.status]||event.status)+'</strong> · '+esc(date(event.at))+'<br>'+esc(event.actor)+' · '+esc(event.message||'جزئیات بیشتر در نسخه قبلی ثبت نشده است.')+'<br><small>پیگیری '+number(event.id)+(event.stage?' · '+esc(stages[event.stage]||event.stage):'')+(event.duration_ms!==null?' · '+number(Math.round(event.duration_ms/1000))+' ثانیه':'')+'</small>'+(event.code?'<br><bdi>'+esc(event.code)+(event.transport?' / '+esc(event.transport):'')+'</bdi>':'')+(event.message_ids.length?'<br>شناسه پیام: <bdi>'+esc(event.message_ids.join('، '))+'</bdi>':'')+'</li>').join('')+'</ol>':'<p>تاریخچه‌ای از نسخه قبلی ثبت نشده است.</p>')+'</details></section>';
  }).join('')+'</div><p class="help">مقصد موفق دوباره ارسال نمی‌شود. نتیجه نامشخص پس از بررسی شما قابل تعیین تکلیف است.</p><p role="status" data-report-status></p><div class="modal-actions"><button type="button" class="button secondary" data-report-reload>تازه‌سازی گزارش</button><button type="button" class="button secondary" data-action="close-modal">بستن</button></div></div>';
  const dialog=modalRoot.firstElementChild;
  dialog.addEventListener('click',async event=>{
   const button=event.target.closest('[data-retry],[data-resolve],[data-report-reload]');if(!button||pending||!isCurrent())return;
   event.stopPropagation();const index=Number(button.dataset.retry??button.dataset.row),row=report.results[index],status=dialog.querySelector('[data-report-status]');
   if(button.hasAttribute('data-resolve')&&!button.closest('[data-receipt]').querySelector('[data-checked-channel]').checked){status.textContent='ابتدا بررسی کانال را تایید کنید.';return;}
   pending=true;setBusy(true);dialog.querySelectorAll('button').forEach(b=>b.disabled=true);status.textContent=button.hasAttribute('data-retry')?'در حال ارسال به همین مقصد…':'در حال دریافت یا ثبت نتیجه…';
   try{
    if(button.hasAttribute('data-retry'))await api('/api/posts/'+postId+'/publish',{method:'POST',body:{version:report.version,destinations:[row.channel_id]}});
    if(button.hasAttribute('data-resolve'))await api('/api/posts/'+postId+'/delivery-report',{method:'POST',body:{version:report.version,channel_id:row.channel_id,updated_at:row.updated_at,revision:row.revision,decision:button.dataset.resolve,confirmed:true}});
    if(!isCurrent())return;
    await onChange();report=await api('/api/posts/'+postId+'/delivery-report');if(isCurrent()&&dialog.isConnected)draw();
   }catch(error){if(dialog.isConnected)status.textContent=error.message;}
   finally{pending=false;setBusy(false);dialog.querySelectorAll('button').forEach(b=>b.disabled=false);}
  });
  dialog.querySelector('#publication-title').focus();
 }
 draw();
}
