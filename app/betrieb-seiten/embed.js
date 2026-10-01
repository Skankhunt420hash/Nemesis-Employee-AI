(function(){
  var s=document.currentScript;if(!s)return;
  var base=s.src.replace(/\/embed\.js(\?.*)?$/,""),farbe=s.getAttribute("data-color")||"__FARBE__";
  var btn=document.createElement("button"),fr=document.createElement("iframe"),offen=false;
  btn.setAttribute("aria-label","Chat öffnen");btn.innerHTML="&#128172;";
  btn.style.cssText="position:fixed;right:18px;bottom:18px;width:58px;height:58px;border-radius:50%;border:0;background:"+farbe+";color:#fff;font-size:26px;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.3);z-index:2147483646";
  fr.title="Chat";fr.src="about:blank";
  fr.style.cssText="position:fixed;right:18px;bottom:88px;width:min(380px,calc(100vw - 24px));height:min(600px,calc(100vh - 110px));border:0;border-radius:14px;box-shadow:0 10px 40px rgba(0,0,0,.35);background:#fff;z-index:2147483647;display:none";
  btn.onclick=function(){offen=!offen;if(offen&&fr.src==="about:blank")fr.src=base+"/chat";fr.style.display=offen?"block":"none";btn.innerHTML=offen?"&#10005;":"&#128172;"};
  document.body.appendChild(fr);document.body.appendChild(btn);
})();
