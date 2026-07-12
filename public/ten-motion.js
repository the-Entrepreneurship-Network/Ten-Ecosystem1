/* ═══════════════════════════════════════
   TEN MOTION ENGINE — ten-motion.js
   Drop this on every page, right before </body>
═══════════════════════════════════════ */
(function(){
  'use strict';

  /* 1. Animated canvas background — constellation of gold dots */
  function initCanvas(){
    const c = document.getElementById('ten-bg-canvas');
    if(!c) return;
    const ctx = c.getContext('2d');
    let W, H, dots=[];

    function resize(){
      W = c.width  = window.innerWidth;
      H = c.height = window.innerHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    function makeDot(){
      return {
        x: Math.random()*W,
        y: Math.random()*H,
        r: Math.random()*1.5+0.3,
        vx:(Math.random()-0.5)*0.25,
        vy:(Math.random()-0.5)*0.25,
        a: Math.random()
      };
    }
    const COUNT = Math.min(120, Math.floor(W*H/12000));
    for(let i=0;i<COUNT;i++) dots.push(makeDot());

    let mouse={x:-9999,y:-9999};
    window.addEventListener('mousemove',e=>{mouse.x=e.clientX;mouse.y=e.clientY;});

    function draw(){
      ctx.clearRect(0,0,W,H);
      for(let i=0;i<dots.length;i++){
        for(let j=i+1;j<dots.length;j++){
          const dx=dots[i].x-dots[j].x, dy=dots[i].y-dots[j].y;
          const dist=Math.sqrt(dx*dx+dy*dy);
          if(dist<130){
            ctx.beginPath();
            ctx.strokeStyle=`rgba(212,175,55,${0.12*(1-dist/130)})`;
            ctx.lineWidth=0.5;
            ctx.moveTo(dots[i].x,dots[i].y);
            ctx.lineTo(dots[j].x,dots[j].y);
            ctx.stroke();
          }
        }
        const mdx=dots[i].x-mouse.x, mdy=dots[i].y-mouse.y;
        const md=Math.sqrt(mdx*mdx+mdy*mdy);
        if(md<100){
          dots[i].x+=mdx/md*1.5;
          dots[i].y+=mdy/md*1.5;
        }
        dots[i].x+=dots[i].vx;
        dots[i].y+=dots[i].vy;
        if(dots[i].x<0||dots[i].x>W) dots[i].vx*=-1;
        if(dots[i].y<0||dots[i].y>H) dots[i].vy*=-1;
        ctx.beginPath();
        ctx.arc(dots[i].x,dots[i].y,dots[i].r,0,Math.PI*2);
        ctx.fillStyle=`rgba(212,175,55,${dots[i].a*0.6})`;
        ctx.fill();
      }
      requestAnimationFrame(draw);
    }
    draw();
  }

  /* 2. Spawn floating particles at bottom */
  function initParticles(){
    if(!document.querySelector('#ten-bg-canvas')) return;
    function spawn(){
      const p=document.createElement('div');
      p.className='ten-particle';
      p.style.cssText=`
        left:${Math.random()*100}vw;
        bottom:0;
        width:${Math.random()*3+1}px;
        height:${Math.random()*3+1}px;
        opacity:${Math.random()*0.5+0.2};
        animation-duration:${Math.random()*6+4}s;
        animation-delay:${Math.random()*3}s;
      `;
      document.body.appendChild(p);
      setTimeout(()=>p.remove(),(parseFloat(p.style.animationDuration)+parseFloat(p.style.animationDelay))*1000);
    }
    setInterval(spawn,800);
  }

  /* 3. Scroll reveal — adds .visible to .ten-reveal elements */
  function initScrollReveal(){
    const els=document.querySelectorAll('.ten-reveal');
    if(!els.length) return;
    const io=new IntersectionObserver(entries=>{
      entries.forEach(e=>{
        if(e.isIntersecting){ e.target.classList.add('visible'); io.unobserve(e.target); }
      });
    },{threshold:0.12});
    els.forEach(el=>io.observe(el));
  }

  /* 4. Stagger animate all cards on page load */
  function initCardStagger(){
    const selectors=[
      '.extras-card','.stu-kpi-card','.sec-card','.stat-card',
      '.nav-card','.portal-option','.dash-card','.insight-card',
      '.doc-card','.badge-card','.ten-card-hover'
    ];
    const cards=document.querySelectorAll(selectors.join(','));
    cards.forEach((card,i)=>{
      card.style.opacity='0';
      card.style.transform='translateY(20px)';
      card.style.transition='opacity 0.5s ease, transform 0.5s cubic-bezier(0.22,1,0.36,1)';
      setTimeout(()=>{
        card.style.opacity='';
        card.style.transform='';
      }, 100+i*60);
    });
  }

  /* 5. Animate number counters (elements with data-count="N") */
  function initCounters(){
    const els=document.querySelectorAll('[data-count]');
    if(!els.length) return;
    const io=new IntersectionObserver(entries=>{
      entries.forEach(e=>{
        if(!e.isIntersecting) return;
        const el=e.target;
        const target=parseInt(el.getAttribute('data-count'))||0;
        const duration=1200;
        const start=performance.now();
        function tick(now){
          const elapsed=now-start;
          const progress=Math.min(elapsed/duration,1);
          const eased=1-Math.pow(1-progress,3);
          el.textContent=Math.round(eased*target).toLocaleString();
          if(progress<1) requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
        io.unobserve(el);
      });
    },{threshold:0.5});
    els.forEach(el=>io.observe(el));
  }

  /* 6. Typing effect for elements with data-typetext attribute */
  function initTyping(){
    const els=document.querySelectorAll('[data-typetext]');
    els.forEach(el=>{
      const text=el.getAttribute('data-typetext');
      el.textContent='';
      el.classList.add('ten-cursor');
      let i=0;
      const interval=setInterval(()=>{
        el.textContent+=text[i];
        i++;
        if(i>=text.length){ clearInterval(interval); el.classList.remove('ten-cursor'); }
      },50);
    });
  }

  /* 7. Cursor glow that follows mouse */
  function initCursorGlow(){
    const glow=document.createElement('div');
    glow.style.cssText=`
      position:fixed;width:300px;height:300px;
      border-radius:50%;pointer-events:none;z-index:0;
      background:radial-gradient(circle,rgba(212,175,55,0.06) 0%,transparent 70%);
      transition:left 0.15s ease,top 0.15s ease;
      transform:translate(-50%,-50%);
    `;
    document.body.appendChild(glow);
    window.addEventListener('mousemove',e=>{
      glow.style.left=e.clientX+'px';
      glow.style.top=e.clientY+'px';
    });
  }

  /* 8. Button ripple on click */
  function initRipples(){
    document.querySelectorAll('button, .btn, [class*="-btn"], [class*="-button"]').forEach(btn=>{
      btn.classList.add('ten-btn-ripple');
      btn.style.position='relative';
      btn.style.overflow='hidden';
      btn.addEventListener('click',function(e){
        const r=document.createElement('span');
        const rect=btn.getBoundingClientRect();
        const size=Math.max(rect.width,rect.height)*2;
        r.style.cssText=`
          position:absolute;
          width:${size}px;height:${size}px;
          left:${e.clientX-rect.left-size/2}px;
          top:${e.clientY-rect.top-size/2}px;
          background:rgba(212,175,55,0.2);
          border-radius:50%;
          pointer-events:none;
          transform:scale(0);
          animation:ten-ripple 0.6s ease-out forwards;
        `;
        btn.appendChild(r);
        setTimeout(()=>r.remove(),700);
      });
    });
  }

  /* 9. Input focus glow */
  function initInputGlow(){
    document.querySelectorAll('input,textarea,select').forEach(el=>{
      el.classList.add('ten-input-glow');
    });
  }

  /* 10. Card hover tilt effect (subtle 3D) */
  function initTilt(){
    document.querySelectorAll('.ten-card-hover').forEach(card=>{
      card.addEventListener('mousemove',e=>{
        const r=card.getBoundingClientRect();
        const x=(e.clientX-r.left)/r.width-0.5;
        const y=(e.clientY-r.top)/r.height-0.5;
        card.style.transform=`translateY(-5px) perspective(600px) rotateY(${x*8}deg) rotateX(${-y*8}deg)`;
      });
      card.addEventListener('mouseleave',()=>{
        card.style.transform='';
      });
    });
  }

  /* 11. Page transition fade-out on link click */
  function initPageTransition(){
    const overlay=document.createElement('div');
    overlay.style.cssText=`
      position:fixed;inset:0;background:#05070e;z-index:99999;
      opacity:0;pointer-events:none;
      transition:opacity 0.3s ease;
    `;
    document.body.appendChild(overlay);
    document.querySelectorAll('a[href]').forEach(a=>{
      const href=a.getAttribute('href');
      if(!href||href.startsWith('#')||href.startsWith('mailto')||href.startsWith('javascript')) return;
      if(a.target==='_blank') return;
      a.addEventListener('click',function(e){
        e.preventDefault();
        overlay.style.opacity='1';
        overlay.style.pointerEvents='all';
        setTimeout(()=>{ window.location.href=href; },280);
      });
    });
    overlay.style.opacity='1';
    overlay.style.pointerEvents='all';
    requestAnimationFrame(()=>{
      requestAnimationFrame(()=>{
        overlay.style.opacity='0';
        overlay.style.pointerEvents='none';
      });
    });
  }

  /* 12. Add canvas + scanline elements to body */
  function injectLayerElements(){
    if(!document.getElementById('ten-bg-canvas')){
      const canvas=document.createElement('canvas');
      canvas.id='ten-bg-canvas';
      document.body.insertBefore(canvas,document.body.firstChild);
    }
    if(!document.querySelector('.ten-scanline')){
      const sl=document.createElement('div');
      sl.className='ten-scanline';
      document.body.appendChild(sl);
    }
  }

  /* ── Boot sequence ── */
  function boot(){
    injectLayerElements();
    initCanvas();
    initParticles();
    initScrollReveal();
    initCardStagger();
    initCounters();
    initTyping();
    initCursorGlow();
    initRipples();
    initInputGlow();
    initTilt();
    initPageTransition();
  }

  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',boot);
  } else {
    boot();
  }
})();
