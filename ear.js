// /etc/wb-rules/ear.js — Виртуальное "Ухо" (макет РТ-64). ES5. 2 оси.
// Азимут:   0..330  (0=CW/IN2, 330=CCW/IN1). Элевация: 35..90 (35=низ/IN3, 90=верх/IN4).
// Объединённый ползунок на ось: показывает ТЕКУЩЕЕ; двинули -> едем туда; в движении readonly и ползёт за текущим.
// Скорость всегда 2%. Концевики ловим по счётчику нажатий, авто-реверс отдаём модулю (не воюем).
// Элевация: сейчас ремень снят (мотор крутится вхолостую) — логика на месте, починят завтра.

var LED = "wb-led_71";
var MCM = "wb-mcm8_46";
var SPEED = 2;
var DEAD = 40, NEAR = 80, STALL_MS = 3000, LOOP_MS = 250, IDLE_PARK_MS = 5 * 60 * 1000;

var AZ = {
  key:"az", slider:"azimuth",
  spd:LED+"/Channel 1", spdBr:LED+"/Channel 1 Brightness", dir:LED+"/Channel 2",
  fb:MCM+"/Input 3 counter", limMin:LED+"/Input 1 Counter", limMax:LED+"/Input 2 Counter",
  dirToMax:false, homeToMax:true, homeLimLvl:LED+"/Input 2",   // увеличение=по часовой; 0=IN1(CCW), 330=IN2(CW); home/park->330=IN2
  rangeTicks:6868, minDeg:0, spanDeg:330, homeTimeMs:65000    // хоминг завершается: концевик IN2 (раньше) ЛИБО по этому времени
};
var EL = {
  key:"el", slider:"elevation",
  spd:LED+"/Channel 3", spdBr:LED+"/Channel 3 Brightness", dir:LED+"/Channel 4",
  fb:MCM+"/Input 2 counter", limMin:LED+"/Input 3 Counter", limMax:LED+"/Input 4 Counter",
  dirToMax:false, homeToMax:true, homeLimLvl:LED+"/Input 4",    // home -> IN4 (90 deg), вверх
  rangeTicks:1242, minDeg:35, spanDeg:55, homeTimeMs:20000     // хоминг: концевик IN4 (раньше) ЛИБО по времени (сейчас без ремня — по времени)
};

function newAxis(cfg){ return { cfg:cfg, ticks:0, lastRaw:null, homed:false, job:"none", target:0,
  toMax:true, cmdMax:null, driving:false, stallMs:0, jobMs:0, err:"", echo:false, shown:-999, ro:null, moveTicks:0,
  startTicks:0, hold:false }; }
var A = { az:newAxis(AZ), el:newAxis(EL) };
var parked = false, idleMs = 0, opMode = "idle", homeActive = false;

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
  a.homed=true; a.ticks=atMax?a.cfg.rangeTicks:0;            // позиция обновляется от ЛЮБОГО концевика
  if(a.job==="home" && atMax !== a.cfg.homeToMax) return;    // встречный концевик хоминг не завершает
  a.job="postlimit"; a.jobMs=0;
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

  if(a.job==="home" && a.jobMs>c.homeTimeMs){ a.homed=true; a.ticks=(c.homeToMax?c.rangeTicks:0); stopAxis(a); a.job="none"; return; }  // хоминг по времени: доехали до референса

  // stall только для seek (home завершается по концевику/времени, не по stall)
  if(a.job==="seek" && a.driving && a.stallMs>=STALL_MS){
    if(!a.toMax && a.target<=NEAR){ onLimitAxis(a,false); return; }        // seek к самому краю -> упор = приезд
    if( a.toMax && a.target>=c.rangeTicks-NEAR){ onLimitAxis(a,true); return; }
    stopAxis(a); a.job="none"; a.err=c.key+": motor not turning (stall)"; return;
  }

  if(a.job==="seek"){
    var err=a.target-a.ticks, m=err<0?-err:err;
    if(m<=DEAD){ stopAxis(a); a.job="none"; return; }                            // в зоне цели -> стоп
    if(a.hold){ if(dev[c.spd]) stopAxis(a); return; }                            // придержан ради синхронного прихода
    var want=(err>0);
    if(a.cmdMax!==null && want!==a.cmdMax){ stopAxis(a); a.job="none"; return; } // чуть переехали -> стоп, назад НЕ дёргаем
    if(!dev[c.spd] || a.cmdMax!==want) driveAxis(a, want, SPEED);
  } else if(a.job==="home"){
    if(dev[c.homeLimLvl]===true){ onLimitAxis(a, c.homeToMax); return; }  // уже на целевом концевике
    if(!dev[c.spd]) driveAxis(a, c.homeToMax, SPEED);                      // переподтверждаем только если модуль выключил
  }
}

