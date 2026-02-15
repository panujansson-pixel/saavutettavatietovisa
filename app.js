/* app.js — Parannettu timeout-käsittely ja selkeämmät lukitus/tulosäänet
   - Kysymys luetaan ensin
   - Ajastin pysähtyy kysymyksen lukemisen ajaksi
   - Jos ajastin loppuu: automaattinen lukitus jos valittu, muuten kerrotaan aika loppui
   - "Vastaus lukittu" pysyy näkyvissä kunnes seuraava kysymys renderöidään
   - Selkeämmät äänet (lukitus + oikea/väärä)
*/

(() => {
  const $ = sel => document.querySelector(sel);

  let isSpeaking = false;
  let lastNavTime = 0;
  let timerWasRunning = false;

  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  function playTone(freq, dur=0.12, vol=0.12){
    try{
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type='sine';
      o.frequency.value=freq;
      g.gain.value=vol;
      o.connect(g); g.connect(audioCtx.destination);
      // quick ramp to avoid click
      g.gain.setValueAtTime(0, audioCtx.currentTime);
      g.gain.linearRampToValueAtTime(vol, audioCtx.currentTime + 0.01);
      o.start();
      setTimeout(()=>{ try{ g.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.01); o.stop(); o.disconnect(); g.disconnect(); }catch(e){} }, Math.max(1, dur*1000));
    }catch(e){}
  }

  // feedback tones — erottuvammat
  const toneSelect = () => playTone(680,0.08,0.10);        // valinta
  const toneLock   = () => { playTone(520,0.12,0.14); };   // lukitus (selkeä)
  const toneCorrect= () => { playTone(880,0.14,0.18); setTimeout(()=>playTone(1100,0.12,0.16),140); };
  const toneWrong  = () => playTone(220,0.40,0.20);

  const speak = (text, lang='fi-FI', rate=1.0, onend=null)=>{
    if(!window.speechSynthesis){ if(onend) onend(); return; }
    const u=new SpeechSynthesisUtterance(text);
    u.lang=lang;
    u.rate=rate;
    u.onstart=()=>{ isSpeaking=true; };
    u.onend=()=>{ isSpeaking=false; if(onend) onend(); };
    u.onerror=()=>{ isSpeaking=false; if(onend) onend(); };
    window.speechSynthesis.speak(u);
  };

  let state={
    themes:[],
    selectedThemeId:null,
    language:'fi',
    difficulty:'normal',
    currentQuestions:[],
    currentIndex:0,
    selectedOption:null,
    score:0,
    timer:null,
    timeRemaining:0
  };

  const themeSelect=$('#themeSelect');
  const questionTextEl=$('#questionText');
  const optionsEl=$('#options');
  const questionNumberEl=$('#questionNumber');
  const statusEl=$('#status'); // aria-live element (polite)
  const scoreArea=$('#scoreArea');

  // show status and KEEP until cleared explicitly (use clearStatus)
  function showStatusPersistent(text){
    statusEl.textContent = text;
  }
  function clearStatusIfMatches(text){
    if(statusEl.textContent === text) statusEl.textContent = '';
  }

  function stopTimer(){
    if(state.timer){ clearInterval(state.timer); state.timer=null; }
  }

  function resumeTimer(){
    const lang = state.language;
    stopTimer();
    state.timer = setInterval(()=>{
      state.timeRemaining--;
      if(state.timeRemaining <= 3 && state.timeRemaining > 0){
        playTone(1200,0.07,0.10);
        const wordsFi=['yksi','kaksi','kolme'];
        const wordsEn=['one','two','three'];
        const w = (lang==='fi'?wordsFi:wordsEn)[state.timeRemaining-1] || String(state.timeRemaining);
        speak(w, lang==='fi'?'fi-FI':'en-US', 0.9);
      } else if (state.timeRemaining <= 0) {
        // ensure we handle timeout safely
        stopTimer();
        handleTimeout();
      }
    },1000);
  }

  function startTimer(){
    stopTimer();
    const mapping={easy:25,normal:15,hard:8};
    state.timeRemaining = mapping[state.difficulty] || 15;
    resumeTimer();
  }

  // If timer ends: if an option is selected -> lock it; otherwise announce time's up and show correct
  function handleTimeout(){
    const q = state.currentQuestions[state.currentIndex];
    if(!q) return;

    // If user has a selection, auto-lock that selection
    if(state.selectedOption !== null){
      // Give clear visual + aria-live
      showStatusPersistent(state.language==='fi' ? 'Aika loppui — vastaus lukittu' : 'Time up — answer locked');
      // Lock tone
      toneLock();
      // small delay to hear lock tone
      setTimeout(()=>{
        if(state.selectedOption === q.correctIndex){
          toneCorrect();
          speak(state.language==='fi' ? 'Aika loppui — oikein' : 'Time up — correct', state.language==='fi' ? 'fi-FI' : 'en-US');
          state.score++;
        } else {
          toneWrong();
          speak(state.language==='fi' ? 'Aika loppui — väärin. Oikea vastaus:' : 'Time up — wrong. Correct answer:', state.language==='fi' ? 'fi-FI' : 'en-US',
            ()=> speak(q.options[q.correctIndex], state.language==='fi' ? 'fi-FI' : 'en-US'));
        }
        // wait longer to ensure user hears result
        setTimeout(()=> {
          // clear status and move on
          clearStatusIfMatches(state.language==='fi' ? 'Aika loppui — vastaus lukittu' : 'Time up — answer locked');
          nextQuestion();
        }, 1400);
      }, 180);
    } else {
      // No selection — just announce time up and show correct answer
      showStatusPersistent(state.language==='fi' ? 'Aika loppui' : 'Time up');
      toneWrong();
      speak(state.language==='fi' ? 'Aika loppui' : 'Time\'s up', state.language==='fi' ? 'fi-FI' : 'en-US', 1.0, ()=>{
        speak(state.language==='fi' ? 'Oikea vastaus on' : 'The correct answer is', state.language==='fi' ? 'fi-FI' : 'en-US', 1.0, ()=>{
          speak(q.options[q.correctIndex], state.language==='fi' ? 'fi-FI' : 'en-US');
        });
      });
      // move on after enough time
      setTimeout(()=> {
        clearStatusIfMatches(state.language==='fi' ? 'Aika loppui' : 'Time up');
        nextQuestion();
      }, 1800);
    }
  }

  function speakQuestion(q){
    timerWasRunning = !!state.timer;
    if(timerWasRunning) stopTimer();
    speak((state.language==='fi' ? 'Kysymys: ' : 'Question: ') + q.questionText,
      state.language==='fi' ? 'fi-FI' : 'en-US', 0.95,
      ()=>{
        if(timerWasRunning){
          // small gap then resume
          setTimeout(()=> resumeTimer(), 90);
        }
      });
  }

  function renderThemeOptions(){
    themeSelect.innerHTML='';
    state.themes.forEach(t=>{
      const opt=document.createElement('option');
      opt.value=t.id;
      opt.textContent=t.name;
      themeSelect.appendChild(opt);
    });
    if(!state.selectedThemeId && state.themes.length) state.selectedThemeId=state.themes[0].id;
    themeSelect.value = state.selectedThemeId || (state.themes[0] && state.themes[0].id) || '';
  }

  function renderQuestion(){
    const q = state.currentQuestions[state.currentIndex];
    if(!q) return;
    questionNumberEl.textContent = `Kysymys ${state.currentIndex+1}/${state.currentQuestions.length}`;
    questionTextEl.textContent = q.questionText;
    optionsEl.innerHTML = '';
    state.selectedOption = null;
    // clear any previous status
    statusEl.textContent = '';

    q.options.forEach((opt, idx) => {
      const btn = document.createElement('button');
      btn.className = 'optionBtn';
      btn.textContent = `${idx+1}. ${opt}`;
      btn.dataset.index = idx;
      btn.onclick = () => {
        if (isSpeaking) return;
        selectOption(idx);
      };
      btn.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectOption(idx); } };
      optionsEl.appendChild(btn);
    });

    // Read question first, pause timer while reading
    speakQuestion(q);
    updateScore();
  }

  function selectOption(idx){
    // block if question TTS running
    if(isSpeaking) return;
    state.selectedOption = idx;
    [...optionsEl.children].forEach((b,i)=>{
      b.setAttribute('aria-selected', i===idx ? 'true' : 'false');
      b.style.background = i===idx ? '#0b84ff' : '';
      b.style.color = i===idx ? '#fff' : '';
    });
    toneSelect();
    const q = state.currentQuestions[state.currentIndex];
    speak((state.language==='fi' ? 'Vaihtoehto ' : 'Option ') + (idx+1) + '. ' + q.options[idx],
      state.language==='fi' ? 'fi-FI' : 'en-US', 0.95);
  }

  function confirmAnswer(){
    const q = state.currentQuestions[state.currentIndex];
    if(!q) return;
    if(state.selectedOption === null){
      speak(state.language==='fi' ? 'Et valinnut vaihtoehtoa' : 'No option selected', state.language==='fi' ? 'fi-FI' : 'en-US');
      return;
    }

    // persistent status until next question
    const lockedText = state.language==='fi' ? 'Vastaus lukittu' : 'Answer locked';
    showStatusPersistent(lockedText);

    toneLock();
    setTimeout(()=>{
      if(state.selectedOption === q.correctIndex){
        toneCorrect();
        speak(state.language==='fi' ? 'Oikein!' : 'Correct!', state.language==='fi' ? 'fi-FI' : 'en-US');
        state.score++;
      } else {
        toneWrong();
        speak(state.language==='fi' ? 'Väärin. Oikea vastaus oli' : 'Wrong. Correct answer was', state.language==='fi' ? 'fi-FI' : 'en-US',
          ()=> speak(q.options[q.correctIndex], state.language==='fi' ? 'fi-FI' : 'en-US'));
      }
      stopTimer();
      // wait so user hears result, then clear status and go next
      setTimeout(()=>{
        clearStatusIfMatches(lockedText);
        nextQuestion();
      }, 1300);
    }, 160);
  }

  function nextQuestion(){
    state.currentIndex++;
    state.selectedOption = null;
    if(state.currentIndex >= state.currentQuestions.length){
      statusEl.textContent = state.language==='fi' ? 'Peli päättyi' : 'Game over';
      speak(state.language==='fi' ? `Peli päättyi. Pisteesi ${state.score}` : `Game over. Your score ${state.score}`, state.language==='fi'?'fi-FI':'en-US');
      return;
    }
    renderQuestion();
    startTimer();
  }

  function shuffle(a){
    for(let i=a.length-1;i>0;i--){
      const j=Math.floor(Math.random()*(i+1));
      [a[i],a[j]]=[a[j],a[i]];
    }
    return a;
  }

  function startGame(){
    // resume audio context if suspended (user interaction)
    try{ if(audioCtx && audioCtx.state === 'suspended') audioCtx.resume(); } catch(e){}
    state.language = $('#languageSelect').value || 'fi';
    state.difficulty = $('#difficultySelect').value || 'normal';
    state.selectedThemeId = themeSelect.value;
    const theme = state.themes.find(t => t.id === state.selectedThemeId);
    if(!theme || !theme.questions || !theme.questions.length){
      speak(state.language==='fi' ? 'Valittu teema ei sisällä kysymyksiä' : 'Selected theme has no questions', state.language==='fi'?'fi-FI':'en-US');
      return;
    }
    state.currentQuestions = shuffle(theme.questions.slice());
    state.currentIndex = 0;
    state.selectedOption = null;
    state.score = 0;
    renderQuestion();
    startTimer();
  }

  // Keyboard handling (debounce + prevent key repeat + block while speaking)
  window.addEventListener('keydown', (e)=>{
    if(e.repeat) { e.preventDefault(); return; }
    if(isSpeaking) { e.preventDefault(); return; }
    const now = Date.now();
    if(now - lastNavTime < 200){ e.preventDefault(); return; }
    lastNavTime = now;

    if(e.key === 'ArrowDown'){
      e.preventDefault();
      const q = state.currentQuestions[state.currentIndex];
      if(!q) return;
      const next = (state.selectedOption === null) ? 0 : Math.min(q.options.length - 1, state.selectedOption + 1);
      selectOption(next);
    } else if(e.key === 'ArrowUp'){
      e.preventDefault();
      const q = state.currentQuestions[state.currentIndex];
      if(!q) return;
      const prev = (state.selectedOption === null) ? 0 : Math.max(0, state.selectedOption - 1);
      selectOption(prev);
    } else if(e.key === 'Enter'){
      e.preventDefault();
      confirmAnswer();
    } else if(e.key === 's' || e.key === 'S'){
      startGame();
    }
  });

  // Load themes from quiz_pack_300.json (grouped by q.theme)
  fetch('quiz_pack_300.json')
    .then(r=>{
      if(!r.ok) throw new Error('no pack');
      return r.json();
    })
    .then(data=>{
      const grouped = {};
      (data.questions || []).forEach(q=>{
        const name = q.theme || 'Imported';
        if(!grouped[name]) grouped[name]=[];
        // normalize fields
        grouped[name].push({
          questionText: q.questionText || q.question || '',
          options: q.options || q.opts || [],
          correctIndex: typeof q.correctIndex === 'number' ? q.correctIndex : (q.answerIndex || 0)
        });
      });
      state.themes = Object.keys(grouped).map(name=>({ id: name, name: name, questions: grouped[name] }));
      renderThemeOptions();
    })
    .catch(()=>{
      // fallback single theme
      state.themes = [{
        id:'muumit',
        name:'Muumit',
        questions:[{
          questionText:'Kuka on Muumipapan puoliso?',
          options:['Muumimamma','Niiskuneiti','Pikku Myy'],
          correctIndex:0
        }]
      }];
      renderThemeOptions();
    });

  // UI buttons (binds — ensure these elements exist in index.html)
  const startBtn = $('#startBtn'); if(startBtn) startBtn.onclick = startGame;
  const confirmBtn = $('#confirmBtn'); if(confirmBtn) confirmBtn.onclick = confirmAnswer;

  // expose small debug (optional)
  window.__quizState = state;

})();
