/* app.js — korjattu ja käyttövalmis
  - Poistaa rekursiiviset audio-wrapperit
  - Estää näppäinkomennot kun TTS on käynnissä (isSpeaking)
  - Estää toistuvat keydown-tapahtumat (e.repeat)
  - Debounce navigaatioon (200 ms)
  - Automaattinen lataus quiz_pack_300.json jos saatavilla
*/
(() => {
  const $ = sel => document.querySelector(sel);

  // speaking state & debounce
  let isSpeaking = false;
  let lastNavTime = 0;

  // Speech helper (sets isSpeaking onstart/onend)
  const speak = (text, lang='fi-FI', rate=1.0) => {
    try {
      if (!window.speechSynthesis) return;
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang;
      u.rate = rate;
      u.onstart = () => { isSpeaking = true; };
      u.onend = () => { isSpeaking = false; };
      u.onerror = () => { isSpeaking = false; };
      window.speechSynthesis.speak(u);
    } catch (e) {
      isSpeaking = false;
    }
  };

  // WebAudio safe tone generator
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  function playTone(freq, dur=0.18, type='sine', gain=0.2) {
    try {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = type;
      o.frequency.value = freq;
      g.gain.value = gain;
      o.connect(g); g.connect(audioCtx.destination);
      o.start();
      setTimeout(() => {
        try { o.stop(); o.disconnect(); g.disconnect(); } catch(e) {}
      }, Math.max(1, dur * 1000));
    } catch(e) {}
  }
  // named tones (call these directly)
  const playTickTone = () => playTone(1200, 0.07, 'sine', 0.12);
  const playCorrectTone = () => playTone(880, 0.15, 'sine', 0.25);
  const playWrongTone = () => playTone(220, 0.33, 'sine', 0.25);

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
  const statusEl = $('#status');
  const scoreArea = $('#scoreArea');
  const editor = $('#editor');
  const editorThemeName = $('#editorThemeName');
  const editorTextarea = $('#editorTextarea');
  const fileInput = $('#fileInput');

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

  // Speak question
  function speakQuestion(q){
    const langTag = languageSelect.value === 'fi' ? 'fi-FI' : 'en-US';
    speak((languageSelect.value === 'fi' ? 'Kysymys: ' : 'Question: ') + q.questionText, langTag, 0.95);
    q.options.forEach((opt, idx) => {
      setTimeout(() => {
        speak((languageSelect.value === 'fi' ? 'Vaihtoehto ' : 'Option ') + (idx+1) + '. ' + opt, langTag, 0.95);
      }, 700 + idx * 600);
    });
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
      btn.onclick = () => {
        state.selectedOption = idx;
        updateOptionSelection();
        speakOption(idx, opt);
      };
      btn.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); btn.click(); } };
      optionsEl.appendChild(btn);
    });
    state.selectedOption = state.selectedOption !== null ? state.selectedOption : null;
    updateOptionSelection();
    speakQuestion(q);
    updateScore();
  }

  function speakOption(idx, opt){
    const langTag = languageSelect.value === 'fi' ? 'fi-FI' : 'en-US';
    speak((languageSelect.value === 'fi' ? 'Valitsit vaihtoehdon ' : 'Selected option ') + (idx+1) + '. ' + opt, langTag, 1.0);
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

  function confirmAnswer(){
    const q = state.currentQuestions[state.currentIndex];
    if (!q) return;
    if (state.selectedOption === null) {
      speak(languageSelect.value === 'fi' ? 'Et valinnut vaihtoehtoa' : 'No option selected', languageSelect.value === 'fi' ? 'fi-FI' : 'en-US');
      return;
    }
    if (state.selectedOption === q.correctIndex) {
      state.score++;
      try { playCorrectTone(); } catch(e) {}
      speakLocalized('Oikein!', 'Correct!');
    } else {
      try { playWrongTone(); } catch(e) {}
      speakLocalized('Väärin. Oikea vastaus oli', 'Wrong. Correct answer was');
      speak(q.options[q.correctIndex], languageSelect.value === 'fi' ? 'fi-FI' : 'en-US');
    }
    stopTimer();
    setTimeout(() => nextQuestion(), 800);
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
        try { playTickTone(); } catch(e) {}
        const n = state.timeRemaining;
        if (lang === 'fi') { const words = ['yksi', 'kaksi', 'kolme']; speak(words[n-1] || String(n), 'fi-FI', 0.8); }
        else { const words = ['one', 'two', 'three']; speak(words[n-1] || String(n), 'en-US', 0.8); }
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
    state.selectedOption = (state.selectedOption === null) ? 0 : Math.min(q.options.length - 1, state.selectedOption + 1);
    updateOptionSelection();
  };
  $('#prevOpt').onclick = () => {
    const q = state.currentQuestions[state.currentIndex];
    if (!q) return;
    state.selectedOption = (state.selectedOption === null) ? 0 : Math.max(0, state.selectedOption - 1);
    updateOptionSelection();
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
      ? 'Ohje: Valitse teema, paina Aloita. Käytä nuolinäppäimiä valitaksesi vaihtoehdon ja Enter vahvistaaksesi. Editorissa voit liittää kysymyksiä muodossa Kysymys|opt1;opt2;opt3|0.'
      : 'Help: choose theme, press Start. Use arrows to select option and Enter to confirm. Editor accepts lines of format Question|opt1;opt2;opt3|0';
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

    // block navigation while TTS is speaking
    if (isSpeaking) {
      e.preventDefault();
      return;
    }

    // debounce quick presses
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
      if (optionsEl.children.length > 0) { $('#confirmBtn').click(); }
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
