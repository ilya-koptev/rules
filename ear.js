// /etc/wb-rules/ear.js — Виртуальное "Ухо" (макет РТ-64). ES5. 2 оси.
// Азимут:   0..330  (0=CW/IN2, 330=CCW/IN1). Элевация: 35..90 (35=низ/IN3, 90=верх/IN4).
// Объединённый ползунок на ось: показывает ТЕКУЩЕЕ; двинули -> едем туда; в движении readonly и ползёт за текущим.
// Скорость всегда 2%. Концевики ловим по счётчику нажатий, авто-реверс отдаём модулю (не воюем).
// Элевация: сейчас ремень снят (мотор крутится вхолостую) — логика на месте, починят завтра.

var LED = "wb-led_71";
var MCM = "wb-mcm8_46";
var SPEED = 2;
var DEAD = 15, NEAR = 80, STALL_MS = 3000, LOOP_MS = 250, IDLE_PARK_MS = 5 * 60 * 1000;

var AZ = {
  key:"az", slider:"azimuth",
  spd:LED+"/Channel 1", spdBr:LED+"/Channel 1 Brightness", dir:LED+"/Channel 2",
  fb:MCM+"/Input 3 counter", limMin:LED+"/Input 1 Counter", limMax:LED+"/Input 2 Counter",
  dirToMax:false, homeToMax:true, homeLimLvl:LED+"/Input 2",   // увеличение=по часовой; 0=IN1(CCW), 330=IN2(CW); home/park->330=IN2
  rangeTicks:6868, minDeg:0, spanDeg:330, homeTimeoutMs:120000
};
var EL = {
  key:"el", slider:"elevation",
  spd:LED+"/Channel 3", spdBr:LED+"/Channel 3 Brightness", dir:LED+"/Channel 4",
  fb:MCM+"/Input 2 counter", limMin:LED+"/Input 3 Counter", limMax:LED+"/Input 4 Counter",
  dirToMax:false, homeToMax:true, homeLimLvl:LED+"/Input 4",    // home -> IN4 (90 deg), вверх
  rangeTicks:1242, minDeg:35, spanDeg:55, homeTimeoutMs:30000
};

function newAxis(cfg){ return { cfg:cfg, ticks:0, lastRaw:null, homed:false, job:"none", target:0,
  toMax:true, cmdMax:null, driving:false, stallMs:0, jobMs:0, err:"", echo:false, shown:-999, ro:null, moveTicks:0 }; }
var A = { az:newAxis(AZ), el:newAxis(EL) };
var parked = false, idleMs = 0, opMode = "idle";

var _pub = {};
function putc(c, v){ if (_pub[c] !== v){ _pub[c] = v; dev["ear/" + c] = v; } }
function activity(){ idleMs = 0; parked = false; }

function d2t(cfg, deg){ var t=(deg-cfg.minDeg)/cfg.spanDeg*cfg.rangeTicks; if(t<0)t=0; if(t>cfg.rangeTicks)t=cfg.rangeTicks; return t; }
function t2d(cfg, t){ return cfg.minDeg + t/cfg.rangeTicks*cfg.spanDeg; }

function driveAxis(a, toMax, pct){ var c=a.cfg; dev[c.dir]=(toMax?c.dirToMax:!c.dirToMax); dev[c.spdBr]=pct; dev[c.spd]=true; a.toMax=toMax; a.cmdMax=toMax; a.driving=true; }
function stopAxis(a){ dev[a.cfg.spd]=false; a.driving=false; a.stallMs=0; }