// объединённый ползунок: показать текущее (эхо помечаем)
function showSlider(a){
  var deg=Math.round(t2d(a.cfg, a.ticks));   // показываем текущее всегда, в т.ч. во время хоминга
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
  var deg=Math.round(nv);
  if(deg===a.shown) return;             // наш эхо-апдейт (в т.ч. показ текущего при хоминге) -> игнор
  if(!a.homed){ opMode="need home"; return; }   // сначала хоминг (завершается и по времени)
  activity(); a.err=""; a.jobMs=0; a.cmdMax=null;
  a.startTicks=a.ticks; a.hold=false;
  a.target=d2t(a.cfg, deg);
  a.job="seek"; opMode="moving";
}

// --- согласованное ведение двух осей: обе приходят в цель одновременно ---
// Скорость фиксированная 2 % (ниже мотор не стартует), поэтому «замедляем» ось придерживанием:
// та, что ушла вперёд по ДОЛЕ пути, паузится, пока вторая догоняет. В координатах az/el — прямая.
var COORD_HI = 0.03;   // ушёл вперёд больше чем на 3 % пути -> придержать
var COORD_LO = 0.01;   // отставание сократилось до 1 % -> отпустить
function fracOf(a){
  var total = a.target - a.startTicks; if(total<0) total = -total;
  if(total < 1) return 1;
  var done = a.ticks - a.startTicks; if(done<0) done = -done;
  return done/total;
}
function coordinate(){
  var a=A.az, b=A.el;
  if(!dev["ear/sync"] || a.job!=="seek" || b.job!=="seek"){ a.hold=false; b.hold=false; return; }
  var fa=fracOf(a), fb=fracOf(b), d=fa-fb;
  if(d >  COORD_HI){ a.hold=true;  b.hold=false; }
  else if(d < -COORD_HI){ b.hold=true;  a.hold=false; }
  else if(d < COORD_LO && d > -COORD_LO){ a.hold=false; b.hold=false; }
}

function homeAll(label){ activity(); A.az.err=""; A.el.err=""; A.az.jobMs=0; A.el.jobMs=0; A.az.job="home"; A.el.job="home"; opMode=label||"homing"; homeActive=true; }
function stopAll(){ activity(); A.az.err=""; A.el.err=""; A.az.job="none"; A.el.job="none"; stopAxis(A.az); stopAxis(A.el); opMode="stopped"; homeActive=false; scenAbort(); }

// --- сценарий: заранее записанная последовательность шагов ---
// Шаги (JSON-массив), выполняются по порядку; следующий шаг стартует ПОСЛЕ остановки предыдущего:
//   {"az":120}            — ехать в азимут 120°
//   {"el":60}             — ехать в элевацию 60°
//   {"az":120,"el":60}    — обе оси одновременно
//   {"pause":5}           — пауза 5 секунд (после остановки)
//   {"home":true}         — хоминг/парковка (az 330°, el 90°)
// Демонстрационный сценарий по умолчанию: обзор горизонта с проходами по высоте.
var SCEN_DEFAULT = '[{"az":250,"el":60},{"pause":3},{"az":120},{"pause":2},{"el":45},{"az":40},{"pause":3},{"el":75},{"az":200},{"pause":2},{"home":true}]';
var ps = new PersistentStorage("ear", { global: true });
var scen = { steps: [], idx: 0, active: false, started: false, waitMs: 0, err: "" };

