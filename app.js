/* app.js — Moniteema + 10-kysymyksen sessio + loppuanimaatio + sanallinen tuomio
   Säilyttää:
   - kysymys luetaan ensin
   - ajastin pysähtyy TTS:ää varten
   - vaihtoehdot luetaan siirtyessä
   - "Vastaus lukittu" aria-live
   - lukitus- ja tulosäänet
*/

(() => {
  const $ = sel => document.querySelector(sel);

  // --- perusmuuttujat ---
  let isSpeaking = false;
  let lastNavTime = 0;
  let timerWasRunning = false;

  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  // --- äänifunktiot ---
  function playTone(freq, dur=0.12, vol=0.12){
    try{
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type='sine';
      o.frequency.value=freq;
      g.gain.value=vol;
      o.connect(g); g.connect(audioCtx.destination);
      g.gain.setValueAtTime(0, audioCtx.currentTime);
      g.gain.linearRampToValueAtTime(vol, audioCtx.currentTime + 0.01);
      o.start();
      setTimeout(()=>{ try{ g.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.01); o.stop(); o.disconnect(); g.disconnect(); }catch(e){} }, Math.max(1, dur*1000));
    }catch(e){}
  }
  const toneSelect = () => playTone(680,0.08,0.10);
  const toneLock   = () => playTone(520,0.12,0.14);
  const toneCorrect= () => { playTone(880,0.14,0.18); setTimeout(()=>playTone(1100,0.12,0.16),140); };
  const toneWrong  = () => playTone(220,0.40,0.20);

  // --- speech helper ---
  const speak = (text, lang='fi-FI', rate=1.0, onend=null)=>{
    if(!window.speechSynthesis){ if(onend) onend(); return; }
    try {
      const u=new SpeechSynthesisUtterance(text);
      u.lang=lang;
      u.rate=rate;
      u.onstart=()=>{ isSpeaking=true; };
      u.onend=()=>{ isSpeaking=false; if(onend) onend(); };
      u.onerror=()=>{ isSpeaking=false; if(onend) onend(); };
      window.speechSynthesis.speak(u);
    } catch(e) { if(onend) onend(); isSpeaking=false; }
  };

  // --- sovellustila ---
  let state={
    themes:[],            // {id, name, questions: [{questionText, options[], correctIndex}]}
    currentQuestions:[],  // valitut 10 kysymystä sessionille
    currentIndex:0,
    selectedOption:null,
    language:'fi',
    difficulty:'normal',
    score:0,
    timer:null,
    timeRemaining:0,
    sessionLength:10 // määrä kysymyksiä per sessio
  };

  // --- DOM refs ---
  const themeSelect = $('#themeSelect');
  const languageSelect = $('#languageSelect');
  const difficultySelect = $('#difficultySelect');
  const questionTextEl = $('#questionText');
  const optionsEl = $('#options');
  const questionNumberEl = $('#questionNumber');
  const statusEl = $('#status'); // aria-live
  const scoreArea = $('#scoreArea');
  const questionCard = document.querySelector('.question-card');

  // Jos themeSelect on yksivalinta HTML:ssä, tee se monivalinnaksi ohjelmallisesti
  if (themeSelect) themeSelect.multiple = true;

  // --- status helpers ---
  function showStatusPersistent(text){
    statusEl.textContent = text;
  }
  function clearStatusIfMatches(text){
    if(statusEl.textContent === text) statusEl.textContent = '';
  }

  // --- timer ---
  function stopTimer(){ if(state.timer){ clearInterval(state.timer); state.timer=null; } }
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
        stopTimer();
        handleTimeout();
      }
    },1000);
  }
  function startTimer(){
    stopTimer();
    const mapping = { easy: 25, normal: 15, hard: 8 };
    state.timeRemaining = mapping[state.difficulty] || 15;
    resumeTimer();
  }

  // --- timeout käsittely (tylsä automaattinen hyppiminen korjattu) ---
  function handleTimeout(){
    const q = state.currentQuestions[state.currentIndex];
    if(!q) return;
    // jos valittu -> autolukitse ja näytä tulos
    if(state.selectedOption !== null){
      showStatusPersistent(state.language==='fi' ? 'Aika loppui — vastaus lukittu' : 'Time up — answer locked');
      toneLock();
      setTimeout(()=>{
        if(state.selectedOption === q.correctIndex){
          toneCorrect();
          flashCorrect();
          speak(state.language==='fi' ? 'Aika loppui — oikein' : 'Time up — correct', state.language==='fi'?'fi-FI':'en-US');
          state.score++;
        } else {
          toneWrong();
          flashWrong();
          speak(state.language==='fi' ? 'Aika loppui — väärin. Oikea vastaus:' : 'Time up — wrong. Correct answer is', state.language==='fi'?'fi-FI':'en-US', ()=>{
            speak(q.options[q.correctIndex], state.language==='fi'?'fi-FI':'en-US');
          });
        }
        // odota, klar status ja siirry eteenpäin
        setTimeout(()=>{
          clearStatusIfMatches(state.language==='fi' ? 'Aika loppui — vastaus lukittu' : 'Time up — answer locked');
          proceedAfterAnswer();
        }, 1500);
      }, 160);
    } else {
      // ei valintaa
      showStatusPersistent(state.language==='fi' ? 'Aika loppui' : 'Time up');
      toneWrong();
      flashWrong();
      speak(state.language==='fi' ? 'Aika loppui' : 'Time\'s up', state.language==='fi'?'fi-FI':'en-US', 1.0, ()=>{
        speak(state.language==='fi' ? 'Oikea vastaus on' : 'The correct answer is', state.language==='fi'?'fi-FI':'en-US', 1.0, ()=>{
          speak(q.options[q.correctIndex], state.language==='fi'?'fi-FI':'en-US');
        });
      });
      setTimeout(()=>{
        clearStatusIfMatches(state.language==='fi' ? 'Aika loppui' : 'Time up');
        proceedAfterAnswer();
      }, 1700);
    }
  }

  // --- puheen ja ajastuksen hallinta kysymyksen aikana ---
  function speakQuestion(q){
    timerWasRunning = !!state.timer;
    if(timerWasRunning) stopTimer();
    speak((state.language==='fi' ? 'Kysymys: ' : 'Question: ') + q.questionText,
      state.language==='fi' ? 'fi-FI' : 'en-US', 0.95,
      ()=>{ if(timerWasRunning){ setTimeout(()=> resumeTimer(), 90); } });
  }

  // --- renderointi ---
  function renderThemeOptions(){
    if(!themeSelect) return;
    // tyhjennä ja täytä
    themeSelect.innerHTML = '';
    state.themes.forEach(t=>{
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.name;
      themeSelect.appendChild(opt);
    });
    // tee pienempi korkeus jos paljon valintoja
    themeSelect.size = Math.min(8, Math.max(3, state.themes.length));
  }

  function renderQuestion(){
    const q = state.currentQuestions[state.currentIndex];
    if(!q){
      questionTextEl.textContent = '';
      optionsEl.innerHTML = '';
      questionNumberEl.textContent = '';
      return;
    }
    questionNumberEl.textContent = `Kysymys ${state.currentIndex+1}/${state.sessionLength}`;
    questionTextEl.textContent = q.questionText;
    optionsEl.innerHTML = '';
    state.selectedOption = null;
    statusEl.textContent = '';

    q.options.forEach((opt, idx)=>{
      const btn = document.createElement('button');
      btn.className = 'optionBtn';
      btn.type = 'button';
      btn.dataset.index = idx;
      btn.textContent = `${idx+1}. ${opt}`;
      btn.onclick = () => { if(isSpeaking) return; selectOption(idx); };
      btn.onkeydown = (e) => { if(e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectOption(idx); } };
      optionsEl.appendChild(btn);
    });

    // lue kysymys (ja pysäytä timer TTS:ää varten)
    speakQuestion(q);
    updateScore();
  }

  // --- valinta / vahvistus ---
  function selectOption(idx){
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
    showStatusPersistent(state.language==='fi' ? 'Vastaus lukittu' : 'Answer locked');
    toneLock();
    setTimeout(()=>{
      if(state.selectedOption === q.correctIndex){
        toneCorrect();
        flashCorrect();
        speak(state.language==='fi' ? 'Oikein!' : 'Correct!', state.language==='fi' ? 'fi-FI' : 'en-US');
        state.score++;
      } else {
        toneWrong();
        flashWrong();
        speak(state.language==='fi' ? 'Väärin. Oikea vastaus oli' : 'Wrong. Correct answer was', state.language==='fi' ? 'fi-FI' : 'en-US', ()=>{
          speak(q.options[q.correctIndex], state.language==='fi' ? 'fi-FI' : 'en-US');
        });
      }
      stopTimer();
      // jatka prosessointia vasta 1.4s jälkeen niin äänet ehtii loppua
      setTimeout(()=> proceedAfterAnswer(), 1400);
    }, 160);
  }

  // --- siirtyminen vastauksen jälkeen ---
  function proceedAfterAnswer(){
    // jos sessio valmis -> näytä loppuraportti
    if(state.currentIndex + 1 >= state.sessionLength){
      endSession();
    } else {
      // siirry seuraavaan
      state.currentIndex++;
      state.selectedOption = null;
      renderQuestion();
      startTimer();
    }
  }

  // --- loppuanimaatio: lisää/poista luokat questionCard:iin ---
  function flashCorrect(){
    if(!questionCard) return;
    questionCard.classList.add('flash-correct');
    setTimeout(()=> questionCard.classList.remove('flash-correct'), 700);
  }
  function flashWrong(){
    if(!questionCard) return;
    questionCard.classList.add('flash-wrong');
    setTimeout(()=> questionCard.classList.remove('flash-wrong'), 900);
  }

  // --- sessio päättyy: arvio ja automaattinen uudelleenkäynnistys ---
  function getJudgement(score){
    // palauta suomi ja englanti
    if(score <= 2) return {fi:`Huono suoritus: ${score}/${state.sessionLength}. Yritä uudelleen — harjoitus tekee mestarin.`, en:`Poor: ${score}/${state.sessionLength}. Try again — practice helps.`};
    if(score <= 5) return {fi:`Kohtalainen: ${score}/${state.sessionLength}. Hyvä alku, mutta vielä voi parantaa.`, en:`Fair: ${score}/${state.sessionLength}. Good start, you can improve.`};
    if(score <= 7) return {fi:`Hyvä: ${score}/${state.sessionLength}. Hyvin tehty!`, en:`Good: ${score}/${state.sessionLength}. Well done!`};
    if(score <= 9) return {fi:`Erinomainen: ${score}/${state.sessionLength}. Hienoa työtä!`, en:`Excellent: ${score}/${state.sessionLength}. Great job!`};
    return {fi:`Täydellinen: ${score}/${state.sessionLength}. Loistavaa!`, en:`Perfect: ${score}/${state.sessionLength}. Amazing!`};
  }

  function endSession(){
    // pysäytä kaikki
    stopTimer();
    // nykyloppuanimaatio: flash oikeastaan/väärin riippuen tuloksesta
    const result = state.score;
    const judgement = getJudgement(result);
    // visuaalinen palaute
    if(result >= Math.ceil(state.sessionLength * 0.7)) {
      flashCorrect();
      toneCorrect();
    } else {
      flashWrong();
      toneWrong();
    }

    // näytä pistemäärä ja tuomio
    const summaryFi = `Sait ${result}/${state.sessionLength} oikein.`;
    const summaryEn = `You got ${result}/${state.sessionLength} correct.`;
    showStatusPersistent(state.language==='fi' ? summaryFi : summaryEn);

    // puhe (ensiksi pistemäärä, sitten sanallinen tuomio)
    speak(state.language==='fi' ? summaryFi : summaryEn, state.language==='fi' ? 'fi-FI' : 'en-US', 0.95, ()=>{
      // pieni tauko ja tuomio
      setTimeout(()=>{
        const jText = state.language==='fi' ? judgement.fi : judgement.en;
        speak(jText, state.language==='fi' ? 'fi-FI' : 'en-US');
      }, 400);
    });

    // automaattinen uusi sessio muutaman sekunnin kuluttua
    setTimeout(()=>{
      // nollaa ja käynnistä uusi sessio automaattisesti samojen teemavalintojen mukaan
      state.score = 0;
      prepareSessionFromSelectedThemes();
      renderQuestion();
      startTimer();
    }, 6500); // ~6.5s viive jotta käyttäjä kuulee tuomion
  }

  // --- valitse ja valmistele 10 satunnaista kysymystä useasta teemasta ---
  function prepareSessionFromSelectedThemes(){
    // kerää valituista teemoista kysymykset
    const selectedThemeIds = Array.from(themeSelect.selectedOptions).map(o=>o.value);
    let pool = [];
    if(selectedThemeIds.length === 0){
      // jos ei valintaa, ota kaikki
      state.themes.forEach(t => pool = pool.concat(t.questions || []));
    } else {
      state.themes.forEach(t => {
        if(selectedThemeIds.includes(t.id)){
          pool = pool.concat(t.questions || []);
        }
      });
    }
    if(pool.length === 0){
      // jos ei poolia, fallback single theme questions
      pool = state.themes.length ? state.themes[0].questions.slice() : [];
    }
    // satunnaista ja ota enintään sessionLength
    pool = shuffle(pool);
    // jos poolissa vähemmän kuin sessionLength, käytä kaikki (voi kiertää, mutta pidetään yksinkertaisena)
    const count = Math.min(state.sessionLength, pool.length);
    state.currentQuestions = pool.slice(0, count).map(q => ({
      questionText: q.questionText || q.question || '',
      options: q.options || q.opts || [],
      correctIndex: typeof q.correctIndex === 'number' ? q.correctIndex : (q.answerIndex || 0)
    }));
    // jos valittiin vähemmän kuin sessionLength, sessionLength päivittyy
    state.sessionLength = count;
    state.currentIndex = 0;
    state.selectedOption = null;
    state.score = 0;
  }

  // --- apufunktiot ---
  function shuffle(a){
    for(let i=a.length-1;i>0;i--){
      const j=Math.floor(Math.random()*(i+1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function updateScore(){ scoreArea.textContent = state.score; }

  // --- käynnistysfunktio (painike) ---
  function startGame(){
    try{ if(audioCtx && audioCtx.state === 'suspended') audioCtx.resume(); } catch(e){}
    state.language = (languageSelect && languageSelect.value) ? languageSelect.value : state.language;
    state.difficulty = (difficultySelect && difficultySelect.value) ? difficultySelect.value : state.difficulty;
    // valmistele sessio valituista teemoista
    prepareSessionFromSelectedThemes();
    renderQuestion();
    startTimer();
  }

  // --- näppäimistö (debounce, blokkaa kun isSpeaking) ---
  window.addEventListener('keydown', (e)=>{
    const activeTag = document.activeElement && document.activeElement.tagName;
    if(activeTag === 'INPUT' || activeTag === 'TEXTAREA') return;
    if(e.repeat){ e.preventDefault(); return; }
    if(isSpeaking){ e.preventDefault(); return; }
    const now = Date.now();
    if(now - lastNavTime < 200){ e.preventDefault(); return; }
    lastNavTime = now;

    if(e.key === 'ArrowDown'){ e.preventDefault(); const q = state.currentQuestions[state.currentIndex]; if(!q) return; const next = (state.selectedOption === null) ? 0 : Math.min(q.options.length - 1, state.selectedOption + 1); selectOption(next); }
    else if(e.key === 'ArrowUp'){ e.preventDefault(); const q = state.currentQuestions[state.currentIndex]; if(!q) return; const prev = (state.selectedOption === null) ? 0 : Math.max(0, state.selectedOption - 1); selectOption(prev); }
    else if(e.key === 'Enter'){ e.preventDefault(); confirmAnswer(); }
    else if(e.key === 's' || e.key === 'S'){ startGame(); }
  });

  // --- lataa teemat tiedostosta (quiz_pack_300.json) ---
  fetch('quiz_pack_300.json')
    .then(r=>{ if(!r.ok) throw new Error('no pack'); return r.json(); })
    .then(data=>{
      // odotetaan että tiedosto on list of questions with theme field
      const grouped = {};
      (data.questions || []).forEach(q=>{
        const tName = q.theme || 'Imported';
        if(!grouped[tName]) grouped[tName] = [];
        grouped[tName].push({
          questionText: q.questionText || q.question || '',
          options: q.options || q.opts || [],
          correctIndex: typeof q.correctIndex === 'number' ? q.correctIndex : (q.answerIndex || 0)
        });
      });
      state.themes = Object.keys(grouped).map(name => ({ id:name, name:name, questions: grouped[name] }));
      renderThemeOptions();
    })
    .catch(()=>{
      // fallback
      state.themes = [{
        id:'muumit', name:'Muumit', questions:[{
          questionText:'Kuka on Muumipapan puoliso?',
          options:['Muumimamma','Niiskuneiti','Pikku Myy'],
          correctIndex:0
        }]
      }];
      renderThemeOptions();
    });

  // --- UI-kytkennät (varmista että id:t ovat index.html:ssa) ---
  const startBtn = $('#startBtn'); if(startBtn) startBtn.onclick = startGame;
  const confirmBtn = $('#confirmBtn'); if(confirmBtn) confirmBtn.onclick = confirmAnswer;
  const nextBtn = $('#nextOpt'); if(nextBtn) nextBtn.onclick = ()=> { const q = state.currentQuestions[state.currentIndex]; if(!q || isSpeaking) return; const next = (state.selectedOption === null) ? 0 : Math.min(q.options.length - 1, state.selectedOption + 1); selectOption(next); };
  const prevBtn = $('#prevOpt'); if(prevBtn) prevBtn.onclick = ()=> { const q = state.currentQuestions[state.currentIndex]; if(!q || isSpeaking) return; const prev = (state.selectedOption === null) ? 0 : Math.max(0, state.selectedOption - 1); selectOption(prev); };

  // expose state for debugging in console (optional)
  window.__quizState = state;

})();
