'use strict';
(() => {
  const canvas = document.getElementById('globe');
  const ctx = canvas.getContext('2d');
  const story = document.getElementById('story');
  const stage = story.querySelector('.story-stage');
  const header = document.querySelector('.site-header');
  const hkMarker = document.getElementById('hkMarker');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  // Keep one accessible name while the terminal cycles through its introduction.
  const terminal = document.querySelector('.terminal-input');
  const terminalText = terminal.querySelector('.terminal-text');
  const fullName = terminalText.textContent;
  const phrases = ['...', fullName, 'Presented by Topic 9 Team'];
  let typingTimer = 0;

  function finishTyping() {
    clearTimeout(typingTimer);
    terminalText.textContent = fullName;
    terminal.classList.remove('is-typing', 'is-selected');
  }

  function typePhrase(index) {
    const phrase = phrases[index];
    let count = 0;
    terminalText.textContent = '';
    terminal.classList.remove('is-selected');
    terminal.classList.add('is-typing');

    function typeNext() {
      count += 1;
      terminalText.textContent = phrase.slice(0, count);
      if (count < phrase.length) {
        const pause = index === 0 ? 140 : phrase[count - 1] === ' ' ? 105 : 46;
        typingTimer = setTimeout(typeNext, pause);
        return;
      }
      terminal.classList.remove('is-typing');
      // Hold the complete phrase for two seconds, select it, then delete at once.
      typingTimer = setTimeout(() => {
        terminal.classList.add('is-selected');
        typingTimer = setTimeout(() => {
          terminalText.textContent = '';
          terminal.classList.remove('is-selected');
          typingTimer = setTimeout(() => typePhrase((index + 1) % phrases.length), 180);
        }, 360);
      }, 2000);
    }
    typingTimer = setTimeout(typeNext, 140);
  }

  function startTyping() {
    clearTimeout(typingTimer);
    if (reduced.matches) { finishTyping(); return; }
    typePhrase(0);
  }
  startTyping();
  reduced.addEventListener('change', startTyping);
  const radians = Math.PI / 180;
  const hk = { lat: 22.3193, lon: 114.1694 };
  let width = 0, height = 0, radius = 0, cx = 0, cy = 0;
  let coastlines = [], current = 0, target = 0, frame = 0, dirty = true, visible = true;
  let camera;
  const clamp = (n, a = 0, b = 1) => Math.min(b, Math.max(a, n));
  const smooth = n => { n = clamp(n); return n * n * (3 - 2 * n); };
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  function vector(lon, lat) {
    lon *= radians; lat *= radians;
    return [Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon)];
  }
  function view(lon, lat) {
    lon *= radians; lat *= radians;
    return {
      east: [-Math.sin(lon), 0, Math.cos(lon)],
      north: [-Math.sin(lat) * Math.cos(lon), Math.cos(lat), -Math.sin(lat) * Math.sin(lon)],
      front: [Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon)]
    };
  }
  function project(point) { return { x: dot(point, camera.east), y: dot(point, camera.north), z: dot(point, camera.front) }; }
  function screen(p) { return { x: cx + p.x * radius, y: cy - p.y * radius }; }
  const grid = [];
  for (let lat = -75; lat <= 75; lat += 15) {
    const points = []; for (let lon = -180; lon <= 180; lon += 3) points.push(vector(lon, lat)); grid.push(points);
  }
  for (let lon = -180; lon < 180; lon += 15) {
    const points = []; for (let lat = -90; lat <= 90; lat += 3) points.push(vector(lon, lat)); grid.push(points);
  }
  function strokePaths(paths, front, color, lineWidth) {
    ctx.beginPath();
    for (const path of paths) {
      let previous = null;
      for (const point of path) {
        const p = project(point), s = screen(p);
        const inside = front ? p.z >= 0 : p.z < 0;
        if (previous) {
          const prevInside = front ? previous.p.z >= 0 : previous.p.z < 0;
          if (inside !== prevInside) {
            const t = previous.p.z / (previous.p.z - p.z);
            const edge = { x: previous.s.x + t * (s.x - previous.s.x), y: previous.s.y + t * (s.y - previous.s.y) };
            if (prevInside) ctx.lineTo(edge.x, edge.y); else ctx.moveTo(edge.x, edge.y);
          }
        }
        if (inside) {
          if (!previous || (front ? previous.p.z < 0 : previous.p.z >= 0)) ctx.moveTo(s.x, s.y);
          else ctx.lineTo(s.x, s.y);
        }
        previous = { p, s };
      }
    }
    ctx.strokeStyle = color; ctx.lineWidth = lineWidth; ctx.stroke();
  }
  function flightPoint(t) {
    const theta = (145 - t * 200) * radians;
    return { x: Math.sin(theta) * 1.18, y: .37 + Math.cos(theta) * .40, z: Math.cos(theta) * 1.18 };
  }
  function flight(front, phase) {
    if (reduced.matches || phase <= .002) return;
    ctx.beginPath(); let drawing = false;
    for (let i = 0; i <= 170; i++) {
      const p = flightPoint(phase * i / 170), s = screen(p);
      const isFront = p.z >= 0;
      if (isFront !== front) { drawing = false; continue; }
      if (!drawing) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y);
      drawing = true;
    }
    ctx.strokeStyle = front ? 'rgba(245,246,248,.65)' : 'rgba(245,246,248,.28)';
    ctx.lineWidth = front ? 1.25 : 1; ctx.stroke();
    const p = flightPoint(phase);
    if ((p.z >= 0) !== front) return;
    const s = screen(p);
    // An analytic tangent stays defined when the scroll reaches the endpoint.
    const theta = (145 - phase * 200) * radians;
    const angularVelocity = -200 * radians;
    const tangentX = 1.18 * Math.cos(theta) * angularVelocity;
    const tangentY = .40 * Math.sin(theta) * angularVelocity;
    const heading = Math.atan2(tangentY, tangentX);
    canvas.dataset.planeHeading = heading.toFixed(6);
    ctx.save();ctx.translate(s.x, s.y);ctx.rotate(heading);
    const size = (width < 700 ? .58 : .82) * (.94 + .08 * Math.max(p.z, 0));
    ctx.scale(size,size);
    // Rounded fuselage, swept wings, tailplanes and paired engine nacelles.
    const aircraft = new Path2D('M26 0 C25 -1.3 21 -2.1 15 -2.15 L5 -2.1 L-6 -18 L-10 -18 L-5 -2 L-18 -1.5 L-24 -7 L-27 -7 L-24 0 L-27 7 L-24 7 L-18 1.5 L-5 2 L-10 18 L-6 18 L5 2.1 L15 2.15 C21 2.1 25 1.3 26 0 Z');
    ctx.fillStyle = '#090b0e';ctx.fill(aircraft);
    ctx.strokeStyle = '#f0f2f5';ctx.lineWidth = 1.05;
    ctx.lineJoin = 'round';ctx.lineCap = 'round';ctx.stroke(aircraft);
    ctx.beginPath();
    ctx.ellipse(-1,-7.2,3.5,1.25,0,0,Math.PI*2);
    ctx.ellipse(-1,7.2,3.5,1.25,0,0,Math.PI*2);
    ctx.fill();ctx.stroke();
    ctx.beginPath();ctx.moveTo(19,-1.35);ctx.quadraticCurveTo(17,0,19,1.35);
    ctx.strokeStyle = '#dce2ed';ctx.lineWidth = .65;ctx.stroke();
    ctx.restore();
  }
  function positionHongKong() {
    const marker = project(vector(hk.lon, hk.lat));
    // The marker follows the same projection and disappears behind the globe.
    hkMarker.hidden = marker.z <= .08;
    if (hkMarker.hidden) return;
    const point = screen(marker);
    hkMarker.style.transform = `translate(${point.x}px, ${point.y}px)`;
    hkMarker.style.opacity = smooth((marker.z - .08) / .18).toFixed(3);
    const labelWidth = width < 700 ? 112 : 132;
    hkMarker.classList.toggle('is-left', point.x + 32 + labelWidth > width - 22);
  }

  function draw(p) {
    ctx.clearRect(0,0,width,height);
    const mobile = width < 700;
    radius = (mobile ? Math.min(width * .36,height * .26) : Math.min(width * .285,height * .38)) * (1 + .055 * p);
    cx = mobile ? width * .49 : width * .67;
    cy = mobile ? height * .75 : height * .575;
    camera = view(hk.lon - p * 106, hk.lat - p * 7);
    const phase = smooth((p - .18) / .75);
    flight(false,phase);
    ctx.beginPath();ctx.arc(cx,cy,radius,0,Math.PI*2);
    const shade=ctx.createRadialGradient(cx-radius*.3,cy-radius*.3,radius*.1,cx,cy,radius);
    shade.addColorStop(0,'#0b0d10');shade.addColorStop(.85,'#090b0e');shade.addColorStop(1,'#08090b');
    ctx.fillStyle=shade;ctx.fill();
    ctx.save();ctx.beginPath();ctx.arc(cx,cy,radius,0,Math.PI*2);ctx.clip();
    strokePaths(grid,false,'rgba(159,169,183,.055)',.7);
    strokePaths(grid,true,'rgba(171,181,195,.20)',.7);
    strokePaths(coastlines,true,'rgba(230,234,241,.64)',.9);
    ctx.restore();
    ctx.beginPath();ctx.arc(cx,cy,radius,0,Math.PI*2);ctx.strokeStyle='rgba(187,197,210,.30)';ctx.lineWidth=.85;ctx.stroke();
    flight(true,phase);
    positionHongKong();
    canvas.dataset.progress=p.toFixed(3);
    canvas.dataset.planeVisible=String(phase>.14);
  }
  function updateCopy(p) {
    document.getElementById('progressFill').style.width=`${p*100}%`;
  }
  function tick() {
    frame=0;
    const next=reduced.matches?0:current+(target-current)*.085;
    const moving=Math.abs(next-current)>.00005;current=next;
    if(dirty||moving){draw(current);updateCopy(current);dirty=false;}
    if(moving&&visible)frame=requestAnimationFrame(tick);
  }
  function schedule(){dirty=true;if(!frame)frame=requestAnimationFrame(tick);}
  function onScroll(){
    const rect=story.getBoundingClientRect();
    target=clamp(-rect.top/Math.max(1,story.offsetHeight-stage.offsetHeight));
    visible=rect.bottom>0&&rect.top<innerHeight;
    header.classList.toggle('is-scrolled',scrollY>40);
    if(visible)schedule();
  }
  function resize(){
    width=stage.clientWidth;height=stage.clientHeight;
    const dpr=Math.min(devicePixelRatio||1,2.5);
    canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);
    onScroll();schedule();
  }
  fetch('/assets/coastlines.json').then(r=>{if(!r.ok)throw Error('Coastline geometry unavailable');return r.json();}).then(paths=>{
    coastlines=paths.map(path=>path.map(([lon,lat])=>vector(lon,lat)));schedule();
  }).catch(()=>{canvas.dataset.coastlineError='true';});
  const observer=new IntersectionObserver(entries=>{entries.forEach(entry=>{if(entry.isIntersecting){entry.target.classList.add('is-visible');observer.unobserve(entry.target);}});},{threshold:.12});
  document.querySelectorAll('.reveal').forEach(el=>observer.observe(el));
  addEventListener('scroll',onScroll,{passive:true});addEventListener('resize',resize,{passive:true});
  reduced.addEventListener('change',()=>{current=0;resize();});
  addEventListener('visibilitychange',()=>{if(!document.hidden)onScroll();});
  resize();
})();