function scenParse(txt){
  try{
    var a = JSON.parse(txt);
    if(Object.prototype.toString.call(a) !== "[object Array]") return null;
    return a;
  }catch(e){ return null; }
}
function scenLoad(){
  var t = ps["scenario"] || SCEN_DEFAULT;
  var s = scenParse(t);
  if(!s){ t = SCEN_DEFAULT; s = scenParse(t); }
  scen.steps = s;
  putc("scenarioSteps", t);
}
function seekAxisTo(a, deg){
  activity(); a.err=""; a.jobMs=0; a.cmdMax=null;
  a.startTicks=a.ticks; a.hold=false;
  a.target = d2t(a.cfg, Math.round(deg));
  a.job = "seek";
}
function scenStart(){
  if(scen.active) return;
  if(!scen.steps.length){ opMode="scenario empty"; return; }
  if(!A.az.homed || !A.el.homed){ opMode="need home"; return; }
  activity(); A.az.err=""; A.el.err="";
  scen.idx=0; scen.active=true; scen.started=false; scen.waitMs=0; scen.err="";
  opMode="scenario";
}
function scenAbort(){ scen.active=false; scen.started=false; scen.waitMs=0; }
function scenLabel(){
  if(!scen.active) return "";
  var st = scen.steps[scen.idx] || {};
  var what = st.pause!==undefined ? ("pause " + Math.ceil(scen.waitMs/1000) + "s")
           : st.home ? "home"
           : ((st.az!==undefined ? "az "+st.az : "") + (st.el!==undefined ? (st.az!==undefined?" / ":"")+"el "+st.el : ""));
  return "scenario " + (scen.idx+1) + "/" + scen.steps.length + ": " + what + (scen.err ? " [" + scen.err + "]" : "");
}
// ошибка оси НЕ останавливает сценарий: запоминаем, ось закрываем, идём дальше
function scenSwallowErrors(){
  if(!scen.active) return;
  var ax=[A.az, A.el];
  for(var i=0;i<ax.length;i++){
    var a=ax[i];
    if(a.err){ scen.err=a.err; a.err=""; stopAxis(a); a.job="none"; }
  }
}
function scenTick(){
  if(!scen.active) return;
  if(scen.idx >= scen.steps.length){ scen.active=false; opMode = scen.err ? ("scenario done [" + scen.err + "]") : "scenario done"; return; }
  var st = scen.steps[scen.idx];
  if(!scen.started){
    scen.started = true;
    if(st.pause!==undefined){ scen.waitMs = Math.round(st.pause*1000); }
    else if(st.home){ homeAll("scenario home"); }
    else {
      if(st.az!==undefined) seekAxisTo(A.az, st.az);
      if(st.el!==undefined) seekAxisTo(A.el, st.el);
    }
    return;
  }
  if(st.pause!==undefined){
    scen.waitMs -= LOOP_MS;
    if(scen.waitMs<=0){ scen.idx++; scen.started=false; }
    return;
  }
  if(A.az.job==="none" && A.el.job==="none"){ scen.idx++; scen.started=false; }  // шаг доехал
}

// --- виртуальное устройство ---
defineVirtualDevice("ear", {
  title: "Ear (RT-64)",
  cells: {
    azimuth:   { type:"range", value:0,  min:0,  max:330, units:"deg", order:1, title:"Azimuth" },
    elevation: { type:"range", value:90, min:35, max:90,  units:"deg", order:2, title:"Elevation" },
    home:  { type:"pushbutton", order:3, title:"Home" },
    stop:  { type:"pushbutton", order:4, title:"Stop" },
    scenario: { type:"pushbutton", order:5, title:"Run scenario" },
    sync: { type:"switch", value:true, order:6, title:"Sync axes (arrive together)" },
    scenarioSteps: { type:"text", value:"", readonly:true, order:7, title:"Scenario (JSON)" },
    homed: { type:"switch", value:false, readonly:true, order:8, title:"Homed" },
    status:{ type:"text", value:"idle", readonly:true, order:9, title:"Status" },
    azTicks:{ type:"value", value:0, readonly:true, order:10, title:"Az ticks" },
    elTicks:{ type:"value", value:0, readonly:true, order:11, title:"El ticks" }
  }
});

