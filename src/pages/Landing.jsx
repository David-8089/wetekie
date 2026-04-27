import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./Landing.css";

const PHASES = [
  { kicker: "Real-time", h: "Chat with\nyour whole class.", sub: "Live rooms. Real people. Zero lag." },
  { kicker: "AI-powered", h: "Ask @gemini.\nGet unstuck fast.", sub: "No tab switching. Just mention and go." },
  { kicker: "File sharing", h: "Drop notes\nright into chat.", sub: "Slides, images, PDFs — all in one place." },
  { kicker: "Your space", h: "Wetekie is\nbuilt for you.", sub: "Free for students. No ads. No noise." },
];

const MARQUEE = ["Real-time messaging","AI-powered help","File sharing","Study rooms","Group collaboration","Built for students","Always free","@gemini inside chat","Instant sync","Late night grind","Course mates","Project squads"];

export default function Landing() {
  const nav = useNavigate();
  const [phase, setPhase] = useState(0);
  const [animKey, setAnimKey] = useState(0);
  const scRef = useRef(null);

  useEffect(() => {
    const onScroll = () => {
      if (!scRef.current) return;
      const r = scRef.current.getBoundingClientRect();
      const total = scRef.current.offsetHeight - window.innerHeight;
      const scrolled = -r.top;
      const p = Math.max(0, Math.min(0.999, scrolled / total));
      const newPhase = Math.min(3, Math.floor(p * 4));
      setPhase(prev => {
        if (prev !== newPhase) setAnimKey(k => k + 1);
        return newPhase;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // scroll reveal
  useEffect(() => {
    const els = document.querySelectorAll(".sr");
    const io = new IntersectionObserver(entries => {
      entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add("sv"); io.unobserve(e.target); } });
    }, { threshold: 0.15 });
    els.forEach(el => io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    <div className="land">
      {/* NAV */}
      <nav className="land-nav">
        <div className="land-logo">wete<em>kie</em></div>
        <div className="land-nav-r">
          <a href="#about">About</a>
          <a href="#features">Features</a>
          <button className="land-cta" onClick={() => nav("/login")}>Sign in</button>
          <button className="land-cta land-cta-fill" onClick={() => nav("/signup")}>Join free</button>
        </div>
      </nav>

      {/* HERO */}
      <section className="hero">
        <div className="hero-bg" />
        <div className="hero-grid" />
        <div className="hero-badge">
          <span className="badge-dot" />
          <span>Now in early access</span>
        </div>
        <h1 className="hero-h1">
          <span className="h1-l1">Study together.</span>
          <span className="h1-l2">Build together.</span>
        </h1>
        <p className="hero-p">Wetekie is the group chat built for students — real-time rooms, file sharing, and AI that actually helps.</p>
        <div className="hero-btns">
          <button className="btn-fill" onClick={() => nav("/signup")}>Join for free</button>
          <button className="btn-ghost" onClick={() => nav("/login")}>Sign in</button>
        </div>
        <div className="hero-mockup">
          <div className="mockup-glow" />
          <div className="app-win">
            <div className="win-bar">
              <span className="wd r"/><span className="wd y"/><span className="wd g"/>
              <div className="win-tabs">
                <span className="wtab on"># study-hall</span>
                <span className="wtab"># random</span>
                <span className="wtab"># project-x</span>
              </div>
            </div>
            <div className="win-body">
              <div className="win-sidebar">
                <div className="sb-label">Rooms</div>
                {["study-hall","random","project-x","maths-101"].map((r,i) => (
                  <div key={r} className={`sb-room${i===0?" on":""}`}><span className="hash">#</span>{r}{i===0&&<span className="online-dot"/>}</div>
                ))}
                <div className="sb-label" style={{marginTop:16}}>Online — 3</div>
                {[{n:"Ada J.",c:"#b8acff",bg:"#1a1040"},{n:"Zaki K.",c:"#60a5fa",bg:"#0d1f30"},{n:"Mira O.",c:"#86efac",bg:"#0d2015"}].map(u=>(
                  <div key={u.n} className="sb-user"><div className="sb-av" style={{background:u.bg,color:u.c}}>{u.n[0]}</div>{u.n}</div>
                ))}
              </div>
              <div className="win-chat">
                <div className="win-msgs">
                  <div className="wm"><div className="wm-av" style={{background:"#1a1040",color:"#b8acff"}}>AJ</div><div className="wm-b">yo has anyone started the OS assignment??</div></div>
                  <div className="wm me"><div className="wm-av" style={{background:"#0d1f30",color:"#60a5fa"}}>ME</div><div className="wm-b">just starting, it's giving me a headache lol</div></div>
                  <div className="wm"><div className="wm-av" style={{background:"#0d2015",color:"#86efac"}}>MO</div><div className="wm-b">@gemini explain deadlocks simply</div></div>
                  <div className="wm-ai"><span className="ai-spark">✦</span><span>A deadlock is when two processes each wait for what the other holds — like two people grabbing opposite chopsticks. Want a code example?</span></div>
                </div>
                <div className="win-input"><span className="win-ph">Message #study-hall or @gemini...</span></div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* MARQUEE */}
      <div className="marquee-wrap">
        <div className="marquee-track">
          {[...MARQUEE,...MARQUEE,...MARQUEE,...MARQUEE].map((t,i)=>(
            <div key={i} className="marquee-item"><span className="m-dot"/>{ t}</div>
          ))}
        </div>
      </div>

      {/* SCROLL CINEMA */}
      <section className="sc-section" ref={scRef}>
        <div className="sc-sticky">
          <div className="sc-bg"/>
          <div className="sc-content" key={animKey}>
            <div className="sc-kicker">{PHASES[phase].kicker}</div>
            <h2 className="sc-h">{PHASES[phase].h.split("\n").map((l,i)=><span key={i}>{l}<br/></span>)}</h2>
            <p className="sc-sub">{PHASES[phase].sub}</p>
          </div>
          <div className="sc-bars">
            {PHASES.map((_,i)=>(
              <div key={i} className={`sc-bar${i===phase?" active":""}`}>
                <div className="sc-fill" style={{width: i < phase ? "100%" : i === phase ? "100%" : "0%", transition: i===phase?"width 2.5s linear":"none"}}/>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section className="features-s" id="features">
        <div className="fs-head sr">
          <div className="eyebrow">What's inside</div>
          <h2>Everything your squad needs.</h2>
        </div>
        <div className="feat-grid">
          {[
            {n:"Live group chat",d:"Create rooms for any subject or squad. Messages sync in real time across everyone.",tag:"Real-time",icon:"💬",num:"01"},
            {n:"AI in the chat",d:"Mention @gemini and get instant help — explanations, summaries, code — right in your room.",tag:"Powered by Gemini",icon:"✦",num:"02"},
            {n:"File sharing",d:"Drop notes, slides, and images straight into chat. Preview without leaving Wetekie.",tag:"Any file type",icon:"📎",num:"03"},
            {n:"Study rooms",d:"Dedicated rooms for courses and late-night sessions. Invite anyone with a single link.",tag:"Always free",icon:"🚀",num:"04"},
          ].map((f,i)=>(
            <div className="feat-card sr" key={f.n} style={{transitionDelay:`${i*0.08}s`}}>
              <div className="fc-num">{f.num}</div>
              <div className="fc-icon">{f.icon}</div>
              <h3>{f.n}</h3>
              <p>{f.d}</p>
              <span className="fc-tag">{f.tag}</span>
              <div className="fc-glow"/>
            </div>
          ))}
        </div>
      </section>

      {/* ABOUT */}
      <section className="about-s sr" id="about">
        <div className="eyebrow">About Wetekie</div>
        <h2>Built for the way students actually work.</h2>
        <p>Whether you're grinding an assignment at 2am, planning a group project, or just vibing with your course mates — Wetekie is your space. AI is built right in, so getting unstuck is just a mention away.</p>
      </section>

      {/* SIGNUP CTA */}
      <section className="land-cta-s sr" id="signup">
        <div className="cta-card">
          <div className="eyebrow">Early access</div>
          <h2>Join Wetekie today.</h2>
          <p>Free for students. Always.</p>
          <div className="cta-btns">
            <button className="btn-fill big" onClick={() => nav("/signup")}>Create my account</button>
            <button className="btn-ghost big" onClick={() => nav("/login")}>I have an account</button>
          </div>
        </div>
      </section>

      <footer className="land-footer">
        <div className="land-logo">wete<em>kie</em></div>
        <p>2025 Wetekie — where students actually get things done.</p>
      </footer>
    </div>
  );
}