function integrateAxis(a){
  var c=a.cfg;
  var raw=dev[c.fb];
  if(raw===undefined||raw===null) return;
  if(a.lastRaw===null){ a.lastRaw=raw; return; }
  var d=raw-a.lastRaw; a.lastRaw=raw; if(d<0)d=0;
  // считаем по ФАКТИЧЕСКОМУ состоянию канала (мотор включён — не важно, кем)
  if(dev[c.spd]===true){
    var toMax=(dev[c.dir]===c.dirToMax);
    if(d>0){ a.ticks+=(toMax?d:-d); a.stallMs=0; } else { a.stallMs+=LOOP_MS; }
    if(a.ticks<0)a.ticks=0; if(a.ticks>c.rangeTicks)a.ticks=c.rangeTicks;
    a.moveTicks += d;            // сырые тики = приращение за текущее движение
  } else {
    a.moveTicks = 0;            // мотор стоит -> сброс
  }
}
// концевик сработал: фиксируем позицию, но скорость НЕ трогаем — откат делает сам модуль (ВБЛЕД)
function onLimitAxis(a, atMax){
  if(a.job==="home" && atMax !== a.cfg.homeToMax) return;   // при хоминге игнор «уезжаемого» концевика
  a.homed=true; a.ticks=atMax?a.cfg.rangeTicks:0; a.job="postlimit"; a.jobMs=0;
}

function controlAxis(a){
  var c=a.cfg;
  if(a.job==="none") return;                 // idle: каналы не трогаем
  a.jobMs+=LOOP_MS;

  if(a.job==="postlimit"){
    // модуль сам реверсит и на сходе снимает скорость — ждём, НЕ мешаем
    if(dev[c.spd]!==true){ a.job="none"; a.driving=false; }        // модуль снял скорость -> откат отработан
    else if(a.jobMs>5000){ stopAxis(a); a.job="none"; }            // подстраховка, если вдруг не снял
    return;
  }

  if(a.job==="home" && a.jobMs>c.homeTimeoutMs){ stopAxis(a); a.job="none"; a.err=c.key+": park/home timeout"; return; }

  if(a.driving && a.stallMs>=STALL_MS){
    // seek к самому концу хода — упор считаем приездом; иначе (в т.ч. home) — реальный заклин = ОШИБКА
    if(a.job==="seek" && !a.toMax && a.target<=NEAR){ onLimitAxis(a,false); return; }
    if(a.job==="seek" &&  a.toMax && a.target>=c.rangeTicks-NEAR){ onLimitAxis(a,true); return; }
    stopAxis(a); a.job="none"; a.err=c.key+": motor not turning (stall)"; return;
  }

  if(a.job==="seek"){
    var err=a.target-a.ticks, m=err<0?-err:err;
    if(m<=DEAD){ stopAxis(a); a.job="none"; return; }
    var want=(err>0);
    // переподтверждаем ТОЛЬКО когда модуль выключил скорость (сход с концевика) или сменилось направление
    if(!dev[c.spd] || a.cmdMax!==want) driveAxis(a, want, SPEED);
  } else if(a.job==="home"){
    if(dev[c.homeLimLvl]===true){ onLimitAxis(a, c.homeToMax); return; }  // уже на целевом концевике
    if(!dev[c.spd]) driveAxis(a, c.homeToMax, SPEED);                      // переподтверждаем только если модуль выключил
  }
}

// объединённый ползунок: показать текущее (эхо помечаем)
function showSlider(a){
  if(!a.homed) return;                       // до хоминга позиция неизвестна, ползунок не трогаем
  var deg=Math.round(t2d(a.cfg, a.ticks));
  if(deg!==a.shown){ a.shown=deg; dev["ear/"+a.cfg.slider]=deg; }
}
// readonly ползунка во время движения
function setSliderRO(a, ro){
  if(a.ro===ro) return; a.ro=ro;
  publish("/devices/ear/controls/"+a.cfg.slider+"/meta/readonly", ro?"1":"0", 1, true);
}
// пользователь двинул ползунок -> новая цель
function onSliderCmd(a, nv){
  if(a.job!=="none") return;            // в движении ползунок readonly -> изменения = наше эхо, игнор
  if(!a.homed){ opMode="need home"; return; }
  var deg=Math.round(nv);
  if(deg===a.shown) return;             // совпадает с показанным (наш апдейт) -> не команда
  activity(); a.err=""; a.jobMs=0;
  a.target=d2t(a.cfg, deg);
  a.job="seek"; opMode="moving";
}