defineRule("ear_az_cmd", { whenChanged:"ear/azimuth",   then:function(nv){ onSliderCmd(A.az, nv); } });
defineRule("ear_el_cmd", { whenChanged:"ear/elevation", then:function(nv){ onSliderCmd(A.el, nv); } });
defineRule("ear_home",   { whenChanged:"ear/home",      then:function(){ homeAll("homing"); } });
defineRule("ear_stop",   { whenChanged:"ear/stop",      then:function(){ stopAll(); } });
defineRule("ear_scen_run", { whenChanged:"ear/scenario", then:function(){ scenStart(); } });
defineRule("ear_scen_txt", { whenChanged:"ear/scenarioSteps", then:function(nv){
  var s = scenParse(nv);
  if(s){ scen.steps = s; ps["scenario"] = nv; _pub["scenarioSteps"] = nv; }
  else { putc("status", "ERROR: bad scenario JSON"); }
}});
defineRule("ear_lim_az_min", { whenChanged:AZ.limMin, then:function(){ onLimitAxis(A.az,false); } });
defineRule("ear_lim_az_max", { whenChanged:AZ.limMax, then:function(){ onLimitAxis(A.az,true);  } });
defineRule("ear_lim_el_min", { whenChanged:EL.limMin, then:function(){ onLimitAxis(A.el,false); } });
defineRule("ear_lim_el_max", { whenChanged:EL.limMax, then:function(){ onLimitAxis(A.el,true);  } });

// безопасный старт: моторы off
dev[AZ.spd]=false; dev[EL.spd]=false;
scenLoad();

setInterval(function(){
  integrateAxis(A.az); integrateAxis(A.el);
  scenSwallowErrors();
  scenTick();
  coordinate();
  if(!A.az.err) controlAxis(A.az);
  if(!A.el.err) controlAxis(A.el);
  showSlider(A.az); showSlider(A.el);
  setSliderRO(A.az, A.az.job!=="none");
  setSliderRO(A.el, A.el.job!=="none");
  putc("homed", (A.az.homed && A.el.homed));
  putc("azTicks", A.az.moveTicks);   // приращение тиков за текущее движение (сброс после стопа)
  putc("elTicks", A.el.moveTicks);

  var busy = (A.az.job!=="none" || A.el.job!=="none");
  // Home отработал (в т.ч. с ошибкой) -> сброс счётчиков MCM8
  if(!busy && homeActive){ publish("/devices/"+MCM+"/controls/Reset all counters/on", "1", 1, false); A.az.lastRaw=null; A.el.lastRaw=null; homeActive=false; }
  var errs = A.az.err || A.el.err;
  if(errs && !busy){ putc("status", "ERROR: " + errs); }
  else if(scen.active){ putc("status", scenLabel() + (errs ? " (" + errs + ")" : "")); }
  else if(busy){ putc("status", opMode + (errs ? " (" + errs + ")" : "")); }
  else {
    if(opMode==="moving"||opMode==="scenario"||opMode.indexOf("scenario done")===0) opMode="idle";
    else if(opMode==="homing"||opMode==="autopark"||opMode==="scenario home"){ parked=true; opMode="parked"; }
    putc("status", opMode);
  }

  if(busy || scen.active){ idleMs=0; return; }   // во время сценария (в т.ч. пауз) автопарковку не запускаем
  idleMs += LOOP_MS;
  if(!parked && !A.az.err && !A.el.err && idleMs>=IDLE_PARK_MS){
    var azHome = A.az.homed && A.az.ticks>=AZ.rangeTicks-DEAD;   // az парк = 330 (макс/IN2)
    var elHome = A.el.homed && A.el.ticks>=EL.rangeTicks-DEAD;
    if(azHome && elHome){ parked=true; opMode="parked"; }
    else { homeAll("autopark"); }
  }
}, LOOP_MS);
