/* app.js — Lisätty "Vastaus lukittu" aria-live ilmoitus
   Poistettu sustain, mukana lukitus- ja tulosäänet, isSpeaking, debounce, e.repeat
*/
(() => {
  const $ = sel => document.querySelector(sel);

  // speaking state & debounce
  let isSpeaking = false;
  let lastNavTime = 0;

  // speech helper (sets isSpeaking)
  const speak = (text, lang='fi-FI', rate=1.0, onend=null) => {
    try {
      if (!window.speechSynthesis) {
        if (onend) onend();
        return;
      }
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang;
      u.rate = rate;
      u.onstart = () => { isSpeaking = true; };
      u.onend = () => { isSpeaking = false; if (onend) onend(); };
      u.onerror = () => { isSpeaking = false; if (onend) onend(); };
      window.speechSynthesis.speak(u);
    } catch (e) {
      isSpeaking = false;
      if (onend) onend();
    }
  };

  // WebAudio tone generator (short tones only)
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  function playShortTone(freq, dur=0.12, vol=0.12) {
    try {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = 'sine'; o.frequency.value = freq;
      g.gain.value = vol;
      o.connect(g); g.connect(audioCtx.destination);
      // quick ramp to avoid click
      g.gain.setValueAtTime(0, audioCtx.currentTime);
      g.gain.linearRampToValueAtTime(vol, audioCtx.currentTime + 0.01);
      o.start();
      setTimeout(()=>{ try { g.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.01); o.stop(); o.disconnect(); g.disconnect(); } catch(e){} }, Math.max(1, dur*1000));
    } catch(e){}
  }

  // specific feedback tones
  const toneSelect = () => playShortTone(660, 0.08, 0.08);        // when moving to/selecting option (soft)
  const toneLock = () => playShortTone(520, 0.10, 0.10);         // when answer is locked
  const toneCorrect = () => {                                     // success melody (two quick notes)
    playShortTone(880, 0.10, 0.14);
    setTimeout(()=> playShortTone(1100, 0.10, 0.12), 120);
  };
  const toneWrong = () => playShortTone(220, 0.28, 0.16);         // wrong (low)

  // App state
  let state = {
    themes: [],
    selectedThemeId: null,
    language: 'fi',
    difficulty: 'normal',
    currentQuestions: [],
    currentIndex: 0,
    selectedOption: null,
    score: 0,
    timer: null,
    timeRemaining: 0
  };

  // DOM refs
  const themeSelect = $('#themeSelect');
  const startBtn = $('#startBtn');
  const editorBtn = $('#editorBtn');
  const importBtn = $('#importBtn');
  const exportBtn = $('#exportBtn');
  const helpBtn = $('#helpBtn');
  const languageSelect = $('#languageSelect');
  const difficultySelect = $('#difficultySelect');

  const questionTextEl = $('#questionText');
  const optionsEl = $('#options');
  const questionNumberEl = $('#questionNumber');
  const statusEl = $('#status'); // aria-live element (polite) in index.html
  const scoreArea = $('#scoreArea');
  const editor = $('#editor');
  const editorThemeName = $('#editorThemeName');
  const editorTextarea = $('#editorTextarea');
  const fileInput = $('#fileInput');

  // small helper to show transient status (aria-live)
  function showTransientStatus(text, timeoutMs = 1500) {
    try {
      statusEl.textContent = text;
      // clear after timeout (but keep if nextQuestion overwrites)
      setTimeout(()=> {
        // only clear if text still same (avoid clearing newer messages)
        if (statusEl.textContent === text) statusEl.textContent = '';
      }, timeoutMs);
    } catch(e){}
  }

  // Render theme select
  function renderThemeOptions(){
    themeSelect.innerHTML = '';
    state.themes.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.name;
      themeSelect.appendChild(opt);
    });
    if (!state.selectedThemeId && state.themes.length) state.selectedThemeId = state.themes[0].id;
    themeSelect.value = state.selectedThemeId || (state.themes[0] && state.themes[0].id) || '';
  }

  function getThemeById(id){ return state.themes.find(t => t.id === id); }

  // SPEAK QUESTION ONLY (no options auto-reading)
  function speakQuestion(q, onComplete){
    const langTag = languageSelect.value === 'fi' ? 'fi-FI' : 'en-US';
    speak((languageSelect.value === 'fi' ? 'Kysymys: ' : 'Question: ') + q.questionText, langTag, 0.95, onComplete);
  }

  // Render question UI
  function renderQuestion(){
    const q = state.currentQuestions[state.currentIndex];
    if (!q) {
      questionTextEl.textContent = '';
      optionsEl.innerHTML = '';
      questionNumberEl.textContent = '';
      return;
    }
    questionNumberEl.textContent = `Kysymys ${state.currentIndex+1}/${state.currentQuestions.length}`;
    questionTextEl.textContent = q.questionText;
    optionsEl.innerHTML = '';
    q.options.forEach((opt, idx) => {
      const btn = document.createElement('button');
      btn.className = 'optionBtn';
      btn.setAttribute('role', 'listitem');
      btn.textContent = `${idx+1}. ${opt}`;
      btn.dataset.index = idx;
      btn.setAttribute('aria-selected', state.selectedOption === idx ? 'true' : 'false');
      // click -> select and read that option
      btn.onclick = () => {
        if (isSpeaking) return; // prevent selecting while question TTS runs
        selectOption(idx, true);
      };
      btn.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectOption(idx, true); } };
      optionsEl.appendChild(btn);
    });
    state.selectedOption = null; // no option selected initially
    updateOptionSelection();
    // First: read the question; only after question reading completes user may navigate
    speakQuestion(q, () => {
      // small feedback to indicate navigation enabled
      playShortTone(660, 0.07, 0.08);
    });
    updateScore();
  }

  // Select option logic (reads option and plays selection sound)
  function selectOption(idx, speakOpt=true){
    state.selectedOption = idx;
    updateOptionSelection();
    const q = state.currentQuestions[state.currentIndex];
    if (!q) return;
    const optText = q.options[idx];
    // selection sound
    toneSelect();
    if (speakOpt) {
      // read only the option label and content
      speak((languageSelect.value === 'fi' ? 'Vaihtoehto ' : 'Option ') + (idx+1) + '. ' + optText, languageSelect.value === 'fi' ? 'fi-FI' : 'en-US', 0.95);
    }
  }

  function updateOptionSelection(){
    const children = [...optionsEl.children];
    children.forEach(btn => {
      const idx = parseInt(btn.dataset.index);
      btn.setAttribute('aria-selected', state.selectedOption === idx ? 'true' : 'false');
      if (state.selectedOption === idx) {
        btn.classList.add('selected');
        btn.style.background = '#0b84ff';
        btn.style.color = '#fff';
        try { btn.focus(); } catch(e) {}
      } else {
        btn.classList.remove('selected');
        btn.style.background = '';
        btn.style.color = '';
      }
    });
  }

  function updateScore(){ scoreArea.textContent = `Pisteet: ${state.score}`; }

  // Game controls
  function startGame(){
    try { if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume(); } catch(e){}
    state.language = languageSelect.value;
    state.difficulty = difficultySelect.value;
    state.selectedThemeId = themeSelect.value;
    const theme = getThemeById(state.selectedThemeId);
    if (!theme || !theme.questions || theme.questions.length === 0) {
      speak(languageSelect.value === 'fi' ? 'Valittu teema ei sisällä kysymyksiä' : 'Selected theme has no questions', languageSelect.value === 'fi' ? 'fi-FI' : 'en-US');
      return;
    }
    state.currentQuestions = shuffleArray(theme.questions.slice());
    state.currentIndex = 0;
    state.selectedOption = null;
    state.score = 0;
    renderQuestion();
    startTimerForDifficulty();
    statusEl.textContent = languageSelect.value === 'fi' ? 'Peli käynnissä' : 'Game running';
  }

  function shuffleArray(a){ for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] } return a; }

  // Confirm answer: show transient "Vastaus lukittu", play lock tone, then result tone + TTS
  function confirmAnswer(){
    const q = state.currentQuestions[state.currentIndex];
    if (!q) return;
    if (state.selectedOption === null) {
      speak(languageSelect.value === 'fi' ? 'Et valinnut vaihtoehtoa' : 'No option selected', languageSelect.value === 'fi' ? 'fi-FI' : 'en-US');
      return;
    }

    // Show visual & aria-live message immediately
    showTransientStatus(languageSelect.value === 'fi' ? 'Vastaus lukittu' : 'Answer locked', 1500);

    // Lock sound
    toneLock();
    // small delay so lock sound is audible before result
    setTimeout(() => {
      if (state.selectedOption === q.correctIndex) {
        toneCorrect();
        speakLocalized('Oikein!', 'Correct!');
      } else {
        toneWrong();
        speakLocalized('Väärin. Oikea vastaus oli', 'Wrong. Correct answer was');
        // say the correct option after the wrong tone/TTS
        setTimeout(()=> speak(q.options[q.correctIndex], languageSelect.value === 'fi' ? 'fi-FI' : 'en-US'), 350);
      }
      // update score if correct
      if (state.selectedOption === q.correctIndex) state.score++;
      stopTimer();
      // move to next after a short pause
      setTimeout(()=> nextQuestion(), 900);
    }, 140);
  }

  function nextQuestion(){
    state.currentIndex++;
    state.selectedOption = null;
    if (state.currentIndex >= state.currentQuestions.length) {
      endGame();
    } else {
      renderQuestion();
      startTimerForDifficulty();
    }
  }

  function endGame(){
    stopTimer();
    statusEl.textContent = languageSelect.value === 'fi' ? 'Peli päättyi' : 'Game over';
    speakLocalized(`Peli päättyi. Pisteesi ${state.score}`, `Game over. Your score ${state.score}`);
    saveBestScore();
  }

  // Timer
  function startTimerForDifficulty(){
    stopTimer();
    const mapping = { easy: 25, normal: 15, hard: 8 };
    state.timeRemaining = mapping[state.difficulty] || 15;
    const lang = languageSelect.value;
    state.timer = setInterval(() => {
      state.timeRemaining--;
      if (state.timeRemaining <= 3 && state.timeRemaining > 0) {
        playShortTone(1200,0.07,0.10);
        const n = state.timeRemaining;
        if (lang === 'fi') { const words = ['yksi','kaksi','kolme']; speak(words[n-1] || String(n), 'fi-FI', 0.8); }
        else { const words = ['one','two','three']; speak(words[n-1] || String(n), 'en-US', 0.8); }
      } else if (state.timeRemaining <= 0) {
        stopTimer();
        speakLocalized('Aika loppui', 'Time\'s up');
        const q = state.currentQuestions[state.currentIndex];
        if (q) speak(q.options[q.correctIndex], languageSelect.value === 'fi' ? 'fi-FI' : 'en-US');
        nextQuestion();
      }
    }, 1000);
  }

  function stopTimer(){ if (state.timer) { clearInterval(state.timer); state.timer = null; } }

  function saveBestScore(){
    const key = `best_${state.selectedThemeId || 'default'}`;
    const prev = parseInt(localStorage.getItem(key) || '0', 10);
    if (state.score > prev) {
      localStorage.setItem(key, String(state.score));
      speakLocalized('Uusi ennätys ' + state.score, 'New record ' + state.score);
    }
  }

  // Editor / import / export
  function openEditor(){
    editor.hidden = false;
    const theme = getThemeById(themeSelect.value) || { name: '' };
    editorThemeName.value = theme.name || '';
    editorTextarea.value = '';
    $('#editorMessage').textContent = '';
  }

  function closeEditor(){ editor.hidden = true; $('#editorMessage').textContent = ''; }

  function editorAddQuestions(){
    const lines = editorTextarea.value.split('\n').map(l => l.trim()).filter(Boolean);
    if (!lines.length) { $('#editorMessage').textContent = (languageSelect.value === 'fi' ? 'Ei rivejä' : 'No lines'); return; }
    let theme = getThemeById(themeSelect.value);
    if (!theme) {
      const id = 'theme_' + Date.now();
      theme = { id, name: editorThemeName.value || 'Uusi teema', questions: [] };
      state.themes.push(theme);
    }
    lines.forEach(line => {
      const parts = line.split('|');
      if (parts.length >= 3) {
        const qText = parts[0].trim();
        const opts = parts[1].split(';').map(s => s.trim()).filter(Boolean);
        const idx = parseInt(parts[2], 10) || 0;
        theme.questions.push({ questionText: qText, options: opts, correctIndex: idx, difficulty: 'normal', source: '' });
      }
    });
    localStorage.setItem('quiz_themes', JSON.stringify(state.themes));
    renderThemeOptions();
    $('#editorMessage').textContent = (languageSelect.value === 'fi' ? 'Kysymykset lisätty' : 'Questions added');
  }

  function exportJSON(){
    const data = JSON.stringify({ questions: state.themes.flatMap(t => (t.questions || []).map(q => ({ ...q, theme: t.name }))) }, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'quiz_export.json'; a.click();
    URL.revokeObjectURL(url);
  }

  function importFile(file){
    const reader = new FileReader();
    reader.onload = e => {
      const text = e.target.result;
      try {
        const parsed = JSON.parse(text);
        if (parsed.questions && Array.isArray(parsed.questions)) {
          parsed.questions.forEach(q => {
            const themeName = q.theme || 'Imported';
            let theme = state.themes.find(t => t.name === themeName);
            if (!theme) { theme = { id: 't_' + Date.now() + Math.random(), name: themeName, questions: [] }; state.themes.push(theme); }
            theme.questions.push({ questionText: q.questionText || q.question || '', options: q.options || [], correctIndex: q.correctIndex || 0, difficulty: q.difficulty || 'normal', source: q.source || '' });
          });
          localStorage.setItem('quiz_themes', JSON.stringify(state.themes));
          renderThemeOptions();
          speak(languageSelect.value === 'fi' ? 'Tuo onnistui' : 'Import successful', languageSelect.value === 'fi' ? 'fi-FI' : 'en-US');
          return;
        }
      } catch (err) {}
      const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      lines.forEach(line => {
        const parts = line.split('|').map(p => p.trim());
        if (parts.length >= 3) {
          const targetTheme = getThemeById(themeSelect.value) || state.themes[0];
          const qText = parts[0];
          const opts = parts[1].split(';').map(s => s.trim());
          const idx = parseInt(parts[2], 10) || 0;
          targetTheme.questions.push({ questionText: qText, options: opts, correctIndex: idx, difficulty: 'normal', source: '' });
        }
      });
      localStorage.setItem('quiz_themes', JSON.stringify(state.themes));
      renderThemeOptions();
      speak(languageSelect.value === 'fi' ? 'Tuo CSV onnistui' : 'CSV import successful', languageSelect.value === 'fi' ? 'fi-FI' : 'en-US');
    };
    reader.readAsText(file, 'utf-8');
  }

  function speakLocalized(fi, en){ speak(state.language === 'fi' ? fi : en, state.language === 'fi' ? 'fi-FI' : 'en-US', 1.0); }

  // UI events
  startBtn.onclick = () => startGame();
  editorBtn.onclick = () => openEditor();
  $('#editorCloseBtn').onclick = () => closeEditor();
  $('#editorAddBtn').onclick = () => editorAddQuestions();
  $('#editorSaveBtn').onclick = () => { localStorage.setItem('quiz_themes', JSON.stringify(state.themes)); $('#editorMessage').textContent = 'Teemat tallennettu'; };
  $('#confirmBtn').onclick = () => confirmAnswer();
  $('#nextOpt').onclick = () => {
    const q = state.currentQuestions[state.currentIndex];
    if (!q) return;
    if (isSpeaking) return;
    const nextIdx = (state.selectedOption === null) ? 0 : Math.min(q.options.length - 1, state.selectedOption + 1);
    selectOption(nextIdx, true);
  };
  $('#prevOpt').onclick = () => {
    const q = state.currentQuestions[state.currentIndex];
    if (!q) return;
    if (isSpeaking) return;
    const prevIdx = (state.selectedOption === null) ? 0 : Math.max(0, state.selectedOption - 1);
    selectOption(prevIdx, true);
  };

  importBtn.onclick = () => fileInput.click();
  fileInput.onchange = (ev) => {
    const f = ev.target.files[0]; if (!f) return;
    importFile(f);
    fileInput.value = '';
  };
  exportBtn.onclick = () => exportJSON();
  helpBtn.onclick = () => {
    const lang = languageSelect.value;
    const helpText = lang === 'fi'
      ? 'Ohje: Valitse teema, paina Aloita. Vaihtoehdot luetaan nuolilla siirtyessä. Paina Enter lukitaksesi vastauksen.'
      : 'Help: choose theme, press Start. Options are read when you move to them with arrows. Press Enter to lock the answer.';
    speak(helpText, lang === 'fi' ? 'fi-FI' : 'en-US', 0.95);
    statusEl.textContent = helpText;
  };

  languageSelect.onchange = () => { state.language = languageSelect.value; speakLocalized('Kieli vaihdettu', 'Language changed'); };
  difficultySelect.onchange = () => { state.difficulty = difficultySelect.value; };
  themeSelect.onchange = () => { state.selectedThemeId = themeSelect.value; };

  // Keyboard handling (debounced + block while speaking + ignore repeats)
  window.addEventListener('keydown', (e) => {
    const activeTag = document.activeElement && document.activeElement.tagName;
    if (activeTag === 'INPUT' || activeTag === 'TEXTAREA') return;

    // block repeated keydown events from holding key
    if (e.repeat) { e.preventDefault(); return; }

    // block navigation while question TTS is speaking
    if (isSpeaking) {
      e.preventDefault();
      return;
    }

    // debounce
    const now = Date.now();
    if (now - lastNavTime < 200) { e.preventDefault(); return; }
    lastNavTime = now;

    if (e.key === 's' || e.key === 'S') { startGame(); }
    else if (e.key === 'e' || e.key === 'E') { openEditor(); }
    else if (e.key === 'i' || e.key === 'I') { fileInput.click(); }
    else if (e.key === 'ArrowDown') {
      e.preventDefault();
      $('#nextOpt').click();
    }
    else if (e.key === 'ArrowUp') {
      e.preventDefault();
      $('#prevOpt').click();
    }
    else if (e.key === 'Enter') {
      // confirm only if an option is selected
      if (state.selectedOption !== null) { $('#confirmBtn').click(); }
    }
  });

  // Initialization: load quiz_pack_300.json if present, otherwise localStorage or defaults
  fetch('quiz_pack_300.json').then(r => {
    if (!r.ok) throw new Error('no pack');
    return r.json();
  }).then(data => {
    if (data.questions && Array.isArray(data.questions)) {
      data.questions.forEach(q => {
        const themeName = q.theme || 'Imported';
        let theme = state.themes.find(t => t.name === themeName);
        if (!theme) {
          theme = { id: 't_' + Math.random().toString(36).slice(2,9), name: themeName, questions: [] };
          state.themes.push(theme);
        }
        theme.questions.push({ questionText: q.questionText || q.question || '', options: q.options || [], correctIndex: q.correctIndex || 0, difficulty: q.difficulty || 'normal', source: q.source || '' });
      });
      localStorage.setItem('quiz_themes', JSON.stringify(state.themes));
      renderThemeOptions();
    }
  }).catch(() => {
    const stored = localStorage.getItem('quiz_themes');
    if (stored) {
      try { state.themes = JSON.parse(stored); } catch(e) { state.themes = []; }
    }
  }).finally(() => {
    if (!state.themes || state.themes.length === 0) {
      state.themes = [
        { id: 'muumit', name: 'Muumit', questions: [ { questionText: 'Kuka on Muumipapan puoliso?', options: ['Muumimamma', 'Niiskuneiti', 'Pikku Myy'], correctIndex: 0, difficulty: 'easy', source: '' } ] }
      ];
    }
    renderThemeOptions();
    renderQuestion();
  });

})();
