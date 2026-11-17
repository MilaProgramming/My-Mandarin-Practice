// ---------- State ----------
let config = { sets: [] };
let currentSetId = null;
let words = [];
let deck = [];
let index = 0;
let score = 0;
let answered = false;
let mode = 1;
let missedWords = [];

const $ = id => document.getElementById(id);
const shuffle = a => [...a].sort(() => Math.random() - 0.5);

// ---------- Pinyin / tone helpers ----------
function parsePinyin(pinyin) {
  const toneMap = {
    'ā':['a',1],'á':['a',2],'ǎ':['a',3],'à':['a',4],
    'ē':['e',1],'é':['e',2],'ě':['e',3],'è':['e',4],
    'ī':['i',1],'í':['i',2],'ǐ':['i',3],'ì':['i',4],
    'ō':['o',1],'ó':['o',2],'ǒ':['o',3],'ò':['o',4],
    'ū':['u',1],'ú':['u',2],'ǔ':['u',3],'ù':['u',4],
    'ǖ':['ü',1],'ǘ':['ü',2],'ǚ':['ü',3],'ǜ':['ü',4]
  };
  for (let i = 0; i < pinyin.length; i++) {
    const ch = pinyin[i];
    if (toneMap[ch]) {
      const [base, tone] = toneMap[ch];
      return { base: pinyin.slice(0,i) + base + pinyin.slice(i+1), tone };
    }
  }
  return { base: pinyin, tone: 5 };
}

// Place tone mark following standard pinyin rules.
// Returns index of the vowel that should carry the tone.
function toneVowelIndex(syl) {
  const lower = syl.toLowerCase();
  // Rule 1: a or e always takes the mark
  const aIdx = lower.indexOf('a');
  const eIdx = lower.indexOf('e');
  if (aIdx !== -1 && eIdx !== -1) return Math.min(aIdx, eIdx);
  if (aIdx !== -1) return aIdx;
  if (eIdx !== -1) return eIdx;

  // Rule 2: 'ou' → mark on 'o'
  const ouIdx = lower.indexOf('ou');
  if (ouIdx !== -1) return ouIdx;

  // Rule 3: 'iu' → mark on 'u'
  const iuIdx = lower.indexOf('iu');
  if (iuIdx !== -1) return iuIdx + 1;

  // Rule 4: 'ui' → mark on 'i'
  const uiIdx = lower.indexOf('ui');
  if (uiIdx !== -1) return uiIdx + 1;

  // Rule 5: otherwise the last vowel
  const vowels = 'aeiouü';
  for (let i = lower.length - 1; i >= 0; i--) {
    if (vowels.includes(lower[i])) return i;
  }
  return -1;
}

// Strip any existing tone accent from a vowel character
function stripTone(ch) {
  const accentMap = 'āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ';
  const plainMap  = 'aaaaeeeeiiiioooouuuuüüüü';
  const idx = accentMap.indexOf(ch);
  return idx !== -1 ? plainMap[idx] : ch;
}

// Add a tone to a toneless syllable
function addTone(baseSyl, toneNum) {
  if (!baseSyl) return baseSyl;
  // Normalize any existing accents first
  let normalized = '';
  for (const ch of baseSyl) normalized += stripTone(ch);

  const vi = toneVowelIndex(normalized);
  if (vi === -1) return normalized;

  const v = normalized[vi].toLowerCase();
  const marks = {
    1:{a:'ā',e:'ē',i:'ī',o:'ō',u:'ū','ü':'ǖ'},
    2:{a:'á',e:'é',i:'í',o:'ó',u:'ú','ü':'ǘ'},
    3:{a:'ǎ',e:'ě',i:'ǐ',o:'ǒ',u:'ǔ','ü':'ǚ'},
    4:{a:'à',e:'è',i:'ì',o:'ò',u:'ù','ü':'ǜ'}
  };
  const marked = marks[toneNum]?.[v] || v;
  return normalized.slice(0, vi) + marked + normalized.slice(vi + 1);
}

function getToneVariants(pinyin) {
  const { base } = parsePinyin(pinyin);
  return [1,2,3,4].map(t => addTone(base, t));
}

