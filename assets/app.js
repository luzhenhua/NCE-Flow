(() => {
  const LANG_KEY = 'nce_lang_mode'; // 'en' | 'bi' | 'cn'
  function getLang(){ const v=localStorage.getItem(LANG_KEY); return (v==='en'||v==='cn'||v==='bi')?v:'bi'; }
  function setLang(v){ localStorage.setItem(LANG_KEY,v); applyLang(v); }
  function applyLang(v){ document.body.classList.remove('lang-en','lang-bi','lang-cn'); document.body.classList.add('lang-'+v); }
  function initSegmented(container){
    const segs = container?.querySelectorAll('[data-mode]'); if(!segs) return;
    const current = getLang(); applyLang(current);
    segs.forEach(btn=>{
      btn.classList.toggle('active', btn.dataset.mode===current);
      btn.addEventListener('click',()=>{ setLang(btn.dataset.mode||'bi'); segs.forEach(b=>b.classList.toggle('active', b===btn)); });
    });
  }
  window.NCE_APP = { getLang, setLang, applyLang, initSegmented };
})();

