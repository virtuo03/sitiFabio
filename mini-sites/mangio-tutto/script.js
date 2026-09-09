document.addEventListener('DOMContentLoaded', function () {

  var STORAGE_KEY = 'mangioTutto:preferenze';
  var NAME_KEY = 'mangioTutto:nome';

  var views = {
    quiz: document.getElementById('view-quiz'),
    results: document.getElementById('view-results'),
    compare: document.getElementById('view-compare'),
    edit: document.getElementById('view-edit')
  };

  var foods = [];
  var currentIndex = 0;
  var history = [];

  // ---------- Utility di vista ----------
  function showView(name) {
    Object.keys(views).forEach(function (key) {
      views[key].classList.toggle('active', key === name);
    });
  }

  function toast(msg) {
    var el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(el._timeout);
    el._timeout = setTimeout(function () { el.classList.remove('show'); }, 2200);
  }

  // ---------- Caricamento dati ----------
  fetch('alimenti.json')
    .then(function (r) { return r.json(); })
    .then(function (data) {
      foods = data.map(function (f) { return { id: f.id, nome: f.nome, categoria: f.categoria, mangio: null }; });
      loadPreferences();
      populateCategoryFilter();
      routeOnLoad();
    })
    .catch(function (err) { console.error('Errore nel caricamento degli alimenti:', err); });

  function loadPreferences() {
    try {
      var saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      foods.forEach(function (f) {
        if (saved[f.id] !== undefined) f.mangio = saved[f.id];
      });
    } catch (e) {
      // localStorage non disponibile o dato corrotto: si riparte da zero
    }
  }

  function savePreferences() {
    var out = {};
    foods.forEach(function (f) { if (f.mangio !== null) out[f.id] = f.mangio; });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(out));
  }

  function firstUnsetIndex() {
    for (var i = 0; i < foods.length; i++) if (foods[i].mangio === null) return i;
    return -1;
  }

  function counts() {
    var c = { like: 0, neutral: 0, dislike: 0, unset: 0 };
    foods.forEach(function (f) {
      if (f.mangio === 'like') c.like++;
      else if (f.mangio === 'neutral') c.neutral++;
      else if (f.mangio === 'dislike') c.dislike++;
      else c.unset++;
    });
    return c;
  }

  function score() {
    return foods.filter(function (f) { return f.mangio === 'like' || f.mangio === 'neutral'; }).length;
  }

  // ---------- Codifica / decodifica per il link di sfida ----------
  var CODE = { like: 1, neutral: 2, dislike: 3 };
  var DECODE = [null, 'like', 'neutral', 'dislike'];

  function encodeFoods(list) {
    var bytes = new Uint8Array(Math.ceil(list.length / 4));
    list.forEach(function (f, i) {
      var code = CODE[f.mangio] || 0;
      var byteIndex = Math.floor(i / 4);
      var shift = (i % 4) * 2;
      bytes[byteIndex] |= (code << shift);
    });
    var binary = '';
    bytes.forEach(function (b) { binary += String.fromCharCode(b); });
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function decodeFoods(str, length) {
    str = str.replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4) str += '=';
    var binary = atob(str);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    var out = [];
    for (var j = 0; j < length; j++) {
      var byteIndex = Math.floor(j / 4);
      var shift = (j % 4) * 2;
      out.push(DECODE[(bytes[byteIndex] >> shift) & 3]);
    }
    return out;
  }

  function buildChallengeUrl() {
    var name = localStorage.getItem(NAME_KEY) || '';
    if (!name) {
      name = prompt('Come ti chiami? (comparirà nella sfida)') || 'Un amico';
      localStorage.setItem(NAME_KEY, name);
    }
    var url = new URL(window.location.href);
    url.search = '';
    url.searchParams.set('vs', encodeFoods(foods));
    url.searchParams.set('n', name);
    return url.toString();
  }

  function shareUrl(url, text) {
    if (navigator.share) {
      navigator.share({ title: 'Mangio Tutto?', text: text, url: url }).catch(function () {});
    } else {
      navigator.clipboard.writeText(url).then(function () {
        toast('Link copiato! Incollalo dove vuoi.');
      }).catch(function () {
        prompt('Copia questo link:', url);
      });
    }
  }

  // ---------- Reset completo ----------
  function resetAll() {
    if (!confirm('Sicuro di voler cancellare tutte le tue risposte?')) return;
    foods.forEach(function (f) { f.mangio = null; });
    history = [];
    savePreferences();
    var idx = firstUnsetIndex();
    if (idx === -1) showResults();
    else renderCard();
    toast('Risposte cancellate!');
  }

  // ---------- Vista quiz ----------
  function renderCard() {
    var idx = firstUnsetIndex();
    if (idx === -1) {
      showResults();
      return;
    }
    currentIndex = idx;
    var f = foods[idx];
    document.getElementById('card-category').textContent = f.categoria;
    document.getElementById('card-name').textContent = f.nome;

    var done = foods.length - counts().unset;
    document.getElementById('progress-label').textContent = done + ' / ' + foods.length;
    document.getElementById('progress-fill').style.width = (done / foods.length * 100) + '%';
    document.getElementById('undo-btn').disabled = history.length === 0;

    showView('quiz');
  }

  document.querySelectorAll('.choice-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var choice = btn.dataset.choice;
      foods[currentIndex].mangio = choice;
      history.push(currentIndex);
      savePreferences();
      renderCard();
    });
  });

  document.getElementById('undo-btn').addEventListener('click', function () {
    var last = history.pop();
    if (last === undefined) return;
    foods[last].mangio = null;
    savePreferences();
    renderCard();
  });

  // ---------- Vista risultati ----------
  function showResults() {
    var c = counts();
    document.getElementById('r-like').textContent = c.like;
    document.getElementById('r-neutral').textContent = c.neutral;
    document.getElementById('r-dislike').textContent = c.dislike;
    document.getElementById('r-unset').textContent = c.unset;
    document.getElementById('continue-btn').style.display = c.unset > 0 ? 'inline-flex' : 'none';
    showView('results');
  }

  document.getElementById('challenge-btn').addEventListener('click', function () {
    var url = buildChallengeUrl();
    shareUrl(url, 'Ti sfido: mangi più cose di me? 🍽️');
  });

  document.getElementById('continue-btn').addEventListener('click', renderCard);
  document.getElementById('reset-btn').addEventListener('click', resetAll);
  document.getElementById('reset-quiz-btn').addEventListener('click', resetAll);

  // ---------- Vista confronto ----------
  function showCompare(vsParam, name) {
    var rivalCodes = decodeFoods(vsParam, foods.length);
    var rivalName = name || 'un amico';

    document.getElementById('rival-name').textContent = rivalName;
    document.getElementById('rival-name-2').textContent = rivalName;

    var yourScore = score();
    var rivalScore = rivalCodes.filter(function (v) { return v === 'like' || v === 'neutral'; }).length;

    document.getElementById('score-you').textContent = yourScore;
    document.getElementById('score-rival').textContent = rivalScore;

    var verdict;
    if (yourScore > rivalScore) verdict = 'Mangi più cose tu! 🏆';
    else if (rivalScore > yourScore) verdict = rivalName + ' mangia più cose di te! 🏆';
    else verdict = 'Pareggio: mangiate la stessa quantità di roba.';
    document.getElementById('vs-verdict').textContent = verdict;

    var commonLikes = [];
    var conflicts = 0;
    foods.forEach(function (f, i) {
      var rival = rivalCodes[i];
      if (f.mangio === 'like' && rival === 'like') commonLikes.push(f.nome);
      if ((f.mangio === 'like' && rival === 'dislike') || (f.mangio === 'dislike' && rival === 'like')) conflicts++;
    });

    document.getElementById('common-likes').textContent = commonLikes.length
      ? commonLikes.slice(0, 12).join(', ') + (commonLikes.length > 12 ? ' e altri ' + (commonLikes.length - 12) : '')
      : 'Nessun punto in comune (per ora).';

    document.getElementById('conflicts').textContent = conflicts > 0
      ? conflicts + ' alimenti su cui siete agli antipodi.'
      : 'Nessun vero scontro, siete abbastanza in sintonia.';

    showView('compare');
  }

  document.getElementById('do-quiz-btn').addEventListener('click', function () {
    history = [];
    renderCard();
  });

  document.getElementById('challenge-back-btn').addEventListener('click', function () {
    var url = buildChallengeUrl();
    shareUrl(url, 'Rilancio la sfida: mangi più cose di me? 🍽️');
  });

  // ---------- Vista modifica / elenco ----------
  var categoryFilter = document.getElementById('category-filter');
  var preferenceFilter = document.getElementById('preference-filter');
  var searchInput = document.getElementById('search');
  var foodList = document.getElementById('food-list');
  var editToggle = document.getElementById('edit-toggle');
  var editOpen = false;
  var lastViewBeforeEdit = 'quiz';

  function populateCategoryFilter() {
    var cats = Array.from(new Set(foods.map(function (f) { return f.categoria; }))).sort();
    cats.forEach(function (c) {
      var opt = document.createElement('option');
      opt.value = c;
      opt.textContent = c;
      categoryFilter.appendChild(opt);
    });
  }

  function displayFoods(list) {
    foodList.innerHTML = '';
    if (list.length === 0) {
      foodList.innerHTML = '<p class="no-results">Nessun alimento trovato.</p>';
      return;
    }
    list.forEach(function (food) {
      var item = document.createElement('div');
      item.className = 'food-item';

      var name = document.createElement('div');
      name.className = 'food-name';
      name.textContent = food.nome;

      var cat = document.createElement('div');
      cat.className = 'food-category';
      cat.textContent = food.categoria;

      var buttons = document.createElement('div');
      buttons.className = 'preference-buttons';

      [['like', 'Sì'], ['neutral', 'Boh'], ['dislike', 'No']].forEach(function (pair) {
        var b = document.createElement('button');
        b.className = 'preference-btn' + (food.mangio === pair[0] ? ' selected-' + pair[0] : '');
        b.textContent = pair[1];
        b.setAttribute('aria-label', 'Segna come ' + pair[1]);
        b.addEventListener('click', function () {
          food.mangio = food.mangio === pair[0] ? null : pair[0];
          savePreferences();
          applyFilters();
        });
        buttons.appendChild(b);
      });

      item.appendChild(name);
      item.appendChild(cat);
      item.appendChild(buttons);
      foodList.appendChild(item);
    });
  }

  function applyFilters() {
    var cat = categoryFilter.value;
    var pref = preferenceFilter.value;
    var term = searchInput.value.toLowerCase().trim();

    var list = foods.slice();
    if (cat !== 'all') list = list.filter(function (f) { return f.categoria === cat; });
    if (pref !== 'all') {
      list = pref === 'unset'
        ? list.filter(function (f) { return f.mangio === null; })
        : list.filter(function (f) { return f.mangio === pref; });
    }
    if (term) list = list.filter(function (f) { return f.nome.toLowerCase().indexOf(term) !== -1; });

    displayFoods(list);
  }

  categoryFilter.addEventListener('change', applyFilters);
  preferenceFilter.addEventListener('change', applyFilters);
  searchInput.addEventListener('input', applyFilters);

  editToggle.addEventListener('click', function () {
    editOpen = !editOpen;
    if (editOpen) {
      var active = Object.keys(views).filter(function (k) { return views[k].classList.contains('active'); });
      lastViewBeforeEdit = active.length ? active[0] : 'quiz';
      applyFilters();
      showView('edit');
      editToggle.textContent = 'Chiudi elenco';
    } else {
      showView(lastViewBeforeEdit === 'edit' ? 'quiz' : lastViewBeforeEdit);
      editToggle.textContent = 'Modifica risposte';
      if (lastViewBeforeEdit === 'results' || firstUnsetIndex() === -1) showResults();
      else renderCard();
    }
  });

  // ---------- Routing iniziale ----------
  function routeOnLoad() {
    var params = new URLSearchParams(window.location.search);
    var vs = params.get('vs');
    if (vs) {
      showCompare(vs, params.get('n'));
      return;
    }
    if (firstUnsetIndex() === -1) showResults();
    else renderCard();
  }

});