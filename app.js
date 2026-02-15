/* app.js — STABIILI VERSIO
   - Kysymys luetaan ensin kokonaan
   - Ajastin pysähtyy lukemisen ajaksi
   - Vaihtoehdot luetaan siirryttäessä
   - Lukitusääni + oikea/väärä-äänet
   - "Vastaus lukittu" aria-live
   - Ei sustain-ääntä
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
      o.start();
      setTimeout(()=>{ try{o.stop(); o.disconnect(); g.disconnect();}catch(e){} }, dur*1000);
    }catch(e){}
  }

  const toneSelect = () => playTone(650,0.08,0.08);
  const toneLock   = () => playTone(520,0.10,0.10);
  const toneCorrect= () => { playTone(880,0.10,0.14); setTimeout(()=>playTone(1100,0.10,0.12),120); };
  const toneWrong  = () => playTone(220,0.25,0.16);

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
  const statusEl=$('#status');
  const scoreArea=$('#scoreArea');

  function renderThemeOptions(){
    themeSelect.innerHTML='';
    state.themes.forEach(t=>{
      const opt=document.createElement('option');
      opt.value=t.id;
      opt.textContent=t.name;
      themeSelect.appendChild(opt);
    });
    if(!state.selectedThemeId && state.themes.length){
      state.selectedThemeId=state.themes[0].id;
    }
    themeSelect.value=state.selectedThemeId;
  }

  function getThemeById(id){ return state.themes.find(t=>t.id===id); }

  function showStatus(text, timeout=1500){
    statusEl.textContent=text;
    setTimeout(()=>{
      if(statusEl.textContent===text) statusEl.textContent='';
    },timeout);
  }

  function stopTimer(){
    if(state.timer){ clearInterval(state.timer); state.timer=null; }
  }

  function resumeTimer(){
    const lang=state.language;
    state.timer=setInterval(()=>{
      state.timeRemaining--;
      if(state.timeRemaining<=3 && state.timeRemaining>0){
        playTone(1200,0.07,0.10);
        const wordsFi=['yksi','kaksi','kolme'];
        const wordsEn=['one','two','three'];
        const w=(lang==='fi'?wordsFi:wordsEn)[state.timeRemaining-1];
        speak(w, lang==='fi'?'fi-FI':'en-US',0.8);
      }
      else if(state.timeRemaining<=0){
        stopTimer();
        speak(lang==='fi'?'Aika loppui':'Time\'s up', lang==='fi'?'fi-FI':'en-US');
        nextQuestion();
      }
    },1000);
  }

  function startTimer(){
    stopTimer();
    const mapping={easy:25,normal:15,hard:8};
    state.timeRemaining=mapping[state.difficulty]||15;
    resumeTimer();
  }

  function speakQuestion(q){
    timerWasRunning=!!state.timer;
    if(timerWasRunning) stopTimer();
    speak((state.language==='fi'?'Kysymys: ':'Question: ')+q.questionText,
      state.language==='fi'?'fi-FI':'en-US',0.95,
      ()=>{
        if(timerWasRunning){ setTimeout(()=>resumeTimer(),80); }
      }
    );
  }

  function renderQuestion(){
    const q=state.currentQuestions[state.currentIndex];
    if(!q) return;
    questionNumberEl.textContent=`Kysymys ${state.currentIndex+1}/${state.currentQuestions.length}`;
    questionTextEl.textContent=q.questionText;
    optionsEl.innerHTML='';
    state.selectedOption=null;

    q.options.forEach((opt,idx)=>{
      const btn=document.createElement('button');
      btn.className='optionBtn';
      btn.textContent=`${idx+1}. ${opt}`;
      btn.onclick=()=>selectOption(idx);
      optionsEl.appendChild(btn);
    });

    speakQuestion(q);
  }

  function selectOption(idx){
    if(isSpeaking) return;
    state.selectedOption=idx;
    [...optionsEl.children].forEach((b,i)=>{
      b.style.background=(i===idx?'#0b84ff':'');
      b.style.color=(i===idx?'#fff':'');
    });
    toneSelect();
    const q=state.currentQuestions[state.currentIndex];
    speak((state.language==='fi'?'Vaihtoehto ':'Option ')+(idx+1)+'. '+q.options[idx],
      state.language==='fi'?'fi-FI':'en-US');
  }

  function confirmAnswer(){
    const q=state.currentQuestions[state.currentIndex];
    if(state.selectedOption===null) return;

    showStatus(state.language==='fi'?'Vastaus lukittu':'Answer locked');
    toneLock();

    setTimeout(()=>{
      if(state.selectedOption===q.correctIndex){
        toneCorrect();
        speak(state.language==='fi'?'Oikein!':'Correct!',state.language==='fi'?'fi-FI':'en-US');
        state.score++;
      }else{
        toneWrong();
        speak(state.language==='fi'?'Väärin. Oikea vastaus oli':'Wrong. Correct answer was',
              state.language==='fi'?'fi-FI':'en-US',
              ()=> speak(q.options[q.correctIndex],state.language==='fi'?'fi-FI':'en-US'));
      }
      stopTimer();
      setTimeout(()=>nextQuestion(),1200);
    },150);
  }

  function nextQuestion(){
    state.currentIndex++;
    if(state.currentIndex>=state.currentQuestions.length){
      speak(state.language==='fi'?'Peli päättyi':'Game over',
            state.language==='fi'?'fi-FI':'en-US');
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
    state.language=$('#languageSelect').value;
    state.difficulty=$('#difficultySelect').value;
    state.selectedThemeId=themeSelect.value;
    const theme=getThemeById(state.selectedThemeId);
    if(!theme || !theme.questions.length) return;
    state.currentQuestions=shuffle(theme.questions.slice());
    state.currentIndex=0;
    state.score=0;
    renderQuestion();
    startTimer();
  }

  // Keyboard
  window.addEventListener('keydown',e=>{
    if(e.repeat) return;
    if(isSpeaking) return;

    const now=Date.now();
    if(now-lastNavTime<200) return;
    lastNavTime=now;

    if(e.key==='ArrowDown'){
      const q=state.currentQuestions[state.currentIndex];
      if(!q) return;
      const next=(state.selectedOption===null?0:Math.min(q.options.length-1,state.selectedOption+1));
      selectOption(next);
    }
    else if(e.key==='ArrowUp'){
      const q=state.currentQuestions[state.currentIndex];
      if(!q) return;
      const prev=(state.selectedOption===null?0:Math.max(0,state.selectedOption-1));
      selectOption(prev);
    }
    else if(e.key==='Enter'){
      confirmAnswer();
    }
    else if(e.key==='s' || e.key==='S'){
      startGame();
    }
  });

  // Theme load
  fetch('quiz_pack_300.json')
    .then(r=>r.json())
    .then(data=>{
      const grouped={};
      data.questions.forEach(q=>{
        if(!grouped[q.theme]) grouped[q.theme]=[];
        grouped[q.theme].push(q);
      });
      state.themes=Object.keys(grouped).map(name=>({
        id:name,
        name:name,
        questions:grouped[name]
      }));
      renderThemeOptions();
    })
    .catch(()=>{
      state.themes=[{
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

  $('#startBtn').onclick=startGame;
  $('#confirmBtn').onclick=confirmAnswer;

})();