function homeAll(label){ activity(); A.az.err=""; A.el.err=""; A.az.jobMs=0; A.el.jobMs=0; A.az.job="home"; A.el.job="home"; opMode=label||"homing"; }
function stopAll(){ activity(); A.az.err=""; A.el.err=""; A.az.job="none"; A.el.job="none"; stopAxis(A.az); stopAxis(A.el); opMode="stopped"; }

// --- виртуальное устройство ---
defineVirtualDevice("ear", {
  title: "Ear (RT-64)",
  cells: {
    azimuth:   { type:"range", value:0,  min:0,  max:330, units:"deg", order:1, title:"Azimuth" },
    elevation: { type:"range", value:90, min:35, max:90,  units:"deg", order:2, title:"Elevation" },
    home:  { type:"pushbutton", order:3, title:"Home" },
    stop:  { type:"pushbutton", order:4, title:"Stop" },
    homed: { type:"switch", value:false, readonly:true, order:5, title:"Homed" },
    status:{ type:"text", value:"idle", readonly:true, order:6, title:"Status" },
    azTicks:{ type:"value", value:0, readonly:true, order:7, title:"Az ticks" },
    elTicks:{ type:"value", value:0, readonly:true, order:8, title:"El ticks" }
  }
});

defineRule("ear_az_cmd", { whenChanged:"ear/azimuth",   then:function(nv){ onSliderCmd(A.az, nv); } });
defineRule("ear_el_cmd", { whenChanged:"ear/elevation", then:function(nv){ onSliderCmd(A.el, nv); } });
defineRule("ear_home",   { whenChanged:"ear/home",      then:function(){ homeAll("homing"); } });
defineRule("ear_stop",   { whenChanged:"ear/stop",      then:function(){ stopAll(); } });
defineRule("ear_lim_az_min", { whenChanged:AZ.limMin, then:function(){ onLimitAxis(A.az,false); } });
defineRule("ear_lim_az_max", { whenChanged:AZ.limMax, then:function(){ onLimitAxis(A.az,true);  } });
defineRule("ear_lim_el_min", { whenChanged:EL.limMin, then:function(){ onLimitAxis(A.el,false); } });
defineRule("ear_lim_el_max", { whenChanged:EL.limMax, then:function(){ onLimitAxis(A.el,true);  } });

// безопасный старт: моторы off
dev[AZ.spd]=false; dev[EL.spd]=false;

setInterval(function(){
  integrateAxis(A.az); integrateAxis(A.el);
  if(!A.az.err) controlAxis(A.az);
  if(!A.el.err) controlAxis(A.el);
  showSlider(A.az); showSlider(A.el);
  setSliderRO(A.az, A.az.job!=="none");
  setSliderRO(A.el, A.el.job!=="none");
  putc("homed", (A.az.homed && A.el.homed));
  putc("azTicks", A.az.moveTicks);   // приращение тиков за текущее движение (сброс после стопа)
  putc("elTicks", A.el.moveTicks);

  var busy = (A.az.job!=="none" || A.el.job!=="none");
  var errs = A.az.err || A.el.err;
  if(busy){ putc("status", opMode + (errs ? " (" + errs + ")" : "")); }
  else if(errs){ putc("status", "ERROR: " + errs); }
  else {
    if(opMode==="moving") opMode="idle";
    else if(opMode==="homing"||opMode==="autopark"){ parked=true; opMode="parked"; }
    putc("status", opMode);
  }

  if(busy){ idleMs=0; return; }
  idleMs += LOOP_MS;
  if(!parked && !A.az.err && !A.el.err && idleMs>=IDLE_PARK_MS){
    var azHome = A.az.homed && A.az.ticks>=AZ.rangeTicks-DEAD;   // az парк = 330 (макс/IN2)
    var elHome = A.el.homed && A.el.ticks>=EL.rangeTicks-DEAD;
    if(azHome && elHome){ parked=true; opMode="parked"; }
    else { homeAll("autopark"); }
  }
}, LOOP_MS);