function getSameSyllableWords(targetWord) {
  const targetBase = parsePinyin(targetWord.pinyin).base;
  return words.filter(w => {
    if (w === targetWord) return false;
    return parsePinyin(w.pinyin).base === targetBase;
  });
}

// ---------- Loading ----------
async function loadConfig() {
  try {
    const res = await fetch('config.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`config.json not found (${res.status})`);
    config = await res.json();
  } catch (err) {
    showError('Could not load config.json. Make sure it exists next to index.html. ' + err.message);
    config = { sets: [] };
  }
}

async function loadSet(setId) {
  const setMeta = config.sets.find(s => s.id === setId);
  if (!setMeta) { showError('Set not found in config.json'); return; }
  try {
    const res = await fetch(setMeta.path, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`${setMeta.path} (${res.status})`);
    const data = await res.json();
    words = data.words || [];
    if (words.length === 0) throw new Error('Set has no words');
    currentSetId = setId;
    deck = shuffle(words);
    index = 0; score = 0; answered = false; missedWords = [];
    $('quiz').hidden = false;
    $('done').hidden = true;
    $('eyebrow').textContent = 'Mandarin · ' + (data.name || setMeta.name);
    $('mainTitle').textContent = 'Tone Practice';
    $('footerInfo').textContent = `${words.length} words · 4 options per question`;
    renderMistakes();
    render();
  } catch (err) {
    showError('Could not load set data. ' + err.message);
  }
}

// ---------- Rendering ----------
function showError(msg) {
  $('errorBox').innerHTML = `<div class="error-box">${msg}</div>`;
}
function clearError() { $('errorBox').innerHTML = ''; }

function renderSetList() {
  const list = $('setList');
  list.innerHTML = '';
  if (!config.sets.length) {
    list.innerHTML = `<li class="loading">No sets in config.json</li>`;
    return;
  }
  config.sets.forEach(s => {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'set-item' + (s.id === currentSetId ? ' active' : '') + (s.active === false ? ' coming-soon' : '');
    if (s.active === false) btn.disabled = true;
    btn.innerHTML = `<span>${s.name}</span><span class="count">${s.active === false ? 'Soon' : '→'}</span>`;
    btn.addEventListener('click', () => {
      if (s.active === false) return;
      loadSet(s.id);
      document.querySelectorAll('.set-item').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
    li.appendChild(btn);
    list.appendChild(li);
  });
}

function renderMistakes() {
  const container = $('mistakeContent');
  if (missedWords.length === 0) {
    container.innerHTML = `<div class="empty-mistakes">No mistakes yet — keep it up!</div>`;
    return;
  }
  const count = missedWords.length;
  let html = `
    <div class="mistake-header">
      <div class="mistake-icon">✗</div>
      <div class="mistake-info">
        <div class="mistake-count">${count}</div>
        <div class="mistake-label">word${count>1?'s':''} to review</div>
      </div>
    </div>
    <button class="mistake-btn" id="reviewMistakesBtn" type="button">Review mistakes →</button>
    <div class="mistake-list">
  `;
  missedWords.forEach(w => {
    html += `<div class="mistake-word"><span class="hz">${w.hanzi}</span><span class="py">${w.pinyin}</span></div>`;
  });
  html += `</div>`;
  container.innerHTML = html;
  document.getElementById('reviewMistakesBtn').addEventListener('click', startReviewRound);
}

function startReviewRound() {
  if (missedWords.length === 0) return;
  const reviewWords = [...missedWords];
  missedWords = [];
  deck = shuffle(reviewWords);
  index = 0; score = 0; answered = false;
  $('quiz').hidden = false;
  $('done').hidden = true;
  $('eyebrow').textContent = 'Mandarin · Review Mistakes';
  $('mainTitle').textContent = 'Review Session';
  $('footerInfo').textContent = `${deck.length} review words · 4 options per question`;
  renderMistakes();
  render();
}

function render() {
  if (index >= deck.length) { finish(); return; }
  answered = false;
  const w = deck[index];
  $('counter').textContent = `${index+1} / ${deck.length}`;
  $('bar').style.width = `${index/deck.length*100}%`;
  $('scoreLabel').textContent = `${score} correct`;
  $('feedback').className = 'feedback';
  $('feedback').textContent = 'Choose one of the four options.';
  $('next').disabled = true;
  $('next').textContent = index === deck.length-1 ? 'See result' : 'Next →';
  $('hanzi').hidden = mode === 2;
  $('pinyin').hidden = mode === 1;
  $('meaning').textContent = w.meaning;

  if (mode === 1) {
    $('promptLabel').textContent = 'What is the correct pinyin?';
    $('hanzi').textContent = w.hanzi;
  } else {
    $('promptLabel').textContent = 'Which character matches this pinyin?';
    $('pinyin').textContent = w.pinyin;
  }

  let choices;
  if (mode === 1) {
    const variants = getToneVariants(w.pinyin);
    choices = shuffle(variants).map(p => ({ pinyin: p, hanzi: '', meaning: '', group: '' }));
  } else {
    let pool = getSameSyllableWords(w);
    if (pool.length < 3) {
      const allOthers = words.filter(x => x !== w);
      pool = shuffle([...pool, ...shuffle(allOthers.filter(x => !pool.includes(x)))]);
    }
    choices = shuffle([w, ...pool.slice(0,3)]);
  }

  $('options').innerHTML = '';
  choices.forEach(choice => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'option';
    b.textContent = mode === 1 ? choice.pinyin : choice.hanzi;
    b.addEventListener('click', () => choose(b, choice, w));
    $('options').appendChild(b);
  });
}

function choose(button, choice, answer) {
  if (answered) return;
  answered = true;
  const buttons = [...$('options').children];
  const correctText = mode === 1 ? answer.pinyin : answer.hanzi;
  buttons.forEach(b => {
    b.disabled = true;
    if (b.textContent === correctText) b.classList.add('correct');
  });
  const correct = mode === 1 ? choice.pinyin === answer.pinyin : choice === answer;
  if (correct) {
    score++;
    $('feedback').className = 'feedback good';
    $('feedback').textContent = 'Correct! ' + answer.hanzi + ' · ' + answer.pinyin + ' · ' + answer.meaning;
  } else {
    button.classList.add('wrong');
    $('feedback').className = 'feedback bad';
    $('feedback').textContent = `Not quite. The answer is ${answer.hanzi} (${answer.pinyin}) · ${answer.meaning}.`;
    if (!missedWords.includes(answer)) missedWords.push(answer);
    renderMistakes();
  }
  $('scoreLabel').textContent = `${score} correct`;
  $('next').disabled = false;
}

function finish() {
  $('quiz').hidden = true;
  $('done').hidden = false;
  $('counter').textContent = `${deck.length} / ${deck.length}`;
  $('bar').style.width = '100%';
  $('result').textContent = `You got ${score} out of ${deck.length} correct (${Math.round(score/deck.length*100)}%).`;
}

function setMode(m) {
  mode = m;
  $('mode1').classList.toggle('active', m === 1);
  $('mode2').classList.toggle('active', m === 2);
  if (currentSetId) loadSet(currentSetId);
}

// ---------- Events ----------
$('next').addEventListener('click', () => { if (answered) { index++; render(); } });
$('restart').addEventListener('click', () => { if (currentSetId) loadSet(currentSetId); });
$('again').addEventListener('click', () => { if (currentSetId) loadSet(currentSetId); });
$('mode1').addEventListener('click', () => setMode(1));
$('mode2').addEventListener('click', () => setMode(2));
document.addEventListener('keydown', e => {
  if (e.key === 'ArrowLeft' && currentSetId) loadSet(currentSetId);
  if (e.key === 'Enter' && !$('next').disabled) $('next').click();
});

// ---------- Boot ----------
(async function boot() {
  clearError();
  await loadConfig();
  renderSetList();
  const firstActive = config.sets.find(s => s.active !== false);
  if (firstActive) {
    await loadSet(firstActive.id);
  } else {
    $('feedback').textContent = 'No active sets found in config.json.';
  }
})();